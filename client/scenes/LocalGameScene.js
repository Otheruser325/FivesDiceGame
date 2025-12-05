import { GlobalAudio } from '../main.js';
import { animateDiceRoll } from '../utils/AnimationManager.js';
import { checkCombo, showComboText, playComboFX } from '../utils/ComboManager.js';

export default class LocalGameScene extends Phaser.Scene {
    constructor() {
        super('LocalGameScene');
    }

    init(data) {

        // Load settings (comboRules now stored globally)
        const settings = GlobalAudio.getSettings(this);

        this.totalPlayers = data.players || 2; // total players including you
        this.totalRounds = data.rounds || 20;
        this.comboRules = settings.comboRules ?? false;

        this.currentRound = 1;
        this.playerNames = data.names;
        this.isAI = data.ai;

        this.currentPlayer = 0;
        this.waitingForRoll = true;

        // Player 0 = you
        this.scores = Array(this.totalPlayers).fill(0);

        this.comboStats = Array(this.totalPlayers).fill(null).map(() => ({
            pair: 0,
            twoPair: 0,
            triple: 0,
            fullHouse: 0,
            fourKind: 0,
            fiveKind: 0,
            straight: 0,
        }));
    }

    create() {
		this.exitLocked = false;
		
        this.roundTitle = this.add.text(400, 50,
            `Local Game — Round ${this.currentRound}/${this.totalRounds}`, {
                fontSize: 32
            }
        ).setOrigin(0.5);

        this.info = this.add.text(400, 180, '', {
            fontSize: 24,
            align: 'center'
        }).setOrigin(0.5);

        this.rollBtn = this.add.text(400, 300, 'Roll Dice', {
            fontSize: 32
        }).setOrigin(0.5).setInteractive();

        this.rollBtn.on('pointerdown', () => {
            if (this.isAI[this.currentPlayer]) return;
            this.rollBtn.disableInteractive();
            this.processTurn();
        });

        // --- Dice display positions ---
        this.diceSprites = [];
        const startX = 400 - (5 * 70) / 2; // center dice row
        const y = 240;

        for (let i = 0; i < 5; i++) {
            const sprite = this.add.image(startX + i * 70, y, 'dice1')
                .setScale(0.9)
                .setVisible(false);
				
			sprite.originalX = sprite.x;
            sprite.originalY = sprite.y;

            this.diceSprites.push(sprite);
        }

        // --- Score text ---
        this.scoreBreakdown = this.add.text(400, 380, "", {
            fontSize: 24,
            color: '#ffffaa',
            align: 'center'
        }).setOrigin(0.5);

        this.createPlayerBar();
        this.addBackButton();
        this.startTurn();
    }

    createPlayerBar() {
        this.playerBar = [];

        const spacing = 200;
        const startX = 600 - ((this.totalPlayers - 1) * spacing) / 2;
        const y = 850;

        for (let i = 0; i < this.totalPlayers; i++) {
            const iconKey = this.isAI[i] ? "botIcon" : "playerIcon";

            const container = this.add.container(0, 0);

            const icon = this.add.image(startX + i * spacing, y, iconKey)
                .setScale(0.7);

            const tag = this.add.text(startX + i * spacing, y + 70, `P${i+1}`, {
                fontSize: 28,
                color: '#ffffff'
            }).setOrigin(0.5);

            // highlight ring
            const ring = this.add.rectangle(startX + i * spacing, y, 90, 90, 0x66ccff, 0.25)
                .setStrokeStyle(3, 0x66ccff)
                .setVisible(false);

            container.add([ring, icon, tag]);

            this.playerBar.push({
                ring,
                icon,
                tag
            });
        }

        this.updatePlayerBar();
    }

    updatePlayerBar() {
        this.playerBar.forEach((p, index) => {
            p.ring.setVisible(index === this.currentPlayer);
        });
    }

    startTurn() {

        const isBot = this.isAI[this.currentPlayer];
        const name = this.playerNames[this.currentPlayer];

        this.info.setText(`${name}'s turn`);

        if (!isBot) {
            this.rollBtn.setInteractive();
            return;
        }

        // AI rolls automatically after 1 second
        this.rollBtn.disableInteractive();
        this.time.delayedCall(1000, () => {
            this.processTurn();
        });
    }

    async processTurn() {
    const dice = this.rollFiveDice();

    await animateDiceRoll(this, dice);

    const base = dice.reduce((a, b) => a + b, 0);
    const combo = checkCombo(dice);
    const scored = this.applyBonus(dice, base);

    if (combo) {
        if (combo.key) {
            this.comboStats[this.currentPlayer][combo.key]++;
        }
		
		if (this.comboRules) {
            playComboFX(this, combo.key);
        }
		
        if (!this.isAI[this.currentPlayer] && this.comboRules) {
            showComboText.call(this, combo.type, combo.intensity);
        }
		
		// Determines which combo plays a specific sound effect
		if (combo.type == "FIVE OF A KIND?!!?!") {
            GlobalAudio.comboSFX(this, 'fiveKind');
        } else if (combo.type == "FOUR OF A KIND!!!!") {
            GlobalAudio.comboSFX(this, 'fourKind');
        } else if (combo.type == "FULL HOUSE!!!") {
            GlobalAudio.comboSFX(this, 'fullHouse');
        } else if (combo.type == "TRIPLE!") {
            GlobalAudio.comboSFX(this, 'triple');
        } else if (combo.type == "STRAIGHT!") {
            GlobalAudio.comboSFX(this, 'straight');
        } else if (combo.type == "TWO PAIR!") {
            GlobalAudio.comboSFX(this, 'pair');
        } else if (combo.type == "PAIR!") {
            GlobalAudio.comboSFX(this, 'pair');
        }
    }

    this.scores[this.currentPlayer] += scored;

    // update textures
    dice.forEach((face, i) =>
        this.diceSprites[i].setTexture(`dice${face}`).setVisible(true)
    );

    this.updateDiceScoreDisplay(dice, scored);

    this.info.setText(`${this.playerNames[this.currentPlayer]}'s roll`);

    this.updatePlayerBar();

    this.time.delayedCall(3000, () => this.nextPlayer());
}

rollFiveDice() {
    GlobalAudio.playDice(this);
    const r = () => Math.ceil(Math.random() * 6);
    return [r(), r(), r(), r(), r()];
}

updateDiceScoreDisplay(dice, scored) {
    const base = dice.reduce((a, b) => a + b, 0);
    const combo = checkCombo(dice);

    let breakdown = `Rolled: ${dice.join(", ")}\nBase Score: ${base}`;

    if (this.comboRules && combo) {
        breakdown += `\nCombo: x${combo.multiplier.toFixed(1)}\nFinal Score: ${scored}`;
    } else {
        breakdown += `\nFinal Score: ${scored}`;
    }

    this.scoreBreakdown.setText(breakdown);
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
        // Determine winner
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

        this.exitLocked = true;

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

            if (this.exitLocked) {
                this.scene.start('MenuScene');
            } else {
                this.showConfirmExit();
            }
        });
    }

    showConfirmExit() {
        const bg = this.add.rectangle(400, 300, 500, 250, 0x000000, 0.8);

        const msg = this.add.text(400, 260,
            "Are you sure you want\n to return to the main menu?", {
                fontSize: 26,
                align: 'center'
            }
        ).setOrigin(0.5);

        const yesBtn = this.add.text(350, 340, "Yes", {
            fontSize: 28,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        const noBtn = this.add.text(450, 340, "No", {
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