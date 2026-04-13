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

        this.add.text(600, 70, t('HELP_TITLE', 'Help'), {
            fontSize: '52px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(600, 130, t('HELP_SUBTITLE', 'How to Play Fives'), {
            fontSize: '32px',
            color: '#ffff66'
        }).setOrigin(0.5);

        const helpText = t(
            'HELP_TEXT_V13',
            'Fives is a simple but strategic dice game.\n\n' +
            '- You and your opponent each roll five dice per round.\n' +
            '- Games can be 5-30 rounds (default: 20 rounds).\n' +
            '- Classic is the standard table with straight Fives totals.\n' +
            '- Combanity is the successor to Combo Rules and pays out on special patterns.\n' +
            '- Multiplex multiplies the dice instead of adding them for bigger swings.\n' +
            '- Teams can be used in all three gamemodes if you want side-based play.\n' +
            '- Diceathon is planned as the official online event system, with special tables appearing there over time.\n' +
            '- Hotkeys: Space/R rolls, T ends your turn (your turn only).\n\n' +
            'The highest total at the end wins the table.'
        );

        this.add.text(600, 390, helpText, {
            fontSize: '22px',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 700 }
        }).setOrigin(0.5);

        this.backBtn = this.add.text(600, 680, t('UI_BACK', '<- Back'), {
            fontSize: 28,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();

        this.backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });

        if (this.input && this.input.keyboard) {
            this._escHandler = (event) => {
                if (event.repeat) return;
                GlobalAudio.playButton(this);
                this.scene.start('MenuScene');
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
}
