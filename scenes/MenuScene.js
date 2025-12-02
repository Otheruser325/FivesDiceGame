import { GlobalAudio } from '../main.js';

export default class MenuScene extends Phaser.Scene {
    constructor() {
        super('MenuScene');
    }

    create() {
        this.add.text(400, 80, 'FIVES', { fontSize: 48 }).setOrigin(0.5);

        const playBtn = this.add.text(400, 200, 'Play', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const settingsBtn = this.add.text(400, 280, 'Settings', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const helpBtn = this.add.text(400, 360, 'Help', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();
			
		playBtn.on('pointerdown', () => {
            if (GlobalAudio && GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }
            this.scene.start('PlayModeScene');
        });
        
		settingsBtn.on('pointerdown', () => {
            if (GlobalAudio && GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }
            this.scene.start('SettingsScene');
        });
		
		helpBtn.on('pointerdown', () => {
            if (GlobalAudio && GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }
            this.scene.start('HelpScene');
        });
    }
}