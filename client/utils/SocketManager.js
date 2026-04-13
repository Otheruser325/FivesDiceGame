let OnlineSocket = null;
let _serverUrl = null;
let _probing = false;
let _connectionRetries = 0;
let _maintenanceMode = false;
let _lastConnectionId = null;
let _serverResetDetected = false;
let isAuthenticated = false;

const SERVER_CACHE_KEY = 'fives_server_url';
const MODE = _detectMode();

const DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 8085];

const RENDER_API_SERVER = 'https://fivesapi.onrender.com';
const LEGACY_VERCEL_API_SERVER = 'https://fivesapi.vercel.app';
const CUSTOM_API_SERVER = 'https://api.fivesdicegame.com';

const MAX_CONNECTION_RETRIES = 8;            // Keep retries finite for faster fallback UX
const INITIAL_RECONNECT_DELAY = 300;          // 300ms initial delay
const MAX_RECONNECT_DELAY = 8000;             // 8s max delay
const CONNECTION_TIMEOUT = 20000;             // 20s timeout for initial connection

function _isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function _detectMode() {
  try {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      return _isLocalHost(window.location.hostname) ? 'development' : 'production';
    }
  } catch (e) { /* ignore */ }
  return 'production';
}

function _norm(url) {
  return String(url).replace(/\/+$/, '');
}

function _getCachedServerUrl() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SERVER_CACHE_KEY);
    return raw ? _norm(raw) : null;
  } catch (e) {
    return null;
  }
}

function _cacheServerUrl(url) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!url) return;
    localStorage.setItem(SERVER_CACHE_KEY, _norm(url));
  } catch (e) {
    // ignore cache errors
  }
}

function _shouldUseCustomApi() {
  try {
    if (typeof window === 'undefined') return false;

    // Manual override for staged rollouts.
    if (window.__FIVES_ENABLE_CUSTOM_API__ === true) return true;

    const qp = new URLSearchParams(window.location.search || '');
    if (qp.get('useCustomApi') === '1') return true;
  } catch (e) {
    // ignore
  }
  return false;
}

function _shouldAllowLegacyVercelFallback() {
  try {
    if (typeof window === 'undefined') return false;

    if (window.__FIVES_ENABLE_LEGACY_VERCEL_FALLBACK__ === true) return true;

    const qp = new URLSearchParams(window.location.search || '');
    return qp.get('legacyVercel') === '1';
  } catch (e) {
    return false;
  }
}

function _getExplicitServerOverride() {
  try {
    if (typeof window === 'undefined') return null;

    const fromWindow = window.__FIVES_API_SERVER__;
    if (typeof fromWindow === 'string' && fromWindow.trim()) {
      return _norm(fromWindow.trim());
    }

    const qp = new URLSearchParams(window.location.search || '');
    const fromQuery = qp.get('server');
    if (fromQuery) {
      return _norm(fromQuery);
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function _getProductionCandidates() {
  const candidates = [RENDER_API_SERVER];
  if (_shouldUseCustomApi()) {
    candidates.unshift(CUSTOM_API_SERVER);
  }
  if (_shouldAllowLegacyVercelFallback()) {
    candidates.push(LEGACY_VERCEL_API_SERVER);
  }

  const normalizedCandidates = [...new Set(candidates.map(_norm))];

  const explicit = _getExplicitServerOverride();
  if (explicit) {
    return [explicit, ...normalizedCandidates.filter(c => c !== explicit)];
  }

  const cached = _getCachedServerUrl();
  if (cached && normalizedCandidates.includes(cached)) {
    return [cached, ...normalizedCandidates.filter(c => c !== cached)];
  }

  return normalizedCandidates;
}

function _buildSocketOptions(server) {
  const isServerlessEndpoint = String(server).includes('vercel.app');
  // Polling-first is more resilient on cold starts; Socket.IO will still upgrade to websocket when available.
  const transports = isServerlessEndpoint ? ['polling'] : ['polling', 'websocket'];
  return {
    autoConnect: true,
    transports,
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: INITIAL_RECONNECT_DELAY,
    reconnectionDelayMax: MAX_RECONNECT_DELAY,
    reconnectionAttempts: MAX_CONNECTION_RETRIES,
    upgrade: !isServerlessEndpoint,
    upgradeTimeout: isServerlessEndpoint ? 1000 : 10000,
    rememberUpgrade: false,
    pingInterval: isServerlessEndpoint ? 10000 : 20000,
    pingTimeout: isServerlessEndpoint ? 20000 : 10000,
    path: '/socket.io',
    query: {},
    randomizationFactor: 0.5,
    timeout: CONNECTION_TIMEOUT,
    connectTimeout: CONNECTION_TIMEOUT,
    forceNew: false,
    forceJSONP: false,
    timestampRequests: true,
    timestampParam: 't',
    autoUnref: false,
    closeOnBeforeunload: true
  };
}

function _createSocket(server) {
  // eslint-disable-next-line no-undef
  return io(server, _buildSocketOptions(server));
}

function _switchServer(target) {
  if (!target) return;
  const normalized = _norm(target);
  if (!normalized) return;
  if (_serverUrl && _norm(_serverUrl) === normalized) return;

  _serverUrl = normalized;
  _cacheServerUrl(normalized);
  _connectionRetries = 0;
  _maintenanceMode = false;

  if (OnlineSocket) {
    try { OnlineSocket.removeAllListeners(); } catch (e) { /* ignore */ }
    try { OnlineSocket.close(); } catch (e) { /* ignore */ }
    OnlineSocket = null;
  }

  getSocket();
}

function _getFailoverTarget(currentServer) {
  const current = _norm(currentServer || _serverUrl || '');
  const candidates = _buildCandidates().map(_norm);
  for (const candidate of candidates) {
    if (candidate && candidate !== current) return candidate;
  }
  return null;
}

async function _probeHealthOrigin(server, timeoutMs = 600) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${_norm(server)}/health`, {
      signal: ctrl.signal,
      credentials: 'include'
    });
    return !!r?.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(id);
  }
}

export async function probeHealth(timeoutMs = 600) {
  const candidates = _buildCandidates();
  const validCandidates = candidates.filter(Boolean);
  if (validCandidates.length === 0) return false;

  const checks = validCandidates.map(async (server) => {
    const healthy = await _probeHealthOrigin(server, timeoutMs);
    return { server, healthy };
  });

  // Resolve as soon as any candidate is healthy.
  try {
    const firstHealthy = await Promise.any(
      checks.map(async (p) => {
        const result = await p;
        if (!result.healthy) throw new Error('unhealthy');
        return result;
      })
    );

    _serverUrl = _norm(firstHealthy.server);
    _cacheServerUrl(_serverUrl);
    return true;
  } catch (e) {
    // No healthy candidates found.
    return false;
  }
}

// Resolve server URL if explicitly set (query param or window var) or cached
function _initialServerCandidate() {
  if (_serverUrl) return _serverUrl;

  const explicit = _getExplicitServerOverride();
  if (explicit) {
    _serverUrl = explicit;
    return _serverUrl;
  }

  // Default based on MODE: production uses candidate list, development uses localhost.
  if (MODE === 'development') {
    const proto = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') ? 'https' : 'http';
    _serverUrl = `${proto}://localhost:8080`;
  } else {
    const prodCandidates = _getProductionCandidates();
    _serverUrl = prodCandidates[0];
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
  _serverResetDetected = false;
  console.info('[Socket] Connection state reset');
}

/**
 * Check if server has reset (connection ID changed)
 */
export function didServerReset() {
  return _serverResetDetected;
}

/**
 * Reset the server reset flag (call after handling the reset)
 */
export function resetServerResetFlag() {
  _serverResetDetected = false;
  console.info('[Socket] Server reset flag cleared');
}

/**
 * Get the last known socket connection ID
 */
export function getLastConnectionId() {
  return _lastConnectionId;
}

export function connectTo(url) {
  if (!url) return;
  const normalized = _norm(url);
  if (_serverUrl && _norm(_serverUrl) === normalized && OnlineSocket) {
    if (OnlineSocket.connected) return OnlineSocket;
    const canReconnect = OnlineSocket.io?.opts?.reconnection !== false;
    if (canReconnect) {
      try { OnlineSocket.connect(); } catch (e) { /* ignore */ }
      return OnlineSocket;
    }
    // stale socket: fall through and recreate
    try { OnlineSocket.close(); } catch (e) { /* ignore */ }
    OnlineSocket = null;
  }
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
    return _getProductionCandidates();
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

  sock.on('auth-success', (payload = {}) => {
    if (!sock.data) sock.data = {};
    sock.data.user = payload.user || null;
    sock.userId = payload.user?.id || null;
    isAuthenticated = !!payload.user?.id;
  });

  sock.on('auth-failed', () => {
    if (!sock.data) sock.data = {};
    sock.data.user = null;
    sock.userId = null;
    isAuthenticated = false;
  });

  sock.on('auth-cleared', () => {
    if (!sock.data) sock.data = {};
    sock.data.user = null;
    sock.userId = null;
    isAuthenticated = false;
  });
  
  sock.on('connect', async () => {
    console.info('[Socket] connected to', server, 'id=', sock.id);
    _connectionRetries = 0;  // Reset retries on successful connection
    _maintenanceMode = false; // Clear maintenance mode flag
    _serverUrl = _norm(server);
    _cacheServerUrl(_serverUrl);
    
    // ✅ FIX: Only treat as reset if we've been connected long enough
    // Normal reconnects always get new socket IDs - that's not a server reset!
    // Only warn if this is the FIRST connection or if we were stable for a while
    if (_lastConnectionId && _lastConnectionId !== sock.id) {
      // Check if we had a stable connection before this disconnect
      const wasConnectedLong = _connectionRetries < 2;  // Only flag if few retries
      if (wasConnectedLong && _serverResetDetected === false) {
        console.warn('[Socket] ⚠️ Server reset detected! Previous id:', _lastConnectionId, 'New id:', sock.id);
        _serverResetDetected = true;
        // Emit event so scenes can handle re-authentication
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('socket-server-reset', { detail: { oldId: _lastConnectionId, newId: sock.id } }));
        }
      } else {
        console.debug('[Socket] New connection ID (normal after reconnect):', _lastConnectionId, '→', sock.id);
      }
    }
    _lastConnectionId = sock.id;
    
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
    const errMsg = err && err.message ? err.message : String(err);
    const isSessionError = errMsg.includes('Session ID unknown') || err?.data?.content?.includes?.('Session ID');
    const isTransportError = errMsg.includes('transport error') || errMsg.includes('xhr poll error') || errMsg.includes('websocket error');
    
    // ⚠️ SUPPRESS: Session errors are NORMAL when clients reconnect with stale sessions
    // The server's new error handler now suppresses HTTP 400 for these, client just reconnects
    if (isSessionError) {
      console.info('[Socket] Session expired, forcing new connection...', {
        retries: _connectionRetries + 1,
        note: 'Creating fresh socket to avoid stale session'
      });
      
      // For session errors, force a completely new connection to get a fresh session
      // This is more aggressive than just forceNew=true as it recreates the entire socket
      setTimeout(() => {
        forceNewConnection();
      }, 100); // Small delay to avoid rapid reconnection loops
    } else if (isTransportError) {
      const activeTransport = sock?.io?.engine?.transport?.name || 'unknown';
      console.info('[Socket] Transport error, reconnecting...', {
        retries: _connectionRetries + 1,
        transport: activeTransport,
        note: 'Socket transport retry'
      });
    } else {
      console.warn('[Socket] connect_error:', errMsg);
    }
    
    _connectionRetries++;
    
    // Only log non-session errors as warnings
    if (!isSessionError && !isTransportError) {
      console.info('[Socket] reconnect attempt', _connectionRetries, 'of', MAX_CONNECTION_RETRIES);
    }

    // Production failover: after a few failed attempts, switch to next configured origin.
    if (_connectionRetries === 2) {
      const fallback = _getFailoverTarget(server);
      if (fallback) {
        console.warn('[Socket] Switching to fallback server:', fallback);
        _switchServer(fallback);
        return;
      }
    }
    
    // If we've exceeded retries, trigger maintenance mode and stop reconnecting
    if (_connectionRetries >= MAX_CONNECTION_RETRIES) {
      console.error('[Socket] Connection timeout after', MAX_CONNECTION_RETRIES, 'retries — server may be down');
      _maintenanceMode = true;
      // Disable further reconnection attempts to prevent infinite loop
      if (sock && sock.io && sock.io.opts) {
        sock.io.opts.reconnection = false;
        console.warn('[Socket] Reconnection disabled to prevent infinite loop');
      }
    }
  });

  sock.on('reconnect_attempt', (n) => {
    console.info('[Socket] reconnect attempt', n);
  });

  sock.on('disconnect', (reason) => {
    console.info('[Socket] disconnected:', reason);
    // Reset authentication state on disconnect
    resetAuthStatus();
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
      
      // ✅ FIX: Don't switch between localhost and 127.0.0.1 (same server!)
      // Normalize to compare properly
      const currentNorm = _norm(current);
      const candidateNorm = _norm(c);
      
      // Check if they point to the same host (ignore localhost vs 127.0.0.1 difference)
      const currentHost = new URL(currentNorm).hostname;
      const candidateHost = new URL(candidateNorm).hostname;
      const sameHost = (currentHost === candidateHost) || 
                       (currentHost === 'localhost' && candidateHost === '127.0.0.1') ||
                       (currentHost === '127.0.0.1' && candidateHost === 'localhost');
      
      if (sameHost) {
        console.debug('[SocketManager] Skipping', c, '(same host as current)');
        continue;  // ✅ Don't switch to same host with different IP
      }
      
      const ok = await _probeOrigin(c, 850);
      if (ok) {
        console.info('[SocketManager] discovered server at', c, '— switching');
        _switchServer(c);
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

  // Determine transports based on endpoint runtime capabilities.
  const isServerlessEndpoint = server.includes('vercel.app');
  
  if (isServerlessEndpoint) {
    console.info('[Socket] Connecting to serverless endpoint (' + server + ') - using polling only');
  }

  // Create socket with endpoint-appropriate transport configuration.
  OnlineSocket = _createSocket(server);

  // attach default handlers
  _attachSocketHandlers(OnlineSocket, server);

  // Background probe is development-only to avoid extra production handshake load.
  if (MODE === 'development') {
    _backgroundProbeAndReconnect();
  }

  return OnlineSocket;
}

// Force reconnection with a fresh session
export function forceReconnect() {
  if (OnlineSocket) {
    console.log('[Socket] Forcing reconnection with fresh session...');
    OnlineSocket.disconnect();
    // Force a completely new connection to avoid session reuse
    OnlineSocket.io.opts.forceNew = true;
    OnlineSocket.connect();
  }
}

// Force complete reconnection with new socket instance (for session errors)
export function forceNewConnection() {
  if (OnlineSocket) {
    console.log('[Socket] Forcing completely new connection (session reset)...');
    // Clean up existing socket
    OnlineSocket.removeAllListeners();
    OnlineSocket.disconnect();
    OnlineSocket = null;
    
    // Reset connection state
    _connectionRetries = 0;
    _maintenanceMode = false;
    
    // Create new socket instance
    getSocket();
  }
}

/**
 * Emit the 'auth-user' event to authenticate the socket.
 * Ensures the event is emitted only once per connected session.
 * @param {Object} user - The user object containing id, name, type, etc.
 * @param {Boolean} force - Force re-authentication even if already authenticated
 */
export function emitAuthUser(user, force = false) {
    try {
        const socket = getSocket && typeof getSocket === 'function' ? getSocket() : null;

        if (!user || !user.id) {
            // Explicit de-auth path: clear local + server socket auth.
            resetAuthStatus();
            if (socket && socket.emit) {
                socket.emit('clear-auth');
                if (socket.data && socket.data.user) {
                  delete socket.data.user;
                }
                socket.userId = null;
            }
            return;
        }

        if (socket && socket.emit) {
            // Check if socket has auth data set by server
            const socketAuthenticated = socket.data?.user?.id ? true : false;
            
            if (isAuthenticated && socketAuthenticated && !force) {
                console.info('[SocketManager] Socket already authenticated, skipping auth-user emission');
                return;
            }

            // Ensure user object has required fields (use name fallback to username if needed)
            const userWithSocket = {
                id: user.id,
                name: user.name || user.username || `Guest${String(user.id).substring(0, 6)}`,
                type: user.type || 'guest',
                email: user.email || null,
                profile: user.profile || null,
                created_at: user.created_at || null,
                updated_at: user.updated_at || null,
                socketId: socket.id || null // Include current socket ID
            };

            console.log('[SocketManager] Emitting auth-user to socket:', userWithSocket, { force, socketAuth: socketAuthenticated });
            socket.emit('auth-user', userWithSocket);
            socket.userId = userWithSocket.id;
        }
    } catch (e) {
        console.error('[SocketManager] Failed to emit auth-user:', e);
    }
}

/**
 * Reset authentication status (e.g., on socket disconnect).
 */
export function resetAuthStatus() {
    isAuthenticated = false;
    if (OnlineSocket?.data) {
      OnlineSocket.data.user = null;
    }
    if (OnlineSocket) {
      OnlineSocket.userId = null;
    }
}
