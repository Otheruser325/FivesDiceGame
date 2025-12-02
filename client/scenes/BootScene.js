export default class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        this.load.audio('button', 'assets/sfx/button.mp3');
        this.load.audio('dice', 'assets/sfx/dice.mp3');
    }

    create() {
        this.registry.set('settings', {
            sfx: true,
            music: true,
            comboRules: false
        });

        this.scene.start('MenuScene');
    }
}