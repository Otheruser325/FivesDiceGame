import { getSocket, emitAuthUser } from '../utils/SocketManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';

export default class OnlineConfigScene extends Phaser.Scene {
    constructor() {
        super({ key: 'OnlineConfigScene' });

        this.selectedPlayers = 2;
        this.selectedRounds = 20;
        this.comboRules = false;
        this.teamsEnabled = false;
        this.playerTeams = ['blue', 'red', 'blue', 'red', 'blue', 'red'];
        this.createLobbyBtn = null;
        this.creatingLobby = false;
        this.boundHandlers = {};
    }

    init(data) {
        if (data.players) this.selectedPlayers = data.players;
        if (data.rounds) this.selectedRounds = data.rounds;
        if (typeof data.combos === "boolean") this.comboRules = data.combos;
        if (typeof data.teamsEnabled === "boolean") this.teamsEnabled = data.teamsEnabled;
        if (Array.isArray(data.teams)) this.playerTeams = data.teams;
        this.creatingLobby = false;
    }

    create() {
        ErrorHandler.setScene(this);
        this.add.text(600, 60, 'Online Game Configuration', { fontSize: 40 }).setOrigin(0.5);

        // PLAYERS COUNT
        this.add.text(600, 120, 'How many players?', { fontSize: 28 }).setOrigin(0.5);

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
        this.add.text(600, 360, 'How many rounds?', {
            fontSize: 28
        }).setOrigin(0.5);

        const roundOptions = [10, 15, 20, 25, 30];
        roundOptions.forEach((r, i) => {
            const btn = this.add.text(600, 400 + i * 40, `${r} rounds`, {
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
        this.add.text(600, 620, 'Additional rules:', {
            fontSize: 26
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(
            600,
            660,
            `More points for combos: ${this.comboRules ? "YES" : "NO"}`,
            { fontSize: 24, color: this.comboRules ? '#66aaff' : '#ff6666' }
        )
            .setOrigin(0.5)
            .setInteractive();

        this.comboBtn.on('pointerdown', () => {
            this.comboRules = !this.comboRules;
            this.refreshScene();
        });

        // TEAMS MODE
        this.teamsBtn = this.add.text(
            600,
            700,
            `Teams: ${this.teamsEnabled ? "ON" : "OFF"}`,
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
            this.add.text(600, 740, "Team Assignment:", { fontSize: 22, color: "#ffaa44" }).setOrigin(0.5);
            
            let teamConfigY = 775;
            for (let i = 0; i < this.selectedPlayers; i++) {
                const team = this.playerTeams[i] || 'blue';
                const teamColor = team === 'blue' ? '#66aaff' : '#ff6666';
                
                this.add.text(400, teamConfigY, `Player ${i + 1}:`, { fontSize: 18 }).setOrigin(0.5);
                
                const teamBtn = this.add.text(600, teamConfigY, team.toUpperCase(), {
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
                
                teamConfigY += 30;
            }
        }

        // CREATE LOBBY with socket auth and state management
        this.createLobbyBtn = this.add.text(600, 750, 'Create Lobby!', {
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
        const backBtn = this.add.text(80, 800, '← Back', {
            fontSize: 24,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineMenuScene');
        });
    }

    onAuthSuccess(data) {
        console.log('[OnlineConfigScene] Authentication successful:', data);
    }

    onAuthFailure(error) {
        console.error('[OnlineConfigScene] Authentication failed:', error);
    }

    handleCreateLobby() {
        // Guard against multiple simultaneous requests
        if (this.creatingLobby) {
            console.warn('[OnlineConfigScene] Create lobby already in progress, ignoring request');
            return;
        }

        const socket = getSocket();
        
        // ✅ CRITICAL: Check socket connection status first
        if (!socket || !socket.connected) {
            console.error('[OnlineConfigScene] Socket not connected, cannot create lobby');
            GlobalAlerts.show(this, 'Connection lost. Please reconnect and try again.', 'error');
            return;
        }

        // ✅ IMPROVEMENT: Validate user data before attempting creation
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
            GlobalAlerts.show(this, 'Authentication error: User ID not available. Please log out and log in again.', 'error');
            return;
        }
        
        if (!userName) {
            console.warn('[OnlineConfigScene] Warning: User name not available, using ID fallback');
            userName = `User${userId.substring(0, 6)}`;
        }

        this.creatingLobby = true;

        // Change button to orange "Creating..." state
        this.createLobbyBtn.setText('Creating Lobby...');
        this.createLobbyBtn.setFill('#ffaa00');
        this.createLobbyBtn.setAlpha(0.7);
        this.createLobbyBtn.disableInteractive();

        const socketHasAuth = socket.data?.user?.id ? true : false;
        console.log('[OnlineConfigScene] handleCreateLobby - Socket connected:', socket.connected, 'Has auth:', socketHasAuth);

        // Set up listener for lobby creation response
        const handleLobbyCreated = (data) => {
            console.log('[OnlineConfigScene] Lobby created:', data);
            socket.off('lobby-created', handleLobbyCreated);
            socket.off('create-failed', handleCreateFailed);
            
            // Redirect to OnlineLobbyScene with the lobby code
            this.scene.start('OnlineLobbyScene', { code: data.code });
        };

        const handleCreateFailed = (error) => {
            console.error('[OnlineConfigScene] Lobby creation failed:', error);
            socket.off('lobby-created', handleLobbyCreated);
            socket.off('create-failed', handleCreateFailed);
            
            // ✅ IMPROVEMENT: Better error messages based on failure reason
            let errorMsg = 'Failed to create lobby.';
            if (typeof error === 'string') {
                if (error.includes('auth')) {
                    errorMsg = 'Authentication error: Please try logging in again.';
                } else if (error.includes('server')) {
                    errorMsg = 'Server error: Please try again later.';
                } else if (error.includes('config')) {
                    errorMsg = 'Invalid lobby configuration. Please check your settings.';
                } else {
                    errorMsg = `Error: ${error}`;
                }
            } else if (typeof error === 'object' && error.reason) {
                errorMsg = `Error: ${error.reason}`;
            }
            
            GlobalAlerts.show(this, errorMsg, 'error');
            this.resetCreateLobbyButton();
        };

        // Try to re-authenticate if socket doesn't have auth
        if (!socketHasAuth) {
            console.warn('[OnlineConfigScene] Socket not authenticated, attempting auth...');

            // Try to re-authenticate using cached user
            const cachedUser = JSON.parse(localStorage.getItem('fives_user') || '{}');
            if (cachedUser.id) {
                let authTimeout = null;
                
                // Set up listener for auth-success BEFORE emitting
                const handleAuthSuccess = (data) => {
                    console.log('[OnlineConfigScene] Socket authenticated successfully:', data.user);
                    
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
                        teamsEnabled: this.teamsEnabled,
                        teams: this.teamsEnabled ? this.playerTeams.slice(0, this.selectedPlayers) : []
                    };
                    console.log('[OnlineConfigScene] Emitting create-lobby:', payload);
                    socket.emit('create-lobby', payload);
                };

                const handleAuthFailed = (error) => {
                    console.error('[OnlineConfigScene] Socket authentication failed:', error);
                    
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
                    
                    // Remove listeners if they haven't fired
                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);
                    
                    const newSocketAuth = socket.data?.user?.id ? true : false;
                    if (newSocketAuth) {
                        console.log('[OnlineConfigScene] Socket is authenticated (timeout fired but socket valid), emitting create-lobby');
                        
                        // Set up listeners for lobby creation
                        socket.once('lobby-created', handleLobbyCreated);
                        socket.once('create-failed', handleCreateFailed);
                        
                        const payload = {
                            players: this.selectedPlayers,
                            rounds: this.selectedRounds,
                            combos: this.comboRules,
                            teamsEnabled: this.teamsEnabled,
                            teams: this.teamsEnabled ? this.playerTeams.slice(0, this.selectedPlayers) : []
                        };
                        socket.emit('create-lobby', payload);
                    } else {
                        console.error('[OnlineConfigScene] Socket authentication failed after timeout');
                        this.resetCreateLobbyButton();
                    }
                }, 1500);
            } else {
                console.error('[OnlineConfigScene] No cached user, cannot create lobby');
                this.resetCreateLobbyButton();
            }
        } else {
            // Socket is already authenticated, emit create-lobby immediately
            console.log('[OnlineConfigScene] Socket already authenticated, emitting create-lobby');
            
            // Set up listeners for lobby creation
            socket.once('lobby-created', handleLobbyCreated);
            socket.once('create-failed', handleCreateFailed);
            
            const payload = {
                players: this.selectedPlayers,
                rounds: this.selectedRounds,
                combos: this.comboRules,
                teamsEnabled: this.teamsEnabled,
                teams: this.teamsEnabled ? this.playerTeams.slice(0, this.selectedPlayers) : []
            };
            socket.emit('create-lobby', payload);
        }
    }

    resetCreateLobbyButton() {
        this.createLobbyBtn.setText('Create Lobby!');
        this.createLobbyBtn.setFill('#66ff66');
        this.createLobbyBtn.setAlpha(1);
        this.createLobbyBtn.setInteractive({ useHandCursor: true });
        this.creatingLobby = false;
    }

    shutdown() {
        // ✅ FIX: Clean up any pending socket listeners when scene shuts down
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
            teamsEnabled: this.teamsEnabled,
            teams: this.playerTeams.slice(0, this.selectedPlayers)
        });
    }
}