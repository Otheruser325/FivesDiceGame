import AlertManager from '../utils/AlertManager.js';
import { animateDiceRoll } from '../utils/AnimationManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ChallengeManager from '../utils/ChallengeManager.js';
import { DEBUG_MODE } from '../utils/DebugManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import { formatCompact } from '../utils/FormatManager.js';
import GlobalSettings from '../utils/SettingsManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import StatusEffectVisuals from '../utils/StatusEffectVisuals.js';
import BoardFactory from '../utils/factories/BoardFactory.js';
import CombatFactory from '../utils/factories/CombatFactory.js';
import DefenceFactory from '../utils/factories/DefenceFactory.js';
import MonsterFactory from '../utils/factories/MonsterFactory.js';
import PuddleFactory from '../utils/factories/PuddleFactory.js';
import StatusEffectFactory from '../utils/factories/StatusEffectFactory.js';
import SpecialEffectFactory from '../utils/factories/SpecialEffectFactory.js';

export default class LocalGameScene extends Phaser.Scene {
    constructor(sceneKey = 'LocalGameScene') {
        super(sceneKey);

        this.grid = [];
        this.players = [];
        this.currentPlayer = 0;
        this.currentWave = 1;
        this.waves = 20;
        this.switchSides = false;
        this.diceCount = 1;
        this.holders = [];
        this.diceValues = [];
        this._diceRolling = false;
        this.prototypeDiceIndices = [];
        this.rolledThisTurn = false;
        this._combatInProgress = false;
        this.units = [];
        this.totalPlayers = 2;
        this.playerBar = [];
        this.playerTints = [0x66aaff, 0xff6666];
        this.teamTints = {
            blue: 0x66aaff,
            red: 0xff6666
        };
        this.teamsEnabled = false;
        this.playerTeams = ['blue', 'red'];
        this.scores = [0, 0];
        this.exitLocked = true;
        this.defeatedMonsters = 0;
        this.destroyedDefences = 0;
        this.forceFields = {};
        this.puddles = [];
        this._onPointerMoveHandler = null;
        this._onPointerUpHandler = null;
        this._manualDragInstalled = false;
        this._draggingHolder = null;
        this.boardRows = 5;
        this.boardCols = 9;
        this._historyLog = [];
        this._historyLogMax = 200;
        this._historyLogVisible = false;
        this._historyLogContainer = null;
        this._historyLogText = null;
        this._historyLogButton = null;
        this._onHistoryLogKey = null;
        this._onEscKey = null;
        this._escExitArmed = false;
        this._exitModalActive = false;
        this._exitModal = null;
        this.PIXEL_FONT = '"Press Start 2P", cursive';
        this._challengeKey = null;
        this._challengeDateKey = null;
        this._challengeReward = 0;
        this._challengeLoadouts = null;
        this._matchId = null;
        this._t = (key, fallback) => GlobalLocalization.t(key, fallback);
        this._fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
    }

    init(data) {
        this.diceSprites = [];
        this.waves = data.waves;
        this.switchSides = data.switchSides;
        this.diceCount = data.diceCount || 1;
        this.names = data.names;
        this.ai = data.ai;
        this.isAI = data.ai || this.isAI;
        if (Array.isArray(data.difficulty)) {
            this.difficulty = data.difficulty[1]?.toLowerCase() || 'medium';
        } else {
            this.difficulty = (data.difficulty || 'medium').toLowerCase();
        }
        this.playerNames = data.names || this.playerNames;
        this._damageByUnit = {};
        this._damageIdCounter = 1;
        this._challengeKey = data.challengeKey || null;
        this._challengeDateKey = data.challengeDate || null;
        this._challengeReward = Number(data.challengeReward || 0);
        this._challengeLoadouts = data.challengeLoadouts || null;
        this._matchId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

        const allowedRows = [5, 6, 7];
        const allowedCols = [7, 9, 11, 13, 15];
        const requestedRows = Number(data.boardRows ?? data.rows ?? this.boardRows);
        const requestedCols = Number(data.boardCols ?? data.cols ?? this.boardCols);
        this.boardRows = allowedRows.includes(requestedRows) ? requestedRows : this.boardRows;
        this.boardCols = allowedCols.includes(requestedCols) ? requestedCols : this.boardCols;

        // Load loadouts
        this.defenceNormalLoadout = JSON.parse(localStorage.getItem('defenceNormalLoadout')) || [
            'SniperTower', 'Cannon', 'Mortar', 'MachineGun', 'Flamethrower'
        ];
        this.defenceProtoLoadout = JSON.parse(localStorage.getItem('defenceProtoLoadout')) || [
            'BoomCannon', 'LazorBeam', 'ShockBlaster', 'AcidShooter', 'Microwavr'
        ];
        this.monsterNormalLoadout = JSON.parse(localStorage.getItem('monsterNormalLoadout')) || [
            'Goblin', 'Orc', 'Troll', 'Bat', 'FireImp'
        ];
        this.monsterProtoLoadout = JSON.parse(localStorage.getItem('monsterProtoLoadout')) || [
            'Golem', 'Harpy', 'IceLizard', 'Demon', 'ElectroMage'
        ];

        // Set player roles
        this.players = [{
                name: this.names[0],
                isAI: this.ai[0],
                role: this.switchSides ? 'monster' : 'defence',
                normalLoadout: this.switchSides ? this.monsterNormalLoadout : this.defenceNormalLoadout,
                protoLoadout: this.switchSides ? this.monsterProtoLoadout : this.defenceProtoLoadout
            },
            {
                name: this.names[1],
                isAI: this.ai[1],
                role: this.switchSides ? 'defence' : 'monster',
                normalLoadout: this.switchSides ? this.defenceNormalLoadout : this.monsterNormalLoadout,
                protoLoadout: this.switchSides ? this.defenceProtoLoadout : this.monsterProtoLoadout
            }
        ];

        const getChallengeLoadoutForIndex = (idx) => {
            if (!this._challengeLoadouts) return null;
            if (Array.isArray(this._challengeLoadouts)) return this._challengeLoadouts[idx] || null;
            return this._challengeLoadouts[idx] || this._challengeLoadouts[String(idx)] || null;
        };

        for (let i = 0; i < this.players.length; i++) {
            const override = getChallengeLoadoutForIndex(i);
            if (!override) continue;
            if (Array.isArray(override.normalLoadout) && override.normalLoadout.length > 0) {
                this.players[i].normalLoadout = override.normalLoadout.slice(0, 5);
            }
            if (Array.isArray(override.protoLoadout) && override.protoLoadout.length > 0) {
                this.players[i].protoLoadout = override.protoLoadout.slice(0, 5);
            }
        }

        const buildRandomLoadout = (isDefence, isProto) => {
            const pool = isDefence
                ? (isProto ? DefenceFactory.getProtos() : DefenceFactory.getNormals())
                : (isProto ? MonsterFactory.getProtos() : MonsterFactory.getNormals());
            const names = (pool || []).map(u => u?.TypeName).filter(Boolean);
            if (names.length < 5) return null;
            const shuffled = names.slice().sort(() => Math.random() - 0.5);
            return shuffled.slice(0, 5);
        };

        // AI uses random lineups for unpredictability
        this.players.forEach((p, idx) => {
            if (!p || !p.isAI) return;
            if (getChallengeLoadoutForIndex(idx)) return;
            const isDefence = p.role === 'defence';
            const randNormal = buildRandomLoadout(isDefence, false);
            const randProto = buildRandomLoadout(isDefence, true);
            if (randNormal) p.normalLoadout = randNormal;
            if (randProto) p.protoLoadout = randProto;
        });

        this.playerSlots = [{
                id: 0,
                name: this.names[0],
                avatar: this.ai[0] ? 'botIcon' : 'playerIcon',
                connected: true,
                team: this.players[0].role === 'defence' ? 'blue' : 'red'
            },
            {
                id: 1,
                name: this.names[1],
                avatar: this.ai[1] ? 'botIcon' : 'playerIcon',
                connected: true,
                team: this.players[1].role === 'defence' ? 'blue' : 'red'
            }
        ];
    }

    // Return tile center coordinates for a cell
    getTileXY(row, col) {
        const x = 300 + col * 60;
        const y = 150 + row * 60;
        return {
            x,
            y
        };
    }

    // Helper to get sprite key for a unit type
    _getUnitSpriteKey(typeName, isDefence) {
        if (!typeName) return null;
        const factory = isDefence ? DefenceFactory : MonsterFactory;
        const data = factory?.getData?.(typeName) || factory?.defenceData?.[typeName] || factory?.monsterData?.[typeName];
        return data?.displaySprite || data?.DisplaySprite || null;
    }

    _formatUnitTooltip(unit) {
        if (!unit) return '';

        try {
            const t = this._t || ((key, fallback) => GlobalLocalization.t(key, fallback));
            const fmt = this._fmt || ((key, ...args) => GlobalLocalization.format(key, ...args));
            const name = unit.fullName || unit.typeName || t('GENERIC_UNKNOWN', 'Unknown');
            const lines = [name];

            const showLifespan = (unit?.HasLifespan === true) || (unit?.hasLifespan === true) ||
                (Number.isFinite(unit?.Lifespan) && unit.Lifespan > 0) ||
                (Number.isFinite(unit?.lifespan) && unit.lifespan > 0);

            if (showLifespan) {
                const remaining = (typeof unit._lifespan === 'number') ? unit._lifespan :
                    (Number.isFinite(unit.lifespan) ? Number(unit.lifespan) :
                        (Number.isFinite(unit.Lifespan) ? Number(unit.Lifespan) : null));

                if (remaining !== null) {
                    const turnLabel = remaining === 1 ? t('TOOLTIP_TURN', 'turn') : t('TOOLTIP_TURNS', 'turns');
                    lines.push(fmt('TOOLTIP_LIFESPAN_LINE', 'Lifespan: {0} {1}', remaining, turnLabel));
                } else {
                    lines.push(fmt('TOOLTIP_LIFESPAN_VALUE', 'Lifespan: {0}', unit.lifespan ?? unit.Lifespan ?? t('UI_NA', 'N/A')));
                }
            }

            // HP (always shown)
            const hpCur = (typeof unit.currentHealth === 'number') ? Math.max(0, Math.round(unit.currentHealth)) : 0;
            const hpMax = (typeof unit.health === 'number') ? unit.health : 0;
            lines.push(fmt('TOOLTIP_HP', 'HP: {0} / {1}', formatCompact(hpCur), formatCompact(hpMax)));

            // DontAttack: show minimal UI and DO NOT display Special Effects
            const isNoAttack = !!unit?.dontAttack || !!unit?.DontAttack;

            if (isNoAttack) {
                lines.push(t('TOOLTIP_CANT_ATTACK', "Can't Attack"));
            }

            // Damage / Ammo / Range / Reload (only if unit can attack)
            if (!isNoAttack) {
                if (unit.damage !== undefined && unit.damage !== null) {
                    const multi = unit._damageMultiplier || 1;
                    const finalDmg = unit.damage * multi;
                    let line = fmt('TOOLTIP_DAMAGE', 'Damage: {0}', formatCompact(finalDmg));
                    if (multi !== 1) line += ` (${fmt('TOOLTIP_MULTIPLIER', 'x{0}', multi.toFixed(2))})`;
                    lines.push(line);
                }

                if (unit.currentAmmo !== undefined && unit.currentAmmo !== null) {
                    if (unit.ammo !== undefined && unit.ammo !== null) {
                        lines.push(fmt('TOOLTIP_AMMO', 'Ammo: {0} / {1}', formatCompact(unit.currentAmmo), formatCompact(unit.ammo)));
                    } else {
                        lines.push(fmt('TOOLTIP_AMMO_SINGLE', 'Ammo: {0}', formatCompact(unit.currentAmmo)));
                    }
                }

                if (unit.range !== undefined && unit.range !== null) {
                    lines.push(fmt('TOOLTIP_RANGE', 'Range: {0}', formatCompact(unit.range)));
                }

                if (unit.reloadDelay !== undefined && unit.reloadDelay !== null) {
                    const reloadStatus = (unit.reloadTimer > 0)
                        ? fmt('TOOLTIP_RELOADING', 'Reloading ({0} turns)', unit.reloadTimer)
                        : t('TOOLTIP_READY', 'Ready');
                    lines.push(fmt('TOOLTIP_RELOAD', 'Reload: {0}', reloadStatus));
                }
            }

            // Trait flags / special mechanics
            const traits = [];
            if (unit.canDetect || unit.CanDetect) traits.push(t('TRAIT_CAN_DETECT', 'Can Detect Undetectable'));
            if (unit.startsWithNoAmmo || unit.StartsWithNoAmmo) traits.push(t('TRAIT_STARTS_NO_AMMO', 'Starts With No Ammo'));
            if (unit.removeWhenOutOfAmmo || unit.RemoveWhenOutOfAmmo) traits.push(t('TRAIT_REMOVE_OUT_OF_AMMO', 'Removed When Out Of Ammo'));
            if (unit.canBeTrampled || unit.CanBeTrampled) traits.push(t('TRAIT_CAN_BE_TRAMPLED', 'Can Be Trampled (Not Targetable)'));
            if (unit.isUndetectable || unit.IsUndetectable) traits.push(t('TRAIT_INNATE_UNDETECTABLE', 'Innate Undetectable'));
            if (traits.length) {
                traits.forEach(trait => lines.push(fmt('TOOLTIP_TRAIT', 'Trait: {0}', trait)));
            }

            // helper: format radius/value into readable string
            const radiusToString = (r) => {
                if (r === undefined || r === null || r === '') return null;
                if (typeof r === 'string') return r;
                if (typeof r === 'number') return `${r}x${r}`;
                return String(r);
            };

            // Show special effects summary (defensive)
            if (Array.isArray(unit.specialEffects) && unit.specialEffects.length) {
                for (const effect of unit.specialEffects) {
                    try {
                        const typ = effect?.Type || effect?.type;
                        if (!typ) continue;

                        switch (typ) {
                            case 'AreaOfEffect': {
                                const radius = effect?.Value ?? effect?.Radius ?? '';
                                const rstr = radiusToString(radius) ?? t('UI_NA', 'N/A');
                                const splashFactor = Number(effect?.SplashFactor ?? 1.0);
                                const centerIsAttacker = !!effect?.IsOmnidirectional;
                                const centerLabel = centerIsAttacker ? t('TOOLTIP_CENTER_ATTACKER', 'center=attacker') : t('TOOLTIP_CENTER_TARGET', 'center=target');

                                // estimate splash (best-effort): prefer last damage dealt, else fallback to unit.damage
                                let estimate = null;
                                const lastDamage = (unit?._lastDamageDealtRaw ?? unit?._lastDamageDealt ?? null);
                                if (typeof lastDamage === 'number' && lastDamage > 0) {
                                    estimate = Math.round(lastDamage * splashFactor);
                                } else if (typeof unit.damage === 'number') {
                                    estimate = Math.round(unit.damage * splashFactor);
                                }

                                const parts = [`${rstr}`, fmt('TOOLTIP_SPLASH', 'splash x{0}', splashFactor), `${centerLabel}`];
                                if (estimate !== null) parts.push(fmt('TOOLTIP_EST_SPLASH', 'est splash {0}', formatCompact(estimate)));

                                // Targeting filter
                                if (effect?.TargetingFilter && typeof effect.TargetingFilter === 'object') {
                                    const tf = effect.TargetingFilter;
                                    const showFilter = [];

                                    if (tf.Include && typeof tf.Include === 'object') {
                                        const incParts = [];
                                        if (Array.isArray(tf.Include.MonsterType) && tf.Include.MonsterType.length) incParts.push(fmt('TOOLTIP_FILTER_MONSTERS', 'Monsters: {0}', tf.Include.MonsterType.join(', ')));
                                        if (Array.isArray(tf.Include.DefenceType) && tf.Include.DefenceType.length) incParts.push(fmt('TOOLTIP_FILTER_DEFENCES', 'Defences: {0}', tf.Include.DefenceType.join(', ')));
                                        if (Array.isArray(tf.Include.StatusEffect) && tf.Include.StatusEffect.length) incParts.push(fmt('TOOLTIP_FILTER_STATUS', 'Has Status: {0}', tf.Include.StatusEffect.join(', ')));
                                        if (incParts.length) showFilter.push(fmt('TOOLTIP_FILTER_INCLUDE', 'Include({0})', incParts.join('; ')));
                                    }

                                    if (tf.Exclude && typeof tf.Exclude === 'object') {
                                        const excParts = [];
                                        if (Array.isArray(tf.Exclude.MonsterType) && tf.Exclude.MonsterType.length) excParts.push(fmt('TOOLTIP_FILTER_MONSTERS', 'Monsters: {0}', tf.Exclude.MonsterType.join(', ')));
                                        if (Array.isArray(tf.Exclude.DefenceType) && tf.Exclude.DefenceType.length) excParts.push(fmt('TOOLTIP_FILTER_DEFENCES', 'Defences: {0}', tf.Exclude.DefenceType.join(', ')));
                                        if (Array.isArray(tf.Exclude.StatusEffect) && tf.Exclude.StatusEffect.length) excParts.push(fmt('TOOLTIP_FILTER_STATUS', 'Has Status: {0}', tf.Exclude.StatusEffect.join(', ')));
                                        if (excParts.length) showFilter.push(fmt('TOOLTIP_FILTER_EXCLUDE', 'Exclude({0})', excParts.join('; ')));
                                    }

                                    if (showFilter.length) parts.push(showFilter.join(' | '));
                                }

                                lines.push(fmt('TOOLTIP_AOE', 'AoE: {0}', parts.join(' • ')));
                                break;
                            }
                            case 'LaserBeam': {
                                const travelWhole = !!effect?.TravelEntireRow;
                                const ext = (effect?.Extension !== undefined && effect?.Extension !== null) ? effect.Extension : (travelWhole ? t('TOOLTIP_ENTIRE_ROW', 'entire row') : 0);
                                const travel = travelWhole ? fmt('TOOLTIP_TRAVELS_WHOLE_ROW', ' ({0})', t('TOOLTIP_TRAVELS_WHOLE_ROW_SHORT', 'travels whole row')) : '';
                                const parts = [fmt('TOOLTIP_EXT', 'ext={0}', `${ext}${travel}`)];

                                // Targeting filter
                                if (effect?.TargetingFilter && typeof effect.TargetingFilter === 'object') {
                                    const tf = effect.TargetingFilter;
                                    const showFilter = [];

                                    if (tf.Include && typeof tf.Include === 'object') {
                                        const incParts = [];
                                        if (Array.isArray(tf.Include.MonsterType) && tf.Include.MonsterType.length) incParts.push(`Monsters: ${tf.Include.MonsterType.join(', ')}`);
                                        if (Array.isArray(tf.Include.DefenceType) && tf.Include.DefenceType.length) incParts.push(`Defences: ${tf.Include.DefenceType.join(', ')}`);
                                        if (Array.isArray(tf.Include.StatusEffect) && tf.Include.StatusEffect.length) incParts.push(`Has Status: ${tf.Include.StatusEffect.join(', ')}`);
                                        if (incParts.length) showFilter.push(`Include(${incParts.join('; ')})`);
                                    }

                                    if (tf.Exclude && typeof tf.Exclude === 'object') {
                                        const excParts = [];
                                        if (Array.isArray(tf.Exclude.MonsterType) && tf.Exclude.MonsterType.length) excParts.push(`Monsters: ${tf.Exclude.MonsterType.join(', ')}`);
                                        if (Array.isArray(tf.Exclude.DefenceType) && tf.Exclude.DefenceType.length) excParts.push(`Defences: ${tf.Exclude.DefenceType.join(', ')}`);
                                        if (Array.isArray(tf.Exclude.StatusEffect) && tf.Exclude.StatusEffect.length) excParts.push(`Has Status: ${tf.Exclude.StatusEffect.join(', ')}`);
                                        if (excParts.length) showFilter.push(`Exclude(${excParts.join('; ')})`);
                                    }

                                    if (showFilter.length) parts.push(showFilter.join(' | '));
                                }

                                lines.push(fmt('TOOLTIP_LASER_BEAM', 'Laser Beam: {0}', parts.join(' • ')));
                                break;
                            }
                            case 'Accuracy': {
                                const minV = (effect?.MinValue !== undefined) ? Number(effect.MinValue) : 0;
                                const maxV = (effect?.MaxValue !== undefined) ? Number(effect.MaxValue) : 1;
                                const avg = (minV + maxV) / 2;
                                const pct = (v => `${Math.round(v * 100)}%`);
                                lines.push(fmt('TOOLTIP_ACCURACY', 'Accuracy: min {0} / max {1} (avg {2})', pct(minV), pct(maxV), pct(avg)));
                                break;
                            }
                            case 'Armor': {
                                const val = (effect?.Value !== undefined) ? Number(effect.Value) : 0;
                                const dr = (effect?.DamageReduction !== undefined) ? Number(effect.DamageReduction) : 1;
                                lines.push(fmt('TOOLTIP_ARMOR', 'Armor: {0} (damage reduction: {1})', formatCompact(val), formatCompact(dr)));
                                break;
                            }
                            case 'ArmorPiercing': {
                                const val = (effect?.Value !== undefined) ? Number(effect.Value) : 1.0;
                                const pctChange = Math.round((val - 1.0) * 100);
                                const sign = pctChange >= 0 ? '+' : '';
                                const pierceLabel = t('TOOLTIP_ARMOR_PIERCING', 'Armor-Piercing');
                                lines.push(`${pierceLabel}: x${val}${val !== 1 ? ` (${sign}${pctChange}%)` : ''}`);
                                break;
                            }
                            case 'Lifesteal': {
                                const v = effect?.Value || 0;
                                lines.push(fmt('TOOLTIP_LIFESTEAL', 'Lifesteal: {0}x', formatCompact(v)));
                                break;
                            }
                            case 'BlockAllLanes': {
                                const shieldDefined = effect?.ShieldValue || 0;
                                const currentShield = (typeof unit._blockShield === 'number') ? unit._blockShield : shieldDefined;
                                lines.push(fmt('TOOLTIP_BLOCK_ALL_LANES', 'Block All Lanes: shield {0} (current {1})', formatCompact(shieldDefined), formatCompact(currentShield)));
                                break;
                            }
                            case 'DamageBooster': {
                                const radius = effect?.Radius ?? effect?.Value ?? '3x3';
                                const mult = Number(effect?.Value || 1.0);
                                const rstr = radiusToString(radius);
                                lines.push(fmt('TOOLTIP_DAMAGE_BOOSTER', 'Damage Booster: x{0} • area {1}', mult, rstr));
                                break;
                            }
                            case 'SummonUnit': {
                                const ct = effect?.SpawnCount ?? 1;
                                const cooldown = (unit?._summonCooldown !== undefined) ? unit._summonCooldown : (effect?.Cooldown ?? 0);
                                lines.push(fmt('TOOLTIP_SUMMON', 'Summons: {0} x{1} • cooldown {2} {3}', effect?.UnitType || '?', ct, cooldown, t('TOOLTIP_TURNS', 'turns')));
                                break;
                            }
                            case 'SpreadTargeting': {
                                const mm = effect?.MinimumEnemies ?? 2;
                                const only = !!effect?.OnlyActivateWhenEnoughEnemies;
                                let idx;
                                if (effect?.AmmoIndex !== undefined) idx = effect.AmmoIndex;
                                else if (Array.isArray(effect?.AmmoIndices)) idx = effect.AmmoIndices.map(a => a?.Index).filter(v => v !== undefined).join(',');
                                else idx = t('UI_NA', 'N/A');
                                const onlySuffix = only ? t('TOOLTIP_ONLY_WHEN_MET', ' (only when met)') : '';
                                lines.push(fmt('TOOLTIP_SPREAD_TARGETING', 'Spread Targeting: ammoIndex {0} • mode {1} • minEnemies {2}{3}', idx, effect?.TargetMode || t('TOOLTIP_FIRST', 'First'), mm, onlySuffix));
                                break;
                            }
                            case 'MultiFire': {
                                const fc = Number(effect?.FireCount ?? 1);
                                const fd = Number(effect?.FireDelay ?? 0.06);
                                lines.push(fmt('TOOLTIP_MULTIFIRE', 'Multi Fire: {0} shots • delay {1}s', formatCompact(fc), formatCompact(fd)));
                                break;
                            }
                            case 'Revive': {
                                const chance = (effect?.ReviveChance !== undefined) ? Number(effect.ReviveChance) : 1.0;
                                const pct = `${Math.round(chance * 100)}%`;
                                const maxRevives = (effect?.MaxRevives !== undefined) ? Number(effect.MaxRevives) : 1;
                                const hMult = (effect?.HealthMult !== undefined) ? Number(effect.HealthMult) : 1.0;
                                const dMult = (effect?.DamageMult !== undefined) ? Number(effect.DamageMult) : 1.0;
                                lines.push(fmt('TOOLTIP_REVIVE', 'Revive: chance {0} • max {1} • Health x{2} • Damage x{3}', pct, maxRevives, hMult, dMult));
                                break;
                            }
                            case 'DeathEffect': {
                                const parts = [];
                                
                                // Calculate wave scaling for DeathEffect tooltip (monsters past wave 10)
                                const wave = CombatFactory.getUnitWave(unit, this);
                                const isMonsterEffect = unit.typeName && (unit.typeName in MonsterFactory.monsterData);
                                const waveScaling = CombatFactory.getWaveScalingFactor(wave, isMonsterEffect);

                                // Damage / Healing
                                if (effect?.DeathDamage !== undefined && effect?.DeathHealing !== null) {
                                    const baseDmg = Number(effect.DeathDamage);
                                    const scaledDmg = Math.round(baseDmg * waveScaling);
                                    const dmgText = waveScaling > 1 ? 
                                        `${scaledDmg} (base ${baseDmg})` : 
                                        `${baseDmg}`;
                                    parts.push(fmt('TOOLTIP_DEATH_DAMAGE', 'Damage {0}', dmgText));
                                }
                                if (effect?.DeathHealing !== undefined && effect?.DeathHealing !== null) {
                                    const baseHeal = Number(effect.DeathHealing);
                                    const scaledHeal = Math.round(baseHeal * waveScaling);
                                    const healText = waveScaling > 1 ? 
                                        `${scaledHeal} (base ${baseHeal})` : 
                                        `${baseHeal}`;
                                    parts.push(fmt('TOOLTIP_DEATH_HEAL', 'Heal {0}', healText));
                                }

                                // Radius (accepts "3x3" or number)
                                const rawRadius = (effect?.Radius !== undefined) ? effect.Radius : (effect?.Value !== undefined ? effect.Value : null);
                                const rstr = radiusToString(rawRadius);
                                if (rstr) parts.push(fmt('TOOLTIP_RADIUS', 'Radius {0}', rstr));

                                // Death statuses
                                if (Array.isArray(effect?.DeathStatuses) && effect.DeathStatuses.length) {
                                    const statusNames = effect.DeathStatuses.map(s => (typeof s === 'string' ? s : (s?.Type || JSON.stringify(s)))).join(', ');
                                    parts.push(fmt('TOOLTIP_STATUSES', 'Statuses: {0}', statusNames));
                                }

                                // Targeting filter (Include / Exclude)
                                if (effect?.TargetingFilter && typeof effect.TargetingFilter === 'object') {
                                    const tf = effect.TargetingFilter;
                                    const showFilter = [];

                                    if (tf.Include && typeof tf.Include === 'object') {
                                        const incParts = [];
                                        if (Array.isArray(tf.Include.MonsterType) && tf.Include.MonsterType.length) incParts.push(fmt('TOOLTIP_FILTER_MONSTERS', 'Monsters: {0}', tf.Include.MonsterType.join(', ')));
                                        if (Array.isArray(tf.Include.DefenceType) && tf.Include.DefenceType.length) incParts.push(fmt('TOOLTIP_FILTER_DEFENCES', 'Defences: {0}', tf.Include.DefenceType.join(', ')));
                                        if (Array.isArray(tf.Include.StatusEffect) && tf.Include.StatusEffect.length) incParts.push(fmt('TOOLTIP_FILTER_STATUS', 'Has Status: {0}', tf.Include.StatusEffect.join(', ')));
                                        if (incParts.length) showFilter.push(fmt('TOOLTIP_FILTER_INCLUDE', 'Include({0})', incParts.join('; ')));
                                    }

                                    if (tf.Exclude && typeof tf.Exclude === 'object') {
                                        const excParts = [];
                                        if (Array.isArray(tf.Exclude.MonsterType) && tf.Exclude.MonsterType.length) excParts.push(fmt('TOOLTIP_FILTER_MONSTERS', 'Monsters: {0}', tf.Exclude.MonsterType.join(', ')));
                                        if (Array.isArray(tf.Exclude.DefenceType) && tf.Exclude.DefenceType.length) excParts.push(fmt('TOOLTIP_FILTER_DEFENCES', 'Defences: {0}', tf.Exclude.DefenceType.join(', ')));
                                        if (Array.isArray(tf.Exclude.StatusEffect) && tf.Exclude.StatusEffect.length) excParts.push(fmt('TOOLTIP_FILTER_STATUS', 'Has Status: {0}', tf.Exclude.StatusEffect.join(', ')));
                                        if (excParts.length) showFilter.push(fmt('TOOLTIP_FILTER_EXCLUDE', 'Exclude({0})', excParts.join('; ')));
                                    }

                                    if (showFilter.length) parts.push(showFilter.join(' | '));
                                }

                                if (parts.length === 0) lines.push(t('TOOLTIP_DEATH_EFFECT_NONE', 'Death Effect: (none)'));
                                else lines.push(fmt('TOOLTIP_DEATH_EFFECT', 'Death Effect: {0}', parts.join(' • ')));
                                break;
                            }
                            case 'CreatePuddle': {
                                const parts = [];
                                const pType = effect?.PuddleType || 'Generic';
                                const def = (PuddleFactory.puddleData && pType) ? PuddleFactory.puddleData[pType] : null;
                                const damageVal = (effect?.Damage !== undefined) ? effect.Damage : def?.Damage;
                                const durationVal = (effect?.Duration !== undefined) ? effect.Duration : def?.Duration;
                                const spriteVal = effect?.Sprite || def?.Sprite;
                                const statusList = Array.isArray(effect?.StatusEffects) ? effect.StatusEffects :
                                    (Array.isArray(def?.StatusEffects) ? def.StatusEffects : []);
                                const tf = effect?.TargetingFilter || def?.TargetingFilter;

                                const dmg = (damageVal !== undefined) ? fmt('TOOLTIP_DAMAGE_VALUE', 'Damage {0}', formatCompact(damageVal)) : null;
                                const dur = (durationVal !== undefined) ? fmt('TOOLTIP_DURATION', 'Duration {0}', durationVal) : null;
                                const spr = spriteVal ? fmt('TOOLTIP_SPRITE', 'Sprite {0}', spriteVal) : null;

                                if (dmg) parts.push(dmg);
                                if (dur) parts.push(dur);
                                if (spr) parts.push(spr);

                                if (Array.isArray(statusList) && statusList.length) {
                                    const statusNames = statusList.map(s => (typeof s === 'string' ? s : (s?.Type || JSON.stringify(s)))).join(', ');
                                    parts.push(fmt('TOOLTIP_STATUSES', 'Statuses: {0}', statusNames));
                                }

                                if (tf && typeof tf === 'object') {
                                    const showFilter = [];

                                    if (tf.Include && typeof tf.Include === 'object') {
                                        const incParts = [];
                                        if (Array.isArray(tf.Include.MonsterType) && tf.Include.MonsterType.length) incParts.push(fmt('TOOLTIP_FILTER_MONSTERS', 'Monsters: {0}', tf.Include.MonsterType.join(', ')));
                                        if (Array.isArray(tf.Include.DefenceType) && tf.Include.DefenceType.length) incParts.push(fmt('TOOLTIP_FILTER_DEFENCES', 'Defences: {0}', tf.Include.DefenceType.join(', ')));
                                        if (Array.isArray(tf.Include.StatusEffect) && tf.Include.StatusEffect.length) incParts.push(fmt('TOOLTIP_FILTER_STATUS', 'Has Status: {0}', tf.Include.StatusEffect.join(', ')));
                                        if (incParts.length) showFilter.push(fmt('TOOLTIP_FILTER_INCLUDE', 'Include({0})', incParts.join('; ')));
                                    }

                                    if (tf.Exclude && typeof tf.Exclude === 'object') {
                                        const excParts = [];
                                        if (Array.isArray(tf.Exclude.MonsterType) && tf.Exclude.MonsterType.length) excParts.push(fmt('TOOLTIP_FILTER_MONSTERS', 'Monsters: {0}', tf.Exclude.MonsterType.join(', ')));
                                        if (Array.isArray(tf.Exclude.DefenceType) && tf.Exclude.DefenceType.length) excParts.push(fmt('TOOLTIP_FILTER_DEFENCES', 'Defences: {0}', tf.Exclude.DefenceType.join(', ')));
                                        if (Array.isArray(tf.Exclude.StatusEffect) && tf.Exclude.StatusEffect.length) excParts.push(fmt('TOOLTIP_FILTER_STATUS', 'Has Status: {0}', tf.Exclude.StatusEffect.join(', ')));
                                        if (excParts.length) showFilter.push(fmt('TOOLTIP_FILTER_EXCLUDE', 'Exclude({0})', excParts.join('; ')));
                                    }

                                    if (showFilter.length) parts.push(showFilter.join(' | '));
                                }

                                const extras = parts.length ? ` | ${parts.join(' | ')}` : '';
                                lines.push(fmt('TOOLTIP_CREATE_PUDDLE', 'Create Puddle: {0}{1}', pType, extras));
                                break;
                            }
                            case 'HealAllies': {
                                const range = effect?.Range ?? 1;
                                const healMult = effect?.HealMult ?? 1.0;
                                const targetingMode = effect?.TargetingMode ?? 'First';
                                const consumesAttack = effect?.ConsumesAttack !== false;
                                const parts = [fmt('TOOLTIP_RANGE_SHORT', 'range {0}', range), fmt('TOOLTIP_MULT_SHORT', 'x{0}', healMult), fmt('TOOLTIP_MODE', 'mode {0}', targetingMode)];
                                if (!consumesAttack) parts.push(t('TOOLTIP_NO_AMMO_COST', 'no ammo cost'));

                                // Targeting filter
                                if (effect?.TargetingFilter && typeof effect.TargetingFilter === 'object') {
                                    const tf = effect.TargetingFilter;
                                    const showFilter = [];

                                    if (tf.Include && typeof tf.Include === 'object') {
                                        const incParts = [];
                                        if (Array.isArray(tf.Include.MonsterType) && tf.Include.MonsterType.length) incParts.push(fmt('TOOLTIP_FILTER_MONSTERS', 'Monsters: {0}', tf.Include.MonsterType.join(', ')));
                                        if (Array.isArray(tf.Include.DefenceType) && tf.Include.DefenceType.length) incParts.push(fmt('TOOLTIP_FILTER_DEFENCES', 'Defences: {0}', tf.Include.DefenceType.join(', ')));
                                        if (Array.isArray(tf.Include.StatusEffect) && tf.Include.StatusEffect.length) incParts.push(fmt('TOOLTIP_FILTER_STATUS', 'Has Status: {0}', tf.Include.StatusEffect.join(', ')));
                                        if (incParts.length) showFilter.push(fmt('TOOLTIP_FILTER_INCLUDE', 'Include({0})', incParts.join('; ')));
                                    }

                                    if (tf.Exclude && typeof tf.Exclude === 'object') {
                                        const excParts = [];
                                        if (Array.isArray(tf.Exclude.MonsterType) && tf.Exclude.MonsterType.length) excParts.push(fmt('TOOLTIP_FILTER_MONSTERS', 'Monsters: {0}', tf.Exclude.MonsterType.join(', ')));
                                        if (Array.isArray(tf.Exclude.DefenceType) && tf.Exclude.DefenceType.length) excParts.push(fmt('TOOLTIP_FILTER_DEFENCES', 'Defences: {0}', tf.Exclude.DefenceType.join(', ')));
                                        if (Array.isArray(tf.Exclude.StatusEffect) && tf.Exclude.StatusEffect.length) excParts.push(fmt('TOOLTIP_FILTER_STATUS', 'Has Status: {0}', tf.Exclude.StatusEffect.join(', ')));
                                        if (excParts.length) showFilter.push(fmt('TOOLTIP_FILTER_EXCLUDE', 'Exclude({0})', excParts.join('; ')));
                                    }

                                    if (showFilter.length) parts.push(showFilter.join(' | '));
                                }

                                lines.push(fmt('TOOLTIP_HEAL_ALLIES', 'Heal Allies: {0}', parts.join(' • ')));
                                break;
                            }
                            default:
                                const hasSomeProps = Object.keys(effect || {}).some(k => k !== 'Type' && effect[k] !== undefined && effect[k] !== null);
                                if (hasSomeProps) {
                                    lines.push(fmt('TOOLTIP_EFFECT_GENERIC', '{0}: {1}', typ, JSON.stringify(effect)));
                                }
                                break;
                        }
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[tooltip] effect rendering failed for', effect, e);
                    }
                }
            } else {
                lines.push(t('TOOLTIP_SPECIAL_EFFECTS_NONE', 'Special Effects: None'));
            }

            // Statuses (only when present)
            if (unit.status && unit.status.length) {
                const statusText = (unit.status || []).map(s => {
                    if (s?.Type === 'Fire') {
                        const baseDmg = s.Value || 0;
                        const sourceUnit = s._source;
                        const isSourceMonster = sourceUnit && sourceUnit.typeName && (sourceUnit.typeName in MonsterFactory.monsterData);
                        const sourceWave = CombatFactory.getUnitWave(sourceUnit, this);
                        const waveScaling = CombatFactory.getWaveScalingFactor(sourceWave, isSourceMonster);
                        const scaledDmg = Math.round(baseDmg * waveScaling);
                        const dmgText = (isSourceMonster && waveScaling > 1) ?
                            `${formatCompact(scaledDmg)} (base ${formatCompact(baseDmg)})` :
                            formatCompact(baseDmg);
                        return fmt('STATUS_FIRE', 'Fire: {0} dmg/turn ({1} turns)', dmgText, s.Duration);
                    }
                    if (s?.Type === 'Poison') {
                        const baseDmg = s.Value || 0;
                        const sourceUnit = s._source;
                        const isSourceMonster = sourceUnit && sourceUnit.typeName && (sourceUnit.typeName in MonsterFactory.monsterData);
                        const sourceWave = CombatFactory.getUnitWave(sourceUnit, this);
                        const waveScaling = CombatFactory.getWaveScalingFactor(sourceWave, isSourceMonster);
                        const scaledDmg = Math.round(baseDmg * waveScaling);
                        const dmgText = (isSourceMonster && waveScaling > 1) ?
                            `${formatCompact(scaledDmg)} (base ${formatCompact(baseDmg)})` :
                            formatCompact(baseDmg);
                        return fmt('STATUS_POISON', 'Poison: {0} dmg/turn ({1} turns)', dmgText, s.Duration);
                    }
                    if (s?.Type === 'Purge') return fmt('STATUS_PURGE', 'Purge: Immune to status effects ({0} turns)', s.Duration);
                    if (s?.Type === 'Acid') return fmt('STATUS_ACID', 'Acid: x{0} ({1} turns)', s.BonusDamage || s.Value || 1.25, s.Duration);
                    if (s?.Type === 'Slow') {
                        const reloadInc = s.Value || 1;
                        const speedMult = s.SpeedReduction !== undefined ? s.SpeedReduction : 1;
                        let slowText = fmt('STATUS_SLOW_BASE', 'Slow: +{0} reload', reloadInc);
                        if (speedMult !== 1) {
                            const speedPct = Math.round(speedMult * 100);
                            slowText += fmt('STATUS_SLOW_SPEED', ', {0}% speed', speedPct);
                        }
                        slowText += fmt('STATUS_DURATION', ' ({0} turns)', s.Duration);
                        return slowText;
                    }
                    if (s?.Type === 'Stun') return fmt('STATUS_STUN', 'Stun: {0} turns', s.Duration);
                    if (s?.Type === 'Frozen') return fmt('STATUS_FROZEN', 'Frozen: {0} turns', s.Duration);
                    if (s?.Type === 'Charm') return fmt('STATUS_CHARM', 'Charmed: attacks allies ({0} turns)', s.Duration);
                    if (s?.Type === 'Undetectable') {
                        const permanent = s._permanent || unit.isUndetectable;
                        return permanent
                            ? t('STATUS_UNDETECTABLE_PERM', 'Undetectable: cannot be targeted (permanent)')
                            : fmt('STATUS_UNDETECTABLE', 'Undetectable: cannot be targeted ({0} turns)', s.Duration);
                    }
                    return fmt('STATUS_GENERIC', '{0}: {1}', s?.Type || t('GENERIC_UNKNOWN', 'Unknown'), s?.Duration ?? 0);
                }).join('\n');
                lines.push(statusText);
            }

            return lines.join('\n');
        } catch (err) {
            if (DEBUG_MODE) console.error('[tooltip] _formatUnitTooltip failed', err);
            const t = this._t || ((key, fallback) => GlobalLocalization.t(key, fallback));
            return unit?.fullName || unit?.typeName || t('GENERIC_UNKNOWN', 'Unknown');
        }
    }

    _removeUnitCompletely(unit) {
        if (!unit) return;
        if (unit._beingRemoved) return;
        unit._beingRemoved = true;
        try {
            SpecialEffectFactory.handleOnDeath(unit, this);
        } catch (e) {}
        try {
            SpecialEffectFactory.handleOnRemove(unit, this);
        } catch (e) {}
        try {
            if (unit.position && Array.isArray(this.grid) &&
                this.grid[unit.position.row] && this.grid[unit.position.row][unit.position.col]) {
                const cell = this.grid[unit.position.row][unit.position.col];
                if (cell.sprite) try {
                    cell.sprite.destroy();
                } catch (e) {}
                cell.unit = null;
                cell.sprite = null;
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('_removeUnit grid cleanup', e);
        }

        // Clean up status effect visuals
        try {
            StatusEffectVisuals.cleanupUnitVisuals(unit);
        } catch (e) {}

        try {
            const unitName = unit.fullName || unit.typeName || this._t('GENERIC_UNIT', 'Unit');
            const removedText = (typeof unit.currentHealth === 'number' && unit.currentHealth <= 0)
                ? this._fmt('HISTORY_UNIT_DEFEATED', '{0} was defeated', unitName)
                : this._fmt('HISTORY_UNIT_REMOVED', '{0} was removed', unitName);
            this.addHistoryEntry(removedText);
        } catch (e) {}
        
        ['sprite', 'healthBar', 'ammoBar', 'healthBarBg', 'ammoBarBg', 'reloadBar', 'reloadBarBg'].forEach(k => {
            try {
                if (unit[k]) unit[k].destroy();
            } catch (e) {}
            try {
                delete unit[k];
            } catch (e) {}
        });

        // forceFields removal as column array
        try {
            if (unit.position && this.forceFields) {
                const col = unit.position.col;
                if (Array.isArray(this.forceFields[col])) {
                    this.forceFields[col] = this.forceFields[col].filter(x => x !== unit);
                    if (this.forceFields[col].length === 0) delete this.forceFields[col];
                } else if (this.forceFields[col] === unit) {
                    delete this.forceFields[col];
                }
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('_removeUnit forceField cleanup', e);
        }

        try {
            if (Array.isArray(this.holders)) this.holders = this.holders.filter(h => h !== unit);
            if (Array.isArray(this.units)) this.units = this.units.filter(u => u !== unit);
        } catch (e) {
            if (DEBUG_MODE) console.warn('_removeUnit arrays cleanup', e);
        }

        try {
            delete unit.position;
        } catch (e) {}
        try {
            delete unit._owner;
        } catch (e) {}

        try {
            if (typeof this.updateHolders === 'function') this.updateHolders();
        } catch (e) {}
    }

    // Legacy cleanup function - now handled by unified lifecycle phase in endTurn
    cleanupDeadUnitsAfterTick() {
        if (DEBUG_MODE) console.log('[cleanupDeadUnitsAfterTick] deprecated - use lifecycle phase in endTurn');
    }

    ensureSpriteForUnit(unit, x = 300, y = 150, isHolder = false) {
        if (!unit) return null;
        try {
            if (unit.sprite && unit.sprite.scene) {
                unit.sprite._unitRef = unit;
                unit.sprite._onPointerUp = unit.sprite._onPointerUp || null;
                return unit.sprite;
            }

            const size = Math.max(8, Math.floor((this.TILE_SIZE || 48) * (isHolder ? 0.65 : 0.8)));
            let spr = null;

            // Determine sprite key - check unit.displaySprite first, then fall back to factory data
            let spriteKey = unit.displaySprite;
            if (!spriteKey || !this.textures.exists(spriteKey)) {
                const isDefence = unit.typeName in DefenceFactory.defenceData;
                const factory = isDefence ? DefenceFactory : MonsterFactory;
                const data = factory?.getData?.(unit.typeName) || factory?.defenceData?.[unit.typeName] || factory?.monsterData?.[unit.typeName];
                spriteKey = data?.displaySprite || data?.DisplaySprite;
                if (spriteKey && this.textures.exists(spriteKey)) {
                    unit.displaySprite = spriteKey;
                }
            }

            try {
                if (spriteKey && this.textures && typeof this.textures.exists === 'function' && this.textures.exists(spriteKey)) {
                    const spriteY = isHolder ? y + (this.UNIT_Y_OFFSET || 0) : y;
                    spr = this.add.sprite(x, spriteY, spriteKey);
                } else {
                    const rectY = isHolder ? y + (this.UNIT_Y_OFFSET || 0) : y;
                    spr = this.add.rectangle(x, rectY, size, size, 0x999999);
                }
            } catch (e) {
                try {
                    const rectY = isHolder ? y + (this.UNIT_Y_OFFSET || 0) : y;
                    spr = this.add.rectangle(x, rectY, size, size, 0x999999);
                } catch (ee) {
                    if (DEBUG_MODE) console.warn('[ensureSpriteForUnit] unable to create any visual', ee);
                    return null;
                }
            }

            // Make interactive where possible
            try {
                if (spr.setInteractive) spr.setInteractive();
            } catch (e) {}

            // set display size where available
            try {
                if (spr.setDisplaySize) spr.setDisplaySize(size, size);
            } catch (e) {}

            spr.setOrigin && spr.setOrigin(0.5, 0.5);

            // bookkeeping
            spr._unitRef = unit;
            spr._onPointerUp = spr._onPointerUp || null;

            if (typeof spr.setTint !== 'function') {
                spr._savedFill = (typeof spr.fillColor !== 'undefined') ? spr.fillColor : null;
                spr.setTint = function(val) {
                    try {
                        if (typeof this.setFillStyle === 'function') this.setFillStyle(val);
                    } catch (e) {}
                };
            }
            if (typeof spr.clearTint !== 'function') {
                spr.clearTint = function() {
                    try {
                        if (typeof this.setFillStyle === 'function') {
                            if (this._savedFill !== null && this._savedFill !== undefined) this.setFillStyle(this._savedFill);
                        }
                    } catch (e) {}
                };
            }

            // Ensure destroy exists and nulls out unit.sprite to avoid stale refs
            if (typeof spr._origDestroy !== 'function') {
                spr._origDestroy = spr.destroy ? spr.destroy.bind(spr) : null;
                spr.destroy = function() {
                    try {
                        if (this._origDestroy) this._origDestroy();
                    } catch (e) {}
                    try {
                        if (this._unitRef) this._unitRef.sprite = null;
                    } catch (e) {}
                }.bind(spr);
            }

            // attach to unit
            unit.sprite = spr;

            return spr;
        } catch (e) {
            if (DEBUG_MODE) console.warn('[ensureSpriteForUnit] failed', e);
            return null;
        }
    }

    _positionUnitUI(unit) {
        if (!unit) return;
        try {
            let sx = undefined,
                sy = undefined;
            const spr = unit.sprite;
            if (spr) {
                if (spr.parentContainer) {
                    const cont = spr.parentContainer;
                    sx = cont.x + (spr.x || 0);
                    sy = cont.y + (spr.y || 0);
                } else {
                    sx = (typeof spr.x === 'number') ? spr.x : undefined;
                    sy = (typeof spr.y === 'number') ? spr.y : undefined;
                }
            }
            if (typeof sx === 'undefined' || typeof sy === 'undefined') {
                if (unit.position && typeof this.getTileXY === 'function') {
                    const t = this.getTileXY(unit.position.row, unit.position.col);
                    sx = t.x;
                    sy = t.y + (this.UNIT_Y_OFFSET || 0);
                    if (spr) {
                        try {
                            spr.x = sx;
                            spr.y = sy;
                        } catch (e) {}
                    }
                } else {
                    return;
                }
            }
            if (unit.healthBarBg) {
                unit.healthBarBg.x = sx;
                unit.healthBarBg.y = sy + 30;
            }
            if (unit.healthBar) {
                unit.healthBar.x = sx - 18;
                unit.healthBar.y = sy + 30;
            }
            if (unit.ammoBarBg) {
                unit.ammoBarBg.x = sx;
                unit.ammoBarBg.y = sy + 35;
            }
            if (unit.ammoBar) {
                unit.ammoBar.x = sx - 18;
                unit.ammoBar.y = sy + 35;
            }
            if (unit.reloadBarBg) {
                unit.reloadBarBg.x = sx;
                unit.reloadBarBg.y = sy + 40;
            }
            if (unit.reloadBar) {
                unit.reloadBar.x = sx - 18;
                unit.reloadBar.y = sy + 40;
            }
            const desiredBarDepth = (spr && typeof spr.depth === 'number') ? (spr.depth + 1000) : 1010;
            if (unit.healthBarBg && typeof unit.healthBarBg.setDepth === 'function') unit.healthBarBg.setDepth(desiredBarDepth);
            if (unit.healthBar && typeof unit.healthBar.setDepth === 'function') unit.healthBar.setDepth(desiredBarDepth + 1);
            if (unit.ammoBarBg && typeof unit.ammoBarBg.setDepth === 'function') unit.ammoBarBg.setDepth(desiredBarDepth);
            if (unit.ammoBar && typeof unit.ammoBar.setDepth === 'function') unit.ammoBar.setDepth(desiredBarDepth + 1);
            if (unit.reloadBarBg && typeof unit.reloadBarBg.setDepth === 'function') unit.reloadBarBg.setDepth(desiredBarDepth);
            if (unit.reloadBar && typeof unit.reloadBar.setDepth === 'function') unit.reloadBar.setDepth(desiredBarDepth + 1);
        } catch (e) {
            if (DEBUG_MODE) console.warn('[positionUnitUI] failed', e);
        }
    }

    create() {
        try {
          ErrorHandler.setScene(this);
        } catch (e) {}
	      try {
          GlobalBackground.registerScene(this, { key: 'bg', useImageIfAvailable: true });
        } catch (e) {}
        try {
            GlobalAchievements.registerScene(this);
        } catch (e) {}
        try {
            const hasHuman = (this.players || []).some(p => p && !p.isAI);
            if (hasHuman) GlobalAchievements.addGame();
        } catch (e) {}

        // Create grid using BoardFactory (centralized, single source of truth for tile math)
        BoardFactory.setupGrid(this, {
            rows: this.boardRows || 5,
            cols: this.boardCols || 9,
            tileSize: 60,
            offsetX: 300,
            offsetY: 150,
            cellSize: 50
        });
        this.drawBoardVisual();

        // attach pointer handlers to the drawn cells so they call placeUnit and show tooltip
        this.__boardCells.forEach((cell, idx) => {
            const row = Math.floor(idx / this.GRID_COLS);
            const col = idx % this.GRID_COLS;

            // Track which unit we're currently showing tooltip for to prevent duplicates
            cell._tooltipUnit = null;
            cell._tooltipActive = false;

            cell.on('pointerdown', () => {
                // Silently ignore clicks on occupied cells (don't show "Invalid placement!")
                if (this.grid[row][col].unit) {
                    return;
                }
                this.placeUnit(row, col);
            });

            cell.on('pointerover', () => {
                const unit = this.grid[row][col].unit;
                // Only show tooltip if there's a unit and we're not already showing one for this cell
                if (unit && !cell._tooltipActive) {
                    // Destroy any existing global tooltip first
                    if (this.tooltip) {
                        try {
                            this.tooltip.destroy();
                        } catch (e) {}
                        this.tooltip = null;
                    }
                    cell._tooltipUnit = unit;
                    cell._tooltipActive = true;
                    const pos = this.getTileXY(row, col);
                    const txt = this._formatUnitTooltip(unit);
                    this.tooltip = this.add.text(pos.x, pos.y - 30, txt, {
                        fontSize: 14,
                        backgroundColor: '#000000',
                        color: '#ffffff',
                        fontFamily: this.PIXEL_FONT,
                        padding: {
                            x: 6,
                            y: 4
                        }
                    }).setOrigin(0.5);
                }
            });

            cell.on('pointerout', () => {
                // Only clear tooltip if this cell was the one showing it
                if (cell._tooltipActive) {
                    cell._tooltipUnit = null;
                    cell._tooltipActive = false;
                    if (this.tooltip) {
                        this.tooltip.destroy();
                        this.tooltip = null;
                    }
                }
            });
        });

        // Dice
        this.diceSprites = [];
        const diceBaseX = 600;
        const diceSpacing = 80;
        for (let i = 0; i < 2; i++) {
            const d = this.add.image(diceBaseX + (i - 0.5) * diceSpacing, 450, 'dice1').setScale(0.5).setVisible(false);
            d.originalX = d.x;
            d.originalY = d.y;
            this.diceSprites.push(d);
        }
        this.diceSprite = this.diceSprites[0];
        this.diceText = this.add.text(600, 700, this._t('GAME_ROLL_DICE', 'Roll Dice'), {
            fontSize: 32
        }).setOrigin(0.5).setInteractive();
        this.diceText.on('pointerdown', () => {
            const hasPrototypeDice = this.prototypeDiceIndices && this.prototypeDiceIndices.length > 0;
            if (hasPrototypeDice) {
                const indices = this.prototypeDiceIndices.slice();
                if (indices.length > 1) {
                    this.rollDice(false, 1, indices);
                } else {
                    this.rollDice(false, 1, indices[0]);
                }
            } else {
                this.rollDice(false, 1, null);
            }
        });

        // End turn
        this.endTurnBtn = this.add.text(600, 750, this._t('GAME_END_TURN', 'End Turn'), {
            fontSize: 28,
            color: '#ffffff'
        }).setOrigin(0.5).setInteractive();
        this.endTurnBtn.on('pointerdown', () => this.endTurn());

        // Info
        this.infoText = this.add.text(600, 50, '', {
            fontSize: 24
        }).setOrigin(0.5);

        this.addBackButton();
        this._createHistoryLogUI();
        this._bindHistoryLogHotkey();
        this._bindExitHotkey();

        if (!this._manualDragInstalled) {
            this._manualDragInstalled = true;

            // store handlers so cleanup can remove them safely
            this._onPointerMoveHandler = (pointer) => {
                if (!this._draggingHolder) return;
                const s = this._draggingHolder.sprite;
                if (!s || !s.scene) {
                    this._draggingHolder = null;
                    return;
                }
                const {
                    worldX,
                    worldY
                } = pointer;
                if (typeof worldX === 'number' && typeof worldY === 'number') {
                    try {
                        s.x = worldX;
                        s.y = worldY;
                    } catch (e) {
                        if (DEBUG_MODE) console.warn(e);
                    }
                }
            };

            this._onPointerUpHandler = (pointer) => {
                if (!this._draggingHolder) return;
                const s = this._draggingHolder.sprite;
                if (!s) {
                    this._draggingHolder = null;
                    return;
                }
                if (s && typeof s._onPointerUp === 'function') {
                    try {
                        s._onPointerUp(pointer);
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[pointerup] handler threw', e);
                        this._draggingHolder = null;
                    }
                } else {
                    try {
                        s.x = this._draggingHolder.startX ?? s.x;
                        s.y = this._draggingHolder.startY ?? s.y;
                    } catch (e) {}
                    this._draggingHolder = null;
                }
            };

            this.input.on('pointermove', this._onPointerMoveHandler, this);
            this.input.on('pointerup', this._onPointerUpHandler, this);
        }

        this.createPlayerBar();
        this.startWave();
        this._applyPixelFontToAllText();
    }

    _applyPixelFontToText(textObj) {
        if (!textObj) return;
        try {
            if (typeof textObj.setFontFamily === 'function') {
                textObj.setFontFamily(this.PIXEL_FONT);
            } else if (typeof textObj.setStyle === 'function') {
                textObj.setStyle({ fontFamily: this.PIXEL_FONT });
            }
        } catch (e) {}
    }

    _applyPixelFontToAllText() {
        try {
            (this.children?.list || []).forEach(child => {
                if (child && (child.type === 'Text' || child.style)) {
                    this._applyPixelFontToText(child);
                }
            });
        } catch (e) {}
    }

    _getUnitDamageId(unit) {
        if (!unit) return null;
        if (!unit._damageId) {
            unit._damageId = `u${this._damageIdCounter++}`;
        }
        return unit._damageId;
    }

    _resolveOwnerIndexForUnit(unit) {
        if (!unit) return null;
        if (Number.isInteger(unit._owner)) return unit._owner;
        try {
            const isDefence = unit.typeName in (DefenceFactory.defenceData || {});
            const isMonster = unit.typeName in (MonsterFactory.monsterData || {});
            if (isDefence) {
                const idx = (this.players || []).findIndex(p => p && p.role === 'defence');
                return idx >= 0 ? idx : null;
            }
            if (isMonster) {
                const idx = (this.players || []).findIndex(p => p && p.role === 'monster');
                return idx >= 0 ? idx : null;
            }
        } catch (e) {}
        return null;
    }

    _trackDamage(attacker, amount) {
        if (!attacker) return;
        const dmg = Math.max(0, Math.round(amount || 0));
        if (dmg <= 0) return;
        const ownerIndex = this._resolveOwnerIndexForUnit(attacker);
        if (!Number.isInteger(ownerIndex) || ownerIndex < 0) return;
        const id = this._getUnitDamageId(attacker);
        if (!id) return;
        const name = attacker.fullName || attacker.typeName || this._t('GENERIC_UNIT', 'Unit');
        const entry = this._damageByUnit[id] || { owner: ownerIndex, name, damage: 0 };
        entry.owner = ownerIndex;
        entry.name = name;
        entry.damage = Math.round((entry.damage || 0) + dmg);
        this._damageByUnit[id] = entry;
    }

    _getMvpByPlayer() {
        const result = [
            { unitName: this._t('POSTGAME_NONE', 'None'), damage: 0 },
            { unitName: this._t('POSTGAME_NONE', 'None'), damage: 0 }
        ];
        const entries = Object.values(this._damageByUnit || {});
        for (const entry of entries) {
            if (!entry || !Number.isInteger(entry.owner)) continue;
            if (entry.owner < 0 || entry.owner >= result.length) continue;
            const dmg = Number(entry.damage || 0);
            if (dmg > (result[entry.owner].damage || 0)) {
                result[entry.owner] = { unitName: entry.name || this._t('GENERIC_UNIT', 'Unit'), damage: dmg };
            }
        }
        return result;
    }

    _wait(ms) {
        return new Promise(resolve => {
            this.time.delayedCall(ms, resolve);
        });
    }

    startWave() {
        this.infoText.setText(this._fmt('GAME_WAVE_TURN', 'Wave {0}/{1} - {2}\'s turn', this.currentWave, this.waves, this.players[this.currentPlayer]?.name || ''));
        const defenderIndex = this.players.findIndex(p => p.role === 'defence');
        this.currentPlayer = (defenderIndex >= 0) ? defenderIndex : 0;

        this.addHistoryEntry(this._fmt('HISTORY_WAVE_STARTED', 'Wave {0} started', this.currentWave));
        
        try {
            StatusEffectFactory.tickStatusEffectsAtWaveStart(this);
        } catch (e) {
            if (DEBUG_MODE) console.warn('[startWave] tickStatusEffectsAtWaveStart failed', e);
        }

        try {
            PuddleFactory.tickPuddles(this);
        } catch (e) {
            if (DEBUG_MODE) console.warn('[startWave] tickPuddles failed', e);
        }
        
        this.startTurn();
    }

    startTurn() {
        const player = this.players[this.currentPlayer];
        if (player) {
            const roleLabel = player.role === 'defence' ? this._t('ROLE_DEFENCE', 'Defence') : (player.role === 'monster' ? this._t('ROLE_MONSTER', 'Monster') : this._t('ROLE_UNKNOWN', 'Unknown'));
            this.addHistoryEntry(this._fmt('HISTORY_TURN', '{0}\'s turn ({1})', player.name || this._t('GENERIC_PLAYER', 'Player'), roleLabel));
        }
        this.updateHolders();
        this.prototypeDiceIndices = [];
        this.rolledThisTurn = false;
        this.diceValues = [];
        if (this.diceSprites) {
            this.diceSprites.forEach(d => {
                if (d) d.setVisible(false);
            });
            for (let i = 0; i < this.diceCount; i++) {
                if (this.diceSprites[i]) {
                    this.diceSprites[i].setVisible(true);
                }
            }
        }
        this.updatePlayerBar();
        this.setDiceTextState();
        this.updateEndTurnButtonState();
        
        // Ensure buttons are properly enabled for human players
        const currentPlayerObj = this.players[this.currentPlayer];
        if (currentPlayerObj && !currentPlayerObj.isAI) {
            try {
                this.endTurnBtn.setInteractive?.();
            } catch (e) {}
            try {
                this.setDiceTextState?.();
            } catch (e) {}
        }
        
        if (currentPlayerObj && currentPlayerObj.isAI) {
            this.doAITurn();
        }
    }

    updateEndTurnButtonState() {
        if (!this.endTurnBtn) return;
        
        const player = this.players[this.currentPlayer];
        const isHuman = player && !player.isAI;
        
        // Check if player has rolled and has no units in holders
        const myHolding = (this.holders || []).some(h => h._owner === this.currentPlayer);
        const canEndTurn = isHuman && this.rolledThisTurn && !myHolding;
        
        if (canEndTurn) {
            this.endTurnBtn.setColor('#ff4444');
            this.endTurnBtn.setStyle({ 
                fontSize: '28px',
                color: '#ff4444',
                fontStyle: 'bold'
            });
        } else {
            this.endTurnBtn.setColor('#ffffff');
            this.endTurnBtn.setStyle({ 
                fontSize: '28px',
                color: '#ffffff',
                fontStyle: 'normal'
            });
        }
    }

    _hasPlacementAvailableForCurrentPlayer() {
        const player = this.players[this.currentPlayer];
        const isDefence = player.role === 'defence';
        const rows = this.GRID_ROWS || (this.grid ? this.grid.length : 5);
        const cols = this.GRID_COLS || (this.grid && this.grid[0] ? this.grid[0].length : 9);
        const centerCol = Math.floor(cols / 2);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (isDefence && c >= centerCol) continue;
                if (!isDefence && c <= centerCol) continue;
                if (!this.grid[r][c].unit) return true;
            }
        }
        return false;
    }



    setDiceTextState() {
        const currentPlayerObj = this.players[this.currentPlayer];
        const humanTurn = currentPlayerObj && !currentPlayerObj.isAI;
        
        // Check if we have any prototype dice that need re-rolling
        const hasPrototypeDice = this.prototypeDiceIndices && this.prototypeDiceIndices.length > 0;
        
        if (hasPrototypeDice) {
            const prototypeCount = this.prototypeDiceIndices.length;
            this.diceText.setText(this._fmt('GAME_REROLL_PROTO', 'Reroll Proto ({0})', prototypeCount));
            this.diceText.setColor('#ffd94d');
            this.diceText.setInteractive();
        } else if (humanTurn && !this.rolledThisTurn) {
            this.diceText.setText(this._t('GAME_ROLL_DICE', 'Roll Dice'));
            this.diceText.setColor('#66ff66');
            this.diceText.setInteractive();
        } else if (humanTurn && this.rolledThisTurn) {
            this.diceText.setText(this._t('GAME_ROLL_DICE', 'Roll Dice'));
            this.diceText.setColor('#999999');
            this.diceText.disableInteractive?.();
        } else {
            this.diceText.setText(this._t('GAME_ROLL_DICE', 'Roll Dice'));
            this.diceText.setColor('#ffffff');
            this.diceText.disableInteractive?.();
        }
    }

    getLoadoutForPlayer(playerIndex, isPrototype = false) {
        const player = this.players[playerIndex];
        return isPrototype ? player.protoLoadout : player.normalLoadout;
    }

    // Helper to get unit from dice value
    _getUnitFromDice(diceValue, playerIndex, isPrototype) {
        const loadout = this.getLoadoutForPlayer(playerIndex, isPrototype);
        if (loadout && loadout[diceValue - 1]) {
            return loadout[diceValue - 1];
        }
        return null;
    }

    addUnitBars(unit, sprite) {
        if (!unit || !sprite) return;

        // Clean up any existing bars first to prevent duplicates
        try {
            if (unit.healthBar) { unit.healthBar.destroy(); unit.healthBar = null; }
            if (unit.healthBarBg) { unit.healthBarBg.destroy(); unit.healthBarBg = null; }
            if (unit.ammoBar) { unit.ammoBar.destroy(); unit.ammoBar = null; }
            if (unit.ammoBarBg) { unit.ammoBarBg.destroy(); unit.ammoBarBg = null; }
            if (unit.reloadBar) { unit.reloadBar.destroy(); unit.reloadBar = null; }
            if (unit.reloadBarBg) { unit.reloadBarBg.destroy(); unit.reloadBarBg = null; }
        } catch (e) {}

        const baseDepth = (typeof sprite.depth === 'number') ? sprite.depth : 0;
        const barDepth = baseDepth + 1000;
        const healthBarBg = this.add.rectangle(sprite.x, sprite.y + 30, 40, 5, 0x000000).setOrigin(0.5);
        const healthBar = this.add.rectangle(sprite.x - 18, sprite.y + 30, 36, 3, 0xff0000).setOrigin(0, 0.5);
        const ammoBarBg = this.add.rectangle(sprite.x, sprite.y + 35, 40, 5, 0x000000).setOrigin(0.5);
        const ammoBar = this.add.rectangle(sprite.x - 18, sprite.y + 35, 36, 3, 0xffff00).setOrigin(0, 0.5);

        healthBarBg.setDepth(barDepth);
        healthBar.setDepth(barDepth + 1);
        ammoBarBg.setDepth(barDepth);
        ammoBar.setDepth(barDepth + 1);

        unit.healthBarBg = healthBarBg;
        unit.healthBar = healthBar;
        unit.ammoBarBg = ammoBarBg;
        unit.ammoBar = ammoBar;

        if (unit.reloadDelay > 0) {
            const reloadBarBg = this.add.rectangle(sprite.x, sprite.y + 40, 40, 5, 0x000000).setOrigin(0.5);
            const reloadBar = this.add.rectangle(sprite.x - 18, sprite.y + 40, 36, 3, 0x00ff00).setOrigin(0, 0.5);
            reloadBarBg.setDepth(barDepth);
            reloadBar.setDepth(barDepth + 1);
            unit.reloadBarBg = reloadBarBg;
            unit.reloadBar = reloadBar;
        }
    }

    updateHolders() {
        try {
            let keepSprite = (this._draggingHolder && this._draggingHolder.sprite && this._draggingHolder.sprite.scene) ? this._draggingHolder.sprite : null;
            if (!keepSprite && this._draggingHolder) this._draggingHolder = null;

            this.holderSprites = this.holderSprites || [];

            // IMPORTANT: Don't destroy sprites that are now on the grid (placed units)
            // Only destroy holder sprites that are still in the holders list
            const placedSprites = new Set();
            for (const row of this.grid) {
                for (const cell of row) {
                    if (cell && cell.sprite) {
                        placedSprites.add(cell.sprite);
                    }
                }
            }

            // Destroy old holder sprites except:
            // 1. The one we're currently dragging
            // 2. Sprites that are now placed on the grid
            // 3. Sprites explicitly marked as placed
            for (const s of this.holderSprites.slice()) {
                if (!s) continue;
                if (s === keepSprite) continue;
                if (placedSprites.has(s)) continue;
                if (s._isPlacedOnGrid) continue; 
                try {
                    if (typeof s.removeAllListeners === 'function') {
                        try {
                            s.removeAllListeners();
                        } catch (e) {}
                    } else {
                        try {
                            s.off && s.off('pointerover');
                        } catch (e) {}
                        try {
                            s.off && s.off('pointerout');
                        } catch (e) {}
                        try {
                            s.off && s.off('pointerdown');
                        } catch (e) {}
                    }
                    if (s.destroy && s.scene) s.destroy();
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[updateHolders] destroy failed', e);
                }
            }

            // start new holderSprites array with the dragging sprite if valid
            this.holderSprites = keepSprite ? [keepSprite] : [];

            const holderBaseX = this.currentPlayer === 0 ? 50 : 1100;
            const destroyTooltip = () => {
                if (this.tooltip) {
                    try {
                        this.tooltip.destroy();
                    } catch (e) {}
                    this.tooltip = null;
                }
            };

            const holdersForDisplay = (Array.isArray(this.holders) ? this.holders.slice() : []).filter(u => u && u._owner === this.currentPlayer);

            holdersForDisplay.forEach((unit, displayIndex) => {
                try {
                    if (!unit) return;

                    // If keepSprite already represents this unit, reuse and reposition it
                    if (keepSprite && keepSprite._unitRef === unit) {
                        if (!this.holderSprites.includes(keepSprite)) this.holderSprites.push(keepSprite);
                        try {
                            keepSprite.x = holderBaseX;
                            keepSprite.y = 200 + displayIndex * 50;
                        } catch (e) {}
                        return;
                    }

                    // Avoid duplicates
                    if (this.holderSprites.some(s => s && s._unitRef === unit)) return;

                    // Create or reuse a sprite via helper
                    const sprite = this.ensureSpriteForUnit(unit, holderBaseX, 200 + displayIndex * 50, true);
                    if (!sprite) return;

                    // ensure interactive
                    try {
                        if (sprite.setInteractive) sprite.setInteractive();
                    } catch (e) {}

                    // Tooltip handling (hover) - only add once per sprite
                    if (!sprite._tooltipHandlersInstalled) {
                        const onHover = () => {
                            if (this._draggingHolder) return;
                            destroyTooltip();
                            const txt = this._formatUnitTooltip(unit);
                            try {
                                this.tooltip = this.add.text(sprite.x, sprite.y - 50, txt, {
                                    fontSize: 12,
                                    backgroundColor: '#000000',
                                    color: '#ffffff',
                                    fontFamily: this.PIXEL_FONT,
                                    wordWrap: { width: 280, useAdvancedWrap: true },
                                    padding: {
                                        x: 6,
                                        y: 4
                                    }
                                }).setOrigin(0.5);
                            } catch (e) {}
                        };
                        const onOut = () => destroyTooltip();
                        try {
                            sprite.on && sprite.on('pointerover', onHover);
                            sprite.on && sprite.on('pointerout', onOut);
                            sprite._tooltipHandlersInstalled = true;
                        } catch (e) {}
                    }

                    // DRAG START
                    const onPointerDown = (pointer) => {
                        try {
                            if (pointer && typeof pointer.leftButtonDown === 'function') {
                                if (!pointer.leftButtonDown()) return;
                            } else if (pointer && 'buttons' in pointer) {
                                if ((pointer.buttons & 1) !== 1) return;
                            }
                        } catch (e) {
                            /* continue defensively */
                        }

                        destroyTooltip();

                        // re-evaluate true index because holders array could have changed
                        const trueIndex = this.holders.indexOf(sprite._unitRef);
                        this._draggingHolder = {
                            sprite,
                            startX: sprite.x,
                            startY: sprite.y,
                            index: trueIndex
                        };

                        sprite.depth = 1000;
                    };

                    try {
                        sprite.off && sprite.off('pointerdown');
                    } catch (e) {}
                    try {
                        sprite.on && sprite.on('pointerdown', onPointerDown);
                    } catch (e) {}

                    // DRAG END (this is the full placement logic)
                    const onPointerUp = (pointer) => {
                        destroyTooltip();

                        if (!this._draggingHolder || this._draggingHolder.sprite !== sprite) {
                            this._draggingHolder = null;
                            try {
                                sprite.depth = 0;
                            } catch (e) {}
                            return;
                        }

                        const releaseX = pointer.worldX ?? sprite.x;
                        const releaseY = pointer.worldY ?? sprite.y;

                        const gridPos = (typeof this.worldToGrid === 'function') ?
                            this.worldToGrid(releaseX, releaseY) : {
                                row: Math.floor((releaseY - 150) / 60),
                                col: Math.floor((releaseX - 300) / 60)
                            };

                        let row = Number.isFinite(gridPos.row) ? gridPos.row : 0;
                        let col = Number.isFinite(gridPos.col) ? gridPos.col : 0;

                        row = Math.max(0, Math.min(this.GRID_ROWS - 1, row));
                        col = Math.max(0, Math.min(this.GRID_COLS - 1, col));

                        // safety: if grid cell doesn't exist, snap back
                        if (!this.grid[row] || !this.grid[row][col]) {
                            sprite.x = this._draggingHolder.startX;
                            sprite.y = this._draggingHolder.startY;
                            sprite.depth = 0;
                            this._draggingHolder = null;
                            return;
                        }

                        // occupied?
                        if (this.grid[row][col].unit) {
                            AlertManager.show(this, this._t('GAME_INVALID_PLACEMENT', 'Invalid placement!'));
                            sprite.x = this._draggingHolder.startX;
                            sprite.y = this._draggingHolder.startY;
                            sprite.depth = 0;
                            this._draggingHolder = null;
                            return;
                        }

                        const player = this.players[this.currentPlayer];
                        const isDefence = player.role === 'defence';
                        const centerCol = Math.floor(this.GRID_COLS / 2);
                        if ((isDefence && col >= centerCol) || (!isDefence && col <= centerCol)) {
                            AlertManager.show(this, this._t('GAME_INVALID_PLACEMENT', 'Invalid placement!'));
                            sprite.x = this._draggingHolder.startX;
                            sprite.y = this._draggingHolder.startY;
                            sprite.depth = 0;
                            this._draggingHolder = null;
                            return;
                        }

                        const tile = (typeof this.getTileXY === 'function') ?
                            this.getTileXY(row, col) : {
                                x: 300 + col * 60,
                                y: 150 + row * 60
                            };

                        sprite.x = tile.x;
                        sprite.y = tile.y + this.UNIT_Y_OFFSET;
                        sprite.setOrigin(0.5);

                        if (this.TILE_SIZE && sprite.setDisplaySize) {
                            const s = Math.max(8, Math.floor(this.TILE_SIZE * 0.8));
                            try {
                                sprite.setDisplaySize(s, s);
                            } catch (e) {}
                        }

                        // compute true index fresh (holders may have changed while dragging)
                        const unitRef = sprite._unitRef;
                        const unitIndex = this.holders.indexOf(unitRef);
                        if (unitIndex === -1) {
                            sprite.x = this._draggingHolder.startX;
                            sprite.y = this._draggingHolder.startY;
                            sprite.depth = 0;
                            this._draggingHolder = null;
                            return;
                        }

                        const unitObj = this.holders[unitIndex];

                        if (!this.grid[row]) this.grid[row] = [];
                        if (!this.grid[row][col]) this.grid[row][col] = {
                            sprite: null,
                            unit: null
                        };

                        this.grid[row][col].unit = unitObj;
                        this.grid[row][col].sprite = sprite;

                        unitObj.position = {
                            row,
                            col
                        };
                        if (!Number.isFinite(unitObj._placedWave)) unitObj._placedWave = this.currentWave;
                        unitObj.sprite = sprite;
                        this.units.push(unitObj);
                        try {
                            const playerName = this.players?.[this.currentPlayer]?.name || this._fmt('CONFIG_PLAYER_SHORT', 'P{0}', this.currentPlayer + 1);
                            const unitName = unitObj.fullName || unitObj.typeName || this._t('GENERIC_UNIT', 'Unit');
                            this.addHistoryEntry(this._fmt('HISTORY_PLAYED_UNIT', '{0} played {1} (row {2}, col {3})', playerName, unitName, row + 1, col + 1));
                        } catch (e) {}

                        this.holders.splice(unitIndex, 1);

                        // Ensure sprite is properly positioned and visible
                        sprite.x = tile.x;
                        sprite.y = tile.y + (this.UNIT_Y_OFFSET || 0);
                        sprite.setVisible(true);
                        sprite.setAlpha(1);
                        sprite.setScale(1);
                        sprite.clearTint();
                        sprite.setOrigin(0.5);

                        // Set proper display size for grid
                        if (this.TILE_SIZE && sprite.setDisplaySize) {
                            const s = Math.max(8, Math.floor(this.TILE_SIZE * 0.8));
                            sprite.setDisplaySize(s, s);
                        }

                        // Force immediate render update
                        if (sprite.scene && sprite.scene.sys && sprite.scene.sys.game) {
                            sprite.scene.sys.game.loop.wake();
                        }

                        // refresh visuals and hooks
                        this.updateHolders();
                        this.addUnitBars(unitObj, sprite);
                        SpecialEffectFactory.applyDamageBoostsToUnit(unitObj, this);
                        SpecialEffectFactory.handleOnPlace(unitObj, this);
                        sprite.depth = 10;  // Ensure it's above grid cells
                        
                        // Mark the sprite as placed so it won't be destroyed by updateHolders
                        sprite._isPlacedOnGrid = true;
                        
                        // Remove ALL interactive events from the placed sprite to prevent interaction
                        try {
                            sprite.removeAllListeners();
                            sprite.disableInteractive();
                        } catch (e) {}
                        
                        this._draggingHolder = null;
                        
                        // Update end turn button state after placement
                        if (typeof this.updateEndTurnButtonState === 'function') this.updateEndTurnButtonState();
                    };

                    // expose the drop handler so global pointerup can call it
                    sprite._onPointerUp = onPointerUp;

                    this.holderSprites.push(sprite);
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[updateHolders] per-unit error', e);
                }
            });
        } catch (e) {
            if (DEBUG_MODE) console.error('[updateHolders] fatal', e);
        }
    }

    placeUnit(row, col) {
        // Not used, since drag
    }

    update() {
        this.units.forEach(u => {
            if (typeof u.update === 'function') u.update();

            if (u.healthBar) {
                u.healthBar.width = (Math.max(0, u.currentHealth) / u.health) * 36;
            }
            if (u.ammoBar) {
                if (typeof u.currentAmmo === 'number' && typeof u.ammo === 'number' && u.ammo > 0) {
                    u.ammoBar.width = (u.currentAmmo / u.ammo) * 36;
                } else if (typeof u.currentAmmo === 'number') {
                    u.ammoBar.width = Math.max(0, Math.min(36, u.currentAmmo));
                }
            }
            if (u.reloadBar) {
                if (u.reloadDelay && u.reloadDelay > 0) {
                    u.reloadBar.width = ((u.reloadDelay - (u.reloadTimer || 0)) / u.reloadDelay) * 36;
                } else {
                    u.reloadBar.width = 0;
                }
            }
            
            // Update status effect visuals
            try {
                StatusEffectVisuals.updateUnitVisuals(u, this);
            } catch (e) {
                if (DEBUG_MODE) console.warn('[update] status visuals failed', e);
            }
            
            if (u.sprite) {
                try {
                    const isReloading = (typeof u.reloadTimer === 'number') && u.reloadTimer > 0;
                    if (isReloading) {
                        if (typeof u.sprite.setTint === 'function') {
                            u.sprite.setTint(0x666666);
                        } else if (typeof u.sprite.setFillStyle === 'function') {
                            try {
                                u._savedFill = u._savedFill ?? (u.fillColor || null);
                            } catch (e) {}
                            try {
                                u.sprite.setFillStyle(0x666666);
                            } catch (e) {}
                        }
                    } else {
                        if (typeof u.sprite.clearTint === 'function') {
                            u.sprite.clearTint();
                        } else if (typeof u.sprite.setFillStyle === 'function') {
                            if (u._savedFill) {
                                try {
                                    u.sprite.setFillStyle(u._savedFill);
                                } catch (e) {}
                            }
                        }
                    }

                    // Position sprite if unit has a logical position
                    if (u.position && typeof this.getTileXY === 'function') {
                        const t = this.getTileXY(u.position.row, u.position.col);
                        u.sprite.x = t.x;
                        u.sprite.y = t.y + (this.UNIT_Y_OFFSET || 0);
                        if (typeof this._positionUnitUI === 'function') {
                            try {
                                this._positionUnitUI(u);
                            } catch (e) {
                                if (DEBUG_MODE) console.warn('[update] _positionUnitUI failed', e);
                            }
                        } else {
                            if (u.healthBarBg) {
                                u.healthBarBg.x = u.sprite.x;
                                u.healthBarBg.y = u.sprite.y + 30;
                            }
                            if (u.healthBar) {
                                u.healthBar.x = u.sprite.x - 18;
                                u.healthBar.y = u.sprite.y + 30;
                            }
                            if (u.ammoBarBg) {
                                u.ammoBarBg.x = u.sprite.x;
                                u.ammoBarBg.y = u.sprite.y + 35;
                            }
                            if (u.ammoBar) {
                                u.ammoBar.x = u.sprite.x - 18;
                                u.ammoBar.y = u.sprite.y + 35;
                            }
                            if (u.reloadBarBg) {
                                u.reloadBarBg.x = u.sprite.x;
                                u.reloadBarBg.y = u.sprite.y + 40;
                            }
                            if (u.reloadBar) {
                                u.reloadBar.x = u.sprite.x - 18;
                                u.reloadBar.y = u.sprite.y + 40;
                            }
                        }
                    }
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[update] sprite handling failed for', u?.typeName, e);
                }
            }
        });
    }

    async endTurn() {
        if (this._combatInProgress) {
            if (DEBUG_MODE) console.log('[endTurn] Blocked: combat in progress');
            return;
        }
        
        // Get the player who is ending their turn (before we switch)
        const endingPlayer = this.players[this.currentPlayer];
        
        // Only block if a human player tries to end turn during AI's active turn
        if (endingPlayer && !endingPlayer.isAI && this._aiTurnInProgress) {
            if (DEBUG_MODE) console.log('[endTurn] Blocked: human tried to end turn during AI turn');
            return;
        }

        const myHolding = (this.holders || []).some(h => h._owner === this.currentPlayer);
        if (myHolding) {
            if (this._hasPlacementAvailableForCurrentPlayer()) {
                this.infoText.setText(this._t('GAME_DEPLOY_FIRST', 'Deploy all units first!'));
                return;
            }
        }

        if (!this.rolledThisTurn && !this.players[this.currentPlayer].isAI) {
            const myHolderCount = (this.holders || []).filter(h => h._owner === this.currentPlayer).length;
            const noPlacementAvailable = !this._hasPlacementAvailableForCurrentPlayer();
            if (!(myHolderCount >= 10 && noPlacementAvailable)) {
                this.infoText.setText(this._t('GAME_ROLL_FIRST', 'Roll dice first!'));
                return;
            } else {
                if (DEBUG_MODE) console.log('[EndTurn] skipping required roll due to max holders + no placements');
            }
        }

        this.currentPlayer = (this.currentPlayer + 1) % 2;
        const defenderIndex = this.players.findIndex(p => p.role === 'defence');

        if (this.currentPlayer === defenderIndex) {
            try {
                this._combatInProgress = true;

                try {
                    this.endTurnBtn.disableInteractive?.();
                } catch (e) {}
                try {
                    this.diceText.disableInteractive?.();
                } catch (e) {}

                // === PHASE 1: COMBAT RESOLUTION ===
                // Combat deals damage but does NOT finalize kills
                await CombatFactory.resolveCombat(this);

                // === PHASE 2: LIFECYCLE (Revive → Finalize Deaths) ===
                // Now process all units that died during combat
                const deadUnits = this.units.filter(u => u.currentHealth <= 0);

                for (const u of deadUnits) {
                    if (!u) continue;
                    if (!u._lastPosition && u.position) {
                        u._lastPosition = { ...u.position };
                    }

                    // Attempt revive first
                    const revived = SpecialEffectFactory.reviveUnit(u, this);
                    if (revived) {
                        if (DEBUG_MODE) console.log('[endTurn] unit revived', u.typeName);
                        continue;
                    }

                    // If revive failed but unit has exhausted all revive attempts, ensure it's fully cleaned up
                    const hasReviveEffect = Array.isArray(u.specialEffects) && u.specialEffects.some(e => e?.Type === 'Revive');
                    if (hasReviveEffect && u._reviveExhausted) {
                        if (DEBUG_MODE) console.log('[endTurn] revive exhausted for', u.typeName);
                    }

                    // No revive - finalize death
                    if (!u._beingRemoved) {
                        // Play combat death sound before removing unit
                        try {
                            if (this.sound) {
                                const deathSound = u.deathSound || u.DeathSound || 'unit_death';
                                this.sound.play(deathSound, { volume: 0.5 });
                            }
                        } catch (e) {
                            // Sound not available, continue silently
                        }
                        this._removeUnitCompletely(u);
                    }

                    // Update scores immediately when units are defeated
                    if (u.typeName in MonsterFactory.monsterData) {
                        this.defeatedMonsters++;
                        const defencePlayerIndex = this.players.findIndex(p => p.role === 'defence');
                        if (defencePlayerIndex >= 0) {
                            this.scores[defencePlayerIndex] += 2;
                        }
                        try {
                            const hasHumanDef = (this.players || []).some(p => p && p.role === 'defence' && !p.isAI);
                            if (hasHumanDef) GlobalAchievements.addMonsterDefeats(1);
                        } catch (e) {}
                    } else {
                        this.destroyedDefences++;
                        const monsterPlayerIndex = this.players.findIndex(p => p.role === 'monster');
                        if (monsterPlayerIndex >= 0) {
                            this.scores[monsterPlayerIndex] += 2;
                        }
                        try {
                            const hasHumanMon = (this.players || []).some(p => p && p.role === 'monster' && !p.isAI);
                            if (hasHumanMon) GlobalAchievements.addDefenceDefeats(1);
                        } catch (e) {}
                    }
                }

                // Filter out dead units after lifecycle processing
                this.units = this.units.filter(u => u.currentHealth > 0);

                // Tick reloads and lifespans (these don't deal damage)
                CombatFactory.tickReloads(this);
                CombatFactory.tickLifespans(this);

                // Update scores in real-time during combat
                this.updatePlayerBar();

                if (this.checkWin()) {
                    this.endGame(true);
                    return;
                }
                if (this.checkLose()) {
                    this.endGame(false);
                    return;
                }

                // Use a promise-based delayed call to ensure proper async flow
                await new Promise(resolve => {
                    this.time.delayedCall(1000, () => {
                        try {
                            const hasHuman = (this.players || []).some(p => p && !p.isAI);
                            if (hasHuman) GlobalAchievements.addWaves(1);
                        } catch (e) {}
                        this.currentWave++;
                        if (this.checkWin()) {
                            this.endGame(true);
                            resolve();
                            return;
                        }
                        this.startWave();
                        resolve();
                    });
                });
            } catch (e) {
                console.error('endTurn resolution error:', e);
                this._combatInProgress = false;
                throw e;
            } finally {
                this._combatInProgress = false;
                
                // Restore button states for the next player - ONLY if not transitioning to AI turn
                const nextPlayer = this.players[this.currentPlayer];
                if (nextPlayer && !nextPlayer.isAI) {
                    try {
                        this.setDiceTextState?.();
                    } catch (e) {}
                    try {
                        this.updateEndTurnButtonState?.();
                    } catch (e) {}
                }
            }
        } else {
            this.infoText.setText(this._fmt('GAME_WAVE_TURN', 'Wave {0}/{1} - {2}\'s turn', this.currentWave, this.waves, this.players[this.currentPlayer].name));
            const nextPlayer = this.players[this.currentPlayer];
            if (nextPlayer && !nextPlayer.isAI) {
                try {
                    this.setDiceTextState?.();
                } catch (e) {}
                try {
                    this.updateEndTurnButtonState?.();
                } catch (e) {}
            }
            this.startTurn();
        }
    }



    checkWin() {
        return this.currentWave > this.waves;
    }

    checkLose() {
        return this.units.some(u => u.typeName in MonsterFactory.monsterData && u.position.col <= 0);
    }

    endGame(win) {
        this.exitLocked = false;
        if (win) {
            this.scores[0] += this.currentWave * 2 + this.defeatedMonsters;
        } else {
            this.scores[1] += this.destroyedDefences + 10;
        }
        this.updatePlayerBar();
        const roles = (this.players || []).map(p => p?.role || 'unknown');
        const defenceIndex = roles.indexOf('defence');
        const monsterIndex = roles.indexOf('monster');
        const humanIndexes = (this.players || []).map((p, idx) => (p && !p.isAI ? idx : -1)).filter(idx => idx >= 0);
        const singleHumanIndex = humanIndexes.length === 1 ? humanIndexes[0] : null;
        let humanWin = !!win;
        if (singleHumanIndex !== null) {
            const humanRole = roles[singleHumanIndex];
            if (humanRole === 'monster') humanWin = !win;
            if (humanRole === 'defence') humanWin = !!win;
        }
        const displayWin = singleHumanIndex !== null ? humanWin : !!win;
        const tokens = this.defeatedMonsters + this.currentWave * 2;
        let challengeBonus = 0;
        if (this._challengeKey) {
            const result = ChallengeManager.recordResult(this._challengeKey, humanWin, {
                dateKey: this._challengeDateKey,
                reward: this._challengeReward
            });
            if (humanWin && result.rewardGranted) {
                challengeBonus = result.reward;
            }
        }
        const totalTokens = tokens + challengeBonus;
        const currentTokens = parseInt(localStorage.getItem('diceTokens')) || 0;
        localStorage.setItem('diceTokens', currentTokens + totalTokens);
        const totalTokensText = formatCompact(totalTokens);
        const rewardNote = challengeBonus > 0
            ? GlobalLocalization.format('GAME_CHALLENGE_BONUS', ' (+{0} challenge)', formatCompact(challengeBonus))
            : '';
        if (displayWin) {
            this.infoText.setText(GlobalLocalization.format('GAME_VICTORY_TOKENS', 'Victory! Earned {0} tokens{1}.', totalTokensText, rewardNote));
            if (this.debug) console.log(`[GameEnd] win=${!!win}, currentWave=${this.currentWave}, defeatedMonsters=${this.defeatedMonsters}, destroyedDefences=${this.destroyedDefences}, tokensEarned=${totalTokens}`);
        } else {
            this.infoText.setText(GlobalLocalization.format('GAME_DEFEAT_TOKENS', 'Defeat! Earned {0} tokens{1}.', totalTokensText, rewardNote));
            if (this.debug) console.log(`[GameEnd] win=${!!win}, currentWave=${this.currentWave}, defeatedMonsters=${this.defeatedMonsters}, destroyedDefences=${this.destroyedDefences}, tokensEarned=${totalTokens}`);
        }
        const winnerIndex = win ? defenceIndex : monsterIndex;
        try {
            if (Number.isInteger(winnerIndex) && this.players?.[winnerIndex] && !this.players[winnerIndex].isAI) {
                GlobalAchievements.addWin(1);
                if (win && this._challengeKey === 'deucifer') {
                    GlobalAchievements.maybeUnlock('hellscape');
                    GlobalAchievements.completeChallenge?.('deucifer');
                }
            }
        } catch (e) {}
        const mvpByPlayer = this._getMvpByPlayer();
        const stats = {
            names: (this.playerNames || this.names || []).slice(0, this.totalPlayers),
            roles,
            scores: (this.scores || []).slice(0, this.totalPlayers),
            defeatedMonsters: this.defeatedMonsters,
            destroyedDefences: this.destroyedDefences,
            waves: this.waves,
            finalWave: this.currentWave,
            tokensEarned: totalTokens,
            win: !!win,
            winnerIndex,
            mvpByPlayer,
            challengeKey: this._challengeKey || null,
            challengeReward: challengeBonus
        };
        try {
            this.registry.set('localPostGame', stats);
        } catch (e) {}

        this.cleanup();
        this.time.delayedCall(1500, () => {
            this.scene.start('LocalPostGameScene');
        });
    }

    // AI Difficulty Configuration
    static AI_DIFFICULTY = {
        baby: { thinkingTime: 3000, name: 'Baby' },
        easy: { thinkingTime: 2000, name: 'Easy' },
        medium: { thinkingTime: 1000, name: 'Medium' },
        hard: { thinkingTime: 750, name: 'Hard' },
        nightmare: { thinkingTime: 500, name: 'Nightmare' }
    };

    // Helper: Get thinking delay based on difficulty
    _getAIThinkingTime() {
        const diff = String(this.difficulty || 'medium').toLowerCase();
        return LocalGameScene.AI_DIFFICULTY[diff]?.thinkingTime || 1000;
    }

    // Helper: Get valid rows for AI placement based on difficulty
    _getAIValidRows(isDefence) {
        const diff = String(this.difficulty || 'medium').toLowerCase();
        const rowCount = this.GRID_ROWS || (this.grid ? this.grid.length : 5);
        const allRows = Array.from({ length: rowCount }, (_, i) => i);
        
        switch (diff) {
            case 'baby':
                return isDefence ? [0] : [Math.max(0, rowCount - 1)];
            case 'easy':
                return isDefence
                    ? [0, 1].filter(r => r < rowCount)
                    : [rowCount - 1, rowCount - 2].filter(r => r >= 0);
            case 'medium':
            case 'hard':
            case 'nightmare':
            default:
                return allRows;
        }
    }

    _getCenterOutRowOrder() {
        const rowCount = this.GRID_ROWS || (this.grid ? this.grid.length : 5);
        const center = (rowCount - 1) / 2;
        return Array.from({ length: rowCount }, (_, i) => i).sort((a, b) => {
            const da = Math.abs(a - center);
            const db = Math.abs(b - center);
            if (da === db) return a - b;
            return da - db;
        });
    }

    // Helper: Get row priority for AI placement
    _getAIRowPriority(isDefence) {
        const diff = String(this.difficulty || 'medium').toLowerCase();
        const validRows = this._getAIValidRows(isDefence);
        
        switch (diff) {
            case 'baby':
                // Single row, no priority needed
                return validRows;
            case 'easy':
                // Prioritize rows closest to center
                return isDefence
                    ? validRows.slice().sort((a, b) => a - b)
                    : validRows.slice().sort((a, b) => b - a);
            case 'medium':
                // Random shuffle for medium
                return Phaser.Utils.Array.Shuffle([...validRows]);
            case 'hard':
            case 'nightmare':
                // Strategic: center first, then spread out
                return this._getCenterOutRowOrder().filter(r => validRows.includes(r));
            default:
                return this._getCenterOutRowOrder();
        }
    }

    _getAISideColumns(isDefence) {
        const colCount = this.GRID_COLS || (this.grid && this.grid[0] ? this.grid[0].length : 9);
        const centerCol = Math.floor(colCount / 2);
        const cols = [];
        if (isDefence) {
            for (let c = 0; c < centerCol; c++) cols.push(c);
        } else {
            for (let c = centerCol + 1; c < colCount; c++) cols.push(c);
        }
        return cols;
    }

    _getAIFrontToBackColumns(isDefence) {
        const cols = this._getAISideColumns(isDefence);
        return isDefence ? cols.slice().sort((a, b) => b - a) : cols.slice().sort((a, b) => a - b);
    }

    _getAIBackToFrontColumns(isDefence) {
        const cols = this._getAIFrontToBackColumns(isDefence);
        return cols.slice().reverse();
    }

    _getAIMidOutColumns(isDefence) {
        const cols = this._getAISideColumns(isDefence);
        if (!cols.length) return cols;
        const mid = (cols[0] + cols[cols.length - 1]) / 2;
        return cols.slice().sort((a, b) => {
            const da = Math.abs(a - mid);
            const db = Math.abs(b - mid);
            if (da === db) return isDefence ? b - a : a - b;
            return da - db;
        });
    }

    _getAIUnitPlacementProfile(unit) {
        const range = Number(unit?.range ?? 0);
        const hasBlindSpot = !!unit?.hasBlindSpot || Number(unit?.blindRange || 0) > 0;
        const hasDeathDamage = Array.isArray(unit?.specialEffects) &&
            unit.specialEffects.some(e => e?.Type === 'DeathEffect' && Number(e?.DeathDamage || 0) > 0);
        const isTrap = !!unit?.canBeTrampled || hasDeathDamage;
        const isWall = !!unit?.dontAttack || unit?.damage === null || Number(unit?.damage || 0) === 0;
        const isLongRange = Number.isFinite(range) && range >= 6;
        const isShortRange = Number.isFinite(range) && range <= 2;
        const isSupport = Array.isArray(unit?.specialEffects) &&
            unit.specialEffects.some(e => ['HealAllies', 'DamageBooster', 'SummonUnit', 'Purge'].includes(e?.Type));
        const isFast = Number.isFinite(unit?.speed) && Number(unit.speed) >= 2;
        const isBackline = hasBlindSpot || !!unit?.backTargeting || isLongRange;
        const isFrontline = (isWall && !isSupport) || isTrap || isShortRange || isFast;

        const overrideMap = {
            ForceField: 'frontline',
            ShockBlaster: 'generalist',
            SniperTower: 'generalist',
            MicroSentry: 'generalist',
            Multishot: 'generalist',
            BoomCannon: 'generalist',
            LazorBeam: 'generalist',
            SIMO: 'generalist'
        };
        const override = unit?.typeName ? overrideMap[unit.typeName] : null;

        if (override) {
            return {
                isTrap,
                isWall,
                isLongRange,
                isShortRange,
                isSupport,
                isFast,
                isBackline: override === 'backline',
                isFrontline: override === 'frontline',
                isGeneralist: override === 'generalist'
            };
        }

        return {
            isTrap,
            isWall,
            isLongRange,
            isShortRange,
            isSupport,
            isFast,
            isBackline,
            isFrontline,
            isGeneralist: false
        };
    }

    _getAIColOrderForUnit(unit, isDefence) {
        const profile = this._getAIUnitPlacementProfile(unit);
        if (profile.isFrontline) return this._getAIFrontToBackColumns(isDefence);
        if (profile.isBackline || profile.isSupport) return this._getAIBackToFrontColumns(isDefence);
        if (profile.isGeneralist) return this._getAIMidOutColumns(isDefence);
        return this._getAIMidOutColumns(isDefence);
    }

    _getAIRowPriorityForUnit(isDefence, unit, analysis) {
        const diff = String(this.difficulty || 'medium').toLowerCase();
        const base = (diff === 'hard' || diff === 'nightmare')
            ? this._getStrategicRowPriority(isDefence, analysis || this._analyzeGridForPlacement(isDefence))
            : this._getAIRowPriority(isDefence);
        if (!analysis) return base;

        const profile = this._getAIUnitPlacementProfile(unit);
        const rank = (row) => base.indexOf(row);
        const threatEnabled = isDefence && (diff === 'hard' || diff === 'nightmare');
        const threatCol = (row) => {
            const col = analysis.enemyFrontCol?.[row];
            return Number.isFinite(col) ? col : 999;
        };
        if (profile.isFrontline || profile.isWall || profile.isTrap) {
            return base.slice().sort((a, b) => {
                if (threatEnabled) {
                    const ta = threatCol(a);
                    const tb = threatCol(b);
                    if (ta !== tb) return ta - tb;
                }
                const ea = Number(analysis.enemyPresence?.[a] || 0);
                const eb = Number(analysis.enemyPresence?.[b] || 0);
                if (ea === eb) return rank(a) - rank(b);
                return isDefence ? (eb - ea) : (ea - eb);
            });
        }
        if (profile.isBackline || profile.isSupport || profile.isLongRange) {
            return base.slice().sort((a, b) => {
                if (threatEnabled) {
                    const ta = threatCol(a);
                    const tb = threatCol(b);
                    if (ta !== tb) return ta - tb;
                }
                const ea = Number(analysis.enemyPresence?.[a] || 0);
                const eb = Number(analysis.enemyPresence?.[b] || 0);
                if (ea === eb) return rank(a) - rank(b);
                return isDefence ? (ea - eb) : (eb - ea);
            });
        }
        return base;
    }

    // Helper: Analyze grid for strategic placement (Hard/Nightmare)
    _analyzeGridForPlacement(isDefence) {
        const analysis = {
            weakLanes: [],
            strongLanes: [],
            emptyLanes: [],
            enemyPresence: {},
            friendlyPresence: {},
            enemyFrontCol: {}
        };

        const rowCount = this.GRID_ROWS || (this.grid ? this.grid.length : 5);
        const colCount = this.GRID_COLS || (this.grid && this.grid[0] ? this.grid[0].length : 9);
        for (let row = 0; row < rowCount; row++) {
            let enemyCount = 0;
            let friendlyCount = 0;
            let hasUnitInLane = false;
            let nearestEnemyCol = null;

            for (let col = 0; col < colCount; col++) {
                if (!this.grid[row]) continue;
                const cell = this.grid[row][col];
                if (cell && cell.unit) {
                    hasUnitInLane = true;
                    const unit = cell.unit;
                    const isUnitDefence = unit.typeName in DefenceFactory.defenceData;
                    
                    if (isDefence) {
                        if (!isUnitDefence) {
                            enemyCount++;
                            if (nearestEnemyCol === null || col < nearestEnemyCol) {
                                nearestEnemyCol = col;
                            }
                        } else {
                            friendlyCount++;
                        }
                    } else {
                        if (isUnitDefence) {
                            enemyCount++;
                            if (nearestEnemyCol === null || col > nearestEnemyCol) {
                                nearestEnemyCol = col;
                            }
                        } else {
                            friendlyCount++;
                        }
                    }
                }
            }

            analysis.enemyPresence[row] = enemyCount;
            analysis.friendlyPresence[row] = friendlyCount;
            analysis.enemyFrontCol[row] = nearestEnemyCol;

            if (!hasUnitInLane) {
                analysis.emptyLanes.push(row);
            } else if (enemyCount > friendlyCount) {
                analysis.weakLanes.push(row);
            } else if (friendlyCount > enemyCount) {
                analysis.strongLanes.push(row);
            }
        }

        return analysis;
    }

    // Helper: Get strategic row priority for Hard/Nightmare
    _getStrategicRowPriority(isDefence, analysis) {
        const diff = String(this.difficulty || 'medium').toLowerCase();
        const priority = [];
        const pushUnique = (items) => {
            if (!Array.isArray(items)) return;
            items.forEach((row) => {
                if (!priority.includes(row)) priority.push(row);
            });
        };

        const threatRows = (() => {
            const rows = Object.keys(analysis.enemyFrontCol || {}).map(r => Number(r));
            return rows
                .filter(r => Number.isFinite(r))
                .filter(r => Number.isFinite(analysis.enemyFrontCol?.[r]))
                .sort((a, b) => (analysis.enemyFrontCol[a] ?? 999) - (analysis.enemyFrontCol[b] ?? 999));
        })();
        const urgentThreats = threatRows.filter(r => (analysis.enemyFrontCol?.[r] ?? 99) <= 1);
        const nearThreats = threatRows.filter(r => (analysis.enemyFrontCol?.[r] ?? 99) > 1);

        if (diff === 'nightmare') {
            if (isDefence) {
                // Nightmare Defence: Stop nearest threats first
                pushUnique(urgentThreats);
                pushUnique(nearThreats);
                pushUnique(analysis.weakLanes);
                pushUnique(analysis.emptyLanes);
                const remaining = this._getCenterOutRowOrder().filter(r => !priority.includes(r));
                pushUnique(remaining);
            } else {
                // Nightmare Monster: Attack weak lanes (where defences are few)
                pushUnique(analysis.weakLanes);
                pushUnique(analysis.emptyLanes);
                const remaining = this._getCenterOutRowOrder().filter(r => !priority.includes(r));
                pushUnique(remaining);
            }
        } else if (diff === 'hard') {
            if (isDefence) {
                // Hard Defence: Protect weak points and react to nearest threats
                pushUnique(urgentThreats);
                pushUnique(nearThreats);
                pushUnique(analysis.weakLanes);
                pushUnique(analysis.emptyLanes);
                const remaining = this._getCenterOutRowOrder().filter(r => !priority.includes(r));
                pushUnique(remaining);
            } else {
                // Hard Monster: Target undefended lanes
                pushUnique(analysis.emptyLanes);
                pushUnique(analysis.weakLanes);
                const remaining = this._getCenterOutRowOrder().filter(r => !priority.includes(r));
                pushUnique(remaining);
            }
        }

        return priority.length > 0 ? priority : this._getCenterOutRowOrder();
    }

    // Helper: Place a unit on the grid with proper sprite handling
    // Uses EXACT same logic as player drag-and-drop placement in updateHolders
    _placeUnitOnGrid(unit, row, col) {
        const tilePos = this.getTileXY(row, col);
        const x = tilePos.x;
        const y = tilePos.y + (this.UNIT_Y_OFFSET || 0);

        // Get the correct sprite key from unit data
        let spriteKey = unit.displaySprite;
        const isDefence = unit.typeName in DefenceFactory.defenceData;

        // Verify the texture exists, fallback to a default if needed
        if (!spriteKey || !this.textures.exists(spriteKey)) {
            const factory = isDefence ? DefenceFactory : MonsterFactory;
            const data = factory?.getData?.(unit.typeName) || factory?.defenceData?.[unit.typeName] || factory?.monsterData?.[unit.typeName];
            spriteKey = data?.displaySprite || data?.DisplaySprite;

            if (!spriteKey || !this.textures.exists(spriteKey)) {
                if (DEBUG_MODE) console.warn('[_placeUnitOnGrid] Texture not found for unit', unit.typeName, 'using fallback');
                spriteKey = isDefence ? 'cannon' : 'goblin';
            }
        }

        // Create sprite using ensureSpriteForUnit for consistency with player placement
        // Pass false for isHolder since this is grid placement (y already includes UNIT_Y_OFFSET)
        let spr = this.ensureSpriteForUnit(unit, x, y, false);

        if (!spr) {
            if (DEBUG_MODE) console.warn('[_placeUnitOnGrid] Failed to create sprite for unit', unit.typeName);
            return false;
        }

        // Ensure sprite is properly positioned and visible - matches updateHolders logic
        spr.x = x;
        spr.y = y;
        spr.setVisible(true);
        spr.setAlpha(1);
        spr.setScale(1);
        spr.setOrigin(0.5);

        // Set proper display size for grid - matches updateHolders logic
        if (this.TILE_SIZE && spr.setDisplaySize) {
            const s = Math.max(8, Math.floor(this.TILE_SIZE * 0.8));
            spr.setDisplaySize(s, s);
        }
        if (spr.clearTint) spr.clearTint();
        spr.depth = 10;

        // Store reference to scene on unit for StatusEffectVisuals
        unit.scene = this;

        // Mark as placed so updateHolders won't destroy it
        spr._isPlacedOnGrid = true;
        spr._unitRef = unit;
        try {
            if (typeof spr.removeAllListeners === 'function') spr.removeAllListeners();
            if (typeof spr.disableInteractive === 'function') spr.disableInteractive();
            spr._tooltipHandlersInstalled = false;
        } catch (e) {}

        // Update unit data
        unit.position = { row, col };
        unit.sprite = spr;
        unit.displaySprite = spriteKey;
        if (!Number.isFinite(unit._placedWave)) unit._placedWave = this.currentWave;
        try {
            const playerName = this.players?.[this.currentPlayer]?.name || this._fmt('CONFIG_PLAYER_SHORT', 'P{0}', this.currentPlayer + 1);
            const unitName = unit.fullName || unit.typeName || this._t('GENERIC_UNIT', 'Unit');
            this.addHistoryEntry(this._fmt('HISTORY_PLAYED_UNIT', '{0} played {1} (row {2}, col {3})', playerName, unitName, row + 1, col + 1));
        } catch (e) {}

        // Update grid
        if (!this.grid[row]) this.grid[row] = [];
        if (!this.grid[row][col]) this.grid[row][col] = { sprite: null, unit: null };
        this.grid[row][col].unit = unit;
        this.grid[row][col].sprite = spr;

        // Add to units list
        this.units.push(unit);

        // Add UI bars and apply effects
        this.addUnitBars(unit, spr);
        SpecialEffectFactory.applyDamageBoostsToUnit(unit, this);
        SpecialEffectFactory.handleOnPlace(unit, this);

        // Remove from holders
        const idx = this.holders.indexOf(unit);
        if (idx !== -1) this.holders.splice(idx, 1);

        // Force immediate render update - matches updateHolders logic
        if (spr.scene && spr.scene.sys && spr.scene.sys.game) {
            spr.scene.sys.game.loop.wake();
        }

        return true;
    }

    async rollDice(force = false, luckFactor = 1, rerollPrototypeIndex = null) {
        const currentPlayerObj = this.players[this.currentPlayer];
        if (currentPlayerObj && currentPlayerObj.isAI && !force) {
            if (DEBUG_MODE) console.log('[rollDice] Blocked: human tried to roll during AI turn');
            return;
        }
        
        // Prevent roll dice during combat
        if (this._combatInProgress) {
            if (DEBUG_MODE) console.log('[rollDice] Blocked: combat in progress');
            return;
        }

        const myHolderCount = (this.holders || []).filter(h => h._owner === this.currentPlayer).length;
        if (myHolderCount >= 10) {
            this.infoText.setText(this._t('GAME_HOLDING_MAX', 'Holding max units - place some first!'));
            return;
        }

        if (this._diceRolling) return;
        this._diceRolling = true;

        // Play dice sound
        try {
            if (GlobalAudio && typeof GlobalAudio.playDice === 'function') {
                GlobalAudio.playDice(this);
            }
        } catch (e) {
            /* non-fatal */
        }

        // Determine which dice to roll
        const diceCount = this.diceCount || 1;
        const newDiceValues = [];
        
        // Luck factor affects chance of rolling a 6:
        // - luckFactor 2 (Nightmare) = 33.3% chance of rolling 6
        // - luckFactor 1 (Medium) = 16.67% chance (normal)
        // - luckFactor 0.5 (Baby) = 8.33% chance of rolling 6
        const rollSingleDie = () => {
            if (this.players[this.currentPlayer].isAI) {
                const roll = Math.random();
                const chanceOfSix = (1 / 6) * luckFactor;
                if (roll < chanceOfSix) {
                    return 6;
                } else {
                    return Phaser.Math.Between(1, 5);
                }
            } else {
                return Phaser.Math.Between(1, 6);
            }
        };

        const rerollIndices = Array.isArray(rerollPrototypeIndex)
            ? rerollPrototypeIndex.filter(i => Number.isInteger(i) && i >= 0)
            : (rerollPrototypeIndex !== null && rerollPrototypeIndex !== undefined ? [rerollPrototypeIndex] : null);

        if (rerollIndices && rerollIndices.length > 0) {
            rerollIndices.forEach((idx) => {
                if (idx >= 0 && idx < diceCount) {
                    newDiceValues[idx] = rollSingleDie();
                }
            });
            // Keep other dice values from the stored array
            for (let i = 0; i < diceCount; i++) {
                if (!rerollIndices.includes(i) && this.diceValues[i] !== undefined) {
                    newDiceValues[i] = this.diceValues[i];
                }
            }
        } else {
            // Normal roll - roll all dice
            for (let i = 0; i < diceCount; i++) {
                newDiceValues[i] = rollSingleDie();
            }
        }
        
        this.diceValues = newDiceValues;
        try {
            const playerName = this.players?.[this.currentPlayer]?.name || this._fmt('CONFIG_PLAYER_SHORT', 'P{0}', this.currentPlayer + 1);
            if (rerollIndices && rerollIndices.length > 0) {
                const vals = rerollIndices
                    .map(i => this.diceValues[i])
                    .filter(v => v !== undefined)
                    .map(v => String(v))
                    .join(', ');
                this.addHistoryEntry(this._fmt('HISTORY_REROLL_PROTO', '{0} rerolled proto: {1}', playerName, vals));
            } else {
                const values = this.diceValues.map(v => String(v)).join(', ');
                this.addHistoryEntry(this._fmt('HISTORY_ROLLED', '{0} rolled: {1}', playerName, values));
            }
        } catch (e) {}

        try {
            if (Array.isArray(this.diceSprites)) {
                for (let i = 0; i < this.diceCount; i++) {
                    if (this.diceSprites[i]) {
                        this.diceSprites[i].setVisible(true);
                        this.diceSprites[i].setTexture(`dice${this.diceValues[i]}`);
                    }
                }
                // Hide any dice beyond the configured count
                for (let i = this.diceCount; i < this.diceSprites.length; i++) {
                    if (this.diceSprites[i]) {
                        this.diceSprites[i].setVisible(false);
                    }
                }
            }
            // Only animate dice that were just rolled (not prototype re-rolls)
            if (!rerollIndices || rerollIndices.length === 0) {
                await animateDiceRoll(this, this.diceValues.slice(0, this.diceCount));
            } else {
                const prototypeOnly = new Array(this.diceCount).fill(null);
                for (let i = 0; i < this.diceCount; i++) {
                    if (rerollIndices.includes(i)) {
                        prototypeOnly[i] = this.diceValues[i];
                    } else if (this.diceValues[i] !== undefined) {
                        prototypeOnly[i] = { value: this.diceValues[i], static: true };
                    }
                }
                
                // Animate the prototype die roll
                await animateDiceRoll(this, prototypeOnly);
                
                // Ensure all dice sprites show correct values after animation
                for (let i = 0; i < this.diceCount; i++) {
                    if (this.diceSprites[i]) {
                        this.diceSprites[i].setVisible(true);
                        this.diceSprites[i].setTexture(`dice${this.diceValues[i]}`);
                    }
                }
                // Hide any dice beyond the configured count
                for (let i = this.diceCount; i < this.diceSprites.length; i++) {
                    if (this.diceSprites[i]) {
                        this.diceSprites[i].setVisible(false);
                    }
                }
            }
        } catch (e) {
            if (Array.isArray(this.diceSprites)) {
                for (let i = 0; i < this.diceCount; i++) {
                    if (this.diceSprites[i]) {
                        this.diceSprites[i].setTexture(`dice${this.diceValues[i]}`).setVisible(true);
                    }
                }
                // Hide any dice beyond the configured count
                for (let i = this.diceCount; i < this.diceSprites.length; i++) {
                    if (this.diceSprites[i]) {
                        this.diceSprites[i].setVisible(false);
                    }
                }
            }
        }

        // Process the roll results
        if (rerollIndices && rerollIndices.length > 0) {
            for (const idx of rerollIndices) {
                const newValue = this.diceValues[idx];
                
                if (newValue === 6) {
                    const protoLoadout = this.getLoadoutForPlayer(this.currentPlayer, true);
                    if (protoLoadout && protoLoadout.length > 0) {
                        const randomProto = protoLoadout[Phaser.Math.Between(0, protoLoadout.length - 1)];
                        if (randomProto) {
                            CombatFactory.summonUnit(this, randomProto);
                            if (DEBUG_MODE) console.log('[rollDice] Consecutive 6 bonus: summoned', randomProto);
                        }
                    }
                    this.prototypeDiceIndices = this.prototypeDiceIndices.filter(i => i !== idx);
                } else {
                    this.prototypeDiceIndices = this.prototypeDiceIndices.filter(i => i !== idx);
                    const unitType = this._getUnitFromDice(newValue, this.currentPlayer, true);
                    if (unitType) CombatFactory.summonUnit(this, unitType);
                }
            }
            
            // Check if all prototype dice have been resolved
            if (this.prototypeDiceIndices.length === 0) {
                this.rolledThisTurn = true;
            }
        } else {
            // Normal initial roll
            this.prototypeDiceIndices = [];
            
            for (let i = 0; i < this.diceCount; i++) {
                const diceValue = this.diceValues[i];
                
                if (diceValue === 6) {
                    this.prototypeDiceIndices.push(i);
                    this.rolledThisTurn = false;
                } else {
                    const unitType = this._getUnitFromDice(diceValue, this.currentPlayer, false);
                    if (unitType) CombatFactory.summonUnit(this, unitType);
                }
            }
            
            // If no prototype dice, we're done rolling
            if (this.prototypeDiceIndices.length === 0) {
                this.rolledThisTurn = true;
            }
        }

        this._diceRolling = false;
        if (typeof this.setDiceTextState === 'function') this.setDiceTextState();
        if (typeof this.updateEndTurnButtonState === 'function') this.updateEndTurnButtonState();
    }

    async doAITurn() {
        this._aiTurnInProgress = true;
        
        // Disable buttons during AI turn
        try {
            this.endTurnBtn.disableInteractive?.();
        } catch (e) {}
        try {
            this.diceText.disableInteractive?.();
        } catch (e) {}
        
        const diff = String(this.difficulty || 'medium').toLowerCase();
        const thinkingTime = this._getAIThinkingTime();
        
        // Show thinking text
        const thinkingName = this.players[this.currentPlayer]?.name || this._t('GAME_AI_LABEL', 'AI');
        const thinkingText = this.add.text(600, 100, this._fmt('GAME_AI_THINKING', '{0} is thinking...', thinkingName), {
            fontSize: '20px',
            color: '#ffff88',
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5);
        
        try {
            // Apply thinking delay based on difficulty
            await this._wait(thinkingTime);

            // Map difficulty to luck factor:
            // Baby: 0.5, Easy: 0.75, Medium: 1, Hard: 1.5, Nightmare: 2
            const luckFactorMap = {
                baby: 0.5,
                easy: 0.75,
                medium: 1,
                hard: 1.5,
                nightmare: 2
            };
            const luckFactor = luckFactorMap[diff] || 1;
            
            // Roll dice (supports multiple dice)
            await this.rollDice(true, luckFactor);
            
            // Handle prototype re-rolls for all dice that showed 6
            while (this.prototypeDiceIndices && this.prototypeDiceIndices.length > 0) {
                await this._wait(thinkingTime / 2);
                
                // Roll all prototype dice at once
                const indicesToRoll = [...this.prototypeDiceIndices];
                await this.rollDice(true, luckFactor, indicesToRoll);
            }

            this.rolledThisTurn = true;
            
            // Ensure dice text is updated after all prototype re-rolls are complete
            this.setDiceTextState();

            const player = this.players[this.currentPlayer];
            const isDefence = player.role === 'defence';
            const analysis = this._analyzeGridForPlacement(isDefence);
            const toPlace = (this.holders || []).filter(h => h._owner === this.currentPlayer);
            const threatEnabled = isDefence && (diff === 'hard' || diff === 'nightmare');

            for (const unit of toPlace) {
                if (thinkingTime > 500) {
                    await this._wait(200);
                }
                
                let placed = false;
                const rowPriority = this._getAIRowPriorityForUnit(isDefence, unit, analysis);
                const baseColOrder = this._getAIColOrderForUnit(unit, isDefence);
                
                // Standard placement for all difficulties
                if (!placed) {
                    for (let ri = 0; ri < rowPriority.length && !placed; ri++) {
                        const r = rowPriority[ri];
                        let colOrder = baseColOrder;
                        if (threatEnabled) {
                            const threatCol = analysis.enemyFrontCol?.[r];
                            if (Number.isFinite(threatCol)) {
                                colOrder = baseColOrder.slice().sort((a, b) => {
                                    const da = Math.abs(a - threatCol);
                                    const db = Math.abs(b - threatCol);
                                    if (da === db) return a - b;
                                    return da - db;
                                });
                            }
                        }
                        for (let ci = 0; ci < colOrder.length && !placed; ci++) {
                            const c = colOrder[ci];
                            if (!this.grid[r] || !this.grid[r][c]) continue;
                            if (!this.grid[r][c].unit) {
                                if (this._placeUnitOnGrid(unit, r, c)) {
                                    placed = true;
                                }
                            }
                        }
                    }
                }
            }
        } finally {
            thinkingText.destroy();

            // Only destroy holder sprites that are NOT placed on the grid
            // (placed unit sprites are managed by the grid and should not be destroyed here)
            if (this.holderSprites) {
                for (const s of this.holderSprites.slice()) {
                    if (!s) continue;
                    if (s._isPlacedOnGrid) continue;
                    let isInGrid = false;
                    for (const row of this.grid) {
                        for (const cell of row) {
                            if (cell && cell.sprite === s) {
                                isInGrid = true;
                                break;
                            }
                        }
                        if (isInGrid) break;
                    }
                    if (isInGrid) continue;
                    
                    try {
                        if (typeof s.removeAllListeners === 'function') {
                            try { s.removeAllListeners(); } catch (e) {}
                        }
                        if (s.destroy && s.scene) s.destroy();
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[doAITurn] destroy holder sprite failed', e);
                    }
                }
                this.holderSprites = [];
            }
            
            // Clear AI turn flag before calling endTurn
            this._aiTurnInProgress = false;
            
            // Ensure buttons are properly restored after AI turn
            try {
                this.setDiceTextState?.();
            } catch (e) {}
            try {
                this.updateEndTurnButtonState?.();
            } catch (e) {}
            
            this.endTurn();
        }
    }

    createPlayerBar() {
        if (Array.isArray(this.playerBar) && this.playerBar.length) {
            this.playerBar.forEach(item => {
                if (item.icon) item.icon.destroy();
                if (item.tag) item.tag.destroy();
                if (item.ring) item.ring.destroy();
                if (item.scoreText) item.scoreText.destroy();
                if (item.lineupContainer) item.lineupContainer.destroy();
            });
        }
        this.playerBar = [];

        const y = 850;
        const x0 = 200;
        const x1 = 1000;

        for (let i = 0; i < this.totalPlayers; i++) {
            const x = i === 0 ? x0 : x1;
            const iconKey = this.isAI[i] ? "botIcon" : "playerIcon";

            const icon = this.add.image(x, y, iconKey).setScale(0.7);
            const tag = this.add.text(x, y + 70, this.playerNames[i] || `P${i + 1}`, {
                fontSize: 28,
                color: '#ffffff'
            }).setOrigin(0.5);

            // scoreText sits above the icon
            const scoreText = this.add.text(x, y - 70, String(this.scores[i] || 0), {
                fontSize: 20,
                color: '#ffff88'
            }).setOrigin(0.5).setVisible(true);

            const ring = this.add.rectangle(x, y, 90, 90, 0x66ccff, 0.25)
                .setStrokeStyle(3, 0x66ccff)
                .setVisible(false);

            // Create lineup display container
            const lineupContainer = this.add.container(0, 0);
            this._createLineupDisplay(lineupContainer, i, x, y);

            this.playerBar.push({
                ring,
                icon,
                tag,
                scoreText,
                lineupContainer
            });
        }

        // initial sync
        this.updatePlayerBar();
    }

    _createHistoryLogUI() {
        const centerX = this.cameras?.main?.centerX ?? 600;
        const centerY = this.cameras?.main?.centerY ?? 450;
        const width = 720;
        const height = 420;

        const bg = this.add.rectangle(centerX, centerY, width, height, 0x000000, 0.8)
            .setStrokeStyle(2, 0xffffff);
        const title = this.add.text(centerX, centerY - height / 2 + 18, this._t('GAME_HISTORY_LOG', 'History Log'), {
            fontSize: 20,
            color: '#ffffff',
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5, 0);

        const body = this.add.text(centerX - width / 2 + 20, centerY - height / 2 + 60, '', {
            fontSize: 16,
            color: '#ffffff',
            wordWrap: { width: width - 40 },
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0, 0);

        const closeBtn = this.add.text(centerX + width / 2 - 12, centerY - height / 2 + 8, this._t('UI_CLOSE_SHORT', 'X'), {
            fontSize: 18,
            color: '#ff6666',
            fontFamily: this.PIXEL_FONT
        }).setOrigin(1, 0).setInteractive();

        closeBtn.on('pointerdown', () => {
            this._toggleHistoryLog(false);
        });

        this._historyLogContainer = this.add.container(0, 0, [bg, title, body, closeBtn]);
        this._historyLogContainer.setDepth(2000);
        this._historyLogContainer.setVisible(false);
        this._historyLogText = body;

        this._historyLogButton = this.add.text(1150, 90, this._t('GAME_LOG_BUTTON', 'Log'), {
            fontSize: 18,
            color: '#ffff66',
            fontFamily: this.PIXEL_FONT
        }).setOrigin(1, 0).setInteractive();

        this._historyLogButton.on('pointerdown', () => {
            this._toggleHistoryLog();
        });
    }

    _bindHistoryLogHotkey() {
        if (!this.input || !this.input.keyboard) return;
        if (this._onHistoryLogKey) return;
        this._onHistoryLogKey = (event) => {
            if (event && event.repeat) return;
            this._toggleHistoryLog();
        };
        this.input.keyboard.on('keydown-L', this._onHistoryLogKey, this);
    }

    _bindExitHotkey() {
        if (!this.input || !this.input.keyboard) return;
        if (this._onEscKey) return;
        this._onEscKey = (event) => {
            if (event && event.repeat) return;
            if (this._historyLogContainer && this._historyLogContainer.visible) {
                this._escExitArmed = false;
                this._toggleHistoryLog(false);
                return;
            }
            if (this._escExitArmed) {
                this._escExitArmed = false;
                this._exitModalActive = false;
                this.cleanup();
                this.scene.start('LocalMenuScene');
                return;
            }
            this._escExitArmed = true;
            this.showConfirmExit();
        };
        this.input.keyboard.on('keydown-ESC', this._onEscKey, this);
    }

    _toggleHistoryLog(forceVisible = null) {
        if (!this._historyLogContainer) return;
        const nextVisible = (forceVisible === null) ? !this._historyLogContainer.visible : !!forceVisible;
        this._historyLogContainer.setVisible(nextVisible);
        this._historyLogVisible = nextVisible;
        if (nextVisible) this._refreshHistoryLogText();
        try {
            if (GlobalAudio && typeof GlobalAudio.playButton === 'function') {
                GlobalAudio.playButton(this);
            }
        } catch (e) {}
    }

    _refreshHistoryLogText() {
        if (!this._historyLogText) return;
        const maxLines = 14;
        const lines = this._historyLog.slice(-maxLines);
        this._historyLogText.setText(lines.join('\n'));
    }

    addHistoryEntry(text) {
        if (!text) return;
        this._historyLog.push(text);
        if (this._historyLog.length > this._historyLogMax) {
            this._historyLog.shift();
        }
        if (this._historyLogVisible) {
            this._refreshHistoryLogText();
        }
    }

    _createLineupDisplay(container, playerIndex, playerX, playerY) {
        container.removeAll(true);

        const player = this.players[playerIndex];
        if (!player) return;

        const isDefence = player.role === 'defence';
        const normalLoadout = player.normalLoadout || [];
        const protoLoadout = player.protoLoadout || [];

        // Position lineup to the side of the player avatar
        const isLeftSide = playerIndex === 0;
        const startX = isLeftSide ? playerX + 70 : playerX - 70 - (5 * 35);
        const startY = playerY - 25;

        // Normal loadout icons (5 slots)
        normalLoadout.forEach((unitType, idx) => {
            if (!unitType) return;
            const spriteKey = this._getUnitSpriteKey(unitType, isDefence);
            if (!spriteKey) return;

            const iconX = startX + (idx * 35);
            const iconY = startY;

            // Background for the icon
            const bg = this.add.rectangle(iconX, iconY, 30, 30, 0x333333, 0.8)
                .setStrokeStyle(1, 0x666666);
            container.add(bg);

            // Unit icon
            const icon = this.add.image(iconX, iconY, spriteKey)
                .setScale(0.4)
                .setOrigin(0.5);
            container.add(icon);

            // Dice pip requirement (1-5)
            const diceKey = `dice${idx + 1}`;
            if (this.textures && this.textures.exists(diceKey)) {
                const dice = this.add.image(iconX - 10, iconY - 10, diceKey)
                    .setScale(0.25)
                    .setOrigin(0.5);
                container.add(dice);
            }
        });

        // Proto loadout icons (5 slots, below normal)
        protoLoadout.forEach((unitType, idx) => {
            if (!unitType) return;
            const spriteKey = this._getUnitSpriteKey(unitType, isDefence);
            if (!spriteKey) return;

            const iconX = startX + (idx * 35);
            const iconY = startY + 35;

            // Background with proto tint (golden border)
            const bg = this.add.rectangle(iconX, iconY, 30, 30, 0x333333, 0.8)
                .setStrokeStyle(2, 0xffd700);
            container.add(bg);

            // Unit icon
            const icon = this.add.image(iconX, iconY, spriteKey)
                .setScale(0.4)
                .setOrigin(0.5);
            container.add(icon);

            // Dice pip requirement (proto roll 1-5)
            const diceKey = `dice${idx + 1}`;
            if (this.textures && this.textures.exists(diceKey)) {
                const dice = this.add.image(iconX - 10, iconY - 10, diceKey)
                    .setScale(0.25)
                    .setOrigin(0.5);
                container.add(dice);
            }
        });
    }

    getPlayerTintColor(playerIndex) {
        if (this.teamsEnabled && this.playerTeams) {
            const team = this.playerTeams[playerIndex] || (playerIndex % 2 === 0 ? 'blue' : 'red');
            return this.teamTints[team] || 0x66aaff;
        } else {
            return this.playerTints[playerIndex % this.playerTints.length] || 0x66aaff;
        }
    }

    updatePlayerBar() {
        const y = 850;
        const x0 = 200;
        const x1 = 1000;

        this.playerBar.forEach((p, index) => {
            const x = index === 0 ? x0 : x1;

            // reposition visuals in case layout changed
            if (p.icon) {
                p.icon.x = x;
                p.icon.y = y;
                p.icon.setVisible(index < this.totalPlayers);
            }
            if (p.tag) {
                p.tag.x = x;
                p.tag.y = y + 70;
                p.tag.setVisible(index < this.totalPlayers);
            }
            if (p.scoreText) {
                p.scoreText.x = x;
                p.scoreText.y = y - 70;
                p.scoreText.setVisible(index < this.totalPlayers);
            }
            if (p.ring) {
                p.ring.x = x;
                p.ring.y = y;
                p.ring.setVisible(index < this.totalPlayers);
            }

            // highlight active player and apply ring color based on team/position
            if (p.ring) {
                p.ring.setVisible(index === this.currentPlayer);
                const role = (this.players && this.players[index] && this.players[index].role) ? this.players[index].role : null;
                const ringColor = (role === 'defence') ? 0x66aaff : (role === 'monster' ? 0xff6666 : this.getPlayerTintColor(index));
                p.ring.setFillStyle(ringColor, 0.25);
                p.ring.setStrokeStyle(3, ringColor);
            }

            // supply name/avatar from playerSlots (keeps parity with OnlineGameScene approach)
            const slot = this.playerSlots && this.playerSlots[index] ? this.playerSlots[index] : null;
            if (slot) {
                if (p.icon) p.icon.setTexture(slot.avatar || 'playerIcon');
                if (p.tag) p.tag.setText(slot.name || `P${index + 1}`);
                const sc = (this.scores && typeof this.scores[index] === 'number') ? String(this.scores[index]) : '0';
                if (p.scoreText) p.scoreText.setText(sc).setVisible(true);

                if (slot.connected === false) {
                    if (p.tag) p.tag.setText(this._fmt('GAME_PLAYER_LEFT', '{0} (left)', slot.name));
                    if (p.scoreText) p.scoreText.setTint(0x444444);
                } else {
                    if (p.scoreText) p.scoreText.clearTint();
                }
            } else {
                if (p.tag) p.tag.setText(this.playerNames ? this.playerNames[index] || `P${index + 1}` : `P${index + 1}`);
                const sc = (this.scores && typeof this.scores[index] === 'number') ? String(this.scores[index]) : '0';
                if (p.scoreText) p.scoreText.setText(sc);
            }

            // Update lineup display
            if (p.lineupContainer) {
                p.lineupContainer.setVisible(index < this.totalPlayers);
                // Recreate lineup display to reflect any changes
                this._createLineupDisplay(p.lineupContainer, index, x, y);
            }
        });
    }

    addBackButton() {
        const back = this.add.text(50, 50, this._t('UI_BACK', '<- BACK'), {
            fontSize: 24,
            color: '#ff6666',
            fontFamily: this.PIXEL_FONT
        }).setInteractive();

        back.on('pointerdown', () => {
            GlobalAudio.playButton(this);

            if (!this.exitLocked) {
                this.scene.start('LocalConfigScene');
            } else {
                this.showConfirmExit();
            }
        });
    }

    showConfirmExit() {
        if (this._exitModalActive) return;
        this._exitModalActive = true;

        const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.8);

        const msg = this.add.text(600, 260,
            this._t('GAME_EXIT_CONFIRM', "Are you sure you want\n to return to the main menu?"), {
                fontSize: 26,
                align: 'center',
                fontFamily: this.PIXEL_FONT
            }
        ).setOrigin(0.5);

        const yesBtn = this.add.text(550, 340, this._t('UI_YES', 'Yes'), {
            fontSize: 28,
            color: '#66ff66',
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5).setInteractive();

        const noBtn = this.add.text(650, 340, this._t('UI_NO', 'No'), {
            fontSize: 28,
            color: '#ff6666',
            fontFamily: this.PIXEL_FONT
        }).setOrigin(0.5).setInteractive();

        yesBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this._escExitArmed = false;
            this._exitModalActive = false;
            this.cleanup();
            this.scene.start('LocalConfigScene');
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

    cleanup() {
        // stop any in-flight drag immediately
        try {
            if (this._draggingHolder) {
                const s = this._draggingHolder.sprite;
                if (s) {
                    try {
                        if (typeof s.removeAllListeners === 'function') s.removeAllListeners();
                    } catch (e) {}
                    try {
                        s.destroy();
                    } catch (e) {}
                }
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('[cleanup] while clearing dragging sprite', e);
        }
        this._draggingHolder = null;

        // remove global pointer handlers first (avoid races with pointer callbacks)
        try {
            if (this._manualDragInstalled) {
                if (this._onPointerMoveHandler) {
                    try {
                        this.input.off('pointermove', this._onPointerMoveHandler, this);
                    } catch (e) {}
                    this._onPointerMoveHandler = null;
                }
                if (this._onPointerUpHandler) {
                    try {
                        this.input.off('pointerup', this._onPointerUpHandler, this);
                    } catch (e) {}
                    this._onPointerUpHandler = null;
                }
                this._manualDragInstalled = false;
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('[cleanup] removing global handlers failed', e);
        }

        // Basic state reset
        this.currentWave = 1;
        this.currentPlayer = 0;
        this.waves = 20;
        this.switchSides = false;
        this.diceCount = 1;
        this.holders = [];
        this.diceValues = [];
        this.prototypeDiceIndices = [];
        this.rolledThisTurn = false;
        this.units = [];
        this.totalPlayers = 2;
        this.playerBar = [];
        this.scores = [0, 0];
        this.exitLocked = true;
        this.players = [];
        this.playerSlots = [];
        this.names = [];
        this.ai = [];
        this.difficulty = 'normal';
        this.defenceNormalLoadout = [];
        this.defenceProtoLoadout = [];
        this.monsterNormalLoadout = [];
        this.monsterProtoLoadout = [];
        this.defeatedMonsters = 0;
        this.destroyedDefences = 0;

        // destroy per-cell UI
        try {
            if (this.__boardCells) {
                this.__boardCells.forEach(c => {
                    try {
                        c.destroy();
                    } catch (e) {}
                });
                this.__boardCells = null;
            }
        } catch (e) {}

        // destroy grid cell sprites & clear references
        try {
            (this.grid || []).forEach(row => {
                (row || []).forEach(cell => {
                    if (!cell) return;
                    try {
                        if (cell.sprite) {
                            if (typeof cell.sprite.removeAllListeners === 'function') try {
                                cell.sprite.removeAllListeners();
                            } catch (e) {}
                            try {
                                cell.sprite.destroy();
                            } catch (e) {}
                        }
                    } catch (e) {}
                    cell.unit = null;
                    cell.sprite = null;
                });
            });
        } catch (e) {}

        // destroy unit UI elements
        try {
            (this.units || []).forEach(u => {
                try {
                    if (u.sprite) {
                        if (typeof u.sprite.removeAllListeners === 'function') u.sprite.removeAllListeners();
                        u.sprite.destroy();
                    }
                } catch (e) {}
                try {
                    if (u.healthBar) u.healthBar.destroy();
                } catch (e) {}
                try {
                    if (u.ammoBar) u.ammoBar.destroy();
                } catch (e) {}
                try {
                    if (u.healthBarBg) u.healthBarBg.destroy();
                } catch (e) {}
                try {
                    if (u.ammoBarBg) u.ammoBarBg.destroy();
                } catch (e) {}
                try {
                    if (u.reloadBar) u.reloadBar.destroy();
                } catch (e) {}
                try {
                    if (u.reloadBarBg) u.reloadBarBg.destroy();
                } catch (e) {}
            });
        } catch (e) {}

        // destroy holder sprites (and remove listeners)
        try {
            if (this.holderSprites) {
                this.holderSprites.forEach(s => {
                    try {
                        if (s) {
                            if (typeof s.removeAllListeners === 'function') try {
                                s.removeAllListeners();
                            } catch (e) {}
                            try {
                                s.destroy();
                            } catch (e) {}
                        }
                    } catch (e) {}
                });
                this.holderSprites = [];
            }
        } catch (e) {}

        // destroy remaining UI groups
        try {
            if (this.playerBar) {
                this.playerBar.forEach(p => {
                    try {
                        p.icon && p.icon.destroy();
                    } catch (e) {}
                    try {
                        p.tag && p.tag.destroy();
                    } catch (e) {}
                    try {
                        p.scoreText && p.scoreText.destroy();
                    } catch (e) {}
                    try {
                        p.ring && p.ring.destroy();
                    } catch (e) {}
                });
                this.playerBar = [];
            }
        } catch (e) {}

        try {
            if (Array.isArray(this.diceSprites)) {
                this.diceSprites.forEach(d => {
                    if (d) try { d.destroy(); } catch (e) {}
                });
                this.diceSprites = [];
            }
        } catch (e) {}
        try {
            if (this.diceText) this.diceText.destroy();
        } catch (e) {}
        try {
            if (this.endTurnBtn) this.endTurnBtn.destroy();
        } catch (e) {}
        try {
            if (this.infoText) this.infoText.destroy();
        } catch (e) {}

        // shop / selection / slot cleanup
        try {
            if (this.shopGroup) {
                try {
                    this.shopGroup.getChildren().forEach(c => {
                        try {
                            c.destroy();
                        } catch (e) {}
                    });
                } catch (e) {}
                try {
                    this.shopGroup.clear(true);
                } catch (e) {}
                this.shopGroup = null;
            }
        } catch (e) {}

        const destroyArraySprites = (arr) => {
            try {
                if (!Array.isArray(arr)) return;
                arr.forEach(s => {
                    try {
                        if (s) {
                            if (typeof s.removeAllListeners === 'function') try {
                                s.removeAllListeners();
                            } catch (e) {}
                            try {
                                s.destroy();
                            } catch (e) {}
                        }
                    } catch (e) {}
                });
            } catch (e) {}
        };

        destroyArraySprites(this.selectionSprites);
        this.selectionSprites = [];
        destroyArraySprites(this.unassignedSprites);
        this.unassignedSprites = [];
        destroyArraySprites(this.slotSprites);
        this.slotSprites = [];

        // tooltip
        try {
            if (this.tooltip) this.tooltip.destroy();
        } catch (e) {}
        this.tooltip = null;

        // history log UI
        try {
            if (this._historyLogContainer) this._historyLogContainer.destroy();
        } catch (e) {}
        try {
            if (this._historyLogButton) this._historyLogButton.destroy();
        } catch (e) {}
        this._historyLogContainer = null;
        this._historyLogButton = null;
        this._historyLogText = null;
        this._historyLog = [];
        try {
            if (this._onHistoryLogKey && this.input && this.input.keyboard) {
                this.input.keyboard.off('keydown-L', this._onHistoryLogKey, this);
            }
        } catch (e) {}
        this._onHistoryLogKey = null;
        try {
            if (this._onEscKey && this.input && this.input.keyboard) {
                this.input.keyboard.off('keydown-ESC', this._onEscKey, this);
            }
        } catch (e) {}
        this._onEscKey = null;
        this._escExitArmed = false;
        this._exitModalActive = false;
        this._exitModal = null;

        // clear grid data array contents safely
        try {
            for (let row = 0; row < (this.GRID_ROWS || (this.grid || []).length); row++) {
                for (let col = 0; col < (this.GRID_COLS || ((this.grid && this.grid[0]) || []).length); col++) {
                    try {
                        if (!this.grid[row]) this.grid[row] = [];
                        this.grid[row][col] = {
                            sprite: null,
                            unit: null
                        };
                    } catch (e) {}
                }
            }
        } catch (e) {}

        // clear puddles
        try {
            PuddleFactory.cleanupPuddles(this);
        } catch (e) {}

        // clear forcefields
        this.forceFields = {};

        // final safety: clear holders/units
        this.holders = [];
        this.units = [];
        this.puddles = [];
    }
}
