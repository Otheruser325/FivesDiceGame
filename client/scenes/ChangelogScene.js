import { GlobalAudio } from '../utils/AudioManager.js';

export default class ChangelogScene extends Phaser.Scene {
    constructor() {
        super('ChangelogScene');
    }

    create() {
        this.popupOpen = false;
        
        this.add.text(600, 70, 'Changelog', {
            fontSize: '52px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(600, 130, 'Update 1.0 (11/12/2025)', {
            fontSize: '32px',
            color: '#ffff66'
        }).setOrigin(0.5);

        const changelogText =
            "Fives Release!";

        this.add.text(600, 190, changelogText, {
            fontSize: '22px',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 620 }
        }).setOrigin(0.5);

        this.backBtn = this.add.text(600, 250, 'Back', {
            fontSize: 28,
            color: '#66aaff'
        })
        .setOrigin(0.5)
        .setInteractive();

        this.backBtn.on('pointerdown', () => {
            if (this.popupOpen) return; 
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }
}