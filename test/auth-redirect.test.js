import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumeAuthRedirect,
  markOAuthSuccess,
  getRecentOAuthSuccess,
  getFreshOAuthCachedUser,
  clearOAuthRedirectNotice
} from '../client/utils/authRedirect.js';

function installBrowser({ href, user = null } = {}) {
  const historyCalls = [];
  const session = new Map();
  const local = new Map();
  if (user) local.set('fives_user', JSON.stringify(user));

  globalThis.window = {
    location: { href },
    history: {
      replaceState: (_state, _title, url) => historyCalls.push(url)
    }
  };
  globalThis.sessionStorage = {
    getItem: (key) => (session.has(key) ? session.get(key) : null),
    setItem: (key, value) => session.set(key, String(value)),
    removeItem: (key) => session.delete(key)
  };
  globalThis.localStorage = {
    getItem: (key) => (local.has(key) ? local.get(key) : null),
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key)
  };

  return { historyCalls, session, local };
}

test('OAuth success redirect is recorded and removed from the URL', () => {
  const { historyCalls } = installBrowser({
    href: 'https://play.fivesdicegame.com/?auth=success&provider=discord&timestamp=123&keep=1'
  });

  const notice = consumeAuthRedirect();

  assert.equal(notice.status, 'success');
  assert.equal(notice.provider, 'discord');
  assert.equal(notice.source, 'redirect');
  assert.deepEqual(historyCalls, ['/?keep=1']);
  assert.equal(getRecentOAuthSuccess()?.source, 'redirect');
});

test('OAuth errors are recorded but never treated as a login', () => {
  installBrowser({
    href: 'https://play.fivesdicegame.com/?auth=error&error=Sign+in+failed'
  });

  const notice = consumeAuthRedirect();

  assert.equal(notice.status, 'error');
  assert.equal(notice.error, 'Sign in failed');
  assert.equal(getRecentOAuthSuccess(), null);
});

test('unrelated URLs are left untouched', () => {
  const { historyCalls } = installBrowser({
    href: 'https://play.fivesdicegame.com/?server=https%3A%2F%2Ffivesapi.onrender.com'
  });

  assert.equal(consumeAuthRedirect(), null);
  assert.equal(historyCalls.length, 0);
});

test('a fresh popup login keeps the cached user when the session cookie is not visible', () => {
  const user = { id: 'u1', name: 'Ada', type: 'discord' };
  installBrowser({ href: 'https://play.fivesdicegame.com/', user });

  markOAuthSuccess('discord');
  assert.equal(getFreshOAuthCachedUser()?.id, 'u1');

  clearOAuthRedirectNotice();
  assert.equal(getFreshOAuthCachedUser(), null);
});

test('a stale popup marker cannot keep a cached user signed in', () => {
  const user = { id: 'u1', name: 'Ada', type: 'discord' };
  const { session } = installBrowser({ href: 'https://play.fivesdicegame.com/', user });
  session.set('fives_oauth_redirect', JSON.stringify({
    status: 'success',
    source: 'popup',
    at: Date.now() - 10 * 60 * 1000
  }));

  assert.equal(getRecentOAuthSuccess(), null);
  assert.equal(getFreshOAuthCachedUser(), null);
});
