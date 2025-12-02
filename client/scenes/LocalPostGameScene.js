export default class LocalPostGameScene extends Phaser.Scene {
    constructor() {
        super('LocalPostGameScene');
    }

    create() {
        const stats = this.registry.get("localPostGame");

        this.add.text(400, 60, "Local Game — Results", 
            { fontSize: 40 })
            .setOrigin(0.5);

        let y = 140;

        for (let i = 0; i < stats.players; i++) {
            const name = i === 0 ? "You" : `Bot ${i}`;
            const score = stats.scores[i];
            const c = stats.combos[i];

            const text = 
`${name}
Score: ${score}
Pairs: ${c.pair}
Triples: ${c.triple}
Full House: ${c.fullHouse}
Four-of-a-Kind: ${c.fourKind}
Five-of-a-Kind: ${c.fiveKind}
Straights: ${c.straight}
`;

            this.add.text(400, y, text, {
                fontSize: 22,
                align: "center"
            }).setOrigin(0.5);

            y += 180;
        }

        const back = this.add.text(400, 540, "Return to Menu", {
            fontSize: 28,
            color: "#ff6666"
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            this.scene.start('MenuScene');
        });
    }
}