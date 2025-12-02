export default class SplashScene extends Phaser.Scene {
    constructor() {
        super('SplashScene');
    }

    preload() {}

    create() {
        this.cameras.main.setBackgroundColor('#000000');

        this.add.text(400, 100, 'FIVES', {
            fontSize: '64px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(400, 300, 'Loading...', {
            fontSize: '32px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.time.delayedCall(5000, () => {
            this.scene.start('MenuScene');
        });
    }
}