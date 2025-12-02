import { playButtonSFX } from '../utils/AudioManager.js';

export default class SettingsScene extends Phaser.Scene {
    constructor() {
        super('SettingsScene');
    }

    create() {
        this.add.text(400, 80, 'Settings', { fontSize: 48 }).setOrigin(0.5);

        const settings = this.registry.get('settings');

        // SFX toggle
        const sfxText = this.add.text(
            400, 200,
            `Sound Effects: ${settings.sfx ? 'ON' : 'OFF'}`,
            { fontSize: 32 }
        ).setOrigin(0.5).setInteractive();

        sfxText.on('pointerdown', () => {
            playButtonSFX(this);
            settings.sfx = !settings.sfx;
            this.registry.set('settings', settings);
            sfxText.setText(`Sound Effects: ${settings.sfx ? 'ON' : 'OFF'}`);
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