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
 * Simple file-based session store for production
 * Stores session data as JSON files to avoid MemoryStore memory leaks
 */
class FileSessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.dir = options.dir || SESSION_DIR;
    this.ttl = options.ttl || 86400000; // 24 hours default
  }

  async _getSessionPath(sid) {
    return path.join(this.dir, `${sid}.json`);
  }

  get(sid, callback) {
    this._getSessionPath(sid).then(filepath => {
      fs.readFile(filepath, 'utf8')
        .then(data => {
          const sess = JSON.parse(data);
          // Check if session expired
          if (sess.expires && new Date(sess.expires) < new Date()) {
            this.destroy(sid, callback);
            return callback(null);
          }
          callback(null, sess);
        })
        .catch(err => {
          if (err.code === 'ENOENT') {
            callback(null); // Session not found
          } else {
            console.error('[Session] Error reading session:', err.message);
            callback(err);
          }
        });
    });
  }

  set(sid, sess, callback) {
    this._getSessionPath(sid).then(filepath => {
      const expires = sess.cookie.expires || new Date(Date.now() + this.ttl);
      const sessionData = { ...sess, expires };
      fs.writeFile(filepath, JSON.stringify(sessionData), 'utf8')
        .then(() => callback?.(null))
        .catch(err => {
          console.error('[Session] Error writing session:', err.message);
          callback?.(err);
        });
    });
  }

  destroy(sid, callback) {
    this._getSessionPath(sid).then(filepath => {
      fs.unlink(filepath)
        .then(() => callback?.(null))
        .catch(err => {
          if (err.code === 'ENOENT') {
            callback?.(null); // Already deleted
          } else {
            console.error('[Session] Error deleting session:', err.message);
            callback?.(err);
          }
        });
    });
  }

  clear(callback) {
    fs.readdir(this.dir)
      .then(files => {
        const promises = files
          .filter(f => f.endsWith('.json'))
          .map(f => fs.unlink(path.join(this.dir, f)));
        return Promise.all(promises);
      })
      .then(() => callback?.(null))
      .catch(err => {
        console.error('[Session] Error clearing sessions:', err.message);
        callback?.(err);
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

// MUST come before routers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Use file-based session store to avoid MemoryStore memory leaks in production
const sessionStore = new FileSessionStore({ dir: SESSION_DIR });
console.log('[Session] Using file-based session store at:', SESSION_DIR);

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || "keyboardcat",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,                    // Set to true if using HTTPS
    sameSite: 'lax',
    httpOnly: true,                   // Prevent XSS access
    maxAge: 24 * 60 * 60 * 1000      // 24 hours
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", authRouter);

// Log all requests to Socket.io for debugging
app.use('/socket.io/', (req, res, next) => {
  console.debug('[Socket.io] Incoming request:', {
    method: req.method,
    path: req.path,
    query: req.query,
    transport: req.query.transport
  });
  next();
});

// ===== CRITICAL: Intercept socket.io requests BEFORE static/SPA fallback =====
app.use((req, res, next) => {
  // If requesting socket.io.js from any path, serve it directly
  if (req.path === '/socket.io.js' || req.path === '/FivesDiceGame/socket.io.js') {
    const socketIOPath = path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.min.js');
    
    // Debug: log the path being served
    console.log('[Socket.io] Serving from:', socketIOPath);
    
    return res.type('application/javascript').sendFile(socketIOPath, (err) => {
      if (err) {
        console.error('[Socket.io] Error serving file:', err.message);
        res.status(500).send('Socket.io library not found: ' + err.message);
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
  const health = {
    ok: true,
    ts: Date.now(),
    uptime: process.uptime(),
    environment: MODE === 'development' ? 'development' : 'production',
    socketIO: {
      connected: io.engine.clientsCount || 0,
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

// Socket.io middleware to attach session to each connection
io.use((socket, next) => {
  // Try to get session from the handshake data
  const req = socket.request;
  
  // Wrap session middleware for Socket.io
  const wrappedSession = session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "keyboardcat",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  });

  wrappedSession(req, {}, (err) => {
    if (err) {
      console.warn('[Socket] Session middleware error:', err.message);
      return next(err);
    }
    
    // Attach session to socket for access in handlers
    socket.session = req.session;
    socket.sessionID = req.sessionID;
    
    if (socket.session) {
      console.debug('[Socket] Session attached:', { 
        sid: req.sessionID?.substring(0, 8) + '...', 
        hasUser: !!socket.session.passport?.user 
      });
    }
    
    next();
  });
});

io.on("connection", socket => {
  socketMetrics.totalConnections++;
  socketMetrics.activeConnections++;
  
  const connectionInfo = {
    id: socket.id,
    transport: socket.io.engine.transport.name,
    remoteAddress: socket.request.socket.remoteAddress,
    userAgent: socket.request.headers['user-agent']?.substring(0, 100),
    timestamp: new Date().toISOString()
  };
  
  console.log('[Socket] Connection:', {
    ...connectionInfo,
    activeCount: socketMetrics.activeConnections,
    totalCount: socketMetrics.totalConnections
  });
  
  lobbyManager.registerSocket(socket);
  
  // Track disconnections for diagnostics
  socket.on('disconnect', (reason) => {
    socketMetrics.activeConnections--;
    if (reason === 'transport close' || reason === 'ping timeout' || reason === 'connection closed') {
      socketMetrics.failedConnections++;
      console.warn('[Socket] Disconnection:', { id: socket.id, reason, activeCount: socketMetrics.activeConnections });
    } else {
      console.info('[Socket] Disconnection:', { id: socket.id, reason, activeCount: socketMetrics.activeConnections });
    }
  });
  
  // Expose metrics via socket event for debugging
  socket.on('request-diagnostics', (cb) => {
    cb({
      socket: { id: socket.id, transport: socket.io.engine.transport.name },
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