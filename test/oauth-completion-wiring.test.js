import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { completeOAuthSuccess, sendOAuthFailure } from '../server/auth.js';
import { consumeOAuthHandoff, clearOAuthHandoffs } from '../server/oauthHandoff.js';

const CLIENT_ORIGIN = 'https://play.fivesdicegame.com';
const USER = { id: 'u1', name: 'Ada', type: 'google' };

function fakeResponse() {
  const res = {
    statusCode: 0,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    send(body) { this.body = body; this.statusCode = this.statusCode || 200; return this; },
    redirect(url) { this.location = url; this.statusCode = 302; return this; },
    json(body) { this.body = body; return this; }
  };
  return res;
}

function fakeRequest({ mode, nonce, clientPath = '/' }) {
  return {
    query: { state: `popup.${Buffer.from(JSON.stringify({ n: 'server-state' })).toString('base64url')}` },
    headers: { origin: CLIENT_ORIGIN },
    hostname: 'api.fivesdicegame.com',
    session: { cookie: {}, save(callback) { callback(); } },
    oauthStateContext: {
      popup: mode !== 'top',
      mode,
      clientOrigin: CLIENT_ORIGIN,
      clientPath,
      handoffNonce: nonce
    }
  };
}

test('a popup completion hands the login to a claimable ticket and never redirects', () => {
  clearOAuthHandoffs();
  const nonce = crypto.randomBytes(24).toString('base64url');
  const req = fakeRequest({ mode: 'popup', nonce });
  const res = fakeResponse();

  completeOAuthSuccess(req, res, 'google', USER, '[test]');

  assert.equal(res.statusCode, 200, 'popup completion must not redirect');
  assert.equal(res.location, undefined);
  assert.ok(String(res.body).includes('fives-oauth-success'), 'completion page missing payload');
  assert.ok(!String(res.body).includes('window.location.replace'), 'popup must not navigate into the game');

  assert.deepEqual(
    consumeOAuthHandoff(nonce, { origin: CLIENT_ORIGIN }),
    { provider: 'google', user: USER, error: null, retryable: false },
    'the game tab must be able to claim the login'
  );
});

test('a hung session store cannot block the OAuth completion response', async () => {
  clearOAuthHandoffs();
  const nonce = crypto.randomBytes(24).toString('base64url');
  const req = fakeRequest({ mode: 'popup', nonce });
  req.session.save = () => { /* a broken store never calls back */ };
  const res = fakeResponse();

  process.env.OAUTH_SESSION_SAVE_TIMEOUT_MS = '40';
  try {
    completeOAuthSuccess(req, res, 'google', USER, '[test]');
    await new Promise((resolve) => setTimeout(resolve, 120));
  } finally {
    delete process.env.OAUTH_SESSION_SAVE_TIMEOUT_MS;
  }

  assert.equal(res.statusCode, 200, 'the callback must still answer');
  assert.ok(String(res.body).includes('fives-oauth-success'));
});

test('a popup completion that cannot register a handoff still returns the completion page', () => {
  clearOAuthHandoffs();
  const req = fakeRequest({ mode: 'popup', nonce: null });
  const res = fakeResponse();

  completeOAuthSuccess(req, res, 'google', USER, '[test]');

  assert.equal(res.statusCode, 200);
  assert.equal(res.location, undefined);
  assert.ok(String(res.body).includes('fives-oauth-success'));
});

test('a popup failure renders a page and publishes a terminal error instead of redirecting', () => {
  clearOAuthHandoffs();
  const nonce = crypto.randomBytes(24).toString('base64url');
  const req = fakeRequest({ mode: 'popup', nonce });
  const res = fakeResponse();

  sendOAuthFailure(req, res, 'google', 'Google sign in was cancelled or failed.');

  assert.equal(res.statusCode, 200, 'a popup failure must not redirect into the game');
  assert.equal(res.location, undefined);
  assert.ok(String(res.body).includes('fives-oauth-error'));
  assert.ok(!String(res.body).includes('window.location.replace'));

  assert.deepEqual(
    consumeOAuthHandoff(nonce, { origin: CLIENT_ORIGIN }),
    { provider: 'google', user: null, error: 'Google sign in was cancelled or failed.', retryable: false }
  );
});

// A callback whose state was expired or already used still knows it came from a
// popup: the provider echoes our `{n, p}` token, so the failure path can render
// a page instead of redirecting the popup into the game.
test('an expired callback state issued for a popup never redirects into the game', () => {
  clearOAuthHandoffs();
  const clientState = `popup.${Buffer.from(JSON.stringify({
    n: 'server-state',
    p: 1
  })).toString('base64url')}`;
  const req = {
    query: { state: clientState },
    headers: { origin: CLIENT_ORIGIN },
    hostname: 'api.fivesdicegame.com',
    session: { cookie: {}, save(callback) { callback(); } },
    oauthStateContext: null
  };
  const res = fakeResponse();

  sendOAuthFailure(req, res, 'google', 'Sign in session expired. Please try again.');

  assert.equal(res.statusCode, 200);
  assert.equal(res.location, undefined);
  assert.ok(String(res.body).includes('fives-oauth-error'));
  assert.ok(!String(res.body).includes('window.location.replace'));
});

test('a top-level failure still redirects with the error instead of a popup page', () => {
  const req = fakeRequest({ mode: 'top', nonce: null, clientPath: '/FivesDiceGame/' });
  req.oauthStateContext.clientOrigin = 'https://otheruser325.github.io';
  const res = fakeResponse();

  sendOAuthFailure(req, res, 'google', 'Google sign in was cancelled or failed.');

  assert.equal(res.statusCode, 302);
  assert.ok(res.location.startsWith('https://otheruser325.github.io/FivesDiceGame/?auth=error'), res.location);
  assert.match(res.location, /provider=google/);
  assert.match(res.location, /error=Google\+sign\+in/);
});

test('a top-level flow redirects to the exact tab URL instead of rendering a popup page', () => {
  clearOAuthHandoffs();
  const nonce = crypto.randomBytes(24).toString('base64url');
  const req = fakeRequest({ mode: 'top', nonce, clientPath: '/FivesDiceGame/?room=ABC#lobby' });
  req.oauthStateContext.clientOrigin = 'https://otheruser325.github.io';
  const res = fakeResponse();

  completeOAuthSuccess(req, res, 'google', USER, '[test]');

  assert.equal(res.statusCode, 302);
  assert.ok(res.location.startsWith('https://otheruser325.github.io/FivesDiceGame/?room=ABC&auth=success'), res.location);
  assert.ok(res.location.endsWith('#lobby'), res.location);
  assert.equal(consumeOAuthHandoff(nonce, { origin: 'https://otheruser325.github.io' }), null, 'top-level flow needs no ticket');
});
