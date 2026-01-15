import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';

export default class LocalConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalConfigScene');

        this.selectedPlayers = 2;
        this.selectedRounds = 20;
        this.comboRules = false;
        this.teamsEnabled = false;
		this.playerNames = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];
        this.isAI = [false, true, true, true, true, true];
        this.aiDifficulty = ["Medium", "Medium", "Medium", "Medium", "Medium", "Medium"];
        this.playerTeams = ['blue', 'red', 'blue', 'red', 'blue', 'red'];
        this.aiDifficultyLevels = [
          { name: "Baby", value: 0.5 },
          { name: "Easy", value: 0.75 },
          { name: "Medium", value: 1 },
          { name: "Hard", value: 1.5 },
          { name: "Nightmare", value: 2 }
        ];
    }

    create() {
        ErrorHandler.setScene(this);
        this.add.text(600, 60, 'Game Configuration', {
            fontSize: 40
        }).setOrigin(0.5);

        // --------------------------------------
        // Players
        // --------------------------------------

        this.add.text(600, 120, 'How many players?', { fontSize: 28 }).setOrigin(0.5);

        const playerOptions = [2, 3, 4, 5, 6];
        playerOptions.forEach((num, i) => {
            const btn = this.add.text(600, 160 + i * 40, `${num}`, {
                fontSize: 26,
                color: num === this.selectedPlayers ? '#ffff66' : '#ffffff'
            }).setOrigin(0.5).setInteractive();

            btn.on('pointerdown', () => {
                this.selectedPlayers = num;
                this.refreshScene();
            });
        });
		
		this.add.text(200, 150, "Players:", { fontSize: 28 }).setOrigin(0.5);

for (let i = 0; i < this.selectedPlayers; i++) {

    const y = 200 + i * 60;

    // Player label
    this.add.text(70, y, `P${i + 1}`, { fontSize: 24 }).setOrigin(0.5);

    // Name box
    const nameText = this.add.text(170, y, this.playerNames[i], {
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
        const toggle = this.add.text(320, y,
            this.isAI[i] ? "Computer" : "Human",
            {
                fontSize: 24,
                color: this.isAI[i] ? "#e62121ff" : "#ffffff"
            }
        )
            .setOrigin(0.5)
            .setInteractive();

        toggle.on("pointerdown", () => {
            this.isAI[i] = !this.isAI[i];
            this.refreshScene();
        });

        if (this.isAI[i]) {
          const diffText = this.add.text(450, y,
              this.aiDifficulty[i],
              { fontSize: 22, color: "#ffaa44" }
          )
          .setOrigin(0.5)
          .setInteractive();

          diffText.on("pointerdown", () => {
              const idx = this.aiDifficultyLevels.findIndex(
                  d => d.name === this.aiDifficulty[i]
              );
              const next = (idx + 1) % this.aiDifficultyLevels.length;
              this.aiDifficulty[i] = this.aiDifficultyLevels[next].name;
              this.refreshScene();
          });
      }
    } else {
        this.add.text(320, y, "Human", { fontSize: 24, color: "#999999" }).setOrigin(0.5);
    }

    // Team toggle (only if teams enabled)
    if (this.teamsEnabled) {
        const team = this.playerTeams[i];
        const teamBtn = this.add.text(560, y,
            team.toUpperCase(),
            {
                fontSize: 24,
                color: team === 'blue' ? '#66aaff' : '#ff6666'
            }
        )
            .setOrigin(0.5)
            .setInteractive();

        teamBtn.on("pointerdown", () => {
            this.playerTeams[i] = team === 'blue' ? 'red' : 'blue';
            this.refreshScene();
        });
    }
}

        // --------------------------------------
        // Rounds
        // --------------------------------------

        this.add.text(600, 360, 'How many rounds?', {
            fontSize: 28
        }).setOrigin(0.5);

        const roundOptions = [1, 10, 15, 20, 25, 30];

        roundOptions.forEach((r, i) => {
            const btn = this.add.text(600, 400 + i * 40, `${r} rounds`, {
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

        this.add.text(600, 620, 'Additional rules:', {
            fontSize: 26
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(600, 660,
            `More points for combos: ${this.comboRules ? "YES" : "NO"}`,
            { fontSize: 24, color: this.comboRules ? '#66aaff' : '#ff6666' }
        ).setOrigin(0.5).setInteractive();

        this.comboBtn.on('pointerdown', () => {
            this.comboRules = !this.comboRules;
            this.refreshScene();
        });
        this.teamsBtn = this.add.text(600, 700,
            `Teams: ${this.teamsEnabled ? "ON" : "OFF"}`,
            { fontSize: 24, color: this.teamsEnabled ? '#66aaff' : '#ff6666' }
        ).setOrigin(0.5).setInteractive();

        this.teamsBtn.on('pointerdown', () => {
            this.teamsEnabled = !this.teamsEnabled;
            this.refreshScene();
        });
        // --------------------------------------
        // Continue Button
        // --------------------------------------

        const startBtn = this.add.text(600, 750, 'Start Game', {
            fontSize: 32,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        startBtn.on('pointerdown', () => {
			GlobalAudio.playButton(this);
            this.scene.start('LocalGameScene', {
                players: this.selectedPlayers,
                rounds: this.selectedRounds,
                combos: this.comboRules,
                teamsEnabled: this.teamsEnabled,
                teams: this.playerTeams.slice(0, this.selectedPlayers),
				names: this.playerNames.slice(0, this.selectedPlayers),
                ai: this.isAI.slice(0, this.selectedPlayers),
                difficulty: this.aiDifficulty.slice(0, this.selectedPlayers)
            });
        });
		
		// Back button
        const backBtn = this.add.text(80, 800, '← Back', { fontSize: 24, color: '#66aaff' })
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
