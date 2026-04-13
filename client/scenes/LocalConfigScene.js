import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import { GAME_MODES, normalizeGameMode, getRuleFlags, normalizeTeams } from '../utils/GameModeManager.js';

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
        this.gameMode = GAME_MODES.CLASSIC;
        this.comboRules = false;
        this.multiplexRules = false;
        this.teamsEnabled = false;
        this.playerNames = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"];
        this.isAI = [false, true, true, true, true, true];
        this.aiDifficulty = ["medium", "medium", "medium", "medium", "medium", "medium"];
        this.playerTeams = ['blue', 'red', 'blue', 'red', 'blue', 'red'];
        this.modePopup = null;
        this.modePopupOpen = false;
        this._escHandler = null;
        this._autoModePromptShown = false;
        this.aiDifficultyLevels = [
            { key: "baby", value: 0.5 },
            { key: "easy", value: 0.75 },
            { key: "medium", value: 1 },
            { key: "hard", value: 1.5 },
            { key: "nightmare", value: 2 }
        ];
    }

    init(data = {}) {
        if (data.players) this.selectedPlayers = data.players;
        if (data.rounds) this.selectedRounds = data.rounds;
        if (typeof data.multiplex === 'boolean') this.multiplexRules = data.multiplex;
        if (typeof data.teamsEnabled === 'boolean') this.teamsEnabled = data.teamsEnabled;
        if (Array.isArray(data.teams)) this.playerTeams = data.teams.slice();
        if (Array.isArray(data.names)) this.playerNames = data.names.slice();
        if (Array.isArray(data.ai)) this.isAI = data.ai.slice();
        if (Array.isArray(data.difficulty)) this.aiDifficulty = data.difficulty.slice();

        this.gameMode = normalizeGameMode(
            data.gameMode ?? data.gamemode,
            data.combos ?? this.comboRules,
            data.multiplex ?? this.multiplexRules
        );
        this.syncRuleState();
    }

    syncRuleState() {
        const rules = getRuleFlags(this.gameMode, {
            combos: this.comboRules,
            multiplex: this.multiplexRules
        });
        this.gameMode = rules.gameMode;
        this.comboRules = rules.combos;
        this.multiplexRules = rules.multiplex;
        this.playerTeams = normalizeTeams(this.playerTeams, this.selectedPlayers);
    }

    getGameModeLabel(mode = this.gameMode) {
        switch (normalizeGameMode(mode)) {
            case GAME_MODES.COMBANITY:
                return t('CONFIG_MODE_COMBANITY', 'Combanity');
            case GAME_MODES.MULTIPLEX:
                return t('CONFIG_MODE_MULTIPLEX', 'Multiplex');
            case GAME_MODES.CLASSIC:
            default:
                return t('CONFIG_MODE_CLASSIC', 'Classic');
        }
    }

    getGameModeSummary(mode = this.gameMode) {
        switch (normalizeGameMode(mode)) {
            case GAME_MODES.COMBANITY:
                return t('CONFIG_MODE_COMBANITY_DESC', 'Combo hits pay out and every round feels a little more dramatic.');
            case GAME_MODES.MULTIPLEX:
                return t('CONFIG_MODE_MULTIPLEX_DESC', 'Dice multiply instead of add, so every roll can spike hard.');
            case GAME_MODES.CLASSIC:
            default:
                return t('CONFIG_MODE_CLASSIC_DESC', 'Straight Fives totals for the cleanest read on every turn.');
        }
    }

    getGameModePopupCopy(mode = this.gameMode) {
        switch (normalizeGameMode(mode)) {
            case GAME_MODES.COMBANITY:
                return t('CONFIG_MODE_COMBANITY_POPUP_SHORT', 'Special patterns pay out big and keep each roll spicy.');
            case GAME_MODES.MULTIPLEX:
                return t('CONFIG_MODE_MULTIPLEX_POPUP_SHORT', 'Scores are multiplied instead of added for wild swings.');
            case GAME_MODES.CLASSIC:
            default:
                return t('CONFIG_MODE_CLASSIC_POPUP_SHORT', 'Clean Fives scoring with the most readable pace.');
        }
    }

    getModeCardStyles(mode = this.gameMode) {
        switch (normalizeGameMode(mode)) {
            case GAME_MODES.COMBANITY:
                return {
                    accent: 0xd23434,
                    glint: 0xf04b4b,
                    fill: 0x180707,
                    selectedStroke: 0xff6464,
                    badgeKey: 'CONFIG_MODE_COMBANITY_BADGE',
                    badgeFallback: 'ALL-IN',
                    badgeColor: '#ffb0b0'
                };
            case GAME_MODES.MULTIPLEX:
                return {
                    accent: 0xf0c15f,
                    glint: 0xffd77a,
                    fill: 0x171109,
                    selectedStroke: 0xffde7e,
                    badgeKey: 'CONFIG_MODE_MULTIPLEX_BADGE',
                    badgeFallback: 'JACKPOT',
                    badgeColor: '#ffe0a3'
                };
            case GAME_MODES.CLASSIC:
            default:
                return {
                    accent: 0x9b2020,
                    glint: 0xc62828,
                    fill: 0x120d0d,
                    selectedStroke: 0xf0c15f,
                    badgeKey: 'CONFIG_MODE_CLASSIC_BADGE',
                    badgeFallback: 'HOUSE TABLE',
                    badgeColor: '#f6d38a'
                };
        }
    }

    buildSceneState() {
        this.syncRuleState();
        return {
            players: this.selectedPlayers,
            rounds: this.selectedRounds,
            gameMode: this.gameMode,
            combos: this.comboRules,
            multiplex: this.multiplexRules,
            teamsEnabled: this.teamsEnabled,
            teams: normalizeTeams(this.playerTeams, this.selectedPlayers),
            names: this.playerNames.slice(),
            ai: this.isAI.slice(),
            difficulty: this.aiDifficulty.slice()
        };
    }

    create() {
        ErrorHandler.setScene(this);
        this.syncRuleState();

        for (let i = 0; i < this.selectedPlayers; i++) {
            const current = this.playerNames[i];
            if (!current || /^Player\s+\d+$/i.test(String(current))) {
                this.playerNames[i] = tf('CONFIG_PLAYER_NAME_DEFAULT', 'Player {0}', i + 1);
            }
        }

        this.add.text(600, 60, t('LOCAL_CONFIG_TITLE', 'Game Configuration'), {
            fontSize: 40
        }).setOrigin(0.5);

        this.add.text(600, 120, t('CONFIG_PLAYERS_PROMPT', 'How many players?'), { fontSize: 28 }).setOrigin(0.5);

        [2, 3, 4, 5, 6].forEach((num, i) => {
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

            this.add.text(70, y, tf('CONFIG_PLAYER_SHORT', 'P{0}', i + 1), { fontSize: 24 }).setOrigin(0.5);

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

            if (i > 0) {
                const toggle = this.add.text(320, y,
                    this.isAI[i] ? t('CONFIG_COMPUTER', 'Computer') : t('CONFIG_HUMAN', 'Human'),
                    {
                        fontSize: 24,
                        color: this.isAI[i] ? "#e62121" : "#ffffff"
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

            if (this.teamsEnabled) {
                const team = this.playerTeams[i];
                const teamBtnX = this.isAI[i] ? 560 : 460;
                const teamBtn = this.add.text(teamBtnX, y,
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

        this.add.text(600, 360, t('CONFIG_ROUNDS_PROMPT', 'How many rounds?'), {
            fontSize: 28
        }).setOrigin(0.5);

        [5, 10, 15, 20, 25, 30].forEach((rounds, i) => {
            const btn = this.add.text(600, 400 + i * 40, tf('CONFIG_ROUNDS_LABEL', '{0} rounds', rounds), {
                fontSize: 24,
                color: rounds === this.selectedRounds ? '#ffff66' : '#ffffff'
            }).setOrigin(0.5).setInteractive();

            btn.on('pointerdown', () => {
                this.selectedRounds = rounds;
                this.refreshScene();
            });
        });

        this.add.text(600, 646, t('CONFIG_GAMEPLAY_TABLE', 'Gameplay table:'), {
            fontSize: 24,
            color: '#f3d6d6'
        }).setOrigin(0.5);

        this.createGameModeSelector(704);

        this.teamsBtn = this.add.text(600, 772,
            tf('CONFIG_TEAMS', 'Teams: {0}', onOff(this.teamsEnabled)),
            { fontSize: 24, color: this.teamsEnabled ? '#66aaff' : '#d55b5b' }
        ).setOrigin(0.5).setInteractive();

        this.teamsBtn.on('pointerdown', () => {
            this.teamsEnabled = !this.teamsEnabled;
            this.refreshScene();
        });

        const startBtn = this.add.text(600, 820, t('CONFIG_START_GAME', 'Start Game'), {
            fontSize: 32,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        startBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalGameScene', this.buildSceneState());
        });

        const backBtn = this.add.text(80, 840, t('UI_BACK', '<- Back'), { fontSize: 24, color: '#66aaff' })
            .setOrigin(0.5)
            .setInteractive();

        backBtn.on('pointerdown', () => {
            if (this.modePopupOpen) {
                this.closeGameModePopup();
                return;
            }
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });

        if (this.input && this.input.keyboard) {
            this._escHandler = () => {
                GlobalAudio.playButton(this);
                if (this.modePopupOpen) {
                    this.closeGameModePopup();
                    return;
                }
                this.scene.start('PlayModeScene');
            };
            this.input.keyboard.on('keydown-ESC', this._escHandler);
            this.events.once('shutdown', () => {
                if (this.input && this.input.keyboard && this._escHandler) {
                    this.input.keyboard.off('keydown-ESC', this._escHandler);
                }
                this._escHandler = null;
            });
        }

        if (!this._autoModePromptShown) {
            this._autoModePromptShown = true;
            this.time.delayedCall(80, () => {
                if (this.scene.isActive()) {
                    this.showGameModePopup();
                }
            });
        }
    }

    createGameModeSelector(y) {
        const styles = this.getModeCardStyles(this.gameMode);
        const button = this.add.container(600, y);

        const shell = this.add.rectangle(0, 0, 520, 92, 0x0a0606, 0.98)
            .setStrokeStyle(2, styles.accent, 0.95);
        const strip = this.add.rectangle(0, -35, 520, 10, 0x2f0d0d, 1);
        const glint = this.add.rectangle(-26, -35, 180, 10, styles.glint, 0.95);
        const eyebrow = this.add.text(-236, -14, t('CONFIG_GAMEMODE', 'Gamemode'), {
            fontSize: 17,
            color: '#f4b2b2',
            fontStyle: 'bold'
        }).setOrigin(0, 0.5);
        const modeText = this.add.text(-236, 18, this.getGameModeLabel(), {
            fontSize: 26,
            color: '#fff0f0',
            fontStyle: 'bold'
        }).setOrigin(0, 0.5);
        const summary = this.add.text(238, 16, this.getGameModeSummary(), {
            fontSize: 13,
            color: '#d4b6b6',
            align: 'right',
            lineSpacing: 4,
            wordWrap: { width: 210 }
        }).setOrigin(1, 0.5);
        const hint = this.add.text(238, -14, t('CONFIG_GAMEMODE_TAP', 'Tap to choose'), {
            fontSize: 14,
            color: '#f7c75f'
        }).setOrigin(1, 0.5);
        const hit = this.add.rectangle(0, 0, 520, 92, 0xffffff, 0.001)
            .setInteractive({ useHandCursor: true });

        hit.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.showGameModePopup();
        });

        hit.on('pointerover', () => {
            shell.setStrokeStyle(3, 0xf04b4b, 1);
        });

        hit.on('pointerout', () => {
            shell.setStrokeStyle(2, styles.accent, 0.95);
        });

        button.add([shell, strip, glint, eyebrow, modeText, summary, hint, hit]);
        button.setDepth(30);
    }

    createModeOption(container, x, y, mode, title, subtitle) {
        const selected = this.gameMode === mode;
        const styles = this.getModeCardStyles(mode);
        const card = this.add.container(x, y);
        const stroke = selected ? styles.selectedStroke : 0x5e1c1c;
        const glow = this.add.rectangle(0, 0, 248, 236, selected ? 0x4a1111 : 0x120909, selected ? 0.28 : 0.12);
        const bg = this.add.rectangle(0, 0, 240, 228, styles.fill, 0.995).setStrokeStyle(selected ? 3 : 2, stroke, 1);
        const topLine = this.add.rectangle(0, -106, 240, 8, styles.accent, selected ? 1 : 0.78);
        const badge = this.add.text(0, -66,
            t(styles.badgeKey, styles.badgeFallback),
            {
                fontSize: 12,
                color: styles.badgeColor,
                fontStyle: 'bold'
            }
        ).setOrigin(0.5);
        const titleText = this.add.text(0, -30, title, {
            fontSize: 24,
            color: '#fff4f4',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        const subText = this.add.text(0, 36, subtitle, {
            fontSize: 12,
            color: '#d5bcbc',
            align: 'center',
            lineSpacing: 5,
            wordWrap: { width: 172 }
        }).setOrigin(0.5);
        const footer = this.add.text(0, 92,
            selected
                ? t('CONFIG_MODE_SELECTED', 'Selected')
                : t('CONFIG_MODE_PICK', 'Pick this table'),
            {
                fontSize: 14,
                color: selected ? '#f7c75f' : '#f09d9d'
            }
        ).setOrigin(0.5);
        const hit = this.add.rectangle(0, 0, 240, 228, 0xffffff, 0.001)
            .setInteractive({ useHandCursor: true });

        hit.on('pointerdown', () => {
            this.gameMode = mode;
            this.comboRules = mode === GAME_MODES.COMBANITY;
            this.multiplexRules = mode === GAME_MODES.MULTIPLEX;
            this.syncRuleState();
            GlobalAudio.playButton(this);
            this.closeGameModePopup();
            this.refreshScene();
        });

        hit.on('pointerover', () => {
            bg.setStrokeStyle(selected ? 4 : 3, styles.selectedStroke, 1);
        });

        hit.on('pointerout', () => {
            bg.setStrokeStyle(selected ? 4 : 2, stroke, 1);
        });

        card.add([glow, bg, topLine, badge, titleText, subText, footer, hit]);
        container.add(card);
    }

    showGameModePopup() {
        if (this.modePopupOpen) return;
        this.modePopupOpen = true;

        const overlay = this.add.container(0, 0);
        const veil = this.add.rectangle(600, 450, 1280, 960, 0x010101, 0.92)
            .setInteractive();
        const redGlowTop = this.add.ellipse(340, 140, 340, 180, 0x8b1010, 0.24);
        const redGlowBottom = this.add.ellipse(920, 760, 420, 220, 0x5e0a0a, 0.22);
        const panelShadow = this.add.rectangle(600, 448, 940, 472, 0x000000, 0.6)
            .setInteractive();
        const panel = this.add.rectangle(600, 434, 912, 440, 0x080505, 0.985)
            .setStrokeStyle(2, 0xbb1f1f, 1);
        panel.setInteractive();
        const crown = this.add.rectangle(600, 224, 912, 10, 0x2a0909, 1);
        const crownLight = this.add.rectangle(600, 224, 188, 10, 0xe53935, 1);
        const title = this.add.text(600, 286, t('CONFIG_MODE_POPUP_TITLE', 'Choose Your Table'), {
            fontSize: 36,
            color: '#fff2f2',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        const subtitle = this.add.text(600, 330, t('CONFIG_MODE_POPUP_SUBTITLE', 'Pick a table style for this match. Teams can be added on top of any of them.'), {
            fontSize: 16,
            color: '#d8bebe',
            align: 'center',
            lineSpacing: 3,
            wordWrap: { width: 620 }
        }).setOrigin(0.5);
        const cancel = this.add.text(600, 628, t('UI_CLOSE', 'Close'), {
            fontSize: 22,
            color: '#8fc1ff'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        cancel.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.closeGameModePopup();
        });

        overlay.add([veil, redGlowTop, redGlowBottom, panelShadow, panel, crown, crownLight, title, subtitle, cancel]);
        this.createModeOption(
            overlay,
            290,
            462,
            GAME_MODES.CLASSIC,
            t('CONFIG_MODE_CLASSIC', 'Classic'),
            this.getGameModePopupCopy(GAME_MODES.CLASSIC)
        );
        this.createModeOption(
            overlay,
            600,
            462,
            GAME_MODES.COMBANITY,
            t('CONFIG_MODE_COMBANITY', 'Combanity'),
            this.getGameModePopupCopy(GAME_MODES.COMBANITY)
        );
        this.createModeOption(
            overlay,
            910,
            462,
            GAME_MODES.MULTIPLEX,
            t('CONFIG_MODE_MULTIPLEX', 'Multiplex'),
            this.getGameModePopupCopy(GAME_MODES.MULTIPLEX)
        );

        overlay.setDepth(4000);
        overlay.setAlpha(0);
        this.tweens.add({
            targets: overlay,
            alpha: 1,
            duration: 180,
            ease: 'Cubic.easeOut'
        });

        this.modePopup = overlay;
    }

    closeGameModePopup() {
        if (!this.modePopupOpen) return;
        this.modePopupOpen = false;

        if (!this.modePopup) return;
        const popup = this.modePopup;
        this.modePopup = null;
        this.tweens.add({
            targets: popup,
            alpha: 0,
            duration: 140,
            ease: 'Cubic.easeIn',
            onComplete: () => popup.destroy(true)
        });
    }

    refreshScene() {
        this.scene.restart(this.buildSceneState());
    }
}
