import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const CLIENT_ORIGIN = 'https://fivesdicegame.com';
const RENDER_CALLBACK = 'https://fivesapi.onrender.com';

const children = [];
let dataBackup = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'auth-regression-secret',
      PUBLIC_SERVER_URL: RENDER_CALLBACK,
      PORT: String(port),
      DISCORD_CLIENT_ID: 'test-discord-id',
      DISCORD_CLIENT_SECRET: 'test-discord-secret',
      GOOGLE_CLIENT_ID: 'test-google-id',
      GOOGLE_CLIENT_SECRET: 'test-google-secret',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.resume();
  child.stderr.resume();
  children.push(child);
  return child;
}

async function waitForHealth(base) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server at ${base} never became healthy`);
}

function setCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function locationOf(res) {
  return res.headers.get('location') || '';
}

let base;
let hostileBase;
let pinnedBase;

before(async () => {
  if (fs.existsSync(DATA_DIR)) {
    dataBackup = fs.mkdtempSync(path.join(os.tmpdir(), 'fives-data-'));
    fs.cpSync(DATA_DIR, dataBackup, { recursive: true });
  }

  const port = await freePort();
  const hostilePort = await freePort();
  const pinnedPort = await freePort();
  base = `http://127.0.0.1:${port}`;
  hostileBase = `http://127.0.0.1:${hostilePort}`;
  pinnedBase = `http://127.0.0.1:${pinnedPort}`;

  startServer(port);
  startServer(hostilePort, { AUTH_SUCCESS_REDIRECT_URL: 'https://evil.example/phish' });
  startServer(pinnedPort, { DISCORD_CALLBACK_URL: 'https://api.fivesdicegame.com/auth/discord/callback' });

  await Promise.all([waitForHealth(base), waitForHealth(hostileBase), waitForHealth(pinnedBase)]);
});

after(() => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
  if (dataBackup) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.cpSync(dataBackup, DATA_DIR, { recursive: true });
    fs.rmSync(dataBackup, { recursive: true, force: true });
  }
});

test('OAuth providers are advertised when configured', async () => {
  const res = await fetch(`${base}/auth/methods`, { headers: { Origin: CLIENT_ORIGIN } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { guest: true, google: true, discord: true });
});

test('Google authorize points at the Render callback even when the host is spoofed', async () => {
  const res = await fetch(`${base}/auth/google`, {
    redirect: 'manual',
    headers: {
      Origin: CLIENT_ORIGIN,
      'X-Forwarded-Host': 'evil.example',
      'X-Forwarded-Proto': 'http'
    }
  });

  assert.equal(res.status, 302);
  const location = locationOf(res);
  assert.match(location, /^https:\/\/accounts\.google\.com\//);
  assert.ok(location.includes(`redirect_uri=${encodeURIComponent(`${RENDER_CALLBACK}/auth/google/callback`)}`), location);
  assert.match(location, /[?&]state=popup/);
  assert.ok(!location.includes('evil.example'), location);
});

test('Discord authorize points at the Render callback even when the host is spoofed', async () => {
  const res = await fetch(`${base}/auth/discord`, {
    redirect: 'manual',
    headers: {
      Origin: CLIENT_ORIGIN,
      'X-Forwarded-Host': 'evil.example',
      'X-Forwarded-Proto': 'http'
    }
  });

  assert.equal(res.status, 302);
  const location = locationOf(res);
  assert.match(location, /^https:\/\/discord\.com\/api\/oauth2\/authorize/);
  assert.ok(location.includes(`redirect_uri=${encodeURIComponent(`${RENDER_CALLBACK}/auth/discord/callback`)}`), location);
  assert.ok(!location.includes('evil.example'), location);
});

test('a callback pinned to the unavailable custom API domain defers to Render', async () => {
  const res = await fetch(`${pinnedBase}/auth/discord`, {
    redirect: 'manual',
    headers: { Origin: CLIENT_ORIGIN }
  });

  assert.equal(res.status, 302);
  const location = locationOf(res);
  assert.ok(location.includes(`redirect_uri=${encodeURIComponent(`${RENDER_CALLBACK}/auth/discord/callback`)}`), location);
  assert.ok(!location.includes('api.fivesdicegame.com'), location);
});

test('the Discord authorize proxy never leaves trusted hosts', async () => {
  const res = await fetch(`${base}/auth/discord/authorize?state=popup`, {
    redirect: 'manual',
    headers: { 'X-Forwarded-Host': 'evil.example' }
  });

  assert.equal(res.status, 302);
  assert.equal(locationOf(res), `${RENDER_CALLBACK}/auth/discord?state=popup`);
});

test('the Discord authorize proxy rejects state values it did not mint', async () => {
  const res = await fetch(`${base}/auth/discord/authorize?state=evil`);
  assert.equal(res.status, 400);
});

test('a forged callback state is rejected without leaking the code', async () => {
  const res = await fetch(`${base}/auth/discord/callback?code=stolen-code&state=popup.bm90bWluZQ`, { redirect: 'manual' });

  assert.equal(res.status, 302);
  const location = locationOf(res);
  assert.match(location, /[?&]auth=error/);
  assert.ok(!location.includes('stolen-code'), location);
});

test('guest registration only returns public fields and sets a hardened cookie', async () => {
  const res = await fetch(`${base}/auth/guest/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: CLIENT_ORIGIN,
      'X-Forwarded-Proto': 'https'
    },
    body: JSON.stringify({ password: 'secret123' })
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.user?.id);

  const keys = Object.keys(body.user).sort();
  assert.deepEqual(keys, ['id', 'name', 'type']);
  assert.ok(!JSON.stringify(body).includes('guestpassword'));

  const cookie = setCookies(res).join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=None/i);

  globalThis.__registeredGuest = { name: body.user.name, id: body.user.id, cookie: cookie.split(';')[0] };
});

test('the session survives registration and is cleared by logout', async () => {
  const { cookie, id } = globalThis.__registeredGuest;

  const me = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie, 'X-Forwarded-Proto': 'https' } });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('cache-control'), 'no-store');
  const meBody = await me.json();
  assert.equal(meBody.ok, true);
  assert.equal(meBody.user.id, id);

  const out = await fetch(`${base}/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: CLIENT_ORIGIN, 'X-Forwarded-Proto': 'https' }
  });
  assert.equal((await out.json()).ok, true);

  const after = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie, 'X-Forwarded-Proto': 'https' } });
  assert.equal((await after.json()).ok, false);
});

test('guest login accepts the right password and rejects the wrong one generically', async () => {
  const { name } = globalThis.__registeredGuest;

  const ok = await fetch(`${base}/auth/guest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: CLIENT_ORIGIN },
    body: JSON.stringify({ username: name, password: 'secret123' })
  });
  const okBody = await ok.json();
  assert.equal(okBody.ok, true);
  assert.equal(okBody.user.name, name);

  const bad = await fetch(`${base}/auth/guest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: CLIENT_ORIGIN },
    body: JSON.stringify({ username: name, password: 'wrong-password' })
  });
  const badBody = await bad.json();
  assert.equal(badBody.ok, false);

  // A missing account must produce the same answer as a wrong password,
  // otherwise the error text becomes a username oracle.
  const unknown = await fetch(`${base}/auth/guest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: CLIENT_ORIGIN },
    body: JSON.stringify({ username: 'NoSuchGuest9999', password: 'secret123' })
  });
  const unknownBody = await unknown.json();
  assert.equal(unknownBody.ok, false);
  assert.equal(unknownBody.error, badBody.error);
});

test('cross-origin auth requests are blocked', async () => {
  const res = await fetch(`${base}/auth/me`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('repeated OAuth starts are rate limited', async () => {
  const statuses = [];
  for (let i = 0; i < 24; i += 1) {
    const res = await fetch(`${base}/auth/discord/authorize?state=popup`, { redirect: 'manual' });
    statuses.push(res.status);
  }

  assert.ok(statuses.includes(302), `statuses: ${statuses.join(',')}`);
  assert.ok(statuses.includes(429), `statuses: ${statuses.join(',')}`);
});

test('a mistyped AUTH_SUCCESS_REDIRECT_URL cannot become an open redirect', async () => {
  const res = await fetch(`${hostileBase}/auth/discord/callback?state=popup.bm90bWluZQ`, { redirect: 'manual' });

  assert.equal(res.status, 302);
  const location = locationOf(res);
  assert.ok(!location.includes('evil.example'), location);
  assert.match(location, /^https:\/\/fivesdicegame\.vercel\.app\/?/);
});
