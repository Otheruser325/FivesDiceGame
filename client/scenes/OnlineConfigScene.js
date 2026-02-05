import { getSocket, emitAuthUser } from '../utils/SocketManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class OnlineConfigScene extends Phaser.Scene {
    constructor() {
        super({ key: 'OnlineConfigScene' });

        this.selectedWaves = 20;
        this.switchSides = false;
        this.diceCount = 1;
        this.boardRows = 5;
        this.boardCols = 9;
        this.boardRowOptions = [5, 6, 7];
        this.boardColOptions = [7, 9, 11, 13, 15];
        this.turnTimeSeconds = 30;
        this.turnTimeOptions = [15, 30, 45, 60];
        this.createLobbyBtn = null;
        this.creatingLobby = false;
    }

    init(data) {
        if (!data) return;
        if (Number.isFinite(data.waves)) this.selectedWaves = data.waves;
        if (typeof data.switchSides === 'boolean') this.switchSides = data.switchSides;
        if (Number.isFinite(data.diceCount)) this.diceCount = data.diceCount;
        if (Number.isFinite(data.boardRows) && this.boardRowOptions.includes(data.boardRows)) {
            this.boardRows = data.boardRows;
        }
        if (Number.isFinite(data.boardCols) && this.boardColOptions.includes(data.boardCols)) {
            this.boardCols = data.boardCols;
        }
        if (Number.isFinite(data.turnTimeSeconds)) this.turnTimeSeconds = data.turnTimeSeconds;
        if (Array.isArray(data.turnTimeOptions) && data.turnTimeOptions.length) {
            this.turnTimeOptions = data.turnTimeOptions.slice();
        }
        this.creatingLobby = false;
    }

    create() {
        try {
            ErrorHandler.setScene(this);
        } catch (e) {}
        try {
            GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}

        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
        this._t = t;

        this.add.text(600, 60, t('CONFIG_TITLE', 'Game Configuration'), {
            fontSize: '32px',
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        // --------------------------------------
        // Waves
        // --------------------------------------
        this.add.text(600, 140, t('CONFIG_HOW_MANY_WAVES', 'How many waves?'), {
            fontSize: '24px',
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        const waveOptions = [10, 15, 20, 25, 30, 35, 40, 45, 50];
        waveOptions.forEach((w, i) => {
            const btn = this.add.text(600, 180 + i * 36, fmt('CONFIG_WAVES_LABEL', '{0} waves', w), {
                fontSize: '22px',
                fontFamily: '"Press Start 2P"',
                color: w === this.selectedWaves ? '#ffff66' : '#ffffff'
            }).setOrigin(0.5).setInteractive();

            btn.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.selectedWaves = w;
                this.refreshScene();
            });
        });

        // --------------------------------------
        // Additional Rules
        // --------------------------------------
        this.add.text(600, 520, t('CONFIG_ADDITIONAL_RULES', 'Additional rules:'), {
            fontSize: '24px',
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        this.switchSidesBtn = this.add.text(
            600,
            560,
            fmt('CONFIG_SWITCH_SIDES', 'Switch sides: {0}', this.switchSides ? t('SIDE_MONSTERS', 'Monsters') : t('SIDE_DEFENCES', 'Defences')),
            { fontSize: '22px', fontFamily: '"Press Start 2P"', color: this.switchSides ? '#ff6666' : '#66aaff' }
        ).setOrigin(0.5).setInteractive();

        this.switchSidesBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.switchSides = !this.switchSides;
            this.refreshScene();
        });

        // --------------------------------------
        // Dice Count
        // --------------------------------------
        this.add.text(220, 640, t('CONFIG_HOW_MANY_DICE', 'How many dice?'), {
            fontSize: '20px',
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        this.diceCountBtn = this.add.text(220, 680,
            this.diceCount === 1 ? t('CONFIG_DICE_1', '1 Dice') : t('CONFIG_DICE_2', '2 Dice'),
            { fontSize: '20px', fontFamily: '"Press Start 2P"', color: this.diceCount === 2 ? '#ff6666' : '#66aaff' }
        ).setOrigin(0.5).setInteractive();

        this.diceCountBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.diceCount = this.diceCount === 1 ? 2 : 1;
            this.refreshScene();
        });

        // --------------------------------------
        // Board Size
        // --------------------------------------
        this.add.text(1000, 610, t('CONFIG_BOARD_SIZE', 'Board Size'), {
            fontSize: '18px',
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        const boardLabelStyle = { fontSize: '18px', fontFamily: '"Press Start 2P"', color: '#66aaff' };

        this.boardRowsBtn = this.add.text(1000, 650, fmt('CONFIG_ROWS', 'Rows: {0}', this.boardRows), boardLabelStyle)
            .setOrigin(0.5)
            .setInteractive();

        this.boardRowsBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            const idx = this.boardRowOptions.indexOf(this.boardRows);
            const next = (idx + 1) % this.boardRowOptions.length;
            this.boardRows = this.boardRowOptions[next];
            this.refreshScene();
        });

        this.boardColsBtn = this.add.text(1000, 690, fmt('CONFIG_COLS', 'Cols: {0}', this.boardCols), boardLabelStyle)
            .setOrigin(0.5)
            .setInteractive();

        this.boardColsBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            const idx = this.boardColOptions.indexOf(this.boardCols);
            const next = (idx + 1) % this.boardColOptions.length;
            this.boardCols = this.boardColOptions[next];
            this.refreshScene();
        });

        // Turn timer (selectable)
        this.turnTimeBtn = this.add.text(1000, 730, t('ONLINE_TURN_TIMER', `Turn timer: ${this.turnTimeSeconds}s`), {
            fontSize: '16px',
            fontFamily: '"Press Start 2P", cursive',
            color: '#cccccc'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        this.turnTimeBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            const idx = this.turnTimeOptions.indexOf(this.turnTimeSeconds);
            const next = (idx + 1) % this.turnTimeOptions.length;
            this.turnTimeSeconds = this.turnTimeOptions[next];
            this.refreshScene();
        });

        // --------------------------------------
        // Create Lobby Button
        // --------------------------------------
        this.createLobbyBtn = this.add.text(600, 800, t('ONLINE_CREATE_LOBBY', 'Create Lobby'), {
            fontSize: 28,
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
        const backBtn = this.add.text(80, 820, t('UI_BACK', '<- BACK'), {
            fontSize: 20,
            fontFamily: '"Press Start 2P", cursive',
            color: '#ff6666'
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

    buildLobbyPayload() {
        return {
            waves: this.selectedWaves,
            switchSides: this.switchSides,
            diceCount: this.diceCount,
            boardRows: this.boardRows,
            boardCols: this.boardCols,
            turnTimeSeconds: this.turnTimeSeconds
        };
    }

    handleCreateLobby() {
        if (this.creatingLobby) {
            console.warn('[OnlineConfigScene] Create lobby already in progress, ignoring request');
            return;
        }

        const socket = getSocket();
        if (!socket || !socket.connected) {
            console.error('[OnlineConfigScene] Socket not connected, cannot create lobby');
            GlobalAlerts.show(this, 'Connection lost. Please reconnect and try again.', 'error');
            return;
        }

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
            userName = `User${String(userId).substring(0, 6)}`;
        }

        this.creatingLobby = true;

        this.createLobbyBtn.setText('Creating Lobby...');
        this.createLobbyBtn.setFill('#ffaa00');
        this.createLobbyBtn.setAlpha(0.7);
        this.createLobbyBtn.disableInteractive();

        const socketHasAuth = socket.data?.user?.id ? true : false;
        console.log('[OnlineConfigScene] handleCreateLobby - Socket connected:', socket.connected, 'Has auth:', socketHasAuth);

        const handleLobbyCreated = (data) => {
            console.log('[OnlineConfigScene] Lobby created:', data);
            socket.off('lobby-created', handleLobbyCreated);
            socket.off('create-failed', handleCreateFailed);
            this.scene.start('OnlineLobbyScene', { code: data.code });
        };

        const handleCreateFailed = (error) => {
            console.error('[OnlineConfigScene] Lobby creation failed:', error);
            socket.off('lobby-created', handleLobbyCreated);
            socket.off('create-failed', handleCreateFailed);

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

        const emitCreateLobby = () => {
            const payload = this.buildLobbyPayload();
            console.log('[OnlineConfigScene] Emitting create-lobby:', payload);
            socket.emit('create-lobby', payload);
        };

        if (!socketHasAuth) {
            console.warn('[OnlineConfigScene] Socket not authenticated, attempting auth...');

            const cachedUser = JSON.parse(localStorage.getItem('fives_user') || '{}');
            if (cachedUser.id) {
                let authTimeout = null;

                const handleAuthSuccess = (data) => {
                    console.log('[OnlineConfigScene] Socket authenticated successfully:', data.user);
                    if (authTimeout) {
                        clearTimeout(authTimeout);
                        authTimeout = null;
                    }

                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);

                    socket.once('lobby-created', handleLobbyCreated);
                    socket.once('create-failed', handleCreateFailed);
                    emitCreateLobby();
                };

                const handleAuthFailed = (error) => {
                    console.error('[OnlineConfigScene] Socket authentication failed:', error);
                    if (authTimeout) {
                        clearTimeout(authTimeout);
                        authTimeout = null;
                    }
                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);
                    this.resetCreateLobbyButton();
                };

                socket.once('auth-success', handleAuthSuccess);
                socket.once('auth-failed', handleAuthFailed);

                emitAuthUser({
                    id: cachedUser.id,
                    name: cachedUser.name || cachedUser.username,
                    type: cachedUser.type,
                    email: cachedUser.email || null,
                    profile: cachedUser.profile || null,
                    created_at: cachedUser.created_at,
                    updated_at: cachedUser.updated_at
                }, true);

                authTimeout = setTimeout(() => {
                    console.warn('[OnlineConfigScene] Auth event timeout, checking socket state...');
                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);

                    const newSocketAuth = socket.data?.user?.id ? true : false;
                    if (newSocketAuth) {
                        console.log('[OnlineConfigScene] Socket is authenticated (timeout fired but socket valid), emitting create-lobby');
                        socket.once('lobby-created', handleLobbyCreated);
                        socket.once('create-failed', handleCreateFailed);
                        emitCreateLobby();
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
            socket.once('lobby-created', handleLobbyCreated);
            socket.once('create-failed', handleCreateFailed);
            emitCreateLobby();
        }
    }

    resetCreateLobbyButton() {
        const label = this._t ? this._t('ONLINE_CREATE_LOBBY', 'Create Lobby') : 'Create Lobby';
        this.createLobbyBtn.setText(label);
        this.createLobbyBtn.setFill('#66ff66');
        this.createLobbyBtn.setAlpha(1);
        this.createLobbyBtn.setInteractive({ useHandCursor: true });
        this.creatingLobby = false;
    }

    shutdown() {
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
            waves: this.selectedWaves,
            switchSides: this.switchSides,
            diceCount: this.diceCount,
            boardRows: this.boardRows,
            boardCols: this.boardCols,
            turnTimeSeconds: this.turnTimeSeconds
        });
    }
}
