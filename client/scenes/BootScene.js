export default class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        this.load.audio('button', './assets/audio/button.mp3');
        this.load.audio('dice', './assets/audio/dice.mp3');
    }

    create() {
        this.registry.set('settings', {
            audio: true,
            music: true,
            comboRules: false
        });

        this.scene.start('MenuScene');
    }
}