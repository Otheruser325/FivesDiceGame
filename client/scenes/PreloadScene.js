import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalFonts from '../utils/FontManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import GlobalSettings from '../utils/SettingsManager.js';

export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        // Splash screen display
        this.cameras.main.setBackgroundColor('#000000');

        this.titleText = this.add.text(600, 100, 'FIVES', {
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

        // Load all assets
        this.load.audio('button', 'assets/audio/button.mp3');
        this.load.audio('dice', 'assets/audio/dice.mp3');
		this.load.audio('combo_pair', 'assets/audio/combo_pair.mp3');
        this.load.audio('combo_triple', 'assets/audio/combo_triple.mp3');
        this.load.audio('combo_fullHouse', 'assets/audio/combo_fullHouse.mp3');
        this.load.audio('combo_fourOfAKind', 'assets/audio/combo_fourOfAKind.mp3');
        this.load.audio('combo_fiveOfAKind', 'assets/audio/combo_fiveOfAKind.mp3');
		this.load.audio('combo_straight', 'assets/audio/combo_straight.mp3');
		this.load.audio('hero_time', 'assets/music/hero_time.mp3');
        this.load.audio('energy', 'assets/music/energy.mp3');
        this.load.audio('powerhouse', 'assets/music/powerhouse.mp3');

        this.load.json('changelog', 'config/changelog.json');

        // Localization packs
        this.load.xml('loc:English', 'config/locs/English.xml');
        this.load.xml('loc:French', 'config/locs/French.xml');
        this.load.xml('loc:Spanish', 'config/locs/Spanish.xml');
        this.load.xml('loc:Italian', 'config/locs/Italian.xml');
        this.load.xml('loc:Portuguese', 'config/locs/Portuguese.xml');
        this.load.xml('loc:Welsh', 'config/locs/Welsh.xml');
		
		this.load.image('dice1', 'assets/dice/dice-six-faces-one.png');
        this.load.image('dice2', 'assets/dice/dice-six-faces-two.png');
        this.load.image('dice3', 'assets/dice/dice-six-faces-three.png');
        this.load.image('dice4', 'assets/dice/dice-six-faces-four.png');
        this.load.image('dice5', 'assets/dice/dice-six-faces-five.png');
        this.load.image('dice6', 'assets/dice/dice-six-faces-six.png');
		
		this.load.image('settingsIcon', 'assets/ui/settings.png');
        this.load.image('achievementIcon', 'assets/ui/achievement.png');
        this.load.image('helpIcon', 'assets/ui/help.png');
        this.load.image('changelogIcon', 'assets/ui/changelog.png');
        this.load.image('playerIcon', 'assets/ui/player.png');
        this.load.image('botIcon', 'assets/ui/robot.png');
    }

    create() {
        // Load settings into registry (includes defaults + saved settings)
        const settings = GlobalSettings.loadInto(this);

        // Initialize localization and apply saved language (if any)
        GlobalLocalization.init(this);
        const lang = settings?.language || 'English';
        GlobalLocalization.setLanguage(this, lang);

        if (this.titleText) {
            this.titleText.setText(GlobalLocalization.t('APP_TITLE', 'FIVES'));
        }
        if (this.loadingText) {
            this.loadingText.setText(GlobalLocalization.t('PRELOAD_LOADING', 'Loading...'));
        }

        this.time.delayedCall(5000, () => {
            this.scene.start('MenuScene');
        });
    }
}
