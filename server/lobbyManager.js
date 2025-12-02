export default class LobbyManager {
    constructor(io) {
        this.io = io;
        this.lobbies = {};
    }

    registerSocket(socket) {
        socket.on('create-lobby', () => {
            const code = Math.random().toString(36).substr(2, 5);
            this.lobbies[code] = { players: [socket.id] };
            socket.emit('lobby-created', code);
        });

        socket.on('join-lobby', code => {
            const lobby = this.lobbies[code];
            if (!lobby || lobby.players.length >= 4) {
                socket.emit('join-failed');
                return;
            }
            lobby.players.push(socket.id);
            socket.emit('join-success', code);
        });
    }
}