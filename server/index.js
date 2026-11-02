import './env.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import session from 'express-session';
import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import { authMiddleware, authRouter, passport } from './auth.js';
import LobbyManager from './lobbyManager.js';
import LeaderboardManager from './utils/leaderboardManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// some hosts never set NODE_ENV, which leaves dev session secrets and open CORS on
const HOSTED_ENV_MARKERS = [
  'RENDER',
  'RENDER_SERVICE_ID',
  'FLY_APP_NAME',
  'RAILWAY_ENVIRONMENT',
  'K_SERVICE',
  'DYNO',
  'WEBSITE_SITE_NAME'
];
if (!process.env.NODE_ENV && HOSTED_ENV_MARKERS.some((key) => !!process.env[key])) {
  process.env.NODE_ENV = 'production';
  console.log('[Server] NODE_ENV was unset but a hosting environment was detected; defaulting to production');
}

const IS_SERVERLESS = process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.NOW_REGION;
const SERVER_RUNTIME = IS_SERVERLESS ? 'serverless' : 'persistent';
const DEFAULT_RENDER_API_ORIGIN = 'https://fivesapi.onrender.com';
const REDIS_CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1500);
const REDIS_CONNECT_MAX_RETRIES = Number(process.env.REDIS_CONNECT_MAX_RETRIES || 1);
const DEV_SESSION_SECRET = 'fives-dev-session-secret';

const app = express();
const server = createServer(app);

// Trust reverse proxies in production so secure cookies and client IP work correctly.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Fast health/root responses before any auth/session middleware.
app.get('/health', (req, res) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (process.env.NODE_ENV !== 'production') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  res.json({
    status: 'healthy',
    runtime: SERVER_RUNTIME,
    timestamp: new Date().toISOString(),
    redis: redisClient?.isReady ? 'connected' : 'not connected',
    uptime: process.uptime()
  });
});

if (process.env.NODE_ENV === 'production') {
  app.get('/', (req, res) => {
    res.json({
      service: 'fives-api',
      status: 'ok',
      health: '/health',
      timestamp: new Date().toISOString()
    });
  });
}

// Helper function to get configured origins for CORS and Socket.io
function getConfiguredOrigins() {
  const configured = process.env.CLIENT_ORIGINS
    ? process.env.CLIENT_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : [];

  if (process.env.NODE_ENV === 'production') {
    const defaults = [
      DEFAULT_RENDER_API_ORIGIN,            // Render production API
      'https://play.fivesdicegame.com',    // Main game domain
      'https://fivesdicegame.com',          // Base domain
      'https://www.fivesdicegame.com',      // WWW variant
      'https://api.fivesdicegame.com',      // Custom API domain
      'https://fivesapi.vercel.app',        // Vercel fallback
      'https://fivesdicegame.vercel.app',  // Alternative Vercel domain
      'https://fivesweb.vercel.app',  // Another alternative Vercel domain
      'https://otheruser325.github.io'  // GitHub Pages fallback (for testing only)
    ];

    if (process.env.RENDER_EXTERNAL_URL) {
      defaults.push(process.env.RENDER_EXTERNAL_URL);
    }

    return [...new Set([...defaults, ...configured])];
  }

  return [...new Set([
    'http://localhost:8080',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://localhost:8080',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:3000'
  ].concat(configured))];
}

function normalizeOrigin(origin) {
  if (!origin || typeof origin !== 'string') return null;
  try {
    const parsed = new URL(origin);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch (e) {
    return null;
  }
}

function isAllowedOrigin(origin) {
  // Requests without Origin are usually same-origin or non-browser requests.
  if (!origin) return true;

  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const configured = getConfiguredOrigins()
    .map(normalizeOrigin)
    .filter(Boolean);

  if (configured.includes(normalized)) {
    return true;
  }

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();

    if (hostname === 'fivesdicegame.com' || hostname.endsWith('.fivesdicegame.com')) return true;
  } catch (e) {
    return false;
  }

  return false;
}

function socketCorsOrigin(origin, callback) {
  if (isAllowedOrigin(origin)) {
    callback(null, origin || true);
    return;
  }
  callback(new Error('Origin not allowed by CORS'));
}

const isServerlessSocket = IS_SERVERLESS;

// Socket.IO is tuned differently for serverless runtimes:
// - polling only (no websocket upgrade)
// - shorter ping cycle so polling requests complete promptly
// - lower payload cap and no heavy compression on serverless
const io = new Server(server, {
  cors: {
    origin: socketCorsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  },
  // WebSocket upgrades are not protected by browser CORS enforcement.
  // Reject hostile Origin headers at the Engine.IO handshake as well.
  allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin)),
  path: '/socket.io',
  transports: isServerlessSocket ? ['polling'] : ['websocket', 'polling'],
  upgrade: !isServerlessSocket,
  rememberUpgrade: false,
  pingTimeout: isServerlessSocket ? 20000 : 90000,
  pingInterval: isServerlessSocket ? 10000 : 30000,
  connectTimeout: isServerlessSocket ? 20000 : 60000,
  maxHttpBufferSize: 1e6,
  allowEIO3: true,
  httpCompression: !isServerlessSocket,
  perMessageDeflate: !isServerlessSocket,
  serveClient: false
});

// Initialize LobbyManager
const lobbyManager = new LobbyManager(io);

// Redis client for session storage (if available)
let redisClient = null;
let sessionStore = null;

async function initializeRedis() {
  // Redis introduces network latency per request and can stall serverless invocations.
  // In serverless mode we use in-memory session storage.
  if (IS_SERVERLESS) {
    console.log('[Session] Serverless mode: skipping Redis session store');
    return false;
  }

  // Skip Redis in development unless explicitly configured
  if (process.env.NODE_ENV === 'development' && !process.env.REDIS_URL) {
    console.log('[Session] Development mode: skipping Redis (not needed)');
    return false;
  }

  if (process.env.REDIS_URL) {
    let connectPromise = null;
    let connectTimeout = null;
    try {
      redisClient = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
          reconnectStrategy: (retries) => {
            if (IS_SERVERLESS) return false;
            if (retries >= REDIS_CONNECT_MAX_RETRIES) {
              return false;
            }
            return Math.min((retries + 1) * 150, 1000);
          }
        }
      });
      
      redisClient.on('error', (err) => {
        const details = err?.message || err?.code || String(err);
        console.warn('[Redis] Connection error:', details);
      });
      
      redisClient.on('connect', () => {
        console.log('[Redis] Connected successfully');
      });
      
      connectPromise = redisClient.connect();
      await Promise.race([
        connectPromise,
        new Promise((_, reject) => {
          connectTimeout = setTimeout(() => {
            reject(new Error(`Redis connect timed out after ${REDIS_CONNECT_TIMEOUT_MS}ms`));
          }, REDIS_CONNECT_TIMEOUT_MS);
        })
      ]);

      if (!redisClient?.isReady) {
        throw new Error('Redis client did not reach ready state');
      }

      sessionStore = new RedisStore({ client: redisClient });
      console.log('[Session] Using Redis for session storage');
      return true;
    } catch (error) {
      const details = error?.message || error?.code || String(error);
      console.warn('[Redis] Failed to connect, using memory store:', details);
      try {
        if (redisClient?.isOpen) {
          await redisClient.disconnect();
        }
      } catch (closeErr) {
        console.warn('[Redis] Cleanup after failed connect:', closeErr?.message || closeErr);
      }
      try {
        if (connectPromise) {
          await connectPromise.catch(() => null);
        }
      } catch (ignored) {
        // ignored - we already fall back to memory store
      }
      redisClient = null;
      return false;
    } finally {
      if (connectTimeout) {
        clearTimeout(connectTimeout);
      }
    }
  }
  
  // No REDIS_URL in production - show warning but continue with memory store
  if (process.env.NODE_ENV === 'production') {
    console.warn('[Redis] No REDIS_URL configured in production - using memory store (not scalable)');
  }
  
  return false;
}

// Initialize session storage
async function initializeSession() {
  const redisAvailable = await initializeRedis();
  const configuredSecret = typeof process.env.SESSION_SECRET === 'string' ? process.env.SESSION_SECRET.trim() : '';
  if (!configuredSecret && process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production');
  }

  const sessionSecret = configuredSecret || DEV_SESSION_SECRET;
  
  const sessionConfig = {
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: !IS_SERVERLESS,
    proxy: process.env.NODE_ENV === 'production',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    },
    name: 'fives.sid'
  };

  // Remove store from config if Redis is not available
  if (!sessionStore) {
    delete sessionConfig.store;
    console.log('[Session] Using memory store (not recommended for production)');
  }

  return session(sessionConfig);
}

// Middleware
// auth payloads are tiny, a big body limit only helps attackers
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Initialize session middleware
const sessionMiddleware = await initializeSession();
app.use(sessionMiddleware);

// Initialize auth middleware (Passport)
authMiddleware(app);

const wrapSocketMiddleware = (middleware) => (socket, next) => middleware(socket.request, {}, next);
io.use(wrapSocketMiddleware(sessionMiddleware));
io.use(wrapSocketMiddleware(passport.initialize()));
io.use(wrapSocketMiddleware(passport.session()));

// Passport regenerates the session during logout. Disconnect every socket
// using the old session, including idle sockets receiving room broadcasts.
app.set('revokeSessionSockets', (sessionId) => {
  if (sessionId) io.in(`session:${sessionId}`).disconnectSockets(true);
});
io.use((socket, next) => {
  if (socket.request.sessionID) socket.join(`session:${socket.request.sessionID}`);
  next();
});

// A socket's handshake user is only a snapshot. Reload the backing session for
// every packet from an authenticated socket so logout, expiry or revocation
// cannot leave an already-open socket authorized.
io.use((socket, next) => {
  const originalUserId = socket.request.user?.id;
  let checks = Promise.resolve();
  socket.use((packet, done) => {
    if (!originalUserId) return done();
    // Socket.IO middleware runs concurrently for separate packets. Serialize
    // session checks so slow store responses cannot reorder game actions.
    checks = checks.then(() => new Promise((resolve) => {
      const session = socket.request.session;
      if (!socket.connected || !session || typeof session.reload !== 'function') {
        if (socket.connected) socket.disconnect(true);
        done(new Error('Session unavailable'));
        return resolve();
      }
      session.reload((err) => {
        const current = socket.request.session;
        const expires = current?.cookie?.expires ? new Date(current.cookie.expires).getTime() : null;
        if (!socket.connected || err || !current?.passport?.user || String(current.passport.user) !== String(originalUserId) ||
            (expires !== null && (!Number.isFinite(expires) || expires <= Date.now()))) {
          if (socket.connected) socket.disconnect(true);
          done(new Error('Session expired'));
        } else {
          done();
        }
        resolve();
      });
    }));
  });
  next();
});

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = isAllowedOrigin(origin);

  if (allowed) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (process.env.NODE_ENV !== 'production') {
      // Development fallback for tools without Origin header.
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    if (!allowed && process.env.NODE_ENV === 'production') {
      res.sendStatus(403);
      return;
    }
    res.sendStatus(200);
    return;
  }

  if (!allowed && process.env.NODE_ENV === 'production' && origin) {
    res.status(403).json({ error: 'Origin not allowed by CORS policy' });
    return;
  }

  next();
});

// Auth routes
app.use('/auth', authRouter);

// throttle public board reads so one client can't force repeated full-table scans
const LEADERBOARD_RATE_WINDOW_MS = 1000;
const LEADERBOARD_MAX_BUCKETS = 2000;
const LEADERBOARD_SORT_OPTIONS = ['total', 'highest', 'combos', 'wins', 'best'];
const leaderboardRateBuckets = new Map();

function leaderboardClientKey(req) {
    // Use the same trusted-proxy policy for Express and Socket.IO handshakes.
    // A socket ID is not a client identity: reconnects would bypass the limit.
    const request = Object.assign(Object.create(app.request), { headers: req.headers, socket: req.socket });
    const address = request.ip || 'unknown';
    return String(address).replace(/^::ffff:/, '');
}

function isLeaderboardRateLimited(req) {
    const now = Date.now();
    const key = leaderboardClientKey(req);
    const lastRequest = leaderboardRateBuckets.get(key);
    if (lastRequest !== undefined && now - lastRequest < LEADERBOARD_RATE_WINDOW_MS) return true;
    if (lastRequest !== undefined) leaderboardRateBuckets.delete(key);

    // In insertion order, the oldest timestamps are first. Never evict an
    // active bucket to make room: deny new identities if the bound is full.
    for (const [oldKey, timestamp] of leaderboardRateBuckets) {
        if (now - timestamp < LEADERBOARD_RATE_WINDOW_MS) break;
        leaderboardRateBuckets.delete(oldKey);
    }
    if (leaderboardRateBuckets.size >= LEADERBOARD_MAX_BUCKETS) return true;
    leaderboardRateBuckets.set(key, now);
    return false;
}

// Leaderboard endpoint
app.get('/leaderboard', async (req, res) => {
    const sortBy = req.query.sortBy || 'total';

    if (!LEADERBOARD_SORT_OPTIONS.includes(sortBy)) {
        return res.status(400).json({ error: 'Invalid sort option' });
    }

    if (isLeaderboardRateLimited(req)) {
        res.setHeader('Retry-After', '1');
        return res.status(429).json({ error: 'Too many leaderboard requests. Please try again shortly.' });
    }

    try {

        console.log(`[Leaderboard HTTP] Fetching top players (sortBy=${sortBy})`);
        const topPlayers = await LeaderboardManager.getTopPlayers(100, sortBy);

        if (!topPlayers || !Array.isArray(topPlayers)) {
            console.warn('[Leaderboard HTTP] No data returned from getTopPlayers');
            return res.status(500).json({ error: 'No leaderboard data available' });
        }

        console.log(`[Leaderboard HTTP] Retrieved ${topPlayers.length} players`);

        // Get requesting player's rank if authenticated via session
        let playerRank = null;
        const userId = req.session?.user?.id;
        if (userId) {
            try {
                playerRank = await LeaderboardManager.getPlayerRank(userId, sortBy);
                console.log(`[Leaderboard HTTP] Player ${userId} rank: ${JSON.stringify(playerRank)}`);
            } catch (rankErr) {
                console.warn(`[Leaderboard HTTP] Failed to get player rank: ${rankErr.message}`);
                // Don't fail entirely, just skip player rank
            }
        }

        res.json({
            topPlayers,
            playerRank,
            sortBy
        });
    } catch (err) {
        console.error('[Leaderboard HTTP] Failed to get leaderboard:', err.message || err);
        // don't leak internal error text
        res.status(500).json({ error: 'Failed to load leaderboard' });
    }
});

// Development: Serve client files for local testing
if (process.env.NODE_ENV !== 'production') {
  // Serve static files from client directory
  app.use(express.static(join(__dirname, '../client')));
  
  // SPA fallback: serve index.html for all non-API routes
  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '../client/index.html'));
  });
  
  // Fallback for client routes (play, lobby, etc.)
  app.get(/^\/(?!auth|health|api).*$/, (req, res) => {
    res.sendFile(join(__dirname, '../client/index.html'));
  });
  
  console.log('[Dev] Client files served from', join(__dirname, '../client'));
}

// ✅ Socket.io connection handling with enhanced stability & diagnostics
io.on('connection', async (socket) => {
  // Initialize connection metadata
  socket.data = socket.data || {};
  socket.data.connected = true;
  socket.data.connectedAt = Date.now();
  socket.data.lastHeartbeat = Date.now();
  
  console.log(`[Socket] Connected: ${socket.id} from ${socket.handshake.address}`);

  // Share Express's trusted-proxy policy for matchmaking rate limits.
  socket.data.diceathonRateKey = leaderboardClientKey(socket.request);
  // Register socket with lobby manager
  await lobbyManager.registerSocket(socket);

  // ✅ Enhanced heartbeat detection
  socket.on('ping', () => {
    socket.data.lastHeartbeat = Date.now();
    socket.emit('pong', { timestamp: Date.now() });
  });

  // ✅ NEW: Leaderboard handler with enhanced error handling
  socket.on('get-leaderboard', async (options) => {
    if (isLeaderboardRateLimited(socket.request)) {
      return socket.emit('leaderboard-error', 'Too many leaderboard requests. Please try again shortly.');
    }

    try {
      const sortBy = options?.sortBy || 'total';
      
      if (!sortBy || !['total', 'highest', 'combos', 'wins', 'best'].includes(sortBy)) {
        console.warn(`[Leaderboard] Invalid sort option: ${sortBy}`);
        return socket.emit('leaderboard-error', 'Invalid sort option');
      }
      
      console.log(`[Leaderboard] Fetching top players (sortBy=${sortBy})`);
      const topPlayers = await LeaderboardManager.getTopPlayers(100, sortBy);
      
      if (!topPlayers || !Array.isArray(topPlayers)) {
        console.warn('[Leaderboard] No data returned from getTopPlayers');
        return socket.emit('leaderboard-error', 'No leaderboard data available');
      }
      
      console.log(`[Leaderboard] Retrieved ${topPlayers.length} players`);
      
      // Get requesting player's rank if authenticated
      let playerRank = null;
      const userId = socket.data?.user?.id || socket.userId;
      if (userId) {
        try {
          playerRank = await LeaderboardManager.getPlayerRank(userId, sortBy);
          console.log(`[Leaderboard] Player ${userId} rank: ${JSON.stringify(playerRank)}`);
        } catch (rankErr) {
          console.warn(`[Leaderboard] Failed to get player rank: ${rankErr.message}`);
          // Don't fail entirely, just skip player rank
        }
      }

      socket.emit('leaderboard-data', {
        topPlayers,
        playerRank,
        sortBy
      });
    } catch (err) {
      console.error('[Leaderboard] Failed to get leaderboard:', err.message || err);
      console.error('[Leaderboard] Stack:', err.stack);
      socket.emit('leaderboard-error', 'Failed to load leaderboard');
    }
  });

  socket.on('error', (error) => {
    console.error(`[Socket] Error on ${socket.id}: ${error.message || error}`);
  });

  socket.on('disconnect', (reason) => {
    socket.data.connected = false;
    const connectionDuration = Date.now() - (socket.data.connectedAt || Date.now());
    const timeSinceHeartbeat = Date.now() - socket.data.lastHeartbeat;
    
    console.log(
      `[Socket] Disconnected: ${socket.id} ` +
      `(reason: ${reason}, ` +
      `duration: ${connectionDuration}ms, ` +
      `inactive for: ${timeSinceHeartbeat}ms, ` +
      `user: ${socket.data.user?.name || 'none'})`
    );
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  const status = Number(error?.status || error?.statusCode) || 500;

  // bad request bodies are 4xx, not 500
  if (status >= 400 && status < 500) {
    console.warn(`[Server] Rejected request with ${status}:`, error?.type || error?.message);
    return res.status(status).json({
      error: status === 413 ? 'Payload too large' : 'Bad request'
    });
  }

  console.error('[Server] Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown (non-serverless only)
if (!IS_SERVERLESS) {
  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down gracefully');
    server.close(() => {
      if (redisClient) {
        redisClient.quit();
      }
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('[Server] SIGINT received, shutting down gracefully');
    server.close(() => {
      if (redisClient) {
        redisClient.quit();
      }
      process.exit(0);
    });
  });
}

// Start server
const PORT = process.env.PORT || 8080;
if (!IS_SERVERLESS) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('[Server] Fives Dice Game Server running on port ' + PORT);
    console.log('[Server] Environment: ' + (process.env.NODE_ENV || 'development'));
    console.log('[Server] Runtime: ' + SERVER_RUNTIME);
    console.log('[Server] Socket.io transports: ' + io.engine.opts.transports.join(', '));
    console.log('[Server] Health check: http://localhost:' + PORT + '/health');
  });
} else {
  console.log('[Server] Runtime: ' + SERVER_RUNTIME + ' (request-handler mode)');
}

export { app, server, io };
export default app;
