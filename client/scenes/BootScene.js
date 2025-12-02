export default class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        this.load.audio('button', '../assets/audio/button.mp3');
        this.load.audio('dice', '../assets/audio/dice.mp3');
    }

    create() {
		GlobalAudio.settings = {
            audio: true,
            music: true
        };
        this.scene.start('MenuScene');
    }
}