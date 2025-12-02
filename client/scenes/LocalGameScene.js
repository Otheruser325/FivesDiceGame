import { GlobalAudio } from '../main.js';

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

    applyBonus(dice, score) {
        if (!this.comboRules) return score;

        const counts = {};
        dice.forEach(n => counts[n] = (counts[n] || 0) + 1);

        const values = Object.values(counts);

        // 5-of-a-kind
        if (values.includes(5)) score *= 10;

        // 4-of-a-kind
        else if (values.includes(4)) score *= 4;

        // 3-of-a-kind
        else if (values.includes(3)) score *= 2;

        // Pair
        else if (values.includes(2)) score *= 1.5;

        // Straights
        const sorted = [...dice].sort((a,b)=>a-b);

        // Large straight (5-in-a-row)
        const large1 = [1,2,3,4,5];
        const large2 = [2,3,4,5,6];

        if (JSON.stringify(sorted) === JSON.stringify(large1) ||
            JSON.stringify(sorted) === JSON.stringify(large2)) {
            score *= 3;
        }

        // Small straight (any 4-in-a-row)
        const unique = [...new Set(sorted)];
        for (let i = 0; i <= unique.length - 4; i++) {
            if (unique[i]+1 === unique[i+1] &&
                unique[i]+2 === unique[i+2] &&
                unique[i]+3 === unique[i+3]) {
                score *= 2.5;
                break;
            }
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