import { playButtonSFX } from '../utils/AudioManager.js';

export default class OnlineGameScene extends Phaser.Scene {
    constructor() {
        super('OnlineGameScene');
    }

    create() {
        this.add.text(400, 80, 'Coming soon...', { fontSize: 48 }).setOrigin(0.5);

        const backBtn = this.add.text(400, 360, 'Back', { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive();
			
		backBtn.on('pointerdown', () => {
            playButtonSFX(this);
            this.scene.start('MenuScene');
        });
    }
}