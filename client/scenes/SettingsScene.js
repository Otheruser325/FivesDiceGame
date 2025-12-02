import { playButtonSFX } from '../utils/AudioManager.js';

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
    }

    create() {
        this.add.text(400, 80, 'Settings', { fontSize: 48 }).setOrigin(0.5);

        const settings = this.registry.get('settings');

        // Audio toggle
        const audioText = this.add.text(
            400, 200,
            `Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`,
            { fontSize: 32 }
        ).setOrigin(0.5).setInteractive();

        audioText.on('pointerdown', () => {
            playButtonSFX(this);
            settings.audio = !settings.audio;
            this.registry.set('settings', settings);
            sfxText.setText(`Sound Effects: ${settings.audio ? 'ON' : 'OFF'}`);
        });

        // Back
        const backBtn = this.add.text(400, 360, 'Back', { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive();

        backBtn.on('pointerdown', () => {
            playButtonSFX(this);
            this.scene.start('MenuScene');
        });
    }
}