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

import { router as authRouter } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;

const app = express();
const server = http.createServer(app);

const DEV_LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS && process.env.CLIENT_ORIGINS.split(',')) || [
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    
    if (CLIENT_ORIGINS.includes(origin)) {
      return cb(null, origin);
    }

    if (DEV_LOCALHOST_REGEX.test(origin)) return cb(null, origin);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (CLIENT_ORIGINS.includes(origin)) return cb(null, true);
      if (DEV_LOCALHOST_REGEX.test(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// MUST come before routers
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "keyboardcat",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    sameSite: 'lax'
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", authRouter);

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
  res.json({ ok: true, ts: Date.now() });
});

const lobbyManager = new LobbyManager(io);

io.on("connection", socket => {
  console.log("Socket connected", socket.id);
  lobbyManager.registerSocket(socket);
});

server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);