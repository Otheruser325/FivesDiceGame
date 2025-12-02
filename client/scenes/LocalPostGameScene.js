import { GlobalAudio } from '../main.js';

export default class LocalPostGameScene extends Phaser.Scene {
    constructor() {
        super('LocalPostGameScene');
    }

    create() {
        const stats = this.registry.get("localPostGame");

        this.add.text(400, 50, "Local Game — Results",
            { fontSize: 40 }).setOrigin(0.5);

        // -------- Determine Rankings --------
        const scoredPlayers = stats.scores
            .map((score, index) => ({ index, score }))
            .sort((a, b) => b.score - a.score);

        const placements = new Array(stats.players);
        scoredPlayers.forEach((p, i) => placements[p.index] = i + 1);

        // Rank colors
        const rankColors = {
            1: "#FFD700", // Gold
            2: "#C0C0C0", // Silver
            3: "#CD7F32", // Bronze
        };

        // Positive message per placement
        const messages = {
            1: "Winner winner!",
            2: "Excellent performance!",
            3: "Good game!",
            4: "You did well!",
            5: "Better luck next time!",
            default: "Dicetastic!"
        };

        // -------- Display Stats --------
        let y = 130;

        for (let i = 0; i < stats.players; i++) {
            const c = stats.combos[i];
            const name = i === 0 ? "You" : `Bot ${i}`;
            const score = stats.scores[i];
            const placement = placements[i];

            const placeColor = rankColors[placement] || "#ffffff";
            const placeText = `#${placement}`;

            const message =
                messages[placement] ||
                messages.default;

            const text =
`${name} — ${placeText}
Score: ${score}

Pairs: ${c.pair}
Triples: ${c.triple}
Full Houses: ${c.fullHouse}
Four-of-a-Kinds: ${c.fourKind}
Five-of-a-Kinds: ${c.fiveKind}
Straights: ${c.straight}

"${message}"`;

            this.add.text(400, y, text, {
                fontSize: 22,
                align: "center",
                color: placeColor
            }).setOrigin(0.5);

            y += 200;
        }

        // -------- Back Button --------
        const back = this.add.text(700, 560, "Return to Menu", {
            fontSize: 26,
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}