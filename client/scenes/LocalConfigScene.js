import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const onOff = (val) => t(val ? 'UI_ON' : 'UI_OFF', val ? 'ON' : 'OFF');
const teamLabel = (team) => (team === 'red' ? t('TEAM_RED', 'RED') : t('TEAM_BLUE', 'BLUE'));
const difficultyLabel = (key) => {
    switch (String(key || '').toLowerCase()) {
        case 'baby': return t('AI_DIFFICULTY_BABY', 'Baby');
        case 'easy': return t('AI_DIFFICULTY_EASY', 'Easy');
        case 'hard': return t('AI_DIFFICULTY_HARD', 'Hard');
        case 'nightmare': return t('AI_DIFFICULTY_NIGHTMARE', 'Nightmare');
        case 'medium':
        default: return t('AI_DIFFICULTY_MEDIUM', 'Medium');
    }
};

export default class LocalConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalConfigScene');

        this.selectedPlayers = 2;
        this.selectedRounds = 20;
        this.comboRules = false;
        this.multiplexRules = false;
        this.teamsEnabled = false;
		this.playerNames = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];
        this.isAI = [false, true, true, true, true, true];
        this.aiDifficulty = ["medium", "medium", "medium", "medium", "medium", "medium"];
        this.playerTeams = ['blue', 'red', 'blue', 'red', 'blue', 'red'];
        this.aiDifficultyLevels = [
          { key: "baby", value: 0.5 },
          { key: "easy", value: 0.75 },
          { key: "medium", value: 1 },
          { key: "hard", value: 1.5 },
          { key: "nightmare", value: 2 }
        ];
    }

    create() {
        ErrorHandler.setScene(this);

        // Ensure default player names use current localization
        for (let i = 0; i < this.selectedPlayers; i++) {
            const current = this.playerNames[i];
            if (!current || /^Player\s+\d+$/i.test(String(current))) {
                this.playerNames[i] = tf('CONFIG_PLAYER_NAME_DEFAULT', 'Player {0}', i + 1);
            }
        }
        this.add.text(600, 60, t('LOCAL_CONFIG_TITLE', 'Game Configuration'), {
            fontSize: 40
        }).setOrigin(0.5);

        // --------------------------------------
        // Players
        // --------------------------------------

        this.add.text(600, 120, t('CONFIG_PLAYERS_PROMPT', 'How many players?'), { fontSize: 28 }).setOrigin(0.5);

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
		
		this.add.text(200, 150, t('CONFIG_PLAYERS_LABEL', 'Players:'), { fontSize: 28 }).setOrigin(0.5);

for (let i = 0; i < this.selectedPlayers; i++) {

    const y = 200 + i * 60;

    // Player label
    this.add.text(70, y, tf('CONFIG_PLAYER_SHORT', 'P{0}', i + 1), { fontSize: 24 }).setOrigin(0.5);

    // Name box
    const nameText = this.add.text(170, y, this.playerNames[i], {
        fontSize: 24,
        backgroundColor: "#222222",
        padding: { x: 10, y: 4 }
    })
        .setOrigin(0.5)
        .setInteractive();

    nameText.on("pointerdown", () => {
        const newName = prompt(
            tf('CONFIG_NAME_PROMPT', 'Enter name for Player {0}:', i + 1),
            this.playerNames[i]
        );
        if (newName) {
            this.playerNames[i] = newName.substring(0, 12);
            this.refreshScene();
        }
    });

    // AI toggle (disabled for Player 1)
    if (i > 0) {
        const toggle = this.add.text(320, y,
            this.isAI[i] ? t('CONFIG_COMPUTER', 'Computer') : t('CONFIG_HUMAN', 'Human'),
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
              difficultyLabel(this.aiDifficulty[i]),
              { fontSize: 22, color: "#ffaa44" }
          )
          .setOrigin(0.5)
          .setInteractive();

          diffText.on("pointerdown", () => {
              const idx = this.aiDifficultyLevels.findIndex(
                  d => d.key === this.aiDifficulty[i]
              );
              const next = (idx + 1) % this.aiDifficultyLevels.length;
              this.aiDifficulty[i] = this.aiDifficultyLevels[next].key;
              this.refreshScene();
          });
      }
    } else {
        this.add.text(320, y, t('CONFIG_HUMAN', 'Human'), { fontSize: 24, color: "#999999" }).setOrigin(0.5);
    }

    // Team toggle (only if teams enabled)
    if (this.teamsEnabled) {
        const team = this.playerTeams[i];
        const teamBtn = this.add.text(560, y,
            teamLabel(team),
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

        this.add.text(600, 360, t('CONFIG_ROUNDS_PROMPT', 'How many rounds?'), {
            fontSize: 28
        }).setOrigin(0.5);

        const roundOptions = [5, 10, 15, 20, 25, 30];

        roundOptions.forEach((r, i) => {
            const btn = this.add.text(600, 400 + i * 40, tf('CONFIG_ROUNDS_LABEL', '{0} rounds', r), {
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

        this.add.text(600, 620, t('CONFIG_ADDITIONAL_RULES', 'Additional rules:'), {
            fontSize: 26
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(600, 660,
            tf('CONFIG_COMBO_RULES', 'More points for combos: {0}', onOff(this.comboRules)),
            { fontSize: 24, color: this.comboRules ? '#66aaff' : '#ff6666' }
        ).setOrigin(0.5).setInteractive();

        this.comboBtn.on('pointerdown', () => {
            this.comboRules = !this.comboRules;
            this.refreshScene();
        });

        this.multiplexBtn = this.add.text(600, 700,
            tf('CONFIG_MULTIPLEX_RULES', 'Multiplex scoring: {0}', onOff(this.multiplexRules)),
            { fontSize: 24, color: this.multiplexRules ? '#66aaff' : '#ff6666' }
        ).setOrigin(0.5).setInteractive();

        this.multiplexBtn.on('pointerdown', () => {
            this.multiplexRules = !this.multiplexRules;
            this.refreshScene();
        });

        this.teamsBtn = this.add.text(600, 740,
            tf('CONFIG_TEAMS', 'Teams: {0}', onOff(this.teamsEnabled)),
            { fontSize: 24, color: this.teamsEnabled ? '#66aaff' : '#ff6666' }
        ).setOrigin(0.5).setInteractive();

        this.teamsBtn.on('pointerdown', () => {
            this.teamsEnabled = !this.teamsEnabled;
            this.refreshScene();
        });
        // --------------------------------------
        // Continue Button
        // --------------------------------------

        const startBtn = this.add.text(600, 790, t('CONFIG_START_GAME', 'Start Game'), {
            fontSize: 32,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        startBtn.on('pointerdown', () => {
			GlobalAudio.playButton(this);
            this.scene.start('LocalGameScene', {
                players: this.selectedPlayers,
                rounds: this.selectedRounds,
                combos: this.comboRules,
                multiplex: this.multiplexRules,
                teamsEnabled: this.teamsEnabled,
                teams: this.playerTeams.slice(0, this.selectedPlayers),
				names: this.playerNames.slice(0, this.selectedPlayers),
                ai: this.isAI.slice(0, this.selectedPlayers),
                difficulty: this.aiDifficulty.slice(0, this.selectedPlayers)
            });
        });
		
		// Back button
        const backBtn = this.add.text(80, 800, t('UI_BACK', '<- Back'), { fontSize: 24, color: '#66aaff' })
            .setOrigin(0.5)
            .setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
          GlobalAudio.playButton(this);
          this.scene.start('PlayModeScene');
        });
    }

    refreshScene() {
        this.scene.restart({
            players: this.selectedPlayers,
            rounds: this.selectedRounds,
            combos: this.comboRules,
            multiplex: this.multiplexRules,
            teamsEnabled: this.teamsEnabled
        });
    }
}
