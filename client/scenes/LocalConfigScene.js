import { GlobalAudio } from '../main.js';

export default class LocalConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalConfigScene');

        this.selectedPlayers = 2;
        this.selectedRounds = 20;
        this.comboRules = false;
		this.playerNames = ["You", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];
        this.isAI = [false, true, true, true, true, true];
    }

    create() {
        this.add.text(400, 60, 'Game Configuration', {
            fontSize: 40
        }).setOrigin(0.5);

        // --------------------------------------
        // Players
        // --------------------------------------

        this.add.text(400, 120, 'How many players?', { fontSize: 28 }).setOrigin(0.5);

        const playerOptions = [2, 3, 4, 5, 6];
        playerOptions.forEach((num, i) => {
            const btn = this.add.text(400, 160 + i * 40, `${num}`, {
                fontSize: 26,
                color: num === this.selectedPlayers ? '#ffff66' : '#ffffff'
            }).setOrigin(0.5).setInteractive();

            btn.on('pointerdown', () => {
                this.selectedPlayers = num;
                this.refreshScene();
            });
        });
		
		this.add.text(900, 170, "Players:", { fontSize: 28 }).setOrigin(0.5);

for (let i = 0; i < this.selectedPlayers; i++) {

    const y = 200 + i * 60;

    // Player label
    this.add.text(720, y, `Player ${i + 1}`, { fontSize: 24 }).setOrigin(0.5);

    // Name box
    const nameText = this.add.text(750, y, this.playerNames[i], {
        fontSize: 24,
        backgroundColor: "#222222",
        padding: { x: 10, y: 4 }
    })
        .setOrigin(0.5)
        .setInteractive();

    nameText.on("pointerdown", () => {
        const newName = prompt(`Enter name for Player ${i + 1}:`, this.playerNames[i]);
        if (newName) {
            this.playerNames[i] = newName.substring(0, 12);
            this.refreshScene();
        }
    });

    // AI toggle (disabled for Player 1)
    if (i > 0) {
        const toggle = this.add.text(950, y,
            this.isAI[i] ? "Computer" : "Human",
            {
                fontSize: 24,
                color: this.isAI[i] ? "#66ff66" : "#ffffff"
            }
        )
            .setOrigin(0.5)
            .setInteractive();

        toggle.on("pointerdown", () => {
            this.isAI[i] = !this.isAI[i];
            this.refreshScene();
        });
    } else {
        this.add.text(950, y, "Human", { fontSize: 24, color: "#999999" }).setOrigin(0.5);
    }
}

        // --------------------------------------
        // Rounds
        // --------------------------------------

        this.add.text(400, 360, 'How long will the game last?', {
            fontSize: 28
        }).setOrigin(0.5);

        const roundOptions = [10, 15, 20, 25, 30];

        roundOptions.forEach((r, i) => {
            const btn = this.add.text(400, 400 + i * 40, `${r} rounds`, {
                fontSize: 24,
                color: r === this.selectedRounds ? '#ffff66' : '#ffffff'
            }).setOrigin(0.5).setInteractive();

            btn.on('pointerdown', () => {
                this.selectedRounds = r;
                this.refreshScene();
            });
        });

        // --------------------------------------
        // Additional Rules
        // --------------------------------------

        this.add.text(400, 580, 'Additional rules:', {
            fontSize: 26
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(400, 620,
            `More points for combos: ${this.comboRules ? "YES" : "NO"}`,
            { fontSize: 24 }
        ).setOrigin(0.5).setInteractive();

        this.comboBtn.on('pointerdown', () => {
            this.comboRules = !this.comboRules;
			const settings = this.registry.get('settings');
            settings.comboRules = this.comboRules;
            this.registry.set('settings', settings);
            this.refreshScene();
        });

        // --------------------------------------
        // Continue Button
        // --------------------------------------

        const startBtn = this.add.text(400, 700, 'Start Game', {
            fontSize: 32,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        startBtn.on('pointerdown', () => {
			GlobalAudio.playButton(this);
            this.scene.start('LocalGameScene', {
                players: this.selectedPlayers,
                rounds: this.selectedRounds,
                combos: this.comboRules,
				names: this.playerNames.slice(0, this.selectedPlayers),
                ai: this.isAI.slice(0, this.selectedPlayers)
            });
        });
		
		// Back button
        const backBtn = this.add.text(50, 750, 'Back', { fontSize: 24 })
            .setOrigin(0.5)
            .setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });
    }

    refreshScene() {
        this.scene.restart({
            players: this.selectedPlayers,
            rounds: this.selectedRounds,
            combos: this.comboRules
        });
    }
}
