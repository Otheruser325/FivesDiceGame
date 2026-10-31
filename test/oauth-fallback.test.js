import test from 'node:test';
import assert from 'node:assert/strict';

// The SocketManager module reads window/localStorage when it is imported, so the
// browser globals have to exist first. Everything here runs without a browser:
// fetch and the socket.io client are stubbed.
const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
globalThis.window = {
  location: { hostname: 'play.fivesdicegame.com', origin: 'https://play.fivesdicegame.com', search: '' },
  // Makes the custom API domain the preferred origin, the way production runs.
  __FIVES_ENABLE_CUSTOM_API__: true
};
globalThis.io = () => ({
  connected: false,
  on() {}, once() {}, off() {}, emit() {}, close() {}, connect() {}, removeAllListeners() {}
});

const CUSTOM = 'https://api.fivesdicegame.com';
const RENDER = 'https://fivesapi.onrender.com';

let fetchCalls = [];
let respond = async () => new Response('{}', { status: 200 });
globalThis.fetch = (...args) => {
  fetchCalls.push(args);
  return respond(...args);
};

const sm = await import('../client/utils/SocketManager.js');

function useServer(url) {
  sm.switchServer(url);
  assert.equal(sm.getServerUrl(), url);
  fetchCalls = [];
}

test('OAuth handshake stays on the preferred origin while it is healthy', async () => {
  useServer(CUSTOM);
  respond = async (url) => new Response('{}', { status: String(url).includes('/health') ? 200 : 500 });

  const base = await sm.resolveOAuthServerBase(CUSTOM);

  assert.equal(base, CUSTOM);
  assert.equal(fetchCalls.length, 1);
});

test('OAuth handshake moves to Render when the preferred API is unreachable', async () => {
  useServer(CUSTOM);
  respond = async (url) => {
    if (String(url).includes('api.fivesdicegame.com')) throw new TypeError('fetch failed');
    return new Response('{}', { status: 200 });
  };

  const base = await sm.resolveOAuthServerBase(CUSTOM);

  assert.equal(base, RENDER);
});

test('switching the client to Render makes the socket follow the session cookie', async () => {
  useServer(CUSTOM);
  assert.equal(sm.switchServer(RENDER), RENDER);
  assert.equal(sm.getServerUrl(), RENDER);
  assert.equal(storage.get('fives_server_url'), RENDER);
});

test('OAuth handshake does not probe when already on Render', async () => {
  useServer(RENDER);
  respond = async () => new Response('{}', { status: 200 });

  const base = await sm.resolveOAuthServerBase(RENDER);

  assert.equal(base, RENDER);
  assert.equal(fetchCalls.length, 0);
});

test('server fallback retries Render on a network error and follows it', async () => {
  useServer(CUSTOM);
  respond = async (url) => {
    if (String(url).includes('api.fivesdicegame.com')) throw new TypeError('fetch failed');
    return new Response('{"ok":true}', { status: 200 });
  };

  const res = await sm.fetchWithServerFallback('/auth/me', { credentials: 'include' });

  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 2);
  assert.equal(sm.getServerUrl(), RENDER);
});

test('server fallback retries Render on a 5xx', async () => {
  useServer(CUSTOM);
  respond = async (url) => {
    if (String(url).includes('api.fivesdicegame.com')) return new Response('down', { status: 503 });
    return new Response('{"ok":true}', { status: 200 });
  };

  const res = await sm.fetchWithServerFallback('/auth/me', {});

  assert.equal(res.status, 200);
  assert.equal(sm.getServerUrl(), RENDER);
});

test('a 4xx means the API is alive and is returned without switching', async () => {
  useServer(CUSTOM);
  respond = async () => new Response('{"ok":false}', { status: 401 });

  const res = await sm.fetchWithServerFallback('/auth/me', {});

  assert.equal(res.status, 401);
  assert.equal(fetchCalls.length, 1);
  assert.equal(sm.getServerUrl(), CUSTOM);
});

test('untrusted origins cannot be switched to', async () => {
  useServer(CUSTOM);

  sm.switchServer('https://evil.example');

  assert.equal(sm.getServerUrl(), CUSTOM);
});
