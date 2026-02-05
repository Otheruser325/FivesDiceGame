import { DEBUG_MODE } from '../DebugManager.js';
import ErrorHandler from '../ErrorManager.js';
import GlobalLocalization from '../LocalizationManager.js';
import BoardFactory from './BoardFactory.js';
import StatusEffectFactory from './StatusEffectFactory.js';
import SpecialEffectFactory from './SpecialEffectFactory.js';

/**
 * Loads defence definitions and creates Defence instances from type names.
 */
export default class DefenceFactory {
    static defenceData = {};

    /**
     * Load defence definitions from the manifest into defenceData.
     * @returns {Promise<void>}
     */
    static async loadData() {
        const response = await fetch('assets/gamedata/DefenceDefinitions/manifest.json');
        if (!response.ok) {
            ErrorHandler.logError('Failed to load defence manifest');
            return;
        }
        const manifest = await response.json();
        for (const file of manifest.files) {
            try {
                const res = await fetch(`assets/gamedata/DefenceDefinitions/${file}`);
                if (!res.ok) continue;
                const data = await res.json();
                this.validateData(data);
                this.defenceData[data.TypeName] = data;
            } catch (e) {
                ErrorHandler.logError(`Error loading ${file}: ${e.message}`);
            }
        }
    }

    /**
     * Validate a defence definition payload.
     * @param {Object} data - Defence definition
     */
    static validateData(data) {
        if (!data.TypeName || typeof data.Health !== 'number' || data.Health <= 0) {
            throw new Error(`Invalid Health for ${data.TypeName}`);
        }
        if (data.Damage !== null && (typeof data.Damage !== 'number' || data.Damage < 0)) {
            throw new Error(`Invalid Damage for ${data.TypeName}`);
        }
        if (data.Ammo !== null && (typeof data.Ammo !== 'number' || data.Ammo < 0)) {
            throw new Error(`Invalid Ammo for ${data.TypeName}`);
        }
    }

    /**
     * Create a Defence instance by type name.
     * @param {string} typeName - Defence type key
     * @returns {Object|null} Defence instance or null if missing
     */
    static create(typeName) {
        const data = this.defenceData[typeName];
        if (!data) {
            ErrorHandler.logError(`Defence type ${typeName} not found`);
            return null;
        }
        return new Defence(data);
    }

    /**
     * Get all defence type keys.
     * @returns {string[]}
     */
    static getAllTypes() {
        return Object.keys(this.defenceData);
    }

    /**
     * Get all proto defence definitions.
     * @returns {Object[]}
     */
    static getProtos() {
        return Object.values(this.defenceData).filter(d => d.IsProto);
    }

    /**
     * Get all normal (non-proto) defence definitions.
     * @returns {Object[]}
     */
    static getNormals() {
        return Object.values(this.defenceData).filter(d => !d.IsProto);
    }
}

class Defence {
    constructor(data) {
        this.typeName = data.TypeName;
        this.fullName = GlobalLocalization.t(`UNIT_${this.typeName}`, data.FullName || this.typeName);
        this.description = GlobalLocalization.t(`UNIT_DESC_${this.typeName}`, data.Description || this.fullName || this.typeName);
        this.rarity = data.Rarity;
        this.health = data.Health;
        this.damage = data.Damage;
        this.range = data.Range;
        this.ammo = data.Ammo;
        this.reloadDelay = data.ReloadDelay;
		this.hasLifespan = data.HasLifespan || false;
	    this.lifespan = data.Lifespan || null;
        this.targetingMode = data.TargetingMode;
        this.projectileSprite = data.ProjectileSprite;
        this.displaySprite = data.DisplaySprite;
        this.specialEffects = data.SpecialEffects || [];
        this.statusEffects = data.StatusEffects || [];
        this.dontAttack = !!data.DontAttack || this.specialEffects.some(e => e?.Type === 'NoAttack');
        this.canDetect = !!data.CanDetect;
        this.startsWithNoAmmo = !!data.StartsWithNoAmmo;
        this.removeWhenOutOfAmmo = !!data.RemoveWhenOutOfAmmo;
        this.isUndetectable = !!data.IsUndetectable;
        this.canBeTrampled = !!data.CanBeTrampled;
        this.isProto = data.IsProto;
        this.canTargetAdjacentLanes = data.CanTargetAdjacentLanes || false;
        this.hasBlindSpot = data.HasBlindSpot || false;
        this.blindRange = data.BlindRange || 1;
        this.backTargeting = data.BackTargeting || false;
        this.currentHealth = this.health;
        this.currentAmmo = this.ammo;
        this.reloadTimer = 0;
        if (this.startsWithNoAmmo && typeof this.ammo === 'number') {
            this.currentAmmo = 0;
            if (typeof this.reloadDelay === 'number' && this.reloadDelay > 0) {
                this.reloadTimer = this.reloadDelay;
            }
        }
        this.status = [];
        this.position = {
            row: 0,
            col: 0
        };
        this.stunTurns = 0;
        this.vulnerable = false;
        if (this.isUndetectable) {
            if (!this.status.some(s => s.Type === 'Undetectable')) {
                this.status.push({ Type: 'Undetectable', Duration: 1, _permanent: true });
            }
        }
    }

    attack(target, scene = null) {
        if (this.currentAmmo > 0 && this.reloadTimer === 0) {
            if (SpecialEffectFactory.canHit(this, target, scene)) {
                SpecialEffectFactory.resolveAttack(this, target, scene);
            }
            this.currentAmmo--;
            if (this.currentAmmo === 0) this.reloadTimer = this.reloadDelay;
        }
    }

    update() {}

    takeDamage(amount, attacker = null) {
        let multiplier = 1;
        const acid = this.status.find(s => s.Type === 'Acid');
        if (acid && acid.BonusDamage) {
            multiplier *= acid.BonusDamage;
        }
        this.currentHealth -= amount * multiplier;
    }

    applyStatus(effect) {
        const existing = this.status.find(s => s.Type === effect.Type);
        if (existing) {
            existing.Duration = effect.Duration;
        } else {
            this.status.push({
                ...effect
            });
        }
    }
}
