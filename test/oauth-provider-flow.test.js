import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { io as createSocket } from '../server/node_modules/socket.io-client/build/esm-debug/index.js';

// End-to-end regression tests for the Google and Discord OAuth flows. Only the
// provider is fake: the app's real Passport strategies, token exchange, profile
// fetch, session, popup completion page, redirect builder and handoff claim
// endpoint all run unchanged.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const CLIENT_ORIGIN = 'http://127.0.0.1:43210';
const OTHER_LOCAL_ORIGIN = 'http://127.0.0.1:43211';

const children = [];
let appBase;
let prodBase;
let provider;
let providerOrigin;
let dataDir;
let appChild;

const providerState = {
  googleId: 'google-e2e-user',
  discordId: '123456789012345678',
  failTokenFor: null,
  failTokenBody: null,
  failTokenStatus: 403,
  failUserinfoFor: null,
  rateLimitToken: null,
  tokenRequests: [],
  userinfoRequests: [],
  authorizeRequests: []
};

function resetProviderState() {
  providerState.failTokenFor = null;
  providerState.failTokenBody = null;
  providerState.failTokenStatus = 403;
  providerState.failUserinfoFor = null;
  providerState.rateLimitToken = null;
  providerState.tokenRequests.length = 0;
  providerState.userinfoRequests.length = 0;
  providerState.authorizeRequests.length = 0;
}

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function startFakeProvider() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const providerName = url.pathname.startsWith('/discord') ? 'discord' : 'google';
    const sendJson = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.endsWith('/authorize')) {
      const redirectUri = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      providerState.authorizeRequests.push({
        provider: providerName,
        redirectUri,
        state,
        scope: url.searchParams.get('scope')
      });
      if (!redirectUri) return sendJson(400, { error: 'invalid_request' });

      const target = new URL(redirectUri);
      target.searchParams.set('code', `${providerName}-authorization-code`);
      if (state) target.searchParams.set('state', state);
      res.writeHead(302, { Location: target.toString() });
      res.end();
      return;
    }

    if (url.pathname.endsWith('/token') && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      providerState.tokenRequests.push({
        provider: providerName,
        form,
        authorization: req.headers.authorization || null
      });
      if (providerState.rateLimitToken?.provider === providerName && providerState.rateLimitToken.times > 0) {
        providerState.rateLimitToken.times -= 1;
        const retryAfter = providerState.rateLimitToken.retryAfter ?? 0.01;
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
        return res.end(JSON.stringify({ message: 'You are being rate limited.', retry_after: retryAfter, global: false }));
      }
      if (providerState.failTokenFor === providerName) {
        if (providerState.failTokenBody !== null) {
          res.writeHead(providerState.failTokenStatus, { 'Content-Type': 'text/plain' });
          return res.end(providerState.failTokenBody);
        }
        return sendJson(400, {
          error: 'invalid_grant',
          error_description: 'authorization code was already used'
        });
      }
      return sendJson(200, {
        access_token: `${providerName}-access-token`,
        refresh_token: `${providerName}-refresh-token`,
        token_type: 'Bearer',
        expires_in: 3600
      });
    }

    if (url.pathname === '/google/userinfo') {
      providerState.userinfoRequests.push({
        provider: 'google',
        authorization: req.headers.authorization || null,
        // passport-google-oauth20 sends the token as a query parameter rather
        // than a Bearer header.
        accessToken: url.searchParams.get('access_token')
      });
      if (providerState.failUserinfoFor === 'google') {
        return sendJson(500, { error: 'server_error' });
      }
      return sendJson(200, {
        sub: providerState.googleId,
        name: 'Google Tester',
        given_name: 'Google',
        family_name: 'Tester',
        picture: 'https://example.com/google-avatar.png',
        email: 'google-tester@example.com',
        email_verified: true
      });
    }

    if (url.pathname === '/discord/users/@me') {
      providerState.userinfoRequests.push({
        provider: 'discord',
        authorization: req.headers.authorization || null
      });
      if (providerState.failUserinfoFor === 'discord') {
        return sendJson(500, { error: 'server_error' });
      }
      return sendJson(200, {
        id: providerState.discordId,
        username: 'discord_tester',
        avatar: null
      });
    }

    sendJson(404, { error: 'not_found' });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function startApp(port, extraEnv) {
  // The server reads the fallback store during startup, so the file must exist
  // before it is spawned.
  fs.writeFileSync(path.join(dataDir, `users-${port}.json`), JSON.stringify({ users: {} }), 'utf8');

  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'oauth-flow-test-secret',
      PORT: String(port),
      USER_DATA_FILE: path.join(dataDir, `users-${port}.json`),
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      REDIS_URL: '',
      CLIENT_ORIGINS: CLIENT_ORIGIN,
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      DISCORD_CLIENT_ID: 'test-discord-client-id',
      DISCORD_CLIENT_SECRET: 'test-discord-client-secret',
      GOOGLE_CALLBACK_URL: '',
      DISCORD_CALLBACK_URL: '',
      AUTH_SUCCESS_REDIRECT_URL: '',
      GAME_CLIENT_URL: '',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.output = [];
  child.stdout.on('data', (chunk) => child.output.push(String(chunk)));
  child.stderr.on('data', (chunk) => child.output.push(String(chunk)));
  children.push(child);

  return child;
}

async function waitForHealth(base, child) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early:\n${child.output.join('')}`);
    }
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch (e) {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server at ${base} never became healthy:\n${child.output.join('')}`);
}

function cookieFrom(res) {
  const cookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return cookies.map((cookie) => String(cookie).split(';')[0]).join('; ');
}

function payloadOf(html) {
  const match = String(html).match(/var payload = (\{.*?\});/s);
  assert.ok(match, 'completion page did not embed a payload');
  return JSON.parse(match[1]);
}

function newNonce() {
  return crypto.randomBytes(24).toString('base64url');
}

// Node's fetch replaces a supplied Host header; use http.request when a test
// needs to simulate which public API host received the request.
function fetchWithHost(url, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseHeaders = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }));
      });
    });
    req.on('error', reject);
  });
}

async function beginFlow(providerName, options = {}) {
  const {
    mode = 'popup',
    clientPath = '/play/?room=ABC#lobby',
    clientOrigin = CLIENT_ORIGIN,
    startHeaders = {}
  } = options;

  const nonce = newNonce();
  const clientState = `popup.${Buffer.from(JSON.stringify({
    clientOrigin,
    clientPath,
    mode,
    clientNonce: nonce
  }), 'utf8').toString('base64url')}`;

  const startUrl = `${appBase}/auth/${providerName}?state=${encodeURIComponent(clientState)}`;
  const startHeadersWithOrigin = { Origin: clientOrigin, ...startHeaders };
  const start = startHeaders.Host
    ? await fetchWithHost(startUrl, startHeadersWithOrigin)
    : await fetch(startUrl, { redirect: 'manual', headers: startHeadersWithOrigin });
  assert.equal(start.status, 302, 'authorize request did not redirect');

  const cookie = cookieFrom(start);
  assert.ok(cookie.includes('fives.sid='), 'authorize response did not set a session cookie');

  const authorizeLocation = start.headers.get('location');
  assert.ok(authorizeLocation, 'authorize response has no location');
  const authorizeUrl = new URL(authorizeLocation);
  assert.equal(authorizeUrl.origin, providerOrigin, 'authorize request left the configured provider');

  const redirectUri = authorizeUrl.searchParams.get('redirect_uri');
  const providerStateValue = authorizeUrl.searchParams.get('state');
  assert.ok(providerStateValue, 'authorize URL lost the state');
  assert.ok(!providerStateValue.includes(nonce), 'the handoff nonce leaked into the provider');

  return {
    provider: providerName,
    nonce,
    cookie,
    clientState,
    authorizeLocation,
    authorizeUrl,
    redirectUri,
    providerState: providerStateValue,
    mode,
    clientOrigin,
    clientPath
  };
}

async function completeFlow(flow, { deny = false, localCallback = false, callbackHeaders = {} } = {}) {
  let callbackLocation;

  if (deny) {
    const url = new URL(flow.redirectUri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('error_description', 'The user denied access');
    url.searchParams.set('state', flow.providerState);
    callbackLocation = url.toString();
  } else {
    const providerResponse = await fetch(flow.authorizeLocation, { redirect: 'manual' });
    assert.equal(providerResponse.status, 302, 'fake provider did not redirect to the callback');
    callbackLocation = providerResponse.headers.get('location');
    assert.ok(callbackLocation, 'fake provider sent no callback location');
  }

  // For alternate public hosts, send the callback to this same local test app
  // while preserving the exact redirect URI the fake provider saw.
  const target = new URL(callbackLocation);
  const callbackRequestUrl = localCallback ? `${appBase}${target.pathname}${target.search}` : callbackLocation;
  const callbackResponse = await fetch(callbackRequestUrl, {
    redirect: 'manual',
    headers: { Cookie: flow.cookie, ...callbackHeaders }
  });
  const updatedCookie = cookieFrom(callbackResponse);

  return {
    callbackResponse,
    callbackLocation,
    cookie: updatedCookie.includes('fives.sid=') ? updatedCookie : flow.cookie
  };
}

async function claimLogin(nonce, origin = CLIENT_ORIGIN) {
  return fetch(`${appBase}/auth/oauth/claim`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce })
  });
}

async function sessionUser(cookie) {
  const res = await fetch(`${appBase}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  return res.json();
}

before(async () => {
  provider = await startFakeProvider();
  providerOrigin = provider.origin;

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fives-oauth-flow-'));

  const appPort = await freePort();
  const prodPort = await freePort();
  appBase = `http://127.0.0.1:${appPort}`;
  prodBase = `http://127.0.0.1:${prodPort}`;

  const app = startApp(appPort, {
    PUBLIC_SERVER_URL: appBase,
    GOOGLE_AUTHORIZATION_URL: `${providerOrigin}/google/authorize`,
    GOOGLE_TOKEN_URL: `${providerOrigin}/google/token`,
    GOOGLE_USERINFO_URL: `${providerOrigin}/google/userinfo`,
    DISCORD_AUTHORIZATION_URL: `${providerOrigin}/discord/authorize`,
    DISCORD_TOKEN_URL: `${providerOrigin}/discord/token`,
    DISCORD_USERINFO_URL: `${providerOrigin}/discord/users/@me`,
    OAUTH_SESSION_SAVE_TIMEOUT_MS: '1500'
  });

  appChild = app;

  const prodApp = startApp(prodPort, {
    NODE_ENV: 'production',
    SESSION_SECRET: 'oauth-flow-prod-secret',
    PUBLIC_SERVER_URL: 'https://fivesapi.onrender.com',
    GOOGLE_AUTHORIZATION_URL: 'http://127.0.0.1:1/must-not-be-used',
    DISCORD_AUTHORIZATION_URL: 'http://127.0.0.1:1/must-not-be-used'
  });

  await Promise.all([waitForHealth(appBase, app), waitForHealth(prodBase, prodApp)]);
});

after(async () => {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch (e) { /* already gone */ }
  }
  if (provider?.server) {
    await new Promise((resolve) => {
      provider.server.closeAllConnections?.();
      provider.server.close(resolve);
    });
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Google popup: real exchange, completion page, session, and single-use handoff', async () => {
  resetProviderState();

  const flow = await beginFlow('google');
  // Normal polls before the callback do not signal an authentication failure or
  // consume the eventual result.
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = await claimLogin(flow.nonce);
    assert.equal(pending.status, 202);
    assert.equal(pending.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await pending.json(), { ok: false, pending: true });
  }
  const { callbackResponse, cookie } = await completeFlow(flow);

  assert.equal(callbackResponse.status, 200);
  assert.match(callbackResponse.headers.get('content-type') || '', /text\/html/i);
  const html = await callbackResponse.text();
  const payload = payloadOf(html);

  assert.equal(payload.type, 'fives-oauth-success');
  assert.equal(payload.provider, 'google');
  assert.equal(payload.user.type, 'google');
  assert.equal(payload.user.name, 'Google Tester');
  assert.equal(payload.user.avatar, 'https://example.com/google-avatar.png');
  assert.ok(payload.user.id);
  assert.ok(html.includes(`var openerOrigin = "${CLIENT_ORIGIN}"`));
  assert.ok(!html.includes('window.location.replace'), 'popup navigates itself into the game');
  assert.ok(!html.includes('window.opener.location'), 'popup navigates the opener');
  assert.ok(!html.includes('google-access-token'), 'provider token leaked into the page');
  assert.ok(!html.includes('test-google-client-secret'), 'client secret leaked into the page');
  assert.ok(!html.includes('google-tester@example.com'), 'provider email leaked into the page');

  const tokenRequest = providerState.tokenRequests.find((entry) => entry.provider === 'google');
  assert.ok(tokenRequest, 'the server never exchanged the authorization code');
  assert.equal(tokenRequest.form.get('grant_type'), 'authorization_code');
  assert.equal(tokenRequest.form.get('code'), 'google-authorization-code');
  assert.equal(tokenRequest.form.get('redirect_uri'), `${appBase}/auth/google/callback`);
  assert.equal(tokenRequest.form.get('client_id'), 'test-google-client-id');

  const profileRequest = providerState.userinfoRequests.find((entry) => entry.provider === 'google');
  assert.ok(profileRequest, 'the server never fetched the Google profile');
  assert.equal(profileRequest.accessToken, 'google-access-token');

  const me = await sessionUser(cookie);
  assert.equal(me.ok, true);
  assert.equal(me.user.id, payload.user.id);
  assert.equal(me.user.type, 'google');

  // A claim from another origin must not burn the ticket.
  const wrongOrigin = await claimLogin(flow.nonce, OTHER_LOCAL_ORIGIN);
  assert.equal(wrongOrigin.status, 202);
  assert.deepEqual(await wrongOrigin.json(), { ok: false, pending: true });

  const claim = await claimLogin(flow.nonce);
  assert.equal(claim.status, 200);
  const claimed = await claim.json();
  assert.equal(claimed.ok, true);
  assert.equal(claimed.user.id, payload.user.id);
  assert.ok(!('email' in claimed.user), 'claim leaked the provider email');
  assert.ok(!('oauthGoogle' in claimed.user), 'claim leaked the provider account id');

  const spent = await claimLogin(flow.nonce);
  assert.equal(spent.status, 202);
  assert.deepEqual(await spent.json(), { ok: false, pending: true }, 'a ticket was claimable twice');
  assert.equal((await claimLogin(flow.nonce, 'https://evil.example')).status, 403);
});

test('Discord popup: real exchange, stable account on repeat, and claimable handoff', async () => {
  resetProviderState();

  const flow = await beginFlow('discord');
  const { callbackResponse, cookie } = await completeFlow(flow);

  assert.equal(callbackResponse.status, 200);
  const html = await callbackResponse.text();
  const payload = payloadOf(html);

  assert.equal(payload.type, 'fives-oauth-success');
  assert.equal(payload.provider, 'discord');
  assert.equal(payload.user.type, 'discord');
  assert.equal(payload.user.name, 'discord_tester');
  assert.ok(payload.user.id);
  assert.ok(!('avatar' in payload.user), 'null avatar should be omitted');

  const tokenRequest = providerState.tokenRequests.find((entry) => entry.provider === 'discord');
  assert.ok(tokenRequest);
  assert.equal(tokenRequest.form.get('code'), 'discord-authorization-code');
  assert.equal(tokenRequest.form.get('redirect_uri'), `${appBase}/auth/discord/callback`);
  const profileRequest = providerState.userinfoRequests.find((entry) => entry.provider === 'discord');
  assert.ok(profileRequest);
  assert.equal(profileRequest.authorization, 'Bearer discord-access-token');

  const me = await sessionUser(cookie);
  assert.equal(me.ok, true);
  assert.equal(me.user.id, payload.user.id);

  const claim = await claimLogin(flow.nonce);
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).user.id, payload.user.id);

  const second = await beginFlow('discord');
  const secondResult = await completeFlow(second);
  const secondPayload = payloadOf(await secondResult.callbackResponse.text());
  assert.equal(secondPayload.user.id, payload.user.id, 'repeat login created a duplicate account');
  assert.equal((await claimLogin(second.nonce)).status, 200);

  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, `users-${new URL(appBase).port}.json`), 'utf8'));
  const discordUsers = Object.values(stored.users || {}).filter((user) => user.type === 'discord');
  assert.equal(discordUsers.length, 1, 'repeat login persisted more than one Discord user');
});

function providerEnv(base) {
  return {
    PUBLIC_SERVER_URL: base,
    GOOGLE_AUTHORIZATION_URL: `${providerOrigin}/google/authorize`,
    GOOGLE_TOKEN_URL: `${providerOrigin}/google/token`,
    GOOGLE_USERINFO_URL: `${providerOrigin}/google/userinfo`,
    DISCORD_AUTHORIZATION_URL: `${providerOrigin}/discord/authorize`,
    DISCORD_TOKEN_URL: `${providerOrigin}/discord/token`,
    DISCORD_USERINFO_URL: `${providerOrigin}/discord/users/@me`
  };
}

async function startDiscordFlow(base, cookie = '') {
  const nonce = newNonce();
  const clientState = `popup.${Buffer.from(JSON.stringify({
    popup: true,
    clientOrigin: CLIENT_ORIGIN,
    clientPath: '/',
    mode: 'popup',
    clientNonce: nonce
  }), 'utf8').toString('base64url')}`;
  const response = await fetch(`${base}/auth/discord?state=${encodeURIComponent(clientState)}`, {
    redirect: 'manual',
    headers: { Origin: CLIENT_ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }
  });
  return { response, nonce };
}

async function runDiscordFlow(base, cookie = '') {
  const flow = await startDiscordFlow(base, cookie);
  assert.equal(flow.response.status, 302, 'Discord start did not redirect to the provider');
  const startCookie = cookieFrom(flow.response);
  const sessionCookie = startCookie.includes('fives.sid=') ? startCookie : cookie;
  const providerResponse = await fetch(flow.response.headers.get('location'), { redirect: 'manual' });
  const callbackLocation = providerResponse.headers.get('location');
  assert.ok(callbackLocation, 'fake provider sent no callback location');
  const callback = await fetch(callbackLocation, { redirect: 'manual', headers: { Cookie: sessionCookie } });
  const payload = payloadOf(await callback.text());
  const updated = cookieFrom(callback);
  return {
    nonce: flow.nonce,
    payload,
    cookie: updated.includes('fives.sid=') ? updated : sessionCookie
  };
}

async function signInDiscord(base) {
  const flow = await runDiscordFlow(base);
  assert.equal(flow.payload.type, 'fives-oauth-success');
  return { user: flow.payload.user, cookie: flow.cookie };
}

async function claimOn(base, nonce) {
  const res = await fetch(`${base}/auth/oauth/claim`, {
    method: 'POST',
    headers: { Origin: CLIENT_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce })
  });
  assert.equal(res.status, 200);
  return res.json();
}

test('a throttled Discord start reports the account that is already signed in', async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = startApp(port, providerEnv(base));
  await waitForHealth(base, server);

  // The player really signs in once. The retries that follow are what used to
  // be reported as "too many attempts" even though this session was signed in.
  const signedIn = await signInDiscord(base);
  for (let i = 0; i < 19; i += 1) {
    const retry = await startDiscordFlow(base, signedIn.cookie);
    assert.equal(retry.response.status, 302, 'a retry inside the budget was already refused');
  }

  const refused = await startDiscordFlow(base, signedIn.cookie);
  assert.equal(refused.response.status, 200, `expected a completion page, got ${refused.response.status}`);
  const payload = payloadOf(await refused.response.text());
  assert.equal(payload.type, 'fives-oauth-success', 'a signed-in session was reported as a failed attempt');
  assert.equal(payload.user.id, signedIn.user.id);

  const claim = await fetch(`${base}/auth/oauth/claim`, {
    method: 'POST',
    headers: { Origin: CLIENT_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce: refused.nonce })
  });
  assert.equal(claim.status, 200);
  const claimed = await claim.json();
  assert.equal(claimed.ok, true);
  assert.equal(claimed.user.id, signedIn.user.id);
});

test('a throttled popup start is retryable and does not spend another provider budget', async () => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = startApp(port, providerEnv(base));
  await waitForHealth(base, server);

  // The Discord redirect helper is not a sign-in attempt; it must not consume
  // the player's start budget.
  for (let i = 0; i < 5; i += 1) {
    const proxy = await fetch(`${base}/auth/discord/authorize?state=popup`, { redirect: 'manual' });
    assert.equal(proxy.status, 302);
  }

  for (let i = 0; i < 20; i += 1) {
    const start = await startDiscordFlow(base);
    assert.equal(start.response.status, 302, `start ${i + 1} was refused before the budget ran out`);
  }

  const refused = await startDiscordFlow(base);
  assert.equal(refused.response.status, 200);
  const html = await refused.response.text();
  const payload = payloadOf(html);
  assert.equal(payload.type, 'fives-oauth-error');
  assert.equal(payload.retryable, true);
  assert.equal(payload.code, 'rate_limited');

  const claim = await fetch(`${base}/auth/oauth/claim`, {
    method: 'POST',
    headers: { Origin: CLIENT_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce: refused.nonce })
  });
  const claimed = await claim.json();
  assert.equal(claimed.retryable, true);
  assert.equal(claimed.code, 'rate_limited');

  // Each provider has its own budget.
  const google = await fetch(`${base}/auth/google?state=popup`, { redirect: 'manual', headers: { Origin: CLIENT_ORIGIN } });
  assert.equal(google.status, 302, 'a Discord throttle blocked a Google sign-in');
});

test('a rate-limited token exchange is retried instead of failing the login', async () => {
  resetProviderState();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = startApp(port, providerEnv(base));
  await waitForHealth(base, server);

  providerState.rateLimitToken = { provider: 'discord', times: 1, retryAfter: 0.01 };
  try {
    const flow = await runDiscordFlow(base);
    assert.equal(flow.payload.type, 'fives-oauth-success');
    const exchanges = providerState.tokenRequests.filter((request) => request.provider === 'discord');
    assert.equal(exchanges.length, 2, 'the token exchange was not retried after a 429');
  } finally {
    providerState.rateLimitToken = null;
  }
});

test('a provider rate limit does not hide a login this browser already completed', async () => {
  resetProviderState();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = startApp(port, providerEnv(base));
  await waitForHealth(base, server);

  const signedIn = await signInDiscord(base);

  providerState.rateLimitToken = { provider: 'discord', times: 99, retryAfter: 0.01 };
  try {
    const retry = await runDiscordFlow(base, signedIn.cookie);
    assert.equal(retry.payload.type, 'fives-oauth-success', 'the rate limit hid the signed-in session');
    assert.equal(retry.payload.user.id, signedIn.user.id);

    const claim = await claimOn(base, retry.nonce);
    assert.equal(claim.ok, true);
    assert.equal(claim.user.id, signedIn.user.id);

    // A browser with no session must still see the real provider failure.
    const anonymous = await runDiscordFlow(base);
    assert.equal(anonymous.payload.type, 'fives-oauth-error');
    assert.match(anonymous.payload.error, /rate limiting/);
  } finally {
    providerState.rateLimitToken = null;
  }
});

test('a fresh socket handshake picks up a completed Google session and rejects identity spoofing', async () => {
  resetProviderState();
  const flow = await beginFlow('google');
  const socket = createSocket(appBase, {
    transports: ['websocket'],
    extraHeaders: { Cookie: flow.cookie },
    forceNew: true,
    reconnection: false
  });
  const event = (name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
    socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
  });
  try {
    await event('connect');
    // Wait until the server finishes installing lobby handlers.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const completed = await completeFlow(flow);
    const user = payloadOf(await completed.callbackResponse.text()).user;
    assert.ok(user?.id);

    const stale = event('auth-failed');
    socket.emit('auth-user', user);
    assert.equal((await stale).reason, 'session_required');

    // Passport regenerates the session on login; the new handshake must carry
    // the response cookie, just as a browser reconnect does.
    socket.disconnect();
    socket.io.opts.extraHeaders = { Cookie: completed.cookie };
    const ready = event('auth-success');
    socket.connect();
    assert.equal((await ready).user.id, user.id);

    const spoofed = event('auth-failed');
    socket.emit('auth-user', { id: 'someone-else' });
    assert.equal((await spoofed).reason, 'identity_mismatch');
    assert.equal((await claimLogin(flow.nonce)).status, 200);
  } finally {
    socket.close();
  }
});

test('malformed socket payloads do not crash the server and logout revokes existing sockets', async () => {
  const guestResponse = await fetch(`${appBase}/auth/guest/register`, {
    method: 'POST', headers: { Origin: CLIENT_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'sample-password' })
  });
  const guest = await guestResponse.json();
  assert.equal(guest.ok, true);
  const cookie = cookieFrom(guestResponse);
  const socket = createSocket(appBase, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, forceNew: true, reconnection: false });
  const once = (name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
    socket.once(name, value => { clearTimeout(timer); resolve(value); });
  });
  try {
    const auth = once('auth-success');
    assert.equal((await auth).user.id, guest.user.id);
    for (const name of ['player-roll', 'player-end-turn', 'player-timeout', 'team-changed']) socket.emit(name, null);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await fetch(`${appBase}/health`)).status, 200);
    const disconnected = once('disconnect');
    const logout = await fetch(`${appBase}/auth/logout`, { method: 'POST', headers: { Origin: CLIENT_ORIGIN, Cookie: cookie } });
    assert.equal((await logout.json()).ok, true);
    await disconnected;
    assert.equal((await sessionUser(cookie)).ok, false);
    assert.equal(appChild.exitCode, null);
  } finally { socket.close(); }
});

test('six authenticated Socket.IO clients enter one Diceathon game', async (t) => {
  const port = await freePort();
  const matchBase = `http://127.0.0.1:${port}`;
  const matchServer = startApp(port, { PUBLIC_SERVER_URL: matchBase });
  await waitForHealth(matchBase, matchServer);
  const sockets = [];
  const event = (socket, name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 8000);
    socket.once(name, data => { clearTimeout(timer); resolve(data); });
  });
  try {
    for (let i = 0; i < 6; i++) {
      const response = await fetch(`${matchBase}/auth/guest/register`, {
        method: 'POST', headers: { Origin: CLIENT_ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: `password-${i}` })
      });
      assert.equal((await response.json()).ok, true);
      const socket = createSocket(matchBase, { transports: ['websocket'], extraHeaders: { Cookie: cookieFrom(response) }, forceNew: true, reconnection: false });
      sockets.push(socket);
      await event(socket, 'auth-success');
    }
    const status = event(sockets[0], 'diceathon-status');
    sockets[0].emit('diceathon-status');
    if (!(await status).active) return t.skip('Diceathon is outside its scheduled window');
    const matches = sockets.map(socket => event(socket, 'diceathon-matched'));
    const firstTurn = event(sockets[0], 'turn-start');
    sockets.forEach(socket => socket.emit('diceathon-join'));
    const results = await Promise.all(matches);
    assert.equal(new Set(results.map(result => result.code)).size, 1);
    assert.ok(results.every(result => result.config.players === 6 && result.config.eventMode === 'diceathon'));
    assert.equal((await firstTurn).playerIndex, 0);
  } finally { sockets.forEach(socket => socket.close()); }
});

test('production websocket rejects a hostile origin before authentication', async () => {
  const socket = createSocket(prodBase, { transports: ['websocket'], extraHeaders: { Origin: 'https://evil.example' }, forceNew: true, reconnection: false, timeout: 3000 });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for origin rejection')), 5000);
      socket.once('connect', () => { clearTimeout(timer); reject(new Error('Hostile websocket connected')); });
      socket.once('connect_error', () => { clearTimeout(timer); resolve(); });
    });
    assert.equal(socket.connected, false);
  } finally { socket.close(); }
});

test('leaderboard response rate limit is shared across HTTP, socket connections and reconnects', async () => {
  const socket = createSocket(appBase, { transports: ['websocket'], forceNew: true, reconnection: false });
  const once = (name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 5000);
    socket.once(name, value => { clearTimeout(timer); resolve(value); });
  });
  try {
    await once('connect');
    await new Promise(resolve => setTimeout(resolve, 100));
    const first = await fetch(`${appBase}/leaderboard?sortBy=total`);
    assert.equal(first.status, 200);
    const board = await first.json();
    assert.ok(board.topPlayers.length <= 100);
    assert.equal(board.sortBy, 'total');
    const denied = await fetch(`${appBase}/leaderboard?sortBy=wins`);
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('retry-after'), '1');
    const blocked = once('leaderboard-error');
    socket.emit('get-leaderboard', { sortBy: 'total' });
    assert.match(await blocked, /Too many/);
    socket.disconnect();
    const connected = once('connect');
    socket.connect();
    await connected;
    const stillBlocked = once('leaderboard-error');
    socket.emit('get-leaderboard', { sortBy: 'total' });
    assert.match(await stillBlocked, /Too many/);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const resumed = await fetch(`${appBase}/leaderboard?sortBy=total`);
    assert.equal(resumed.status, 200);
    assert.deepEqual((await resumed.json()).topPlayers, board.topPlayers);
  } finally { socket.close(); }
});

test('both providers exchange the exact callback selected at start, even if the callback host differs', async () => {
  for (const providerName of ['google', 'discord']) {
    resetProviderState();
    const flow = await beginFlow(providerName, {
      startHeaders: { Host: 'api.fivesdicegame.com', 'X-Forwarded-Proto': 'https' }
    });
    assert.equal(flow.redirectUri, `https://api.fivesdicegame.com/auth/${providerName}/callback`);
    const { callbackResponse, cookie } = await completeFlow(flow, {
      localCallback: true,
      callbackHeaders: { Host: 'evil.example' }
    });
    assert.equal(payloadOf(await callbackResponse.text()).type, 'fives-oauth-success');
    assert.equal(providerState.tokenRequests.length, 1);
    assert.equal(providerState.tokenRequests[0].form.get('redirect_uri'), flow.redirectUri);
    assert.equal((await sessionUser(cookie)).ok, true);
    assert.equal((await claimLogin(flow.nonce)).status, 200);
  }
});

test('full-page Google flow redirects to the exact tab URL and registers no popup ticket', async () => {
  resetProviderState();

  const flow = await beginFlow('google', {
    mode: 'top',
    clientPath: '/FivesDiceGame/?room=ABC#lobby'
  });
  const { callbackResponse, cookie } = await completeFlow(flow);

  assert.equal(callbackResponse.status, 302);
  const location = callbackResponse.headers.get('location') || '';
  assert.ok(location.startsWith(`${CLIENT_ORIGIN}/FivesDiceGame/?room=ABC&auth=success`), location);
  assert.ok(location.endsWith('#lobby'), location);
  assert.match(location, /provider=google/);
  assert.ok(!location.includes('code='), 'the callback leaked the authorization code');
  assert.ok(!location.includes('access-token'), 'the callback leaked the provider token');

  const me = await sessionUser(cookie);
  assert.equal(me.ok, true);
  const claim = await claimLogin(flow.nonce);
  assert.equal(claim.status, 202);
  assert.deepEqual(await claim.json(), { ok: false, pending: true }, 'a top-level flow left a claimable ticket');
});

test('a provider token failure renders a popup error and publishes a terminal claim', async () => {
  resetProviderState();
  providerState.failTokenFor = 'google';
  const logStart = appChild.output.length;

  const flow = await beginFlow('google');
  const { callbackResponse, cookie } = await completeFlow(flow);

  assert.equal(callbackResponse.status, 200);
  const html = await callbackResponse.text();
  const payload = payloadOf(html);

  assert.equal(payload.type, 'fives-oauth-error');
  assert.equal(payload.provider, 'google');
  assert.match(payload.error, /Google sign in failed/i);
  assert.ok(!html.includes('window.location.replace'), 'error popup navigated into the game');
  assert.ok(!html.includes('invalid_grant'), 'raw provider error leaked into the page');
  assert.ok(!html.includes('authorization code was already used'), 'provider description leaked into the page');

  const me = await sessionUser(cookie);
  assert.equal(me.ok, false, 'a failed exchange must not create a session');

  const claim = await claimLogin(flow.nonce);
  assert.equal(claim.status, 200);
  const body = await claim.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /Google sign in failed/i);
  const spent = await claimLogin(flow.nonce);
  assert.equal(spent.status, 202);
  assert.deepEqual(await spent.json(), { ok: false, pending: true }, 'a failure ticket was claimable twice');

  let log = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    log = appChild.output.slice(logStart).join('');
    if (log.includes('[Google callback] Authentication error:')) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(log, /TokenError/);
  assert.match(log, /oauthCode: 'invalid_grant'/);
  assert.ok(!log.includes('authorization code was already used'), 'provider response leaked into logs');
});

test('Discord token transport errors log safe diagnostics without provider response text', async () => {
  resetProviderState();
  providerState.failTokenFor = 'discord';
  providerState.failTokenBody = 'error code: 1010 PRIVATE_RESPONSE_MARKER';
  const logStart = appChild.output.length;

  const flow = await beginFlow('discord');
  const { callbackResponse } = await completeFlow(flow);
  const html = await callbackResponse.text();
  assert.equal(payloadOf(html).type, 'fives-oauth-error');
  assert.ok(!html.includes('PRIVATE_RESPONSE_MARKER'));
  assert.match((await (await claimLogin(flow.nonce)).json()).error, /Discord sign in failed/i);

  // Child-process output is delivered asynchronously relative to the response.
  let log = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    log = appChild.output.slice(logStart).join('');
    if (log.includes('[Discord callback] Authentication error:')) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(log, /InternalOAuthError/);
  assert.match(log, /httpStatus: 403/);
  assert.match(log, /cloudflareCode: 1010/);
  assert.ok(!log.includes('PRIVATE_RESPONSE_MARKER'), 'provider response leaked into logs');
  assert.ok(!log.includes('discord-authorization-code'), 'authorization code leaked into logs');
  assert.ok(!log.includes('test-discord-client-secret'), 'client secret leaked into logs');
});

test('Discord rate-limited token exchange reports a retryable provider failure', async () => {
  resetProviderState();
  providerState.failTokenFor = 'discord';
  providerState.failTokenStatus = 429;
  providerState.failTokenBody = 'PRIVATE_RATE_LIMIT_RESPONSE';

  const flow = await beginFlow('discord');
  const { callbackResponse, cookie } = await completeFlow(flow);
  const payload = payloadOf(await callbackResponse.text());
  assert.equal(payload.type, 'fives-oauth-error');
  assert.match(payload.error, /Discord is temporarily rate limiting/);
  assert.ok(!payload.error.includes('PRIVATE_RATE_LIMIT_RESPONSE'));
  assert.equal((await sessionUser(cookie)).ok, false);
  // The exchange is retried a bounded number of times, then reported as a
  // temporary provider failure instead of a wrong account.
  assert.equal(providerState.tokenRequests.length, 3, 'rate-limited token exchange was retried the wrong number of times');
  assert.equal(providerState.userinfoRequests.length, 0, 'rate-limited exchange fetched a profile');

  const claim = await claimLogin(flow.nonce);
  assert.equal(claim.status, 200);
  assert.equal((await claim.json()).error, payload.error);
});

test('a cancelled Discord authorization is terminal instead of leaving the tab waiting', async () => {
  resetProviderState();

  const flow = await beginFlow('discord');
  const { callbackResponse, cookie } = await completeFlow(flow, { deny: true });

  assert.equal(callbackResponse.status, 200);
  const payload = payloadOf(await callbackResponse.text());
  assert.equal(payload.type, 'fives-oauth-error');
  assert.equal(payload.provider, 'discord');
  assert.equal(payload.error, 'Discord login failed');
  assert.equal(providerState.tokenRequests.length, 0, 'a denied authorization still attempted a token exchange');

  assert.equal((await sessionUser(cookie)).ok, false);

  const claim = await claimLogin(flow.nonce);
  assert.equal(claim.status, 200);
  const body = await claim.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Discord login failed');
  const spent = await claimLogin(flow.nonce);
  assert.equal(spent.status, 202);
  assert.deepEqual(await spent.json(), { ok: false, pending: true });
});

test('a replayed callback is rejected without consuming the valid handoff', async () => {
  resetProviderState();

  const flow = await beginFlow('google');
  const first = await completeFlow(flow);
  assert.equal(first.callbackResponse.status, 200);
  assert.equal(payloadOf(await first.callbackResponse.text()).type, 'fives-oauth-success');

  const replay = await fetch(first.callbackLocation, {
    redirect: 'manual',
    headers: { Cookie: first.cookie }
  });
  assert.equal(replay.status, 200);
  const replayPayload = payloadOf(await replay.text());
  assert.equal(replayPayload.type, 'fives-oauth-error');
  assert.match(replayPayload.error, /session expired/i);

  const claim = await claimLogin(flow.nonce);
  assert.equal(claim.status, 200, 'the replay consumed the original login');
  assert.equal((await claim.json()).ok, true);
  assert.equal((await sessionUser(first.cookie)).ok, true);
});

test('concurrent claims deliver the login exactly once', async () => {
  resetProviderState();

  const flow = await beginFlow('google');
  const { callbackResponse } = await completeFlow(flow);
  assert.equal(payloadOf(await callbackResponse.text()).type, 'fives-oauth-success');

  const [first, second] = await Promise.all([
    claimLogin(flow.nonce),
    claimLogin(flow.nonce)
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 202]);
  const winner = first.status === 200 ? first : second;
  const loser = first.status === 202 ? first : second;
  assert.equal((await winner.json()).ok, true);
  assert.deepEqual(await loser.json(), { ok: false, pending: true });
});

test('a hostile client origin cannot receive the login or a handoff ticket', async () => {
  resetProviderState();

  const flow = await beginFlow('google', { clientOrigin: 'https://evil.example' });
  const { callbackResponse } = await completeFlow(flow);
  assert.equal(callbackResponse.status, 200);

  const html = await callbackResponse.text();
  const payload = payloadOf(html);
  assert.equal(payload.type, 'fives-oauth-success');
  assert.ok(!html.includes('evil.example'), 'completion page reflected the hostile origin');
  assert.ok(html.includes('var openerOrigin = ""'), 'completion page kept a target for a hostile origin');

  const claim = await claimLogin(flow.nonce);
  assert.equal(claim.status, 202);
  assert.deepEqual(await claim.json(), { ok: false, pending: true }, 'a hostile-start flow left a claimable ticket');
  assert.equal((await claimLogin(flow.nonce, 'https://evil.example')).status, 403);
});

test('production ignores provider endpoint overrides', async () => {
  const google = await fetch(`${prodBase}/auth/google?state=popup`, { redirect: 'manual' });
  assert.equal(google.status, 302);
  const googleLocation = google.headers.get('location') || '';
  assert.match(googleLocation, /^https:\/\/accounts\.google\.com\//);
  assert.ok(!googleLocation.includes('127.0.0.1:1'), googleLocation);

  const discord = await fetch(`${prodBase}/auth/discord?state=popup`, { redirect: 'manual' });
  assert.equal(discord.status, 302);
  const discordLocation = discord.headers.get('location') || '';
  assert.match(discordLocation, /^https:\/\/discord\.com\//);
  assert.ok(!discordLocation.includes('127.0.0.1:1'), discordLocation);
});
