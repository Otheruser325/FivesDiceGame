import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import ChallengeManager from '../utils/ChallengeManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class LocalConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalConfigScene');

        this.selectedWaves = 20;
        this.switchSides = false;
        this.diceCount = 1;
        this.playerNames = ["Player 1", "Player 2"];
        this.isAI = [false, false];
        this.aiDifficulty = ["Medium", "Medium"];
        this.aiDifficultyLevels = [
          { name: "Baby", value: 0.5 },
          { name: "Easy", value: 0.75 },
          { name: "Medium", value: 1 },
          { name: "Hard", value: 1.5 },
          { name: "Nightmare", value: 2 }
        ];
        this.boardRows = 5;
        this.boardCols = 9;
        this.boardRowOptions = [5, 6, 7];
        this.boardColOptions = [7, 9, 11, 13, 15];
    }

    init(data) {
        if (!data) return;
        if (Number.isFinite(data.waves)) this.selectedWaves = data.waves;
        if (typeof data.switchSides === 'boolean') this.switchSides = data.switchSides;
        if (Number.isFinite(data.diceCount)) this.diceCount = data.diceCount;
        if (Number.isFinite(data.boardRows) && this.boardRowOptions.includes(data.boardRows)) {
            this.boardRows = data.boardRows;
        }
        if (Number.isFinite(data.boardCols) && this.boardColOptions.includes(data.boardCols)) {
            this.boardCols = data.boardCols;
        }
    }

    create() {
        try {
          ErrorHandler.setScene(this);
        } catch (e) {}
	      try {
          GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
        const diffLabel = (name) => t(`DIFFICULTY_${String(name).toUpperCase()}`, name);
        this.add.text(600, 60, t('CONFIG_TITLE', 'Game Configuration'), {
            fontSize: '32px', 
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);
        this._persistSettings();

        // --------------------------------------
        // Players
        // --------------------------------------

        this.add.text(200, 120, t('CONFIG_PLAYERS', 'Players:'), { fontSize: '24px', fontFamily: '"Press Start 2P", cursive' }).setOrigin(0.5);

        for (let i = 0; i < 2; i++) {

            const y = 160 + i * 60;

            // Player label
            this.add.text(70, y, fmt('CONFIG_PLAYER_SHORT', 'P{0}', i + 1), { fontSize: '24px', fontFamily: '"Press Start 2P", cursive' }).setOrigin(0.5);

            // Name box
            const nameText = this.add.text(170, y, this.playerNames[i], {
                fontSize: '24px',
                fontFamily: '"Press Start 2P", cursive',
                backgroundColor: "#222222",
                padding: { x: 10, y: 4 }
            })
                .setOrigin(0.5)
                .setInteractive();

            nameText.on("pointerdown", () => {
                const promptText = fmt('CONFIG_PROMPT_PLAYER_NAME', 'Enter name for Player {0}:', i + 1);
                const newName = prompt(promptText, this.playerNames[i]);
                if (newName) {
                    this.playerNames[i] = newName.substring(0, 12);
                    this.refreshScene();
                }
            });

            // AI toggle (disabled for Player 1)
            if (i > 0) {
                const toggle = this.add.text(320, y,
                    this.isAI[i] ? t('CONFIG_AI', 'Computer') : t('CONFIG_HUMAN', 'Human'),
                    {
                        fontSize: '16px', 
                        fontFamily: '"Press Start 2P", cursive',
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
                      diffLabel(this.aiDifficulty[i]),
                      { fontSize: '16px', fontFamily: '"Press Start 2P"', color: "#ffaa44" }
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
                this.add.text(320, y, t('CONFIG_HUMAN', 'Human'), { fontSize: '16px', fontFamily: '"Press Start 2P"', color: "#999999" }).setOrigin(0.5);
            }
        }

        // --------------------------------------
        // Waves
        // --------------------------------------

        this.add.text(600, 220, t('CONFIG_HOW_MANY_WAVES', 'How many waves?'), {
            fontSize: '24px', 
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        const waveOptions = [10, 15, 20, 25, 30, 35, 40, 45, 50];

        waveOptions.forEach((w, i) => {
            const btn = this.add.text(600, 260 + i * 40, fmt('CONFIG_WAVES_LABEL', '{0} waves', w), {
                fontSize: '24px',
                fontFamily: '"Press Start 2P"',
                color: w === this.selectedWaves ? '#ffff66' : '#ffffff'
            }).setOrigin(0.5).setInteractive();

            btn.on('pointerdown', () => {
                this.selectedWaves = w;
                this.refreshScene();
            });
        });

        // --------------------------------------
        // Additional Rules
        // --------------------------------------

        this.add.text(600, 620, t('CONFIG_ADDITIONAL_RULES', 'Additional rules:'), {
            fontSize: '24px', 
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        this.switchSidesBtn = this.add.text(600, 660,
            fmt('CONFIG_SWITCH_SIDES', 'Switch sides: {0}', this.switchSides ? t('SIDE_MONSTERS', 'Monsters') : t('SIDE_DEFENCES', 'Defences')),
            { fontSize: '24px', fontFamily: '"Press Start 2P"', color: this.switchSides ? '#ff6666' : '#66aaff' }
        ).setOrigin(0.5).setInteractive();

        this.switchSidesBtn.on('pointerdown', () => {
            this.switchSides = !this.switchSides;
            this.refreshScene();
        });

        // --------------------------------------
        // Dice Count
        // --------------------------------------

        this.add.text(240, 480, t('CONFIG_HOW_MANY_DICE', 'How many dice?'), {
            fontSize: '24px', 
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        this.diceCountBtn = this.add.text(240, 520,
            this.diceCount === 1 ? t('CONFIG_DICE_1', '1 Dice') : t('CONFIG_DICE_2', '2 Dice'),
            { fontSize: '24px', fontFamily: '"Press Start 2P"', color: this.diceCount === 2 ? '#ff6666' : '#66aaff' }
        ).setOrigin(0.5).setInteractive();

        this.diceCountBtn.on('pointerdown', () => {
            this.diceCount = this.diceCount === 1 ? 2 : 1;
            this.refreshScene();
        });

        // --------------------------------------
        // Board Size
        // --------------------------------------

        this.add.text(1000, 420, t('CONFIG_BOARD_SIZE', 'Board Size'), {
            fontSize: '18px',
            fontFamily: '"Press Start 2P", cursive'
        }).setOrigin(0.5);

        const boardLabelStyle = { fontSize: '18px', fontFamily: '"Press Start 2P"', color: '#66aaff' };

        this.boardRowsBtn = this.add.text(1000, 460, fmt('CONFIG_ROWS', 'Rows: {0}', this.boardRows), boardLabelStyle)
            .setOrigin(0.5)
            .setInteractive();

        this.boardRowsBtn.on('pointerdown', () => {
            const idx = this.boardRowOptions.indexOf(this.boardRows);
            const next = (idx + 1) % this.boardRowOptions.length;
            this.boardRows = this.boardRowOptions[next];
            this.refreshScene();
        });

        this.boardColsBtn = this.add.text(1000, 500, fmt('CONFIG_COLS', 'Cols: {0}', this.boardCols), boardLabelStyle)
            .setOrigin(0.5)
            .setInteractive();

        this.boardColsBtn.on('pointerdown', () => {
            const idx = this.boardColOptions.indexOf(this.boardCols);
            const next = (idx + 1) % this.boardColOptions.length;
            this.boardCols = this.boardColOptions[next];
            this.refreshScene();
        });

        // --------------------------------------
        // Continue Button
        // --------------------------------------

        const startBtn = this.add.text(600, 750, t('CONFIG_START_GAME', 'Start Game'), {
            fontSize: '24px', 
            fontFamily: '"Press Start 2P", cursive',
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        startBtn.on('pointerdown', () => {
    GlobalAudio.playButton(this);
            this._persistSettings();
            this.scene.start('LocalGameScene', {
                waves: this.selectedWaves,
                switchSides: this.switchSides,
                diceCount: this.diceCount,
                names: this.playerNames,
                ai: this.isAI,
                difficulty: this.aiDifficulty,
                boardRows: this.boardRows,
                boardCols: this.boardCols
            });
        });
		
		// Back button
        const backBtn = this.add.text(80, 800, t('UI_BACK', '<- BACK'), { fontSize: '16px', fontFamily: '"Press Start 2P"', color: '#ff6666' })
            .setOrigin(0.5)
            .setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalMenuScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalMenuScene');
        });
    }

    refreshScene() {
        this._persistSettings();
        this.scene.restart({
            waves: this.selectedWaves,
            switchSides: this.switchSides,
            diceCount: this.diceCount,
            boardRows: this.boardRows,
            boardCols: this.boardCols
        });
    }

    _persistSettings() {
        ChallengeManager.storeConfigSnapshot({
            switchSides: this.switchSides,
            diceCount: this.diceCount,
            boardRows: this.boardRows,
            boardCols: this.boardCols
        });
    }
}
