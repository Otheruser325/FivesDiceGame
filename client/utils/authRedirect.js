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

  const notice = {
    status,
    source: 'redirect',
    provider: url.searchParams.get('provider') || null,
    error: url.searchParams.get('error') || null,
    at: Date.now()
  };
  writeNotice(notice);

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
// the API origin and the user has already been resolved by the server.
export function markOAuthSuccess(provider) {
  writeNotice({
    status: 'success',
    source: 'popup',
    provider: provider || null,
    at: Date.now()
  });
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

// Returns the cached user only for a popup login that just succeeded. This is
// used when /auth/me cannot see the session cookie (third-party cookie
// blocking); the server remains authoritative for online actions.
export function getFreshOAuthCachedUser() {
  const notice = getRecentOAuthSuccess();
  if (!notice || notice.source !== 'popup') return null;

  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem('fives_user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user && user.id ? user : null;
  } catch (e) {
    return null;
  }
}
