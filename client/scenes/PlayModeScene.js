import { GlobalAudio } from '../utils/AudioManager.js';

export default class PlayModeScene extends Phaser.Scene {
    constructor() {
        super('PlayModeScene');
    }

    create() {
        this.add.text(600, 80, 'Play', { fontSize: 48 }).setOrigin(0.5);

        const localBtn = this.add.text(600, 200, 'Local Play', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const onlineBtn = this.add.text(600, 260, 'Online Play', { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive();

        const backBtn = this.add.text(600, 360, 'Back', { fontSize: 28, color: '#66aaff' })
            .setOrigin(0.5)
            .setInteractive();
        
		localBtn.on('pointerdown', () => {
            if (GlobalAudio && GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }
            this.scene.start('LocalConfigScene');
        });
		
		onlineBtn.on('pointerdown', () => {
            if (GlobalAudio && GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }
            this.scene.start('OnlineMenuScene');
        });
		
		backBtn.on('pointerdown', () => {
            if (GlobalAudio && GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }
            this.scene.start('MenuScene');
        });
    }
}