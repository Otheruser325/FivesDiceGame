import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class LocalMenuScene extends Phaser.Scene {
    constructor() {
        super('LocalMenuScene');
    }

    create() {
        try {
          ErrorHandler.setScene(this);
        } catch (e) {}
	      try {
          GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        this.add.text(600, 80, t('LOCAL_MENU_TITLE', 'Local Game Menu'), { fontSize: '52px', fontFamily: '"Press Start 2P", cursive' }).setOrigin(0.5);

        const loadoutBtn = this.add.text(600, 220, t('LOCAL_MENU_MY_LOADOUTS', 'My Loadouts'), { fontFamily: '"Press Start 2P", cursive', fontSize: '30px' })
            .setOrigin(0.5)
            .setInteractive();

        const localBtn = this.add.text(600, 310, t('LOCAL_MENU_CREATE_LOBBY', 'Create Local Lobby'), { fontFamily: '"Press Start 2P", cursive', fontSize: '30px' })
            .setOrigin(0.5)
            .setInteractive();

        const challengesBtn = this.add.text(600, 400, t('LOCAL_MENU_CHALLENGES', 'Challenges'), { fontFamily: '"Press Start 2P", cursive', fontSize: '30px' })
            .setOrigin(0.5)
            .setInteractive();

        const backBtn = this.add.text(600, 490, t('UI_BACK', '<- BACK'), { fontFamily: '"Press Start 2P", cursive', fontSize: '26px', color: '#ff6666' })
            .setOrigin(0.5)
            .setInteractive();

  loadoutBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalLoadoutScene');
        });

  localBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalConfigScene');
        });

  challengesBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalChallengesScene');
        });

  backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });

        this.input.keyboard.on('keydown-ESC', () => {
            GlobalAudio.playButton(this);
            this.scene.start('PlayModeScene');
        });
    }
}
