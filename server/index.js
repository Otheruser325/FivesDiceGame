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
import { lobbyManager } from './lobbyManager.js';
import ws from 'ws';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

// Production-ready socket.io configuration
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGINS ? process.env.CLIENT_ORIGINS.split(',') : [
      'http://localhost:8080',
      'https://localhost:8080'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  },
  transports: ['polling', 'websocket'], // Enable WebSocket for production
  pingTimeout: 60000, // 60 seconds
  pingInterval: 25000, // 25 seconds
  connectTimeout: 45000, // 45 seconds
  maxHttpBufferSize: 1e8, // 100 MB
  allowEIO3: true, // Support older clients
  compression: true, // Enable compression for production
  upgrade: true, // Allow WebSocket upgrades
  rememberUpgrade: true, // Remember successful upgrades
  addTrailingSlash: false,
  forceNew: false,
  wsEngine: ws // Explicitly set WebSocket engine
});

// Redis client for session storage (if available)
let redisClient = null;
let sessionStore = null;

async function initializeRedis() {
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

// Share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.CLIENT_ORIGINS ? 
    process.env.CLIENT_ORIGINS.split(',') : 
    ['http://localhost:8080', 'https://localhost:8080'];
  
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
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

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id} from ${socket.handshake.address}`);
  
  // Initialize lobby manager with this socket
  lobbyManager.initializeSocket(socket);
  
  socket.on('error', (error) => {
    console.error(`[Socket] Error on ${socket.id}:`, error);
  });
  
  socket.on('disconnect', (reason, details) => {
    console.log(`[Socket] Disconnected: ${socket.id} - ${reason}`);
    if (details) {
      console.log(`[Socket] Disconnect details:`, details);
    }
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