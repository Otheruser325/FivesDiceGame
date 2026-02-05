let OnlineSocket = null;
let _serverUrl = null;
let _probing = false;
let _connectionRetries = 0;
let _maintenanceMode = false;
let _lastConnectionId = null;
let _serverResetDetected = false;
let isAuthenticated = false;

// Set to 'development' to connect to localhost, otherwise defaults to production server
const MODE = 'production'; // Change to 'production' for production deployment

const DEFAULT_PORTS = [8080, 8081, 8082, 8083, 8084, 8085];

// Production server URLs - supports both Vercel deployment and custom domain
const PRODUCTION_SERVERS = [
  'https://api.protodice.net',     // Primary: Custom domain API
  'https://protodice.vercel.app'        // Fallback: Vercel deployment
];

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

  // Default based on MODE: production connects to api.protodice.net, development to localhost
  if (MODE === 'development') {
    const proto = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') ? 'https' : 'http';
    _serverUrl = `${proto}://localhost:8080`;
  } else {
    // production: use custom domain API server (with Vercel fallback)
    _serverUrl = PRODUCTION_SERVERS[0];
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
    const isTransportError = errMsg.includes('transport error') || errMsg.includes('xhr poll error');
    
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
      console.info('[Socket] Transport error (normal on Vercel), reconnecting...', {
        retries: _connectionRetries + 1,
        note: 'Polling transport retry'
      });
    } else {
      console.warn('[Socket] connect_error:', errMsg);
    }
    
    _connectionRetries++;
    
    // Only log non-session errors as warnings
    if (!isSessionError && !isTransportError) {
      console.info('[Socket] reconnect attempt', _connectionRetries, 'of', MAX_CONNECTION_RETRIES);
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
        // set new server and reconnect
        _serverUrl = _norm(c);
        if (OnlineSocket) {
          try { OnlineSocket.close(); } catch (e) {}
          OnlineSocket = null;
        }
        
        // Determine transports based on server
        const isVercel = c.includes('vercel.app');
        const transports = isVercel ? ['polling'] : ['websocket', 'polling'];
        
        // create new socket to discovered server (sync) with optimized config
        // eslint-disable-next-line no-undef
        OnlineSocket = io(_serverUrl, { 
          autoConnect: true, 
          transports: transports,
          withCredentials: true,
          reconnection: true,
          reconnectionDelay: INITIAL_RECONNECT_DELAY,
          reconnectionDelayMax: MAX_RECONNECT_DELAY,
          reconnectionAttempts: MAX_CONNECTION_RETRIES,
          upgrade: true,
          upgradeTimeout: 10000,
          rememberUpgrade: false,
          pingInterval: 20000,
          pingTimeout: 10000,
          path: '/socket.io/',
          randomizationFactor: 0.5,
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
    upgrade: !isVercel,                      // Don't upgrade on Vercel (WebSocket not supported)
    upgradeTimeout: isVercel ? 1000 : 10000, // Quick timeout on Vercel
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
    // Session management improvements
    forceJSONP: false,                       // Don't use JSONP (modern browsers support CORS)
    timestampRequests: true,                 // Add timestamps to prevent caching issues
    timestampParam: 't',                     // Parameter name for timestamp
    // Additional stability improvements
    autoUnref: false,                        // Keep connection alive in background
    closeOnBeforeunload: true,               // Clean up on page unload
  });

  // attach default handlers
  _attachSocketHandlers(OnlineSocket, server);

  // start background probe (non-blocking). If it finds a better server it will reconnect.
  _backgroundProbeAndReconnect();

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
        if (!user || !user.id) {
            console.warn('[SocketManager] Invalid user data, cannot emit auth-user');
            return;
        }

        const socket = getSocket && typeof getSocket === 'function' ? getSocket() : null;
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
            isAuthenticated = true; // Mark as authenticated
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
}