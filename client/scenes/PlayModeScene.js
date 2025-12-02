import { GlobalAudio } from '../main.js';

export default class PlayModeScene extends Phaser.Scene {
    constructor() {
        super('PlayModeScene');
    }

    create() {
        this.add.text(400, 80, 'Play', { fontSize: 48 }).setOrigin(0.5);

        const localBtn = this.add.text(400, 200, 'Local Play', { fontSize: 32 })
            .setOrigin(0.5)
            .setInteractive();

        const onlineBtn = this.add.text(400, 260, 'Online Play (WIP)', { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive();

        const backBtn = this.add.text(400, 360, 'Back', { fontSize: 28 })
            .setOrigin(0.5)
            .setInteractive();
        
		localBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('LocalConfigScene');
        });
		
		onlineBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineGameScene');
        });
		
		backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}