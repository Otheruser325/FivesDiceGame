export default class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        this.load.audio('button', '../client/assets/audio/button.mp3');
        this.load.audio('dice', '../client/assets/audio/dice.mp3');
    }

    create() {
		GlobalAudio.settings = {
            audio: true,
            music: true
        };
        this.scene.start('MenuScene');
    }
}