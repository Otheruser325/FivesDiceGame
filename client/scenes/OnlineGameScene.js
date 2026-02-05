import LocalGameScene from './LocalGameScene.js';
import { getSocket } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import { formatCompact } from '../utils/FormatManager.js';

const ONLINE_STORAGE = {
    tokens: 'online_diceTokens',
    defenceNormal: 'online_defenceNormalLoadout',
    defenceProto: 'online_defenceProtoLoadout',
    monsterNormal: 'online_monsterNormalLoadout',
    monsterProto: 'online_monsterProtoLoadout'
};

const DEFAULT_LOADOUTS = {
    defenceNormal: ['SniperTower', 'Cannon', 'Mortar', 'MachineGun', 'Flamethrower'],
    defenceProto: ['BoomCannon', 'LazorBeam', 'ShockBlaster', 'AcidShooter', 'Microwavr'],
    monsterNormal: ['Goblin', 'Orc', 'Troll', 'Bat', 'FireImp'],
    monsterProto: ['Golem', 'Harpy', 'IceLizard', 'Demon', 'ElectroMage']
};

export default class OnlineGameScene extends LocalGameScene {
    constructor() {
        super('OnlineGameScene');
        this.roomCode = null;
        this.localPlayerIndex = null;
        this.turnTimeSeconds = 30;
        this.turnTimerText = null;
        this._turnTimerEvent = null;
        this._turnTimeRemaining = 0;
        this._onlinePlayers = [];
        this._gameEnded = false;
    }

    init(data = {}) {
        const config = data.config || {};
        const waves = Number.isFinite(config.waves) ? config.waves : (Number.isFinite(data.waves) ? data.waves : 20);
        const switchSides = typeof config.switchSides === 'boolean'
            ? config.switchSides
            : (typeof data.switchSides === 'boolean' ? data.switchSides : false);
        const diceCount = Number.isFinite(config.diceCount) ? config.diceCount : (Number.isFinite(data.diceCount) ? data.diceCount : 1);
        const boardRows = Number.isFinite(config.boardRows) ? config.boardRows : (Number.isFinite(data.boardRows) ? data.boardRows : 5);
        const boardCols = Number.isFinite(config.boardCols) ? config.boardCols : (Number.isFinite(data.boardCols) ? data.boardCols : 9);
        this.turnTimeSeconds = Number.isFinite(config.turnTimeSeconds)
            ? config.turnTimeSeconds
            : (Number.isFinite(data.turnTimeSeconds) ? data.turnTimeSeconds : 30);

        const players = Array.isArray(data.players) ? data.players.slice(0, 2) : [];
        const names = players.length === 2
            ? players.map((p, i) => p?.name || `Player ${i + 1}`)
            : ['Player 1', 'Player 2'];

        super.init({
            waves,
            switchSides,
            diceCount,
            names,
            ai: [false, false],
            difficulty: 'medium',
            boardRows,
            boardCols
        });

        this.roomCode = data.code || this.roomCode || null;
        this._onlinePlayers = players;

        this._applyOnlineLoadouts();
        this._applyOnlinePlayers(players);
        this.localPlayerIndex = this._resolveLocalPlayerIndex(data, players);
        this._gameEnded = false;
    }

    create() {
        super.create();

        this.turnTimerText = this.add.text(600, 90, '', {
            fontSize: 18,
            fontFamily: this.PIXEL_FONT,
            color: '#ffaa66'
        }).setOrigin(0.5);

        this._applyTurnGating();
        this._startTurnTimer();
    }

    _applyOnlineLoadouts() {
        const readLoadout = (key, fallback) => {
            try {
                const raw = localStorage.getItem(key);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed) && parsed.length) return parsed.slice(0, 5);
                }
            } catch (e) {}
            return fallback.slice(0, 5);
        };

        this.defenceNormalLoadout = readLoadout(ONLINE_STORAGE.defenceNormal, DEFAULT_LOADOUTS.defenceNormal);
        this.defenceProtoLoadout = readLoadout(ONLINE_STORAGE.defenceProto, DEFAULT_LOADOUTS.defenceProto);
        this.monsterNormalLoadout = readLoadout(ONLINE_STORAGE.monsterNormal, DEFAULT_LOADOUTS.monsterNormal);
        this.monsterProtoLoadout = readLoadout(ONLINE_STORAGE.monsterProto, DEFAULT_LOADOUTS.monsterProto);

        if (this.players && this.players.length >= 2) {
            this.players[0].normalLoadout = this.switchSides ? this.monsterNormalLoadout : this.defenceNormalLoadout;
            this.players[0].protoLoadout = this.switchSides ? this.monsterProtoLoadout : this.defenceProtoLoadout;
            this.players[0].isAI = false;

            this.players[1].normalLoadout = this.switchSides ? this.defenceNormalLoadout : this.monsterNormalLoadout;
            this.players[1].protoLoadout = this.switchSides ? this.defenceProtoLoadout : this.monsterProtoLoadout;
            this.players[1].isAI = false;
        }
    }

    _applyOnlinePlayers(players) {
        if (!Array.isArray(players) || players.length < 2) return;

        const names = players.map((p, i) => p?.name || `Player ${i + 1}`);
        this.playerNames = names.slice(0, 2);
        this.names = this.playerNames.slice();

        if (this.players && this.players.length >= 2) {
            this.players[0].name = this.playerNames[0];
            this.players[1].name = this.playerNames[1];
        }

        this.playerSlots = players.slice(0, 2).map((p, i) => ({
            id: p.id ?? i,
            name: p?.name || `Player ${i + 1}`,
            avatar: p?.avatar || 'playerIcon',
            connected: p?.connected !== false,
            team: (this.players?.[i]?.role === 'defence') ? 'blue' : 'red'
        }));
    }

    _resolveLocalPlayerIndex(data, players) {
        if (Number.isFinite(data.localIndex)) return data.localIndex;
        const localId = data.localId
            || getSocket()?.data?.user?.id
            || getSocket()?.userId
            || null;

        if (localId && Array.isArray(players)) {
            const idx = players.findIndex(p => String(p?.id) === String(localId));
            if (idx >= 0) return idx;
        }
        return 0;
    }

    _isLocalTurn() {
        if (this.localPlayerIndex === null || typeof this.localPlayerIndex === 'undefined') return true;
        return this.currentPlayer === this.localPlayerIndex;
    }

    _applyTurnGating() {
        const isLocalTurn = this._isLocalTurn();

        if (this.diceText) {
            if (isLocalTurn) this.diceText.setInteractive();
            else this.diceText.disableInteractive();
        }

        if (this.endTurnBtn) {
            if (isLocalTurn) this.endTurnBtn.setInteractive();
            else this.endTurnBtn.disableInteractive();
        }

        if (Array.isArray(this.holderSprites)) {
            this.holderSprites.forEach(sprite => {
                if (!sprite || typeof sprite.setInteractive !== 'function') return;
                if (isLocalTurn) sprite.setInteractive();
                else sprite.disableInteractive();
            });
        }
    }

    updateHolders() {
        super.updateHolders();
        this._applyTurnGating();
    }

    startWave() {
        super.startWave();
        this._applyTurnGating();
        this._startTurnTimer();
    }

    async rollDice(force = false, luckFactor = 1, rerollPrototypeIndex = null) {
        if (!this._isLocalTurn()) {
            if (this.infoText) this.infoText.setText('Waiting for opponent...');
            return;
        }
        return super.rollDice(force, luckFactor, rerollPrototypeIndex);
    }

    async endTurn() {
        if (!this._isLocalTurn()) {
            if (this.infoText) this.infoText.setText('Waiting for opponent...');
            return;
        }

        this._clearTurnTimer();
        await super.endTurn();
        this._applyTurnGating();
        if (!this._gameEnded) this._startTurnTimer();
    }

    _startTurnTimer() {
        this._clearTurnTimer();
        if (!this.turnTimeSeconds || this.turnTimeSeconds <= 0) {
            if (this.turnTimerText) this.turnTimerText.setText('');
            return;
        }

        this._turnTimeRemaining = this.turnTimeSeconds;
        if (this.turnTimerText) this.turnTimerText.setText(`Time: ${this._turnTimeRemaining}s`);

        this._turnTimerEvent = this.time.addEvent({
            delay: 1000,
            loop: true,
            callback: () => {
                this._turnTimeRemaining -= 1;
                if (this.turnTimerText) {
                    this.turnTimerText.setText(`Time: ${Math.max(0, this._turnTimeRemaining)}s`);
                }
                if (this._turnTimeRemaining <= 0) {
                    this._handleTurnTimeout();
                }
            }
        });
    }

    _handleTurnTimeout() {
        this._clearTurnTimer();
        if (!this._isLocalTurn()) return;
        if (this._combatInProgress || this._diceRolling) return;

        if (!this.rolledThisTurn) {
            this.rollDice(true).then(() => {
                if (this._isLocalTurn()) this.endTurn();
            });
        } else {
            this.endTurn();
        }
    }

    _clearTurnTimer() {
        if (this._turnTimerEvent) {
            this._turnTimerEvent.remove();
            this._turnTimerEvent = null;
        }
        if (this.turnTimerText) this.turnTimerText.setText('');
    }

    addBackButton() {
        const back = this.add.text(50, 50, '← Back', { fontSize: 24, color: '#ff6666' }).setInteractive();
        back.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            if (this.exitLocked) {
                this.showConfirmExit();
            } else {
                this._leaveOnlineMatch();
            }
        });
    }

    _bindExitHotkey() {
        if (!this.input || !this.input.keyboard) return;
        if (this._onEscKey) return;
        this._onEscKey = (event) => {
            if (event && event.repeat) return;
            if (this._historyLogContainer && this._historyLogContainer.visible) {
                this._escExitArmed = false;
                this._toggleHistoryLog(false);
                return;
            }
            if (this._escExitArmed) {
                this._escExitArmed = false;
                this._exitModalActive = false;
                this._leaveOnlineMatch();
                return;
            }
            this._escExitArmed = true;
            this.showConfirmExit();
        };
        this.input.keyboard.on('keydown-ESC', this._onEscKey, this);
    }

    showConfirmExit() {
        if (this._exitModalActive) return;
        this._exitModalActive = true;

        const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.8);
        const msg = this.add.text(600, 260,
            this._t('GAME_EXIT_CONFIRM', "Are you sure you want\n to return to the main menu?"), {
                fontSize: 26,
                align: 'center',
                fontFamily: this.PIXEL_FONT
            }
        ).setOrigin(0.5);

        const yesBtn = this.add.text(550, 340, this._t('UI_YES', 'Yes'), {
            fontSize: 28,
            color: '#66ff66',
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5).setInteractive();

        const noBtn = this.add.text(650, 340, this._t('UI_NO', 'No'), {
            fontSize: 28,
            color: '#ff6666',
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5).setInteractive();

        yesBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this._escExitArmed = false;
            this._exitModalActive = false;
            this._leaveOnlineMatch();
        });

        noBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            bg.destroy();
            msg.destroy();
            yesBtn.destroy();
            noBtn.destroy();
            this._escExitArmed = false;
            this._exitModalActive = false;
        });

        this._exitModal = { bg, msg, yesBtn, noBtn };
    }

    _leaveOnlineMatch() {
        this.cleanup();
        try {
            const socket = getSocket();
            if (socket && this.roomCode) {
                socket.emit('leave-lobby', this.roomCode);
            }
        } catch (e) {}
        this.scene.start('OnlineMenuScene');
    }

    endGame(win) {
        this._gameEnded = true;
        this._clearTurnTimer();
        this.exitLocked = false;

        if (win) {
            this.scores[0] += this.currentWave * 2 + this.defeatedMonsters;
        } else {
            this.scores[1] += this.destroyedDefences + 10;
        }
        this.updatePlayerBar();

        const roles = (this.players || []).map(p => p?.role || 'unknown');
        const defenceIndex = roles.indexOf('defence');
        const monsterIndex = roles.indexOf('monster');
        const winnerIndex = win ? defenceIndex : monsterIndex;

        const tokens = this.defeatedMonsters + this.currentWave * 2;
        const currentTokens = parseInt(localStorage.getItem(ONLINE_STORAGE.tokens)) || 0;
        localStorage.setItem(ONLINE_STORAGE.tokens, currentTokens + tokens);

        const totalTokensText = formatCompact(tokens);
        if (win) {
            this.infoText.setText(GlobalLocalization.format('GAME_VICTORY_TOKENS', 'Victory! Earned {0} tokens.', totalTokensText));
        } else {
            this.infoText.setText(GlobalLocalization.format('GAME_DEFEAT_TOKENS', 'Defeat! Earned {0} tokens.', totalTokensText));
        }

        try {
            if (Number.isInteger(winnerIndex) && this.players?.[winnerIndex]) {
                GlobalAchievements.addWin(1);
            }
        } catch (e) {}

        const mvpByPlayer = (typeof this._getMvpByPlayer === 'function') ? this._getMvpByPlayer() : [];

        this.registry.set('onlinePostGame', {
            players: this.totalPlayers,
            names: (this.playerNames || this.names || []).slice(0, this.totalPlayers),
            roles: roles.slice(0, this.totalPlayers),
            scores: (this.scores || []).slice(0, this.totalPlayers),
            defeatedMonsters: this.defeatedMonsters,
            destroyedDefences: this.destroyedDefences,
            waves: this.waves,
            finalWave: this.currentWave,
            tokensEarned: tokens,
            win: !!win,
            winnerIndex,
            mvpByPlayer
        });

        this.cleanup();
        this.time.delayedCall(1500, () => {
            this.scene.start('OnlinePostGameScene');
        });
    }
}
