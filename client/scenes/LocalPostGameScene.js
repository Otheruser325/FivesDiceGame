import { GlobalAudio } from '../main.js';

export default class LocalPostGameScene extends Phaser.Scene {
    constructor() {
        super('LocalPostGameScene');
    }

    create() {
        const stats = this.registry.get("localPostGame");

        this.add.text(400, 50, "Local Game — Results", {
            fontSize: 40
        }).setOrigin(0.5);

        // -------- Determine Rankings --------
        const scoredPlayers = stats.scores
            .map((score, index) => ({
                index,
                score
            }))
            .sort((a, b) => b.score - a.score);

        const placements = new Array(stats.players);
        scoredPlayers.forEach((p, i) => placements[p.index] = i + 1);

        // Rank colors
        const rankColors = {
            1: "#FFD700", // Gold
            2: "#C0C0C0", // Silver
            3: "#CD7F32", // Bronze
        };

        // Positive buzzword per placement
        const buzzwords = {
            1: [
                "Winner winner!",
                "Dicetastic!",
                "Dice-tacular!"
            ],
            2: [
                "Excellent performance!",
                "In-deucible!",
                "Outstanding!"
            ],
            3: [
                "Good game!",
                "You did well!",
                "You show no mercy!"
            ],
            other: [
                "Better luck next time!",
                "Pray to RNGesus!",
                "You'll be later gifted..."
            ]
        };

        // -------- Display Stats --------
        const totalPlayers = stats.players;
        let startY = 140;
        let titleSize = 26;
        let statSize = 20;
        let buzzSize = 22;
        let colX = [];

        if (totalPlayers === 2) {
            titleSize *= 1.5;
            statSize *= 1.5;
            buzzSize *= 1.5;
            colX = [300, 700];
        }
		else if (totalPlayers === 4) {
            colX = [300, 700];
        }
        else {
            colX = [200, 500, 800];
        }

        for (let i = 0; i < stats.players; i++) {
            const c = stats.combos[i];
            const name = stats.names[i];
            const score = stats.scores[i];
            const placement = placements[i];

            let row, col, x, y;
			
			if (totalPlayers === 2) {
                row = 0;
                col = i;
                x = colX[col];
                y = startY;
            } else if (totalPlayers === 4) {
                row = Math.floor(i / 2);
                col = i % 2;
                x = colX[col];
                y = startY + row * 260;
            } else {
                row = Math.floor(i / 3);
                col = i % 3;
                x = colX[col];
                y = startY + row * 260;
            }

            const pool = buzzwords[placement] || buzzwords.other;
            const message = pool[Math.floor(Math.random() * pool.length)];

            const placeColor = rankColors[placement] || "#ffffff";

            const title = `${name} — #${placement}`;
            const combosText =
                `Score: ${score}

Pairs: ${c.pair}
Two Pairs: ${c.twoPair}
Triples: ${c.triple}
Full Houses: ${c.fullHouse}
Four-of-a-Kinds: ${c.fourKind}
Five-of-a-Kinds: ${c.fiveKind}
Straights: ${c.straight}`;

            const spacing = {
                titleToStats: statSize * 3.5,
                statsToBuzz: buzzSize * 4,
            };

            // Title (larger + coloured)
            this.add.text(x, y, title, {
                fontSize: titleSize,
                color: placeColor,
                align: "center"
            }).setOrigin(0.5);

            // Stats block
            this.add.text(x, y + spacing.titleToStats, combosText, {
                fontSize: statSize,
                color: "#ffffff",
                align: "center"
            }).setOrigin(0.5);

            // Buzzword (highlighted slightly bigger)
            this.add.text(x, y + spacing.titleToStats + spacing.statsToBuzz, `"${message}"`, {
                fontSize: buzzSize,
                color: placeColor,
                fontStyle: "italic",
                align: "center"
            }).setOrigin(0.5);
        }

        // -------- Back Button --------
        const back = this.add.text(500, 800, "Return to Menu", {
            fontSize: 26,
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}