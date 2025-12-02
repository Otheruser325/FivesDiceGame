export default class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {}

    create() {
		GlobalAudio.settings = {
            audio: true,
            music: true
        };
        this.scene.start('MenuScene');
    }
}