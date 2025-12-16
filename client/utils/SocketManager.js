let OnlineSocket = null;
let _serverUrl = null;
let _probing = false;

const DEFAULT_PORTS = [8084, 8080, 8081, 8082, 8083, 8085];

function _norm(url) {
  return String(url).replace(/\/+$/, '');
}

export async function probeHealth(timeoutMs = 600) {
  const server = _initialServerCandidate();
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${server.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
    clearTimeout(id);
    return r.ok;
  } catch (e) {
    return false;
  }
}

// Resolve server URL if explicitly set (query param or window var) or cached
function _initialServerCandidate() {
  if (_serverUrl) return _serverUrl;

  try {
    if (typeof window !== 'undefined') {
      const qp = new URLSearchParams(window.location.search);
      const s = qp.get('server');
      if (s) { _serverUrl = _norm(s); return _serverUrl; }
    }
  } catch (e) { /* ignore */ }

  // fallback to reasonable default (same protocol as page)
  const proto = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') ? 'https' : 'http';
  _serverUrl = `${proto}://localhost:8084`;
  return _serverUrl;
}

export function getServerUrl() {
  return _initialServerCandidate();
}

export function connectTo(url) {
  if (!url) return;
  const normalized = _norm(url);
  _serverUrl = normalized;

  // if a socket exists, reconnect to the requested url
  if (OnlineSocket) {
    try { OnlineSocket.close(); } catch (e) { /* ignore */ }
    OnlineSocket = null;
  }
  return getSocket();
}

// Attempt a fast probe by doing fetch(`${origin}/auth/me`) with timeout.
// Returns true if responsive (200 OK / valid JSON) — otherwise false.
async function _probeOrigin(origin, timeoutMs = 900) {
  try {
    const ctr = new AbortController();
    const id = setTimeout(() => ctr.abort(), timeoutMs);
    const resp = await fetch(`${origin.replace(/\/$/, '')}/auth/me`, { credentials: 'include', signal: ctr.signal });
    clearTimeout(id);
    if (!resp || !resp.ok) return false;
    try {
      const j = await resp.json();
      // if server responds with valid json, treat as a working server (OK even if not authenticated)
      return typeof j === 'object';
    } catch (e) {
      // non-json, but 200 — still acceptable
      return resp.status === 200;
    }
  } catch (e) {
    return false;
  }
}

// Build list of candidate origins: hosts x ports
function _buildCandidates() {
  const proto = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') ? 'https' : 'http';
  const hosts = new Set(['localhost', '127.0.0.1']);
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    hosts.add(window.location.hostname);
  }
  const ports = DEFAULT_PORTS.slice();
  // ensure current candidate is first
  const initial = _initialServerCandidate();
  const urlObj = (() => {
    try { return new URL(initial); } catch (e) { return null; }
  })();
  if (urlObj) {
    const initialPort = Number(urlObj.port) || (urlObj.protocol === 'https:' ? 443 : 80);
    if (!ports.includes(initialPort)) ports.unshift(initialPort);
  }
  const out = [];
  for (const host of hosts) {
    for (const p of ports) {
      out.push(`${proto}://${host}:${p}`);
    }
  }
  // de-duplicate preserving order
  return [...new Set(out)];
}

// Attach standard handlers for socket (so reconnections keep behavior)
function _attachSocketHandlers(sock, server) {
  if (!sock) return;
  sock.on('connect', async () => {
    console.info('[Socket] connected to', server, 'id=', sock.id);
    // attempt auth fetch and inform socket of cached session
    try {
      const resp = await fetch(`${server.replace(/\/$/, '')}/auth/me`, { credentials: 'include' });
      const data = await resp.json();
      if (data?.ok && data.user) {
        sock.emit('auth-user', data.user);
        console.info('[Socket] authenticated as', data.user);
      }
    } catch (e) {
      // ignore - server might not have session
    }
  });

  sock.on('connect_error', (err) => {
    console.warn('[Socket] connect_error', err && err.message ? err.message : err);
  });

  sock.on('reconnect_attempt', (n) => {
    console.info('[Socket] reconnect attempt', n);
  });

  sock.on('disconnect', (reason) => {
    console.info('[Socket] disconnected:', reason);
  });
}

// Probe nearby ports in background and reconnect if a better server is found.
// This will set _serverUrl to the discovered origin and re-create OnlineSocket.
async function _backgroundProbeAndReconnect() {
  if (_probing) return;
  _probing = true;

  try {
    const candidates = _buildCandidates();
    // try sequentially (fast-fail) but skip the already-known server if present
    const current = _initialServerCandidate();
    for (const c of candidates) {
      if (!c || c === current) continue;
      const ok = await _probeOrigin(c, 850);
      if (ok) {
        console.info('[SocketManager] discovered server at', c, '— switching');
        // set new server and reconnect
        _serverUrl = _norm(c);
        if (OnlineSocket) {
          try { OnlineSocket.close(); } catch (e) {}
          OnlineSocket = null;
        }
        // create new socket to discovered server (sync)
        // eslint-disable-next-line no-undef
        OnlineSocket = io(_serverUrl, { autoConnect: true, transports: ['websocket','polling'], withCredentials: true });
        _attachSocketHandlers(OnlineSocket, _serverUrl);
        break;
      }
    }
  } catch (e) {
    // ignore probing failures
  } finally {
    _probing = false;
  }
}

// Public API: synchronous getSocket (keeps existing code compatible).
export function getSocket() {
  // if socket.io client missing, return offline stub
  if (typeof io !== 'function') {
    console.warn('⚠ Socket.io client not available — running offline.');
    return {
      connected: false,
      on() {},
      once() {},
      emit() {},
      off() {},
      close() {}
    };
  }

  if (OnlineSocket) return OnlineSocket;

  // initial server to connect to (query string or default)
  const server = _initialServerCandidate();

  // create socket immediately (so callers can use it synchronously)
  // eslint-disable-next-line no-undef
  OnlineSocket = io(server, {
    autoConnect: true,
    transports: ['polling'],
    withCredentials: true,
  });

  // attach default handlers
  _attachSocketHandlers(OnlineSocket, server);

  // start background probe (non-blocking). If it finds a better server it will reconnect.
  _backgroundProbeAndReconnect();

  return OnlineSocket;
}