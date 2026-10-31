// Keeps track of OAuth completions that returned through a top-level redirect.
// The login itself is confirmed by the server; this only stops the client from
// treating the post-redirect page load (or a cross-site cookie that is not
// visible) as a signed-out state.
const STORAGE_KEY = 'fives_oauth_redirect';
const NOTICE_MAX_AGE_MS = 2 * 60 * 1000;
const REDIRECT_PARAMS = ['auth', 'provider', 'error', 'timestamp'];

function getSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch (e) {
    return null;
  }
}

function getLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (e) {
    return null;
  }
}

function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  if (!user.id || typeof user.id !== 'string') return null;
  return user;
}

function readNotice() {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function writeNotice(notice) {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(notice));
  } catch (e) {
    // ignore unavailable storage
  }
}

function readCachedUser() {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem('fives_user');
    if (!raw) return null;
    return sanitizeUser(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

// Writes the account cache without ever throwing. Storage can be disabled or
// full (Safari private mode, quota errors); a failed cache write must not turn a
// login the server already completed into an error.
export function saveCachedUser(user) {
  const storage = getLocalStorage();
  if (!storage) return false;
  const safeUser = sanitizeUser(user);
  if (!safeUser) return false;
  try {
    storage.setItem('fives_user', JSON.stringify(safeUser));
    return true;
  } catch (e) {
    return false;
  }
}

function writeCachedUser(user) {
  saveCachedUser(user);
}

export function clearOAuthRedirectNotice() {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (e) {
    // ignore
  }
}

// Reads ?auth=success|error from the URL, remembers it for this tab and removes
// the parameters so a reload or bookmark cannot replay the result.
export function consumeAuthRedirect() {
  let url;
  try {
    const href = globalThis.window?.location?.href || '';
    if (!href) return null;
    url = new URL(href);
  } catch (e) {
    return null;
  }

  const status = url.searchParams.get('auth');
  if (status !== 'success' && status !== 'error') return null;

  const existing = getRecentOAuthSuccess();
  let notice;

  if (status === 'success') {
    // A popup login may have completed moments ago in this same tab; its
    // redirect back to the game must not downgrade that stronger result.
    const keepPopup = existing?.source === 'popup';
    const provider = url.searchParams.get('provider');
    const cachedUser = readCachedUser();
    // Never revive a cached account from a different provider than the one that
    // just signed in; the cache may belong to the previous user of this browser.
    const providerMatches = !provider || !cachedUser
      || cachedUser.type === provider
      || cachedUser.oauthProvider === provider;
    const user = sanitizeUser(existing?.user) || (providerMatches ? cachedUser : null);
    notice = {
      status: 'success',
      source: keepPopup ? 'popup' : 'redirect',
      provider: url.searchParams.get('provider') || existing?.provider || null,
      at: keepPopup ? existing.at : Date.now()
    };
    if (user) notice.user = user;
    writeNotice(notice);
    if (user) writeCachedUser(user);
  } else if (!existing) {
    notice = {
      status: 'error',
      source: 'redirect',
      provider: url.searchParams.get('provider') || null,
      error: url.searchParams.get('error') || null,
      at: Date.now()
    };
    writeNotice(notice);
  } else {
    notice = existing;
  }

  REDIRECT_PARAMS.forEach((key) => url.searchParams.delete(key));
  try {
    const next = `${url.pathname}${url.search}${url.hash}`;
    const history = globalThis.window?.history;
    if (history && typeof history.replaceState === 'function') {
      history.replaceState({}, '', next);
    }
  } catch (e) {
    // history may be unavailable in restricted contexts
  }

  return notice;
}

// Marks a login completed by the OAuth popup. The popup message is delivered on
// the API origin and the user has already been resolved by the server. The user
// is snapshotted here because a following redirect reload may run before
// localStorage is read again.
export function markOAuthSuccess(provider, user) {
  const notice = {
    status: 'success',
    source: 'popup',
    provider: provider || null,
    at: Date.now()
  };
  const safeUser = sanitizeUser(user) || readCachedUser();
  if (safeUser) {
    notice.user = safeUser;
    writeCachedUser(safeUser);
  }
  writeNotice(notice);
}

export function getRecentOAuthSuccess(maxAgeMs = NOTICE_MAX_AGE_MS) {
  const notice = readNotice();
  if (!notice || notice.status !== 'success') return null;

  const at = Number(notice.at);
  if (!Number.isFinite(at) || Date.now() - at > maxAgeMs) {
    clearOAuthRedirectNotice();
    return null;
  }
  return notice;
}

// Returns the cached user for a login that just succeeded, whether it was handed
// over by the popup or returned through the redirect. This is used when
// /auth/me cannot see the session cookie (third-party cookie blocking); the
// server remains authoritative for online actions.
export function getFreshOAuthCachedUser() {
  const notice = getRecentOAuthSuccess();
  if (!notice) return null;

  const user = sanitizeUser(notice.user) || readCachedUser();
  if (!user) return null;
  // The cache can belong to a different account than the one that just signed
  // in; only reuse it when it matches the provider recorded for this login.
  const provider = notice.provider;
  if (provider && user.type !== provider && user.oauthProvider !== provider) return null;
  writeCachedUser(user);
  return user;
}
