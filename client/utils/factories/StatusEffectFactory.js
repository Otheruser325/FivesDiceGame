import { DEBUG_MODE } from '../DebugManager.js';
import CombatFactory from './CombatFactory.js';
import DefenceFactory from './DefenceFactory.js';
import MonsterFactory from './MonsterFactory.js';
import SpecialEffectFactory from './SpecialEffectFactory.js';
import StatusEffectVisuals from '../StatusEffectVisuals.js';
import GlobalAchievements from '../AchievementsManager.js';

/**
 * Applies, ticks, and scales status effects across units.
 */
export default class StatusEffectFactory {
    /**
     * Check if a unit is currently stunned.
     * This is the single source of truth for stun checking.
     * A unit is stunned if it has a Stun status with Duration > 0.
     * @param {Object} unit - Unit to check
     * @returns {boolean} True if stunned
     */
    static isUnitStunned(unit) {
        if (!unit || !Array.isArray(unit.status)) return false;
        return unit.status.some(s => (s.Type === 'Stun' || s.Type === 'Frozen') && (s.Duration || 0) > 0);
    }

    /**
     * Check if a unit is currently frozen.
     * @param {Object} unit - Unit to check
     * @returns {boolean} True if frozen
     */
    static isUnitFrozen(unit) {
        if (!unit || !Array.isArray(unit.status)) return false;
        return unit.status.some(s => s.Type === 'Frozen' && (s.Duration || 0) > 0);
    }

    /**
     * Check if a unit is currently charmed.
     * @param {Object} unit - Unit to check
     * @returns {boolean} True if charmed
     */
    static isUnitCharmed(unit) {
        if (!unit || !Array.isArray(unit.status)) return false;
        return unit.status.some(s => s.Type === 'Charm' && (s.Duration || 0) > 0);
    }

    /**
     * Check if a unit is currently undetectable.
     * @param {Object} unit - Unit to check
     * @returns {boolean} True if undetectable
     */
    static isUnitUndetectable(unit) {
        if (!unit) return false;
        if (unit.isUndetectable) return true;
        if (!Array.isArray(unit.status)) return false;
        return unit.status.some(s => s.Type === 'Undetectable' && (s.Duration || 0) > 0);
    }

    /**
     * Apply a status object onto a target (adds or refreshes).
     * effect: { Type, Duration, Value, ... }
     * @param {Object} effect - Status effect payload
     * @param {Object} target - Target unit
     */
    static applyStatusToTarget(effect, target) {
        if (!effect || !target) return;

        // Make a shallow copy so we don't mutate the shared JSON definition
        const copy = {
            ...effect
        };

        if (!Array.isArray(target.status)) target.status = [];

        // Targeting filter for status effects (unit type / status requirements)
        if (copy.TargetingFilter && !SpecialEffectFactory._passesTargetingFilter(target, copy.TargetingFilter, copy._source)) {
            return;
        }

        // Percentage chance to apply (defaults to 1.0)
        const chance = (copy.PercentageChance !== undefined && copy.PercentageChance !== null) ? Number(copy.PercentageChance) : 1.0;
        const clampedChance = Math.max(0, Math.min(1, isNaN(chance) ? 1.0 : chance));
        if (clampedChance < 1.0) {
            const roll = Math.random();
            if (roll > clampedChance) {
                if (DEBUG_MODE) {
                    console.log('[Status][Chance] skipped', copy.Type, 'roll=', roll.toFixed(3), 'chance=', clampedChance);
                }
                return;
            }
        }

        // If target has Purge, block any new non-Purge statuses
        if (target.status.some(s => s.Type === 'Purge') && copy.Type !== 'Purge') {
            return;
        }

        // If applying Purge, clear all other statuses
        if (copy.Type === 'Purge') {
            target.status = [];
        }


        // Fire/Frozen conflict handling:
        // - If Frozen is applied to a burning unit, the fire goes out.
        // - If Fire is applied to a frozen unit, the unit instantly thaws.
        if (Array.isArray(target.status)) {
            if (effect.Type === 'Frozen') {
                const hadFire = target.status.some(s => s.Type === 'Fire' && (s.Duration || 0) > 0);
                if (hadFire) {
                    target.status = target.status.filter(s => s.Type !== 'Fire');
                    StatusEffectVisuals.spawnSteamPuff(target, target.scene);
                }
            } else if (effect.Type === 'Fire') {
                const hadFrozen = target.status.some(s => s.Type === 'Frozen' && (s.Duration || 0) > 0);
                if (hadFrozen) {
                    target.status = target.status.filter(s => s.Type !== 'Frozen');
                    StatusEffectVisuals.spawnSteamPuff(target, target.scene);
                }
            }
        }

        // Ensure the target has a status array
        if (!Array.isArray(target.status)) target.status = [];

        if (copy.Type === 'Poison') {
            const existingPoisonEffects = target.status.filter(s => s.Type === 'Poison');
            const maxReapplies = copy.MaxReapplies || 1;

            if (existingPoisonEffects.length < maxReapplies) {
                target.status.push(copy);
            } else {
                let shortestDurationEffect = existingPoisonEffects[0];
                for (let i = 1; i < existingPoisonEffects.length; i++) {
                    if (existingPoisonEffects[i].Duration < shortestDurationEffect.Duration) {
                        shortestDurationEffect = existingPoisonEffects[i];
                    }
                }
                shortestDurationEffect.Duration = copy.Duration;
                shortestDurationEffect.Value = copy.Value;
            }
            return;
        }
        if (copy.Type === 'Stun' || copy.Type === 'Frozen') {
            if (DEBUG_MODE) {
                console.log(`[Status][${copy.Type}] applied to ${target.typeName}, duration=${copy.Duration}`);
            }
        }

        const existing = target.status.find(s => s.Type === copy.Type);
        if (existing) {
            if (copy.CanReapply) {
                existing.Duration = Math.max(existing.Duration || 0, copy.Duration || 0);
                Object.keys(copy).forEach(k => {
                    if (k !== 'Type' && k !== 'Duration') existing[k] = copy[k];
                });
            } else {
                existing.Duration = Math.max(existing.Duration || 0, copy.Duration || 0);
            }
        } else {
            target.applyStatus(copy);
        }

        // Apply Slow immediately if newly applied during combat so reload timing is updated right away.
        if (copy.Type === 'Slow') {
            const slowStatus = target.status.find(s => s.Type === 'Slow');
            if (slowStatus && !slowStatus._applied) {
                const reloadIncrease = (slowStatus.Value !== undefined && slowStatus.Value !== null) ? Number(slowStatus.Value) : 1;
                const speedMultiplier = (slowStatus.SpeedReduction !== undefined && slowStatus.SpeedReduction !== null) ? Number(slowStatus.SpeedReduction) : 1;

                // Apply speed reduction
                if (typeof target.speed === 'number') {
                    if (target._baseSpeed === undefined) target._baseSpeed = target.speed;
                    const newSpeed = Math.max(0, (target._baseSpeed || target.speed) * speedMultiplier);
                    target.speed = newSpeed;
                }

                // Apply reload delay increase
                if (typeof target.reloadDelay === 'number' && target.reloadDelay > 0) {
                    if (target._baseReloadDelay === undefined) target._baseReloadDelay = target.reloadDelay;
                    target.reloadDelay = target._baseReloadDelay + reloadIncrease;
                }

                // If currently reloading, extend timer
                if (typeof target.reloadTimer === 'number' && target.reloadTimer > 0) {
                    target.reloadTimer += reloadIncrease;
                }

                slowStatus._applied = true;
                if (DEBUG_MODE) {
                    console.log(`[Status][Slow] applied immediately to ${target.typeName}, reload+${reloadIncrease}, speedMult=${speedMultiplier}`);
                }
            }
        }
    }

    /**
     * Get the wave scaling factor for status effect damage (Fire/Poison DoT).
     * CRITICAL: Wave scaling applies based on the SOURCE of the status effect, not the target.
     * Only status effects APPLIED BY monsters get wave scaling.
     * Status effects applied by defences (like Flamethrower's Fire) NEVER get wave scaling.
     *
     * @param {Object} statusEffect - The status effect object (with _source property)
     * @param {Object} scene - The game scene
     * @returns {number} - The scaling factor (1.0 = no scaling)
     */
    static _getWaveScaling(statusEffect, scene) {
        if (!scene) return 1;

        // Check the SOURCE of the status effect (who applied it)
        const sourceUnit = statusEffect?._source;
        if (!sourceUnit) {
            return 1;
        }

        const wave = CombatFactory.getUnitWave(sourceUnit, scene);
        if (wave <= 10) return 1;

        const monsterData = MonsterFactory.monsterData || {};
        const isSourceMonster = sourceUnit.typeName && (sourceUnit.typeName in monsterData);

        if (DEBUG_MODE) {
            console.log(`[_getWaveScaling] Source: ${sourceUnit.typeName} (isMonster=${isSourceMonster}), wave=${wave}`);
        }

        // Only apply scaling if the SOURCE is a monster
        if (isSourceMonster) {
            const scaling = CombatFactory.getWaveScalingFactor(wave, true);
            if (DEBUG_MODE) {
                console.log(`[_getWaveScaling] Applying scaling ${scaling} (source is monster)`);
            }
            return scaling;
        }

        return 1;
    }

    /**
     * Process status effects at the START of a wave (before combat).
     * This decrements durations and removes expired status effects.
     * This is called ONCE per wave, NOT during combat.
     *
     * IMPORTANT: This ensures that status effects like Stun (Duration=1) last for the entire
     * combat phase and only expire at the start of the NEXT wave, allowing them to properly
     * block reload/summon actions during the current wave.
     * @param {Object|null} scene - Active scene
     */
    static tickStatusEffectsAtWaveStart(scene = null) {
        if (!scene || !Array.isArray(scene.units)) return;

        // Track units that died from DoT for cleanup
        const unitsToCleanup = [];

        for (const unit of scene.units) {
            if (!unit || unit._beingRemoved) continue;

            if (unit.isUndetectable && (!Array.isArray(unit.status) || !unit.status.some(s => s.Type === 'Undetectable'))) {
                unit.status = Array.isArray(unit.status) ? unit.status : [];
                unit.status.push({ Type: 'Undetectable', Duration: 1, _permanent: true });
            }

            // Work on a shallow copy so we can safely mutate durations on the originals
            const statuses = Array.isArray(unit.status) ? unit.status.slice() : [];

            for (let i = 0; i < statuses.length; i++) {
                const s = statuses[i];
                if (!s || typeof s.Type !== 'string') continue;

                switch (s.Type) {
                    case 'Stun':
                        if (s.Duration && s.Duration > 0) {
                            s.Duration = Math.max(0, (s.Duration || 0) - 1);
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Stun] ${unit.fullName} remainingDuration=${s.Duration}`);
                        }
                        break;
                    case 'Frozen':
                        if (s.Duration && s.Duration > 0) {
                            s.Duration = Math.max(0, (s.Duration || 0) - 1);
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Frozen] ${unit.fullName} remainingDuration=${s.Duration}`);
                        }
                        break;
                    case 'Undetectable':
                        if (s._permanent || unit.isUndetectable) {
                            if (!s.Duration || s.Duration <= 0) s.Duration = 1;
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Undetectable] ${unit.fullName} permanent`);
                        } else if (s.Duration && s.Duration > 0) {
                            s.Duration = Math.max(0, (s.Duration || 0) - 1);
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Undetectable] ${unit.fullName} remainingDuration=${s.Duration}`);
                        }
                        break;

                    case 'Fire': {
                        const base = s.Value || 0;
                        const waveScaling = StatusEffectFactory._getWaveScaling(s, scene);
                        let final = Math.round(base * waveScaling);
                        if (final > 0) {
                            const preHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                            unit.currentHealth = Math.max(0, unit.currentHealth - final);
                            const postHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                            const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, final);
                            unit._pendingStatusDamage = (unit._pendingStatusDamage || 0) + final;
                            if (scene && typeof scene._trackDamage === 'function') {
                                scene._trackDamage(s._source, dealt);
                            }
                            const sourceName = s._source?.typeName || 'unknown';
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Fire] ${unit.fullName} takes ${final} fire dmg (base=${base}, scaling=${waveScaling.toFixed(2)}, source=${sourceName}) -> hp=${unit.currentHealth}/${unit.health}`);
                            if (unit.currentHealth <= 0 && !unitsToCleanup.includes(unit)) {
                                unitsToCleanup.push(unit);
                            }
                        }
                        s.Duration = Math.max(0, (s.Duration || 0) - 1);
                        if (DEBUG_MODE) console.log(`[Status][WaveStart][Fire] ${unit.fullName} remainingDuration=${s.Duration}`);
                        break;
                    }

                    case 'Poison': {
                        const base = s.Value || 0;
                        const waveScaling = StatusEffectFactory._getWaveScaling(s, scene);
                        let final = Math.round(base * waveScaling);
                        if (final > 0) {
                            const preHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                            unit.currentHealth = Math.max(0, unit.currentHealth - final);
                            const postHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                            const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, final);
                            unit._pendingStatusDamage = (unit._pendingStatusDamage || 0) + final;
                            if (scene && typeof scene._trackDamage === 'function') {
                                scene._trackDamage(s._source, dealt);
                            }
                            const sourceName = s._source?.typeName || 'unknown';
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Poison] ${unit.fullName} takes ${final} poison dmg (base=${base}, scaling=${waveScaling.toFixed(2)}, source=${sourceName}) -> hp=${unit.currentHealth}/${unit.health}`);
                            if (unit.currentHealth <= 0 && !unitsToCleanup.includes(unit)) {
                                unitsToCleanup.push(unit);
                            }
                        }
                        s.Duration = Math.max(0, (s.Duration || 0) - 1);
                        if (DEBUG_MODE) console.log(`[Status][WaveStart][Poison] ${unit.fullName} remainingDuration=${s.Duration}`);
                        break;
                    }

                    case 'Acid':
                        unit.vulnerable = true;
                        if (s.BonusDamage) {
                            unit._acidBonusMultiplier = Number(s.BonusDamage) || 1.25;
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Acid] ${unit.fullName} acid applied with BonusDamage=${s.BonusDamage} -> multiplier=${unit._acidBonusMultiplier}`);
                        } else {
                            unit._acidBonusMultiplier = Number(s.BonusDamage) || 1.25;
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Acid] ${unit.fullName} acid applied with BonusDamage=${s.BonusDamage} -> multiplier=${unit._acidBonusMultiplier}`);
                        }
                        s.Duration = Math.max(0, (s.Duration || 0) - 1);
                        if (DEBUG_MODE) console.log(`[Status][WaveStart][Acid] ${unit.fullName} remainingDuration=${s.Duration}`);
                        break;

                    case 'Slow': {
                        const reloadIncrease = (s.Value !== undefined && s.Value !== null) ? Number(s.Value) : 1;
                        const speedMultiplier = (s.SpeedReduction !== undefined && s.SpeedReduction !== null) ? Number(s.SpeedReduction) : 1;

                        if (!s._applied) {
                            // Apply speed reduction
                            if (typeof unit.speed === 'number') {
                                if (unit._baseSpeed === undefined) unit._baseSpeed = unit.speed;
                                const newSpeed = Math.max(0, (unit._baseSpeed || unit.speed) * speedMultiplier);
                                unit.speed = newSpeed;
                                if (DEBUG_MODE) console.log(`[Status][WaveStart][Slow] ${unit.fullName} speed reduced from ${unit._baseSpeed} to ${unit.speed} (multiplier=${speedMultiplier})`);
                            }

                            // Apply reload delay increase - this directly modifies reloadDelay
                            // so that tickReloads will naturally take longer
                            if (typeof unit.reloadDelay === 'number' && unit.reloadDelay > 0) {
                                if (unit._baseReloadDelay === undefined) unit._baseReloadDelay = unit.reloadDelay;
                                unit.reloadDelay = unit._baseReloadDelay + reloadIncrease;
                                if (DEBUG_MODE) console.log(`[Status][WaveStart][Slow] ${unit.fullName} reloadDelay increased from ${unit._baseReloadDelay} to ${unit.reloadDelay} (+${reloadIncrease})`);
                            }

                            // If unit is currently reloading, extend the reload timer
                            if (typeof unit.reloadTimer === 'number' && unit.reloadTimer > 0) {
                                unit.reloadTimer += reloadIncrease;
                                if (DEBUG_MODE) console.log(`[Status][WaveStart][Slow] ${unit.fullName} reloadTimer extended by ${reloadIncrease} to ${unit.reloadTimer}`);
                            }

                            s._applied = true;
                        } else {
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Slow] ${unit.fullName} slow already applied`);
                        }

                        s.Duration = Math.max(0, (s.Duration || 0) - 1);

                        if (s.Duration === 0 && s._applied) {
                            // Restore speed
                            if (unit._baseSpeed !== undefined) {
                                if (DEBUG_MODE) console.log(`[Status][WaveStart][Slow] ${unit.fullName} slow expired, restoring speed to ${unit._baseSpeed}`);
                                unit.speed = unit._baseSpeed;
                                delete unit._baseSpeed;
                            }
                            // Restore reload delay
                            if (unit._baseReloadDelay !== undefined) {
                                if (DEBUG_MODE) console.log(`[Status][WaveStart][Slow] ${unit.fullName} slow expired, restoring reloadDelay to ${unit._baseReloadDelay}`);
                                unit.reloadDelay = unit._baseReloadDelay;
                                delete unit._baseReloadDelay;
                            }
                            s._applied = false;
                        } else {
                            if (DEBUG_MODE) console.log(`[Status][WaveStart][Slow] ${unit.fullName} remainingDuration=${s.Duration}`);
                        }
                        break;
                    }

                    default:
                        s.Duration = Math.max(0, (s.Duration || 0) - 1);
                        if (DEBUG_MODE) console.log(`[Status][WaveStart][${s.Type}] tick for ${unit.fullName}, remainingDuration=${s.Duration}`);
                        break;
                }
            }

            // Remove expired statuses once (after processing)
            const beforeCount = (unit.status || []).length;
            unit.status = (unit.status || []).filter(s => {
                if (s.Type === 'Stun' && (s.Duration || 0) === 0) {
                    if (DEBUG_MODE) console.log(`[Status][WaveStart][Stun] ${unit.fullName} stun expired, removing`);
                    return false;
                }
                if (s.Type === 'Frozen' && (s.Duration || 0) === 0) {
                    if (DEBUG_MODE) console.log(`[Status][WaveStart][Frozen] ${unit.fullName} frozen expired, removing`);
                    return false;
                }
                return (s.Duration || 0) > 0;
            });
            const afterCount = unit.status.length;
            if (DEBUG_MODE && beforeCount !== afterCount) {
                console.log(`[Status][WaveStart] cleaned up expired statuses on ${unit.fullName} (before=${beforeCount}, after=${afterCount})`);
            }

            // If acid expired, clear acid-related metadata
            if (!unit.status.some(s => s.Type === 'Acid')) {
                delete unit._acidBonusMultiplier;
                unit.vulnerable = false;
            }

            if (DEBUG_MODE) {
                const summary = (unit.status || []).map(s => `${s.Type}:${s.Duration}`).join(', ');
                console.log(`[Status][WaveStart][Summary] ${unit.fullName} statuses -> ${summary || 'none'}`);
            }
        }

        // Clean up units that died from DoT effects
        for (const unit of unitsToCleanup) {
            try {
                if (unit._beingRemoved) continue;
                unit._beingRemoved = true;

                // Trigger DeathEffect BEFORE cleaning up the unit
                // This ensures DeathEffect (heal/purge/damage) triggers on DoT death
                try {
                    if (DEBUG_MODE) console.log(`[Status][DeathEffect] triggering for ${unit.typeName} (died from DoT)`);
                    SpecialEffectFactory.handleOnDeath(unit, scene);
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[Status][DeathEffect] handleOnDeath failed', e);
                }

                // Clean up status effect visuals FIRST - before destroying sprite
                // This ensures particle effects are properly removed from the scene
                try {
                    if (DEBUG_MODE) console.log(`[Status][Cleanup] cleaning up visuals for ${unit.typeName}`);
                    StatusEffectVisuals.cleanupUnitVisuals(unit);
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[Status][Cleanup] cleanupUnitVisuals failed', e);
                }

                // Clear grid position immediately
                if (unit.position && scene.grid && scene.grid[unit.position.row] && scene.grid[unit.position.row][unit.position.col]) {
                    const cell = scene.grid[unit.position.row][unit.position.col];
                    if (cell.unit === unit) {
                        cell.unit = null;
                        cell.sprite = null;
                    }
                }

                // Destroy UI elements
                try {
                    if (unit.healthBar) { unit.healthBar.destroy(); unit.healthBar = null; }
                    if (unit.healthBarBg) { unit.healthBarBg.destroy(); unit.healthBarBg = null; }
                    if (unit.ammoBar) { unit.ammoBar.destroy(); unit.ammoBar = null; }
                    if (unit.ammoBarBg) { unit.ammoBarBg.destroy(); unit.ammoBarBg = null; }
                    if (unit.reloadBar) { unit.reloadBar.destroy(); unit.reloadBar = null; }
                    if (unit.reloadBarBg) { unit.reloadBarBg.destroy(); unit.reloadBarBg = null; }
                } catch (e) {}

                // Destroy sprite
                try {
                    if (unit.sprite) { unit.sprite.destroy(); unit.sprite = null; }
                } catch (e) {}

                // Remove from units array
                scene.units = scene.units.filter(u => u !== unit);

                if (typeof scene.addHistoryEntry === 'function') {
                    const unitName = unit.fullName || unit.typeName || 'Unit';
                    scene.addHistoryEntry(`${unitName} was defeated`);
                }

                if (DEBUG_MODE) console.log(`[Status][Cleanup] unit died from DoT: ${unit.typeName}`);
            } catch (e) {
                if (DEBUG_MODE) console.warn('[Status][Cleanup] failed to clean up unit', e);
            }
        }
    }

    /**
     * Convenience: apply all statusEffects from a unit onto a target (the "status templates" the unit has).
     * @param {Object} sourceUnit - Unit that owns the status effects
     * @param {Object} targetUnit - Target unit to receive statuses
     */
    static applyStatusEffectsFromSourceToTarget(sourceUnit, targetUnit) {
        if (!sourceUnit || !targetUnit || !Array.isArray(sourceUnit.statusEffects)) return;
        sourceUnit.statusEffects.forEach(effect => {
            if ((effect.Type === 'Fire' || effect.Type === 'Purge' || effect.Type === 'Stun' || effect.Type === 'Frozen' || effect.Type === 'Charm' || effect.Type === 'Undetectable' || effect.Type === 'Acid' || effect.Type === 'Slow') &&
                targetUnit.status.some(s => s.Type === effect.Type) && !effect.CanReapply) {
                return;
            }
            const copy = {
                ...effect
            };
            copy._source = sourceUnit;
            copy._baseValue = (effect.Value !== undefined) ? effect.Value : effect.Value;
            StatusEffectFactory.applyStatusToTarget(copy, targetUnit);

            if (copy.Type === 'Stun' || copy.Type === 'Frozen') {
                try {
                    const scene = sourceUnit?.sprite?.scene || targetUnit?.sprite?.scene || null;
                    if (!scene) return;
                    const ownerIndex = Number.isInteger(sourceUnit?._owner)
                        ? sourceUnit._owner
                        : (typeof scene._resolveOwnerIndexForUnit === 'function' ? scene._resolveOwnerIndexForUnit(sourceUnit) : null);
                    if (!Number.isInteger(ownerIndex)) return;
                    const owner = scene.players?.[ownerIndex];
                    if (!owner || owner.isAI) return;

                    if (!targetUnit._achievementStunId) {
                        targetUnit._achievementStunId = `stun_${Math.random().toString(36).slice(2, 10)}`;
                    }
                    const waveKey = scene._matchId ? `${scene._matchId}:${scene.currentWave}` : `wave:${scene.currentWave || 0}`;
                    GlobalAchievements.recordWaveStun(waveKey, targetUnit._achievementStunId);
                } catch (e) {}
            }
        });
    }
}
