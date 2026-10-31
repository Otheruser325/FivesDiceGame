// Completes a popup login without window.opener.
//
// Google's OAuth endpoints send `Cross-Origin-Opener-Policy: same-origin`, which
// severs the opener relationship while the popup is on accounts.google.com. Once
// that happens the completion page cannot postMessage the game tab, and the game
// tab cannot inspect the popup either. Instead the tab that started the flow
// generates a high-entropy nonce, the callback registers the finished login
// against it, and that same tab claims it over an ordinary same-origin-to-API
// request. The nonce is a bearer secret: single use, short lived, and bound to the
// client origin that started the flow.
import crypto from 'node:crypto';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 500;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const pending = new Map();

const sweeper = setInterval(() => sweep(), 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

function digest(nonce) {
  return crypto.createHash('sha256').update(String(nonce), 'utf8').digest('base64url');
}

function originOf(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch (e) {
    return null;
  }
}

function sweep(now = Date.now()) {
  for (const [key, entry] of pending) {
    if (!entry || entry.expiresAt <= now) pending.delete(key);
  }
}

export function isValidOAuthNonce(nonce) {
  return typeof nonce === 'string' && NONCE_PATTERN.test(nonce);
}

// Stores the finished login (or a terminal failure) for the tab that started
// the flow. Returns false when the request does not carry the pieces the
// handoff needs.
export function registerOAuthHandoff({ nonce, provider, user = null, error = null, clientOrigin, ttlMs = DEFAULT_TTL_MS }) {
  if (!isValidOAuthNonce(nonce)) return false;
  if (!provider || typeof provider !== 'string') return false;
  const hasUser = !!user && typeof user === 'object' && !!user.id;
  const message = typeof error === 'string' ? error.slice(0, 300) : '';
  if (!hasUser && !message) return false;

  const origin = originOf(clientOrigin);
  if (!origin) return false;

  sweep();
  if (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next();
    if (!oldest.done) pending.delete(oldest.value);
  }

  pending.set(digest(nonce), {
    provider,
    user: hasUser ? user : null,
    error: hasUser ? null : message,
    clientOrigin: origin,
    expiresAt: Date.now() + Math.max(1000, Number(ttlMs) || DEFAULT_TTL_MS)
  });
  return true;
}

// One-time read. The entry is only removed when the request matches its origin,
// so a request without the nonce cannot burn it. Returns null for anything
// missing, expired, already claimed, or offered from a different origin.
export function consumeOAuthHandoff(nonce, { origin, provider } = {}) {
  if (!isValidOAuthNonce(nonce)) return null;

  const key = digest(nonce);
  const entry = pending.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    pending.delete(key);
    return null;
  }

  if (provider && entry.provider !== provider) return null;
  if (originOf(origin) !== entry.clientOrigin) return null;

  pending.delete(key);
  return { provider: entry.provider, user: entry.user || null, error: entry.error || null };
}

// Test seam: keeps handoff state from leaking between test files.
export function clearOAuthHandoffs() {
  pending.clear();
}
