import { playButtonSFX } from '../utils/AudioManager.js';

export default class HelpScene extends Phaser.Scene {
    constructor() {
        super('HelpScene');
    }

    create() {
        this.add.text(400, 70, 'Help', {
            fontSize: '52px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(400, 130, 'How to Play Fives', {
            fontSize: '32px',
            color: '#ffff66'
        }).setOrigin(0.5);

        const helpText =
            "Fives is a simple competitive dice game.\n\n" +
            "• Each player rolls five dice on their turn.\n" +
            "• A standard game lasts 20 rounds.\n" +
            "• After each roll, the values of all five dice\n" +
            "  are added together to form your round score.\n" +
            "• The opponent (computer or online player)\n" +
            "  also rolls five dice each round.\n\n" +
            "The player with the highest total score\n" +
            "after 20 rounds wins the game!";

        this.add.text(400, 320, helpText, {
            fontSize: '22px',
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);

        const backBtn = this.add.text(400, 550, 'Back', {
            fontSize: 28,
            color: '#66aaff'
        })
        .setOrigin(0.5)
        .setInteractive();
		
		backBtn.on('pointerdown', () => {
            playButtonSFX(this);
            this.scene.start('MenuScene');
        });
    }
}