import { getSocket, getServerUrl, probeHealth, connectTo } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';

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
    }

    async create() {
        const backBtn = this.add.text(600, 360, '← Back', {
            fontSize: 28,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });

        this.add.text(600, 60, 'Online Mode', { fontSize: 48 }).setOrigin(0.5);

        // Check server availability: if socket library missing or socket not connected => maintenance view
        const socket = getSocket();
        let serverAvailable = !!(socket && socket.connected);
        if (!serverAvailable) {
          try {
            const healthy = await probeHealth();
            if (!healthy) {
              this.add.text(600, 200, "Online mode currently not available, please try again later.", {
                fontSize: 30, color: "#ff4444"
              }).setOrigin(0.5);
            return;
          } else {
            const server = getServerUrl();
            connectTo(server);
            this.add.text(600, 200, "Server Under Maintenance", {
              fontSize: 38, color: "#ff4444"
            }).setOrigin(0.5);
            this.add.text(600, 240, "Try again later or visit the main site.", {
              fontSize: 20, color: "#cccccc"
            }).setOrigin(0.5);
            return;
          }
        } catch (e) {
            this.add.text(600, 200, "Online mode currently not available, please try again later.", {
              fontSize: 30, color: "#ff4444"
            }).setOrigin(0.5);
            return;
          }
        }

        const server = getServerUrl();
        connectTo(server);

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

        if (this.user) {
            this.avatar = this.add.image(990, 40, avatarTexture).setOrigin(0.5, 0.5).setScale(0.5).setInteractive();
            this.avatar.on('pointerdown', () => this.openAccountPopup());
        }

        const labelText = this.user ? this.user.name : 'Not signed in';
        this.accountText = this.add.text(1020, 40, labelText, {
            fontSize: 28,
            color: '#fff'
        }).setOrigin(0, 0.5).setInteractive();
        this.accountText.on('pointerdown', () => this.openAccountPopup());

        // If logged in: show join input & lobby controls; otherwise show sign-in prompt
        if (this.user) {
            // Join input for logged-in users
            this.joinInput = this.add.dom(600, 270, 'input', {
                width: '200px',
                fontSize: '20px',
                padding: '6px',
                background: 'transparent',
                outline: 'none',
                color: '#fff'
            });

            // Build lobby buttons dynamically
            this.buildLobbyUI();
        } else {
            // Show sign-in text if no user
            this.signInText = this.add.text(600, 200, 'Please sign in to play online', {
                fontSize: 28,
                color: '#cccccc'
            }).setOrigin(0.5);
        }
    }

    buildLobbyUI() {
        const socket = getSocket();

        // Create Lobby button
        const createBtn = this.add.text(600, 180, 'Create Lobby', {
                fontSize: 32,
                color: '#00ff00'
            })
            .setOrigin(0.5).setInteractive();
        createBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineConfigScene');
        });

        // Join Lobby button
        const joinBtn = this.add.text(600, 310, 'Join Lobby', {
                fontSize: 28,
                color: '#33aaff'
            })
            .setOrigin(0.5).setInteractive();
        joinBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            if (!this.joinInput) return;
            const code = (this.joinInput.node.value || "").trim().toUpperCase();
            if (code) {
                try { 
                    let myId = null;
                    try { myId = getSocket().data?.user?.id || getSocket().userId || null; } catch (e) { myId = null; }
                    if (!myId) {
                      try {
                        const raw = localStorage.getItem('fives_user');
                        if (raw) {
                          const cached = JSON.parse(raw);
                          if (cached && cached.id) myId = cached.id;
                        }
                      } catch (e) {}
                   }
                   socket.emit('join-lobby', code, myId);
                } catch (e) { 
                  console.warn('emit failed', e); 
                }
            }
        });

        // socket handlers for one-time join events
        try {
            socket.once('join-success', data => this.scene.start('OnlineLobbyScene', { code: data.code }));
            socket.once('join-failed', () => alert('Failed to join lobby (wrong code or full).'));
        } catch (e) {
            console.warn('Socket once failed', e);
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
        // Prefer server session, but fall back to localStorage cached user.
        const socketLibAvailable = (typeof io === 'function');
        if (socketLibAvailable) {
            try {
                const server = getServerUrl();
                const resp = await fetch(`${server.replace(/\/$/, '')}/auth/me`, { credentials: 'include' });
                const data = await resp.json();
                if (data?.ok && data.user) {
                    this.user = data.user;
                    return;
                }
            } catch (err) {
                console.warn('Auth check failed (server):', err);
                // fall through to localStorage fallback
            }
        }

        // fallback: localStorage cached user
        try {
            const raw = localStorage.getItem('fives_user');
            if (raw) {
                this.user = JSON.parse(raw);
                return;
            }
        } catch (err) {
            console.warn('Corrupt local user cache', err);
            localStorage.removeItem('fives_user');
        }

        // no user
        this.user = null;
    }

    getUserLabel() {
        return this.user ? this.user.name : 'Not signed in';
    }

    openAccountPopup() {
        this.scene.launch('OnlineAccountScene', { returnTo: 'OnlineMenuScene' });
        this.scene.pause();
    }
}