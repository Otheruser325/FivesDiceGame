import { GlobalAudio } from '../utils/AudioManager.js';
import { animateDiceRoll } from '../utils/AnimationManager.js';
import { checkCombo, showComboText, playComboFX } from '../utils/ComboManager.js';

export default class LocalGameScene extends Phaser.Scene {
    constructor() {
        super('LocalGameScene');
    }

    init(data) {
        this.totalPlayers = data.players || 2;
        this.totalRounds = data.rounds || 20;
        this.comboRules = data.combos ?? false;

        this.currentRound = 1;
        this.playerNames = data.names || Array.from({ length: this.totalPlayers }, (_, i) => `P${i + 1}`);
        this.isAI = data.ai || Array.from({ length: this.totalPlayers }, (_, i) => i !== 0);

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
            connected: true
        }));
    }

    create() {
        this.exitLocked = true;
        this.roundTitle = this.add.text(600, 50,
            `Local Game — Round ${this.currentRound}/${this.totalRounds}`, {
                fontSize: 32
            }
        ).setOrigin(0.5);

        this.info = this.add.text(600, 180, '', {
            fontSize: 24,
            align: 'center'
        }).setOrigin(0.5);

        this.rollBtn = this.add.text(600, 300, 'Roll Dice', {
            fontSize: 32,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        this.rollBtn.on('pointerdown', () => {
            if (this.isAI[this.currentPlayer]) return;
            if (this.waitingForRoll[this.currentPlayer]) return;
            this.waitingForRoll[this.currentPlayer] = true;
            this.rollBtn.disableInteractive();
            this.rollBtn.setStyle({ color: '#c4c70bd2' });
            this.rollBtn.setText('Rolling...');
            this.processTurn();
        });

        this.diceSprites = [];
        const startX = 600 - (5 * 70) / 2;
        const y = 240;
        for (let i = 0; i < 5; i++) {
            const sprite = this.add.image(startX + i * 70, y, 'dice1').setScale(0.9).setVisible(false);
            sprite.originalX = sprite.x;
            sprite.originalY = sprite.y;
            this.diceSprites.push(sprite);
        }

        this.scoreBreakdown = this.add.text(600, 380, "", {
            fontSize: 24,
            color: '#ffffaa',
            align: 'center'
        }).setOrigin(0.5).setAlpha(1);

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

            // highlight active
            if (p.ring) p.ring.setVisible(index === this.currentPlayer);

            // supply name/avatar from playerSlots (keeps parity with OnlineGameScene approach)
            const slot = this.playerSlots && this.playerSlots[index] ? this.playerSlots[index] : null;
            if (slot) {
                if (p.icon) p.icon.setTexture(slot.avatar || 'playerIcon');
                if (p.tag) p.tag.setText(slot.name || `P${index + 1}`);
                // update score text from authoritative scores array
                const sc = (this.scores && typeof this.scores[index] === 'number') ? String(this.scores[index]) : '0';
                if (p.scoreText) p.scoreText.setText(sc).setVisible(true);

                if (slot.connected === false) {
                    if (p.icon) p.icon.setTint(0x444444);
                    if (p.tag) p.tag.setText(`${slot.name} (left)`);
                    if (p.scoreText) p.scoreText.setTint(0x444444);
                } else {
                    if (p.icon) p.icon.clearTint();
                    if (p.scoreText) p.scoreText.clearTint();
                }
            } else {
                // fallback: use playerNames
                if (p.tag) p.tag.setText(this.playerNames[index] || `P${index + 1}`);
                const sc = (this.scores && typeof this.scores[index] === 'number') ? String(this.scores[index]) : '0';
                if (p.scoreText) p.scoreText.setText(sc);
            }
        });
    }

    startTurn() {
        const isBot = this.isAI[this.currentPlayer];
        const name = this.playerNames[this.currentPlayer];

        this.waitingForRoll[this.currentPlayer] = false;
        this.info.setText(`🎲 ${name}'s turn`);

        if (!this.waitingForRoll[this.currentPlayer]) {
            this.rollBtn.setInteractive();
            this.rollBtn.setText('Roll Dice');
            this.rollBtn.setStyle({ color: '#66ff66' });
        } else {
            this.rollBtn.disableInteractive();
            this.rollBtn.setText('Roll Dice');
            this.rollBtn.setStyle({ color: '#888888' });
        }

        if (isBot) {
            this.time.delayedCall(1000, () => {
                this.rollBtn.setStyle({ color: '#c4c70bd2' });
                this.rollBtn.setText('Rolling...');
                this.processTurn();
            });
        }
    }

    async processTurn() {
        const dice = this.rollFiveDice();

        // animate and show sounds
        await animateDiceRoll(this, dice);

        const base = dice.reduce((a, b) => a + b, 0);
        const combo = checkCombo(dice);
        const scored = this.applyBonus(dice, base);

        if (combo) {
            if (combo.key) {
                this.comboStats[this.currentPlayer][combo.key] = (this.comboStats[this.currentPlayer][combo.key] || 0) + 1;
            }

            if (this.comboRules) {
                playComboFX(this, combo.key);
                showComboText(this, combo.type || combo.key, combo.intensity || 1);
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

        this.info.setText(`🎲 ${this.playerNames[this.currentPlayer]}'s roll`);
        this.rollBtn.setText('Results');
        this.rollBtn.setStyle({ color: '#888888' });

        this.waitingForRoll[this.currentPlayer] = true;
        this.updatePlayerBar();

        this.time.delayedCall(3000, () => {
            this.nextPlayer();
        });
    }

    rollFiveDice() {
        if (GlobalAudio && typeof GlobalAudio.playDice === 'function') GlobalAudio.playDice(this);
        const r = () => Math.ceil(Math.random() * 6);
        return [r(), r(), r(), r(), r()];
    }

    updateDiceScoreDisplay(dice, scored) {
        const base = dice.reduce((a, b) => a + b, 0);
        const combo = checkCombo(dice);

        let breakdown = `Rolled: ${dice.join(", ")}\nBase Score: ${base}`;

        if (this.comboRules && combo) {
            breakdown += `\nCombo: x${(combo.multiplier || 1).toFixed(1)} (${combo.type})\nFinal Score: ${scored}`;
        } else {
            breakdown += `\nFinal Score: ${scored}`;
        }

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
        const combo = checkCombo(dice);

        if (combo) {
            score = baseScore * combo.multiplier;
        }

        return Math.floor(score);
    }

    updateRoundTitle() {
        this.roundTitle.setText(
            `Local Game — Round ${this.currentRound}/${this.totalRounds}`
        );
    }

    endGame() {
        let result = "";
        const maxScore = Math.max(...this.scores);
        const winners = this.scores.map((s, i) => s === maxScore ? i : null).filter(i => i !== null);

        if (winners.includes(0)) {
            result = (winners.length === 1) ? "You Win!" : "It's a Tie!";
        } else {
            result = `Bot ${winners[0]} Wins!`;
        }

        this.info.setText(
            `GAME OVER\n\nScores:\n` +
            this.scores.map((s, i) => i === 0 ? `You: ${s}` : `Bot ${i}: ${s}`).join('\n') +
            `\n\n${result}`
        );

        this.rollBtn.disableInteractive();

        this.exitLocked = false;

        this.registry.set("localPostGame", {
            players: this.totalPlayers,
            scores: this.scores,
            combos: this.comboStats,
            rounds: this.totalRounds,
            names: this.playerNames,
        });

        this.scene.start('LocalPostGameScene');
    }

    addBackButton() {
        const back = this.add.text(50, 550, 'Back', {
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

    showConfirmExit() {
        const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.8);

        const msg = this.add.text(600, 260,
            "Are you sure you want\n to return to the main menu?", {
                fontSize: 26,
                align: 'center'
            }
        ).setOrigin(0.5);

        const yesBtn = this.add.text(550, 340, "Yes", {
            fontSize: 28,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        const noBtn = this.add.text(650, 340, "No", {
            fontSize: 28,
            color: '#ff6666'
        }).setOrigin(0.5).setInteractive();

        yesBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });

        noBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            bg.destroy();
            msg.destroy();
            yesBtn.destroy();
            noBtn.destroy();
        });
    }
}