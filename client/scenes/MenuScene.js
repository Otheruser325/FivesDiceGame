import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';

export default class MenuScene extends Phaser.Scene {
    constructor() {
        super('MenuScene');
    }

    create() {
        ErrorHandler.setScene(this);
        this.add.text(600, 80, 'FIVES', { fontSize: 48 }).setOrigin(0.5);

        const playBtn = this.add.text(600, 200, 'Play', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const settingsBtn = this.add.text(600, 280, 'Settings', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const helpBtn = this.add.text(600, 360, 'Help', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const changelogBtn = this.add.text(600, 440, 'Changelog', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();
			
		if (GlobalAudio && typeof GlobalAudio.playMusic === 'function') {
          GlobalAudio.playMusic(this);
        }
			
		playBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });
        
		settingsBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('SettingsScene');
        });
		
		helpBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('HelpScene');
        });

        changelogBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('ChangelogScene');
        });
    }
}