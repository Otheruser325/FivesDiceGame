import { GlobalAudio } from '../utils/AudioManager.js';

export default class HelpScene extends Phaser.Scene {
    constructor() {
        super('HelpScene');
    }

    create() {
        this.popupOpen = false;
		
        this.add.text(600, 70, 'Help', {
            fontSize: '52px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(600, 130, 'How to Play Fives', {
            fontSize: '32px',
            color: '#ffff66'
        }).setOrigin(0.5);

        const helpText =
            "Fives is a simple but strategic dice game.\n\n" +
            "• You and your opponent each roll five dice per round.\n" +
            "• Games can be 10–30 rounds (default: 20 rounds).\n" +
            "• All five dice values are added together as your round score.\n" +
            "• Your total score is the sum of all round scores.\n\n" +
            "Special Rules (Optional):\n" +
            "If combo rules are enabled, certain dice patterns\n" +
            "award bonus multipliers. These can dramatically\n" +
            "increase your round score if rolled.\n\n" +
            "The player with the highest total score at the end\n" +
            "of the game wins!";

        this.add.text(600, 390, helpText, {
            fontSize: '22px',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 620 }
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(900, 40, 'Combo Rules', {
            fontSize: '22px',
            color: '#ffdd66'
        })
        .setOrigin(1, 0.5)
        .setInteractive();

        this.comboBtn.on('pointerdown', () => {
            if (GlobalAudio.playButton) {
                GlobalAudio.playButton(this);
            }
            this.showComboPopup();
        });

        this.backBtn = this.add.text(600, 650, 'Back', {
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

    showComboPopup() {
		this.popupOpen = true;
		
		this.backBtn.disableInteractive();
        if (this.comboBtn) this.comboBtn.disableInteractive();
		
        const bg = this.add.rectangle(600, 300, 600, 380, 0x000000, 0.75)
            .setStrokeStyle(3, 0xffffff);

        const title = this.add.text(600, 140, 'Combo Rules', {
            fontSize: '32px',
            color: '#ffff66'
        }).setOrigin(0.5);

        const comboRules =
            "Certain dice combinations award bonus multipliers:\n\n" +
			"• Pair → ×1.5 score\n" +
			"• Two Pair → ×2 score\n" +
            "• Three of a Kind → ×3 score\n" +
			"• Full House → ×4 score\n" +
            "• Four of a Kind → ×5 score\n" +
            "• Five of a Kind → ×10 score\n" +
            "• Straights (1–5 or 2–6) → ×2.5 or ×3 score\n\n" +
            "These bonuses stack with your standard 5-dice total.\n" +
            "Rolling effective combos can make a massive difference\n" +
            "in your performance!";

        const rulesText = this.add.text(600, 320, comboRules, {
            fontSize: '20px',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 520 }
        }).setOrigin(0.5);

        const closeBtn = this.add.text(600, 480, 'Close', {
            fontSize: 26,
            color: '#66aaff'
        })
        .setOrigin(0.5)
        .setInteractive();

        closeBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
			
            bg.destroy();
            title.destroy();
            rulesText.destroy();
            closeBtn.destroy();
			
			this.popupOpen = false;
            this.backBtn.setInteractive();
            if (this.comboBtn) this.comboBtn.setInteractive();
        });
    }
}