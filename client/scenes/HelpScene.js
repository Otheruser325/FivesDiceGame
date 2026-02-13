import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);

export default class HelpScene extends Phaser.Scene {
    constructor() {
        super('HelpScene');
    }

    create() {
        ErrorHandler.setScene(this);
        this.popupOpen = false;
        this.popupElements = null;

        this.add.text(600, 70, t('HELP_TITLE', 'Help'), {
            fontSize: '52px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(600, 130, t('HELP_SUBTITLE', 'How to Play Fives'), {
            fontSize: '32px',
            color: '#ffff66'
        }).setOrigin(0.5);

        const helpText = t(
            'HELP_TEXT',
            'Fives is a simple but strategic dice game.\n\n' +
            '- You and your opponent each roll five dice per round.\n' +
            '- Games can be 10-30 rounds (default: 20 rounds).\n' +
            '- Your round score is the sum of all five dice.\n' +
            '- Your total score is the sum of all round scores.\n' +
            '- Optional: Multiplex rule multiplies the dice instead of adding.\n' +
            '- Optional: Combo rules add multipliers for special patterns.\n' +
            '- Hotkeys: Space/R rolls, T ends your turn (your turn only).\n\n' +
            'The player with the highest total score at the end wins!'
        );

        this.add.text(600, 390, helpText, {
            fontSize: '22px',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 620 }
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(900, 40, t('HELP_COMBO_BUTTON', 'Combo Rules'), {
            fontSize: '22px',
            color: '#ffdd66'
        })
        .setOrigin(1, 0.5)
        .setInteractive();

        this.comboBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.showComboPopup();
        });

        this.backBtn = this.add.text(600, 650, t('UI_BACK', '<- Back'), {
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

        if (this.input && this.input.keyboard) {
            this._escHandler = (event) => {
                if (event.repeat) return;
                this.handleEscPressed();
            };
            this.input.keyboard.on('keydown-ESC', this._escHandler);
            this.events.once('shutdown', () => {
                if (this.input && this.input.keyboard && this._escHandler) {
                    this.input.keyboard.off('keydown-ESC', this._escHandler);
                }
                this._escHandler = null;
            });
        }
    }

    handleEscPressed() {
        GlobalAudio.playButton(this);
        if (this.popupOpen) {
            this.closeComboPopup();
            return;
        }
        this.scene.start('MenuScene');
    }

    showComboPopup() {
        if (this.popupOpen) return;
        this.popupOpen = true;

        this.backBtn.disableInteractive();
        if (this.comboBtn) this.comboBtn.disableInteractive();

        const bg = this.add.rectangle(600, 300, 600, 380, 0x000000, 0.75)
            .setStrokeStyle(3, 0xffffff);

        const title = this.add.text(600, 140, t('HELP_COMBO_TITLE', 'Combo Rules'), {
            fontSize: '32px',
            color: '#ffff66'
        }).setOrigin(0.5);

        const comboRules = t(
            'HELP_COMBO_TEXT',
            'Certain dice combinations award bonus multipliers:\n\n' +
            '- Pair -> x1.5 score\n' +
            '- Two Pair -> x2 score\n' +
            '- Three of a Kind -> x3 score\n' +
            '- Full House -> x4 score\n' +
            '- Four of a Kind -> x5 score\n' +
            '- Five of a Kind -> x10 score\n' +
            '- Straights (1-5 or 2-6) -> x2.5 or x3 score\n\n' +
            'These bonuses stack with your base score (or multiplex score if enabled).'
        );

        const rulesText = this.add.text(600, 320, comboRules, {
            fontSize: '20px',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 520 }
        }).setOrigin(0.5);

        const closeBtn = this.add.text(600, 480, t('UI_CLOSE', 'Close'), {
            fontSize: 26,
            color: '#66aaff'
        })
        .setOrigin(0.5)
        .setInteractive();

        closeBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.closeComboPopup();
        });

        this.popupElements = { bg, title, rulesText, closeBtn };
    }

    closeComboPopup() {
        if (!this.popupOpen) return;
        if (this.popupElements) {
            const { bg, title, rulesText, closeBtn } = this.popupElements;
            if (bg) bg.destroy();
            if (title) title.destroy();
            if (rulesText) rulesText.destroy();
            if (closeBtn) closeBtn.destroy();
        }
        this.popupElements = null;
        this.popupOpen = false;
        this.backBtn.setInteractive();
        if (this.comboBtn) this.comboBtn.setInteractive();
    }
}
