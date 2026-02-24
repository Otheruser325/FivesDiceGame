import GlobalAudio from '../utils/AudioManager.js';
import GlobalSettings from '../utils/SettingsManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const onOff = (val) => t(val ? 'UI_ON' : 'UI_OFF', val ? 'ON' : 'OFF');

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
    }

    create() {
        ErrorHandler.setScene(this);
        this.jukeboxOpen = false;
        this.jukeboxElements = null;
        this.titleText = this.add.text(600, 80, t('SETTINGS_TITLE', 'Settings'), {
            fontSize: 48
        }).setOrigin(0.5);

        // Unified master settings source
        const settings = GlobalSettings.get(this);

        // ---------- AUDIO (SFX) TOGGLE ----------
        this.audioText = this.add.text(
                600, 200,
                tf('SET_SOUND', 'Sound Effects: {0}', onOff(settings.audio)), {
                    fontSize: 32
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.audioText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            GlobalSettings.toggle(this, 'audio');
            this.refreshLabels();
            GlobalSettings.save(this);
        });

        // ---------- MUSIC TOGGLE ----------
        this.musicText = this.add.text(
                600, 260,
                tf('SET_MUSIC', 'Music: {0}', onOff(settings.music)), {
                    fontSize: 32
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.musicText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            GlobalAudio.toggleMusic(this);
            this.refreshLabels();
            GlobalSettings.save(this);
        });

        // ---------- VISUAL EFFECTS (COMBO FX / SCREEN SHAKE / FLASH) ----------
        this.visualText = this.add.text(
                600, 320,
                tf('SET_VISUAL', 'Visual Effects: {0}', onOff(settings.visualEffects)), {
                    fontSize: 32
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.visualText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            GlobalSettings.toggle(this, 'visualEffects');
            this.refreshLabels();
            GlobalSettings.save(this);
        });

        // ---------- LANGUAGE ----------
        const currentLang = settings.language || GlobalLocalization.getLanguage();
        this.languageText = this.add.text(
            600,
            380,
            tf('SET_LANGUAGE', 'Language: {0}', GlobalLocalization.getLanguageLabel(currentLang)),
            { fontSize: 28, color: '#ffff99' }
        )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

        this.languageText.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            const langs = GlobalLocalization.getLanguages();
            const current = GlobalLocalization.getLanguage();
            const idx = Math.max(0, langs.findIndex(l => l.id === current));
            const next = langs[(idx + 1) % langs.length]?.id || 'English';
            GlobalLocalization.setLanguage(this, next);
            GlobalSettings.set(this, 'language', next);
            this.refreshLabels();
        });

        // ---------- JUKEBOX HEADER ----------
        this.jukeboxBtn = this.add.text(600, 440, t('SET_JUKEBOX', 'Jukebox'), {
                fontSize: 28,
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
        this.backBtn = this.add.text(600, 520, t('UI_BACK', '<- Back'), {
                fontSize: 28,
                color: '#66aaff'
            })
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.backBtn.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });

        if (this.input && this.input.keyboard) {
            this._escHandler = (event) => {
                if (event.repeat) return;
                this.handleEscPressed();
            };
            this.input.keyboard.on('keydown-ESC', this._escHandler);
            this.events.once('shutdown', () => {
                if (this.input && this.input.keyboard && this._escHandler) {
                    this.input.keyboard.off('keydown-ESC', this._escHandler);
                }
                this._escHandler = null;
            });
        }
    }

    handleEscPressed() {
        GlobalAudio.playButton(this);
        if (this.jukeboxOpen) {
            this.closeJukeboxPopup();
            return;
        }
        this.scene.start('MenuScene');
    }

    refreshLabels() {
        const settings = GlobalSettings.get(this);
        if (this.titleText) {
            this.titleText.setText(t('SETTINGS_TITLE', 'Settings'));
        }
        if (this.audioText) {
            this.audioText.setText(tf('SET_SOUND', 'Sound Effects: {0}', onOff(settings.audio)));
        }
        if (this.musicText) {
            this.musicText.setText(tf('SET_MUSIC', 'Music: {0}', onOff(settings.music)));
        }
        if (this.visualText) {
            this.visualText.setText(tf('SET_VISUAL', 'Visual Effects: {0}', onOff(settings.visualEffects)));
        }
        if (this.languageText) {
            const lang = settings.language || GlobalLocalization.getLanguage();
            this.languageText.setText(tf('SET_LANGUAGE', 'Language: {0}', GlobalLocalization.getLanguageLabel(lang)));
        }
        if (this.jukeboxBtn) {
            this.jukeboxBtn.setText(t('SET_JUKEBOX', 'Jukebox'));
        }
        if (this.backBtn) {
            this.backBtn.setText(t('UI_BACK', '<- Back'));
        }
    }

    showJukeboxPopup() {
        if (this.jukeboxOpen) return;
        this.jukeboxOpen = true;
        // ---- LOCK UI ----
        this.audioText.disableInteractive();
        this.musicText.disableInteractive();
        this.visualText.disableInteractive();
        if (this.languageText) this.languageText.disableInteractive();
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
            fontSize: 34,
            color: '#ffffaa'
        }).setOrigin(0.5).setDepth(22);

        // ---- Shuffle toggle ----
        const settings = GlobalSettings.get(this);
        const shuffleOn = !!settings.shuffleTrack;
        const shuffleBtn = this.add.text(
            600,
            195,
            tf('SET_SHUFFLE', 'Shuffle Track: {0}', onOff(shuffleOn)),
            {
                fontSize: 22,
                color: shuffleOn ? '#66ff66' : '#ffffff'
            }
        ).setOrigin(0.5).setDepth(22).setInteractive({ useHandCursor: true });

        shuffleBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            const newVal = GlobalSettings.toggle(this, 'shuffleTrack');
            GlobalSettings.save(this);
            shuffleBtn.setText(tf('SET_SHUFFLE', 'Shuffle Track: {0}', onOff(newVal)));
            shuffleBtn.setColor(newVal ? '#66ff66' : '#ffffff');

            // Immediately update playback mode
            GlobalAudio._cleanupMusic && GlobalAudio._cleanupMusic();
            GlobalAudio.playMusic(this);
        });

        // ---- Track list ----
        const trackNames = [
            t('TRACK_HERO_TIME', 'Hero Time'),
            t('TRACK_ENERGY', 'Energy'),
            t('TRACK_POWERHOUSE', 'Powerhouse')
        ];
        const trackY = 250;
        const spacing = 70;

        const selected = GlobalSettings.get(this).trackIndex;

        // Buttons stored for highlight
        const trackBtns = [];

        trackNames.forEach((name, i) => {
            const btn = this.add.text(600, trackY + i * spacing, name, {
                    fontSize: 26,
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
                fontSize: 28,
                color: '#ff8888'
            })
            .setOrigin(0.5)
            .setDepth(22)
            .setInteractive({
                useHandCursor: true
            });

        closeBtn.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            this.closeJukeboxPopup();
        });

        this.jukeboxElements = {
            overlay,
            popup,
            closeBtn,
            trackBtns,
            shuffleBtn,
            jukeboxTitle: this.jukeboxTitle
        };
    }

    closeJukeboxPopup() {
        if (!this.jukeboxOpen) return;
        if (this.jukeboxElements) {
            const { overlay, popup, closeBtn, trackBtns, shuffleBtn, jukeboxTitle } = this.jukeboxElements;
            if (overlay) overlay.destroy();
            if (popup) popup.destroy();
            if (closeBtn) closeBtn.destroy();
            if (Array.isArray(trackBtns)) trackBtns.forEach(btn => btn.destroy());
            if (shuffleBtn) shuffleBtn.destroy();
            if (jukeboxTitle) jukeboxTitle.setVisible(false);
        }
        this.jukeboxElements = null;
        this.jukeboxOpen = false;

        // RE-ENABLE UI
        this.audioText.setInteractive();
        this.musicText.setInteractive();
        this.visualText.setInteractive();
        if (this.languageText) this.languageText.setInteractive();
        this.jukeboxBtn.setInteractive();
        this.backBtn.setInteractive();
    }
}
