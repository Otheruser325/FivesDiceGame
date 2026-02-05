import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalSettings from '../utils/SettingsManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
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
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);

        this.add.text(600, 80, t('SETTINGS_TITLE', 'SETTINGS'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '40px'
        }).setOrigin(0.5);

        // Unified master settings source
        const settings = GlobalSettings.get(this);

        // ---------- AUDIO (SFX) TOGGLE ----------
        this.audioText = this.add.text(
                600, 200,
                settings.audio ? t('SET_SOUND_ON', 'Sound Effects: ON') : t('SET_SOUND_OFF', 'Sound Effects: OFF'), {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '24px'
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.audioText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            GlobalSettings.toggle(this, 'audio');
            this.audioText.setText(GlobalSettings.get(this).audio ? t('SET_SOUND_ON', 'Sound Effects: ON') : t('SET_SOUND_OFF', 'Sound Effects: OFF'));
            GlobalSettings.save(this);
        });

        // ---------- MUSIC TOGGLE ----------
        this.musicText = this.add.text(
                600, 260,
                settings.music ? t('SET_MUSIC_ON', 'Music: ON') : t('SET_MUSIC_OFF', 'Music: OFF'), {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '24px'
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.musicText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            GlobalAudio.toggleMusic(this);
            this.musicText.setText(GlobalSettings.get(this).music ? t('SET_MUSIC_ON', 'Music: ON') : t('SET_MUSIC_OFF', 'Music: OFF'));
            GlobalSettings.save(this);
        });

        // ---------- VISUAL EFFECTS (COMBO FX / SCREEN SHAKE / FLASH) ----------
        this.visualText = this.add.text(
                600, 320,
                settings.visualEffects ? t('SET_VISUAL_ON', 'Visual Effects: ON') : t('SET_VISUAL_OFF', 'Visual Effects: OFF'), {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '24px'
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.visualText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            GlobalSettings.toggle(this, 'visualEffects');
            this.visualText.setText(GlobalSettings.get(this).visualEffects ? t('SET_VISUAL_ON', 'Visual Effects: ON') : t('SET_VISUAL_OFF', 'Visual Effects: OFF'));
            GlobalSettings.save(this);
        });

        // ---------- LANGUAGE ----------
        const languageLabel = GlobalLocalization.getLanguageLabel(settings.language || 'English');
        this.languageText = this.add.text(
                600, 380,
                fmt('SET_LANGUAGE', languageLabel), {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '24px'
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.languageText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            this.showLanguagePopup();
        });

        // ---------- JUKEBOX HEADER ----------
        this.jukeboxBtn = this.add.text(600, 440, t('SET_JUKEBOX', 'Jukebox'), {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '24px',
                color: '#ffff99'
            })
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.jukeboxBtn.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            this.showJukeboxPopup();
        });
		
        // ---------- BACK BUTTON ----------
        this.backBtn = this.add.text(600, 520, t('UI_BACK', '<- BACK'), {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '24px',
                color: '#ff6666'
            })
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.backBtn.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });

        this.popupOpen = false;
        this.popupType = null;
        this._jukeboxPopupElements = null;
        this._languagePopupElements = null;

        this.input.keyboard.on('keydown-ESC', () => {
            if (this.popupOpen) {
                this.closeActivePopup();
            } else {
                GlobalAudio.playButton(this);
                this.scene.start('MenuScene');
            }
        });
    }

    _applyLanguageChange(nextId) {
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
        const current = GlobalSettings.get(this);

        GlobalSettings.set(this, 'language', nextId);
        GlobalSettings.save(this);
        GlobalLocalization.setLanguage(this, nextId);

        const label = GlobalLocalization.getLanguageLabel(nextId);
        this.languageText.setText(fmt('SET_LANGUAGE', label));
        this.audioText.setText(current.audio ? t('SET_SOUND_ON', 'Sound Effects: ON') : t('SET_SOUND_OFF', 'Sound Effects: OFF'));
        this.musicText.setText(current.music ? t('SET_MUSIC_ON', 'Music: ON') : t('SET_MUSIC_OFF', 'Music: OFF'));
        this.visualText.setText(current.visualEffects ? t('SET_VISUAL_ON', 'Visual Effects: ON') : t('SET_VISUAL_OFF', 'Visual Effects: OFF'));
        this.jukeboxBtn.setText(t('SET_JUKEBOX', 'Jukebox'));
        this.backBtn.setText(t('UI_BACK', '<- BACK'));
    }

    closeActivePopup() {
        if (!this.popupOpen) return;
        if (this.popupType === 'jukebox') {
            this.closeJukeboxPopup();
        } else if (this.popupType === 'language') {
            this.closeLanguagePopup();
        }
    }

    _ensureLanguageFlags() {
        const width = 96;
        const height = 60;
        const make = (key, drawFn) => {
            if (this.textures.exists(key)) return;
            const g = this.add.graphics();
            drawFn(g, width, height);
            g.generateTexture(key, width, height);
            g.destroy();
        };

        make('flag_en', (g, w, h) => {
            g.fillStyle(0xffffff, 1).fillRect(0, 0, w, h);
            const crossW = Math.max(6, Math.round(w * 0.14));
            const crossH = Math.max(6, Math.round(h * 0.22));
            g.fillStyle(0xc62828, 1).fillRect(0, Math.round((h - crossH) / 2), w, crossH);
            g.fillStyle(0xc62828, 1).fillRect(Math.round((w - crossW) / 2), 0, crossW, h);
        });

        make('flag_fr', (g, w, h) => {
            g.fillStyle(0x1b4f9c, 1).fillRect(0, 0, Math.round(w / 3), h);
            g.fillStyle(0xffffff, 1).fillRect(Math.round(w / 3), 0, Math.round(w / 3), h);
            g.fillStyle(0xe53935, 1).fillRect(Math.round(w * 2 / 3), 0, Math.round(w / 3), h);
        });

        make('flag_es', (g, w, h) => {
            g.fillStyle(0xaa151b, 1).fillRect(0, 0, w, h);
            g.fillStyle(0xf1bf00, 1).fillRect(0, Math.round(h * 0.25), w, Math.round(h * 0.5));
            g.fillStyle(0xc62828, 1).fillRect(Math.round(w * 0.18), Math.round(h * 0.38), Math.round(w * 0.08), Math.round(h * 0.24));
        });

        make('flag_it', (g, w, h) => {
            g.fillStyle(0x1c8a3f, 1).fillRect(0, 0, Math.round(w / 3), h);
            g.fillStyle(0xffffff, 1).fillRect(Math.round(w / 3), 0, Math.round(w / 3), h);
            g.fillStyle(0xd32f2f, 1).fillRect(Math.round(w * 2 / 3), 0, Math.round(w / 3), h);
        });

        make('flag_pt', (g, w, h) => {
            g.fillStyle(0x1c8a3f, 1).fillRect(0, 0, Math.round(w * 0.4), h);
            g.fillStyle(0xd32f2f, 1).fillRect(Math.round(w * 0.4), 0, Math.round(w * 0.6), h);
            g.fillStyle(0xf1bf00, 1).fillCircle(Math.round(w * 0.42), Math.round(h * 0.5), Math.round(h * 0.18));
            g.fillStyle(0x1b4f9c, 1).fillCircle(Math.round(w * 0.42), Math.round(h * 0.5), Math.round(h * 0.08));
        });

        make('flag_cy', (g, w, h) => {
            g.fillStyle(0xffffff, 1).fillRect(0, 0, w, Math.round(h * 0.5));
            g.fillStyle(0x1c8a3f, 1).fillRect(0, Math.round(h * 0.5), w, Math.round(h * 0.5));
            g.fillStyle(0xc62828, 1);
            const bodyY = Math.round(h * 0.48);
            g.fillRect(Math.round(w * 0.2), bodyY - 6, Math.round(w * 0.45), 12);
            g.fillTriangle(Math.round(w * 0.18), bodyY, Math.round(w * 0.08), bodyY - 10, Math.round(w * 0.08), bodyY + 10);
            g.fillTriangle(Math.round(w * 0.65), bodyY - 6, Math.round(w * 0.78), bodyY - 16, Math.round(w * 0.75), bodyY);
            g.fillTriangle(Math.round(w * 0.65), bodyY + 6, Math.round(w * 0.78), bodyY + 16, Math.round(w * 0.75), bodyY);
            g.fillCircle(Math.round(w * 0.7), bodyY - 14, 3);
        });

        this._flagSize = { width, height };
    }

    showLanguagePopup() {
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);

        if (this.popupOpen) {
            this.closeActivePopup();
        }

        this._ensureLanguageFlags();

        // ---- LOCK UI ----
        this.popupOpen = true;
        this.popupType = 'language';
        this.audioText.disableInteractive();
        this.musicText.disableInteractive();
        this.visualText.disableInteractive();
        this.languageText.disableInteractive();
        this.jukeboxBtn.disableInteractive();
        this.backBtn.disableInteractive();

        // ---- Dark background overlay ----
        const overlay = this.add.rectangle(600, 300, 900, 700, 0x000000, 0.55)
            .setDepth(20);

        // ---- Popup window ----
        const popup = this.add.rectangle(600, 300, 620, 380, 0x222222, 0.95)
            .setStrokeStyle(3, 0xffffff)
            .setDepth(21);

        const currentId = GlobalSettings.get(this).language || 'English';
        const label = GlobalLocalization.getLanguageLabel(currentId);

        const title = this.add.text(600, 170, fmt('SET_LANGUAGE', label), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '20px',
            color: '#ffffaa'
        }).setOrigin(0.5).setDepth(22);

        const flagMap = {
            English: 'flag_en',
            French: 'flag_fr',
            Spanish: 'flag_es',
            Italian: 'flag_it',
            Portuguese: 'flag_pt',
            Welsh: 'flag_cy'
        };

        const langs = GlobalLocalization.getLanguages();
        const size = this._flagSize || { width: 96, height: 60 };
        const startX = 430;
        const startY = 240;
        const colSpacing = 170;
        const rowSpacing = 120;

        const flagItems = [];

        langs.forEach((lang, idx) => {
            const col = idx % 3;
            const row = Math.floor(idx / 3);
            const x = startX + col * colSpacing;
            const y = startY + row * rowSpacing;
            const isCurrent = lang.id === currentId;
            const textureKey = flagMap[lang.id];

            const border = this.add.rectangle(x, y, size.width + 10, size.height + 10, 0x000000, 0)
                .setStrokeStyle(2, isCurrent ? 0xffff66 : 0xffffff)
                .setDepth(22);

            const img = this.add.image(x, y, textureKey)
                .setDepth(23);

            const name = GlobalLocalization.getLanguageLabel(lang.id);
            const labelText = this.add.text(x, y + (size.height / 2) + 18, name, {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '10px',
                color: '#ffffff'
            }).setOrigin(0.5).setDepth(23);

            const hit = this.add.zone(x, y, size.width + 18, size.height + 18)
                .setInteractive({ useHandCursor: true })
                .setDepth(24);

            hit.on('pointerdown', () => {
                this._applyLanguageChange(lang.id);
                this.closeLanguagePopup();
            });

            flagItems.push({ border, img, labelText, hit });
        });

        const closeBtn = this.add.text(600, 470, t('UI_CLOSE', 'Close'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '18px',
            color: '#ff8888'
        }).setOrigin(0.5).setDepth(22).setInteractive({ useHandCursor: true });

        closeBtn.on('pointerdown', () => {
            this.closeLanguagePopup();
        });

        this._languagePopupElements = { overlay, popup, title, closeBtn, flagItems };
    }

    closeLanguagePopup() {
        if (!this.popupOpen || !this._languagePopupElements) return;

        if (GlobalAudio) GlobalAudio.playButton(this);

        const { overlay, popup, title, closeBtn, flagItems } = this._languagePopupElements;

        overlay.destroy();
        popup.destroy();
        title.destroy();
        closeBtn.destroy();
        flagItems.forEach(item => {
            item.border.destroy();
            item.img.destroy();
            item.labelText.destroy();
            item.hit.destroy();
        });

        this.audioText.setInteractive();
        this.musicText.setInteractive();
        this.visualText.setInteractive();
        this.languageText.setInteractive();
        this.jukeboxBtn.setInteractive();
        this.backBtn.setInteractive();

        this.popupOpen = false;
        this.popupType = null;
        this._languagePopupElements = null;
    }

    showJukeboxPopup() {
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);

        if (this.popupOpen) {
            this.closeActivePopup();
        }

        // ---- LOCK UI ----
        this.popupOpen = true;
        this.popupType = 'jukebox';
		this.audioText.disableInteractive()
		this.musicText.disableInteractive()
        this.visualText.disableInteractive()
        this.languageText.disableInteractive()
        this.jukeboxBtn.disableInteractive();
        this.backBtn.disableInteractive();

        // ---- Dark background overlay ----
        const overlay = this.add.rectangle(600, 300, 900, 700, 0x000000, 0.55)
            .setDepth(20);

        // ---- Popup window ----
        const popup = this.add.rectangle(600, 300, 500, 350, 0x222222, 0.95)
            .setStrokeStyle(3, 0xffffff)
            .setDepth(21);

        // ---- Popup title ----
        this.jukeboxTitle = this.add.text(600, 170, t('SET_MUSIC_TRACKS', 'Music Tracks'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '24px',
            color: '#ffffaa'
        }).setOrigin(0.5).setDepth(22);

        // ---- Shuffle toggle (new) ----
        const settings = GlobalSettings.get(this);
        const shuffleOn = !!settings.shuffleTrack;
        const shuffleBtn = this.add.text(600, 195, shuffleOn ? t('SET_SHUFFLE_ON', 'Shuffle Track: ON') : t('SET_SHUFFLE_OFF', 'Shuffle Track: OFF'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '16px',
            color: shuffleOn ? '#66ff66' : '#ffffff'
        }).setOrigin(0.5).setDepth(22).setInteractive({ useHandCursor: true });

        shuffleBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            const newVal = GlobalSettings.toggle(this, 'shuffleTrack');
            GlobalSettings.save(this);
            shuffleBtn.setText(newVal ? t('SET_SHUFFLE_ON', 'Shuffle Track: ON') : t('SET_SHUFFLE_OFF', 'Shuffle Track: OFF'));
            shuffleBtn.setColor(newVal ? '#66ff66' : '#ffffff');

            // Immediately update playback mode
            // If shuffle is enabled, we avoid forcing manual loop; otherwise keep behavior.
            // Recreate playback to apply the new behaviour.
            GlobalAudio._cleanupMusic && GlobalAudio._cleanupMusic(); // defensive; method exists
            GlobalAudio.playMusic(this);
        });

        // ---- Track list ----
        const trackNames = [
            t('TRACK_DICE_LEAGUE', 'Dice League'),
            t('TRACK_BASILISK_THEME', 'Basilisk Theme'),
            t('TRACK_POWERHOUSE', 'Powerhouse')
        ];
        const trackY = 250;
        const spacing = 70;

        const selected = GlobalSettings.get(this).trackIndex;

        // Buttons stored for highlight
        const trackBtns = [];

        trackNames.forEach((name, i) => {
            const btn = this.add.text(600, trackY + i * spacing, name, {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '20px',
                    color: i === selected ? '#66ff66' : '#ffffff'
                })
                .setOrigin(0.5)
                .setDepth(22)
                .setInteractive({
                    useHandCursor: true
                });

            btn.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                GlobalAudio.setTrack(this, i);

                // highlight update
                trackBtns.forEach((b, id) => {
                    b.setColor(id === i ? '#66ff66' : '#ffffff');
                });
            });

            trackBtns.push(btn);
        });

        // ---- Close button ----
        const closeBtn = this.add.text(600, 450, t('UI_CLOSE', 'Close'), {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '20px',
                color: '#ff8888'
            })
            .setOrigin(0.5)
            .setDepth(22)
            .setInteractive({
                useHandCursor: true
            });

        // Store popup elements for cleanup
        this._jukeboxPopupElements = { overlay, popup, closeBtn, trackBtns, shuffleBtn };

        closeBtn.on('pointerdown', () => {
            this.closeJukeboxPopup();
        });
    }

    closeJukeboxPopup() {
        if (!this.popupOpen || !this._jukeboxPopupElements) return;

        if (GlobalAudio) GlobalAudio.playButton(this);

        const { overlay, popup, closeBtn, trackBtns, shuffleBtn } = this._jukeboxPopupElements;

        // destroy popup elements
        overlay.destroy();
        popup.destroy();
        closeBtn.destroy();
        trackBtns.forEach(btn => btn.destroy());
        shuffleBtn.destroy();
        
        // hide jukebox title
        if (this.jukeboxTitle) this.jukeboxTitle.setVisible(false);

        // RE-ENABLE UI
        this.audioText.setInteractive()
        this.musicText.setInteractive()
        this.visualText.setInteractive()
        this.languageText.setInteractive()
        this.jukeboxBtn.setInteractive();
        this.backBtn.setInteractive();

        this.popupOpen = false;
        this.popupType = null;
        this._jukeboxPopupElements = null;
    }
}
