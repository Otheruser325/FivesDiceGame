import { GlobalAudio } from '../main.js';

export default class LocalConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalConfigScene');

        this.selectedPlayers = 2;
        this.selectedRounds = 20;
        this.comboRules = false;
    }

    create() {
        this.add.text(400, 60, 'Game Configuration', {
            fontSize: 40
        }).setOrigin(0.5);

        // --------------------------------------
        // Players
        // --------------------------------------

        this.add.text(400, 120, 'How many players?', { fontSize: 28 }).setOrigin(0.5);

        const playerOptions = [2, 3, 4];
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

        // --------------------------------------
        // Rounds
        // --------------------------------------

        this.add.text(400, 300, 'How long will the game last?', {
            fontSize: 28
        }).setOrigin(0.5);

        const roundOptions = [10, 15, 20, 25, 30];

        roundOptions.forEach((r, i) => {
            const btn = this.add.text(400, 340 + i * 40, `${r} rounds`, {
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

        this.add.text(400, 540, 'Additional rules:', {
            fontSize: 26
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(400, 580,
            `More points for combos: ${this.comboRules ? "YES" : "NO"}`,
            { fontSize: 24 }
        ).setOrigin(0.5).setInteractive();

        this.comboBtn.on('pointerdown', () => {
            this.comboRules = !this.comboRules;
            this.refreshScene();
        });

        // --------------------------------------
        // Continue Button
        // --------------------------------------

        const startBtn = this.add.text(400, 640, 'Start Game', {
            fontSize: 32,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        startBtn.on('pointerdown', () => {
			playButtonSFX(this);
            this.scene.start('LocalGameScene', {
                players: this.selectedPlayers,
                rounds: this.selectedRounds,
                combos: this.comboRules
            });
        });
		
		// Back button
        const backBtn = this.add.text(50, 650, 'Back', { fontSize: 24 })
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
