import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class PlayModeScene extends Phaser.Scene {
    constructor() {
        super('PlayModeScene');
    }

    create() {
        try {
          ErrorHandler.setScene(this);
        } catch (e) {}
	    try {
          GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}
        const centerX = this.cameras.main.centerX;
        const centerY = 140;
        const uiButtonFont = 'game_over, "Press Start 2P", cursive';
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const uiFontTargets = [];
        const trackUiFont = (textObj) => {
          if (textObj && typeof textObj.setStyle === 'function') uiFontTargets.push(textObj);
        };

        this.add.text(centerX, 60, 'PROTODICE', {
          fontSize: 54,
          fontFamily: '"Press Start 2P", cursive',
        }).setOrigin(0.5);

        const iconSize = 128;
        const iconPadding = 14;
        const margin = 24;

        const topY = margin + iconSize / 2;
        const leftStartX = margin + iconSize / 2;
        const rightStartX = this.cameras.main.width - margin - iconSize / 2;

    const makeIcon = (x, y, key, label, targetScene) => {
      const img = this.add
        .image(x, y, key)
        .setDisplaySize(iconSize, iconSize)
        .setInteractive({ useHandCursor: true });

      const txt = this.add
        .text(x, y + iconSize / 2 + 8, label, {
          fontSize: 28,
          fontFamily: uiButtonFont,
          color: '#ffffff'
        })
        .setOrigin(0.5, 0);
      trackUiFont(txt);

      img.on('pointerover', () => img.setScale(1.06));
      img.on('pointerout', () => img.setScale(1.0));
      img.on('pointerdown', () => {
        GlobalAudio.playButton(this);
        if (targetScene) this.scene.start(targetScene);
      });

      return { img, txt };
    };

    makeIcon(leftStartX, topY, 'settingsIcon', t('UI_SETTINGS', 'SETTINGS'), 'SettingsScene');
    makeIcon(leftStartX + (iconSize + iconPadding), topY, 'achievementIcon', t('UI_ACHIEVEMENTS', 'ACHIEVEMENTS'), 'AchievementsScene');
    makeIcon(rightStartX - (iconSize + iconPadding), topY, 'helpIcon', t('UI_HELP', 'HELP'), 'HelpScene');
    makeIcon(rightStartX, topY, 'changelogIcon', t('UI_CHANGELOG', 'CHANGELOG'), 'ChangelogScene');

        this.add.text(600, 190, t('UI_HOW_WANT_PLAY', 'How do you want to play?'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '18px',
            color: '#ffffff'
        }).setOrigin(0.5);

        const localBtn = this.add.text(600, 250, t('UI_LOCAL_PLAY', 'Local Play'), { fontFamily: '"Press Start 2P", cursive', fontSize: '32px' })
            .setOrigin(0.5)
            .setInteractive();
        trackUiFont(localBtn);

        const onlineBtn = this.add.text(600, 330, t('UI_ONLINE_PLAY', 'Online Play'), { fontFamily: '"Press Start 2P", cursive', fontSize: '30px' })
            .setOrigin(0.5)
            .setInteractive();
        trackUiFont(onlineBtn);

        const backBtn = this.add.text(600, 410, t('UI_BACK', '<- BACK'), { fontFamily: '"Press Start 2P", cursive', fontSize: '24px', color: '#ff6666' })
            .setOrigin(0.5)
            .setInteractive();
        trackUiFont(backBtn);

  localBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalMenuScene');
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
