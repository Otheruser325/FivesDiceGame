import { GlobalAudio } from '../main.js';

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
    }

    create() {
        this.add.text(400, 80, 'Settings', {
            fontSize: 48
        }).setOrigin(0.5);

        // Unified master settings source
        const settings = GlobalAudio.getSettings(this);

        // ---------- AUDIO (SFX) TOGGLE ----------
        this.audioText = this.add.text(
                400, 200,
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
            this.registry.set('settings', settings); // SAVE

            audioText.setText(`Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`);
        });

        // ---------- MUSIC TOGGLE ----------
        this.musicText = this.add.text(
                400, 260,
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

            const newSettings = GlobalAudio.getSettings(this);
            musicText.setText(`Music: ${newSettings.music ? 'ON' : 'OFF'}`);
        });

        // ---------- JUKEBOX HEADER ----------
        this.jukeboxBtn = this.add.text(400, 330, 'Jukebox', {
                fontSize: 28,
                color: '#ffff99'
            })
            .setOrigin(0.5)
            .setInteractive({
                useHandCursor: true
            });

        this.jukeboxBtn.on('pointerdown', () => {
            if (GlobalAudio) GlobalAudio.playButton(this);
            this.showJukeboxPopup(jukeboxBtn);
        });
		
        // ---------- BACK BUTTON ----------
        this.backBtn = this.add.text(400, 360, 'Back', {
                fontSize: 28
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

    showJukeboxPopup(jukeboxBtn) {
        // ---- LOCK UI ----
		this.audioText.disableInteractive()
		this.musicText.disableInteractive()
        this.jukeboxBtn.disableInteractive();
        this.backBtn.disableInteractive();

        // ---- Dark background overlay ----
        const overlay = this.add.rectangle(400, 300, 900, 700, 0x000000, 0.55)
            .setDepth(20);

        // ---- Popup window ----
        const popup = this.add.rectangle(400, 300, 500, 350, 0x222222, 0.95)
            .setStrokeStyle(3, 0xffffff)
            .setDepth(21);

        // ---- Popup title ----
        this.add.text(400, 170, 'Music Tracks', {
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
            const btn = this.add.text(400, trackY + i * spacing, name, {
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
        const closeBtn = this.add.text(400, 450, 'Close', {
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

            // RE-ENABLE UI
			this.audioText.setInteractive()
		    this.musicText.setInteractive()
            this.jukeboxBtn.setInteractive();
            this.backBtn.setInteractive();
        });
    }
}