import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import LobbyManager from './lobbyManager.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const lobbyManager = new LobbyManager(io);

// Basic socket handling
io.on('connection', socket => {
    console.log('Player connected:', socket.id);
    lobbyManager.registerSocket(socket);
});

server.listen(3000, () => {
    console.log('Fives server running on port 3000');
});
