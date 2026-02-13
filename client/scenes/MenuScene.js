import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);

export default class MenuScene extends Phaser.Scene {
    constructor() {
        super('MenuScene');
    }

    create() {
        ErrorHandler.setScene(this);
        this.add.text(600, 80, t('APP_TITLE', 'FIVES'), { fontSize: 48 }).setOrigin(0.5);

        const playBtn = this.add.text(600, 200, t('MENU_PLAY', 'Play'), { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const settingsBtn = this.add.text(600, 280, t('MENU_SETTINGS', 'Settings'), { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const helpBtn = this.add.text(600, 360, t('MENU_HELP', 'Help'), { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const changelogBtn = this.add.text(600, 440, t('MENU_CHANGELOG', 'Changelog'), { fontSize: 32 })
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
