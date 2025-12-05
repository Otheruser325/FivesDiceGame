export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        // Splash screen display
        this.cameras.main.setBackgroundColor('#000000');

        this.add.text(400, 100, 'FIVES', {
            fontSize: '64px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.loadingText = this.add.text(400, 300, 'Loading...', {
            fontSize: '32px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Add a progress bar
        let progressBarBg = this.add.rectangle(400, 350, 300, 30, 0x444444);
        let progressBarFill = this.add.rectangle(250, 350, 0, 30, 0xffffff).setOrigin(0, 0.5);

        this.load.on('progress', (value) => {
            progressBarFill.width = 300 * value;
        });

        // Load all assets
        this.load.audio('button', 'assets/audio/button.mp3');
        this.load.audio('dice', 'assets/audio/dice.mp3');
		this.load.audio('combo_pair', 'assets/audio/combo_pair.mp3');
        this.load.audio('combo_triple', 'assets/audio/combo_triple.mp3');
        this.load.audio('combo_fullHouse', 'assets/audio/combo_fullHouse.mp3');
        this.load.audio('combo_fourKind', 'assets/audio/combo_fourKind.mp3');
        this.load.audio('combo_fiveKind', 'assets/audio/combo_fiveKind.mp3');
		this.load.audio('combo_straight', 'assets/audio/combo_straight.mp3');
		this.load.audio('hero_time', 'assets/music/hero_time.mp3');
        this.load.audio('energy', 'assets/music/energy.mp3');
        this.load.audio('powerhouse', 'assets/music/powerhouse.mp3');
		
		this.load.image('dice1', 'assets/dice/dice-six-faces-one.png');
        this.load.image('dice2', 'assets/dice/dice-six-faces-two.png');
        this.load.image('dice3', 'assets/dice/dice-six-faces-three.png');
        this.load.image('dice4', 'assets/dice/dice-six-faces-four.png');
        this.load.image('dice5', 'assets/dice/dice-six-faces-five.png');
        this.load.image('dice6', 'assets/dice/dice-six-faces-six.png');
		
		this.load.image('playerIcon', 'assets/ui/player.png');
        this.load.image('botIcon', 'assets/ui/robot.png');
    }

    create() {
        const saved = JSON.parse(localStorage.getItem('fives_settings')) || {};

        const defaults = {
            audio: true,
            music: true,
            comboRules: false,
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