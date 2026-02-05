import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import { formatCompact } from '../utils/FormatManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class LocalChallengeConfigScene extends Phaser.Scene {
    constructor() {
        super('LocalChallengeConfigScene');
        this.PIXEL_FONT = '"Press Start 2P", cursive';
    }

    create() {
        try {
            GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
        const config = this.registry.get("challengeConfig") || {};
        const cx = this.cameras.main.centerX;

        this.add.text(cx, 50, `${config.title || t('CHALLENGE_GENERIC', 'CHALLENGE')}`, {
            fontSize: 32,
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5);

        this.add.text(cx, 100, config.desc || t('CHALLENGE_DESC_FALLBACK', 'Challenge description'), {
            fontSize: 16,
            fontFamily: this.PIXEL_FONT,
            color: '#cccccc',
            align: 'center',
            wordWrap: { width: 600 }
        }).setOrigin(0.5);

        // Display config
        let y = 150;
        const reward = Number(config.challengeReward || 0);
        if (reward > 0) {
            this.add.text(cx, y, fmt('CHALLENGE_REWARD_LINE', 'Reward: +{0} Tokens', formatCompact(reward)), {
                fontSize: 16,
                fontFamily: this.PIXEL_FONT,
                color: '#ffd966'
            }).setOrigin(0.5);
            y += 26;
        }

        if (typeof config.switchSides === 'boolean') {
            const playerSide = config.switchSides ? t('SIDE_MONSTERS', 'Monsters') : t('SIDE_DEFENCES', 'Defences');
            const opponentSide = config.switchSides ? t('SIDE_DEFENCES', 'Defences') : t('SIDE_MONSTERS', 'Monsters');
            const opponentName = config.names?.[1] || t('OPP_DEFAULT', 'Opponent');
            this.add.text(cx, y, fmt('CHALLENGE_SIDES_LINE', 'You: {0} | Opponent: {1} ({2})', playerSide, opponentName, opponentSide), {
                fontSize: 14,
                fontFamily: this.PIXEL_FONT,
                color: '#cccccc'
            }).setOrigin(0.5);
            y += 26;
        }

        if (Number.isFinite(config.diceCount)) {
            this.add.text(cx, y, fmt('CHALLENGE_DICE', 'Dice: {0}', config.diceCount), {
                fontSize: 14,
                fontFamily: this.PIXEL_FONT
            }).setOrigin(0.5);
            y += 24;
        }

        if (Number.isFinite(config.boardRows) && Number.isFinite(config.boardCols)) {
            this.add.text(cx, y, fmt('CHALLENGE_BOARD', 'Board: {0} x {1}', config.boardRows, config.boardCols), {
                fontSize: 14,
                fontFamily: this.PIXEL_FONT
            }).setOrigin(0.5);
            y += 24;
        }

        this.add.text(cx, y, fmt('CHALLENGE_PLAYERS', 'Players: {0}', config.players || 2), {
            fontSize: 16,
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5);
        y += 26;

        this.add.text(cx, y, fmt('CHALLENGE_WAVES', 'Waves: {0}', config.waves || 30), {
            fontSize: 16,
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5);
        y += 26;

        if (config.teamsEnabled) {
            this.add.text(cx, y, t('CHALLENGE_TEAMS_ENABLED', 'Teams: Enabled'), {
                fontSize: 16,
                fontFamily: this.PIXEL_FONT
            }).setOrigin(0.5);
            y += 26;
        }

        // Players
        y += 16;
        this.add.text(cx, y, t('CHALLENGE_PLAYERS_LABEL', 'Players:'), {
            fontSize: 18,
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5);
        y += 32;

        for (let i = 0; i < (config.players || 2); i++) {
            const name = config.names?.[i] || `P${i + 1}`;
            const isAI = config.ai?.[i] || false;
            const diff = config.difficulty?.[i] || 'Medium';
            const team = config.teams?.[i] || 'blue';

            const diffLabel = t(`DIFFICULTY_${String(diff).toUpperCase()}`, diff);
            const aiLabel = isAI ? fmt('CHALLENGE_AI_LABEL', 'AI {0}', diffLabel) : t('CHALLENGE_HUMAN_LABEL', 'Human');
            const teamLabel = config.teamsEnabled ? ` - ${t(`TEAM_${String(team).toUpperCase()}`, String(team).toUpperCase())}` : '';
            const line = `${name} (${aiLabel})${teamLabel}`;
            this.add.text(cx, y, line, {
                fontSize: 14,
                fontFamily: this.PIXEL_FONT,
                color: isAI ? '#ff6666' : '#66ff66'
            }).setOrigin(0.5);
            y += 22;
        }

        // Start Game
        this.add.text(cx, 500, t('CHALLENGE_START', 'START CHALLENGE'), {
            fontSize: 22,
            fontFamily: this.PIXEL_FONT,
            color: '#66ff66'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalGameScene', config);
        });

        // Back
        this.add.text(cx, 550, t('UI_BACK', '<- BACK'), {
            fontSize: 18,
            fontFamily: this.PIXEL_FONT,
            color: '#ff6666'
        }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalChallengesScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalChallengesScene');
        });
    }
}
