import './env.js';
import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import OAuth2Strategy from "passport-oauth2";
import bcrypt from "bcryptjs";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import geoip from "geoip-lite";
import { loadUsers, saveUsers, loadUser, saveUser } from "./utils/userStorage.js";

export const router = express.Router();
router.use(express.json());

const DEFAULT_PRODUCTION_CLIENT_ORIGINS = [
  'https://play.fivesdicegame.com',
  'https://fivesdicegame.com',
  'https://www.fivesdicegame.com',
  'https://fivesdicegame.vercel.app',
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
      const message = encodeURIComponent(fallbackMsg || `${strategyName} OAuth is not configured`);
      return res.redirect(`/?error=${message}`);
    }
    next();
  };
}

// SAFE HELPER
function publicUser(u) {
  if (!u) return null;
  const { guestpassword, guestPassword, ...safe } = u;
  return safe;
}

function getClientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (Array.isArray(forwarded) && forwarded[0]) return String(forwarded[0]).split(',')[0].trim();
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req?.ip || req?.socket?.remoteAddress || 'unknown';
}

function isRateLimited(req, key, limit, windowMs = AUTH_RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
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
const DISCORD_CALLBACK_PATH = '/auth/discord/callback';
const DISCORD_CALLBACK_FALLBACK_URL = `${PUBLIC_SERVER_ORIGIN}${DISCORD_CALLBACK_PATH}`;
const DEFAULT_RENDER_DISCORD_CALLBACK_URL = 'https://fivesapi.onrender.com/auth/discord/callback';
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL || DISCORD_CALLBACK_PATH;
const OAUTH_USER_ID_NAMESPACE = 'd6e3e4be-9493-47e9-ab88-46fbcfef5c4a';

function normalizeOAuthProviderId(providerId) {
  const normalized = String(providerId || '').trim();
  return normalized || null;
}

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

  // Backward-compatible lookup: legacy rows keyed by oauth field.
  const users = await loadUsers();
  return (
    Object.values(users || {}).find(
      (u) => String(u?.[providerField] || '') === normalizedProviderId
    ) || null
  );
}

function normalizeAbsoluteUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    return new URL(url).toString();
  } catch (e) {
    return null;
  }
}

function getRequestOrigin(req) {
  try {
    const forwardedProtoRaw = req?.headers?.['x-forwarded-proto'];
    const forwardedHostRaw = req?.headers?.['x-forwarded-host'];

    const forwardedProto = Array.isArray(forwardedProtoRaw) ? forwardedProtoRaw[0] : forwardedProtoRaw;
    const forwardedHost = Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw;

    const proto = String(forwardedProto || req?.protocol || 'https').split(',')[0].trim();
    const host = String(forwardedHost || req?.get?.('host') || '').split(',')[0].trim();
    if (!host) return null;

    return normalizeOrigin(`${proto}://${host}`);
  } catch (e) {
    return null;
  }
}

function toAbsoluteCallbackUrl(candidate, req, preferredBase) {
  if (!candidate || typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeAbsoluteUrl(trimmed);
  }

  if (trimmed.startsWith('/')) {
    const normalizedPreferredBase = normalizeOrigin(preferredBase);
    const requestOrigin = getRequestOrigin(req);
    const base = normalizedPreferredBase || requestOrigin || PUBLIC_SERVER_ORIGIN;
    const normalizedBase = normalizeOrigin(base);
    if (!normalizedBase) return null;
    return normalizeAbsoluteUrl(`${normalizedBase}${trimmed}`);
  }

  return null;
}

function resolveDiscordCallbackUrl(req) {
  const requestOrigin = getRequestOrigin(req);
  const requestHostCallback = requestOrigin ? normalizeAbsoluteUrl(`${requestOrigin}${DISCORD_CALLBACK_PATH}`) : null;
  const publicOriginCallback = normalizeAbsoluteUrl(`${PUBLIC_SERVER_ORIGIN}${DISCORD_CALLBACK_PATH}`);
  const configuredCallback = toAbsoluteCallbackUrl(DISCORD_CALLBACK_URL, req, PUBLIC_SERVER_ORIGIN);

  // Discord token exchange is strict about redirect_uri matching. In production
  // we should stick to one stable callback instead of drifting with whichever
  // host happened to serve the authorize request.
  const candidates = process.env.NODE_ENV === 'production'
    ? [
        configuredCallback,
        publicOriginCallback,
        normalizeAbsoluteUrl(DISCORD_CALLBACK_FALLBACK_URL),
        normalizeAbsoluteUrl(DEFAULT_RENDER_DISCORD_CALLBACK_URL)
      ]
    : [
        requestHostCallback,
        configuredCallback,
        publicOriginCallback,
        normalizeAbsoluteUrl(DISCORD_CALLBACK_FALLBACK_URL),
        normalizeAbsoluteUrl(DEFAULT_RENDER_DISCORD_CALLBACK_URL)
      ];

  for (const candidate of candidates) {
    const normalized = normalizeAbsoluteUrl(candidate);
    if (normalized) return normalized;
  }

  return DEFAULT_RENDER_DISCORD_CALLBACK_URL;
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
    return stateContext.clientOrigin;
  }

  const explicit = process.env.AUTH_SUCCESS_REDIRECT_URL || process.env.GAME_CLIENT_URL;
  if (explicit) {
    const normalizedExplicit = normalizeOrigin(explicit);
    if (process.env.NODE_ENV === 'production' && normalizedExplicit === LEGACY_PLAY_CLIENT_URL) {
      return PRODUCTION_CLIENT_FALLBACK;
    }
    return explicit;
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
  // Keep state bounded so provider callbacks stay predictable.
  return raw.slice(0, 512);
}

function getOAuthStateContext(req) {
  const state = getOAuthState(req);
  if (!state) return { raw: undefined, popup: false, clientOrigin: null };
  if (state === 'popup') return { raw: state, popup: true, clientOrigin: null };

  const payload = decodeOAuthStatePayload(state);
  const clientOrigin = normalizeOrigin(payload?.clientOrigin);
  return {
    raw: state,
    popup: !!payload?.popup,
    clientOrigin: clientOrigin && isAllowedAuthOrigin(clientOrigin) ? clientOrigin : null
  };
}

function isPopupOAuthState(req) {
  return getOAuthStateContext(req).popup;
}

function sendOAuthPopupCompletionPage(req, res, provider, user) {
  const redirectUrl = buildPostAuthRedirect(req, provider);
  const stateContext = getOAuthStateContext(req);
  const openerOrigin = stateContext.clientOrigin || normalizeOrigin(redirectUrl) || normalizeOrigin(req?.headers?.origin);
  const payload = {
    type: 'fives-oauth-success',
    provider,
    user: publicUser(user),
    redirectUrl,
    timestamp: Date.now()
  };

  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const serializedOpenerOrigin = JSON.stringify(openerOrigin || '');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OAuth Complete</title>
  </head>
  <body>
    <p>Completing sign in...</p>
    <script>
      (function () {
        var payload = ${serializedPayload};
        var openerOrigin = ${serializedOpenerOrigin};
        try {
          if (openerOrigin && window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, openerOrigin);
            window.close();
            return;
          }
        } catch (e) {}

        if (payload.redirectUrl) {
          window.location.replace(payload.redirectUrl);
          return;
        }

        document.body.textContent = 'Sign in complete. You can close this window.';
      })();
    </script>
  </body>
</html>`);
}

function completeOAuthSuccess(req, res, provider, user, logPrefix) {
  if (isPopupOAuthState(req)) {
    console.log(`${logPrefix} Popup flow completed; notifying opener`);
    return sendOAuthPopupCompletionPage(req, res, provider, user);
  }

  const redirectUrl = buildPostAuthRedirect(req, provider);
  console.log(`${logPrefix} Redirecting to:`, redirectUrl);
  return res.redirect(redirectUrl);
}

async function saveOAuthUserOrThrow(user, providerField) {
  if (!user || !user.id) {
    throw new Error('Invalid OAuth user payload');
  }

  const saved = await saveUser(user);
  const persisted = await loadUser(saved.id);
  if (!persisted) {
    throw new Error('OAuth user persistence verification failed');
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
}

// ----------------- GOOGLE OAUTH -----------------
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const googleId = normalizeOAuthProviderId(profile?.id);
          if (!googleId) {
            return done(new Error('Invalid Google profile id'), null);
          }

          const deterministicId = buildOAuthUserId('google', googleId) || uuidv4();
          let user = await findOAuthUser('oauthGoogle', 'google', googleId);

          if (!user) {
            user = {
              id: deterministicId,
              name: profile.displayName || `GoogleUser${Math.floor(Math.random() * 9999)}`,
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
  console.log('[Discord OAuth] Callback config:', DISCORD_CALLBACK_URL);
  console.log('[Discord OAuth] Callback fallback:', DISCORD_CALLBACK_FALLBACK_URL);

  passport.use(
    "discord",
    new OAuth2Strategy(
      {
        authorizationURL: "https://discord.com/api/oauth2/authorize",
        tokenURL: "https://discord.com/api/oauth2/token",
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: DISCORD_CALLBACK_URL,
        scope: ["identify"],
      },
      async (accessToken, refreshToken, params, done) => {
        try {
          const response = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          
          if (!response.ok) {
            console.error('[Discord] API error:', response.status, response.statusText);
            return done(new Error(`Discord API error: ${response.status}`));
          }
          
          const discord = await response.json();
          
          if (!discord.id) {
            console.error('[Discord] No user ID in response:', discord);
            return done(new Error('Invalid Discord user response'));
          }

          const discordId = normalizeOAuthProviderId(discord.id);
          if (!discordId) {
            return done(new Error('Invalid Discord user response: missing id'), null);
          }

          const deterministicId = buildOAuthUserId('discord', discordId) || uuidv4();
          let user = await findOAuthUser('oauthDiscord', 'discord', discordId);

          if (!user) {
            user = {
              id: deterministicId,
              name: discord.username || `Discord${Math.floor(Math.random() * 9999)}`,
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
    if (!password || password.length < 6)
      return res.json({ ok: false, error: "Invalid password" });

    const id = uuidv4();
    const hashed = await bcrypt.hash(password, 10);
    const name = "Guest" + Math.floor(Math.random() * 9999);

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

    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: "Missing credentials" });

    const users = await loadUsers();
    const user = Object.values(users).find(u => u.type === "guest" && u.name === username);

    if (!user) return res.json({ ok: false, error: "Guest not found" });

    // ✅ Handle both guestPassword (app format) and guestpassword (DB format)
    const storedPassword = user.guestPassword || user.guestpassword;
    if (!storedPassword) {
      console.warn(`[auth] Guest ${username} has no password stored - cannot login`);
      return res.json({ ok: false, error: "Guest account corrupted - no password" });
    }

    const match = await bcrypt.compare(password, storedPassword);
    if (!match) return res.json({ ok: false, error: "Wrong password" });

    // Update country if not set
    if (!user.country) {
      user.country = getCountryFromIP(req.ip || req.socket.remoteAddress);
      await saveUser(user);
    }

    req.login(user, (err) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true, user: publicUser(user) });
    });
  } catch (err) {
    console.error("Guest login error:", err);
    res.json({ ok: false, error: "Server error" });
  }
});

// ----------------- SESSION CHECK -----------------
router.get("/me", async (req, res) => {
  if (req.user) res.json({ ok: true, user: publicUser(req.user) });
  else res.json({ ok: false });
});

// ----------------- LOGOUT -----------------
router.post("/logout", (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

// ----------------- OAUTH ROUTES -----------------
router.get("/google", 
  requireStrategy("google", "Google OAuth is not configured on this server. Please restart the server with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set."),
  (req, res, next) => {
    const state = getOAuthState(req);
    return passport.authenticate("google", {
      scope: ["profile"],
      state
    })(req, res, next);
  }
);

router.get(
  "/google/callback",
  requireStrategy("google", "Google OAuth is not configured"),
  passport.authenticate("google", { failureRedirect: "/" }),
  async (req, res) => {
    // Update country if not set
    if (req.user && !req.user.country) {
      req.user.country = getCountryFromIP(req.ip || req.socket.remoteAddress);
      await saveUser(req.user);
    }
    completeOAuthSuccess(req, res, 'google', req.user, '[Google callback]');
  }
);

router.get("/discord",
  requireStrategy("discord", "Discord OAuth is not configured on this server. Please restart the server with DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET set."),
  (req, res, next) => {
    applyAuthCorsHeaders(req, res);
    const callbackURL = resolveDiscordCallbackUrl(req);
    const state = getOAuthState(req);
    
    passport.authenticate("discord", {
      callbackURL,
      state
    })(req, res, next);
  }
);

// Discord authorize proxy endpoint to avoid CORS issues
router.get("/discord/authorize", (req, res) => {
  try {
    const redirectBase = getRequestOrigin(req) || getPublicServerOrigin();
    const redirectUrl = new URL('/auth/discord', redirectBase);
    const state = getOAuthState(req);
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
  (req, res, next) => {
    const callbackURL = resolveDiscordCallbackUrl(req);

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
        console.error('[Discord callback] Authentication error:', err?.message || err);
        const errorMsg = `Discord login failed: ${err?.message || 'Unknown error'}`;
        return res.redirect(buildPostAuthErrorRedirect(req, 'discord', errorMsg));
      }
      
      if (!user) {
        console.warn('[Discord callback] No user returned from strategy');
        return res.redirect(buildPostAuthErrorRedirect(req, 'discord', 'Discord login failed'));
      }
      
      req.login(user, async (loginErr) => {
        if (loginErr) {
          console.error('[Discord callback] Login error:', loginErr?.message || loginErr);
          const errorMsg = `Login failed: ${loginErr?.message || 'Unknown error'}`;
          return res.redirect(buildPostAuthErrorRedirect(req, 'discord', errorMsg));
        }

        // Update country if not set
        if (!user.country) {
          user.country = getCountryFromIP(req.ip || req.socket.remoteAddress);
          await saveUser(user);
        }

        // Enhanced session configuration for cross-site authentication
        req.session.authenticated = true;
        req.session.provider = 'discord';
        req.session.loginTime = new Date().toISOString();
        req.session.lastActivity = new Date().toISOString();
        
        // Ensure session is properly configured for cross-site cookies
        if (process.env.NODE_ENV === 'production') {
          req.session.cookie.sameSite = 'none';
          req.session.cookie.secure = true;
          req.session.cookie.domain = undefined; // Remove domain restriction for cross-site
          req.session.cookie.priority = 'high';
        }
        
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
              const errorMsg = `Session save failed: ${fallbackErr?.message || 'Unknown error'}`;
              return res.redirect(buildPostAuthErrorRedirect(req, 'discord', errorMsg));
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
