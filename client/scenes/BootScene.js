export default class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        this.load.audio('button', '/FivesDiceGame/client/assets/audio/button.mp3');
        this.load.audio('dice', '/FivesDiceGame/client/assets/audio/button.mp3');
    }

    create() {
		GlobalAudio.settings = {
            audio: true,
            music: true
        };
        this.scene.start('MenuScene');
    }
}