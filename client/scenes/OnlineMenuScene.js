import { getSocket, getServerUrl, probeHealth, connectTo, emitAuthUser } from '../utils/SocketManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class OnlineMenuScene extends Phaser.Scene {
    constructor() {
        super('OnlineMenuScene');
        this.user = null;
        this.joinInput = null;
        this.avatar = null;
        this.accountText = null;
        this.lobbyUIElements = [];
        this.signInText = null;
        this._onAuthUpdated = null;
        this._layout = null;
    }

    async create() {
        try {
          ErrorHandler.setScene(this);
        } catch (e) {}
	    try {
          GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const layout = this.getLayout();
        this._layout = layout;

        const backBtn = this.add.text(layout.centerX, layout.backY, t('UI_BACK', '<- BACK'), {
            fontSize: 26,
            fontFamily: '"Press Start 2P", cursive',
            color: '#ff6666'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });

        this.add.text(layout.centerX, layout.titleY, t('ONLINE_TITLE', 'Online Mode'), {
            fontSize: '52px',
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        // Initialize socket connection
        const socket = getSocket();
        const server = getServerUrl();
        
        // Check if socket is already connected - if so, proceed immediately
        let socketReady = socket && socket.connected;
        
        // If not connected, wait for connection with extended timeout for Vercel polling delays
        if (!socketReady && socket) {
            socketReady = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.warn('[OnlineMenuScene] Socket connection timeout after 8 seconds');
                    resolve(false);
                }, 8000);
                
                const onConnect = () => {
                    clearTimeout(timeout);
                    socket.off('connect', onConnect);
                    resolve(true);
                };
                
                const onError = () => {
                    clearTimeout(timeout);
                    socket.off('connect', onConnect);
                    socket.off('connect_error', onError);
                    resolve(false);
                };
                
                socket.on('connect', onConnect);
                socket.on('connect_error', onError);
            });
        }

        if (!socketReady) {
            try {
                // Probe health to determine if server is actually down
                const healthy = await probeHealth();
                if (!healthy) {
                    this.add.text(600, 150, t('ONLINE_SERVER_UNAVAILABLE_TITLE', 'Server Unavailable'), {
                        fontSize: 32, color: "#ff4444"
                    }).setOrigin(0.5);
                    this.add.text(600, 200, t('ONLINE_SERVER_UNAVAILABLE_BODY1', 'Online mode currently not available.'), {
                        fontSize: 20, color: "#ffaa88"
                    }).setOrigin(0.5);
                    this.add.text(600, 240, t('ONLINE_SERVER_UNAVAILABLE_BODY2', 'Please try again later.'), {
                        fontSize: 18, color: "#cccccc"
                    }).setOrigin(0.5);
                    return;
                }
                
                // Server is healthy but socket won't connect - might be Vercel timeout
                this.add.text(600, 150, t('ONLINE_CONNECTION_SLOW_TITLE', 'Connection Slow'), {
                    fontSize: 32, color: "#ffaa00"
                }).setOrigin(0.5);
                this.add.text(600, 200, t('ONLINE_CONNECTION_SLOW_BODY1', 'Server is responding but socket connection is slow.'), {
                    fontSize: 18, color: "#ffccaa"
                }).setOrigin(0.5);
                this.add.text(600, 240, t('ONLINE_CONNECTION_SLOW_BODY2', 'This may be a temporary network issue. Try again.'), {
                    fontSize: 16, color: "#cccccc"
                }).setOrigin(0.5);
                return;
            } catch (e) {
                console.error('[OnlineMenuScene] Health check error:', e);
                this.add.text(600, 150, t('ONLINE_CONNECTION_FAILED_TITLE', 'Connection Failed'), {
                    fontSize: 32, color: "#ff4444"
                }).setOrigin(0.5);
                this.add.text(600, 200, t('ONLINE_CONNECTION_FAILED_BODY1', 'Unable to reach the server.'), {
                    fontSize: 20, color: "#ffaa88"
                }).setOrigin(0.5);
                this.add.text(600, 240, t('ONLINE_CONNECTION_FAILED_BODY2', 'Check your internet connection and try again.'), {
                    fontSize: 16, color: "#cccccc"
                }).setOrigin(0.5);
                return;
            }
        }

        // Socket is ready, establish connection to ensure session is current
        connectTo(server);
        
        // Wait for socket to actually connect before trying to refresh auth
        const socketToUse = getSocket();
        if (socketToUse && !socketToUse.connected) {
            console.log('[OnlineMenuScene] Waiting for socket to connect before loading auth...');
            await new Promise((resolve) => {
                const onConnect = () => {
                    console.log('[OnlineMenuScene] Socket connected, loading auth...');
                    socketToUse.off('connect', onConnect);
                    socketToUse.off('disconnect', onDisconnect);
                    resolve();
                };
                const onDisconnect = () => {
                    console.warn('[OnlineMenuScene] Socket disconnected while waiting for auth');
                    socketToUse.off('connect', onConnect);
                    socketToUse.off('disconnect', onDisconnect);
                    resolve(); // continue anyway
                };
                socketToUse.once('connect', onConnect);
                socketToUse.once('disconnect', onDisconnect);
            });
        }

        // server appears available — load cached/remote auth
        await this.refreshAuth();
        this.buildUI();

        // Listen for auth changes (login/logout)
        // Use a single bound handler so we can remove it cleanly later
        this._onAuthUpdated = async () => {
            await this.refreshAuth();
            this.clearAllUI(); // clear previous visuals
            this.buildUI();
        };
        this.game.events.on("auth-updated", this._onAuthUpdated);

        // Ensure cleanup on scene shutdown
        this.events.once('shutdown', () => {
            // Destroy DOM elements
            if (this.joinInput) {
                this.joinInput.destroy();
                this.joinInput = null;
            }
            if (this.avatar) { this.avatar.destroy(); this.avatar = null; }
            if (this.accountText) { this.accountText.destroy(); this.accountText = null; }
            if (this.signInText) { this.signInText.destroy(); this.signInText = null; }
            this.clearLobbyUI();

            // Remove auth listener
            if (this._onAuthUpdated) {
                this.game.events.off("auth-updated", this._onAuthUpdated);
                this._onAuthUpdated = null;
            }
        });
    }

    // central UI cleanup used before rebuilding
    clearAllUI() {
        if (this.avatar) { this.avatar.destroy(); this.avatar = null; }
        if (this.accountText) { this.accountText.destroy(); this.accountText = null; }
        if (this.signInText) { this.signInText.destroy(); this.signInText = null; }
        this.clearLobbyUI();
        if (this.joinInput) {
            this.joinInput.destroy();
            this.joinInput = null;
        }
    }

    buildUI() {
        // clear any previous UI to prevent duplicates
        this.clearAllUI();
        const layout = this._layout || this.getLayout();
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const menuFont = '"Press Start 2P", cursive';

        // Authorise user (tell server who we are)
        if (this.user) {
            const socket = getSocket();
            try {
                socket.emit("auth-user", {
                    id: this.user.id,
                    name: this.user.name,
                    type: this.user.type,
                    avatar: this.user.avatar || null
                });
            } catch (e) {
                console.warn('Socket emit failed:', e);
            }
        }

        // Top-right username / avatar
        const isGuest = this.user?.type === 'guest';
        const avatarTexture = (this.user?.avatar && !isGuest) ? this.user.avatar : 'playerIcon';
        const accountTextX = this.cameras.main.width - 40;
        const accountY = 40;

        if (this.user) {
            this.avatar = this.add.image(accountTextX - 160, accountY, avatarTexture)
                .setOrigin(0.5, 0.5)
                .setScale(0.5)
                .setInteractive({ useHandCursor: true });
            this.avatar.on('pointerdown', () => this.openAccountPopup());
        }

        const labelText = this.user ? this.user.name : t('ONLINE_NOT_SIGNED_IN', 'Not signed in');
        this.accountText = this.add.text(accountTextX, accountY, labelText, {
            fontSize: 20,
            fontFamily: menuFont,
            color: '#ffffff'
        }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
        this.accountText.on('pointerdown', () => this.openAccountPopup());

        // Main menu buttons (always visible)
        const loadoutBtn = this.add.text(layout.centerX, layout.loadoutY, t('LOCAL_MENU_MY_LOADOUTS', 'My Loadouts'), {
            fontFamily: menuFont,
            fontSize: '30px'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        loadoutBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineLoadoutScene');
        });

        const leaderboardBtn = this.add.text(layout.centerX, layout.leaderboardY, t('ONLINE_LEADERBOARD', 'Leaderboard'), {
            fontFamily: menuFont,
            fontSize: '30px'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        leaderboardBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            if (this.scene.get('LeaderboardScene')) {
                this.scene.start('LeaderboardScene');
            } else {
                GlobalAlerts.show(this, t('ONLINE_LEADERBOARD_MISSING', 'Leaderboard scene not available yet.'), 'info');
            }
        });

        this.lobbyUIElements.push(loadoutBtn, leaderboardBtn);

        // If logged in: show join input & lobby controls; otherwise show sign-in prompt
        if (this.user) {
            // Join input for logged-in users
            this.joinInput = this.add.dom(layout.centerX, layout.lobbyJoinInputY, 'input', {
                width: '200px',
                fontSize: '20px',
                padding: '6px',
                background: 'transparent',
                outline: 'none',
                color: '#fff'
            });

            // Build lobby buttons dynamically
            this.buildLobbyUI(layout);
        } else {
            // Show sign-in text if no user
            this.signInText = this.add.text(layout.centerX, layout.lobbyCreateY, t('ONLINE_SIGN_IN_PROMPT', 'Please sign in to play online'), {
                fontSize: 22,
                fontFamily: menuFont,
                color: '#cccccc'
            }).setOrigin(0.5);

            const signInBtn = this.add.text(layout.centerX, layout.lobbyJoinBtnY, t('ONLINE_SIGN_IN_ACTION', 'Sign In'), {
                fontSize: 24,
                fontFamily: menuFont,
                color: '#66aaff'
            }).setOrigin(0.5).setInteractive({ useHandCursor: true });

            signInBtn.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.openAccountPopup();
            });

            this.lobbyUIElements.push(signInBtn);
        }
    }

    buildLobbyUI(layout) {
        const socket = getSocket();
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const menuFont = '"Press Start 2P", cursive';

        // Create Lobby button
        const createBtn = this.add.text(layout.centerX, layout.lobbyCreateY, t('ONLINE_CREATE_LOBBY', 'Create Lobby'), {
                fontFamily: menuFont,
                fontSize: 28,
                color: '#66ff66'
            })
            .setOrigin(0.5).setInteractive();
        createBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineConfigScene');
        });

        // Join Lobby button
        const joinBtn = this.add.text(layout.centerX, layout.lobbyJoinBtnY, t('ONLINE_JOIN_LOBBY', 'Join Lobby'), {
                fontFamily: menuFont,
                fontSize: 26,
                color: '#66aaff'
            })
            .setOrigin(0.5).setInteractive();
        
        // State for join button to prevent multiple simultaneous requests
        let joiningLobby = false;
        let joinTimeout = null;

        const resetJoinButton = () => {
            joiningLobby = false;
            if (joinTimeout) {
                clearTimeout(joinTimeout);
                joinTimeout = null;
            }
            joinBtn.setText(t('ONLINE_JOIN_LOBBY', 'Join Lobby'));
            joinBtn.setFill('#66aaff');
            joinBtn.setAlpha(1.0);
            joinBtn.setInteractive();
        };

        joinBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            
            // Guard against multiple simultaneous requests
            if (joiningLobby) {
                console.warn('[OnlineMenuScene] Join already in progress, ignoring request');
                return;
            }

            // ✅ CRITICAL: Check socket connection status first
            const socket = getSocket();
            if (!socket || !socket.connected) {
                console.error('[OnlineMenuScene] Socket not connected, cannot join lobby');
                GlobalAlerts.show(this, t('ONLINE_CONNECTION_LOST', 'Connection lost. Please reconnect and try again.'), 'error');
                return;
            }

            if (!this.joinInput) return;
            const code = (this.joinInput.node.value || "").trim().toUpperCase();
            
            // Validate code format (should be 4-6 characters, alphanumeric)
            if (!code || code.length < 4 || code.length > 6 || !/^[A-Z0-9]+$/.test(code)) {
                console.warn('[OnlineMenuScene] Invalid code format:', code);
                GlobalAlerts.show(this, t('ONLINE_INVALID_CODE', 'Please enter a valid lobby code (4-6 characters, letters and numbers only).'), 'warning');
                return;
            }

            joiningLobby = true;
            joinBtn.setText(t('ONLINE_JOINING_LOBBY', 'Joining Lobby...'));
            joinBtn.setFill('#ffaa00');
            joinBtn.setAlpha(0.7);
            joinBtn.disableInteractive();

            try { 
                let myId = null;
                try { myId = socket.data?.user?.id || socket.userId || null; } catch (e) { myId = null; }
                if (!myId) {
                  try {
                    const raw = localStorage.getItem('protodice_user');
                    if (raw) {
                      const cached = JSON.parse(raw);
                      if (cached && cached.id) myId = cached.id;
                    }
                  } catch (e) {}
               }
                
               if (!myId) {
                   console.error('[OnlineMenuScene] Could not get user ID, cannot join lobby');
                   GlobalAlerts.show(this, t('ONLINE_AUTH_ERROR', 'Authentication error: Could not get your user ID. Please refresh and try again.'), 'error');
                   resetJoinButton();
                   return;
               }

               const performJoin = () => {
                 console.log('[OnlineMenuScene] Joining lobby:', code);
                 socket.emit('join-lobby', code, myId);
               };
               
               // Check if socket is already authenticated
               if (socket.data?.user?.id) {
                 console.log('[OnlineMenuScene] Socket already authenticated, joining immediately');
                 performJoin();
               } else {
                 let authWaitTimeout = null;
                 const onAuthSuccess = () => {
                   console.log('[OnlineMenuScene] Auth-success received, now joining lobby');
                   if (authWaitTimeout) clearTimeout(authWaitTimeout);
                   socket.off('auth-success', onAuthSuccess);
                   performJoin();
                 };
                 
                 socket.once('auth-success', onAuthSuccess);
                 
                 // Timeout in case auth-success never fires (fallback to join anyway with userId param)
                 authWaitTimeout = setTimeout(() => {
                   console.warn('[OnlineMenuScene] Auth-success timeout, joining anyway with fallback');
                   socket.off('auth-success', onAuthSuccess);
                   performJoin();
                 }, 2000);
               }
               
               // Set timeout as fallback (in case events don't fire)
               joinTimeout = setTimeout(() => {
                   console.warn('[OnlineMenuScene] Join response timeout, resetting button state');
                   socket.off('join-success', handleJoinSuccess);
                   socket.off('join-failed', handleJoinFailed);
                   GlobalAlerts.show(this, t('ONLINE_JOIN_TIMEOUT', 'Join request timed out. Please try again.'), 'warning');
                   resetJoinButton();
               }, 5000);
            } catch (e) { 
                console.warn('[OnlineMenuScene] emit failed', e);
                GlobalAlerts.show(this, t('ONLINE_JOIN_FAILED_SEND', 'Failed to send join request. Please try again.'), 'warning');
                resetJoinButton();
            }
        });

        //         // socket handlers for join events with proper cleanup
        const handleJoinSuccess = (data) => {
            console.log('[OnlineMenuScene] Join successful:', data);
            // Clear timeout immediately
            if (joinTimeout) {
                clearTimeout(joinTimeout);
                joinTimeout = null;
            }
            // Remove listener
            socket.off('join-failed', handleJoinFailed);
            
            // ✅ CRITICAL FIX: Ensure socket.data exists first
            if (!socket.data) {
                socket.data = {};
            }
            
            // ✅ CRITICAL FIX: Ensure socket user data is populated from join response
            // Server sends currentUser which was populated after join
            if (data.currentUser && data.currentUser.id) {
                socket.data.user = {
                    id: data.currentUser.id,
                    name: data.currentUser.name
                };
                socket.userId = data.currentUser.id;
                console.log('[OnlineMenuScene] ✅ Set socket.data.user from join response:', data.currentUser.name);
            } else if ((!socket.data.user || !socket.data.user.id) && data.players && data.players.length > 0) {
                // Fallback: Extract from players list if currentUser not provided
                try {
                    let myId = null;
                    try { myId = socket.data?.user?.id || socket.userId || null; } catch (e) { myId = null; }
                    if (!myId) {
                        try {
                            const raw = localStorage.getItem('protodice_user');
                            if (raw) {
                                const cached = JSON.parse(raw);
                                if (cached && cached.id) myId = cached.id;
                            }
                        } catch (e) {}
                    }
                    
                    if (myId) {
                        // Find the current player in the response
                        const myPlayer = data.players.find(p => String(p.id) === String(myId));
                        if (myPlayer) {
                            // Populate socket.data.user with player info from lobby
                            if (!socket.data.user) {
                                socket.data.user = {};
                            }
                            socket.data.user.id = myPlayer.id;
                            socket.data.user.name = myPlayer.name;
                            socket.userId = myPlayer.id;
                            console.log('[OnlineMenuScene] ✅ Populated socket.data.user from players list:', myPlayer.name);
                        }
                    }
                } catch (e) {
                    console.warn('[OnlineMenuScene] Failed to populate socket user data:', e);
                }
            }
            
            this.scene.start('OnlineLobbyScene', { code: data.code });
        };

        const handleJoinFailed = (error) => {
            console.error('[OnlineMenuScene] Join failed:', error);
            // Clear timeout immediately
            if (joinTimeout) {
                clearTimeout(joinTimeout);
                joinTimeout = null;
            }
            // Remove listener
            socket.off('join-success', handleJoinSuccess);
            GlobalAlerts.show(this, t('ONLINE_JOIN_FAILED', 'Failed to join lobby (wrong code or full). Please try again.'), 'error');
            resetJoinButton();
        };

        try {
            socket.once('join-success', handleJoinSuccess);
            socket.once('join-failed', handleJoinFailed);
        } catch (e) {
            console.warn('[OnlineMenuScene] Socket once failed', e);
        }

        // Track elements for easy clearing
        this.lobbyUIElements.push(createBtn, joinBtn);
    }

    clearLobbyUI() {
        this.lobbyUIElements.forEach(el => { try { el.destroy(); } catch (e) {} });
        this.lobbyUIElements = [];
        if (this.joinInput) {
            try { this.joinInput.destroy(); } catch (e) {}
            this.joinInput = null;
        }
    }

    async refreshAuth() {
        const socketLibAvailable = (typeof io === 'function');
        if (socketLibAvailable) {
            try {
                const server = getServerUrl();
                const resp = await fetch(`${server.replace(/\/$/, '')}/auth/me`, { credentials: 'include' });
                const data = await resp.json();
                if (data?.ok && data.user) {
                    this.user = data.user;
                    delete this.user.socketId;
                    emitAuthUser(this.user);
                    const socket = getSocket();
                    if (socket && this.user && this.user.id) {
                        socket.userId = this.user.id;
                        console.log('[OnlineMenuScene] Set socket.userId from server auth:', socket.userId);
                    }
                    return;
                }
            } catch (err) {
                console.warn('Auth check failed (server):', err);
            }
        }

        // fallback: localStorage cached user
        try {
            const raw = localStorage.getItem('protodice_us');
            if (raw) {
                this.user = JSON.parse(raw);
                delete this.user.socketId;
                emitAuthUser(this.user);
                const socket = getSocket();
                if (socket && this.user && this.user.id) {
                    socket.userId = this.user.id;
                    console.log('[OnlineMenuScene] Set socket.userId from cached auth:', socket.userId);
                }
                return;
            }
        } catch (err) {
            console.warn('Corrupt local user cache', err);
            localStorage.removeItem('protodice_us');
        }

        this.user = null;
    }

    _emitAuthToSocket(user) {
        try {
            if (!user || !user.id) return;
            const socket = getSocket && typeof getSocket === 'function' ? getSocket() : null;
            if (socket && socket.emit) {
                const userWithSocket = {
                    ...user,
                    socketId: socket.id || null
                };
                console.log('[OnlineMenuScene] Emitting auth-user to socket:', user.name, 'socketId:', socket.id);
                socket.emit('auth-user', userWithSocket);
                socket.userId = user.id;
            }
        } catch (e) {
            console.warn('[OnlineMenuScene] Failed to emit auth-user:', e);
        }
    }

    getUserLabel() {
        return this.user ? this.user.name : GlobalLocalization.t('ONLINE_NOT_SIGNED_IN', 'Not signed in');
    }

    openAccountPopup() {
        try {
            GlobalAudio.playButton(this);
        } catch (e) {}
        this.scene.launch('OnlineAccountScene', { returnTo: 'OnlineMenuScene' });
        this.scene.pause();
    }

    getLayout() {
        const cam = this.cameras.main;
        const centerX = cam.centerX;
        const lobbyStartY = Math.max(520, cam.height - 400);
        return {
            centerX,
            titleY: 80,
            loadoutY: 220,
            leaderboardY: 310,
            lobbyCreateY: lobbyStartY,
            lobbyJoinInputY: lobbyStartY + 60,
            lobbyJoinBtnY: lobbyStartY + 120,
            backY: Math.min(lobbyStartY + 200, cam.height - 80)
        };
    }
}
