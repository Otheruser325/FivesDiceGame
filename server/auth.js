import './env.js';
import express from "express";
import crypto from "crypto";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import OAuth2Strategy from "passport-oauth2";
import bcrypt from "bcryptjs";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import geoip from "geoip-lite";
import { loadUsers, saveUsers, loadUser, saveUser } from "./utils/userStorage.js";
import { buildOAuthPopupCompletionPage } from "./oauthPopupPage.js";
import { sanitizeClientPath, resolveClientRedirect, isSameSiteOrigin } from "./oauthRedirect.js";
import { registerOAuthHandoff, consumeOAuthHandoff, isValidOAuthNonce } from "./oauthHandoff.js";

export const router = express.Router();
router.use(express.json());
router.use(requireTrustedOrigin);

const DEFAULT_PRODUCTION_CLIENT_ORIGINS = [
  'https://play.fivesdicegame.com',
  'https://fivesdicegame.com',
  'https://www.fivesdicegame.com',
  'https://fivesdicegame.vercel.app',
  'https://fivesweb.vercel.app',
  'https://otheruser325.github.io'
];

const DEFAULT_DEVELOPMENT_CLIENT_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://localhost:8080',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:3000'
];

const AUTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const AUTH_RATE_LIMIT_BUCKETS = new Map();
const AUTH_RATE_LIMIT_MAX_BUCKETS = 5000;
const AUTH_RATE_LIMIT_SWEEP_INTERVAL_MS = 30 * 1000;
let authRateLimitLastSweep = 0;

const INVALID_CREDENTIALS_ERROR = 'Invalid username or password';
// Hashed once at boot so the "no such account" path costs roughly the same as a
// real password check (keeps login timing from revealing which usernames exist).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('fives-timing-equalizer', 10);

// Helper to get country code from IP
function getCountryFromIP(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return null; // Local or private IP, no country
  }
  const geo = geoip.lookup(ip);
  return geo ? geo.country : null;
}

// PASSPORT SESSION
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const u = await loadUser(id);
    done(null, u || null);
  } catch (err) {
    done(err, null);
  }
});

// Helper to check if a strategy is registered
function isStrategyAvailable(name) {
  return passport._strategies && passport._strategies[name];
}

// Helper to handle missing strategy gracefully
function requireStrategy(strategyName, fallbackMsg) {
  return (req, res, next) => {
    if (!isStrategyAvailable(strategyName)) {
      console.warn(`[Auth] Strategy '${strategyName}' not available`);
      return sendOAuthFailure(req, res, strategyName, fallbackMsg || `${strategyName} OAuth is not configured`);
    }
    next();
  };
}

// Only hand the client the fields it renders. Anything the account record grows
// later (provider tokens, emails, storage metadata, password hashes) stays
// server-side instead of being copied wherever a user object is returned.
const PUBLIC_USER_FIELDS = ['id', 'name', 'type', 'avatar', 'country', 'createdAt', 'updatedAt', 'oauthProvider'];

function publicUser(u) {
  if (!u) return null;
  const safe = {};
  for (const field of PUBLIC_USER_FIELDS) {
    const value = u[field];
    if (value !== undefined && value !== null) safe[field] = value;
  }
  return safe;
}

function sanitizeDisplayName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
}

// Express resolves `req.ip` through the configured `trust proxy` setting. Reading
// X-Forwarded-For by hand would let a client pick its own IP (and therefore mint a
// fresh rate-limit bucket on every request).
function getClientIp(req) {
  const direct = req?.ip || req?.socket?.remoteAddress || 'unknown';
  return String(direct).replace(/^::ffff:/, '').trim() || 'unknown';
}

function pruneRateLimitBuckets(now) {
  const oversized = AUTH_RATE_LIMIT_BUCKETS.size > AUTH_RATE_LIMIT_MAX_BUCKETS;
  if (!oversized && (now - authRateLimitLastSweep) < AUTH_RATE_LIMIT_SWEEP_INTERVAL_MS) return;
  authRateLimitLastSweep = now;

  for (const [key, bucket] of AUTH_RATE_LIMIT_BUCKETS) {
    if (!bucket || (now - bucket.startedAt) >= AUTH_RATE_LIMIT_WINDOW_MS) {
      AUTH_RATE_LIMIT_BUCKETS.delete(key);
    }
  }

  if (AUTH_RATE_LIMIT_BUCKETS.size <= AUTH_RATE_LIMIT_MAX_BUCKETS) return;

  // still too many buckets, drop the oldest first
  let overflow = AUTH_RATE_LIMIT_BUCKETS.size - AUTH_RATE_LIMIT_MAX_BUCKETS;
  for (const key of AUTH_RATE_LIMIT_BUCKETS.keys()) {
    AUTH_RATE_LIMIT_BUCKETS.delete(key);
    if (--overflow <= 0) break;
  }
}

// Session cookies are SameSite=None in production, so a cross-site HTML form could
// otherwise reach these endpoints with the victim's cookie attached. Require a
// browser Origin (or Referer) belonging to the game client on every unsafe method.
function requireTrustedOrigin(req, res, next) {
  const method = String(req?.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  let origin = normalizeOrigin(req?.headers?.origin);
  if (!origin && req?.headers?.referer) {
    try {
      origin = normalizeOrigin(new URL(String(req.headers.referer)).origin);
    } catch (e) {
      origin = null;
    }
  }

  if (!origin || !isAllowedAuthOrigin(origin)) {
    console.warn(`[Auth] Rejected ${method} ${req?.originalUrl || ''} from origin: ${origin || 'none'}`);
    return res.status(403).json({ ok: false, error: 'Request origin not allowed' });
  }

  return next();
}

function isRateLimited(req, key, limit, windowMs = AUTH_RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
  pruneRateLimitBuckets(now);
  const bucketKey = `${key}:${getClientIp(req)}`;
  const bucket = AUTH_RATE_LIMIT_BUCKETS.get(bucketKey);

  if (!bucket || (now - bucket.startedAt) >= windowMs) {
    AUTH_RATE_LIMIT_BUCKETS.set(bucketKey, { startedAt: now, count: 1 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

function rejectRateLimitedAuth(res) {
  return res.status(429).json({
    ok: false,
    error: 'Too many authentication attempts. Please wait a minute and try again.'
  });
}

// Starting an OAuth flow is cheap for us but makes the provider work, and a
// callback that reaches the strategy burns a token exchange. Cap both per IP.
function oauthRateLimit(stage, provider) {
  // The game tab polls the handoff endpoint while it waits for the popup, so
  // that stage needs a budget that covers a full sign-in attempt.
  const limit = stage === 'start' ? 20 : stage === 'claim' ? 120 : 40;
  return (req, res, next) => {
    if (isRateLimited(req, `oauth-${stage}`, limit)) {
      console.warn(`[Auth] OAuth ${stage} rate limited for ${getClientIp(req)}`);
      if (stage === 'callback') {
        return sendOAuthFailure(req, res, provider, 'Too many sign-in attempts. Please wait a minute and try again.');
      }
      return res.status(429).json({ ok: false, error: 'Too many sign-in attempts. Please wait a minute and try again.' });
    }
    return next();
  };
}

function normalizeOrigin(origin) {
  if (!origin || typeof origin !== 'string') return null;
  try {
    const parsed = new URL(origin);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch (e) {
    return null;
  }
}

function getConfiguredClientOrigins() {
  const configured = process.env.CLIENT_ORIGINS
    ? process.env.CLIENT_ORIGINS
        .split(',')
        .map((origin) => normalizeOrigin(origin.trim()))
        .filter(Boolean)
    : [];

  const defaults = process.env.NODE_ENV === 'production'
    ? DEFAULT_PRODUCTION_CLIENT_ORIGINS
    : DEFAULT_DEVELOPMENT_CLIENT_ORIGINS;

  return [...new Set([
    ...defaults.map((origin) => normalizeOrigin(origin)).filter(Boolean),
    ...configured
  ])];
}

function getPublicServerOrigin() {
  const explicit = process.env.PUBLIC_SERVER_URL || process.env.RENDER_EXTERNAL_URL;
  const normalizedExplicit = normalizeOrigin(explicit);
  if (normalizedExplicit) return normalizedExplicit;

  if (process.env.NODE_ENV === 'production') {
    const host = process.env.HOST ? String(process.env.HOST).trim() : '';
    if (host) {
      const normalizedHost = normalizeOrigin(`https://${host}`);
      if (normalizedHost) return normalizedHost;
    }

    return 'https://fivesapi.onrender.com';
  }

  const localPort = process.env.PORT || 8080;
  return `http://localhost:${localPort}`;
}

const PUBLIC_SERVER_ORIGIN = getPublicServerOrigin();
const OAUTH_USER_ID_NAMESPACE = 'd6e3e4be-9493-47e9-ab88-46fbcfef5c4a';

// End-to-end tests point the real strategies at a fake provider. Only the test
// environment may do that: a stray variable in development, staging or
// production cannot redirect a token exchange away from the provider.
function providerEndpoint(envName, fallback) {
  if (process.env.NODE_ENV !== 'test') return fallback;
  const override = typeof process.env[envName] === 'string' ? process.env[envName].trim() : '';
  return /^https?:\/\//i.test(override) ? override : fallback;
}

const DISCORD_USERINFO_URL = providerEndpoint('DISCORD_USERINFO_URL', 'https://discord.com/api/users/@me');

function normalizeOAuthProviderId(providerId) {
  const normalized = String(providerId || '').trim();
  return normalized || null;
}

// Provider identity is keyed on provider + immutable provider id, never on an
// email address. Two providers that report the same email still produce two
// separate accounts; automatic email linking would let one provider claim the
// other's account and is intentionally not implemented.
function buildOAuthUserId(provider, providerId) {
  const normalizedProvider = String(provider || 'oauth').trim().toLowerCase();
  const normalizedProviderId = normalizeOAuthProviderId(providerId);
  if (!normalizedProviderId) return null;
  return uuidv5(`${normalizedProvider}:${normalizedProviderId}`, OAUTH_USER_ID_NAMESPACE);
}

async function findOAuthUser(providerField, providerName, providerId) {
  const normalizedProviderId = normalizeOAuthProviderId(providerId);
  if (!normalizedProviderId) return null;

  // Primary lookup: deterministic user id from provider+providerId.
  const deterministicId = buildOAuthUserId(providerName, normalizedProviderId);
  if (deterministicId) {
    const byDeterministicId = await loadUser(deterministicId);
    if (byDeterministicId) return byDeterministicId;
  }

  // Backward-compatible lookup: legacy rows keyed by oauth field. A failure
  // here must not reject an otherwise valid OAuth callback; the deterministic
  // id lookup above already covers accounts created by the current flow.
  let users;
  try {
    users = await loadUsers();
  } catch (err) {
    console.warn('[OAuth] Legacy user lookup failed; continuing with a new account:', err?.message || err);
    return null;
  }

  return (
    Object.values(users || {}).find(
      (u) => String(u?.[providerField] || '') === normalizedProviderId
    ) || null
  );
}

// Hosts we are willing to derive a server origin from. Host and X-Forwarded-Host
// are attacker-controlled request headers, and this origin ends up in redirect
// Location headers (/auth/discord/authorize), so anything unknown is rejected.
const TRUSTED_SERVER_HOSTS = [
  'fivesapi.onrender.com',
  'fivesdicegame.com',
  'play.fivesdicegame.com',
  'www.fivesdicegame.com',
  'fivesdicegame.vercel.app',
  'otheruser325.github.io'
];

function isTrustedServerHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  if (TRUSTED_SERVER_HOSTS.includes(host)) return true;
  if (host.endsWith('.fivesdicegame.com')) return true;

  const configuredHosts = [process.env.HOST, process.env.PUBLIC_SERVER_URL, process.env.RENDER_EXTERNAL_URL]
    .filter(Boolean)
    .map((value) => {
      const raw = String(value).trim();
      try {
        return raw.includes('://') ? new URL(raw).hostname.toLowerCase() : raw.toLowerCase();
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);

  return configuredHosts.includes(host);
}

function getRequestOrigin(req, requireTrustedHost = true) {
  try {
    const trustProxy = !!req?.app?.get?.('trust proxy');
    const forwardedProtoRaw = req?.headers?.['x-forwarded-proto'];
    const forwardedHostRaw = trustProxy ? req?.headers?.['x-forwarded-host'] : null;

    const forwardedProto = Array.isArray(forwardedProtoRaw) ? forwardedProtoRaw[0] : forwardedProtoRaw;
    const forwardedHost = Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw;

    const proto = String(forwardedProto || req?.protocol || 'https').split(',')[0].trim().toLowerCase();
    const host = String(forwardedHost || req?.get?.('host') || '').split(',')[0].trim();
    if (!host) return null;

    const origin = normalizeOrigin(`${proto === 'http' ? 'http' : 'https'}://${host}`);
    if (!origin) return null;

    // Only echo a host we actually serve; callers otherwise fall back to the
    // configured public origin.
    return !requireTrustedHost || isTrustedServerHost(new URL(origin).hostname) ? origin : null;
  } catch (e) {
    return null;
  }
}

const OAUTH_CALLBACK_PATHS = {
  google: '/auth/google/callback',
  discord: '/auth/discord/callback'
};
const DEFAULT_RENDER_OAUTH_ORIGIN = 'https://fivesapi.onrender.com';
const DEFAULT_CUSTOM_OAUTH_ORIGIN = 'https://api.fivesdicegame.com';

// The environment, not a request header, defines the allowed callback URLs.
// Accept only the actual handler path and prohibit credentials, query strings,
// fragments and insecure remote URLs.
function toTrustedCallbackUrl(candidate, path) {
  try {
    const parsed = new URL(candidate);
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
    if (parsed.username || parsed.password || parsed.pathname !== path || parsed.search || parsed.hash) return null;
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && process.env.NODE_ENV !== 'production' && isLocal)) return null;
    return parsed.toString();
  } catch (e) {
    return null;
  }
}

function resolveOAuthCallbackUrl(provider, req) {
  const path = OAUTH_CALLBACK_PATHS[provider];
  const prefix = provider.toUpperCase();
  // The singular variables remain supported, including comma-separated lists.
  // Relative callback paths are based on the configured public API origin.
  const configured = [process.env[`${prefix}_CALLBACK_URLS`], process.env[`${prefix}_CALLBACK_URL`]]
    .filter(Boolean)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value === path ? `${PUBLIC_SERVER_ORIGIN}${path}` : value);

  const defaults = [PUBLIC_SERVER_ORIGIN, DEFAULT_RENDER_OAUTH_ORIGIN, DEFAULT_CUSTOM_OAUTH_ORIGIN]
    .map((origin) => `${origin}${path}`);
  const candidates = [...new Set([...configured, ...defaults]
    .map((candidate) => toTrustedCallbackUrl(candidate, path))
    .filter(Boolean))];

  // A request host can select only an exact origin in the callback allowlist.
  const requestOrigin = getRequestOrigin(req, false);
  const matching = candidates.find((candidate) => new URL(candidate).origin === requestOrigin);
  if (matching) return matching;

  // Local development commonly reaches the same process via localhost or
  // 127.0.0.1 on a dynamically assigned port; never do this for remote hosts.
  if (process.env.NODE_ENV !== 'production' && requestOrigin) {
    const requestUrl = toTrustedCallbackUrl(`${requestOrigin}${path}`, path);
    const host = new URL(requestOrigin).hostname;
    if (requestUrl && ['localhost', '127.0.0.1', '[::1]'].includes(host)) return requestUrl;
  }

  // When the request host is not in the allowlist, prefer the configured public
  // origin over a possibly unavailable alternative or a spoofed Host header.
  const publicCallback = toTrustedCallbackUrl(`${PUBLIC_SERVER_ORIGIN}${path}`, path);
  return (publicCallback && candidates.includes(publicCallback) ? publicCallback : null)
    || candidates[0]
    || `${DEFAULT_RENDER_OAUTH_ORIGIN}${path}`;
}

function isAllowedAuthOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const configured = getConfiguredClientOrigins();
  if (configured.includes(normalized)) return true;

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    if (process.env.NODE_ENV !== 'production' && (hostname === 'localhost' || hostname === '127.0.0.1')) return true;
    if (hostname === 'fivesdicegame.com' || hostname.endsWith('.fivesdicegame.com')) return true;
  } catch (e) {
    return false;
  }

  return false;
}

function applyAuthCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedAuthOrigin(origin)) return false;

  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Vary', 'Origin');
  return true;
}

function getClientRedirectBase(req) {
  const PRODUCTION_CLIENT_FALLBACK = 'https://fivesdicegame.vercel.app';
  const LEGACY_PLAY_CLIENT_URL = 'https://play.fivesdicegame.com';
  const stateContext = getOAuthStateContext(req);

  if (stateContext.clientOrigin) {
    return resolveClientRedirect(stateContext.clientOrigin, stateContext.clientPath) || stateContext.clientOrigin;
  }

  const explicit = process.env.AUTH_SUCCESS_REDIRECT_URL || process.env.GAME_CLIENT_URL;
  if (explicit) {
    const normalizedExplicit = normalizeOrigin(explicit);
    if (!normalizedExplicit || !isAllowedAuthOrigin(normalizedExplicit)) {
      // A mistyped env var must not turn the callback into an open redirect.
      console.warn('[Auth] Ignoring AUTH_SUCCESS_REDIRECT_URL outside the allowed client origins');
    } else if (process.env.NODE_ENV === 'production' && normalizedExplicit === LEGACY_PLAY_CLIENT_URL) {
      return PRODUCTION_CLIENT_FALLBACK;
    } else {
      return normalizedExplicit;
    }
  }

  const requestOrigin = normalizeOrigin(req?.headers?.origin);
  if (requestOrigin && isAllowedAuthOrigin(requestOrigin)) {
    return requestOrigin;
  }

  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_CLIENT_FALLBACK;
  }

  return 'http://localhost:8080';
}

function buildPostAuthRedirect(req, provider) {
  const base = getClientRedirectBase(req);
  const params = new URLSearchParams({
    auth: 'success',
    provider,
    timestamp: String(Date.now())
  });

  if (/^https?:\/\//i.test(base)) {
    const url = new URL(base);
    params.forEach((value, key) => url.searchParams.set(key, value));
    return url.toString();
  }

  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${params.toString()}`;
}

function buildPostAuthErrorRedirect(req, provider, message) {
  const base = getClientRedirectBase(req);
  const params = new URLSearchParams({
    auth: 'error',
    provider: provider || 'oauth',
    error: String(message || 'OAuth login failed'),
    timestamp: String(Date.now())
  });

  if (/^https?:\/\//i.test(base)) {
    const url = new URL(base);
    params.forEach((value, key) => url.searchParams.set(key, value));
    return url.toString();
  }

  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${params.toString()}`;
}

function decodeOAuthStatePayload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('popup.')) return null;

  const encoded = trimmed.slice('popup.'.length);
  if (!encoded) return null;

  try {
    const base64 = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
}

function getOAuthState(req) {
  const raw = typeof req?.query?.state === 'string' ? req.query.state.trim() : '';
  if (!raw) return undefined;
  // Keep state bounded and reject control characters. The client payload now
  // also carries the return URL and the handoff nonce, so truncating it would
  // silently drop the values the callback depends on.
  if (raw.length > 4096) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return undefined;
  return raw;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_MAX_PENDING = 5;
const OAUTH_STATE_PREFIX = 'popup.';

function encodeOAuthStateToken(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeOAuthStateToken(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith(OAUTH_STATE_PREFIX)) return null;
  const encoded = trimmed.slice(OAUTH_STATE_PREFIX.length);
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

// Starts an OAuth flow. The provider state carries a nonce that is also stored in
// this browser's session, so a callback URL minted elsewhere (login CSRF / session
// fixation) cannot complete a sign-in. The client-supplied payload is only used as
// a hint for popup handling and is always re-validated against the origin allowlist.
function issueOAuthState(req, provider, callbackURL) {
  const clientState = decodeOAuthStatePayload(req?.query?.state);
  const requestedOrigin = normalizeOrigin(clientState?.clientOrigin);
  const clientOrigin = requestedOrigin && isAllowedAuthOrigin(requestedOrigin) ? requestedOrigin : null;
  const clientPath = sanitizeClientPath(clientState?.clientPath);
  // `top` means the client replaced its own tab instead of opening a popup, so
  // the callback must answer with a plain redirect rather than a completion page.
  const mode = clientState?.mode === 'top' ? 'top' : 'popup';
  const popup = mode === 'popup' || req?.query?.state === 'popup';
  const handoffNonce = isValidOAuthNonce(clientState?.clientNonce) ? clientState.clientNonce : null;

  const nonce = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const pending = Array.isArray(req.session?.oauthStates) ? req.session.oauthStates : [];

  req.session.oauthStates = pending
    .filter((entry) => entry && typeof entry.nonce === 'string' && (now - entry.createdAt) < OAUTH_STATE_TTL_MS)
    .slice(-(OAUTH_STATE_MAX_PENDING - 1))
    .concat([{ nonce, popup, mode, clientOrigin, clientPath, handoffNonce, provider, callbackURL, createdAt: now }]);

  return `${OAUTH_STATE_PREFIX}${encodeOAuthStateToken({ n: nonce, p: popup ? 1 : 0 })}`;
}

// One-time consumption of a provider callback's state. Returns null when the state
// is missing, expired, already used, or was not issued to this session.
function consumeOAuthState(req) {
  const token = decodeOAuthStateToken(req?.query?.state);
  const nonce = typeof token?.n === 'string' ? token.n : null;
  if (!nonce) return null;

  const pending = Array.isArray(req.session?.oauthStates) ? req.session.oauthStates : [];
  const index = pending.findIndex((entry) => entry && entry.nonce === nonce);
  if (index === -1) return null;

  const [entry] = pending.splice(index, 1);
  req.session.oauthStates = pending;
  if (!entry || (Date.now() - entry.createdAt) >= OAUTH_STATE_TTL_MS) return null;

  return {
    popup: !!entry.popup,
    mode: entry.mode === 'top' ? 'top' : 'popup',
    clientOrigin: entry.clientOrigin || null,
    clientPath: sanitizeClientPath(entry.clientPath),
    handoffNonce: isValidOAuthNonce(entry.handoffNonce) ? entry.handoffNonce : null,
    provider: entry.provider || null,
    callbackURL: entry.callbackURL || null
  };
}

function requireOAuthState(provider) {
  return (req, res, next) => {
    const context = consumeOAuthState(req);
    if (!context || (context.provider && context.provider !== provider)) {
      console.warn(`[Auth] ${provider} callback rejected: state missing, expired, or not bound to this session`);
      req.oauthStateContext = null;
      return sendOAuthFailure(req, res, provider, 'Sign in session expired. Please try again.');
    }
    req.oauthStateContext = context;
    return next();
  };
}

function contextFromClientPayload(raw, payload) {
  const clientOrigin = normalizeOrigin(payload?.clientOrigin);
  // Before the state is verified the raw value may be the server token
  // (`{n, p}`) rather than the client payload. `p` still says whether this was
  // a popup, which is all the failure path needs to avoid redirecting it.
  const serverToken = payload && (payload.p === 0 || payload.p === 1);
  const mode = serverToken
    ? (payload.p ? 'popup' : 'top')
    : (payload?.mode === 'top' ? 'top' : (payload ? 'popup' : 'top'));
  return {
    raw,
    popup: serverToken ? !!payload.p : (mode === 'popup' && !!payload?.popup),
    mode,
    clientOrigin: clientOrigin && isAllowedAuthOrigin(clientOrigin) ? clientOrigin : null,
    clientPath: sanitizeClientPath(payload?.clientPath),
    handoffNonce: isValidOAuthNonce(payload?.clientNonce) ? payload.clientNonce : null
  };
}

function getOAuthStateContext(req) {
  // During a verified OAuth callback, use the context recovered from the session.
  if (req && req.oauthStateContext !== undefined) {
    const context = req.oauthStateContext;
    if (!context) {
      // The state failed verification, but it can still tell us whether this was
      // a popup so the failure does not redirect a popup into the game.
      return contextFromClientPayload(req?.query?.state, decodeOAuthStatePayload(req?.query?.state));
    }
    return {
      raw: req?.query?.state,
      popup: !!context.popup,
      mode: context.mode === 'top' ? 'top' : 'popup',
      clientOrigin: context.clientOrigin || null,
      clientPath: context.clientPath || null,
      handoffNonce: context.handoffNonce || null
    };
  }

  const state = getOAuthState(req);
  if (!state) return { raw: undefined, popup: false, mode: 'top', clientOrigin: null, clientPath: null, handoffNonce: null };
  if (state === 'popup') return { raw: state, popup: true, mode: 'popup', clientOrigin: null, clientPath: null, handoffNonce: null };

  return contextFromClientPayload(state, decodeOAuthStatePayload(state));
}

function isPopupOAuthState(req) {
  return getOAuthStateContext(req).popup;
}

function writeOAuthPopupPage(res, payload, openerOrigin) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  return res.status(200).send(buildOAuthPopupCompletionPage(payload, openerOrigin));
}

function sendOAuthPopupCompletionPage(req, res, provider, user) {
  const stateContext = getOAuthStateContext(req);
  const candidateOpener = stateContext.clientOrigin || normalizeOrigin(req?.headers?.origin);
  const openerOrigin = isAllowedAuthOrigin(candidateOpener) ? normalizeOrigin(candidateOpener) : null;

  return writeOAuthPopupPage(res, {
    type: 'fives-oauth-success',
    provider,
    user: publicUser(user),
    timestamp: Date.now()
  }, openerOrigin);
}

// A popup must never be redirected into the game: doing so opens a second game
// tab and leaves the one the player is using signed out. Popup failures render a
// completion page instead, and publish the failure so the originating tab can
// stop waiting immediately.
export function sendOAuthFailure(req, res, provider, message) {
  const context = getOAuthStateContext(req);
  if (context.popup) {
    if (context.handoffNonce && context.clientOrigin) {
      registerOAuthHandoff({
        nonce: context.handoffNonce,
        provider,
        error: message,
        clientOrigin: context.clientOrigin
      });
    }
    return writeOAuthPopupPage(res, {
      type: 'fives-oauth-error',
      provider,
      error: message,
      timestamp: Date.now()
    }, isAllowedAuthOrigin(context.clientOrigin) ? context.clientOrigin : null);
  }

  return res.redirect(buildPostAuthErrorRedirect(req, provider, message));
}

// Cookies for a client that shares the API's registrable domain can stay
// SameSite=Lax, which browsers keep sending even when third-party cookies are
// blocked. Only genuinely cross-site clients need None+Secure.
function applyOAuthSessionCookiePolicy(req) {
  if (process.env.NODE_ENV !== 'production') return;
  const cookie = req?.session?.cookie;
  if (!cookie) return;

  const context = getOAuthStateContext(req);
  const clientOrigin = context.clientOrigin;
  cookie.sameSite = clientOrigin && isSameSiteOrigin(clientOrigin, req?.hostname)
    ? 'lax'
    : 'none';
  cookie.secure = true;
  cookie.httpOnly = true;
}

// A callback that never responds looks like a failed login to the provider even
// though the account is linked. Bound the session write so a degraded store
// cannot hold the completion response forever; the handoff ticket is already
// registered and does not depend on this write.
function saveSessionBeforeCompletion(req, logPrefix, done) {
  const configured = Number(process.env.OAUTH_SESSION_SAVE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 2500;
  let settled = false;

  const finish = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) {
      console.error(`${logPrefix} Session save before completion failed:`, error?.message || error);
    }
    done();
  };

  const timer = setTimeout(() => finish(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    req.session.save((saveErr) => finish(saveErr));
  } catch (err) {
    finish(err);
  }
}

export function completeOAuthSuccess(req, res, provider, user, logPrefix) {
  const send = () => {
    if (isPopupOAuthState(req)) {
      console.log(`${logPrefix} Popup flow completed; notifying opener`);
      return sendOAuthPopupCompletionPage(req, res, provider, user);
    }

    const redirectUrl = buildPostAuthRedirect(req, provider);
    console.log(`${logPrefix} Redirecting to:`, redirectUrl);
    return res.redirect(redirectUrl);
  };

  // When the provider severs window.opener the popup cannot hand the user back,
  // so publish a single-use ticket the tab that started the flow can claim.
  const context = getOAuthStateContext(req);
  if (context.popup) {
    const registered = registerOAuthHandoff({
      nonce: context.handoffNonce,
      provider,
      user: publicUser(user),
      clientOrigin: context.clientOrigin
    });
    if (!registered) {
      console.warn(`${logPrefix} Login handoff was not registered; relying on popup message or session`);
    }
  }

  applyOAuthSessionCookiePolicy(req);

  if (!req.session || typeof req.session.save !== 'function') {
    return send();
  }

  // Persist the session before telling the client the login succeeded, but do
  // not wait on a broken store indefinitely.
  return saveSessionBeforeCompletion(req, logPrefix, send);
}

async function saveOAuthUserOrThrow(user, providerField) {
  if (!user || !user.id) {
    throw new Error('Invalid OAuth user payload');
  }

  // Persistence is best-effort here. The provider has already verified the
  // identity and the account is in the in-memory cache, so a Supabase or local
  // storage error must not turn a completed login into "sign in failed".
  let saved = user;
  try {
    saved = await saveUser(user);
    const persisted = await loadUser(saved.id);
    if (!persisted) {
      console.warn('[OAuth] Saved OAuth user could not be re-read; continuing with the saved record', {
        userId: saved.id
      });
      return saved;
    }

    if (providerField && saved[providerField] && persisted[providerField] !== saved[providerField]) {
      const repaired = { ...persisted, [providerField]: saved[providerField] };
      await saveUser(repaired);
      const verified = await loadUser(saved.id);
      if (verified && verified[providerField] === saved[providerField]) {
        return verified;
      }
      console.warn(`[OAuth] Persisted user missing ${providerField}; continuing with deterministic OAuth ID`, {
        userId: saved.id
      });
      return verified || persisted;
    }

    return persisted;
  } catch (err) {
    console.error('[OAuth] User persistence failed; continuing with the in-memory OAuth user', {
      userId: saved?.id || user.id,
      error: err?.message || err
    });
    return saved || user;
  }
}

// Passport wraps token transport errors in oauthError; never log the raw
// provider response, which may contain credentials or authorization codes.
function logOAuthAuthenticationError(provider, err) {
  const names = new Set(['InternalOAuthError', 'TokenError', 'AuthorizationError', 'Error']);
  const oauthCodes = new Set(['invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'access_denied', 'server_error', 'temporarily_unavailable']);
  const networkCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
  const safeMessages = new Set(['Failed to obtain access token', 'Failed to fetch user profile', 'Failed to parse user profile', 'Invalid Google profile id', 'Invalid Discord user response']);
  const cause = err?.oauthError;
  const status = Number(cause?.statusCode);
  const details = {
    name: names.has(err?.name) ? err.name : 'OtherError',
    message: safeMessages.has(err?.message) ? err.message : undefined,
    oauthCode: oauthCodes.has(err?.code) ? err.code : undefined,
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
    networkCode: networkCodes.has(cause?.code) ? cause.code : undefined
  };
  // Only identify known Cloudflare error numbers, never log the response text.
  if (typeof cause?.data === 'string' && /\berror code:\s*1010\b/i.test(cause.data)) details.cloudflareCode = 1010;
  if (typeof cause?.data === 'string' && /\berror code:\s*1020\b/i.test(cause.data)) details.cloudflareCode = 1020;
  console.error(`[${provider} callback] Authentication error:`, details);
}

// ----------------- GOOGLE OAUTH -----------------
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: resolveOAuthCallbackUrl('google'),
        authorizationURL: providerEndpoint('GOOGLE_AUTHORIZATION_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
        tokenURL: providerEndpoint('GOOGLE_TOKEN_URL', 'https://www.googleapis.com/oauth2/v4/token'),
        userProfileURL: providerEndpoint('GOOGLE_USERINFO_URL', 'https://www.googleapis.com/oauth2/v3/userinfo'),
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = normalizeOAuthProviderId(profile?.id);
          if (!googleId || !/^[A-Za-z0-9_-]{1,255}$/.test(googleId)) {
            return done(new Error('Invalid Google profile id'), null);
          }

          const deterministicId = buildOAuthUserId('google', googleId) || uuidv4();
          let user = await findOAuthUser('oauthGoogle', 'google', googleId);

          if (!user) {
            user = {
              id: deterministicId,
              name: sanitizeDisplayName(profile.displayName) || `GoogleUser${crypto.randomInt(1000, 9999)}`,
              type: "google",
              oauthGoogle: googleId,
              oauthProvider: 'google',
              oauthProviderId: googleId,
              avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            user = await saveOAuthUserOrThrow(user, 'oauthGoogle');
          } else {
            const updates = {};
            if (!user.oauthGoogle) updates.oauthGoogle = googleId;
            if (!user.oauthProvider) updates.oauthProvider = 'google';
            if (!user.oauthProviderId) updates.oauthProviderId = googleId;
            if (user.type !== 'google') updates.type = 'google';

            if (Object.keys(updates).length > 0) {
              user = await saveOAuthUserOrThrow({ ...user, ...updates, updatedAt: new Date().toISOString() }, 'oauthGoogle');
            }
          }
          done(null, user);
        } catch (err) {
          console.error('Google oauth error:', err);
          done(err, null);
        }
      }
    )
  );
} else {
  console.warn("⚠ Google OAuth disabled (missing env vars)");
}

// ----------------- DISCORD OAUTH -----------------
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(
    "discord",
    new OAuth2Strategy(
      {
        authorizationURL: providerEndpoint('DISCORD_AUTHORIZATION_URL', 'https://discord.com/api/oauth2/authorize'),
        tokenURL: providerEndpoint('DISCORD_TOKEN_URL', 'https://discord.com/api/oauth2/token'),
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: resolveOAuthCallbackUrl('discord'),
        scope: ["identify"],
      },
      async (accessToken, refreshToken, params, done) => {
        try {
          const response = await fetch(DISCORD_USERINFO_URL, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(5000)
          });
          
          if (!response.ok) {
            console.error('[Discord] API error:', response.status, response.statusText);
            return done(new Error(`Discord API error: ${response.status}`));
          }
          
          const discord = await response.json();
          const discordId = normalizeOAuthProviderId(discord?.id);

          // Discord ids are numeric snowflakes; anything else is not a profile we trust.
          if (!discordId || !/^\d{1,32}$/.test(discordId)) {
            console.error('[Discord] Unexpected user id in response');
            return done(new Error('Invalid Discord user response'));
          }

          const deterministicId = buildOAuthUserId('discord', discordId) || uuidv4();
          let user = await findOAuthUser('oauthDiscord', 'discord', discordId);

          if (!user) {
            user = {
              id: deterministicId,
              name: sanitizeDisplayName(discord.username) || `Discord${crypto.randomInt(1000, 9999)}`,
              type: "discord",
              oauthDiscord: discordId,
              oauthProvider: 'discord',
              oauthProviderId: discordId,
              avatar: discord.avatar ? `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.png` : null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            console.log('[Discord] Creating new user:', { id: user.id, name: user.name });
            user = await saveOAuthUserOrThrow(user, 'oauthDiscord');
          } else {
            const updates = {};
            if (!user.oauthDiscord) updates.oauthDiscord = discordId;
            if (!user.oauthProvider) updates.oauthProvider = 'discord';
            if (!user.oauthProviderId) updates.oauthProviderId = discordId;
            if (user.type !== 'discord') updates.type = 'discord';

            if (Object.keys(updates).length > 0) {
              user = await saveOAuthUserOrThrow({ ...user, ...updates, updatedAt: new Date().toISOString() }, 'oauthDiscord');
            }
          }

          console.log('[Discord] OAuth successful for user:', user.id);
          done(null, user);
        } catch (err) {
          console.error('[Discord] OAuth error:', err?.message || err);
          done(err, null);
        }
      }
    )
  );
} else {
  console.warn("⚠ Discord OAuth disabled (missing env vars)");
}

// --- GUEST REGISTER ---
router.post("/guest/register", async (req, res) => {
  try {
    if (isRateLimited(req, 'guest-register', 6)) {
      return rejectRateLimitedAuth(res);
    }

    const { password } = req.body;
    if (typeof password !== 'string' || password.length < 6 || password.length > 128)
      return res.json({ ok: false, error: "Invalid password" });

    const id = uuidv4();
    const hashed = await bcrypt.hash(password, 10);
    const name = "Guest" + crypto.randomInt(1000, 9999);

    // Build the user object
    const user = { id, name, type: "guest", guestpassword: hashed, country: getCountryFromIP(req.ip || req.socket.remoteAddress) };

    // Save (this will try Supabase then fallback to local)
    let saved;
    try {
      saved = await saveUser(user);
    } catch (err) {
      console.error("[auth] saveUser failed:", err);
      return res.json({ ok: false, error: "Failed to create user" });
    }

    // Log the saved user id for debugging (do not log secrets)
    console.log(`[auth] Guest created: ${saved.id} (${saved.name})`);

    // Log user into session using the authoritative saved user
    req.login(saved, (err) => {
      if (err) {
        console.error('[auth] req.login failed after guest register:', err);
        return res.json({ ok: false, error: err.message });
      }
      // send the public-safe version back
      res.json({ ok: true, user: publicUser(saved) });
    });
  } catch (e) {
    console.error('[auth] guest register error:', e);
    res.json({ ok: false, error: "Server error" });
  }
});

// --- GUEST LOGIN ---
router.post("/guest/login", async (req, res) => {
  try {
    if (isRateLimited(req, 'guest-login', 10)) {
      return rejectRateLimitedAuth(res);
    }

    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.json({ ok: false, error: INVALID_CREDENTIALS_ERROR });
    }
    if (username.length > 64 || password.length > 256) {
      return res.json({ ok: false, error: INVALID_CREDENTIALS_ERROR });
    }

    // Per-username bucket on top of the per-IP one: slows targeted guessing that
    // rotates source addresses.
    if (isRateLimited(req, `guest-login-user:${username.toLowerCase()}`, 5)) {
      return rejectRateLimitedAuth(res);
    }

    const users = await loadUsers();
    const user = Object.values(users).find(u => u.type === "guest" && u.name === username);

    // ✅ Handle both guestPassword (app format) and guestpassword (DB format)
    const storedPassword = user ? (user.guestPassword || user.guestpassword) : null;
    if (!storedPassword) {
      // Same generic error and comparable timing whether the account is missing,
      // passwordless, or just has the wrong password: prevents username enumeration.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      if (user) console.warn(`[auth] Guest ${user.id} has no password stored - cannot login`);
      return res.json({ ok: false, error: INVALID_CREDENTIALS_ERROR });
    }

    const match = await bcrypt.compare(password, storedPassword);
    if (!match) return res.json({ ok: false, error: INVALID_CREDENTIALS_ERROR });

    if (!user.country) {
      user.country = getCountryFromIP(req.ip || req.socket.remoteAddress);
      await saveUser(user);
    }

    req.login(user, (err) => {
      if (err) {
        console.error('[auth] req.login failed after guest login:', err?.message || err);
        return res.json({ ok: false, error: "Server error" });
      }
      res.json({ ok: true, user: publicUser(user) });
    });
  } catch (err) {
    console.error("Guest login error:", err);
    res.json({ ok: false, error: "Server error" });
  }
});

// ----------------- SESSION CHECK -----------------
router.get("/me", async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.user) res.json({ ok: true, user: publicUser(req.user) });
  else res.json({ ok: false });
});

// Claims a login completed in the OAuth popup. The nonce is generated by the tab
// that opened the popup, so this endpoint is what lets that tab finish even when
// the provider severed window.opener. It never creates a session: the callback
// already did, and this only reports the finished login to the originating tab.
router.post("/oauth/claim", oauthRateLimit('claim', 'oauth'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = normalizeOrigin(req.headers.origin);
  if (!origin || !isAllowedAuthOrigin(origin) || !applyAuthCorsHeaders(req, res)) {
    return res.status(403).json({ ok: false });
  }

  const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
  const entry = consumeOAuthHandoff(nonce, { origin });
  if (!entry) {
    // Pending, unknown, expired, spent, or from another allowed origin all
    // look alike. A normal poll is not an authentication failure.
    return res.status(202).json({ ok: false, pending: true });
  }

  if (entry.error) {
    // A terminal failure consumed the ticket; the game tab stops waiting now
    // instead of showing a timeout minutes later.
    return res.json({ ok: false, error: entry.error });
  }

  return res.json({ ok: true, user: entry.user });
});

// ----------------- LOGOUT -----------------
router.post("/logout", (req, res) => {
  req.logout(() => {
    // Drop pending provider flows with the session so a half-finished login
    // cannot be replayed against the next account that signs in here.
    if (req.session) {
      req.session.oauthStates = undefined;
      if (typeof req.session.destroy === 'function') {
        req.session.destroy(() => res.json({ ok: true }));
        return;
      }
    }
    res.json({ ok: true });
  });
});

// ----------------- OAUTH ROUTES -----------------
router.get("/google", 
  requireStrategy("google", "Google OAuth is not configured on this server. Please restart the server with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set."),
  oauthRateLimit('start', 'google'),
  (req, res, next) => {
    const callbackURL = resolveOAuthCallbackUrl('google', req);
    const state = issueOAuthState(req, 'google', callbackURL);
    return passport.authenticate("google", {
      callbackURL,
      scope: ["profile"],
      state
    })(req, res, next);
  }
);

router.get(
  "/google/callback",
  requireStrategy("google", "Google OAuth is not configured"),
  oauthRateLimit('callback', 'google'),
  requireOAuthState("google"),
  (req, res, next) => {
    const callbackURL = req.oauthStateContext.callbackURL || resolveOAuthCallbackUrl('google', req);

    passport.authenticate("google", { callbackURL }, (err, user) => {
      if (err) {
        logOAuthAuthenticationError('Google', err);
        return sendOAuthFailure(req, res, 'google', 'Google sign in failed. Please try again.');
      }

      if (!user) {
        console.warn('[Google callback] No user returned from strategy');
        return sendOAuthFailure(req, res, 'google', 'Google sign in was cancelled or failed.');
      }

      req.login(user, async (loginErr) => {
        if (loginErr) {
          console.error('[Google callback] Login error:', loginErr?.message || loginErr);
          return sendOAuthFailure(req, res, 'google', 'Google sign in failed. Please try again.');
        }

            if (!user.country) {
          try {
            user.country = getCountryFromIP(req.ip || req.socket.remoteAddress);
            await saveUser(user);
          } catch (countryErr) {
            console.warn('[Google callback] Country update failed:', countryErr?.message || countryErr);
          }
        }

        completeOAuthSuccess(req, res, 'google', user, '[Google callback]');
      });
    })(req, res, next);
  }
);

router.get("/discord",
  requireStrategy("discord", "Discord OAuth is not configured on this server. Please restart the server with DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET set."),
  oauthRateLimit('start', 'discord'),
  (req, res, next) => {
    applyAuthCorsHeaders(req, res);
    const callbackURL = resolveOAuthCallbackUrl('discord', req);
    const state = issueOAuthState(req, 'discord', callbackURL);
    
    passport.authenticate("discord", {
      callbackURL,
      state
    })(req, res, next);
  }
);

// Discord authorize proxy endpoint to avoid CORS issues
router.get("/discord/authorize", oauthRateLimit('start', 'discord'), (req, res) => {
  try {
    const state = getOAuthState(req);
    // Only forward state values shaped like the ones we mint, so this route
    // cannot be used to echo arbitrary strings back to the client.
    if (state && !/^popup(\.|$)/.test(state)) {
      return res.status(400).json({ error: 'Invalid state' });
    }

    const redirectBase = getRequestOrigin(req) || getPublicServerOrigin();
    const redirectUrl = new URL('/auth/discord', redirectBase);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }
    if (applyAuthCorsHeaders(req, res)) {
      res.header('Cache-Control', 'no-store');
    }
    res.redirect(302, redirectUrl.toString());
  } catch (error) {
    console.error('[Discord] Authorize proxy error:', error?.message || error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle OPTIONS preflight for Discord callback
router.options("/discord/callback", (req, res) => {
  if (applyAuthCorsHeaders(req, res)) {
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
  }
  res.status(200).end();
});

// Handle OPTIONS preflight for Discord authorize proxy
router.options("/discord/authorize", (req, res) => {
  if (applyAuthCorsHeaders(req, res)) {
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
  }
  res.status(200).end();
});

router.get(
  "/discord/callback",
  requireStrategy("discord", "Discord OAuth is not configured"),
  oauthRateLimit('callback', 'discord'),
  requireOAuthState("discord"),
  (req, res, next) => {
    const callbackURL = req.oauthStateContext.callbackURL || resolveOAuthCallbackUrl('discord', req);

    // Set comprehensive CORS headers for the callback
    if (applyAuthCorsHeaders(req, res)) {
      // Set additional headers to help with cross-site cookie issues
      res.header('Access-Control-Expose-Headers', 'Set-Cookie');
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.header('Pragma', 'no-cache');
      res.header('Expires', '0');
    }
    
    // Add custom error handler for Discord auth
    passport.authenticate("discord", { callbackURL }, (err, user, info) => {
      if (err) {
        logOAuthAuthenticationError('Discord', err);
        const message = Number(err?.oauthError?.statusCode) === 429
          ? 'Discord is temporarily rate limiting sign in. Please wait before trying again.'
          : 'Discord sign in failed. Please try again.';
        return sendOAuthFailure(req, res, 'discord', message);
      }
      
      if (!user) {
        console.warn('[Discord callback] No user returned from strategy');
        return sendOAuthFailure(req, res, 'discord', 'Discord login failed');
      }
      
      req.login(user, async (loginErr) => {
        if (loginErr) {
          console.error('[Discord callback] Login error:', loginErr?.message || loginErr);
          return sendOAuthFailure(req, res, 'discord', 'Discord sign in failed. Please try again.');
        }

            if (!user.country) {
          user.country = getCountryFromIP(req.ip || req.socket.remoteAddress);
          await saveUser(user);
        }

        // Enhanced session configuration for cross-site authentication
        req.session.authenticated = true;
        req.session.provider = 'discord';
        req.session.loginTime = new Date().toISOString();
        req.session.lastActivity = new Date().toISOString();
        
        // The cookie policy (Lax for same-site clients, None for cross-site) is
        // applied centrally in completeOAuthSuccess before the response.

        // Save session with enhanced error handling and retry logic
        req.session.save(async (saveErr) => {
          if (saveErr) {
            console.error('[Discord callback] Session save error:', saveErr?.message || saveErr);
            
            // Try to save session again with fallback options
            try {
              await new Promise((resolve, reject) => {
                req.session.save((fallbackErr) => {
                  if (fallbackErr) {
                    console.error('[Discord callback] Fallback session save failed:', fallbackErr?.message || fallbackErr);
                    reject(fallbackErr);
                  } else {
                    console.log('[Discord callback] Fallback session save successful');
                    resolve();
                  }
                });
              });
            } catch (fallbackErr) {
              console.error('[Discord callback] All session save attempts failed:', fallbackErr?.message || fallbackErr);
              // The account is linked and req.login succeeded. Complete the
              // sign-in anyway so the popup/handoff can deliver it; do not turn
              // a session-store problem into a false "sign in failed".
              return completeOAuthSuccess(req, res, 'discord', user, '[Discord callback]');
            }
          }
          
          console.log('[Discord callback] Session saved successfully');
          
          // Success - notify popup opener (if popup flow) or redirect main window.
          completeOAuthSuccess(req, res, 'discord', user, '[Discord callback]');
        });
      });
    })(req, res, next);
  }
);

// ---------- REPORT AVAILABLE AUTH METHODS ----------
router.get("/methods", (req, res) => {
  const methods = {
    guest: true, // Always available
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    discord: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
  };
  res.json(methods);
});

// Auth middleware function to initialize Passport
export function authMiddleware(app) {
  app.use(passport.initialize());
  app.use(passport.session());
  console.log('[Auth] Passport middleware initialized');
}

export { passport };

// Export the router as authRouter for consistency
export const authRouter = router;

// Also export default router for backward compatibility
export default router;
