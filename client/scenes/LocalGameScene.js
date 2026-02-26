import GlobalAudio from '../utils/AudioManager.js';
import { animateDiceRoll } from '../utils/AnimationManager.js';
import ComboManager from '../utils/ComboManager.js';
import Dice from '../utils/DiceManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DebugManager from '../utils/DebugManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const teamLabel = (team) => (team === 'red' ? t('TEAM_RED', 'RED') : t('TEAM_BLUE', 'BLUE'));

export default class LocalGameScene extends Phaser.Scene {
    constructor() {
        super('LocalGameScene');
    }

    init(data) {
        this.totalPlayers = data.players || 2;
        this.totalRounds = data.rounds || 20;
        this.comboRules = data.combos ?? false;
        this.multiplexRules = data.multiplex ?? false;
        this.teamsEnabled = data.teamsEnabled ?? false;
        this.playerTeams = data.teams || Array.from({ length: this.totalPlayers }, (_, i) => i % 2 === 0 ? 'blue' : 'red');

        this.currentRound = 1;
        this.playerNames = data.names || Array.from({ length: this.totalPlayers }, (_, i) => `P${i + 1}`);
        this.playerTints = [0x66aaff, 0xffff66, 0x66ff99, 0xff6666, 0xffaa44, 0xee88ff];
        this.teamTints = { blue: 0x66aaff, red: 0xff6666 };

        this.isAI = data.ai || Array.from({ length: this.totalPlayers }, (_, i) => i !== 0);
        this.aiDifficultyNames = data.difficulty || [];
        this.aiDifficulty = this.aiDifficultyNames.map(name => {
          switch ((name || "Medium").toLowerCase()) {
            case "baby": return 0.5;
            case "easy": return 0.75;
            case "hard": return 1.5;
            case "nightmare": return 2;
            case "medium":
            default: return 1;
          }
        });

        this.dice = new Dice();

        this.currentPlayer = 0;
        this.waitingForRoll = Array(this.totalPlayers).fill(false);

        this.scores = Array(this.totalPlayers).fill(0);

        this.comboStats = Array(this.totalPlayers).fill(null).map(() => ({
            pair: 0,
            twoPair: 0,
            triple: 0,
            fullHouse: 0,
            fourOfAKind: 0,
            fiveOfAKind: 0,
            straight: 0,
        }));

        this.playerSlots = Array.from({ length: this.totalPlayers }, (_, i) => ({
            id: i,
            name: this.playerNames[i] || `P${i + 1}`,
            avatar: this.isAI[i] ? 'botIcon' : 'playerIcon',
            connected: true,
            team: this.playerTeams[i] || (i % 2 === 0 ? 'blue' : 'red')
        }));
    }

    create() {
        ErrorHandler.setScene(this);
        this.debugger = DebugManager.create(this, { namespace: 'LocalGameScene' });
        this.exitLocked = true;
        this.exitModal = null;
        this._hasRolledThisTurn = false;
        this._endTurnTimer = null;
        
        // Team score display (if teams enabled)
        this.teamScoreText = null;
        if (this.teamsEnabled) {
            this.teamScoreText = this.add.text(600, 30, '', {
                fontSize: 28,
                color: '#ffffff',
                align: 'center'
            }).setOrigin(0.5);
        }
        
        this.roundTitle = this.add.text(
            600,
            50,
            tf('LOCAL_ROUND_TITLE', 'Local Game - Round {0}/{1}', this.currentRound, this.totalRounds),
            { fontSize: 32 }
        ).setOrigin(0.5);

        this.info = this.add.text(600, 180, '', {
            fontSize: 24,
            align: 'center'
        }).setOrigin(0.5);

        this.rollBtn = this.add.text(600, 300, t('UI_ROLL_DICE', 'Roll Dice'), {
            fontSize: 32,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        this.rollBtn.on('pointerdown', () => {
            this.handleRollPressed();
        });

        this.endTurnBtn = this.add.text(600, 360, t('UI_END_TURN', 'End Turn'), {
            fontSize: 20,
            color: '#888888'
        }).setOrigin(0.5).setInteractive();
        this.endTurnBtn.disableInteractive();
        this.endTurnBtn.on('pointerdown', () => {
            this.handleEndTurnPressed();
        });

        // Hotkeys: Space/R = roll, T = end turn, ESC = exit modal toggle
        if (this.input && this.input.keyboard) {
            this._hotkeyHandlers = {
                rollSpace: (event) => { if (event.repeat) return; this.handleRollPressed(); },
                rollR: (event) => { if (event.repeat) return; this.handleRollPressed(); },
                endT: (event) => { if (event.repeat) return; this.handleEndTurnPressed(); },
                esc: (event) => { if (event.repeat) return; this.handleEscPressed(); }
            };
            this.input.keyboard.on('keydown-SPACE', this._hotkeyHandlers.rollSpace);
            this.input.keyboard.on('keydown-R', this._hotkeyHandlers.rollR);
            this.input.keyboard.on('keydown-T', this._hotkeyHandlers.endT);
            this.input.keyboard.on('keydown-ESC', this._hotkeyHandlers.esc);
            this.events.once('shutdown', () => this.cleanupHotkeys());
        }

        this.diceSprites = [];
        const startX = 600 - (5 * 70) / 2;
        const y = 240;
        for (let i = 0; i < 5; i++) {
            const sprite = this.add.image(startX + i * 70, y, 'dice1').setScale(0.9).setVisible(false);
            sprite.originalX = sprite.x;
            sprite.originalY = sprite.y;
            this.diceSprites.push(sprite);
        }

        this.scoreBreakdown = this.add.text(600, 420, "", {
            fontSize: 20,
            color: '#ffffaa',
            align: 'center'
        }).setOrigin(0.5).setAlpha(0).setDepth(50);

        this.playerBar = [];
        this.createPlayerBar();

        this.addBackButton();
        this.startTurn();
    }

    createPlayerBar() {
        if (Array.isArray(this.playerBar) && this.playerBar.length) {
            this.playerBar.forEach(item => {
                if (item.icon) item.icon.destroy();
                if (item.tag) item.tag.destroy();
                if (item.ring) item.ring.destroy();
                if (item.scoreText) item.scoreText.destroy();
            });
        }
        this.playerBar = [];

        const total = this.totalPlayers;
        const spacing = 200;
        const startX = 600 - ((total - 1) * spacing) / 2;
        const y = 850;

        for (let i = 0; i < total; i++) {
            const iconKey = this.isAI[i] ? "botIcon" : "playerIcon";

            const icon = this.add.image(startX + i * spacing, y, iconKey).setScale(0.7);
            const tag = this.add.text(startX + i * spacing, y + 70, this.playerNames[i] || `P${i + 1}`, {
                fontSize: 28,
                color: '#ffffff'
            }).setOrigin(0.5);

            // scoreText sits above the icon
            const scoreText = this.add.text(startX + i * spacing, y - 70, String(this.scores[i] || 0), {
                fontSize: 20,
                color: '#ffff88'
            }).setOrigin(0.5).setVisible(true);

            const ring = this.add.rectangle(startX + i * spacing, y, 90, 90, 0x66ccff, 0.25)
                .setStrokeStyle(3, 0x66ccff)
                .setVisible(false);

            this.playerBar.push({
                ring,
                icon,
                tag,
                scoreText
            });
        }

        // initial sync
        this.updatePlayerBar();
    }

    getPlayerTintColor(playerIndex) {
        if (this.teamsEnabled && this.playerTeams) {
            const team = this.playerTeams[playerIndex] || (playerIndex % 2 === 0 ? 'blue' : 'red');
            return this.teamTints[team] || 0x66aaff;
        } else {
            return this.playerTints[playerIndex % this.playerTints.length] || 0x66aaff;
        }
    }

    updatePlayerBar() {
        const total = this.totalPlayers;
        const spacing = 200;
        const startX = 600 - ((total - 1) * spacing) / 2;
        const y = 850;

        this.playerBar.forEach((p, index) => {
            const x = startX + index * spacing;

            // reposition visuals in case layout changed
            if (p.icon) { p.icon.x = x; p.icon.y = y; p.icon.setVisible(index < total); }
            if (p.tag) { p.tag.x = x; p.tag.y = y + 70; p.tag.setVisible(index < total); }
            if (p.scoreText) { p.scoreText.x = x; p.scoreText.y = y - 70; p.scoreText.setVisible(index < total); }
            if (p.ring) { p.ring.x = x; p.ring.y = y; p.ring.setVisible(index < total); }

            // highlight active player and apply ring color based on team/position
            if (p.ring) {
                p.ring.setVisible(index === this.currentPlayer);
                const ringColor = this.getPlayerTintColor(index);
                p.ring.setFillStyle(ringColor, 0.25);
                p.ring.setStrokeStyle(3, ringColor);
            }

            // supply name/avatar from playerSlots (keeps parity with OnlineGameScene approach)
            const slot = this.playerSlots && this.playerSlots[index] ? this.playerSlots[index] : null;
            if (slot) {
                if (p.icon) p.icon.setTexture(slot.avatar || 'playerIcon');
                if (p.tag) p.tag.setText(slot.name || `P${index + 1}`);
                // update score text from authoritative scores array
                const sc = (this.scores && typeof this.scores[index] === 'number') ? String(this.scores[index]) : '0';
                if (p.scoreText) p.scoreText.setText(sc).setVisible(true);

                if (slot.connected === false) {
                    if (p.tag) p.tag.setText(tf('GAME_PLAYER_LEFT', '{0} (left)', slot.name));
                    if (p.scoreText) p.scoreText.setTint(0x444444);
                } else {
                    if (p.scoreText) p.scoreText.clearTint();
                }
            } else {
                // fallback: use playerNames
                if (p.tag) p.tag.setText(this.playerNames[index] || `P${index + 1}`);
                const sc = (this.scores && typeof this.scores[index] === 'number') ? String(this.scores[index]) : '0';
                if (p.scoreText) p.scoreText.setText(sc);
            }
        });

        // Update team scores if teams are enabled
        if (this.teamsEnabled) {
            this.updateTeamScoreDisplay();
        }
    }

    updateTeamScoreDisplay() {
        if (!this.teamsEnabled || !this.teamScoreText) return;

        let blueScore = 0;
        let redScore = 0;

        for (let i = 0; i < this.totalPlayers; i++) {
            const team = this.playerTeams[i] || this.playerSlots[i]?.team || (i % 2 === 0 ? 'blue' : 'red');
            if (team === 'blue') {
                blueScore += this.scores[i] || 0;
            } else if (team === 'red') {
                redScore += this.scores[i] || 0;
            }
        }

        this.teamScoreText.setText(
            tf(
                'TEAM_SCORE_DISPLAY',
                '{0}: {1} | {2}: {3}',
                teamLabel('blue'),
                blueScore,
                teamLabel('red'),
                redScore
            )
        );
    }

    startTurn() {
        const isBot = this.isAI[this.currentPlayer];
        const name = this.playerNames[this.currentPlayer];

        this.waitingForRoll[this.currentPlayer] = false;
        this._hasRolledThisTurn = false;
        if (this._endTurnTimer) {
            this._endTurnTimer.remove(false);
            this._endTurnTimer = null;
        }
        this.info.setText(tf('GAME_TURN', "{0}'s turn", name));
        if (this.debugger) {
            this.debugger.turnStart({ playerIndex: this.currentPlayer, playerName: name, round: this.currentRound });
        }

        const isHuman = !isBot;

        if (isHuman) {
            this.rollBtn.setInteractive();
            this.rollBtn.setText(t('UI_ROLL_DICE', 'Roll Dice'));
            this.rollBtn.setStyle({ color: '#66ff66' });
        } else {
            this.rollBtn.disableInteractive();
            this.rollBtn.setText(t('UI_WAITING', 'Waiting...'));
            this.rollBtn.setStyle({ color: '#888888' });
        }

        this.endTurnBtn.disableInteractive();
        this.endTurnBtn.setText(t('UI_END_TURN', 'End Turn'));
        this.endTurnBtn.setStyle({ color: '#888888' });

        if (isBot) {
            this.time.delayedCall(1000, () => {
                this.rollBtn.setStyle({ color: '#c4c70bd2' });
                this.rollBtn.setText(t('UI_ROLLING', 'Rolling...'));
                this.handleRollPressed({ force: true });
            });
        }
    }

    handleRollPressed({ force = false } = {}) {
        if (this.exitModal) return;
        if (!force && this.isAI[this.currentPlayer]) return;
        if (this.waitingForRoll[this.currentPlayer]) return;

        this.waitingForRoll[this.currentPlayer] = true;
        this.rollBtn.disableInteractive();
        this.rollBtn.setStyle({ color: '#c4c70bd2' });
        this.rollBtn.setText(t('UI_ROLLING', 'Rolling...'));

        if (this.debugger) {
            this.debugger.rollStart({
                playerIndex: this.currentPlayer,
                playerName: this.playerNames[this.currentPlayer]
            });
        }

        this.processTurn();
    }

    handleEndTurnPressed() {
        if (this.exitModal) return;
        if (this.isAI[this.currentPlayer]) return;
        if (this.endTurnBtn?.input?.enabled !== true) return;
        if (!this._hasRolledThisTurn) {
            this.info.setText(t('GAME_MUST_ROLL', 'You must roll before ending your turn.'));
            return;
        }
        this.finishTurn('manual');
    }

    finishTurn(reason = 'manual') {
        this.endTurnBtn.disableInteractive();
        this.endTurnBtn.setStyle({ color: '#888888' });

        if (this.debugger) {
            this.debugger.turnEnd({
                playerIndex: this.currentPlayer,
                playerName: this.playerNames[this.currentPlayer],
                reason
            });
        }

        this.nextPlayer();
    }

    getBaseScore(dice) {
        if (!Array.isArray(dice) || dice.length === 0) return 0;
        if (this.multiplexRules) {
            return dice.reduce((acc, val) => acc * val, 1);
        }
        return dice.reduce((a, b) => a + b, 0);
    }

    getComboLabel(combo) {
        if (!combo) return '';
        const key = combo.key || '';
        switch (key) {
            case 'pair': return t('COMBO_PAIR', 'PAIR!');
            case 'twoPair': return t('COMBO_TWO_PAIR', 'TWO PAIR!');
            case 'triple': return t('COMBO_TRIPLE', 'TRIPLE!');
            case 'fullHouse': return t('COMBO_FULL_HOUSE', 'FULL HOUSE!');
            case 'fourOfAKind': return t('COMBO_FOUR_KIND', 'FOUR OF A KIND!');
            case 'fiveOfAKind': return t('COMBO_FIVE_KIND', 'FIVE OF A KIND!');
            case 'straight': return t('COMBO_STRAIGHT', 'STRAIGHT!');
            default: return combo.type || key;
        }
    }

    async processTurn() {
        const dice = this.rollFiveDice();

        // animate and show sounds
        await animateDiceRoll(this, dice);

        const base = this.getBaseScore(dice);
        const combo = ComboManager.checkCombo(dice);
        const scored = this.applyBonus(dice, base);

        if (this.debugger) {
            this.debugger.rollResult({
                playerIndex: this.currentPlayer,
                playerName: this.playerNames[this.currentPlayer],
                dice,
                scored
            });
        }

        if (combo) {
            if (combo.key) {
                this.comboStats[this.currentPlayer][combo.key] = (this.comboStats[this.currentPlayer][combo.key] || 0) + 1;
            }

            if (this.comboRules) {
                const comboLabel = this.getComboLabel(combo);
                ComboManager.playComboFX(this, combo.key);
                ComboManager.showComboText(this, comboLabel, combo.intensity || 1, combo.key);
                if (GlobalAudio && combo.key && typeof GlobalAudio.comboSFX === 'function') {
                    GlobalAudio.comboSFX(this, combo.key);
                }
            }
        }

        this.scores[this.currentPlayer] += scored;

        // Update textures and display
        dice.forEach((face, i) =>
            this.diceSprites[i].setTexture(`dice${face}`).setVisible(true)
        );

        this.updateDiceScoreDisplay(dice, scored);

        this.info.setText(tf('GAME_ROLL_RESULT', "{0}'s roll", this.playerNames[this.currentPlayer]));
        this.rollBtn.setText(t('UI_RESULTS', 'Results')).setStyle({ color: '#888888' });

        this.waitingForRoll[this.currentPlayer] = true;
        this._hasRolledThisTurn = true;
        this.updatePlayerBar();

        if (this.isAI[this.currentPlayer]) {
            if (this._endTurnTimer) this._endTurnTimer.remove(false);
            this._endTurnTimer = this.time.delayedCall(1200, () => {
                this.finishTurn('auto');
            });
        } else {
            this.endTurnBtn.setInteractive();
            this.endTurnBtn.setStyle({ color: '#ff4444' });
        }
    }

    rollFiveDice() {
      if (GlobalAudio.playDice) GlobalAudio.playDice(this);

      const i = this.currentPlayer;
      const isBot = !!this.isAI[i];
      const luck =
        typeof this.aiDifficulty?.[i] === 'number'
          ? this.aiDifficulty[i]
          : 1;

      // Humans and Medium bots = pure RNG
      if (!isBot || luck === 1) {
        return this.dice.rollMany(5);
      }

      // Combo rules override (difficulty-sealed)
      if (this.comboRules) {
        const forced = this.forceComboPattern(luck);
        if (forced) return forced;
      }

      // -----------------------------
      // Weighted dice bias (non-combo)
      // -----------------------------

      const k = Math.log(Math.max(1e-6, luck));
      const weights = [];
      let total = 0;

      for (let f = 1; f <= 6; f++) {
        const w = Math.exp(k * (f - 3.5));
        weights.push(w);
        total += w;
      }

      const cum = [];
      let sum = 0;
      for (let i = 0; i < weights.length; i++) {
        sum += weights[i];
        cum.push(sum / total);
      }

      const luckyRoll = () => {
        const u = Math.random();
        for (let i = 0; i < cum.length; i++) {
          if (u <= cum[i]) return i + 1;
        }
        return 6;
      };

      return [
        luckyRoll(),
        luckyRoll(),
        luckyRoll(),
        luckyRoll(),
        luckyRoll()
      ];
    }

    forceComboPattern(luck) {
      const roll = Math.random();

      // ================= NIGHTMARE =================
      if (luck >= 1.8) {
        if (roll < 0.05) return this.dice.fiveOfAKind();   // 5%
        if (roll < 0.25) return this.dice.fourOfAKind();   // +20%
        if (roll < 0.55) return this.dice.fullHouse();     // +30%
        return null;
      }

      // ================= HARD =================
      if (luck >= 1.4) {
        if (roll < 0.1) return this.dice.fullHouse();     // 10%
        if (roll < 0.4) return this.dice.triple();        // +30%
        if (roll < 0.65) { // 25% straight total:
          // 40% large, 60% small
          return Math.random() < 0.4
            ? this.dice.largeStraight()
            : this.dice.smallStraight();
        }
        return null;
      }

      // ================= MEDIUM =================
      if (luck === 1) {
        return null; // pure RNG
      }

      // ================= EASY =================
      if (luck <= 0.8 && luck > 0.6) {
        if (roll < 0.20) return this.dice.runt();           // 20%
        if (roll < 0.6) return this.dice.pair();           // +40%
        if (roll < 0.7) return this.dice.twoPair();        // +10%
        return null;
      }

      // ================= BABY =================
      if (luck <= 0.6) {
        if (roll < 0.50) return this.dice.runt();           // 50%
        if (roll < 0.60) return this.dice.pair();           // +10%
        return null;
      }

      return null;
    }

    updateDiceScoreDisplay(dice, scored) {
        const base = this.getBaseScore(dice);
        const combo = ComboManager.checkCombo(dice);

        const lines = [];
        lines.push(tf('SCORE_ROLLED', 'Rolled: {0}', dice.join(', ')));

        if (this.multiplexRules) {
            lines.push(tf('SCORE_MULTIPLEX_LINE', 'Multiplex Score: {0}', base));
        } else {
            lines.push(tf('SCORE_BASE_LINE', 'Base Score: {0}', base));
        }

        if (this.comboRules && combo) {
            const comboLabel = this.getComboLabel(combo);
            lines.push(tf('SCORE_COMBO_LINE', 'Combo: x{0} ({1})', (combo.multiplier || 1).toFixed(1), comboLabel));
        }

        lines.push(tf('SCORE_FINAL_LINE', 'Final Score: {0}', scored));

        const breakdown = lines.join('\n');

        // show transient breakdown (keeps parity with OnlineGameScene behavior)
        this.scoreBreakdown.setText(breakdown);
        try {
            this.scoreBreakdown.setAlpha(0);
            this.tweens.killTweensOf(this.scoreBreakdown);
            this.tweens.add({
                targets: this.scoreBreakdown,
                alpha: 1,
                duration: 220,
                ease: 'Cubic.easeOut'
            });
        } catch (e) {}

        if (this._scoreDisplayTimer) this._scoreDisplayTimer.remove(false);
        this._scoreDisplayTimer = this.time.delayedCall(4000, () => {
            try {
                this.tweens.add({
                    targets: this.scoreBreakdown,
                    alpha: 0,
                    duration: 300,
                    onComplete: () => this.scoreBreakdown.setText('')
                });
            } catch (e) {
                this.scoreBreakdown.setText('');
            }
            this._scoreDisplayTimer = null;
        });
    }

    nextPlayer() {
        this.currentPlayer++;

        // Next round
        if (this.currentPlayer >= this.totalPlayers) {
            this.currentPlayer = 0;
            this.currentRound++;

            if (this.currentRound > this.totalRounds) {
                this.endGame();
                return;
            }

            this.updateRoundTitle();
        }

        this.startTurn();
        this.updatePlayerBar();
    }

    applyBonus(dice, baseScore) {
        if (!this.comboRules) return baseScore;

        let score = baseScore;

        // ==== COMBO MANAGER CHECK ====
        const combo = ComboManager.checkCombo(dice);

        if (combo) {
            score = baseScore * combo.multiplier;
        }

        return Math.floor(score);
    }

    updateRoundTitle() {
        this.roundTitle.setText(
            tf('LOCAL_ROUND_TITLE', 'Local Game - Round {0}/{1}', this.currentRound, this.totalRounds)
        );
    }

    cleanupHotkeys() {
        if (!this._hotkeyHandlers || !this.input || !this.input.keyboard) return;
        this.input.keyboard.off('keydown-SPACE', this._hotkeyHandlers.rollSpace);
        this.input.keyboard.off('keydown-R', this._hotkeyHandlers.rollR);
        this.input.keyboard.off('keydown-T', this._hotkeyHandlers.endT);
        this.input.keyboard.off('keydown-ESC', this._hotkeyHandlers.esc);
        this._hotkeyHandlers = null;
    }

    endGame() {
        let result = '';
        const maxScore = Math.max(...this.scores);
        const winners = this.scores.map((s, i) => s === maxScore ? i : null).filter(i => i !== null);

        if (winners.includes(0)) {
            result = (winners.length === 1)
                ? t('GAME_WIN_YOU', 'You Win!')
                : t('GAME_TIE', "It's a Tie!");
        } else {
            result = tf('GAME_WIN_BOT', 'Bot {0} Wins!', winners[0]);
        }

        const scoreLines = this.scores.map((s, i) =>
            i === 0 ? tf('GAME_SCORE_YOU', 'You: {0}', s) : tf('GAME_SCORE_BOT', 'Bot {0}: {1}', i, s)
        ).join('\n');

        this.info.setText(
            `${t('GAME_OVER', 'Game Over')}

${t('GAME_SCORES', 'Scores:')}
${scoreLines}

${result}`
        );

        this.rollBtn.disableInteractive();

        this.exitLocked = false;

        this.registry.set("localPostGame", {
            players: this.totalPlayers,
            scores: this.scores,
            combos: this.comboStats,
            rounds: this.totalRounds,
            names: this.playerNames,
            teamsEnabled: this.teamsEnabled,
            teams: this.playerTeams,
        });

        this.scene.start('LocalPostGameScene');
    }

    addBackButton() {
        const back = this.add.text(50, 50, t('UI_BACK', '<- Back'), {
            fontSize: 24,
            color: '#ff6666'
        }).setInteractive();

        back.on('pointerdown', () => {
            GlobalAudio.playButton(this);

            if (!this.exitLocked) {
                this.scene.start('MenuScene');
            } else {
                this.showConfirmExit();
            }
        });
    }

    handleEscPressed() {
        if (!this.exitLocked) {
            this.scene.start('MenuScene');
            return;
        }
        if (this.exitModal) {
            this.hideConfirmExit();
            return;
        }
        this.showConfirmExit();
    }

    showConfirmExit() {
        if (this.exitModal) return;
        const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.8);

        const msg = this.add.text(
            600,
            260,
            t('GAME_EXIT_CONFIRM', 'Are you sure you want to return to the main menu?'),
            {
                fontSize: 26,
                align: 'center'
            }
        ).setOrigin(0.5);

        const yesBtn = this.add.text(550, 340, t('UI_YES', 'Yes'), {
            fontSize: 28,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        const noBtn = this.add.text(650, 340, t('UI_NO', 'No'), {
            fontSize: 28,
            color: '#ff6666'
        }).setOrigin(0.5).setInteractive();

        yesBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.hideConfirmExit();
            this.scene.start('MenuScene');
        });

        noBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.hideConfirmExit();
        });

        this.exitModal = { bg, msg, yesBtn, noBtn };
    }

    hideConfirmExit() {
        if (!this.exitModal) return;
        const { bg, msg, yesBtn, noBtn } = this.exitModal;
        if (bg) bg.destroy();
        if (msg) msg.destroy();
        if (yesBtn) yesBtn.destroy();
        if (noBtn) noBtn.destroy();
        this.exitModal = null;
    }
}
