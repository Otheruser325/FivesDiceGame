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
		this.load.audio('hero_time', 'assets/music/hero_time.mp3');
        this.load.audio('energy', 'assets/music/energy.mp3');
        this.load.audio('powerhouse', 'assets/music/powerhouse.mp3');
    }

    create() {
        this.registry.set('settings', {
            audio: true,
            music: true
        });

        this.time.delayedCall(5000, () => {
            this.scene.start('MenuScene');
        });
    }
}