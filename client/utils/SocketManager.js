let OnlineSocket = null;
let _serverUrl = null;
let _probing = false;
let _connectionRetries = 0;
let _maintenanceMode = false;

// Set to 'development' to connect to localhost, otherwise defaults to production server
const MODE = 'production'; // Change to 'development' for localhost testing

const DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 8085];
const PRODUCTION_SERVER = 'https://fivesapi.vercel.app';
const MAX_CONNECTION_RETRIES = 15;           // Allow more retries for network resilience
const INITIAL_RECONNECT_DELAY = 300;          // 300ms initial delay
const MAX_RECONNECT_DELAY = 8000;             // 8s max delay
const CONNECTION_TIMEOUT = 15000;             // 15s timeout for initial connection

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

  // Default based on MODE: production connects to fivesapi.vercel.app, development to localhost
  if (MODE === 'development') {
    const proto = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') ? 'https' : 'http';
    _serverUrl = `${proto}://localhost:8080`;
  } else {
    // production: use vercel server
    _serverUrl = PRODUCTION_SERVER;
  }
  return _serverUrl;
}

export function getServerUrl() {
  return _initialServerCandidate();
}

/**
 * Check if the socket is in maintenance mode (failed to connect after retries)
 */
export function isInMaintenanceMode() {
  return _maintenanceMode;
}

/**
 * Get current connection retry count
 */
export function getConnectionRetries() {
  return _connectionRetries;
}

/**
 * Manually reset connection state (useful for recovery attempts)
 */
export function resetConnectionState() {
  _connectionRetries = 0;
  _maintenanceMode = false;
  console.info('[Socket] Connection state reset');
}

export function connectTo(url) {
  if (!url) return;
  const normalized = _norm(url);
  _serverUrl = normalized;
  resetConnectionState();  // Reset state when changing servers

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
  // In production mode, don't probe localhost candidates
  if (MODE !== 'development') {
    return [PRODUCTION_SERVER];
  }

  // Development mode: probe localhost candidates
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
    _connectionRetries = 0;  // Reset retries on successful connection
    _maintenanceMode = false; // Clear maintenance mode flag
    
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
      console.warn('[Socket] auth fetch failed:', e?.message || e);
    }
  });

  sock.on('connect_error', (err) => {
    console.warn('[Socket] connect_error:', err && err.message ? err.message : String(err));
    _connectionRetries++;
    console.info('[Socket] reconnect attempt', _connectionRetries, 'of', MAX_CONNECTION_RETRIES);
    
    // If we've exceeded retries and polling is active, trigger maintenance mode
    if (_connectionRetries > MAX_CONNECTION_RETRIES && sock.io?.engine?.transport?.name === 'polling') {
      console.error('[Socket] Connection timeout after', MAX_CONNECTION_RETRIES, 'retries — server may be down');
      _maintenanceMode = true;
    }
  });

  sock.on('reconnect_attempt', (n) => {
    console.info('[Socket] reconnect attempt', n);
  });

  sock.on('disconnect', (reason) => {
    console.info('[Socket] disconnected:', reason);
    // Don't reset maintenance mode on network blip if it's deliberate
    if (reason === 'io server disconnect' || reason === 'io client namespace disconnect') {
      _maintenanceMode = false;
    }
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
        
        // Determine transports based on server
        const isVercel = c.includes('vercel.app');
        const transports = isVercel ? ['polling'] : ['websocket', 'polling'];
        
        // create new socket to discovered server (sync)
        // eslint-disable-next-line no-undef
        OnlineSocket = io(_serverUrl, { 
          autoConnect: true, 
          transports: transports,
          withCredentials: true,
          reconnection: true,
          reconnectionDelay: 500,
          reconnectionDelayMax: 3000,
          reconnectionAttempts: 10,
          pingInterval: 10000,
          pingTimeout: 5000,
        });
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

  // Determine transports based on server (Vercel doesn't support WebSocket)
  const isVercel = server.includes('vercel.app');
  const transports = isVercel ? ['polling'] : ['websocket', 'polling'];
  
  if (isVercel) {
    console.info('[Socket] Connecting to Vercel (' + server + ') — using polling only');
  }

  // Calculate adaptive reconnection delays based on network conditions
  // Start with shorter delays and gradually back off
  const calculateDelay = (attempt) => {
    return Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(1.5, Math.min(attempt, 6)),
      MAX_RECONNECT_DELAY
    );
  };

  // create socket with optimized config for Vercel polling
  // eslint-disable-next-line no-undef
  OnlineSocket = io(server, {
    autoConnect: true,
    // Vercel doesn't support WebSocket, use polling with fallback
    transports: transports,
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: INITIAL_RECONNECT_DELAY,
    reconnectionDelayMax: MAX_RECONNECT_DELAY,
    reconnectionAttempts: MAX_CONNECTION_RETRIES,
    // Polling-specific tuning for mobile/Ethernet/Wi-Fi resilience
    upgrade: true,                           // Allow upgrade from polling to websocket
    upgradeTimeout: 10000,                   // Time to attempt upgrade
    rememberUpgrade: false,                  // Don't cache transport choice
    // Ping/pong timing (critical for polling stability)
    pingInterval: 20000,                     // Send ping every 20s (polling-friendly)
    pingTimeout: 10000,                      // Wait 10s for pong
    // HTTP polling specific config
    path: '/socket.io/',
    query: {},
    randomizationFactor: 0.5,                // 50% randomization to prevent thundering herd
    // Connection lifecycle
    connectTimeout: CONNECTION_TIMEOUT,      // 15s timeout for initial connection
    forceNew: false,                         // Reuse existing connection if available
  });

  // attach default handlers
  _attachSocketHandlers(OnlineSocket, server);

  // start background probe (non-blocking). If it finds a better server it will reconnect.
  _backgroundProbeAndReconnect();

  return OnlineSocket;
}