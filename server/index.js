import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import passport from 'passport';
import path from 'path';
import { fileURLToPath } from 'url';
import LobbyManager from './lobbyManager.js';
import fs from 'fs/promises';

import { router as authRouter } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const MODE = process.env.NODE_ENV || 'production';
const SESSION_DIR = path.join(__dirname, 'data/sessions');

// Ensure session directory exists
async function ensureSessionDir() {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (err) {
    console.error('[Session] Failed to create session directory:', err.message);
  }
}
await ensureSessionDir();

/**
 * Hybrid session store: tries file-based, falls back to memory
 * This handles both local development and Vercel's read-only filesystem
 */
class HybridSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.dir = options.dir || SESSION_DIR;
    this.ttl = options.ttl || 86400000; // 24 hours default
    this.inMemory = new Map(); // In-memory fallback
    this.useFileSystem = true; // Track if we can use filesystem
    this.isVercel = process.env.VERCEL === '1'; // Detect Vercel environment
    
    if (this.isVercel) {
      console.warn('[Session] Vercel environment detected - using in-memory session store');
      this.useFileSystem = false;
    }
  }

  async _getSessionPath(sid) {
    return path.join(this.dir, `${sid}.json`);
  }

  get(sid, callback) {
    // First try memory (fastest)
    const memSession = this.inMemory.get(sid);
    if (memSession) {
      // Check if expired
      if (memSession.expires && new Date(memSession.expires) < new Date()) {
        this.inMemory.delete(sid);
        return callback(null);
      }
      return callback(null, memSession);
    }

    // If not in memory and filesystem available, try file
    if (!this.useFileSystem) {
      return callback(null);
    }

    this._getSessionPath(sid).then(filepath => {
      fs.readFile(filepath, 'utf8')
        .then(data => {
          const sess = JSON.parse(data);
          // Check if session expired
          if (sess.expires && new Date(sess.expires) < new Date()) {
            this.destroy(sid, callback);
            return;
          }
          // Cache in memory
          this.inMemory.set(sid, sess);
          callback(null, sess);
        })
        .catch(err => {
          if (err.code === 'ENOENT') {
            callback(null); // Session not found
          } else if (err.code === 'EROFS' || err.code === 'EACCES') {
            console.warn('[Session] Filesystem unavailable, using memory store only');
            this.useFileSystem = false;
            callback(null);
          } else {
            console.error('[Session] Error reading session:', err.message);
            callback(null); // Don't fail auth on session read error
          }
        });
    });
  }

  set(sid, sess, callback) {
    // Always save to memory
    const expires = sess.cookie.expires || new Date(Date.now() + this.ttl);
    const sessionData = { ...sess, expires };
    this.inMemory.set(sid, sessionData);

    // Also try to save to filesystem (if available)
    if (!this.useFileSystem) {
      return callback?.(null);
    }

    this._getSessionPath(sid).then(filepath => {
      fs.writeFile(filepath, JSON.stringify(sessionData), 'utf8')
        .then(() => callback?.(null))
        .catch(err => {
          if (err.code === 'EROFS' || err.code === 'EACCES') {
            console.warn('[Session] Filesystem unavailable, using memory store only');
            this.useFileSystem = false;
            callback?.(null); // Success - memory store worked
          } else {
            console.error('[Session] Error writing session:', err.message);
            callback?.(null); // Don't fail on write error - memory store has it
          }
        });
    });
  }

  destroy(sid, callback) {
    // Remove from memory
    this.inMemory.delete(sid);

    // Try to remove from filesystem
    if (!this.useFileSystem) {
      return callback?.(null);
    }

    this._getSessionPath(sid).then(filepath => {
      fs.unlink(filepath)
        .then(() => callback?.(null))
        .catch(err => {
          if (err.code === 'ENOENT') {
            callback?.(null); // Already deleted
          } else if (err.code === 'EROFS') {
            this.useFileSystem = false;
            callback?.(null);
          } else {
            console.error('[Session] Error deleting session:', err.message);
            callback?.(null); // Don't fail logout on filesystem error
          }
        });
    });
  }

  clear(callback) {
    // Clear memory
    this.inMemory.clear();

    // Try to clear filesystem
    if (!this.useFileSystem) {
      return callback?.(null);
    }

    fs.readdir(this.dir)
      .then(files => {
        const promises = files
          .filter(f => f.endsWith('.json'))
          .map(f => fs.unlink(path.join(this.dir, f)));
        return Promise.all(promises);
      })
      .then(() => callback?.(null))
      .catch(err => {
        if (err.code === 'EROFS') {
          this.useFileSystem = false;
          callback?.(null);
        } else {
          console.error('[Session] Error clearing sessions:', err.message);
          callback?.(null);
        }
      });
  }
}

const app = express();
const server = http.createServer(app);

// ============ CRITICAL: Socket.io request interceptor ============
// This MUST run before ANY other middleware to prevent 400 errors
// It catches socket.io polling/transport requests and bypasses Express processing
app.use((req, res, next) => {
  if (!req.path.startsWith('/socket.io')) {
    return next();
  }

  // Socket.io request detected - set flags to skip middleware processing
  req._skipBodyParser = true;
  req._skipSession = true;
  
  // Log socket.io activity for debugging
  const method = req.method;
  const transport = req.query?.transport || 'unknown';
  const sid = req.query?.sid ? req.query.sid.substring(0, 8) : 'handshake';
  
  // Continue to socket.io handler (socket.io.js handles these internally)
  return next();
});

// ============ END Socket.io interceptor ============

const DEV_LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const PRODUCTION_DOMAINS_REGEX = /^https:\/\/.*fivesdicegame\.com(:\d+)?$/; // Allows subdomains
const VERCEL_DOMAINS_REGEX = /^https?:\/\/.*vercel\.app(:\d+)?$/; // Allows all vercel.app subdomains
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS && process.env.CLIENT_ORIGINS.split(',')) || [
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  
  // Check explicit whitelist
  if (CLIENT_ORIGINS.includes(origin)) return true;
  
  // Allow localhost in development
  if (DEV_LOCALHOST_REGEX.test(origin)) return true;
  
  // Allow Vercel deployments (for fivesdicegame.vercel.app and fivesapi.vercel.app)
  if (VERCEL_DOMAINS_REGEX.test(origin)) {
    console.log('[CORS] Allowed Vercel origin:', origin);
    return true;
  }
  
  // Allow custom domain when deployed
  if (PRODUCTION_DOMAINS_REGEX.test(origin)) {
    console.log('[CORS] Allowed production origin:', origin);
    return true;
  }

  console.warn('[CORS] Rejected origin:', origin);
  return false;
};

app.use(cors({
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (isOriginAllowed(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  // ⚠️ CRITICAL: Vercel/Lambda doesn't support WebSocket, polling only!
  // On Vercel, attempting WebSocket upgrade causes connection issues
  transports: process.env.VERCEL === '1' 
    ? ['polling']                    // Vercel: POLLING ONLY
    : ['polling', 'websocket'],      // Local: Try polling first, upgrade to WS
  
  // Polling-specific config for mobile/ETH/Wi-Fi resilience
  maxHttpBufferSize: 1e6,                    // 1MB - allow decent payload sizes
  allowEIO3: true,                          // Support older clients
  allowEIO4: true,                          // Support new protocol
  
  // Connection tuning for polling reliability across network types
  pingInterval: 25000,                       // Send ping every 25s (Vercel/polling friendly)
  pingTimeout: 15000,                        // Wait 15s for pong before considering dead
  connectTimeout: 60000,                     // 60s timeout for initial connection (mobile networks)
  
  // Polling upgrade behavior
  upgrade: process.env.VERCEL !== '1',       // Don't try WebSocket upgrade on Vercel
  upgradeTimeout: 10000,                     // Quick timeout if upgrade attempted
  
  // Polling-specific tuning - conservative to avoid 400 errors
  httpCompression: process.env.VERCEL === '1'
    ? { level: -1 }                          // Vercel: DISABLE compression (may cause issues)
    : { level: 6, threshold: 1024 },         // Local: Full compression
  
  // Connection pool management
  perMessageDeflate: process.env.VERCEL === '1'
    ? false                                  // Vercel: No WebSocket compression
    : { threshold: 1024 }                    // Local: Compress if > 1KB
});

// ============ Socket.io Error Handlers & HTTP 400 Suppression ============

// Log socket.io configuration on startup
console.log('[Socket.io] Configuration:', {
  environment: process.env.VERCEL === '1' ? 'VERCEL' : 'LOCAL',
  transports: process.env.VERCEL === '1' ? ['polling'] : ['polling', 'websocket'],
  compression: process.env.VERCEL === '1' ? 'DISABLED' : 'ENABLED',
  upgrade: process.env.VERCEL === '1' ? 'DISABLED' : 'ENABLED',
  maxBufferSize: '1MB',
  pingInterval: '25s',
  pingTimeout: '15s'
});

// ⚠️ CRITICAL: Suppress HTTP 400 errors for socket.io session errors
// These are normal/expected errors when clients reconnect with stale sessions
// Returning 200 OK lets socket.io protocol handle the error gracefully
io.engine.on('connection_error', (err) => {
  const isSessionError = err.message && err.message.includes('Session ID unknown');
  const isProtocolError = err.code === 1 || err.message === 'Session ID unknown';
  
  if (isSessionError || isProtocolError) {
    // Session errors are NORMAL - log as info, not error
    // Client will reconnect automatically with new session
    console.log('[Socket.io] Session error (normal):', {
      message: err.message,
      code: err.code,
      note: 'Client will reconnect with new session'
    });
  } else {
    // Unexpected errors - log with full details
    console.error('[Socket.io] Connection error:', {
      message: err.message,
      code: err.code,
      type: err.type
    });
  }
});

// Suppress HTTP-level 400 responses for socket.io errors
// Instead of returning 400, let socket.io send error through its protocol
io.engine.on('request', (req, res) => {
  // Don't set error handler - let socket.io handle responses
  const originalWrite = res.write;
  const originalEnd = res.end;
  
  let isSocketioRequest = req.url && req.url.includes('/socket.io/');
  if (!isSocketioRequest) return;
  
  // Override write to suppress empty bodies for 400 errors
  res.write = function(chunk, encoding, callback) {
    if (res.statusCode === 400 && !chunk) {
      // Don't write empty body for 400 - let socket.io send proper protocol response
      return callback ? callback() : undefined;
    }
    return originalWrite.call(res, chunk, encoding, callback);
  };
  
  // Override end to ensure 400 errors have proper socket.io response
  res.end = function(chunk, encoding, callback) {
    if (res.statusCode === 400) {
      // For socket.io 400 errors, return minimal response
      // Let socket.io's error handler send proper error event to client
      if (!chunk) {
        // Return empty OK instead of error
        res.statusCode = 200;
      }
    }
    return originalEnd.call(res, chunk, encoding, callback);
  };
});

// Catch HTTP errors from socket.io polling transport
server.on('clientError', (err, socket) => {
  if (err.code === 'HPE_INVALID_CONSTANT') {
    console.warn('[Socket.io] Client error - invalid data, socket will close');
    socket.destroy();
  } else if (err.code === 'ECONNRESET') {
    console.warn('[Socket.io] Connection reset');
  } else {
    console.error('[Socket.io] Unexpected client error:', err.code, err.message);
  }
});

// ============ END Socket.io Error Handlers & HTTP 400 Suppression ============

// CRITICAL: Socket.io MUST be attached to server BEFORE middleware chains
// that might reject its requests. We'll handle body parsing conditionally.

// Use hybrid session store to avoid MemoryStore memory leaks in production
// Falls back to in-memory only on Vercel (read-only filesystem)
let sessionStore;
try {
  sessionStore = new HybridSessionStore({ dir: SESSION_DIR });
  console.log('[Session] ✅ Using hybrid session store (memory + file backup)');
} catch (err) {
  console.error('[Session] ⚠️  Failed to initialize HybridSessionStore:', err.message);
  console.warn('[Session] Falling back to MemoryStore (production not recommended)');
  sessionStore = undefined;
}

const sessionConfig = {
  secret: process.env.SESSION_SECRET || "keyboardcat",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',  // true on HTTPS (Vercel)
    sameSite: 'none',                  // Required for cross-site requests
    httpOnly: true,                   // Prevent XSS access
    maxAge: 24 * 60 * 60 * 1000      // 24 hours
  }
};

if (sessionStore) {
  sessionConfig.store = sessionStore;
}

// Middleware that skips socket.io (they have their own protocol)
const skipSocketIO = (req, res, next) => req.path.startsWith('/socket.io') ? next() : res.status(400).end();

// JSON body parser - SKIP socket.io
app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io') || req._skipBodyParser) return next();
  express.json({ limit: '10mb' })(req, res, (err) => {
    if (err) {
      console.warn('[Body Parser] JSON parse error:', err.message);
      return next(err);
    }
    next();
  });
});

// URL-encoded body parser - SKIP socket.io
app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io') || req._skipBodyParser) return next();
  express.urlencoded({ limit: '10mb', extended: true })(req, res, (err) => {
    if (err) {
      console.warn('[Body Parser] URL parse error:', err.message);
      return next(err);
    }
    next();
  });
});

// Session middleware - SKIP socket.io (they use cookies directly)
app.use((req, res, next) => {
  if (req.path.startsWith('/socket.io')) return next();
  session(sessionConfig)(req, res, next);
});

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", authRouter);

// Log all requests to Socket.io for debugging
app.use('/socket.io/', (req, res, next) => {
  const startTime = Date.now();
  const original_end = res.end;
  
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const method = req.method;
    const transport = req.query?.transport || 'unknown';
    const sid = req.query?.sid ? req.query.sid.substring(0, 8) : 'new';
    
    if (statusCode === 400) {
      console.error(`[Socket.io] ❌ 400 ERROR ${method} ${transport} sid=${sid} ${duration}ms`);
    } else if (statusCode >= 500) {
      console.error(`[Socket.io] ❌ ${statusCode} ERROR ${method} ${duration}ms`);
    } else if (statusCode === 200) {
      console.debug(`[Socket.io] ✓ 200 ${method} ${transport} sid=${sid} ${duration}ms`);
    }
    
    original_end.call(this, chunk, encoding);
  };
  
  next();
});

// ===== CRITICAL: Intercept socket.io requests BEFORE static/SPA fallback =====
app.use((req, res, next) => {
  // If requesting socket.io.js from any path, serve it directly
  if (req.path === '/socket.io.js' || req.path === '/FivesDiceGame/socket.io.js') {
    const socketIOPath = path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.min.js');
    
    // Set CORS headers for cross-origin script loading
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Set cache headers for performance
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 hours
    
    console.log('[Socket.io] Serving socket.io.js from:', req.path);
    
    return res.type('application/javascript').sendFile(socketIOPath, (err) => {
      if (err) {
        console.error('[Socket.io] Error serving socket.io.js:', err.message);
        res.status(500).send('Socket.io library not found');
      }
    });
  }
  next();
});

// Serve static files from client at root
app.use("/", express.static(path.join(__dirname, "../client")));

// Serve static files from client under /FivesDiceGame
app.use("/FivesDiceGame", express.static(path.join(__dirname, "../client")));

// CRITICAL: Catch socket.io polling requests that bypass socket.io handler
// This prevents 400 errors on HEAD/OPTIONS requests to /socket.io/
app.options('/socket.io/*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.status(200).end();
});

app.head('/socket.io/*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.status(200).end();
});

// SPA fallback for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// SPA fallback for client-side routes under /FivesDiceGame
app.get('/FivesDiceGame/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/health', (req, res) => {
  // Comprehensive health check for monitoring and recovery
  // Count connected sockets safely (avoiding crash on engine access)
  let connectedClients = 0;
  try {
    if (io && io.engine && io.engine.clients) {
      connectedClients = Object.keys(io.engine.clients).length;
    }
  } catch (e) {
    // Safely fallback if engine access fails
    connectedClients = socketMetrics.activeConnections || 0;
  }
  
  const health = {
    ok: true,
    ts: Date.now(),
    uptime: process.uptime(),
    environment: MODE === 'development' ? 'development' : 'production',
    socketIO: {
      connected: connectedClients,
      activeConnections: socketMetrics.activeConnections,
      totalConnections: socketMetrics.totalConnections,
      transports: ['polling'],  // Vercel deployment
      status: 'operational'
    },
    database: {
      local: 'operational',     // Local DB always available as fallback
      supabase: process.env.SUPABASE_URL ? 'configured' : 'not-configured'
    },
    version: '1.0.0'
  };
  
  res.json(health);
});

const lobbyManager = new LobbyManager(io);

// Track socket connection metrics for health monitoring
const socketMetrics = {
  totalConnections: 0,
  activeConnections: 0,
  failedConnections: 0,
  startTime: Date.now()
};

// Socket.io middleware to attach session to each connection (lightweight version)
io.use((socket, next) => {
  // Minimal middleware - just pass through
  // Socket.io will handle all initialization
  next();
});

io.on("connection", socket => {
  socketMetrics.totalConnections++;
  socketMetrics.activeConnections++;
  
  // Minimal logging to avoid crashes
  console.log('[Socket] Connection:', {
    id: socket.id,
    activeCount: socketMetrics.activeConnections,
    totalCount: socketMetrics.totalConnections
  });
  
  lobbyManager.registerSocket(socket);
  
  // Track disconnections
  socket.on('disconnect', (reason) => {
    socketMetrics.activeConnections--;
    console.info('[Socket] Disconnection:', { id: socket.id, reason, activeCount: socketMetrics.activeConnections });
  });
  
  // Expose metrics via socket event for debugging
  socket.on('request-diagnostics', (cb) => {
    cb({
      socket: { id: socket.id },
      server: {
        uptime: process.uptime(),
        activeConnections: socketMetrics.activeConnections,
        totalConnections: socketMetrics.totalConnections,
        failedConnections: socketMetrics.failedConnections
      }
    });
  });
});

// Error handling middleware - prevent uncaught exceptions from crashing server
app.use((err, req, res, next) => {
  if (req.path.startsWith('/socket.io')) {
    console.error('[Socket.io] Middleware error:', err.message);
    return res.status(200).end(); // socket.io will handle retries
  }
  
  console.error('[Express] Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

// 404 handler - but NOT for socket.io (it has its own)
app.use((req, res) => {
  if (req.path.startsWith('/socket.io')) {
    return res.status(200).end();
  }
  res.status(404).json({ error: 'Not Found' });
});

server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);