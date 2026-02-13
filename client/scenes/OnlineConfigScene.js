import { getSocket, emitAuthUser } from '../utils/SocketManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DebugManager from '../utils/DebugManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const onOff = (val) => t(val ? 'UI_ON' : 'UI_OFF', val ? 'ON' : 'OFF');
const teamLabel = (team) => (team === 'red' ? t('TEAM_RED', 'RED') : t('TEAM_BLUE', 'BLUE'));

export default class OnlineConfigScene extends Phaser.Scene {
    constructor() {
        super({ key: 'OnlineConfigScene' });

        this.selectedPlayers = 2;
        this.selectedRounds = 20;
        this.comboRules = false;
        this.multiplexRules = false;
        this.teamsEnabled = false;
        this.playerTeams = ['blue', 'red', 'blue', 'red', 'blue', 'red'];
        this.createLobbyBtn = null;
        this.creatingLobby = false;
        this.boundHandlers = {};
        this.debugger = new DebugManager(this, { namespace: 'OnlineConfigScene' });
        this.debug = this.debugger.enabled;
    }

    init(data) {
        if (data.players) this.selectedPlayers = data.players;
        if (data.rounds) this.selectedRounds = data.rounds;
        if (typeof data.combos === "boolean") this.comboRules = data.combos;
        if (typeof data.multiplex === "boolean") this.multiplexRules = data.multiplex;
        if (typeof data.teamsEnabled === "boolean") this.teamsEnabled = data.teamsEnabled;
        if (Array.isArray(data.teams)) this.playerTeams = data.teams;
        this.creatingLobby = false;
    }

    create() {
        ErrorHandler.setScene(this);
        this.add.text(600, 60, t('ONLINE_CONFIG_TITLE', 'Online Game Configuration'), { fontSize: 40 }).setOrigin(0.5);

        // PLAYERS COUNT
        this.add.text(600, 120, t('CONFIG_PLAYERS_PROMPT', 'How many players?'), { fontSize: 28 }).setOrigin(0.5);

        const playerOptions = [2, 3, 4, 5, 6];
        playerOptions.forEach((num, i) => {
            const btn = this.add.text(600, 160 + i * 40, `${num}`, {
                fontSize: 26,
                color: num === this.selectedPlayers ? '#ffff66' : '#ffffff'
            })
                .setOrigin(0.5)
                .setInteractive();

            btn.on('pointerdown', () => {
                this.selectedPlayers = num;
                this.refreshScene();
            });
        });

        // ROUNDS
        this.add.text(600, 360, t('CONFIG_ROUNDS_PROMPT', 'How many rounds?'), {
            fontSize: 28
        }).setOrigin(0.5);

        const roundOptions = [10, 15, 20, 25, 30];
        roundOptions.forEach((r, i) => {
            const btn = this.add.text(600, 400 + i * 40, tf('CONFIG_ROUNDS_LABEL', '{0} rounds', r), {
                fontSize: 24,
                color: r === this.selectedRounds ? '#ffff66' : '#ffffff'
            })
                .setOrigin(0.5)
                .setInteractive();

            btn.on('pointerdown', () => {
                this.selectedRounds = r;
                this.refreshScene();
            });
        });

        // COMBO RULES
        this.add.text(600, 600, t('CONFIG_ADDITIONAL_RULES', 'Additional rules:'), {
            fontSize: 26
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(
            600,
            640,
            tf('CONFIG_COMBO_RULES', 'More points for combos: {0}', onOff(this.comboRules)),
            { fontSize: 24, color: this.comboRules ? '#66aaff' : '#ff6666' }
        )
            .setOrigin(0.5)
            .setInteractive();

        this.comboBtn.on('pointerdown', () => {
            this.comboRules = !this.comboRules;
            this.refreshScene();
        });

        // TEAMS MODE
        this.multiplexBtn = this.add.text(
            600,
            680,
            tf('CONFIG_MULTIPLEX_RULES', 'Multiplex scoring: {0}', onOff(this.multiplexRules)),
            { fontSize: 24, color: this.multiplexRules ? '#66aaff' : '#ff6666' }
        )
            .setOrigin(0.5)
            .setInteractive();

        this.multiplexBtn.on('pointerdown', () => {
            this.multiplexRules = !this.multiplexRules;
            this.refreshScene();
        });

        this.teamsBtn = this.add.text(
            600,
            720,
            tf('CONFIG_TEAMS', 'Teams: {0}', onOff(this.teamsEnabled)),
            { fontSize: 24, color: this.teamsEnabled ? '#66aaff' : '#ff6666' }
        )
            .setOrigin(0.5)
            .setInteractive();

        this.teamsBtn.on('pointerdown', () => {
            this.teamsEnabled = !this.teamsEnabled;
            this.refreshScene();
        });

        // TEAM CONFIGURATION (only if teams enabled)
        if (this.teamsEnabled) {
            this.add.text(600, 750, t('CONFIG_TEAM_ASSIGNMENT', 'Team Assignment:'), { fontSize: 22, color: "#ffaa44" }).setOrigin(0.5);
            
            let teamConfigY = 780;
            for (let i = 0; i < this.selectedPlayers; i++) {
                const team = this.playerTeams[i] || 'blue';
                const teamColor = team === 'blue' ? '#66aaff' : '#ff6666';
                
                this.add.text(400, teamConfigY, tf('CONFIG_PLAYER_LABEL', 'Player {0}:', i + 1), { fontSize: 18 }).setOrigin(0.5);
                
                const teamBtn = this.add.text(600, teamConfigY, teamLabel(team), {
                    fontSize: 18,
                    color: teamColor,
                    backgroundColor: '#222222',
                    padding: { x: 10, y: 4 }
                }).setOrigin(0.5).setInteractive();
                
                const playerIndex = i;
                teamBtn.on('pointerdown', () => {
                    this.playerTeams[playerIndex] = this.playerTeams[playerIndex] === 'blue' ? 'red' : 'blue';
                    this.refreshScene();
                });
                
                teamConfigY += 24;
            }
        }

        // CREATE LOBBY with socket auth and state management
        this._labelCreateLobby = t('ONLINE_CONFIG_CREATE_LOBBY', 'Create Lobby!');
        this._labelCreatingLobby = t('ONLINE_CONFIG_CREATING_LOBBY', 'Creating Lobby...');

        this.createLobbyBtn = this.add.text(600, 930, this._labelCreateLobby, {
            fontSize: 32, 
            color: '#66ff66',
            backgroundColor: '#222222',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        this.createLobbyBtn.on('pointerdown', () => {
            if (this.creatingLobby) return;
            GlobalAudio.playButton(this);
            this.handleCreateLobby();
        });

        // BACK BUTTON
        const backBtn = this.add.text(80, 800, t('UI_BACK', '<- Back'), {
            fontSize: 24,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineMenuScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
          GlobalAudio.playButton(this);
          this.scene.start('OnlineMenuScene');
        });
    }

    onAuthSuccess(data) {
        if (this.debugger) this.debugger.log('auth-success', data);
    }

    onAuthFailure(error) {
        if (this.debugger) this.debugger.warn('auth-failed', error);
    }

    handleCreateLobby() {
        // Guard against multiple simultaneous requests
        if (this.creatingLobby) {
            console.warn('[OnlineConfigScene] Create lobby already in progress, ignoring request');
            if (this.debugger) this.debugger.warn('create-lobby already in progress');
            return;
        }

        const socket = getSocket();
        
        //  CRITICAL: Check socket connection status first
        if (!socket || !socket.connected) {
            console.error('[OnlineConfigScene] Socket not connected, cannot create lobby');
            if (this.debugger) this.debugger.error('create-lobby failed: socket not connected');
            GlobalAlerts.show(this, t('ONLINE_CONN_LOST', 'Connection lost. Please reconnect and try again.'), 'error');
            return;
        }

        //  IMPROVEMENT: Validate user data before attempting creation
        let userId = socket.data?.user?.id || socket.userId;
        let userName = socket.data?.user?.name;
        
        if (!userId) {
            try {
                const cached = JSON.parse(localStorage.getItem('fives_user') || '{}');
                userId = cached.id || null;
                userName = userName || cached.name || cached.username || null;
            } catch (e) {
                console.warn('[OnlineConfigScene] Failed to get cached user:', e);
            }
        }
        
        if (!userId) {
            console.error('[OnlineConfigScene] No user ID available, cannot create lobby');
            if (this.debugger) this.debugger.error('create-lobby failed: missing user id');
            GlobalAlerts.show(this, t('ONLINE_AUTH_NO_USERID', 'Authentication error: User ID not available. Please log out and log in again.'), 'error');
            return;
        }
        
        if (!userName) {
            console.warn('[OnlineConfigScene] Warning: User name not available, using ID fallback');
            if (this.debugger) this.debugger.warn('create-lobby missing user name');
            userName = `User${userId.substring(0, 6)}`;
        }

        this.creatingLobby = true;

        // Change button to orange "Creating..." state
        this.createLobbyBtn.setText(this._labelCreatingLobby || t('ONLINE_CONFIG_CREATING_LOBBY', 'Creating Lobby...'));
        this.createLobbyBtn.setFill('#ffaa00');
        this.createLobbyBtn.setAlpha(0.7);
        this.createLobbyBtn.disableInteractive();

        const socketHasAuth = socket.data?.user?.id ? true : false;
        if (this.debugger) this.debugger.log('create-lobby start', { socketConnected: socket.connected, hasAuth: socketHasAuth });

        // Set up listener for lobby creation response
        const handleLobbyCreated = (data) => {
            if (this.debugger) this.debugger.log('lobby-created', { code: data?.code });
            socket.off('lobby-created', handleLobbyCreated);
            socket.off('create-failed', handleCreateFailed);
            
            // Redirect to OnlineLobbyScene with the lobby code
            this.scene.start('OnlineLobbyScene', { code: data.code });
        };

        const handleCreateFailed = (error) => {
            console.error('[OnlineConfigScene] Lobby creation failed:', error);
            if (this.debugger) this.debugger.warn('lobby-create failed', { error });
            socket.off('lobby-created', handleLobbyCreated);
            socket.off('create-failed', handleCreateFailed);
            
            //  IMPROVEMENT: Better error messages based on failure reason
            let errorMsg = t('ONLINE_CREATE_FAILED', 'Failed to create lobby.');
            if (typeof error === 'string') {
                if (error.includes('auth')) {
                    errorMsg = t('ONLINE_AUTH_RETRY', 'Authentication error: Please try logging in again.');
                } else if (error.includes('server')) {
                    errorMsg = t('ONLINE_SERVER_ERROR', 'Server error: Please try again later.');
                } else if (error.includes('config')) {
                    errorMsg = t('ONLINE_INVALID_CONFIG', 'Invalid lobby configuration. Please check your settings.');
                } else {
                    errorMsg = tf('ONLINE_ERROR_GENERIC', 'Error: {0}', error);
                }
            } else if (typeof error === 'object' && error.reason) {
                errorMsg = tf('ONLINE_ERROR_REASON', 'Error: {0}', error.reason);
            }
            
            GlobalAlerts.show(this, errorMsg, 'error');
            this.resetCreateLobbyButton();
        };

        // Try to re-authenticate if socket doesn't have auth
        if (!socketHasAuth) {
            console.warn('[OnlineConfigScene] Socket not authenticated, attempting auth...');
            if (this.debugger) this.debugger.warn('socket not authenticated, attempting auth');

            // Try to re-authenticate using cached user
            const cachedUser = JSON.parse(localStorage.getItem('fives_user') || '{}');
            if (cachedUser.id) {
                let authTimeout = null;
                
                // Set up listener for auth-success BEFORE emitting
                const handleAuthSuccess = (data) => {
                    if (this.debugger) this.debugger.log('socket auth success', { id: data?.user?.id });
                    
                    // Clear timeout immediately
                    if (authTimeout) {
                        clearTimeout(authTimeout);
                        authTimeout = null;
                    }
                    
                    // Remove auth listeners
                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);
                    
                    // Set up listeners for lobby creation
                    socket.once('lobby-created', handleLobbyCreated);
                    socket.once('create-failed', handleCreateFailed);
                    
                    // Socket is now authenticated, emit create-lobby
                    const payload = {
                        players: this.selectedPlayers,
                        rounds: this.selectedRounds,
                        combos: this.comboRules,
                        multiplex: this.multiplexRules,
                        teamsEnabled: this.teamsEnabled,
                        teams: this.teamsEnabled ? this.playerTeams.slice(0, this.selectedPlayers) : []
                    };
                    if (this.debugger) this.debugger.log('emit create-lobby', payload);
                    socket.emit('create-lobby', payload);
                };

                const handleAuthFailed = (error) => {
                    console.error('[OnlineConfigScene] Socket authentication failed:', error);
                    if (this.debugger) this.debugger.warn('socket auth failed', { error });
                    
                    // Clear timeout immediately
                    if (authTimeout) {
                        clearTimeout(authTimeout);
                        authTimeout = null;
                    }
                    
                    // Remove listeners
                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);
                    
                    this.resetCreateLobbyButton();
                };

                // Register listeners
                socket.once('auth-success', handleAuthSuccess);
                socket.once('auth-failed', handleAuthFailed);

                // Emit auth with force=true to re-authenticate
                emitAuthUser({
                    id: cachedUser.id,
                    name: cachedUser.name || cachedUser.username,
                    type: cachedUser.type,
                    email: cachedUser.email || null,
                    profile: cachedUser.profile || null,
                    created_at: cachedUser.created_at,
                    updated_at: cachedUser.updated_at
                }, true);

                // Set timeout as fallback (in case events don't fire)
                authTimeout = setTimeout(() => {
                    console.warn('[OnlineConfigScene] Auth event timeout, checking socket state...');
                    if (this.debugger) this.debugger.warn('auth timeout, checking socket state');
                    
                    // Remove listeners if they haven't fired
                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);
                    
                    const newSocketAuth = socket.data?.user?.id ? true : false;
                    if (newSocketAuth) {
                        if (this.debugger) this.debugger.log('auth recovered, emitting create-lobby');
                        
                        // Set up listeners for lobby creation
                        socket.once('lobby-created', handleLobbyCreated);
                        socket.once('create-failed', handleCreateFailed);
                        
                        const payload = {
                            players: this.selectedPlayers,
                            rounds: this.selectedRounds,
                            combos: this.comboRules,
                            multiplex: this.multiplexRules,
                            teamsEnabled: this.teamsEnabled,
                            teams: this.teamsEnabled ? this.playerTeams.slice(0, this.selectedPlayers) : []
                        };
                        socket.emit('create-lobby', payload);
                    } else {
                        console.error('[OnlineConfigScene] Socket authentication failed after timeout');
                        if (this.debugger) this.debugger.error('auth failed after timeout');
                        this.resetCreateLobbyButton();
                    }
                }, 1500);
            } else {
                console.error('[OnlineConfigScene] No cached user, cannot create lobby');
                if (this.debugger) this.debugger.error('create-lobby failed: no cached user');
                this.resetCreateLobbyButton();
            }
        } else {
            // Socket is already authenticated, emit create-lobby immediately
            if (this.debugger) this.debugger.log('socket already authenticated, emitting create-lobby');
            
            // Set up listeners for lobby creation
            socket.once('lobby-created', handleLobbyCreated);
            socket.once('create-failed', handleCreateFailed);
            
            const payload = {
                players: this.selectedPlayers,
                rounds: this.selectedRounds,
                combos: this.comboRules,
                multiplex: this.multiplexRules,
                teamsEnabled: this.teamsEnabled,
                teams: this.teamsEnabled ? this.playerTeams.slice(0, this.selectedPlayers) : []
            };
            if (this.debugger) this.debugger.log('emit create-lobby', payload);
            socket.emit('create-lobby', payload);
        }
    }

    resetCreateLobbyButton() {
        this.createLobbyBtn.setText(this._labelCreateLobby || t('ONLINE_CONFIG_CREATE_LOBBY', 'Create Lobby!'));
        this.createLobbyBtn.setFill('#66ff66');
        this.createLobbyBtn.setAlpha(1);
        this.createLobbyBtn.setInteractive({ useHandCursor: true });
        this.creatingLobby = false;
    }

    shutdown() {
        //  FIX: Clean up any pending socket listeners when scene shuts down
        const socket = getSocket();
        if (socket) {
            socket.off('lobby-created');
            socket.off('create-failed');
            socket.off('auth-success');
            socket.off('auth-failed');
        }
    }

    destroy() {
        this.shutdown();
    }

    refreshScene() {
        this.scene.restart({
            players: this.selectedPlayers,
            rounds: this.selectedRounds,
            combos: this.comboRules,
            multiplex: this.multiplexRules,
            teamsEnabled: this.teamsEnabled,
            teams: this.playerTeams.slice(0, this.selectedPlayers)
        });
    }
}
