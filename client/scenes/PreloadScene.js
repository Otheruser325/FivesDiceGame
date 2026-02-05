import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalFonts from '../utils/FontManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DefenceFactory from '../utils/factories/DefenceFactory.js';
import MonsterFactory from '../utils/factories/MonsterFactory.js';
import PuddleFactory from '../utils/factories/PuddleFactory.js';

export default class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    _delay(ms) {
      return new Promise(res => setTimeout(res, ms));
    }

    preload() {
        try {
          ErrorHandler.setScene(this);
        } catch (e) {}
	    try {
          GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}

        // Splash screen display
        this.cameras.main.setBackgroundColor('#000000');

        const fontDefs = [
          { family: 'Press Start 2P', url: 'assets/fonts/PressStart2P.ttf', weight: '400' },
          { family: 'game_over', url: 'assets/fonts/game_over.ttf', weight: '400' }
        ];
        this._fontPromise = GlobalFonts.init(fontDefs, { timeout: 2000 }).catch(err => {
          console.warn('GlobalFonts.init failed (continuing):', err);
        });

        const titleStyle = { fontSize: '64px', color: '#ffffff', fontFamily: '"Press Start 2P", cursive' };
        const loadingStyle = { fontSize: '20px', color: '#000000', fontFamily: '"Press Start 2P", cursive' };

        this.titleText = this.add.text(600, 100, 'PROTODICE', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '48px',
            color: '#ffffff'
        }).setOrigin(0.5).setAlpha(0);

        this.loadingText = this.add.text(600, 300, GlobalLocalization.t('PRELOAD_LOADING', 'Loading...'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '20px',
            color: '#ffffff'
        }).setOrigin(0.5).setAlpha(0);

        const barX = 600 - 150;
        const barY = 350;
        const barW = 300;
        const barH = 30;

        // Add a progress bar
        const progressBarBg = this.add.rectangle(600, barY, barW, barH, 0x444444).setOrigin(0.5);
        const progressBarFill = this.add.rectangle(barX, barY, 0, barH, 0xFFEE55).setOrigin(0, 0.5);
        this.loadingPercent = this.add.text(600, barY, '0%', loadingStyle).setOrigin(0.5).setAlpha(0);

        const revealPreloadText = () => {
          try {
            this.titleText?.setAlpha(1);
            this.loadingText?.setAlpha(1);
            this.loadingPercent?.setAlpha(1);
          } catch (e) {}
        };

        this._fontPromise?.then(() => {
          try {
            const style = { fontFamily: '"Press Start 2P", cursive' };
            if (this.titleText && this.titleText.setStyle) this.titleText.setStyle(style);
            if (this.loadingText && this.loadingText.setStyle) this.loadingText.setStyle(style);
            if (this.loadingPercent && this.loadingPercent.setStyle) this.loadingPercent.setStyle(style);
          } catch (e) {}
        }).finally(() => {
          revealPreloadText();
        });

        this.load.on('progress', (value) => {
            progressBarFill.width = Math.max(2, Math.round(barW * value));
            this.loadingPercent.setText(`${Math.round(value * 100)}%`);
        });

        this.load.on('complete', async () => {
        try {
          const waitMs = 1000;
          await Promise.race([
            this._fontPromise || Promise.resolve(),
            this._delay(waitMs)
          ]);
        } catch (e) {
          console.warn('Font wait race error (continuing):', e);
        }

        try {
            const style = { fontFamily: '"Press Start 2P", cursive' };
            if (this.titleText && this.titleText.setStyle) this.titleText.setStyle(style);
            if (this.loadingText && this.loadingText.setStyle) this.loadingText.setStyle(style);
            if (this.loadingPercent && this.loadingPercent.setStyle) this.loadingPercent.setStyle(style);
         } catch (e) {}
        this.tweens.add({
            targets: [this.progressBarBg, this.progressBarFill, this.loadingPercent, this.loadingText, this.titleText],
            alpha: 0,
            duration: 400,
            onComplete: () => {
              this.time.delayedCall(150, () => this.scene.start('MenuScene'));
            }
          });
        });

        // Load all assets
        // Localization XMLs
        this.load.xml('loc:English', 'config/locs/English.xml');
        this.load.xml('loc:French', 'config/locs/French.xml');
        this.load.xml('loc:Spanish', 'config/locs/Spanish.xml');
        this.load.xml('loc:Italian', 'config/locs/Italian.xml');
        this.load.xml('loc:Portuguese', 'config/locs/Portuguese.xml');
        this.load.xml('loc:Welsh', 'config/locs/Welsh.xml');

        // Music tracks
        this.load.audio('basilisk_theme', 'assets/music/basilisk_theme.mp3');
        this.load.audio('dice_league', 'assets/music/dice_league.mp3');
        this.load.audio('powerhouse', 'assets/music/powerhouse.mp3');

        // Generic sounds
        this.load.audio('button', 'assets/audio/button.mp3');
        this.load.audio('dice', 'assets/audio/dice.mp3');
        this.load.audio('reload_complete', 'assets/audio/reload_complete.mp3');
        this.load.audio('combo_pair', 'assets/audio/combo_pair.mp3');
        this.load.audio('combo_triple', 'assets/audio/combo_triple.mp3');
        this.load.audio('combo_fullHouse', 'assets/audio/combo_fullHouse.mp3');
        this.load.audio('combo_fourOfAKind', 'assets/audio/combo_fourOfAKind.mp3');
        this.load.audio('combo_fiveOfAKind', 'assets/audio/combo_fiveOfAKind.mp3');
        this.load.audio('combo_straight', 'assets/audio/combo_straight.mp3');
		
		    // Death sounds for units
        this.load.audio('unit_death', 'assets/audio/unit_death.mp3');
        this.load.audio('monster_death', 'assets/audio/monster_death.mp3');
        this.load.audio('defence_death', 'assets/audio/defence_death.mp3');
        
        // Special effect sounds
        this.load.audio('explosion', 'assets/audio/explosion.mp3');
        this.load.audio('laser', 'assets/audio/laser.mp3');
        this.load.audio('shield_break', 'assets/audio/shield_break.mp3');
        this.load.audio('revive', 'assets/audio/revive.mp3');
        this.load.audio('summon', 'assets/audio/summon.mp3');

        // VFX sprites
        this.load.image('radioactive_waste', 'assets/sprites/vfx/radioactive_waste.png');
        this.load.image('shield', 'assets/sprites/vfx/shield.png');
        this.load.image('shield_break', 'assets/sprites/vfx/shield_break.png');
        this.load.image('shield_burst', 'assets/sprites/vfx/shield_burst.png');

        this.load.json('changelog', 'config/changelog.json');

        this.load.image('bg', 'assets/bg/bg_neon.png');

        this.load.image('dice1', 'assets/dice/dice-six-faces-one.png');
        this.load.image('dice2', 'assets/dice/dice-six-faces-two.png');
        this.load.image('dice3', 'assets/dice/dice-six-faces-three.png');
        this.load.image('dice4', 'assets/dice/dice-six-faces-four.png');
        this.load.image('dice5', 'assets/dice/dice-six-faces-five.png');
        this.load.image('dice6', 'assets/dice/dice-six-faces-six.png');

        this.load.image('settingsIcon', 'assets/ui/settings.png');
        this.load.image('achievementIcon', 'assets/ui/achievement.png');
        this.load.image('helpIcon', 'assets/ui/help.png');
        this.load.image('changelogIcon', 'assets/ui/changelog.png');
        this.load.image('playerIcon', 'assets/ui/player.png');
        this.load.image('botIcon', 'assets/ui/robot.png');

        // Load defence definitions
        const defenceFiles = ['AcidShooter', 'Ballista', 'Barricade', 'BoomCannon', 'Cannon', 'CryoFan', 'DamageAmplifier', 'DestroyTower', 'Flamethrower', 'ForceField', 'Landmine', 'LazorBeam', 'MachineGun', 'MicroSentry', 'Microwavr', 'Mortar', 'Multishot', 'RadialLauncher', 'RocketLauncher', 'ShockBlaster', 'ShockLauncher', 'Shredder', 'SIMO', 'SniperTower'];
        defenceFiles.forEach(f => this.load.json(f + 'Defence', 'assets/gamedata/DefenceDefinitions/' + f + '.defence'));

        // Load monster definitions
        const monsterFiles = ['Archer', 'Bat', 'Bomber', 'Catapult', 'Cupid', 'Demon', 'ElectroMage', 'FireImp', 'Ghost', 'Goblin', 'Golem', 'Harpy', 'IceLizard', 'Knight', 'Mech', 'Necromancer', 'PoisonWard', 'Orc', 'Skeleton', 'Surgeon', 'Tank', 'Thrower', 'Troll', 'Zombie'];
        monsterFiles.forEach(f => this.load.json(f + 'Monster', 'assets/gamedata/MonsterDefinitions/' + f + '.monster'));

        // Load defence sprites
        defenceFiles.forEach(f => this.load.image(f.toLowerCase(), 'assets/sprites/defences/' + f.toLowerCase() + '.png'));

        // Load monster sprites
        monsterFiles.forEach(f => this.load.image(f.toLowerCase(), 'assets/sprites/monsters/' + f.toLowerCase() + '.png'));
    }

    async create() {
        const saved = JSON.parse(localStorage.getItem('protodice_settings')) || {};

        const defaults = {
            audio: true,
            music: true,
            visualEffects: true,
            shuffleTrack: false,
            trackIndex: 0,
            language: 'English'
        };

        // Merge saved overrides
        const finalSettings = { ...defaults, ...saved };

        // Store in registry
        this.registry.set('settings', finalSettings);
        try {
            GlobalLocalization.init(this);
            GlobalLocalization.setLanguage(this, finalSettings.language || 'English');
        } catch (e) {}

        // Set factory data
        const defenceFiles = ['AcidShooter', 'Ballista', 'Barricade', 'BoomCannon', 'Cannon', 'CryoFan', 'DamageAmplifier', 'DestroyTower', 'Flamethrower', 'ForceField', 'Landmine', 'LazorBeam', 'MachineGun', 'MicroSentry', 'Microwavr', 'Mortar', 'Multishot', 'RadialLauncher', 'RocketLauncher', 'ShockBlaster', 'ShockLauncher', 'Shredder', 'SIMO', 'SniperTower'];
        DefenceFactory.defenceData = {};
        defenceFiles.forEach(f => {
            const data = this.cache.json.get(f + 'Defence');
            DefenceFactory.validateData(data);
            DefenceFactory.defenceData[f] = data;
        });

        const monsterFiles = ['Archer', 'Bat', 'Bomber', 'Catapult', 'Cupid', 'Demon', 'ElectroMage', 'FireImp', 'Ghost', 'Goblin', 'Golem', 'Harpy', 'IceLizard', 'Knight', 'Mech', 'Necromancer', 'PoisonWard', 'Orc', 'Skeleton', 'Surgeon', 'Tank', 'Thrower', 'Troll', 'Zombie'];
        MonsterFactory.monsterData = {};
        monsterFiles.forEach(f => {
            const data = this.cache.json.get(f + 'Monster');
            MonsterFactory.validateData(data);
            MonsterFactory.monsterData[f] = data;
        });

        try {
            await PuddleFactory.loadData();
        } catch (e) {}

        this.time.delayedCall(1000, () => {
            this.scene.start('MenuScene');
        });
    }
}
