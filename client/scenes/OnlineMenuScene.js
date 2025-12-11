import { getSocket } from '../utils/SocketManager.js';
import { GlobalAudio } from '../utils/AudioManager.js';

export default class OnlineMenuScene extends Phaser.Scene {
    constructor() {
        super('OnlineMenuScene');
        this.user = null;
        this.joinInput = null;
        this.avatar = null;
        this.accountText = null;
        this.lobbyUIElements = [];
        this.signInText = null;
    }

    async create() {
        const backBtn = this.add.text(600, 360, 'Back', {
            fontSize: 28,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();
        
        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });

        if (!getSocket().connected && typeof io !== "function") {
          this.add.text(600, 200, "Server Under Maintenance", {
          fontSize: 38,
          color: "#ff4444"
        }).setOrigin(0.5);
          return;
        }

        await this.refreshAuth();
        this.buildUI();

        // Listen for auth changes (login/logout)
        this.game.events.on("auth-updated", async () => {
            await this.refreshAuth();
            this.clearLobbyUI();
            this.buildUI();
        });

        this.events.on('shutdown', () => {
            if (this.joinInput) {
                this.joinInput.destroy();
                this.joinInput = null;
            }
            if (this.avatar) this.avatar.destroy();
            if (this.accountText) this.accountText.destroy();
            this.clearLobbyUI();
            if (this.signInText) this.signInText.destroy();
        });

    }

    buildUI() {
        // Authorise user
        if (this.user) {
            getSocket().emit("auth-user", {
                id: this.user.id,
                name: this.user.name,
                type: this.user.type,
                avatar: this.user.avatar || null
            });
        }

        // Top-right username / avatar
        const isGuest = this.user?.type === 'guest';
        const avatarTexture = (this.user?.avatar && !isGuest) ? this.user.avatar : 'playerIcon';

        if (this.user && (isGuest || !this.user.avatar)) {
            this.avatar = this.add.image(990, 40, avatarTexture).setOrigin(0.5, 0.5).setScale(0.5).setInteractive();
            this.avatar.on('pointerdown', () => this.openAccountPopup());
        }

        const labelText = this.user ? this.user.name : 'Not signed in';
        this.accountText = this.add.text(this.avatar ? 1020 : 1020, 40, labelText, {
            fontSize: 28,
            color: '#fff'
        }).setOrigin(0, 0.5).setInteractive();
        this.accountText.on('pointerdown', () => {
            this.openAccountPopup();
        });

        // Main title
        this.add.text(600, 60, 'Online Mode', {
            fontSize: 48
        }).setOrigin(0.5);

        if (this.user) {
            // Join input for logged-in users
            this.joinInput = this.add.dom(600, 270, 'input', {
                width: '200px',
                fontSize: '20px',
                padding: '6px'
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
            if (code) getSocket().emit('join-lobby', code);
        });

        getSocket().once('join-success', data => this.scene.start('OnlineLobbyScene', {
            code: data.code
        }));
        getSocket().once('join-failed', () => alert('Failed to join lobby (wrong code or full).'));

        // Track elements for easy clearing
        this.lobbyUIElements.push(createBtn, joinBtn);

    }

    clearLobbyUI() {
        this.lobbyUIElements.forEach(el => el.destroy());
        this.lobbyUIElements = [];
        if (this.joinInput) {
            this.joinInput.destroy();
            this.joinInput = null;
        }
        if (this.signInText) {
            this.signInText.destroy();
            this.signInText = null;
        }
    }

    async refreshAuth() {
        try {
            const resp = await fetch('/auth/me', {
                credentials: 'include'
            });
            const data = await resp.json();
            this.user = data?.ok && data.user ? data.user : null;
        } catch (err) {
            console.warn('Auth check failed', err);
            this.user = null;
        }
    }

    getUserLabel() {
        return this.user ? this.user.name : 'Not signed in';
    }

    openAccountPopup() {
        this.scene.launch('OnlineAccountScene', {
            returnTo: 'OnlineMenuScene'
        });
        this.scene.pause();
    }
}