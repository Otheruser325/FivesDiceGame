import { getSocket } from '../utils/SocketManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DebugManager from '../utils/DebugManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const onOff = (val) => t(val ? 'UI_ON' : 'UI_OFF', val ? 'ON' : 'OFF');
const teamLabel = (team) => (team === 'red' ? t('TEAM_RED', 'RED') : t('TEAM_BLUE', 'BLUE'));

export default class OnlineLobbyScene extends Phaser.Scene {
    constructor() {
        super('OnlineLobbyScene');
        this.players = [];
        this.host = false;
        this.rulesPanel = null;
        this.teamPanel = null;
        this.debugger = DebugManager.create(this, { namespace: 'OnlineLobbyScene' });
        this.debug = this.debugger.enabled;
    }

    init(data) {
        this.code = data.code;
        this.events.once("shutdown", this.shutdown, this);
        this.events.once("destroy", this.destroy, this);
    }

    create() {
        ErrorHandler.setScene(this);
        this.add.text(600, 60, t('ONLINE_LOBBY_TITLE', 'Lobby'), { fontSize: 42 }).setOrigin(0.5);

        // ROOM CODE DISPLAY
        const codeText = this.add.text(600, 120, tf('ONLINE_LOBBY_CODE', 'Code: {0}', this.code), {
            fontSize: 32,
            color: "#ffff66"
        }).setOrigin(0.5).setInteractive();

        codeText.on("pointerdown", () => {
            navigator.clipboard.writeText(this.code);
            codeText.setColor("#aaffaa");
            setTimeout(() => codeText.setColor("#ffff66"), 300);
        });

        // Player list
        this.playerListText = this.add.text(600, 240, t('ONLINE_LOBBY_LOADING', '(Loading...)'), {
            fontSize: 26,
            align: "center"
        }).setOrigin(0.5);

        // RULES PANEL (top-right)
        this.rulesPanel = this.add.container(1100, 100);
        const panelBg = this.add.rectangle(0, 0, 220, 180, 0x000000, 0.6).setOrigin(0, 0);
        this.rulesPanel.add(panelBg);

        this.rulesTexts = {
            players: this.add.text(10, 10, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0),
            rounds: this.add.text(10, 40, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0),
            combos: this.add.text(10, 70, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0),
            multiplex: this.add.text(10, 100, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0),
            teams: this.add.text(10, 130, "", { fontSize: 20, color: "#66ff66" }).setOrigin(0, 0)
        };
        this.rulesPanel.add([this.rulesTexts.players, this.rulesTexts.rounds, this.rulesTexts.combos, this.rulesTexts.multiplex, this.rulesTexts.teams]);

        // LEAVE BUTTON
        const leaveBtn = this.add.text(80, 60, t('ONLINE_LOBBY_LEAVE', 'Leave'), { fontSize: 26, color: "#ff6666" })
            .setOrigin(0.5).setInteractive();
        leaveBtn.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            if (this.debugger) this.debugger.log('leave-lobby click', { code: this.code });
            
            // FIX: Ensure socket handlers are removed BEFORE leaving
            // This prevents race condition where leaving quickly causes handlers to fire on old scene
            this.shutdown();
            
            getSocket().emit("leave-lobby", this.code);
            this.scene.start("OnlineMenuScene");
        });

        // READY BUTTON
        this.readyBtn = this.add.text(
            600,
            600,
            tf('ONLINE_LOBBY_READY_STATUS', 'Ready: {0}', t('ONLINE_LOBBY_READY_OFF', 'NO')),
            { fontSize: 32, color: "#ffaa66" }
        )
            .setOrigin(0.5).setInteractive();
        this.readyBtn.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            
            const socket = getSocket();
            
            // If socket isn't connected, wait briefly for it
            if (!socket.connected) {
                console.warn('[OnlineLobbyScene] Socket not connected yet, waiting...');
                if (this.debugger) this.debugger.warn('toggle-ready delayed: socket not connected');
                const timeout = setTimeout(() => {
                    console.warn('[OnlineLobbyScene] Socket connection timeout');
                }, 1500);
                
                socket.once('connect', () => {
                    clearTimeout(timeout);
                    if (this.debugger) this.debugger.log('toggle-ready emit (after connect)', { code: this.code });
                    this._emitReady(socket);
                });
            } else {
                if (this.debugger) this.debugger.log('toggle-ready emit', { code: this.code });
                this._emitReady(socket);
            }
        });

        // HOST START BUTTON
        this.startBtn = this.add.text(600, 700, t('ONLINE_LOBBY_START', 'Start Game'), { fontSize: 36, color: "#888888" })
            .setOrigin(0.5).setInteractive().setVisible(false);
        
        // "Starting game..." status text (orange, hidden by default)
        this.startingGameText = this.add.text(600, 750, t('ONLINE_LOBBY_STARTING', 'Starting game...'), { 
            fontSize: 28, 
            color: "#ffaa44",
            fontStyle: "italic"
        }).setOrigin(0.5).setVisible(false);
        
        this.startBtn.on("pointerdown", () => {
            if (!this.host) return;
            
            if (!this.players || this.players.length < 2) {
              GlobalAlerts.show(this, t('ONLINE_LOBBY_NEED_PLAYERS', 'At least 2 players are required to start a game.'), 'info');
              return;
            }
            
            const allReady = this.players.every(p => p.ready);
            if (allReady) {
                GlobalAudio.playButton(this);
                if (this.debugger) this.debugger.log('start-game click', { code: this.code });
                
                // Show "Starting game..." feedback to all players
                this.startingGameText.setVisible(true);
                this.startBtn.disableInteractive();
                
                const socket = getSocket();
                
                // If socket isn't connected, wait briefly for it
                if (!socket.connected) {
                    console.warn('[OnlineLobbyScene] Socket not connected, waiting before start-game...');
                    if (this.debugger) this.debugger.warn('start-game delayed: socket not connected');
                    const timeout = setTimeout(() => {
                        console.warn('[OnlineLobbyScene] Socket connection timeout before start-game');
                    }, 1500);
                    
                    socket.once('connect', () => {
                        clearTimeout(timeout);
                        console.log('[OnlineLobbyScene] Socket connected, emitting start-game');
                        if (this.debugger) this.debugger.log('start-game emit (after connect)', { code: this.code });
                        socket.emit("start-game", this.code);
                    });
                } else {
                    if (this.debugger) this.debugger.log('start-game emit', { code: this.code });
                    socket.emit("start-game", this.code);
                }
            }
        });

        // SOCKET LISTENERS
        const socket = getSocket();
        
        socket.on("lobby-data", data => {
            if (this.debugger) this.debugger.log('lobby-data', { code: data?.code, players: data?.players?.length });
            this.updateLobbyData(data);
        });
        socket.on("lobby-updated", data => {
            if (this.debugger) this.debugger.log('lobby-updated', { code: data?.code, players: data?.players?.length });
            this.updateLobbyData(data);
        });
        socket.on("game-starting", (data = {}) => {
            // Verify socket is still connected before starting game scene
            if (!socket.connected) {
                console.error('[OnlineLobbyScene] Socket disconnected before game-starting transition');
                if (this.debugger) this.debugger.error('game-starting received while disconnected');
                return;
            }
            console.log('[OnlineLobbyScene] game-starting received, transitioning to OnlineGameScene');
            if (this.debugger) this.debugger.log('game-starting', { code: this.code });
            this.scene.start("OnlineGameScene", { code: this.code, config: data.config || {} });
        });

        // Request initial data
        getSocket().emit("request-lobby-data", this.code);
    }

    updateLobbyData(data) {
        // Debugging helper - remove or comment out in prod if noisy
        // console.log('LOBBY DATA RECEIVED', data);

        // Normalize players array (ensure id/name/ready)
        // CRITICAL FIX: Filter out players marked with left:true to prevent stale player slots
        const rawPlayers = Array.isArray(data.players) ? data.players : [];
        this.players = rawPlayers
            .filter(p => !p.left)  // Filter out players who have left
            .map((p, i) => ({
                id: p.id,
                name: this._sanitizePlayerName(p.name || p.id, p.id),
                ready: !!p.ready,
                connected: p.connected !== false,
                team: p.team || (i % 2 === 0 ? 'blue' : 'red')  // Default team assignment
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
        this.refreshTeamPanel();
    }

    refreshList() {
        if (!this.playerListText) return;

        if (!this.players || this.players.length === 0) {
            this.playerListText.text = t('ONLINE_LOBBY_WAITING', '(Waiting for players...)');
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
            const hostTag = isHost ? t('ONLINE_LOBBY_HOST_TAG', '[HOST]') : '';
            const selfTag = isSelf ? t('ONLINE_LOBBY_YOU_TAG', '[YOU]') : '';
            const tag = [hostTag, selfTag].filter(Boolean).join(' ');
            const tagPrefix = tag ? `${tag} ` : '';
            const teamName = teamLabel(p.team || (isHost ? 'blue' : 'red'));
            const teamIndicator = this.config.teamsEnabled
                ? ` ${tf('ONLINE_LOBBY_TEAM_TAG', '[{0}]', teamName)}`
                : '';
            const readyLabel = p.ready
                ? t('ONLINE_LOBBY_READY_YES', 'READY')
                : t('ONLINE_LOBBY_READY_NO', 'NOT READY');
            return `${tagPrefix}${p.name}${teamIndicator} - ${readyLabel}`;
        });

        // Add waiting slots for unfilled positions
        for (let i = this.players.length; i < totalSlots; i++) {
            playerLines.push(t('ONLINE_LOBBY_WAITING_SLOT', 'Waiting for player...'));
        }

        const list = playerLines.join("\n");
        this.playerListText.text = `${tf('ONLINE_LOBBY_PLAYER_COUNT', '{0}/{1} players', this.players.length, totalSlots)}\n\n${list}`;

        // Update my ready button
        const me = this.players.find(p => p.id === myId);
        if (me) {
            const status = me.ready ? t('ONLINE_LOBBY_READY_ON', 'YES') : t('ONLINE_LOBBY_READY_OFF', 'NO');
            this.readyBtn.text = tf('ONLINE_LOBBY_READY_STATUS', 'Ready: {0}', status);
            this.readyBtn.setColor(me.ready ? "#66ff66" : "#ffaa66");
        } else {
            this.readyBtn.text = tf('ONLINE_LOBBY_READY_STATUS', 'Ready: {0}', t('ONLINE_LOBBY_READY_OFF', 'NO'));
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
        if (this.debugger) this.debugger.log('toggle-ready', { code: this.code, userId: myId });
        socket.emit("toggle-ready", this.code, myId);
    }

    refreshRulesPanel() {
        if (!this.config || !this.rulesTexts) return;
        this.rulesTexts.players.text = tf('ONLINE_LOBBY_RULES_PLAYERS', 'Players: {0}', this.config.players || 2);
        this.rulesTexts.rounds.text = tf('ONLINE_LOBBY_RULES_ROUNDS', 'Rounds: {0}', this.config.rounds || 20);
        this.rulesTexts.combos.text = tf('ONLINE_LOBBY_RULES_COMBOS', 'Combos: {0}', onOff(this.config.combos));
        if (this.rulesTexts.multiplex) {
            this.rulesTexts.multiplex.text = tf('ONLINE_LOBBY_RULES_MULTIPLEX', 'Multiplex: {0}', onOff(this.config.multiplex));
        }
        this.rulesTexts.teams.text = tf('ONLINE_LOBBY_RULES_TEAMS', 'Teams: {0}', onOff(this.config.teamsEnabled));
    }

    refreshTeamPanel() {
        // Remove old team panel if it exists
        if (this.teamPanel) {
            this.teamPanel.destroy();
            this.teamPanel = null;
        }

        // Only show team panel if teams are enabled
        if (!this.config.teamsEnabled || !this.players || this.players.length === 0) {
            return;
        }

        // Create team assignment UI in bottom-left area
        const isHost = this.host;

        this.teamPanel = this.add.container(200, 400);
        const panelBg = this.add.rectangle(0, 0, 350, Math.min(200, this.players.length * 40), 0x000000, 0.7).setOrigin(0, 0);
        this.teamPanel.add(panelBg);

        const titleText = this.add.text(10, 5, t('ONLINE_LOBBY_TEAMS_TITLE', 'Team Assignment:'), { fontSize: 18, color: "#ffaa44" }).setOrigin(0, 0);
        this.teamPanel.add(titleText);

        let yOffset = 35;
        this.players.slice(0, 4).forEach((p, i) => {  // Show max 4 players
            const playerName = p.name.substring(0, 10);
            const teamColor = p.team === 'blue' ? '#66aaff' : '#ff6666';
            const teamText = teamLabel(p.team);

            const nameText = this.add.text(15, yOffset, tf('ONLINE_LOBBY_TEAM_PLAYER', '{0}:', playerName), { fontSize: 14 }).setOrigin(0, 0);
            this.teamPanel.add(nameText);

            const teamBtn = this.add.text(150, yOffset, teamText, {
                fontSize: 14,
                color: teamColor,
                backgroundColor: '#222222',
                padding: { x: 6, y: 2 }
            }).setOrigin(0, 0);

            if (isHost) {
                teamBtn.setInteractive();
                teamBtn.on('pointerdown', () => {
                    // Toggle team for this player
                    p.team = p.team === 'blue' ? 'red' : 'blue';
                    this.refreshTeamPanel();
                    // Emit team change to server if needed
                    if (this.debugger) this.debugger.log('team-changed emit', { code: this.code, playerId: p.id, team: p.team });
                    getSocket().emit('team-changed', { code: this.code, playerId: p.id, team: p.team });
                });
            }

            this.teamPanel.add(teamBtn);
            yOffset += 40;
        });
    }

    shutdown() {
        // remove event listeners
        const socket = getSocket();
        socket.off("lobby-data");
        socket.off("lobby-updated");
        socket.off("game-starting");
        socket.off("team-changed");
        
        // Cleanup UI elements
        if (this.teamPanel) {
            this.teamPanel.destroy();
            this.teamPanel = null;
        }
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
        const guestLabel = t('GENERIC_GUEST', 'Guest');
        if (!name) return `${guestLabel}${String(id).substring(0, 6)}`;
        
        const str = String(name).trim();
        
        // Socket IDs are typically 20+ character alphanumeric strings
        // If name matches that pattern, it's likely a socket.id that leaked
        if (/^[a-zA-Z0-9]{20,}$/.test(str)) {
            console.warn('[OnlineLobbyScene] Detected socket.id as player name, using fallback:', str.substring(0, 8) + '...');
            return `${guestLabel}${String(id).substring(0, 6)}`;
        }
        
        // Normal name, return as-is
        return str || `${guestLabel}${String(id).substring(0, 6)}`;
    }
}

