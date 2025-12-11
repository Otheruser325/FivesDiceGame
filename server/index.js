import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
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

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// MUST come before routers
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || "keyboardcat",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // HTTPS only if needed
}));

app.use(passport.initialize());
app.use(passport.session());

app.use("/auth", authRouter);

app.use("/FivesDiceGame", express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => res.redirect("/FivesDiceGame"));

const lobbyManager = new LobbyManager(io);

io.on("connection", socket => {
  console.log("Socket connected", socket.id);
  lobbyManager.registerSocket(socket);
});

server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);