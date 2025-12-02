import { playButtonSFX, playDiceSFX } from '../utils/AudioManager.js';

export default class LocalGameScene extends Phaser.Scene {
    constructor() {
        super('LocalGameScene');
    }

    init(data) {
        this.totalPlayers = data.players || 2;
        this.totalRounds = data.rounds || 20;
        this.comboRules = data.combos || false;

        this.currentRound = 1;

        this.scores = Array(this.totalPlayers).fill(0);
    }

    create() {
        this.add.text(400, 50, `Local Game — Round ${this.currentRound}/${this.totalRounds}`, {
            fontSize: 32
        }).setOrigin(0.5);

        this.info = this.add.text(400, 150, '', {
            fontSize: 26,
            align: 'center'
        }).setOrigin(0.5);

        this.rollBtn = this.add.text(400, 300, 'Roll Dice', {
            fontSize: 32
        }).setOrigin(0.5).setInteractive();

        this.rollBtn.on('pointerdown', () => {
            playButtonSFX(this);
            this.playRound();
        });

        this.addBackButton();
    }

    playRound() {
        // Dice SFX
        playDiceSFX(this);

        const roll = () => Math.ceil(Math.random() * 6);
        const playerRolls = [];
        const botRolls = [];

        for (let i = 0; i < 5; i++) {
            playerRolls.push(roll());
            botRolls.push(roll());
        }

        const playerTotal = playerRolls.reduce((a, b) => a + b);
        const botTotal = botRolls.reduce((a, b) => a + b);

        const scoredPlayer = this.applyBonus(playerRolls, playerTotal);
        const scoredBot = this.applyBonus(botRolls, botTotal);

        this.scores[0] += scoredPlayer;
        this.scores[1] += scoredBot;

        this.info.setText(
            `You rolled: ${playerRolls.join(', ')} = ${scoredPlayer}\n` +
            `Bot rolled: ${botRolls.join(', ')} = ${scoredBot}`
        );

        this.currentRound++;

        if (this.currentRound > this.totalRounds) {
            this.endGame();
        } else {
            this.updateRoundTitle();
        }
    }

    applyBonus(dice, score) {
        if (!this.comboRules) return score;

        const counts = {};
        dice.forEach(n => counts[n] = (counts[n] || 0) + 1);

        if (Object.values(counts).includes(2)) score *= 1.2;
        if (Object.values(counts).includes(3)) score *= 1.5;

        const sorted = [...dice].sort();
        if (JSON.stringify(sorted) === JSON.stringify([1,2,3,4,5]) ||
            JSON.stringify(sorted) === JSON.stringify([2,3,4,5,6])) {
            score *= 2.5;
        }

        return Math.floor(score);
    }

    updateRoundTitle() {
        this.add.text(400, 50,
            `Local Game — Round ${this.currentRound}/${this.totalRounds}`,
            { fontSize: 32, color: '#ffffff' }
        ).setOrigin(0.5);
    }

    endGame() {
        const result =
            this.scores[0] > this.scores[1] ? "You Win!" :
            this.scores[0] < this.scores[1] ? "Bot Wins!" :
            "It's a Draw!";

        this.info.setText(
            `GAME OVER\n\n` +
            `Your Score: ${this.scores[0]}\nBot Score: ${this.scores[1]}\n\n${result}`
        );

        this.rollBtn.disableInteractive();
    }

    addBackButton() {
        const back = this.add.text(50, 550, 'Back', {
            fontSize: 24,
            color: '#ff6666'
        }).setInteractive();

        back.on('pointerdown', () => {
            playButtonSFX(this);
            this.showConfirmExit();
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
            playButtonSFX(this);
            this.scene.start('MenuScene');
        });

        noBtn.on('pointerdown', () => {
            playButtonSFX(this);
            bg.destroy();
            msg.destroy();
            yesBtn.destroy();
            noBtn.destroy();
        });
    }
}