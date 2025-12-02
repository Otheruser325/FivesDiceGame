import { GlobalAudio } from '../main.js';

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
    }

    create() {
        this.add.text(400, 80, 'Settings', { fontSize: 48 }).setOrigin(0.5);

        // Unified master settings source
        const settings = GlobalAudio.getSettings(this);

        // ---------- AUDIO (SFX) TOGGLE ----------
        const audioText = this.add.text(
            400, 200,
            `Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`,
            { fontSize: 32 }
        )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

        audioText.on('pointerdown', () => {
            GlobalAudio.playButton(this);

            settings.audio = !settings.audio;
            this.registry.set('settings', settings); // SAVE

            audioText.setText(`Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`);
        });

        // ---------- MUSIC TOGGLE ----------
        const musicText = this.add.text(
            400, 260,
            `Music: ${settings.music ? 'ON' : 'OFF'}`,
            { fontSize: 32 }
        )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

        musicText.on('pointerdown', () => {
            GlobalAudio.playButton(this);

            GlobalAudio.toggleMusic(this);

            const newSettings = GlobalAudio.getSettings(this);
            musicText.setText(`Music: ${newSettings.music ? 'ON' : 'OFF'}`);
        });

        // ---------- BACK BUTTON ----------
        const backBtn = this.add.text(400, 360, 'Back', { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}