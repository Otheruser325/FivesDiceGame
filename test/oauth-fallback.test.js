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
  addEventListener() {}, removeEventListener() {},
  // Makes the custom API domain the preferred origin, the way production runs.
  __FIVES_ENABLE_CUSTOM_API__: true
};
globalThis.Phaser = { Scene: class {} };
let latestSocket;
globalThis.io = () => {
  const handlers = new Map();
  latestSocket = {
    connected: false,
    disconnectCount: 0,
    connectCount: 0,
    sent: [],
    on(event, handler) { handlers.set(event, handler); },
    once() {}, off() {},
    emit(event, value) { this.sent.push([event, value]); },
    close() {}, removeAllListeners() {},
    disconnect() { this.disconnectCount++; this.connected = false; handlers.get('disconnect')?.('io client disconnect'); },
    connect() { this.connectCount++; },
    receive(event, value) { handlers.get(event)?.(value); }
  };
  return latestSocket;
};

const CUSTOM = 'https://api.fivesdicegame.com';
const RENDER = 'https://fivesapi.onrender.com';

let fetchCalls = [];
let respond = async () => new Response('{}', { status: 200 });
globalThis.fetch = (...args) => {
  fetchCalls.push(args);
  return respond(...args);
};

const sm = await import('../client/utils/SocketManager.js');
const { default: OnlineAccountScene } = await import('../client/scenes/OnlineAccountScene.js');

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

test('login refreshes the existing socket handshake and preserves listeners', () => {
  useServer(RENDER);
  const socket = sm.getSocket();
  socket.receive('auth-success', { user: { id: 'old', name: 'Old', type: 'guest' } });
  const oldHandlers = [];
  socket.on('scene-listener', () => oldHandlers.push(true));

  sm.reconnectAfterLogin();

  assert.equal(sm.getSocket(), socket);
  assert.equal(socket.disconnectCount, 1);
  assert.equal(socket.connectCount, 1);
  assert.equal(socket.data.user, null);
  socket.receive('scene-listener');
  assert.deepEqual(oldHandlers, [true]);
});

test('a different signed-in user is not skipped as already authenticated', () => {
  const socket = sm.getSocket();
  socket.receive('auth-success', { user: { id: 'old', name: 'Old', type: 'guest' } });
  socket.sent.length = 0;
  sm.emitAuthUser({ id: 'new', name: 'New', type: 'google' });
  assert.equal(socket.sent[0][0], 'auth-user');
  assert.equal(socket.sent[0][1].id, 'new');
});

test('an old provider session cannot turn a new Discord rate limit into login success', async () => {
  useServer(RENDER);
  const scene = new OnlineAccountScene();
  const alerts = [];
  const originalAlert = globalThis.alert;
  const originalOpen = window.open;
  globalThis.alert = (message) => alerts.push(message);
  window.open = () => ({ closed: false, close() {} });
  scene._createOAuthNonce = () => 'nonce';
  scene._waitForOAuthPopupMessage = async () => { throw new Error('OAuth popup closed before login finished'); };
  scene._waitForOAuthHandoff = async () => {
    const error = new Error('Discord is temporarily rate limiting sign in. Please wait before trying again.');
    error.oauthFailure = true;
    scene.oauthStopped = true;
    throw error;
  };
  let oldSessionChecks = 0;
  scene._waitForOAuthSession = async () => {
    oldSessionChecks++;
    return { id: 'old-discord', name: 'Old', type: 'discord' };
  };
  try {
    await scene.oauthLogin('/auth/discord');
    assert.equal(oldSessionChecks, 0, 'old session was treated as the current OAuth result');
    assert.equal(scene.user, null);
    assert.match(alerts[0], /Discord is temporarily rate limiting/);
  } finally {
    globalThis.alert = originalAlert;
    window.open = originalOpen;
  }
});

test('a late terminal handoff failure is not swallowed during recovery', async () => {
  const scene = new OnlineAccountScene();
  scene.oauthNonce = 'nonce';
  scene._waitForOAuthHandoff = async () => {
    const error = new Error('Discord is temporarily rate limiting sign in.');
    error.oauthFailure = true;
    throw error;
  };
  await assert.rejects(() => scene._recoverOAuthResult(), /Discord is temporarily rate limiting/);
});

test('a confirmed OAuth result refreshes the socket before completing the login', async () => {
  useServer(RENDER);
  const socket = sm.getSocket();
  const initialDisconnects = socket.disconnectCount;
  const scene = new OnlineAccountScene();
  const user = { id: 'new-google', name: 'New Google', type: 'google' };
  const alerts = [];
  const originalAlert = globalThis.alert;
  const originalOpen = window.open;
  globalThis.alert = (message) => alerts.push(message);
  window.open = () => ({ closed: false, close() {} });
  scene._createOAuthNonce = () => 'nonce';
  scene._waitForOAuthPopupMessage = async () => { throw new Error('OAuth popup closed before login finished'); };
  scene._waitForOAuthHandoff = async () => user;
  scene._waitForOAuthSession = async () => user;
  scene.game = { events: { emit() {} } };
  scene.scene = { resume() {}, stop() {} };
  try {
    await scene.oauthLogin('/auth/google');
    assert.equal(socket.disconnectCount, initialDisconnects + 1);
    assert.equal(scene.user.id, user.id);
    assert.match(alerts[0], /Logged in as/);
  } finally {
    globalThis.alert = originalAlert;
    window.open = originalOpen;
  }
});

test('untrusted origins cannot be switched to', async () => {
  useServer(CUSTOM);

  sm.switchServer('https://evil.example');

  assert.equal(sm.getServerUrl(), CUSTOM);
});
