import { GlobalAudio } from '../main.js';

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
    }

    create() {
        this.add.text(400, 80, 'Settings', { fontSize: 48 }).setOrigin(0.5);
		
        let settings = this.registry.get('settings') || {
            audio: true,
            music: true,
            comboRules: false
        };

        // Audio toggle
        const audioText = this.add.text(
            400, 200,
            `Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`,
            { fontSize: 32 }
        ).setOrigin(0.5).setInteractive();

        audioText.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            settings.audio = !settings.audio;
            this.registry.set('settings', settings);
            audioText.setText(`Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`);
        });

        // Back
        const backBtn = this.add.text(400, 360, 'Back', { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}