import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);

export default class PlayModeScene extends Phaser.Scene {
    constructor() {
        super('PlayModeScene');
    }

    create() {
        ErrorHandler.setScene(this);
        this.add.text(600, 80, t('PLAY_MODE_TITLE', 'Play'), { fontSize: 48 }).setOrigin(0.5);

        const localBtn = this.add.text(600, 200, t('PLAY_MODE_LOCAL', 'Local Play'), { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const onlineBtn = this.add.text(600, 260, t('PLAY_MODE_ONLINE', 'Online Play'), { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive();

        const backBtn = this.add.text(600, 360, t('UI_BACK', '<- Back'), { fontSize: 28, color: '#66aaff' })
            .setOrigin(0.5)
            .setInteractive();

        localBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalConfigScene');
        });

        onlineBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineMenuScene');
        });

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
          GlobalAudio.playButton(this);
          this.scene.start('MenuScene');
        });
    }
}
