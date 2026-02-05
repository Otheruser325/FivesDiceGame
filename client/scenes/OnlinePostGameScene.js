import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class OnlinePostGameScene extends Phaser.Scene {
    constructor() {
        super('OnlinePostGameScene');
        this.PIXEL_FONT = '"Press Start 2P", cursive';
        this._onEscKey = null;
        this._escExitArmed = false;
        this._exitModalActive = false;
        this._exitModal = null;
        this._t = (key, fallback) => GlobalLocalization.t(key, fallback);
    }

    create() {
        try {
            ErrorHandler.setScene(this);
        } catch (e) {}
        try {
            GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}

        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
        this._t = t;

        const stats = this.registry.get("onlinePostGame") || {};
        const names = Array.isArray(stats.names) ? stats.names : [t('GENERIC_PLAYER_1', 'Player 1'), t('GENERIC_PLAYER_2', 'Player 2')];
        const roles = Array.isArray(stats.roles) ? stats.roles : ["defence", "monster"];
        const scores = Array.isArray(stats.scores) ? stats.scores : [0, 0];
        const tokens = Number(stats.tokensEarned || 0);
        const waves = Number(stats.waves || 0);
        const finalWave = Number(stats.finalWave || 0);
        const mvpByPlayer = Array.isArray(stats.mvpByPlayer) ? stats.mvpByPlayer : [];

        const victoryPuns = [
            t('POSTGAME_PUN_VICTORY_1', "Dice-tacular!"),
            t('POSTGAME_PUN_VICTORY_2', "Winner winner!"),
            t('POSTGAME_PUN_VICTORY_3', "Rolling in victory!")
        ];
        const defeatPuns = [
            t('POSTGAME_PUN_DEFEAT_1', "Better luck next roll!"),
            t('POSTGAME_PUN_DEFEAT_2', "Pray to RNGesus!"),
            t('POSTGAME_PUN_DEFEAT_3', "Dicey loss!")
        ];
        const drawPuns = [
            t('POSTGAME_PUN_DRAW_1', "It's a tie!"),
            t('POSTGAME_PUN_DRAW_2', "Dice-asterous draw!"),
            t('POSTGAME_PUN_DRAW_3', "Balanced rolls!")
        ];

        const winnerIndex = Number.isFinite(stats.winnerIndex) ? stats.winnerIndex : (() => {
            if (scores[0] === scores[1]) return -1;
            return scores[0] > scores[1] ? 0 : 1;
        })();

        this.add.text(600, 50, t('POSTGAME_TITLE_ONLINE', "Online Game - Results"), {
            fontSize: 36,
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5);

        const formatMvpLine = (idx) => {
            const playerLabel = names[idx] || `P${idx + 1}`;
            const entry = mvpByPlayer[idx] || {};
            const unitName = entry.unitName || t('POSTGAME_NONE', 'None');
            const damage = Number(entry.damage || 0);
            return fmt('POSTGAME_MVP_LINE', '{0} MVP: {1} ({2} dmg)', playerLabel, unitName, damage);
        };
        const mvpText = `${formatMvpLine(0)}\n${formatMvpLine(1)}`;
        this.add.text(600, 120, mvpText, {
            fontSize: 16,
            color: "#ffffff",
            align: "center",
            fontFamily: this.PIXEL_FONT,
            wordWrap: { width: 1000, useAdvancedWrap: true }
        }).setOrigin(0.5);

        const summary = fmt('POSTGAME_SUMMARY', 'Waves: {0}/{1}    Tokens: {2}', finalWave, waves, tokens);
        this.add.text(600, 190, summary, {
            fontSize: 18,
            color: "#ffff88",
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5);

        const colX = [320, 880];
        const startY = 240;
        const blockW = 420;
        const blockH = 360;

        const winnerBuzz = victoryPuns[Math.floor(Math.random() * victoryPuns.length)];
        const loserBuzz = defeatPuns[Math.floor(Math.random() * defeatPuns.length)];
        const drawBuzz = drawPuns[Math.floor(Math.random() * drawPuns.length)];

        for (let i = 0; i < Math.min(names.length, 2); i++) {
            const isWinner = winnerIndex === i;
            const role = roles[i] || 'unknown';
            const score = Number(scores[i] || 0);
            const name = names[i] || `P${i + 1}`;
            const resultLabel = (winnerIndex < 0) ? t('POSTGAME_RESULT_DRAW', 'Draw!') : (isWinner ? t('POSTGAME_RESULT_VICTORY', 'Victory!') : t('POSTGAME_RESULT_DEFEAT', 'Defeat!'));
            const resultColor = (winnerIndex < 0) ? "#ffff66" : (isWinner ? "#66ff66" : "#ff6666");
            const buzzword = (winnerIndex < 0) ? drawBuzz : (isWinner ? winnerBuzz : loserBuzz);

            this.add.rectangle(colX[i], startY + blockH / 2, blockW, blockH, 0x000000, 0.35)
                .setStrokeStyle(2, isWinner ? 0xffff66 : 0x666666);

            this.add.text(colX[i], startY + 20, name, {
                fontSize: 24,
                color: isWinner ? "#ffff66" : "#ffffff",
                fontFamily: this.PIXEL_FONT
            }).setOrigin(0.5, 0);

            this.add.text(colX[i], startY + 50, resultLabel, {
                fontSize: 20,
                color: resultColor,
                fontFamily: this.PIXEL_FONT
            }).setOrigin(0.5, 0);

            this.add.text(colX[i], startY + 78, `"${buzzword}"`, {
                fontSize: 14,
                color: "#ffffff",
                fontStyle: "italic",
                fontFamily: this.PIXEL_FONT,
                wordWrap: { width: blockW - 30, useAdvancedWrap: true }
            }).setOrigin(0.5, 0);

            const roleLabel = role === 'defence' ? t('ROLE_DEFENCE', 'Defence') : (role === 'monster' ? t('ROLE_MONSTER', 'Monster') : t('ROLE_UNKNOWN', 'Unknown'));
            this.add.text(colX[i], startY + 120, fmt('POSTGAME_ROLE', 'Role: {0}', roleLabel), {
                fontSize: 18,
                color: "#cccccc",
                fontFamily: this.PIXEL_FONT
            }).setOrigin(0.5, 0);

            this.add.text(colX[i], startY + 160, fmt('POSTGAME_SCORE', 'Score: {0}', score), {
                fontSize: 20,
                color: "#ffffff",
                fontFamily: this.PIXEL_FONT
            }).setOrigin(0.5, 0);

            let extraLabel = t('POSTGAME_DEFEATED', 'Defeated');
            let extraValue = 0;
            if (role === 'defence') {
                extraLabel = t('POSTGAME_MONSTERS_DEFEATED', 'Monsters Defeated');
                extraValue = Number(stats.defeatedMonsters || 0);
            } else if (role === 'monster') {
                extraLabel = t('POSTGAME_DEFENCES_DESTROYED', 'Defences Destroyed');
                extraValue = Number(stats.destroyedDefences || 0);
            }

            this.add.text(colX[i], startY + 200, fmt('POSTGAME_EXTRA_LINE', '{0}: {1}', extraLabel, extraValue), {
                fontSize: 18,
                color: "#ffffff",
                fontFamily: this.PIXEL_FONT
            }).setOrigin(0.5, 0);
        }

        const back = this.add.text(600, 800, t('POSTGAME_RETURN', 'Return to Menu'), {
            fontSize: 26,
            color: "#ff6666",
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5).setInteractive();

        back.on("pointerdown", () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineMenuScene');
        });

        this._bindExitHotkey();

        this.events.once('shutdown', () => {
            if (this._onEscKey && this.input && this.input.keyboard) {
                this.input.keyboard.off('keydown-ESC', this._onEscKey, this);
            }
            this._onEscKey = null;
            this._escExitArmed = false;
            this._exitModalActive = false;
            this._exitModal = null;
        });
    }

    _bindExitHotkey() {
        if (!this.input || !this.input.keyboard) return;
        if (this._onEscKey) return;
        this._onEscKey = (event) => {
            if (event && event.repeat) return;
            if (this._escExitArmed) {
                this._escExitArmed = false;
                this._exitModalActive = false;
                this.scene.start('OnlineMenuScene');
                return;
            }
            this._escExitArmed = true;
            this.showConfirmExit();
        };
        this.input.keyboard.on('keydown-ESC', this._onEscKey, this);
    }

    showConfirmExit() {
        if (this._exitModalActive) return;
        this._exitModalActive = true;

        const bg = this.add.rectangle(600, 300, 500, 220, 0x000000, 0.8);
        const msg = this.add.text(600, 265, this._t('POSTGAME_EXIT_CONFIRM', 'Return to menu?'), {
            fontSize: 24,
            color: "#ffffff",
            align: "center",
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5);

        const yesBtn = this.add.text(540, 335, this._t('UI_YES', 'Yes'), {
            fontSize: 24,
            color: "#66ff66",
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5).setInteractive();

        const noBtn = this.add.text(660, 335, this._t('UI_NO', 'No'), {
            fontSize: 24,
            color: "#ff6666",
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5).setInteractive();

        yesBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this._escExitArmed = false;
            this._exitModalActive = false;
            this.scene.start('OnlineMenuScene');
        });

        noBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            bg.destroy();
            msg.destroy();
            yesBtn.destroy();
            noBtn.destroy();
            this._escExitArmed = false;
            this._exitModalActive = false;
        });

        this._exitModal = { bg, msg, yesBtn, noBtn };
    }
}
