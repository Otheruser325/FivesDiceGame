import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalFonts from '../utils/FontManager.js';
import ErrorHandler from '../utils/ErrorManager.js';

export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        // Splash screen display
        this.cameras.main.setBackgroundColor('#000000');

        this.add.text(600, 100, 'FIVES', {
            fontSize: '64px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.loadingText = this.add.text(600, 300, 'Loading...', {
            fontSize: '32px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Add a progress bar
        let progressBarBg = this.add.rectangle(600, 350, 300, 30, 0x444444);
        let progressBarFill = this.add.rectangle(450, 350, 0, 30, 0xffffff).setOrigin(0, 0.5);

        this.load.on('progress', (value) => {
            progressBarFill.width = 300 * value;
        });

        // Determine base path - always use /FivesDiceGame for consistency
        const basePath = '/FivesDiceGame';

        // Load all assets
        this.load.audio('button', basePath + '/assets/audio/button.mp3');
        this.load.audio('dice', basePath + '/assets/audio/dice.mp3');
		this.load.audio('combo_pair', basePath + '/assets/audio/combo_pair.mp3');
        this.load.audio('combo_triple', basePath + '/assets/audio/combo_triple.mp3');
        this.load.audio('combo_fullHouse', basePath + '/assets/audio/combo_fullHouse.mp3');
        this.load.audio('combo_fourOfAKind', basePath + '/assets/audio/combo_fourOfAKind.mp3');
        this.load.audio('combo_fiveOfAKind', basePath + '/assets/audio/combo_fiveOfAKind.mp3');
		this.load.audio('combo_straight', basePath + '/assets/audio/combo_straight.mp3');
		this.load.audio('hero_time', basePath + '/assets/music/hero_time.mp3');
        this.load.audio('energy', basePath + '/assets/music/energy.mp3');
        this.load.audio('powerhouse', basePath + '/assets/music/powerhouse.mp3');

        this.load.json('changelog', basePath + '/config/changelog.json');
		
		this.load.image('dice1', basePath + '/assets/dice/dice-six-faces-one.png');
        this.load.image('dice2', basePath + '/assets/dice/dice-six-faces-two.png');
        this.load.image('dice3', basePath + '/assets/dice/dice-six-faces-three.png');
        this.load.image('dice4', basePath + '/assets/dice/dice-six-faces-four.png');
        this.load.image('dice5', basePath + '/assets/dice/dice-six-faces-five.png');
        this.load.image('dice6', basePath + '/assets/dice/dice-six-faces-six.png');
		
		this.load.image('settingsIcon', basePath + '/assets/ui/settings.png');
        this.load.image('achievementIcon', basePath + '/assets/ui/achievement.png');
        this.load.image('helpIcon', basePath + '/assets/ui/help.png');
        this.load.image('changelogIcon', basePath + '/assets/ui/changelog.png');
        this.load.image('playerIcon', basePath + '/assets/ui/player.png');
        this.load.image('botIcon', basePath + '/assets/ui/robot.png');
    }

    create() {
        const saved = JSON.parse(localStorage.getItem('fives_settings')) || {};

        const defaults = {
            audio: true,
            music: true,
            visualEffects: true,
            shuffleTrack: false,
            trackIndex: 0
        };

        // Merge saved overrides
        const finalSettings = { ...defaults, ...saved };

        // Store in registry
        this.registry.set('settings', finalSettings);

        this.time.delayedCall(5000, () => {
            this.scene.start('MenuScene');
        });
    }
}