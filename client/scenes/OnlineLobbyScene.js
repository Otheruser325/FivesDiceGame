import { getSocket } from '../utils/SocketManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

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
        const panelBg = this.add.rectangle(0, 0, 240, 190, 0x000000, 0.6).setOrigin(0, 0);
        this.rulesPanel.add(panelBg);

        this.rulesTexts = {
            waves: this.add.text(10, 10, "", { fontSize: 18, color: "#66ff66" }).setOrigin(0, 0),
            switchSides: this.add.text(10, 40, "", { fontSize: 18, color: "#66ff66" }).setOrigin(0, 0),
            dice: this.add.text(10, 70, "", { fontSize: 18, color: "#66ff66" }).setOrigin(0, 0),
            board: this.add.text(10, 100, "", { fontSize: 18, color: "#66ff66" }).setOrigin(0, 0),
            timer: this.add.text(10, 130, "", { fontSize: 18, color: "#66ff66" }).setOrigin(0, 0)
        };
        this.rulesPanel.add([
            this.rulesTexts.waves,
            this.rulesTexts.switchSides,
            this.rulesTexts.dice,
            this.rulesTexts.board,
            this.rulesTexts.timer
        ]);

        // LEAVE BUTTON
        const leaveBtn = this.add.text(80, 60, "Leave", { fontSize: 26, color: "#ff6666" })
            .setOrigin(0.5).setInteractive();
        leaveBtn.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.shutdown();
            getSocket().emit("leave-lobby", this.code);
            this.scene.start("OnlineMenuScene");
        });

        // READY BUTTON
        this.readyBtn = this.add.text(600, 600, "Ready: NO", { fontSize: 32, color: "#ffaa66" })
            .setOrigin(0.5).setInteractive();
        this.readyBtn.on("pointerdown", () => {
            GlobalAudio.playButton(this);

            const socket = getSocket();
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

        this.startingGameText = this.add.text(600, 750, "Starting game...", {
            fontSize: 28,
            color: "#ffaa44",
            fontStyle: "italic"
        }).setOrigin(0.5).setVisible(false);

        this.startBtn.on("pointerdown", () => {
            if (!this.host) return;

            if (!this.players || this.players.length < 2) {
                GlobalAlerts.show(this, 'At least 2 players are required to start a game.', 'info');
                return;
            }

            const allReady = this.players.every(p => p.ready);
            if (allReady) {
                GlobalAudio.playButton(this);
                this.startingGameText.setVisible(true);
                this.startBtn.disableInteractive();

                const socket = getSocket();
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
            if (!socket.connected) {
                console.error('[OnlineLobbyScene] Socket disconnected before game-starting transition');
                return;
            }
            console.log('[OnlineLobbyScene] game-starting received, transitioning to OnlineGameScene');
            const config = this._sanitizeConfig(data.config || {});
            const players = Array.isArray(data.players) && data.players.length ? data.players : this.players;
            const localId = socket.data?.user?.id || socket.userId || null;
            this.scene.start("OnlineGameScene", { code: this.code, config, players, localId });
        });

        // Request initial data
        getSocket().emit("request-lobby-data", this.code);
    }

    updateLobbyData(data) {
        const rawPlayers = Array.isArray(data.players) ? data.players : [];
        this.players = rawPlayers
            .filter(p => !p.left)
            .map(p => ({
                id: p.id,
                name: this._sanitizePlayerName(p.name || p.id, p.id),
                ready: !!p.ready,
                connected: p.connected !== false
            }));

        this.hostSocketId = data.hostSocketId || data.host || null;
        this.hostUserId = data.hostUserId || data.hostUser || null;

        if (!this.hostUserId && this.players.length > 0) {
            this.hostUserId = this.players[0].id;
        }

        const mySocketId = getSocket().id || null;
        const myUserId = getSocket().data?.user?.id || getSocket().userId || null;

        this.host = false;
        if (this.hostUserId && myUserId) {
            this.host = (String(this.hostUserId) === String(myUserId));
        } else if (this.hostSocketId && mySocketId) {
            this.host = (String(this.hostSocketId) === String(mySocketId));
        } else {
            this.host = (this.players[0] && myUserId && this.players[0].id === myUserId);
        }

        this.config = this._sanitizeConfig(data.config || {});
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
                const raw = localStorage.getItem('fives_user') || localStorage.getItem('protodice_user');
                if (raw) {
                    const cached = JSON.parse(raw);
                    if (cached && cached.id) myId = cached.id;
                }
            } catch (e) { /* ignore */ }
        }

        const hostUserId = this.hostUserId || (this.players[0] && this.players[0].id) || null;
        const totalSlots = 2;

        const playerLines = this.players.map(p => {
            const isSelf = p.id === myId;
            const isHost = p.id === hostUserId;
            const tag = isHost ? "[HOST] " : (isSelf ? "[YOU] " : "");
            return `${tag}${p.name} - ${p.ready ? "READY" : "NOT READY"}`;
        });

        for (let i = this.players.length; i < totalSlots; i++) {
            playerLines.push("Waiting for player...");
        }

        const list = playerLines.join("\n");
        this.playerListText.text = `${this.players.length}/${totalSlots} players\n\n${list}`;

        const me = this.players.find(p => p.id === myId);
        if (me) {
            this.readyBtn.text = `Ready: ${me.ready ? "YES" : "NO"}`;
            this.readyBtn.setColor(me.ready ? "#66ff66" : "#ffaa66");
        } else {
            this.readyBtn.text = `Ready: NO`;
            this.readyBtn.setColor("#ffaa66");
        }

        if (this.startBtn) {
            if (this.host) {
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
        let myId = null;
        try { myId = socket.data?.user?.id || socket.userId || null; } catch (e) { myId = null; }
        if (!myId) {
            try {
                const raw = localStorage.getItem('fives_user') || localStorage.getItem('protodice_user');
                if (raw) {
                    const cached = JSON.parse(raw);
                    if (cached && cached.id) myId = cached.id;
                }
            } catch (e) { /* ignore */ }
        }

        socket.emit("toggle-ready", this.code, myId);
    }

    refreshRulesPanel() {
        if (!this.config) return;
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);

        const wavesLabel = fmt('CONFIG_WAVES_LABEL', '{0} waves', this.config.waves || 20);
        const switchLabel = fmt(
            'CONFIG_SWITCH_SIDES',
            'Switch sides: {0}',
            this.config.switchSides ? t('SIDE_MONSTERS', 'Monsters') : t('SIDE_DEFENCES', 'Defences')
        );
        const diceLabel = this.config.diceCount === 2 ? t('CONFIG_DICE_2', '2 Dice') : t('CONFIG_DICE_1', '1 Dice');
        const boardLabel = fmt('CONFIG_ROWS', 'Rows: {0}', this.config.boardRows || 5) + ', ' + fmt('CONFIG_COLS', 'Cols: {0}', this.config.boardCols || 9);
        const timerLabel = t('ONLINE_TURN_TIMER', `Turn timer: ${this.config.turnTimeSeconds || 30}s`);

        this.rulesTexts.waves.text = wavesLabel;
        this.rulesTexts.switchSides.text = switchLabel;
        this.rulesTexts.dice.text = diceLabel;
        this.rulesTexts.board.text = boardLabel;
        this.rulesTexts.timer.text = timerLabel;
    }

    shutdown() {
        const socket = getSocket();
        socket.off("lobby-data");
        socket.off("lobby-updated");
        socket.off("game-starting");
    }

    destroy() {
        this.shutdown();
    }

    _sanitizePlayerName(name, id) {
        if (!name) return `Guest${String(id).substring(0, 6)}`;

        const str = String(name).trim();

        if (/^[a-zA-Z0-9]{20,}$/.test(str)) {
            console.warn('[OnlineLobbyScene] Detected socket.id as player name, using fallback:', str.substring(0, 8) + '...');
            return `Guest${String(id).substring(0, 6)}`;
        }

        return str || `Guest${String(id).substring(0, 6)}`;
    }

    _sanitizeConfig(raw = {}) {
        const waves = Number(raw.waves);
        const diceCount = Number(raw.diceCount);
        const boardRows = Number(raw.boardRows);
        const boardCols = Number(raw.boardCols);
        const turnTimeSeconds = Number(raw.turnTimeSeconds);

        return {
            waves: Number.isFinite(waves) ? waves : 20,
            switchSides: typeof raw.switchSides === 'boolean' ? raw.switchSides : false,
            diceCount: Number.isFinite(diceCount) ? diceCount : 1,
            boardRows: Number.isFinite(boardRows) ? boardRows : 5,
            boardCols: Number.isFinite(boardCols) ? boardCols : 9,
            turnTimeSeconds: Number.isFinite(turnTimeSeconds) ? turnTimeSeconds : 30
        };
    }
}
