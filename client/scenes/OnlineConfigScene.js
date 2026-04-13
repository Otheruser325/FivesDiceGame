import { getSocket, emitAuthUser } from '../utils/SocketManager.js';
import GlobalAlerts from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DebugManager from '../utils/DebugManager.js';
import { GAME_MODES, normalizeGameMode, getRuleFlags, normalizeTeams } from '../utils/GameModeManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const onOff = (val) => t(val ? 'UI_ON' : 'UI_OFF', val ? 'ON' : 'OFF');
const teamLabel = (team) => (team === 'red' ? t('TEAM_RED', 'RED') : t('TEAM_BLUE', 'BLUE'));

export default class OnlineConfigScene extends Phaser.Scene {
    constructor() {
        super({ key: 'OnlineConfigScene' });

        this.selectedPlayers = 2;
        this.selectedRounds = 20;
        this.gameMode = GAME_MODES.CLASSIC;
        this.comboRules = false;
        this.multiplexRules = false;
        this.teamsEnabled = false;
        this.playerTeams = ['blue', 'red', 'blue', 'red', 'blue', 'red'];
        this.createLobbyBtn = null;
        this.creatingLobby = false;
        this.modePopup = null;
        this.modePopupOpen = false;
        this._autoModePromptShown = false;
        this.debugger = DebugManager.create(this, { namespace: 'OnlineConfigScene' });
        this.debug = this.debugger.enabled;
    }

    init(data = {}) {
        if (data.players) this.selectedPlayers = data.players;
        if (data.rounds) this.selectedRounds = data.rounds;
        if (typeof data.multiplex === "boolean") this.multiplexRules = data.multiplex;
        if (typeof data.teamsEnabled === "boolean") this.teamsEnabled = data.teamsEnabled;
        if (Array.isArray(data.teams)) this.playerTeams = data.teams.slice();
        this.gameMode = normalizeGameMode(
            data.gameMode ?? data.gamemode,
            data.combos ?? this.comboRules,
            data.multiplex ?? this.multiplexRules
        );
        this.creatingLobby = false;
        this.syncRuleState();
    }

    syncRuleState() {
        const rules = getRuleFlags(this.gameMode, {
            combos: this.comboRules,
            multiplex: this.multiplexRules
        });
        this.gameMode = rules.gameMode;
        this.comboRules = rules.combos;
        this.multiplexRules = rules.multiplex;
        this.playerTeams = normalizeTeams(this.playerTeams, this.selectedPlayers);
    }

    getGameModeLabel(mode = this.gameMode) {
        switch (normalizeGameMode(mode)) {
            case GAME_MODES.COMBANITY:
                return t('CONFIG_MODE_COMBANITY', 'Combanity');
            case GAME_MODES.MULTIPLEX:
                return t('CONFIG_MODE_MULTIPLEX', 'Multiplex');
            case GAME_MODES.CLASSIC:
            default:
                return t('CONFIG_MODE_CLASSIC', 'Classic');
        }
    }

    getGameModeSummary(mode = this.gameMode) {
        switch (normalizeGameMode(mode)) {
            case GAME_MODES.COMBANITY:
                return t('CONFIG_MODE_COMBANITY_DESC', 'Combo hits pay out and every round feels a little more dramatic.');
            case GAME_MODES.MULTIPLEX:
                return t('CONFIG_MODE_MULTIPLEX_DESC', 'Dice multiply instead of add, so every roll can spike hard.');
            case GAME_MODES.CLASSIC:
            default:
                return t('CONFIG_MODE_CLASSIC_DESC', 'Straight Fives totals for the cleanest read on every turn.');
        }
    }

    getGameModePopupCopy(mode = this.gameMode) {
        switch (normalizeGameMode(mode)) {
            case GAME_MODES.COMBANITY:
                return t('CONFIG_MODE_COMBANITY_POPUP_SHORT', 'Special patterns pay out big and keep each roll spicy.');
            case GAME_MODES.MULTIPLEX:
                return t('CONFIG_MODE_MULTIPLEX_POPUP_SHORT', 'Scores are multiplied instead of added for wild swings.');
            case GAME_MODES.CLASSIC:
            default:
                return t('CONFIG_MODE_CLASSIC_POPUP_SHORT', 'Clean Fives scoring with the most readable pace.');
        }
    }

    getModeCardStyles(mode = this.gameMode) {
        switch (normalizeGameMode(mode)) {
            case GAME_MODES.COMBANITY:
                return {
                    accent: 0xd23434,
                    glint: 0xf04b4b,
                    fill: 0x180707,
                    selectedStroke: 0xff6464,
                    badgeKey: 'CONFIG_MODE_COMBANITY_BADGE',
                    badgeFallback: 'ALL-IN',
                    badgeColor: '#ffb0b0'
                };
            case GAME_MODES.MULTIPLEX:
                return {
                    accent: 0xf0c15f,
                    glint: 0xffd77a,
                    fill: 0x171109,
                    selectedStroke: 0xffde7e,
                    badgeKey: 'CONFIG_MODE_MULTIPLEX_BADGE',
                    badgeFallback: 'JACKPOT',
                    badgeColor: '#ffe0a3'
                };
            case GAME_MODES.CLASSIC:
            default:
                return {
                    accent: 0x9b2020,
                    glint: 0xc62828,
                    fill: 0x120d0d,
                    selectedStroke: 0xf0c15f,
                    badgeKey: 'CONFIG_MODE_CLASSIC_BADGE',
                    badgeFallback: 'HOUSE TABLE',
                    badgeColor: '#f6d38a'
                };
        }
    }

    buildLobbyPayload() {
        this.syncRuleState();
        return {
            players: this.selectedPlayers,
            rounds: this.selectedRounds,
            gameMode: this.gameMode,
            combos: this.comboRules,
            multiplex: this.multiplexRules,
            teamsEnabled: this.teamsEnabled,
            teams: this.teamsEnabled ? normalizeTeams(this.playerTeams, this.selectedPlayers) : []
        };
    }

    create() {
        ErrorHandler.setScene(this);
        this.syncRuleState();

        this.add.text(600, 60, t('ONLINE_CONFIG_TITLE', 'Online Game Configuration'), { fontSize: 40 }).setOrigin(0.5);

        this.add.text(600, 120, t('CONFIG_PLAYERS_PROMPT', 'How many players?'), { fontSize: 28 }).setOrigin(0.5);

        [2, 3, 4, 5, 6].forEach((num, i) => {
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

        this.add.text(600, 360, t('CONFIG_ROUNDS_PROMPT', 'How many rounds?'), {
            fontSize: 28
        }).setOrigin(0.5);

        [5, 10, 15, 20, 25, 30].forEach((rounds, i) => {
            const btn = this.add.text(600, 400 + i * 40, tf('CONFIG_ROUNDS_LABEL', '{0} rounds', rounds), {
                fontSize: 24,
                color: rounds === this.selectedRounds ? '#ffff66' : '#ffffff'
            })
                .setOrigin(0.5)
                .setInteractive();

            btn.on('pointerdown', () => {
                this.selectedRounds = rounds;
                this.refreshScene();
            });
        });

        this.add.text(600, 646, t('CONFIG_GAMEPLAY_TABLE', 'Gameplay table:'), {
            fontSize: 24,
            color: '#f3d6d6'
        }).setOrigin(0.5);

        this.createGameModeSelector(704);

        this.teamsBtn = this.add.text(
            600,
            772,
            tf('CONFIG_TEAMS', 'Teams: {0}', onOff(this.teamsEnabled)),
            { fontSize: 24, color: this.teamsEnabled ? '#66aaff' : '#d55b5b' }
        )
            .setOrigin(0.5)
            .setInteractive();

        this.teamsBtn.on('pointerdown', () => {
            this.teamsEnabled = !this.teamsEnabled;
            this.refreshScene();
        });

        if (this.teamsEnabled) {
            this.add.text(980, 170, t('CONFIG_TEAM_ASSIGNMENT', 'Team Assignment:'), { fontSize: 22, color: "#ffaa44" }).setOrigin(0.5);

            let teamConfigY = 210;
            for (let i = 0; i < this.selectedPlayers; i++) {
                const team = this.playerTeams[i] || 'blue';
                const teamColor = team === 'blue' ? '#66aaff' : '#ff6666';

                this.add.text(900, teamConfigY, tf('CONFIG_PLAYER_LABEL', 'Player {0}:', i + 1), { fontSize: 18 }).setOrigin(0.5);

                const teamBtn = this.add.text(1060, teamConfigY, teamLabel(team), {
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

                teamConfigY += 44;
            }
        }

        this._labelCreateLobby = t('ONLINE_CONFIG_CREATE_LOBBY', 'Create Lobby!');
        this._labelCreatingLobby = t('ONLINE_CONFIG_CREATING_LOBBY', 'Creating Lobby...');

        this.createLobbyBtn = this.add.text(600, 824, this._labelCreateLobby, {
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

        const backBtn = this.add.text(80, 840, t('UI_BACK', '<- Back'), {
            fontSize: 24,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();

        backBtn.on('pointerdown', () => {
            if (this.modePopupOpen) {
                this.closeGameModePopup();
                return;
            }
            GlobalAudio.playButton(this);
            this.scene.start('OnlineMenuScene');
        });

        if (this.input && this.input.keyboard) {
            this._escHandler = () => {
                GlobalAudio.playButton(this);
                if (this.modePopupOpen) {
                    this.closeGameModePopup();
                    return;
                }
                this.scene.start('OnlineMenuScene');
            };
            this.input.keyboard.on('keydown-ESC', this._escHandler);
            this.events.once('shutdown', () => {
                if (this.input && this.input.keyboard && this._escHandler) {
                    this.input.keyboard.off('keydown-ESC', this._escHandler);
                }
                this._escHandler = null;
            });
        }

        if (!this._autoModePromptShown) {
            this._autoModePromptShown = true;
            this.time.delayedCall(80, () => {
                if (this.scene.isActive()) {
                    this.showGameModePopup();
                }
            });
        }
    }

    createGameModeSelector(y) {
        const styles = this.getModeCardStyles(this.gameMode);
        const button = this.add.container(600, y);

        const shell = this.add.rectangle(0, 0, 520, 92, 0x0a0606, 0.98)
            .setStrokeStyle(2, styles.accent, 0.95);
        const strip = this.add.rectangle(0, -35, 520, 10, 0x2f0d0d, 1);
        const glint = this.add.rectangle(-26, -35, 180, 10, styles.glint, 0.95);
        const eyebrow = this.add.text(-236, -14, t('CONFIG_GAMEMODE', 'Gamemode'), {
            fontSize: 17,
            color: '#f4b2b2',
            fontStyle: 'bold'
        }).setOrigin(0, 0.5);
        const modeText = this.add.text(-236, 18, this.getGameModeLabel(), {
            fontSize: 26,
            color: '#fff0f0',
            fontStyle: 'bold'
        }).setOrigin(0, 0.5);
        const summary = this.add.text(238, 16, this.getGameModeSummary(), {
            fontSize: 13,
            color: '#d4b6b6',
            align: 'right',
            lineSpacing: 4,
            wordWrap: { width: 210 }
        }).setOrigin(1, 0.5);
        const hint = this.add.text(238, -14, t('CONFIG_GAMEMODE_TAP', 'Tap to choose'), {
            fontSize: 14,
            color: '#f7c75f'
        }).setOrigin(1, 0.5);
        const hit = this.add.rectangle(0, 0, 520, 92, 0xffffff, 0.001)
            .setInteractive({ useHandCursor: true });

        hit.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.showGameModePopup();
        });

        hit.on('pointerover', () => {
            shell.setStrokeStyle(3, 0xf04b4b, 1);
        });

        hit.on('pointerout', () => {
            shell.setStrokeStyle(2, styles.accent, 0.95);
        });

        button.add([shell, strip, glint, eyebrow, modeText, summary, hint, hit]);
        button.setDepth(30);
    }

    createModeOption(container, x, y, mode, title, subtitle) {
        const selected = this.gameMode === mode;
        const styles = this.getModeCardStyles(mode);
        const card = this.add.container(x, y);
        const stroke = selected ? styles.selectedStroke : 0x5e1c1c;
        const glow = this.add.rectangle(0, 0, 248, 236, selected ? 0x4a1111 : 0x120909, selected ? 0.28 : 0.12);
        const bg = this.add.rectangle(0, 0, 240, 228, styles.fill, 0.995).setStrokeStyle(selected ? 3 : 2, stroke, 1);
        const topLine = this.add.rectangle(0, -106, 240, 8, styles.accent, selected ? 1 : 0.78);
        const badge = this.add.text(0, -66,
            t(styles.badgeKey, styles.badgeFallback),
            {
                fontSize: 12,
                color: styles.badgeColor,
                fontStyle: 'bold'
            }
        ).setOrigin(0.5);
        const titleText = this.add.text(0, -30, title, {
            fontSize: 24,
            color: '#fff4f4',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        const subText = this.add.text(0, 36, subtitle, {
            fontSize: 12,
            color: '#d5bcbc',
            align: 'center',
            lineSpacing: 5,
            wordWrap: { width: 172 }
        }).setOrigin(0.5);
        const footer = this.add.text(0, 92,
            selected
                ? t('CONFIG_MODE_SELECTED', 'Selected')
                : t('CONFIG_MODE_PICK', 'Pick this table'),
            {
                fontSize: 14,
                color: selected ? '#f7c75f' : '#f09d9d'
            }
        ).setOrigin(0.5);
        const hit = this.add.rectangle(0, 0, 240, 228, 0xffffff, 0.001)
            .setInteractive({ useHandCursor: true });

        hit.on('pointerdown', () => {
            this.gameMode = mode;
            this.comboRules = mode === GAME_MODES.COMBANITY;
            this.multiplexRules = mode === GAME_MODES.MULTIPLEX;
            this.syncRuleState();
            GlobalAudio.playButton(this);
            this.closeGameModePopup();
            this.refreshScene();
        });

        hit.on('pointerover', () => {
            bg.setStrokeStyle(selected ? 4 : 3, styles.selectedStroke, 1);
        });

        hit.on('pointerout', () => {
            bg.setStrokeStyle(selected ? 4 : 2, stroke, 1);
        });

        card.add([glow, bg, topLine, badge, titleText, subText, footer, hit]);
        container.add(card);
    }

    showGameModePopup() {
        if (this.modePopupOpen) return;
        this.modePopupOpen = true;

        const overlay = this.add.container(0, 0);
        const veil = this.add.rectangle(600, 450, 1280, 960, 0x010101, 0.92)
            .setInteractive();
        const redGlowTop = this.add.ellipse(340, 140, 340, 180, 0x8b1010, 0.24);
        const redGlowBottom = this.add.ellipse(920, 760, 420, 220, 0x5e0a0a, 0.22);
        const panelShadow = this.add.rectangle(600, 448, 940, 472, 0x000000, 0.6)
            .setInteractive();
        const panel = this.add.rectangle(600, 434, 912, 440, 0x080505, 0.985)
            .setStrokeStyle(2, 0xbb1f1f, 1);
        panel.setInteractive();
        const crown = this.add.rectangle(600, 224, 912, 10, 0x2a0909, 1);
        const crownLight = this.add.rectangle(600, 224, 188, 10, 0xe53935, 1);
        const title = this.add.text(600, 286, t('CONFIG_MODE_POPUP_TITLE', 'Choose Your Table'), {
            fontSize: 36,
            color: '#fff2f2',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        const subtitle = this.add.text(600, 330, t('CONFIG_MODE_POPUP_SUBTITLE', 'Pick a table style for this match. Teams can be added on top of any of them.'), {
            fontSize: 16,
            color: '#d8bebe',
            align: 'center',
            lineSpacing: 3,
            wordWrap: { width: 620 }
        }).setOrigin(0.5);
        const cancel = this.add.text(600, 628, t('UI_CLOSE', 'Close'), {
            fontSize: 22,
            color: '#8fc1ff'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        cancel.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.closeGameModePopup();
        });

        overlay.add([veil, redGlowTop, redGlowBottom, panelShadow, panel, crown, crownLight, title, subtitle, cancel]);
        this.createModeOption(
            overlay,
            290,
            462,
            GAME_MODES.CLASSIC,
            t('CONFIG_MODE_CLASSIC', 'Classic'),
            this.getGameModePopupCopy(GAME_MODES.CLASSIC)
        );
        this.createModeOption(
            overlay,
            600,
            462,
            GAME_MODES.COMBANITY,
            t('CONFIG_MODE_COMBANITY', 'Combanity'),
            this.getGameModePopupCopy(GAME_MODES.COMBANITY)
        );
        this.createModeOption(
            overlay,
            910,
            462,
            GAME_MODES.MULTIPLEX,
            t('CONFIG_MODE_MULTIPLEX', 'Multiplex'),
            this.getGameModePopupCopy(GAME_MODES.MULTIPLEX)
        );

        overlay.setDepth(4000);
        overlay.setAlpha(0);
        this.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: 180,
            ease: 'Cubic.easeOut'
        });

        this.modePopup = overlay;
    }

    closeGameModePopup() {
        if (!this.modePopupOpen) return;
        this.modePopupOpen = false;

        if (!this.modePopup) return;
        const popup = this.modePopup;
        this.modePopup = null;
        this.tweens.add({
            targets: popup,
            alpha: 0,
            duration: 140,
            ease: 'Cubic.easeIn',
            onComplete: () => popup.destroy(true)
        });
    }

    onAuthSuccess(data) {
        if (this.debugger) this.debugger.log('auth-success', data);
    }

    onAuthFailure(error) {
        if (this.debugger) this.debugger.warn('auth-failed', error);
    }

    handleCreateLobby() {
        if (this.creatingLobby) {
            console.warn('[OnlineConfigScene] Create lobby already in progress, ignoring request');
            if (this.debugger) this.debugger.warn('create-lobby already in progress');
            return;
        }

        const socket = getSocket();
        if (!socket || !socket.connected) {
            console.error('[OnlineConfigScene] Socket not connected, cannot create lobby');
            if (this.debugger) this.debugger.error('create-lobby failed: socket not connected');
            GlobalAlerts.show(this, t('ONLINE_CONN_LOST', 'Connection lost. Please reconnect and try again.'), 'error');
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
        this.createLobbyBtn.setText(this._labelCreatingLobby || t('ONLINE_CONFIG_CREATING_LOBBY', 'Creating Lobby...'));
        this.createLobbyBtn.setFill('#ffaa00');
        this.createLobbyBtn.setAlpha(0.7);
        this.createLobbyBtn.disableInteractive();

        const socketHasAuth = socket.data?.user?.id ? true : false;
        if (this.debugger) this.debugger.log('create-lobby start', { socketConnected: socket.connected, hasAuth: socketHasAuth });

        const handleLobbyCreated = (data) => {
            if (this.debugger) this.debugger.log('lobby-created', { code: data?.code });
            socket.off('lobby-created', handleLobbyCreated);
            socket.off('create-failed', handleCreateFailed);
            this.scene.start('OnlineLobbyScene', { code: data.code });
        };

        const handleCreateFailed = (error) => {
            console.error('[OnlineConfigScene] Lobby creation failed:', error);
            if (this.debugger) this.debugger.warn('lobby-create failed', { error });
            socket.off('lobby-created', handleLobbyCreated);
            socket.off('create-failed', handleCreateFailed);

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

        const payload = this.buildLobbyPayload();

        if (!socketHasAuth) {
            console.warn('[OnlineConfigScene] Socket not authenticated, attempting auth...');
            if (this.debugger) this.debugger.warn('socket not authenticated, attempting auth');

            let cachedUser = {};
            try {
                cachedUser = JSON.parse(localStorage.getItem('fives_user') || '{}');
            } catch (e) {
                console.warn('[OnlineConfigScene] Corrupt cached user data, clearing cache');
                localStorage.removeItem('fives_user');
            }

            if (cachedUser.id) {
                let authTimeout = null;

                const handleAuthSuccess = (data) => {
                    if (this.debugger) this.debugger.log('socket auth success', { id: data?.user?.id });
                    if (authTimeout) {
                        clearTimeout(authTimeout);
                        authTimeout = null;
                    }

                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);
                    socket.once('lobby-created', handleLobbyCreated);
                    socket.once('create-failed', handleCreateFailed);
                    if (this.debugger) this.debugger.log('emit create-lobby', payload);
                    socket.emit('create-lobby', payload);
                };

                const handleAuthFailed = (error) => {
                    console.error('[OnlineConfigScene] Socket authentication failed:', error);
                    if (this.debugger) this.debugger.warn('socket auth failed', { error });

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
                    if (this.debugger) this.debugger.warn('auth timeout, checking socket state');

                    socket.off('auth-success', handleAuthSuccess);
                    socket.off('auth-failed', handleAuthFailed);

                    const newSocketAuth = socket.data?.user?.id ? true : false;
                    if (newSocketAuth) {
                        if (this.debugger) this.debugger.log('auth recovered, emitting create-lobby');
                        socket.once('lobby-created', handleLobbyCreated);
                        socket.once('create-failed', handleCreateFailed);
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
            if (this.debugger) this.debugger.log('socket already authenticated, emitting create-lobby');
            socket.once('lobby-created', handleLobbyCreated);
            socket.once('create-failed', handleCreateFailed);
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
        const socket = getSocket();
        if (socket) {
            socket.off('lobby-created');
            socket.off('create-failed');
            socket.off('auth-success');
            socket.off('auth-failed');
        }
        this.closeGameModePopup();
    }

    destroy() {
        this.shutdown();
    }

    refreshScene() {
        this.scene.restart(this.buildLobbyPayload());
    }
}
