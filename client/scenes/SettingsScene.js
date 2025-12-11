import { GlobalAudio } from '../utils/AudioManager.js';

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
    }

    create() {
        this.add.text(600, 80, 'Settings', {
            fontSize: 48
        }).setOrigin(0.5);

        // Unified master settings source
        const settings = GlobalAudio.getSettings(this);

        // ---------- AUDIO (SFX) TOGGLE ----------
        this.audioText = this.add.text(
                600, 200,
                `Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`, {
                    fontSize: 32
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.audioText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
			
            settings.audio = !settings.audio;
            this.registry.set('settings', settings);
				
            this.audioText.setText(`Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`);
			
			if (GlobalAudio) GlobalAudio.saveSettings(this);
        });

        // ---------- MUSIC TOGGLE ----------
        this.musicText = this.add.text(
                600, 260,
                `Music: ${settings.music ? 'ON' : 'OFF'}`, {
                    fontSize: 32
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.musicText.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            if (GlobalAudio) GlobalAudio.toggleMusic(this);
				
            this.musicText.setText(`Music: ${settings.music ? 'ON' : 'OFF'}`);
			
			if (GlobalAudio) GlobalAudio.saveSettings(this);
        });

        // ---------- VISUAL EFFECTS (COMBO FX / SCREEN SHAKE / FLASH) ----------
        this.visualText = this.add.text(
                600, 320,
                `Visual Effects: ${settings.visualEffects ? 'ON' : 'OFF'}`, {
                    fontSize: 32
                }
            )
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.visualText.on('pointerdown', () => {
            // soft click sfx
            if (GlobalAudio) GlobalAudio.playButton(this);

            settings.visualEffects = !settings.visualEffects;
            this.registry.set('settings', settings);

            this.visualText.setText(`Visual Effects: ${settings.visualEffects ? 'ON' : 'OFF'}`);

            if (GlobalAudio) GlobalAudio.saveSettings(this);
        });

        // ---------- JUKEBOX HEADER ----------
        this.jukeboxBtn = this.add.text(600, 380, 'Jukebox', {
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
        this.backBtn = this.add.text(600, 460, 'Back', {
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
    }

    showJukeboxPopup() {
        // ---- LOCK UI ----
		this.audioText.disableInteractive()
		this.musicText.disableInteractive()
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
        this.jukeboxTitle = this.add.text(600, 170, 'Music Tracks', {
            fontSize: 34,
            color: '#ffffaa'
        }).setOrigin(0.5).setDepth(22);

        // ---- Track list ----
        const trackNames = ['Hero Time', 'Energy', 'Powerhouse'];
        const trackY = 250;
        const spacing = 70;

        const settings = GlobalAudio.getSettings(this);
        const selected = settings.trackIndex;

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
        const closeBtn = this.add.text(600, 450, 'Close', {
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

            // destroy popup elements
            overlay.destroy();
            popup.destroy();
            closeBtn.destroy();
            trackBtns.forEach(btn => btn.destroy());
			
			// hide jukebox title
			this.jukeboxTitle.setVisible(false);

            // RE-ENABLE UI
			this.audioText.setInteractive()
		    this.musicText.setInteractive()
            this.jukeboxBtn.setInteractive();
            this.backBtn.setInteractive();
        });
    }
}