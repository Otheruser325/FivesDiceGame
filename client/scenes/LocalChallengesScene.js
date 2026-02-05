import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ChallengeManager from '../utils/ChallengeManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class LocalChallengesScene extends Phaser.Scene {
  constructor() { super('LocalChallengesScene'); }

  create() {
    try {
      GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
    } catch (e) {}

    const cx = this.cameras.main.centerX;
    const titleFont = '"Press Start 2P", cursive';
    const t = (key, fallback) => GlobalLocalization.t(key, fallback);
    const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
    this.add.text(cx, 80, t('CHALLENGES_TITLE', 'CHALLENGES'), { fontSize: 32, fontFamily: titleFont }).setOrigin(0.5);

    const configSnapshot = ChallengeManager.getConfigSnapshot();
    const dailyDateKey = ChallengeManager.getTodayKey();

    const monsterOpponents = [
      {
        name: t('OPP_GOBLIN_HORDE', 'Goblin Horde'),
        normalLoadout: ['Goblin', 'Skeleton', 'Zombie', 'Bat', 'FireImp'],
        protoLoadout: ['Golem', 'Harpy', 'Necromancer', 'Demon', 'ElectroMage']
      },
      {
        name: t('OPP_SIEGE_CHOIR', 'Siege Choir'),
        normalLoadout: ['Archer', 'Bomber', 'Thrower', 'Orc', 'Troll'],
        protoLoadout: ['Catapult', 'Cupid', 'Mech', 'Tank', 'PoisonWard']
      },
      {
        name: t('OPP_SPECTRAL_SWARM', 'Spectral Swarm'),
        normalLoadout: ['Ghost', 'Bat', 'Skeleton', 'Zombie', 'Goblin'],
        protoLoadout: ['Necromancer', 'Demon', 'ElectroMage', 'Harpy', 'IceLizard']
      },
      {
        name: t('OPP_BRUISER_PACK', 'Bruiser Pack'),
        normalLoadout: ['Orc', 'Troll', 'Knight', 'FireImp', 'Thrower'],
        protoLoadout: ['Tank', 'Golem', 'Mech', 'Demon', 'PoisonWard']
      }
    ];

    const defenceOpponents = [
      {
        name: t('OPP_IRON_WALL', 'Iron Wall'),
        normalLoadout: ['Barricade', 'Cannon', 'MachineGun', 'Mortar', 'SniperTower'],
        protoLoadout: ['ForceField', 'BoomCannon', 'ShockBlaster', 'LazorBeam', 'Microwavr']
      },
      {
        name: t('OPP_STORM_BATTERY', 'Storm Battery'),
        normalLoadout: ['RocketLauncher', 'ShockLauncher', 'Multishot', 'Ballista', 'MicroSentry'],
        protoLoadout: ['CryoFan', 'DamageAmplifier', 'AcidShooter', 'RadialLauncher', 'Shredder']
      },
      {
        name: t('OPP_CONTROL_GRID', 'Control Grid'),
        normalLoadout: ['Landmine', 'SniperTower', 'Mortar', 'MachineGun', 'Ballista'],
        protoLoadout: ['ForceField', 'ShockBlaster', 'LazorBeam', 'DamageAmplifier', 'CryoFan']
      }
    ];

    const deuciferLoadout = {
      normalLoadout: ['Orc', 'Bomber', 'Knight', 'FireImp', 'Thrower'],
      protoLoadout: ['Demon', 'ElectroMage', 'Tank', 'Necromancer', 'PoisonWard']
    };

    const buildDailyConfig = () => {
      const random = ChallengeManager.getSeededRandom(dailyDateKey);
      const difficultyOptions = [
        t('DIFFICULTY_EASY', 'Easy'),
        t('DIFFICULTY_MEDIUM', 'Medium'),
        t('DIFFICULTY_HARD', 'Hard')
      ];
      const waves = Math.floor(random() * 21) + 20;
      const aiDifficulty = difficultyOptions[Math.floor(random() * difficultyOptions.length)];
      const switchSides = !!configSnapshot.switchSides;
      const opponentPool = switchSides ? defenceOpponents : monsterOpponents;
      const opponent = opponentPool[Math.floor(random() * opponentPool.length)];
      const opponentName = opponent?.name || t('OPP_DEFAULT', 'Opponent');
      const playerPresetChance = 0.3;
      const playerPresetPool = switchSides ? monsterOpponents : defenceOpponents;
      const usePlayerPreset = playerPresetPool.length > 0 && random() < playerPresetChance;
      const playerPreset = usePlayerPreset
        ? playerPresetPool[Math.floor(random() * playerPresetPool.length)]
        : null;
      const playerPresetName = playerPreset?.name || null;

      const challengeLoadouts = {
        1: {
          normalLoadout: opponent?.normalLoadout || [],
          protoLoadout: opponent?.protoLoadout || []
        }
      };

      if (playerPreset) {
        challengeLoadouts[0] = {
          normalLoadout: playerPreset.normalLoadout || [],
          protoLoadout: playerPreset.protoLoadout || []
        };
      }

      return {
        title: t('CHALLENGE_DAILY_TITLE', 'Daily Challenge'),
        desc: fmt('CHALLENGE_DAILY_DESC', dailyDateKey, playerPresetName ? ` ${fmt('CHALLENGE_PRESET', playerPresetName)}` : ''),
        challengeKey: 'daily',
        challengeDate: dailyDateKey,
        challengeReward: ChallengeManager.getReward('daily'),
        players: 2,
        waves,
        names: [t('CHALLENGE_PLAYER', 'Player'), opponentName],
        ai: [false, true],
        difficulty: [t('DIFFICULTY_MEDIUM', 'Medium'), aiDifficulty],
        teamsEnabled: false,
        teams: ['blue', 'red'],
        switchSides,
        diceCount: configSnapshot.diceCount,
        boardRows: configSnapshot.boardRows,
        boardCols: configSnapshot.boardCols,
        challengeLoadouts
      };
    };

    const buildDeuciferConfig = () => {
      return {
        title: t('CHALLENGE_DEUCIFER_TITLE', "Deucifier's Pit"),
        desc: t('CHALLENGE_DEUCIFER_DESC', '50-wave survival nightmare against Deucifer.'),
        challengeKey: 'deucifer',
        challengeReward: ChallengeManager.getReward('deucifer'),
        players: 2,
        waves: 50,
        names: [t('CHALLENGE_PLAYER', 'Player'), t('CHALLENGE_DEUCIFER_NAME', 'Deucifer')],
        ai: [false, true],
        difficulty: [t('DIFFICULTY_MEDIUM', 'Medium'), t('DIFFICULTY_NIGHTMARE', 'Nightmare')],
        teamsEnabled: false,
        teams: ['blue', 'red'],
        switchSides: false,
        diceCount: configSnapshot.diceCount,
        boardRows: configSnapshot.boardRows,
        boardCols: configSnapshot.boardCols,
        challengeLoadouts: {
          1: {
            normalLoadout: deuciferLoadout.normalLoadout,
            protoLoadout: deuciferLoadout.protoLoadout
          }
        }
      };
    };

    const getStatusStyle = (status) => {
      switch (status) {
        case ChallengeManager.STATUSES.COMPLETE:
          return { label: t('CHALLENGE_COMPLETE', 'COMPLETE'), color: '#66ff66', fill: 0x002200, stroke: 0x00aa00, hover: 0x003300 };
        case ChallengeManager.STATUSES.FAIL:
          return { label: t('CHALLENGE_FAILED', 'FAILED'), color: '#ff6666', fill: 0x220000, stroke: 0xaa0000, hover: 0x330000 };
        default:
          return { label: t('CHALLENGE_NOT_READY', 'NOT READY'), color: '#aaaaaa', fill: 0x222222, stroke: 0x444444, hover: 0x2b2b2b };
      }
    };

    const drawStatusIcon = (x, y, status) => {
      const g = this.add.graphics();
      if (status === ChallengeManager.STATUSES.COMPLETE) {
        g.lineStyle(4, 0x66ff66, 1);
        g.beginPath();
        g.moveTo(x - 10, y + 2);
        g.lineTo(x - 2, y + 10);
        g.lineTo(x + 12, y - 8);
        g.strokePath();
      } else if (status === ChallengeManager.STATUSES.FAIL) {
        g.lineStyle(4, 0xff6666, 1);
        g.beginPath();
        g.moveTo(x - 8, y - 8);
        g.lineTo(x + 8, y + 8);
        g.moveTo(x + 8, y - 8);
        g.lineTo(x - 8, y + 8);
        g.strokePath();
      } else {
        g.lineStyle(3, 0x777777, 1);
        g.strokeCircle(x, y, 8);
      }
      return g;
    };

    const makeChallengeBtn = (y, config, enabled) => {
      const challengeKey = config?.challengeKey || null;
      const showStatus = !!challengeKey;
      const status = showStatus
        ? ChallengeManager.getStatus(challengeKey, { dateKey: config?.challengeDate })
        : ChallengeManager.STATUSES.NOT_READY;
      const statusStyle = getStatusStyle(status);
      const fillColor = enabled ? statusStyle.fill : 0x111111;
      const strokeColor = enabled ? statusStyle.stroke : 0x333333;

      const bg = this.add.rectangle(cx, y, 640, 90, fillColor)
        .setStrokeStyle(2, strokeColor)
        .setOrigin(0.5);

      const reward = Number(config?.challengeReward || 0);
      const rewardSuffix = reward > 0 ? fmt('CHALLENGE_REWARD', reward) : '';
      const titleTxt = this.add.text(cx, y - 18, config?.title || t('CHALLENGE_GENERIC', 'Challenge'), {
        fontSize: 20,
        fontFamily: titleFont,
        color: enabled ? '#ffffff' : '#666666'
      }).setOrigin(0.5);

      const descTxt = this.add.text(cx, y + 12, `${config?.desc || ''}${rewardSuffix}`, {
        fontSize: 14,
        fontFamily: titleFont,
        color: enabled ? '#cccccc' : '#555555',
        align: 'center',
        wordWrap: { width: 600 }
      }).setOrigin(0.5);

      let statusTxt = null;
      if (showStatus) {
        statusTxt = this.add.text(cx + 290, y - 18, statusStyle.label, {
          fontSize: 12,
          fontFamily: titleFont,
          color: enabled ? statusStyle.color : '#666666'
        }).setOrigin(1, 0.5);
        drawStatusIcon(cx - 290, y - 16, status);
      }

      if (enabled) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => {
          bg.setFillStyle(statusStyle.hover);
          titleTxt.setScale(1.02);
          descTxt.setScale(1.02);
        });
        bg.on('pointerout', () => {
          bg.setFillStyle(statusStyle.fill);
          titleTxt.setScale(1.0);
          descTxt.setScale(1.0);
        });
        bg.on('pointerdown', () => {
          GlobalAudio.playButton(this);
          this.registry.set('challengeConfig', config);
          this.scene.start('LocalChallengeConfigScene');
        });
      }

      return { bg, titleTxt, descTxt, statusTxt };
    };

    makeChallengeBtn(180, buildDailyConfig(), true);
    makeChallengeBtn(300, buildDeuciferConfig(), true);
    makeChallengeBtn(420, { title: t('CHALLENGE_COMING_SOON', 'Coming Soon...'), desc: t('CHALLENGE_COMING_SOON_DESC', 'More challenges coming in future updates.') }, false);

    this.backBtn = this.add.text(cx, 560, t('UI_BACK', '<- BACK'), {
      fontSize: 20,
      fontFamily: titleFont,
      color: '#ff6666'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    this.backBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.scene.start('LocalMenuScene');
    });
    this.input.keyboard.on('keydown-ESC', () => {
      GlobalAudio.playButton(this);
      this.scene.start('LocalMenuScene');
    });
  }
}
