import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  registerOAuthHandoff,
  consumeOAuthHandoff,
  isValidOAuthNonce,
  clearOAuthHandoffs
} from '../server/oauthHandoff.js';

const CLIENT_ORIGIN = 'https://play.fivesdicegame.com';
const USER = { id: 'u1', name: 'Ada', type: 'google' };

function nonce() {
  return crypto.randomBytes(24).toString('base64url');
}

test('a registered login can be claimed exactly once by the tab that started it', () => {
  const ticket = nonce();
  assert.equal(registerOAuthHandoff({
    nonce: ticket,
    provider: 'google',
    user: USER,
    clientOrigin: CLIENT_ORIGIN
  }), true);

  assert.deepEqual(
    consumeOAuthHandoff(ticket, { origin: CLIENT_ORIGIN }),
    { provider: 'google', user: USER, error: null }
  );
  // A second claim must fail: the ticket is spent.
  assert.equal(consumeOAuthHandoff(ticket, { origin: CLIENT_ORIGIN }), null);
});

test('a login cannot be claimed from a different origin, and a rejected claim does not burn it', () => {
  const ticket = nonce();
  registerOAuthHandoff({ nonce: ticket, provider: 'discord', user: USER, clientOrigin: CLIENT_ORIGIN });

  assert.equal(consumeOAuthHandoff(ticket, { origin: 'https://evil.example' }), null);
  assert.equal(consumeOAuthHandoff(ticket, { origin: null }), null);
  assert.deepEqual(
    consumeOAuthHandoff(ticket, { origin: CLIENT_ORIGIN }),
    { provider: 'discord', user: USER, error: null }
  );
});

test('a stale, malformed, or mismatched handoff is refused', async () => {
  clearOAuthHandoffs();

  assert.equal(isValidOAuthNonce('short'), false);
  assert.equal(isValidOAuthNonce('a'.repeat(32)), true);
  assert.equal(isValidOAuthNonce('a'.repeat(32) + '!'), false);

  assert.equal(registerOAuthHandoff({ nonce: 'short', provider: 'google', user: USER, clientOrigin: CLIENT_ORIGIN }), false);
  assert.equal(registerOAuthHandoff({ nonce: nonce(), provider: 'google', user: {}, clientOrigin: CLIENT_ORIGIN }), false);
  assert.equal(registerOAuthHandoff({ nonce: nonce(), provider: 'google', user: USER, clientOrigin: 'not a url' }), false);

  const ticket = nonce();
  registerOAuthHandoff({ nonce: ticket, provider: 'google', user: USER, clientOrigin: CLIENT_ORIGIN });
  assert.equal(consumeOAuthHandoff(ticket, { origin: CLIENT_ORIGIN, provider: 'discord' }), null);
  // A provider mismatch must not spend the ticket.
  assert.deepEqual(consumeOAuthHandoff(ticket, { origin: CLIENT_ORIGIN }), { provider: 'google', user: USER, error: null });

  const expiring = nonce();
  registerOAuthHandoff({
    nonce: expiring,
    provider: 'google',
    user: USER,
    clientOrigin: CLIENT_ORIGIN,
    ttlMs: 1000
  });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(consumeOAuthHandoff(expiring, { origin: CLIENT_ORIGIN }), null);
});

test('the handoff stores only a digest of the nonce', () => {
  clearOAuthHandoffs();
  const ticket = nonce();
  registerOAuthHandoff({ nonce: ticket, provider: 'google', user: USER, clientOrigin: CLIENT_ORIGIN });

  // Claiming with a mutated nonce must not match, and there is no API that
  // enumerates pending logins.
  const mutated = `${ticket.slice(0, -1)}${ticket.endsWith('A') ? 'B' : 'A'}`;
  assert.equal(consumeOAuthHandoff(mutated, { origin: CLIENT_ORIGIN }), null);
  assert.deepEqual(consumeOAuthHandoff(ticket, { origin: CLIENT_ORIGIN }), { provider: 'google', user: USER, error: null });
});
