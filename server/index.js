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

const PORT = process.env.PORT || 8084;

const app = express();
const server = http.createServer(app);

const DEV_LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGINS && process.env.CLIENT_ORIGINS.split(',')) || [
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:8083',
  'http://localhost:8084',
  'http://localhost:8085',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8084'
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

// serve static files from client
app.use("/FivesDiceGame", express.static(path.join(__dirname, "../client")));

// SPA fallback for client-side routes under /FivesDiceGame
app.get('/FivesDiceGame/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get("/", (req, res) => res.redirect("/FivesDiceGame"));

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