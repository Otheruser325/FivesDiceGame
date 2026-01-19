import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import { authMiddleware, authRouter } from './auth.js';
import LobbyManager from './lobbyManager.js';
import LeaderboardManager from './utils/leaderboardManager.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// Helper function to get allowed origins for CORS and Socket.io
function getAllowedOrigins() {
  // If environment variable is set, use it
  if (process.env.CLIENT_ORIGINS) {
    return process.env.CLIENT_ORIGINS.split(',').map(o => o.trim());
  }

  // Default origins based on environment
  if (process.env.NODE_ENV === 'production') {
    return [
      'https://play.fivesdicegame.com',    // Main game domain
      'https://fivesdicegame.com',          // Base domain
      'https://www.fivesdicegame.com',      // WWW variant
      'https://fivesapi.vercel.app',        // Vercel fallback
      'https://fivesdicegame.vercel.app',  // Alternative Vercel domain
      'https://fivesweb.vercel.app'  // Another alternative Vercel domain
    ];
  }

  // Development origins
  return [
    'http://localhost:8080',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://localhost:8080',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:3000'
  ];
}

// Production-ready socket.io configuration
const io = new Server(server, {
  cors: {
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  },
  transports: ['websocket', 'polling'], // Prioritize WebSocket, fallback to polling
  pingTimeout: 90000, // 90 seconds (increased for network jitter tolerance)
  pingInterval: 30000, // 30 seconds between pings
  connectTimeout: 60000, // 60 seconds to establish connection
  maxHttpBufferSize: 1e8, // 100 MB
  allowEIO3: true, // Support older clients
  compression: true, // Enable compression for production
  upgrade: true, // Allow WebSocket upgrades
  rememberUpgrade: true, // Remember successful upgrades
  addTrailingSlash: false,
  forceNew: false
});

// Initialize LobbyManager
const lobbyManager = new LobbyManager(io);

// Redis client for session storage (if available)
let redisClient = null;
let sessionStore = null;

async function initializeRedis() {
  // Skip Redis in development unless explicitly configured
  if (process.env.NODE_ENV === 'development' && !process.env.REDIS_URL) {
    console.log('[Session] Development mode: skipping Redis (not needed)');
    return false;
  }

  if (process.env.REDIS_URL) {
    try {
      redisClient = createClient({ 
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 500)
        }
      });
      
      redisClient.on('error', (err) => {
        console.warn('[Redis] Connection error:', err.message);
      });
      
      redisClient.on('connect', () => {
        console.log('[Redis] Connected successfully');
      });
      
      await redisClient.connect();
      sessionStore = new RedisStore({ client: redisClient });
      console.log('[Session] Using Redis for session storage');
      return true;
    } catch (error) {
      console.warn('[Redis] Failed to connect, using memory store:', error.message);
      return false;
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
  
  const sessionConfig = {
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'fives-dice-game-secret-key',
    resave: false,
    saveUninitialized: false,
    rolling: true,
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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize session middleware
const sessionMiddleware = await initializeSession();
app.use(sessionMiddleware);

// Initialize auth middleware (Passport)
authMiddleware(app);

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (process.env.NODE_ENV !== 'production') {
    // In development, allow any origin
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    redis: redisClient ? 'connected' : 'not connected',
    uptime: process.uptime()
  });
});

// Auth routes
app.use('/auth', authRouter);

// Leaderboard endpoint
app.get('/leaderboard', async (req, res) => {
    try {
        const sortBy = req.query.sortBy || 'total';

        if (!['total', 'highest', 'combos', 'wins', 'best'].includes(sortBy)) {
            return res.status(400).json({ error: 'Invalid sort option' });
        }

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
        res.status(500).json({ error: `Failed to load leaderboard: ${err.message}` });
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

  // Register socket with lobby manager
  await lobbyManager.registerSocket(socket);

  // ✅ Enhanced heartbeat detection
  socket.on('ping', () => {
    socket.data.lastHeartbeat = Date.now();
    socket.emit('pong', { timestamp: Date.now() });
  });

  // ✅ NEW: Leaderboard handler with enhanced error handling
  socket.on('get-leaderboard', async (options) => {
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
      socket.emit('leaderboard-error', `Failed to load leaderboard: ${err.message}`);
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

// Graceful shutdown
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

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎲 Fives Dice Game Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 Socket.io enabled with transports: ${io.engine.opts.transports.join(', ')}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

export { app, server, io };