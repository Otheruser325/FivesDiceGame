import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    try {
      ErrorHandler.setScene(this);
    } catch (e) {}
	try {
      GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
    } catch (e) {}
    try {
      GlobalAchievements.registerScene(this);
    } catch (e) {}
	
    const centerX = this.cameras.main.centerX;
    const centerY = 140;
    const uiButtonFont = 'game_over, "Press Start 2P", cursive';
    const uiFontTargets = [];
    const trackUiFont = (textObj) => {
      if (textObj && typeof textObj.setStyle === 'function') uiFontTargets.push(textObj);
    };
    const t = (key, fallback) => GlobalLocalization.t(key, fallback);

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

    const playBtnY = this.cameras.main.centerY;
    const playBtn = this.add.text(centerX, playBtnY, t('UI_PLAY', 'PLAY'), {
      fontSize: 96,
      fontFamily: '"Press Start 2P", cursive',
      color: '#66ff66'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    playBtn.on('pointerover', () => {
      playBtn.setScale(1.03);
      playBtn.setStyle({ color: '#ffeb8a' });
    });
    playBtn.on('pointerout', () => {
      playBtn.setScale(1.0);
      playBtn.setStyle({ color: '#66ff66' });
    });
    playBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('PlayModeScene');
    });

    const footerY = this.cameras.main.height - 40;
    const musicText = this.add.text(centerX, footerY, t('UI_MUSIC_ON', 'MUSIC: ON'), { fontSize: 18, fontFamily: '"Press Start 2P", cursive', color: '#cccccc' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    musicText.on('pointerdown', () => {
      if (!GlobalAudio || typeof GlobalAudio.toggleMusic !== 'function') return;
      GlobalAudio.toggleMusic(this);
      musicText.setText(GlobalAudio.isMusicOn ? t('UI_MUSIC_ON', 'MUSIC: ON') : t('UI_MUSIC_OFF', 'MUSIC: OFF'));
      GlobalAudio.playButton(this);
    });

    // Start / resume music safely
    if (GlobalAudio && typeof GlobalAudio.playMusic === 'function') GlobalAudio.playMusic(this);
  }
}
