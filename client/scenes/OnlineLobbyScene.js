import { getSocket } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';

export default class OnlineLobbyScene extends Phaser.Scene {
    constructor() {
        super('OnlineLobbyScene');
        this.players = [];
        this.host = false;
        this.rulesPanel = null;
    }

    init(data) {
        this.code = data.code;
        this.events.once("shutdown", this.shutdown, this);
        this.events.once("destroy", this.destroy, this);
    }

    create() {
        ErrorHandler.setScene(this);
        this.add.text(600, 60, "Lobby", { fontSize: 42 }).setOrigin(0.5);

        // ROOM CODE DISPLAY
        const codeText = this.add.text(600, 120, `Code: ${this.code}`, {
            fontSize: 32,
            color: "#ffff66"
        }).setOrigin(0.5).setInteractive();

        codeText.on("pointerdown", () => {
            navigator.clipboard.writeText(this.code);
            codeText.setColor("#aaffaa");
            setTimeout(() => codeText.setColor("#ffff66"), 300);
        });

        // Player list
        this.playerListText = this.add.text(600, 240, "(Loading...)", {
            fontSize: 26,
            align: "center"
        }).setOrigin(0.5);

        // RULES PANEL (top-right)
        this.rulesPanel = this.add.container(1100, 100);
        const panelBg = this.add.rectangle(0, 0, 220, 150, 0x000000, 0.6).setOrigin(0, 0);
        this.rulesPanel.add(panelBg);

        this.rulesTexts = {
            players: this.add.text(10, 10, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0),
            rounds: this.add.text(10, 40, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0),
            combos: this.add.text(10, 70, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0),
            teams: this.add.text(10, 100, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0)
        };
        this.rulesPanel.add([this.rulesTexts.players, this.rulesTexts.rounds, this.rulesTexts.combos, this.rulesTexts.teams]);

        // LEAVE BUTTON
        const leaveBtn = this.add.text(80, 60, "Leave", { fontSize: 26, color: "#ff6666" })
            .setOrigin(0.5).setInteractive();
        leaveBtn.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            getSocket().emit("leave-lobby", this.code);
            this.scene.start("OnlineMenuScene");
        });

        // READY BUTTON
        this.readyBtn = this.add.text(600, 600, "Ready: NO", { fontSize: 32, color: "#ffaa66" })
            .setOrigin(0.5).setInteractive();
        this.readyBtn.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            
            const socket = getSocket();
            
            // If socket isn't connected, wait briefly for it
            if (!socket.connected) {
                console.warn('[OnlineLobbyScene] Socket not connected yet, waiting...');
                const timeout = setTimeout(() => {
                    console.warn('[OnlineLobbyScene] Socket connection timeout');
                }, 1500);
                
                socket.once('connect', () => {
                    clearTimeout(timeout);
                    this._emitReady(socket);
                });
            } else {
                this._emitReady(socket);
            }
        });

        // HOST START BUTTON
        this.startBtn = this.add.text(600, 700, "Start Game", { fontSize: 36, color: "#888888" })
            .setOrigin(0.5).setInteractive().setVisible(false);
        this.startBtn.on("pointerdown", () => {
            if (!this.host || !this.players || this.players.length < 2) return;
            const allReady = this.players.every(p => p.ready);
            if (allReady) {
                GlobalAudio.playButton(this);
                
                const socket = getSocket();
                
                // If socket isn't connected, wait briefly for it
                if (!socket.connected) {
                    console.warn('[OnlineLobbyScene] Socket not connected, waiting before start-game...');
                    const timeout = setTimeout(() => {
                        console.warn('[OnlineLobbyScene] Socket connection timeout before start-game');
                    }, 1500);
                    
                    socket.once('connect', () => {
                        clearTimeout(timeout);
                        console.log('[OnlineLobbyScene] Socket connected, emitting start-game');
                        socket.emit("start-game", this.code);
                    });
                } else {
                    socket.emit("start-game", this.code);
                }
            }
        });

        // SOCKET LISTENERS
        const socket = getSocket();
        
        socket.on("lobby-data", data => {
            this.updateLobbyData(data);
        });
        socket.on("lobby-updated", data => {
            this.updateLobbyData(data);
        });
        socket.on("game-starting", (data = {}) => {
            // Verify socket is still connected before starting game scene
            if (!socket.connected) {
                console.error('[OnlineLobbyScene] Socket disconnected before game-starting transition');
                return;
            }
            console.log('[OnlineLobbyScene] game-starting received, transitioning to OnlineGameScene');
            this.scene.start("OnlineGameScene", { code: this.code, config: data.config || {} });
        });

        // Request initial data
        getSocket().emit("request-lobby-data", this.code);
    }

    updateLobbyData(data) {
        // Debugging helper — remove or comment out in prod if noisy
        // console.log('LOBBY DATA RECEIVED', data);

        // Normalize players array (ensure id/name/ready)
        const rawPlayers = Array.isArray(data.players) ? data.players : [];
        this.players = rawPlayers.map(p => ({
            id: p.id,
            name: this._sanitizePlayerName(p.name || p.id, p.id),
            ready: !!p.ready,
            connected: p.connected !== false
        }));

        // Accept several possible host fields from server
        // server may send hostSocketId, hostUserId, host, or none (in which case fallback to players[0])
        this.hostSocketId = data.hostSocketId || data.host || null;
        this.hostUserId = data.hostUserId || data.hostUserId || (data.hostUser || null);

        // Fallback: if neither provided, try deriving host from players[0]
        if (!this.hostUserId && this.players.length > 0) {
            this.hostUserId = this.players[0].id;
        }

        // determine whether this client is host:
        const mySocketId = getSocket().id || null;
        const myUserId = getSocket().data?.user?.id || getSocket().userId || null;

        this.host = false;
        if (this.hostUserId && myUserId) {
            this.host = (String(this.hostUserId) === String(myUserId));
        } else if (this.hostSocketId && mySocketId) {
            this.host = (String(this.hostSocketId) === String(mySocketId));
        } else {
            // final fallback: the first player in players[] is treated as host
            this.host = (this.players[0] && myUserId && this.players[0].id === myUserId);
        }

        this.config = data.config || {};
        this.refreshList();
        this.refreshRulesPanel();
    }

    refreshList() {
        if (!this.playerListText) return;

        if (!this.players || this.players.length === 0) {
            this.playerListText.text = "(Waiting for players...)";
            return;
        }

        let myId = null;
        try {
          myId = getSocket().data?.user?.id || getSocket().userId || null;
        } catch (e) { myId = null; }
        if (!myId) {
          try {
            const raw = localStorage.getItem('fives_user');
            if (raw) {
            const cached = JSON.parse(raw);
            if (cached && cached.id) myId = cached.id;
            }
          } catch (e) { /* ignore */ }
        }
        const hostUserId = this.hostUserId || (this.players[0] && this.players[0].id) || null;

        // Build player list with actual players + waiting slots
        const totalSlots = this.config.players || 6;
        const playerLines = this.players.map(p => {
            const isSelf = p.id === myId;
            const isHost = p.id === hostUserId;
            const star = isHost ? "⭐ " : (isSelf ? "🔹 " : "");
            return `${star}${p.name} — ${p.ready ? "READY" : "NOT READY"}`;
        });

        // Add waiting slots for unfilled positions
        for (let i = this.players.length; i < totalSlots; i++) {
            playerLines.push("⏳ Waiting for player...");
        }

        const list = playerLines.join("\n");
        this.playerListText.text = `${this.players.length}/${totalSlots} players\n\n${list}`;

        // Update my ready button
        const me = this.players.find(p => p.id === myId);
        if (me) {
            this.readyBtn.text = `Ready: ${me.ready ? "YES" : "NO"}`;
            this.readyBtn.setColor(me.ready ? "#66ff66" : "#ffaa66");
        } else {
            this.readyBtn.text = `Ready: NO`;
            this.readyBtn.setColor("#ffaa66");
        }

        // Host start button visibility + color
        if (this.startBtn) {
            if (this.host) {
                // Allow start if at least 1 player is joined and all are ready (or if it's just the host)
                const hasPlayers = this.players.length > 0;
                const allReady = this.players.length > 0 && this.players.every(p => p.ready);
                this.startBtn.setVisible(true);
                this.startBtn.setColor((hasPlayers && allReady) ? "#66ff66" : "#888888");
            } else {
                this.startBtn.setVisible(false);
            }
        }
    }

    _emitReady(socket) {
        // determine our user id (socket-auth or localStorage fallback)
        let myId = null;
        try { myId = socket.data?.user?.id || socket.userId || null; } catch (e) { myId = null; }
        if (!myId) {
            try {
                const raw = localStorage.getItem('fives_user');
                if (raw) {
                    const cached = JSON.parse(raw);
                    if (cached && cached.id) myId = cached.id;
                }
            } catch (e) { /* ignore */ }
        }

        // Emit code and best-effort user id (server will accept either)
        socket.emit("toggle-ready", this.code, myId);
    }

    refreshRulesPanel() {
        if (!this.config) return;
        this.rulesTexts.players.text = `Players: ${this.config.players || 2}`;
        this.rulesTexts.rounds.text = `Rounds: ${this.config.rounds || 20}`;
        this.rulesTexts.combos.text = `Combos: ${this.config.combos ? "YES" : "NO"}`;
        this.rulesTexts.teams.text = `Teams: ${this.config.teamsEnabled ? "ON" : "OFF"}`;
    }

    shutdown() {
        // remove event listeners
        const socket = getSocket();
        socket.off("lobby-data");
        socket.off("lobby-updated");
        socket.off("game-starting");
    }

    destroy() {
        this.shutdown();
    }

    /**
     * Sanitize player name to prevent exposing socket IDs
     * If name looks like a socket ID (long alphanumeric), use fallback format
     * @param {string} name - The player name to sanitize
     * @param {string} id - The player ID as fallback
     * @returns {string} - Safe player name
     */
    _sanitizePlayerName(name, id) {
        if (!name) return `Guest${String(id).substring(0, 6)}`;
        
        const str = String(name).trim();
        
        // Socket IDs are typically 20+ character alphanumeric strings
        // If name matches that pattern, it's likely a socket.id that leaked
        if (/^[a-zA-Z0-9]{20,}$/.test(str)) {
            console.warn('[OnlineLobbyScene] Detected socket.id as player name, using fallback:', str.substring(0, 8) + '...');
            return `Guest${String(id).substring(0, 6)}`;
        }
        
        // Normal name, return as-is
        return str || `Guest${String(id).substring(0, 6)}`;
    }
}