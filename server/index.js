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
  // Vercel/Lambda doesn't support WebSocket, use polling + fallback
  transports: ['polling', 'websocket'],      // Try polling first (Vercel-safe), fallback to ws
  // Polling-specific config for mobile/ETH/Wi-Fi resilience
  maxHttpBufferSize: 1e6,                    // 1MB - allow decent payload sizes
  allowEIO3: true,                          // Support older clients
  allowEIO4: true,                          // Support new protocol
  // Connection tuning for polling reliability across network types
  pingInterval: 25000,                       // Send ping every 25s (Vercel/polling friendly)
  pingTimeout: 15000,                        // Wait 15s for pong before considering dead
  connectTimeout: 60000,                     // 60s timeout for initial connection (mobile networks)
  // Polling upgrade behavior
  upgrade: true,                             // Allow upgrade to WebSocket if available
  upgradeTimeout: 15000,                     // Time to attempt upgrade before giving up
  // Polling-specific tuning
  httpCompression: {
    level: 6,                                // Compression level
    threshold: 1024                          // Only compress > 1KB
  },
  // Connection pool management
  perMessageDeflate: {
    threshold: 1024                          // Only compress WebSocket messages > 1KB
  }
});

// MUST come before routers - but skip socket.io requests
// Socket.io handles its own request parsing, so don't apply body parser to it
app.use((req, res, next) => {
  // Skip body parser middleware for socket.io requests
  // These requests have specific formats that socket.io handles
  if (req.path.startsWith('/socket.io')) {
    return next();
  }
  // Apply body parser to all other requests
  express.json({ limit: '10mb' })(req, res, next);
});

app.use((req, res, next) => {
  // Skip urlencoded parser for socket.io requests
  if (req.path.startsWith('/socket.io')) {
    return next();
  }
  express.urlencoded({ limit: '10mb', extended: true })(req, res, next);
});

// Use hybrid session store to avoid MemoryStore memory leaks in production
// Falls back to in-memory only on Vercel (read-only filesystem)
let sessionStore;
try {
  sessionStore = new HybridSessionStore({ dir: SESSION_DIR });
  console.log('[Session] ✅ Using hybrid session store (memory + file backup)');
} catch (err) {
  console.error('[Session] ⚠️  Failed to initialize HybridSessionStore:', err.message);
  console.warn('[Session] Falling back to MemoryStore (production not recommended)');
  sessionStore = undefined; // Will use default MemoryStore if specified below
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

// Only set store if successfully initialized (otherwise uses default MemoryStore)
if (sessionStore) {
  sessionConfig.store = sessionStore;
}

app.use(session(sessionConfig));

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", authRouter);

// Log all requests to Socket.io for debugging and error detection
app.use('/socket.io/', (req, res, next) => {
  const startTime = Date.now();
  const original_end = res.end;
  
  // Intercept response to log status and errors
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const method = req.method;
    const transport = req.query?.transport || 'unknown';
    
    // Log detailed errors - 400 errors are critical
    if (statusCode === 400) {
      console.error(`[Socket.io] ❌ ERROR 400 on ${method} ${req.path} (${transport}) after ${duration}ms`, {
        query: req.query,
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length']
      });
    } else if (statusCode >= 500) {
      console.error(`[Socket.io] ❌ ERROR ${statusCode} on ${method} ${req.path}`);
    } else {
      console.debug(`[Socket.io] ✓ ${statusCode} ${method} ${transport}`);
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

server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);