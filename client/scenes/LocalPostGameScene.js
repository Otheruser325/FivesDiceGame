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
        let startY = 140;
        const colX = [250, 550]; // Left + right columns
        const columnWidth = 300;

        for (let i = 0; i < stats.players; i++) {
            const c = stats.combos[i];
            const name = i === 0 ? "You" : `Bot ${i}`;
            const score = stats.scores[i];
            const placement = placements[i];

            // Determine X,Y positioning
            const row = Math.floor(i / 2);
            const col = i % 2;
            const x = stats.players > 1 ? colX[col] : 400;
            const y = startY + row * 220;

            // Select buzzword (random)
            const pool = buzzwords[placement] || buzzwords.other;
            const message = pool[Math.floor(Math.random() * pool.length)];

            // Placement colour
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

            // Title (larger + coloured)
            this.add.text(x, y, title, {
                fontSize: 26,
                color: placeColor,
                align: "center"
            }).setOrigin(0.5);

            // Stats block
            this.add.text(x, y + 110, combosText, {
                fontSize: 20,
                color: "#ffffff",
                align: "center"
            }).setOrigin(0.5);

            // Buzzword (highlighted slightly bigger)
            this.add.text(x, y + 220, `"${message}"`, {
                fontSize: 22,
                color: placeColor,
                fontStyle: "italic",
                align: "center"
            }).setOrigin(0.5);
        }

        // -------- Back Button --------
        const back = this.add.text(750, 600, "Return to Menu", {
            fontSize: 26,
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}