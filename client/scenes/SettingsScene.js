import { GlobalAudio } from '../main.js';

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
    }

    create() {
        this.add.text(400, 80, 'Settings', { fontSize: 48 }).setOrigin(0.5);

        // Ensure settings always exist (prevents undefined errors)
        const defaultSettings = {
            audio: true,
            music: true,
            comboRules: false
        };
        
        let settings = this.registry.get('settings');
        if (!settings) {
            settings = defaultSettings;
            this.registry.set('settings', settings);
        }

        // ---------- AUDIO TOGGLE ----------
        const audioText = this.add.text(
            400, 200,
            `Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`,
            { fontSize: 32 }
        )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

        audioText.on('pointerdown', () => {
            if (GlobalAudio && GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }

            settings.audio = !settings.audio;
            this.registry.set('settings', settings);

            audioText.setText(`Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`);
        });

        // ---------- BACK BUTTON ----------
        const backBtn = this.add.text(400, 360, 'Back', { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        backBtn.on('pointerdown', () => {
            if (GlobalAudio && GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }

            this.scene.start('MenuScene');
        });
    }
}