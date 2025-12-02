import { GlobalAudio } from '../main.js';
import { checkCombo, showComboText } from '../utils/ComboManager.js';

export default class LocalGameScene extends Phaser.Scene {
    constructor() {
        super('LocalGameScene');
    }

    init(data) {

        // Load settings (comboRules now stored globally)
        const settings = GlobalAudio.getSettings(this);

        this.totalPlayers = data.players || 2;     // total players including you
        this.totalRounds = data.rounds || 20;
        this.comboRules = settings.comboRules ?? false;

        this.currentRound = 1;

        // Player 0 = you
        this.scores = Array(this.totalPlayers).fill(0);
		
		this.comboStats = Array(this.totalPlayers).fill(null).map(() => ({
            pair: 0,
            triple: 0,
            fullHouse: 0,
            fourKind: 0,
            fiveKind: 0,
            smStraight: 0,
			lgStraight: 0,
        }));
    }

    create() {
        this.roundTitle = this.add.text(400, 50,
            `Local Game — Round ${this.currentRound}/${this.totalRounds}`,
            { fontSize: 32 }
        ).setOrigin(0.5);

        this.info = this.add.text(400, 180, '', {
            fontSize: 24,
            align: 'center'
        }).setOrigin(0.5);

        this.rollBtn = this.add.text(400, 300, 'Roll Dice', {
            fontSize: 32
        }).setOrigin(0.5).setInteractive();

        this.rollBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.playRound();
        });

        this.addBackButton();
    }

    playRound() {
        GlobalAudio.playDice(this);

        const roll = () => Math.ceil(Math.random() * 6);

        const rollsByPlayer = [];

        // Roll dice for each player
        for (let p = 0; p < this.totalPlayers; p++) {
            const dice = [roll(), roll(), roll(), roll(), roll()];
            rollsByPlayer.push(dice);

            const base = dice.reduce((a,b) => a + b, 0);
            const scored = this.applyBonus(dice, base);
			const combo = checkCombo(dice);
			
			if (combo) {
                const statName =
                    combo.type.includes("PAIR!") ? "pair" :
                    combo.type.includes("TRIPLE!") ? "triple" :
                    combo.type.includes("FULL HOUSE!!!") ? "fullHouse" :
                    combo.type.includes("FOUR OF A KIND!!!!") ? "fourKind" :
                    combo.type.includes("FIVE OF A KIND?!!?!") ? "fiveKind" :
                    combo.type.includes("STRAIGHT!") ? "smStraight" : null;
					combo.type.includes("LARGE STRAIGHT!!") ? "lgStraight" : null;

                if (statName) {
                    this.comboStats[p][statName]++;
                }
            }
			
			if (p === 0) {
                showComboText.call(this, combo.type, combo.intensity);
            }

            scored = base * combo.multiplier;

            this.scores[p] += scored;
        }

        // Build output log
        let msg = "";

        // You
        msg += `You rolled: ${rollsByPlayer[0].join(', ')}\n`;

        // Opponents
        for (let i = 1; i < this.totalPlayers; i++) {
            msg += `Bot ${i} rolled: ${rollsByPlayer[i].join(', ')}\n`;
        }

        this.info.setText(msg);

        this.currentRound++;

        if (this.currentRound > this.totalRounds) {
            this.endGame();
        } else {
            this.updateRoundTitle();
        }
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
        const winners = this.scores.map((s,i)=> s === maxScore ? i : null).filter(i=>i!==null);

        if (winners.includes(0)) {
            result = (winners.length === 1) ? "You Win!" : "It's a Tie!";
        } else {
            result = `Bot ${winners[0]} Wins!`;
        }

        this.info.setText(
            `GAME OVER\n\nScores:\n` +
            this.scores.map((s,i)=> i===0 ? `You: ${s}` : `Bot ${i}: ${s}`).join('\n') +
            `\n\n${result}`
        );

        this.rollBtn.disableInteractive();

        this.exitLocked = true;
		
		this.registry.set("localPostGame", {
            players: this.totalPlayers,
            scores: this.scores,
            combos: this.comboStats,
            rounds: this.totalRounds,
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
            "Are you sure you want\n to return to the main menu?",
            { fontSize: 26, align: 'center' }
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
            bg.destroy(); msg.destroy(); yesBtn.destroy(); noBtn.destroy();
        });
    }
}