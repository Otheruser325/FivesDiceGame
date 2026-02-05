import { DEBUG_MODE } from '../DebugManager.js';
import GlobalSettings from '../SettingsManager.js';
import GlobalLocalization from '../LocalizationManager.js';
import DefenceFactory from './DefenceFactory.js';
import MonsterFactory from './MonsterFactory.js';
import StatusEffectFactory from './StatusEffectFactory.js';
import SpecialEffectFactory from './SpecialEffectFactory.js';

/**
 * Centralized combat logic used by scenes to resolve attacks, movement, and spawns.
 * All methods are static and expect the active scene to be passed in.
 */
export default class CombatFactory {
    /**
     * Get the wave index to use for a unit's scaling-based effects.
     * Prefers the wave when the unit was placed, then scaled/spawned wave, then current scene wave.
     * @param {Object|null} unit - Unit to inspect
     * @param {Object|null} scene - Active scene
     * @returns {number} Wave number (>=1)
     */
    static getUnitWave(unit, scene = null) {
        const fallback = (scene && typeof scene.currentWave === 'number') ? scene.currentWave : 1;
        if (!unit) return fallback;
        if (Number.isFinite(unit._placedWave)) return unit._placedWave;
        if (Number.isFinite(unit._waveScaledAt)) return unit._waveScaledAt;
        if (Number.isFinite(unit._spawnWave)) return unit._spawnWave;
        return fallback;
    }

    /**
     * Calculate wave scaling factor for monsters past wave 10.
     * Formula: 1 + 0.1 * (wave - 10) for waves > 10, otherwise 1.
     * @param {number} wave - Current wave number
     * @param {boolean} isMonster - Whether the unit is a monster (only monsters scale)
     * @returns {number} Scaling factor (1.0 or higher)
     */
    static getWaveScalingFactor(wave, isMonster = true) {
        if (!isMonster || wave <= 10) return 1;
        return 1 + 0.1 * (wave - 10);
    }

    /**
     * Apply wave scaling to a monster unit's stats.
     * Modifies health, damage, and currentHealth in place.
     * @param {Object} unit - The unit to scale
     * @param {number} wave - Current wave number
     * @param {boolean} isMonster - Whether this is a monster unit
     */
    static applyWaveScaling(unit, wave, isMonster = true) {
        if (!unit || !isMonster) return;
        const normalizedWave = Number.isFinite(wave) ? wave : 1;
        if (Number.isFinite(unit._waveScaledAt)) return;
        unit._waveScaledAt = normalizedWave;
        if (normalizedWave <= 10) return;
        
        const scaling = CombatFactory.getWaveScalingFactor(normalizedWave, true);
        if (scaling <= 1) return;
        
        // Store original base stats if not already stored (for revive consistency)
        if (!Number.isFinite(unit._originalBaseHealth) && unit.health) {
            unit._originalBaseHealth = unit.health;
        }
        if (!Number.isFinite(unit._originalBaseDamage) && unit.damage) {
            unit._originalBaseDamage = unit.damage;
        }
        
        // Apply scaling
        const baseHealth = Number.isFinite(unit._originalBaseHealth) ? unit._originalBaseHealth : unit.health;
        const baseDamage = Number.isFinite(unit._originalBaseDamage) ? unit._originalBaseDamage : unit.damage;
        unit.health = Math.round(baseHealth * scaling);
        unit.damage = Math.round(baseDamage * scaling);
        unit.currentHealth = unit.health;
        
        if (DEBUG_MODE) {
            console.log('[CombatFactory] Wave scaling applied', {
                unit: unit.typeName,
                wave: normalizedWave,
                scalingFactor: scaling,
                health: unit.health,
                damage: unit.damage
            });
        }
    }
    /**
     * Determine if two units are enemies (defence vs monster).
     * @param {Object} attacker - The unit performing an action
     * @param {Object} unit - Candidate target unit
     * @returns {boolean} True if the units are enemies
     */
    static _isEnemyUnit(attacker, unit) {
        if (!attacker || !unit) return true;
        const atkIsDef = (attacker.typeName in (DefenceFactory.defenceData || {}));
        if (atkIsDef) return (unit.typeName in (MonsterFactory.monsterData || {}));
        return (unit.typeName in (DefenceFactory.defenceData || {}));
    }

    /**
     * Apply all damage modifiers (armor, piercing, acid, multipliers) and return final damage.
     * @param {Object} attacker - Attacking unit
     * @param {Object} target - Target unit
     * @param {number} baseDamage - Raw damage before modifiers
     * @param {Object|null} scene - Active scene (for optional effect hooks)
     * @returns {number} Final rounded damage
     */
    static applyDamageModifiers(attacker = {}, target = {}, baseDamage = 0, scene = null) {
        return SpecialEffectFactory.applyDamageModifiers(attacker, target, baseDamage, scene);
    }

    /**
     * Decide whether an attacker can hit the target (Accuracy) and respect DontAttack.
     * @param {Object} attacker - Attacking unit
     * @param {Object} target - Target unit
     * @param {Object|null} scene - Active scene
     * @returns {boolean} True if the attack should hit
     */
    static canHit(attacker = {}, target = {}, scene = null) {
        return SpecialEffectFactory.canHit(attacker, target, scene);
    }

    /**
     * Show floating damage text if Visual Effects are enabled.
     * @param {Object} scene - Active scene
     * @param {Object} unit - Target unit to anchor the text
     * @param {number} amount - Damage amount to display
     */
    static _showDamage(scene, unit, amount) {
        if (!scene || !unit || (amount === undefined || amount === null)) return;
        try {
            const settings = GlobalSettings.get(scene) || {};
            const dmg = Math.max(0, Math.round(amount));
            if (dmg <= 0) return;

            if (typeof scene.addHistoryEntry === 'function') {
                const unitName = unit.fullName || unit.typeName || 'Unit';
                scene.addHistoryEntry(`${unitName} takes ${dmg} damage!`);
            }

            if (!settings.visualEffects) return;

            let x = unit.sprite?.x;
            let y = unit.sprite?.y;
            if (typeof x === 'undefined' || typeof y === 'undefined') {
                if (unit.position && typeof scene.getTileXY === 'function') {
                    const t = scene.getTileXY(unit.position.row, unit.position.col);
                    x = t.x;
                    y = t.y;
                } else {
                    return;
                }
            }

            const txt = scene.add.text(x, y - 10, `-${dmg}`, {
                fontSize: '18px',
                color: '#ffdddd',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0.5);

            scene.tweens.add({
                targets: txt,
                y: txt.y - 30,
                alpha: 0,
                duration: 900,
                ease: 'Cubic.easeOut',
                onComplete: () => txt.destroy()
            });
        } catch (e) {
            if (DEBUG_MODE) console.warn('showDamage failed', e);
        }
    }

    /**
     * Remove a unit immediately if it has RemoveWhenOutOfAmmo enabled.
     * @param {Object} unit - Unit that reached 0 ammo
     * @param {Object} scene - Active scene
     * @returns {boolean} True if unit was removed
     */
    static _removeUnitWhenOutOfAmmo(unit, scene) {
        if (!unit || !scene) return false;
        const flag = !!unit.removeWhenOutOfAmmo || !!unit.RemoveWhenOutOfAmmo;
        if (!flag) return false;

        try {
            if (typeof scene._removeUnitCompletely === 'function') {
                scene._removeUnitCompletely(unit);
                return true;
            }
        } catch (e) {}

        try {
            SpecialEffectFactory.handleOnDeath?.(unit, scene);
        } catch (e) {}
        try {
            SpecialEffectFactory.handleOnRemove?.(unit, scene);
        } catch (e) {}

        try {
            unit._beingRemoved = true;
            if (unit.position && scene.grid && scene.grid[unit.position.row] && scene.grid[unit.position.row][unit.position.col]) {
                const cell = scene.grid[unit.position.row][unit.position.col];
                if (cell.unit === unit) {
                    cell.unit = null;
                    cell.sprite = null;
                }
            }
        } catch (e) {}
        try {
            if (unit.sprite) unit.sprite.destroy();
        } catch (e) {}
        try {
            if (Array.isArray(scene.units)) scene.units = scene.units.filter(u => u !== unit);
        } catch (e) {}

        return true;
    }

    /**
     * Show a "Miss" floating text if visual effects are enabled.
     * @param {Object} scene - Active scene
     * @param {Object} unit - Target unit to anchor the text
     */
    static _showMiss(scene, unit) {
        if (!scene || !unit) return;
        try {
            const settings = GlobalSettings.get(scene) || {};
            if (!settings.visualEffects) return;

            let x = unit.sprite?.x;
            let y = unit.sprite?.y;
            if (typeof x === 'undefined' || typeof y === 'undefined') {
                if (unit.position && typeof scene.getTileXY === 'function') {
                    const t = scene.getTileXY(unit.position.row, unit.position.col);
                    x = t.x;
                    y = t.y;
                } else {
                    return;
                }
            }

            const txt = scene.add.text(x, y - 10, `Miss`, {
                fontSize: '16px',
                color: '#b5c01e',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0.5);

            scene.tweens.add({
                targets: txt,
                y: txt.y - 20,
                alpha: 0,
                duration: 700,
                ease: 'Cubic.easeOut',
                onComplete: () => txt.destroy()
            });
        } catch (e) {
            if (DEBUG_MODE) console.warn('showMiss failed', e);
        }
    }

    /**
     * Tick and resolve temporary unit lifespans, cleaning up any expired units.
     * @param {Object} scene - Active scene
     */
    static tickLifespans(scene) {
        if (!scene || !Array.isArray(scene.units)) return;
        const toExpire = [];

        // iterate copy to avoid mutation issues
        for (const u of Array.from(scene.units)) {
            try {
                if (!u || u._beingRemoved) continue;

                // Only treat as temporary if explicitly flagged OR an explicit positive numeric Lifespan was provided
                const explicitFlag = (u.HasLifespan === true) || (u.hasLifespan === true);
                const explicitValue = (Number.isFinite(u.Lifespan) && u.Lifespan > 0) || (Number.isFinite(u.lifespan) && u.lifespan > 0);

                if (!explicitFlag && !explicitValue) continue;

                // normalise _lifespan: prefer previously set _lifespan, then explicit fields (lifespan / Lifespan)
                if (u._lifespan === undefined || u._lifespan === null) {
                    let configured = undefined;
                    if (Number.isFinite(u.lifespan)) configured = Number(u.lifespan);
                    else if (Number.isFinite(u.Lifespan)) configured = Number(u.Lifespan);
                    u._lifespan = (configured !== undefined && configured !== null) ? Number(configured) : (explicitFlag ? (u._lifespan ?? undefined) : undefined);
                }

                if (typeof u._lifespan === 'number' && u._lifespan > 0) {
                    u._lifespan = Math.max(0, u._lifespan - 1);
                    if (DEBUG_MODE) console.log(`[Lifespan] ${u.typeName}'s lifespan=${u._lifespan}`);
                    if (u._lifespan === 0) {
                        u.currentHealth = 0;
                        toExpire.push(u);
                    }
                }
            } catch (e) {
                if (DEBUG_MODE) console.warn('[tickLifespans] per-unit error', e);
            }
        }

        // Immediately remove units whose lifespan expired to prevent lingering/attacking/bodyblocking
        for (const u of toExpire) {
            try {
                if (!u || u._beingRemoved) continue;
                if (DEBUG_MODE) console.log('[Lifespan] expiring', u.typeName, u.position);
                
                // Play lifespan death sound if available
                try {
                    if (scene.sound) {
                        const deathSound = u.deathSound || u.DeathSound || 'unit_death';
                        scene.sound.play(deathSound, { volume: 0.5 });
                    }
                } catch (e) {
                    // Sound not available, continue silently
                }
                
                // Mark unit as being removed to prevent further actions
                u._beingRemoved = true;
                
                // Clear grid position immediately to prevent bodyblocking
                if (u.position && scene.grid && scene.grid[u.position.row] && scene.grid[u.position.row][u.position.col]) {
                    const cell = scene.grid[u.position.row][u.position.col];
                    if (cell.unit === u) {
                        cell.unit = null;
                        cell.sprite = null;
                    }
                }
                
                // Destroy stat bars to prevent lingering UI elements
                try {
                    if (u.healthBar) { u.healthBar.destroy(); u.healthBar = null; }
                    if (u.healthBarBg) { u.healthBarBg.destroy(); u.healthBarBg = null; }
                    if (u.ammoBar) { u.ammoBar.destroy(); u.ammoBar = null; }
                    if (u.ammoBarBg) { u.ammoBarBg.destroy(); u.ammoBarBg = null; }
                    if (u.reloadBar) { u.reloadBar.destroy(); u.reloadBar = null; }
                    if (u.reloadBarBg) { u.reloadBarBg.destroy(); u.reloadBarBg = null; }
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[Lifespan] stat bar cleanup failed', e);
                }
                
                // Destroy sprite
                try {
                    if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[Lifespan] sprite cleanup failed', e);
                }
                
                // Trigger on-death effects
                try {
                    SpecialEffectFactory.handleOnDeath?.(u, scene);
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[Lifespan] handleOnDeath failed', e);
                }
                
                // Remove from units array immediately
                if (Array.isArray(scene.units)) {
                    scene.units = scene.units.filter(unit => unit !== u);
                }
            } catch (e) {
                if (DEBUG_MODE) console.warn('[tickLifespans] expiry handling failed', e);
            }
        }
    }

    /**
     * Tick reload timers and summon cooldowns for all units (stun-aware).
     * @param {Object} scene - Active scene
     */
    static tickReloads(scene) {
        if (!scene || !Array.isArray(scene.units)) return;
        
        if (DEBUG_MODE) {
            console.log(`[tickReloads] START - wave ${scene.currentWave}, ${scene.units.length} units`);
        }
        
        for (const u of Array.from(scene.units)) {
            try {
                if (!u || u._beingRemoved) continue;

                // ALWAYS check stun status first, before any other processing
                // This ensures stunned units never have their reload/summon decremented
                const isStunned = StatusEffectFactory.isUnitStunned(u);

                if (isStunned) {
                    if (DEBUG_MODE) {
                        const stunStatus = u.status?.find(s => s.Type === 'Stun');
                        console.log(`[tickReloads] BLOCKED: ${u.typeName} is stunned (stunTurns=${u.stunTurns}, _stunTurns=${u._stunTurns}, statusDuration=${stunStatus?.Duration})`);
                    }
                    continue;
                }

                // Process reload for non-stunned units only
                if (typeof u.reloadTimer === 'number' && u.reloadTimer > 0) {
                    const oldTimer = u.reloadTimer;
                    u.reloadTimer--;
                    if (DEBUG_MODE) {
                        console.log(`[tickReloads] ${u.typeName} reloadTimer: ${oldTimer} -> ${u.reloadTimer}`);
                    }
                    if (u.reloadTimer === 0 && u.ammo !== null && u.ammo !== undefined) {
                        u.currentAmmo = u.ammo;
                        if (DEBUG_MODE) {
                            console.log(`[tickReloads] ${u.typeName} RELOAD COMPLETE - ammo restored to ${u.currentAmmo}`);
                        }
                        try {
                            if (scene.sound) scene.sound.play('reload_complete', { volume: 0.4 });
                        } catch (e) {}
                    }
                }

                // Process summon cooldown for non-stunned units only
                // The cooldown is already modified by Slow status in tickStatusEffectsAtWaveStart
                // So we just decrement normally here
                if (typeof u._summonCooldown === 'number' && u._summonCooldown > 0) {
                    const oldCooldown = u._summonCooldown;
                    u._summonCooldown--;
                    if (DEBUG_MODE) {
                        console.log(`[tickReloads] ${u.typeName} summonCooldown: ${oldCooldown} -> ${u._summonCooldown}`);
                    }
                }
            } catch (e) {
                if (DEBUG_MODE) console.warn('[tickReloads] per-unit error', e);
            }
        }
        
        if (DEBUG_MODE) {
            console.log(`[tickReloads] END`);
        }
    }

    /**
     * Compute how many tiles a monster should move this wave.
     * Uses per-unit fractional accumulation so fractional speeds are consistent
     * regardless of the global wave number.
     * @param {Object} monster - Monster unit
     * @param {Object} scene - Active scene
     * @returns {number} Steps to move (0+)
     */
    static _getMonsterMoveSteps(monster, scene) {
        if (!monster || !Number.isFinite(monster.speed)) return 0;

        const speedAbs = Math.abs(monster.speed);
        const intSteps = Math.floor(speedAbs);
        let steps = intSteps;

        const frac = speedAbs - intSteps;
        if (frac > 0) {
            const acc = Number.isFinite(monster._fractionalMoveAcc) ? monster._fractionalMoveAcc : 0;
            const next = acc + frac;
            const extra = Math.floor(next);
            if (extra > 0) steps += extra;
            monster._fractionalMoveAcc = next - extra;
        } else if (!Number.isFinite(monster._fractionalMoveAcc)) {
            monster._fractionalMoveAcc = 0;
        }

        return steps;
    }

    /**
     * Move a monster leftwards according to its speed and grid collisions.
     * @param {Object} monster - Monster unit to move
     * @param {Object} scene - Active scene
     */
    static moveMonster(monster, scene, { direction = -1, ignoreForceFields = false, stepsOverride = null, maxSteps = null } = {}) {
        try {
            if (!monster || !scene) return;
            if (StatusEffectFactory.isUnitStunned(monster)) {
                if (DEBUG_MODE) console.log(`[moveMonster] BLOCKED: ${monster.typeName} is stunned`);
                return;
            }
            if (!monster.position || !Number.isFinite(monster.speed) || !Array.isArray(scene.grid)) return;

            const {
                row,
                col
            } = monster.position;

            let steps = Number.isFinite(stepsOverride) ? Math.max(0, Math.floor(stepsOverride)) : CombatFactory._getMonsterMoveSteps(monster, scene);
            if (Number.isFinite(maxSteps)) {
                steps = Math.min(steps, Math.max(0, Math.floor(maxSteps)));
            }

            if (steps <= 0) return;

            let newCol = col;
            for (let s = 0; s < steps; s++) {
                const nextCol = newCol + direction;
                if (nextCol < 0 || nextCol >= (scene.grid?.[0]?.length || scene.GRID_COLS || 9)) break;
                
                // Check for force field at this column (blocks ALL rows at this column)
                // Melee monsters should stop and attack the force field, not walk past it
                if (!ignoreForceFields) {
                    const ffList = scene.forceFields && scene.forceFields[nextCol];
                    if (ffList) {
                        const ffArray = Array.isArray(ffList) ? ffList : [ffList];
                        const activeForceField = ffArray.find(ff =>
                            ff &&
                            ff.currentHealth > 0 &&
                            SpecialEffectFactory._isEnemyUnit(monster, ff)
                        );
                        if (activeForceField) {
                            // Melee monster encounters force field - stop moving
                            // The monster will attack the force field in resolveCombat
                            if (DEBUG_MODE) console.log('[moveMonster] blocked by force field', monster.typeName, 'at col', nextCol);
                            break;
                        }
                    }
                }
                
                if (scene.grid[row] && scene.grid[row][nextCol] && scene.grid[row][nextCol].unit) {
                    const blocker = scene.grid[row][nextCol].unit;
                    if (blocker && (blocker.canBeTrampled || blocker.CanBeTrampled)) {
                        const pendingPos = { row, col: nextCol };
                        monster._pendingPosition = pendingPos;
                        try {
                            if (typeof scene._removeUnitCompletely === 'function') {
                                scene._removeUnitCompletely(blocker);
                            } else {
                                SpecialEffectFactory.handleOnDeath?.(blocker, scene);
                                SpecialEffectFactory.handleOnRemove?.(blocker, scene);
                                if (blocker.position && scene.grid[blocker.position.row] && scene.grid[blocker.position.row][blocker.position.col]) {
                                    const cell = scene.grid[blocker.position.row][blocker.position.col];
                                    if (cell.unit === blocker) {
                                        cell.unit = null;
                                        cell.sprite = null;
                                    }
                                }
                                if (blocker.sprite) blocker.sprite.destroy();
                                if (Array.isArray(scene.units)) scene.units = scene.units.filter(u => u !== blocker);
                            }
                        } catch (e) {
                            if (DEBUG_MODE) console.warn('[moveMonster] trample removal failed', e);
                        } finally {
                            if (monster._pendingPosition === pendingPos) {
                                delete monster._pendingPosition;
                            }
                        }

                        // If the explosion killed the monster, stop movement
                        if (monster._beingRemoved || monster.currentHealth <= 0) return;
                    } else {
                        break;
                    }
                }
                newCol = nextCol;
            }

            if (newCol === col) return;
            if (newCol < 0 || newCol >= (scene.grid[0]?.length || scene.GRID_COLS || 9)) return;

            // clear old cell references (do not destroy sprite)
            if (scene.grid[row] && scene.grid[row][col]) {
                scene.grid[row][col].unit = null;
                scene.grid[row][col].sprite = null;
            }

            // update logical position
            monster.position.col = newCol;

            // ensure destination cell exists
            if (!scene.grid[row]) scene.grid[row] = [];
            if (!scene.grid[row][newCol]) scene.grid[row][newCol] = {
                sprite: null,
                unit: null
            };

            scene.grid[row][newCol].unit = monster;
            scene.grid[row][newCol].sprite = monster.sprite;

            // move sprite visually and move bars to follow
            let txy;
            try {
                if (typeof scene.getTileXY === 'function') {
                    txy = scene.getTileXY(row, newCol);
                } else {
                    txy = {
                        x: (scene.GRID_OFFSET_X ?? 300) + newCol * (scene.TILE_SIZE ?? 60),
                        y: (scene.GRID_OFFSET_Y ?? 150) + row * (scene.TILE_SIZE ?? 60)
                    };
                }
            } catch (e) {
                txy = {
                    x: (scene.GRID_OFFSET_X ?? 300) + newCol * (scene.TILE_SIZE ?? 60),
                    y: (scene.GRID_OFFSET_Y ?? 150) + row * (scene.TILE_SIZE ?? 60)
                };
            }

            if (monster.sprite) {
                monster.sprite.x = txy.x;
                monster.sprite.y = (txy.y ?? 0) + (scene.UNIT_Y_OFFSET ?? 0);

                if (typeof monster.sprite.setDepth === 'function') {
                    monster.sprite.setDepth(monster.sprite.depth ?? 0);
                }

                try {
                    if (typeof scene._positionUnitUI === 'function') scene._positionUnitUI(monster);
                } catch (e) {
                    console.error('MonsterFactory.move: _positionUnitUI failed', e);
                }
            }

            if (typeof scene.addHistoryEntry === 'function') {
                const moved = Math.abs(newCol - col);
                if (moved > 0) {
                    const unitName = monster.fullName || monster.typeName || 'Monster';
                    scene.addHistoryEntry(
                        `${unitName} moved ${moved} tile${moved === 1 ? '' : 's'} (col ${col + 1} -> ${newCol + 1})`
                    );
                }
            }
        } catch (e) {
            console.error('MonsterFactory.move error:', e);
        }
    }

    /**
     * Main resolve helper used after picking a target.
     * Applies damage modifiers, shield handling (BlockAllLanes), AoE, statuses, lifesteal.
     * @param {Object} attacker - Attacking unit
     * @param {Object} target - Target unit
     * @param {Object|null} scene - Active scene
     */
    static resolveAttack(attacker, target, scene = null) {
        if (!attacker || !target) return;
        if (target.currentHealth <= 0) return;

        const base = (typeof attacker.damage === 'number') ? attacker.damage : 0;
        attacker._lastDamageDealtRaw = Math.max(0, Math.round(base));
        const finalDmg = CombatFactory.applyDamageModifiers(attacker, target, base, scene);

        // Handle force field interception
        const remainingDmg = SpecialEffectFactory.handleForceField(attacker, target, finalDmg, scene);
        const attackBlockedByShield = (remainingDmg <= 0 && finalDmg > 0);

        if (!attackBlockedByShield) {
            StatusEffectFactory.applyStatusEffectsFromSourceToTarget(attacker, target);
        } else if (attackBlockedByShield) {
            attacker._lastDamageDealt = attacker._lastDamageDealt || 0;
        }

        if (remainingDmg > 0) {
            const preHp = (typeof target.currentHealth === 'number') ? target.currentHealth : null;
            target.takeDamage(remainingDmg, attacker);
            attacker._lastDamageDealt = remainingDmg;
            const postHp = (typeof target.currentHealth === 'number') ? target.currentHealth : null;
            const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, remainingDmg);
            if (scene && typeof scene._trackDamage === 'function') {
                scene._trackDamage(attacker, dealt);
            }
        }

        CombatFactory._showDamage(scene, target, finalDmg);
        SpecialEffectFactory.applyOnHitEffects(attacker, target, scene);
    }

    /**
     * Choose a target from a list using a targeting mode.
     * @param {Object[]} enemies - Candidate targets
     * @param {string} mode - Targeting mode (First, Last, Weak, Strong, Any)
     * @param {Object|null} attacker - Optional attacker (for force-field interception)
     * @returns {Object|null} Selected target or null
     */
    static pickTargetByMode(enemies, mode = 'First', attacker = null) {
        if (!Array.isArray(enemies) || enemies.length === 0) return null;

        const forceFieldTarget = SpecialEffectFactory.interceptWithForceField(attacker, enemies, attacker?.sprite?.scene);
        if (forceFieldTarget) {
            return forceFieldTarget;
        }

        switch (mode) {
            case 'First':
                return enemies[0];
            case 'Last':
                return enemies[enemies.length - 1];
            case 'Weak':
                return enemies.reduce((a, b) => a.currentHealth < b.currentHealth ? a : b);
            case 'Strong':
                return enemies.reduce((a, b) => a.currentHealth > b.currentHealth ? a : b);
            case 'Any':
                return Phaser?.Utils?.Array?.GetRandom ? Phaser.Utils.Array.GetRandom(enemies) : enemies[Math.floor(Math.random() * enemies.length)];
            default:
                return enemies[0];
        }
    }

    /**
     * Queue a unit into the current player's holder list (summon to hand).
     * @param {Object} scene - Active scene
     * @param {string} type - Unit type name
     */
    static summonUnit(scene, type) {
        if (!scene) return;
        const player = scene.players?.[scene.currentPlayer];
        if (!player) return;
        const unit = player.role === 'defence' ? DefenceFactory.create(type) : MonsterFactory.create(type);
        if (!unit) return;

        // Apply wave scaling using CombatFactory for consistency
        const isMonsterUnit = player.role === 'monster';
        CombatFactory.applyWaveScaling(unit, scene.currentWave, isMonsterUnit);

        unit._owner = scene.currentPlayer;
        const ownerCount = (scene.holders || []).filter(h => h && h._owner === scene.currentPlayer).length;
        if (ownerCount >= 10) {
            if (!player.isAI && scene.infoText) {
                const t = (scene && typeof scene._t === 'function')
                    ? scene._t.bind(scene)
                    : (key, fallback) => GlobalLocalization.t(key, fallback);
                scene.infoText.setText(t('GAME_HOLDING_MAX', 'Holding max units - place some first!'));
            }
            return;
        }

        scene.holders.push(unit);
        if (typeof scene.updateHolders === 'function') scene.updateHolders();
    }

    /**
     * Spawn a unit directly onto the grid (used by Summon effects).
     * Finds a nearby empty cell if the target is occupied.
     * @param {Object} scene - Active scene
     * @param {string} typeName - Unit type name
     * @param {number} row - Target row
     * @param {number} col - Target column
     * @param {Object|null} summoner - Unit that caused the spawn (for faction/scaling)
     */
    static instantSpawnUnit(scene, typeName, row, col, summoner = null) {
        if (!scene) return;
        const isDefenceSummon = (summoner && (summoner.typeName in DefenceFactory.defenceData)) ||
            (summoner && summoner.isProto && summoner.displaySprite && summoner.displaySprite.includes('defence'));
        const role = isDefenceSummon ? 'defence' : 'monster';

        const player = scene.players?.[scene.currentPlayer];
        if (!player) return;
        const unit = (role === 'defence') ? DefenceFactory.create(typeName) : MonsterFactory.create(typeName);
        if (!unit) return;

        // Determine if this is a monster summon for wave scaling
        const summonerIsMonster = summoner && (summoner.typeName in MonsterFactory.monsterData);
        const isMonsterUnit = (role === 'monster');
        const sourceWave = CombatFactory.getUnitWave(summoner, scene);

        // Apply wave scaling using CombatFactory for consistency
        const shouldApplyScaling = isMonsterUnit && (summonerIsMonster || player.role === 'monster');
        CombatFactory.applyWaveScaling(unit, sourceWave, shouldApplyScaling);
        unit._spawnWave = sourceWave;
        if (!Number.isFinite(unit._placedWave)) unit._placedWave = sourceWave;

        // find an empty nearby cell if target occupied
        let targetRow = row;
        let targetCol = col;
        if (!scene.grid?.[targetRow]?.[targetCol] || scene.grid[targetRow][targetCol].unit) {
            let found = false;
            for (let r = Math.max(0, row - 1); r <= Math.min((scene.GRID_ROWS ?? 5) - 1, row + 1) && !found; r++) {
                for (let c = Math.max(0, col - 1); c <= Math.min((scene.GRID_COLS ?? 9) - 1, col + 1) && !found; c++) {
                    if (!scene.grid?.[r]?.[c]?.unit) {
                        targetRow = r;
                        targetCol = c;
                        found = true;
                    }
                }
            }
            if (!scene.grid?.[targetRow]?.[targetCol] || scene.grid[targetRow][targetCol].unit) return; // nowhere to spawn
        }

        const { x, y } = (typeof scene.getTileXY === 'function') ?
            scene.getTileXY(targetRow, targetCol) :
            { x: 300 + targetCol * 60, y: 150 + targetRow * 60 };

        const spr = (typeof scene.ensureSpriteForUnit === 'function') ?
            scene.ensureSpriteForUnit(unit, x, y, false) :
            null;

        if (spr && spr.setInteractive) {
            try { spr.setInteractive(); } catch (e) {}
        }
        if (spr) spr._onPointerUp = spr._onPointerUp || null;

        unit.position = { row: targetRow, col: targetCol };

        if (!scene.grid[targetRow]) scene.grid[targetRow] = [];
        if (!scene.grid[targetRow][targetCol]) scene.grid[targetRow][targetCol] = { sprite: null, unit: null };
        scene.grid[targetRow][targetCol].unit = unit;
        scene.grid[targetRow][targetCol].sprite = spr;

        scene.units = scene.units || [];
        scene.units.push(unit);

        if (typeof scene.addUnitBars === 'function') scene.addUnitBars(unit, spr);
        SpecialEffectFactory.applyDamageBoostsToUnit(unit, scene);
        SpecialEffectFactory.handleOnPlace(unit, scene);
    }

    /**
     * Resolve a full combat round (defence phase then monster phase).
     * @param {Object} scene - Active scene
     * @returns {Promise<void>} Resolves after combat finishes
     */
    static async resolveCombat(scene) {
        if (!scene) return;
        const wait = (typeof scene._wait === 'function') ?
            scene._wait.bind(scene) :
            (ms) => new Promise(resolve => setTimeout(resolve, ms));

        const columnDelay = 300;

        // Process defence columns left-to-right (from front columns toward center)
        const centerCol = Math.floor((scene.GRID_COLS ?? 9) / 2);
        const defCols = [];
        for (let c = 0; c < centerCol; c++) defCols.push(c);
        defCols.sort((a, b) => b - a);

        const canDirectlyTarget = (attacker, target) => {
            if (!attacker || !target) return false;
            if (StatusEffectFactory.isUnitUndetectable(target)) {
                const canDetect = !!attacker.canDetect || !!attacker.CanDetect;
                return canDetect;
            }
            return true;
        };

        // Helper: build enemies for a defence (forward direction = positive col diff)
        const buildMonsterEnemiesForDef = (def, rowsToCheck) => {
            const hasBackTargeting = def.backTargeting === true;
            const isCharmed = StatusEffectFactory.isUnitCharmed(def);
            const dir = isCharmed ? -1 : 1;
            const wantDefences = isCharmed;

            return (scene.units || []).filter(u => {
                if (!u || u.currentHealth <= 0 || !u.position) return false;
                if (!rowsToCheck.includes(u.position.row)) return false;
                if (!canDirectlyTarget(def, u)) return false;
                if (u === def) return false;

                const isDefenceUnit = (u.typeName in DefenceFactory.defenceData);
                const isMonsterUnit = (u.typeName in MonsterFactory.monsterData);
                if (wantDefences ? !isDefenceUnit : !isMonsterUnit) return false;

                if (!hasBackTargeting && ((u.position.col - def.position.col) * dir) <= 0) return false;
                return Math.abs(u.position.col - def.position.col) <= (def.range ?? 0);
            }).sort((a, b) => {
                const distA = Math.abs(a.position.col - def.position.col);
                const distB = Math.abs(b.position.col - def.position.col);
                return distA - distB;
            });
        };

        // Helper: build enemies for a monster (monsters attacking leftwards)
        const buildDefenceEnemiesForMon = (mon, rowsToCheck, rangeOverride = null) => {
            const hasBackTargeting = mon.backTargeting === true;
            const isCharmed = StatusEffectFactory.isUnitCharmed(mon);
            const dir = isCharmed ? 1 : -1;
            const wantMonsters = isCharmed;
            const monsterRange = Number.isFinite(rangeOverride) ? rangeOverride : (mon.range ?? 1);
            const monCol = mon.position?.col ?? 0;

            // First check for force fields in range (only when not charmed)
            const forceFieldEnemies = [];
            if (!isCharmed) {
                for (let c = monCol - 1; c >= Math.max(0, monCol - monsterRange); c--) {
                    const ffList = scene.forceFields && scene.forceFields[c];
                    if (ffList) {
                        const ffArray = Array.isArray(ffList) ? ffList : [ffList];
                        for (const ff of ffArray) {
                            if (ff && ff.currentHealth > 0 && SpecialEffectFactory._isEnemyUnit(mon, ff)) {
                                forceFieldEnemies.push(ff);
                            }
                        }
                    }
                }
            }

            // Get regular enemies (defences by default, monsters when charmed)
            const regularEnemies = (scene.units || []).filter(u => {
                if (!u || u.currentHealth <= 0 || !u.position) return false;
                if (!rowsToCheck.includes(u.position.row)) return false;
                if (!canDirectlyTarget(mon, u)) return false;
                if (u === mon) return false;

                const isDefenceUnit = (u.typeName in DefenceFactory.defenceData);
                const isMonsterUnit = (u.typeName in MonsterFactory.monsterData);
                if (wantMonsters ? !isMonsterUnit : !isDefenceUnit) return false;
                if (u.canBeTrampled || u.CanBeTrampled) return false;

                if (!hasBackTargeting && ((u.position.col - mon.position.col) * dir) <= 0) return false;
                return Math.abs(u.position.col - mon.position.col) <= monsterRange;
            });

            // Combine: force fields first (prioritized), then regular enemies
            const sortedForceFields = forceFieldEnemies.sort((a, b) => {
                const distA = Math.abs((a.position?.col ?? 0) - monCol);
                const distB = Math.abs((b.position?.col ?? 0) - monCol);
                return distA - distB;
            });

            const sortedRegular = regularEnemies.sort((a, b) => {
                const distA = Math.abs(a.position.col - monCol);
                const distB = Math.abs(b.position.col - monCol);
                return distA - distB;
            });

            return [...sortedForceFields, ...sortedRegular];
        };

        // Process defence attacks
        for (const col of defCols) {
            const defences = (scene.units || []).filter(u =>
                (u.typeName in DefenceFactory.defenceData) &&
                u.position &&
                u.position.col === col &&
                u.currentHealth > 0
            );

            for (const def of defences) {
                try {
                    if (!def || def.currentHealth <= 0) continue;
                    if (StatusEffectFactory.isUnitStunned(def)) continue;
                    let removedByAmmo = false;

                    // rows to check: single row or adjacent lanes
                    let rowsToCheck = [def.position.row];
                    if (def.canTargetAdjacentLanes) {
                        rowsToCheck = [def.position.row - 1, def.position.row, def.position.row + 1]
                            .filter(r => r >= 0 && r < (scene.GRID_ROWS ?? 5));
                    }

                    // initial enemies in range
                    let enemies = buildMonsterEnemiesForDef(def, rowsToCheck);

                    // If there's any interceptable force-field between def and its enemies, ensure it's considered first
                    try {
                        const ff = SpecialEffectFactory.interceptWithForceField(def, enemies, scene);
                        if (ff && !enemies.some(e => e === ff)) enemies.unshift(ff);
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[resolveCombat] interceptWithForceField(def) failed', e);
                    }

                    // filter blind spots
                    if (def.hasBlindSpot || def.HasBlindSpot) {
                        const blindRange = def.blindRange || def.BlindRange || 1;
                        const filtered = enemies.filter(u => Math.abs(u.position.col - def.position.col) > blindRange);
                        if (filtered.length) enemies = filtered;
                    }

                    // Sort left-to-right (front most first)
                    enemies.sort((a, b) => a.position.col - b.position.col);
                    if (!enemies.length) continue;
                    if (SpecialEffectFactory.hasBlindSpot(def, enemies, true)) continue;

                    // --- MultiFire handling (volley) ---
                    const multiEf = def.specialEffects?.find(e => e.Type === 'MultiFire');
                    if (multiEf) {
                        const mfShots = Math.max(1, Number(multiEf.FireCount || 1));

                        // determine shotDelay in ms: if FireDelay is small (<=10) treat as seconds, else treat as ms
                        let shotDelay = 60;
                        if (Number.isFinite(Number(multiEf.FireDelay))) {
                            const fd = Number(multiEf.FireDelay);
                            shotDelay = (fd <= 10) ? Math.max(0, Math.round(fd * 1000)) : Math.max(0, Math.round(fd));
                        }

                        while (def.currentAmmo > 0 && def.reloadTimer === 0) {
                            enemies = buildMonsterEnemiesForDef(def, rowsToCheck);

                            // re-check force-field intercept for current range
                            try {
                                const ff = SpecialEffectFactory.interceptWithForceField(def, enemies, scene);
                                if (ff && !enemies.some(e => e === ff)) enemies.unshift(ff);
                            } catch (e) {
                                if (DEBUG_MODE) console.warn('[resolveCombat] interceptWithForceField(def) failed mid-volley', e);
                            }

                            if (!enemies.length) break;
                            let perVolleyTargets = SpecialEffectFactory.getMultiShotTargets(def, enemies) || [];

                            // prefer condensed target
                            try {
                                const aoe = def.specialEffects?.find(e => e.Type === 'AreaOfEffect' && e.CondenseTargeting);
                                if (aoe) {
                                    const condensed = SpecialEffectFactory.getCondensedTarget(def, enemies);
                                    if (condensed) {
                                        perVolleyTargets = [condensed, ...perVolleyTargets.filter(x => x !== condensed)];
                                    }
                                }
                            } catch (e) {
                                if (DEBUG_MODE) console.warn('[resolveCombat] condenseTargeting check failed', e);
                            }

                            if (!perVolleyTargets.length) {
                                const fallback = [];
                                for (let s = 0; s < mfShots; s++) {
                                    const t = CombatFactory.pickTargetByMode(enemies, def.targetingMode || 'First', def);
                                    if (!t) break;
                                    fallback.push(t);
                                }
                                perVolleyTargets = fallback;
                            }

                            // Fire up to mfShots pellets (do not decrement ammo per pellet)
                            for (let i = 0; i < Math.min(mfShots, perVolleyTargets.length); i++) {
                                let target = perVolleyTargets[i];

                                // If target invalid/dead, pick a fresh target from enemies
                                if (!target || target.currentHealth <= 0) {
                                    enemies = buildMonsterEnemiesForDef(def, rowsToCheck);
                                    enemies.sort((a, b) => a.position.col - b.position.col);
                                    if (enemies.length === 0) break;
                                    target = CombatFactory.pickTargetByMode(enemies, def.targetingMode || 'First', def);
                                }
                                if (!target) continue;

                                // Final nearest-front fallback
                                if (target.currentHealth <= 0) {
                                    const nearestFront = enemies.slice().sort((a, b) => Math.abs(a.position.col - def.position.col) - Math.abs(b.position.col - def.position.col))[0];
                                    if (nearestFront) target = nearestFront;
                                }

                                // Check hit/miss and resolve attack (resolveAttack will handle force-fields via SpecialEffectFactory.handleForceField)
                                if (!CombatFactory.canHit(def, target, scene)) {
                                    CombatFactory._showMiss(scene, target);
                                } else {
                                    CombatFactory.resolveAttack(def, target, scene);
                                }

                                await wait(shotDelay);
                            }

                            // consume one ammo for the volley
                            def.currentAmmo = Math.max(0, def.currentAmmo - 1);
                            if (def.currentAmmo === 0) {
                                if (CombatFactory._removeUnitWhenOutOfAmmo(def, scene)) {
                                    removedByAmmo = true;
                                    break;
                                }
                                def.reloadTimer = def.reloadDelay;
                            }

                            // refresh enemies after volley for potential next volley
                            enemies = buildMonsterEnemiesForDef(def, rowsToCheck);
                            enemies.sort((a, b) => a.position.col - b.position.col);
                        }
                        if (removedByAmmo) continue;
                    } else {
                        const chosenTargetsForShots = SpecialEffectFactory.getMultiShotTargets(def, enemies);
                        while (def.currentAmmo > 0 && def.reloadTimer === 0 && chosenTargetsForShots.length > 0) {
                            try {
                                let target = chosenTargetsForShots.length ? chosenTargetsForShots.shift() : null;
                                if (!target || target.currentHealth <= 0) {
                                    enemies = buildMonsterEnemiesForDef(def, rowsToCheck);
                                    enemies.sort((a, b) => a.position.col - b.position.col);
                                    if (enemies.length === 0) break;
                                    target = CombatFactory.pickTargetByMode(enemies, def.targetingMode || 'First', def);
                                }
                                if (!target) break;

                                const nearestFront = enemies.slice().sort((a, b) => Math.abs(a.position.col - def.position.col) - Math.abs(b.position.col - def.position.col))[0];
                                if (!target && nearestFront) target = nearestFront;

                                if (!CombatFactory.canHit(def, target, scene)) {
                                    CombatFactory._showMiss(scene, target);
                                    def.currentAmmo--;
                                    if (def.currentAmmo === 0) {
                                        if (CombatFactory._removeUnitWhenOutOfAmmo(def, scene)) {
                                            removedByAmmo = true;
                                            break;
                                        }
                                        def.reloadTimer = def.reloadDelay;
                                    }
                                    continue;
                                }

                                CombatFactory.resolveAttack(def, target, scene);

                                def.currentAmmo--;
                                if (def.currentAmmo === 0) {
                                    if (CombatFactory._removeUnitWhenOutOfAmmo(def, scene)) {
                                        removedByAmmo = true;
                                        break;
                                    }
                                    def.reloadTimer = def.reloadDelay;
                                }

                                await wait(60);
                            } catch (e) {
                                if (DEBUG_MODE) console.warn('[resolveCombat][defense non-multi] per-shot failed', e);
                                break;
                            }
                        }
                        if (removedByAmmo) continue;
                    }

                    // periodic summon attempt
                    try {
                        SpecialEffectFactory.tryTriggerPeriodicSummon(def, scene);
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[resolveCombat] tryTriggerPeriodicSummon(def) failed', e);
                    }

                    // Check for HealAllies first - prioritize healing allies over attacking enemies
                    const healEffect = def.specialEffects?.find(e => e.Type === 'HealAllies');
                    if (healEffect && def.currentHealth > 0) {
                        const healed = SpecialEffectFactory._performHealAllies(def, healEffect, scene);
                        if (healed) {
                            if (DEBUG_MODE) {
                                console.log('[resolveCombat][defence] HealAllies prioritized', def.typeName, 'healed', healed.typeName);
                            }
                            // After healing, skip attacking this turn
                            continue;
                        }
                    }

                } catch (e) {
                    if (DEBUG_MODE) console.warn('[resolveCombat][defence] per-defence error', e);
                }
            }

            // pacing between columns
            await wait(columnDelay);
        }

        // === Monsters phase ===
        const monstersToProcess = (scene.units || []).filter(u =>
            (u.typeName in MonsterFactory.monsterData) &&
            u.position &&
            u.currentHealth > 0
        );

        monstersToProcess.sort((a, b) => {
            const ac = (a.position && typeof a.position.col === 'number') ? a.position.col : -Infinity;
            const bc = (b.position && typeof b.position.col === 'number') ? b.position.col : -Infinity;
            return bc - ac;
        });

        const tryMonsterAttack = async (mon, rowsToCheck) => {
            let removedByAmmo = false;

            let enemies = buildDefenceEnemiesForMon(mon, rowsToCheck);

            // force field intercept (monsters attack leftwards) - look one column ahead
            try {
                const ff = SpecialEffectFactory.interceptWithForceField(mon, enemies, scene);
                if (ff && !enemies.some(e => e === ff)) enemies.unshift(ff);
            } catch (e) {
                if (DEBUG_MODE) console.warn('[resolveCombat] interceptWithForceField(mon) failed', e);
            }

            enemies.sort((a, b) => b.position.col - a.position.col);

            if (!enemies.length) {
                return { attacked: false, removedByAmmo: false };
            }

            const multiEf = mon.specialEffects?.find(e => e.Type === 'MultiFire');
            if (multiEf) {
                const mfShots = Math.max(1, Number(multiEf.FireCount || 1));

                // determine shotDelay in ms
                let shotDelay = 60;
                if (Number.isFinite(Number(multiEf.FireDelay))) {
                    const fd = Number(multiEf.FireDelay);
                    shotDelay = (fd <= 10) ? Math.max(0, Math.round(fd * 1000)) : Math.max(0, Math.round(fd));
                }

                while (mon.currentAmmo > 0 && mon.reloadTimer === 0) {
                    enemies = buildDefenceEnemiesForMon(mon, rowsToCheck);

                    // re-add intercepting force field if present
                    try {
                        const ff = SpecialEffectFactory.interceptWithForceField(mon, enemies, scene);
                        if (ff && !enemies.some(e => e === ff)) enemies.unshift(ff);
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[resolveCombat] interceptWithForceField(mon) failed mid-volley', e);
                    }

                    if (!enemies.length) break;

                    let perVolleyTargets = SpecialEffectFactory.getMultiShotTargets(mon, enemies) || [];

                    try {
                        const aoe = mon.specialEffects?.find(e => e.Type === 'AreaOfEffect' && e.CondenseTargeting);
                        if (aoe) {
                            const condensed = SpecialEffectFactory.getCondensedTarget(mon, enemies);
                            if (condensed) {
                                perVolleyTargets = [condensed, ...perVolleyTargets.filter(x => x !== condensed)];
                            }
                        }
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[resolveCombat] condenseTargeting(mon) failed', e);
                    }

                    if (!perVolleyTargets.length) {
                        const fallback = [];
                        for (let s = 0; s < mfShots; s++) {
                            const t = CombatFactory.pickTargetByMode(enemies, mon.targetingMode || 'First', mon);
                            if (!t) break;
                            fallback.push(t);
                        }
                        perVolleyTargets = fallback;
                    }

                    for (let i = 0; i < Math.min(mfShots, perVolleyTargets.length); i++) {
                        let target = perVolleyTargets[i];

                        if (!target || target.currentHealth <= 0) {
                            enemies = buildDefenceEnemiesForMon(mon, rowsToCheck);
                            enemies.sort((a, b) => b.position.col - a.position.col);
                            if (!enemies.length) break;
                            target = CombatFactory.pickTargetByMode(enemies, mon.targetingMode || 'First', mon);
                        }
                        if (!target) continue;

                        if (!CombatFactory.canHit(mon, target, scene)) {
                            CombatFactory._showMiss(scene, target);
                        } else {
                            CombatFactory.resolveAttack(mon, target, scene);
                        }

                        await wait(shotDelay);
                    }

                    mon.currentAmmo = Math.max(0, mon.currentAmmo - 1);
                    if (mon.currentAmmo === 0) {
                        if (CombatFactory._removeUnitWhenOutOfAmmo(mon, scene)) {
                            removedByAmmo = true;
                            break;
                        }
                        mon.reloadTimer = mon.reloadDelay;
                    }

                    enemies = buildDefenceEnemiesForMon(mon, rowsToCheck);
                    enemies.sort((a, b) => b.position.col - a.position.col);
                }

                return { attacked: true, removedByAmmo };
            }

            const perShotTargets = SpecialEffectFactory.getMultiShotTargets(mon, enemies);
            while (mon.currentAmmo > 0 && mon.reloadTimer === 0 && perShotTargets.length > 0) {
                let target = perShotTargets.length ? perShotTargets.shift() : null;
                if (!target || target.currentHealth <= 0) {
                    enemies = buildDefenceEnemiesForMon(mon, rowsToCheck);
                    enemies.sort((a, b) => a.position.col - b.position.col);
                    if (enemies.length === 0) break;
                    target = CombatFactory.pickTargetByMode(enemies, mon.targetingMode || 'First', mon);
                }
                if (!target) break;

                const nearestFront = enemies.slice().sort((a, b) => Math.abs(a.position.col - mon.position.col) - Math.abs(b.position.col - mon.position.col))[0];
                if (!target && nearestFront) target = nearestFront;

                if (!CombatFactory.canHit(mon, target, scene)) {
                    CombatFactory._showMiss(scene, target);
                    mon.currentAmmo--;
                    if (mon.currentAmmo === 0) {
                        if (CombatFactory._removeUnitWhenOutOfAmmo(mon, scene)) {
                            removedByAmmo = true;
                            break;
                        }
                        mon.reloadTimer = mon.reloadDelay;
                    }
                    continue;
                }

                CombatFactory.resolveAttack(mon, target, scene);

                mon.currentAmmo--;
                if (mon.currentAmmo === 0) {
                    if (CombatFactory._removeUnitWhenOutOfAmmo(mon, scene)) {
                        removedByAmmo = true;
                        break;
                    }
                    mon.reloadTimer = mon.reloadDelay;
                }

                await wait(60);
            }

            return { attacked: true, removedByAmmo };
        };

        for (const mon of monstersToProcess) {
            try {
                if (!mon || mon.currentHealth <= 0) continue;
                if (StatusEffectFactory.isUnitStunned(mon)) continue;

                let rowsToCheck = [mon.position.row];
                if (mon.canTargetAdjacentLanes) {
                    rowsToCheck = [mon.position.row - 1, mon.position.row, mon.position.row + 1]
                        .filter(r => r >= 0 && r < (scene.GRID_ROWS ?? 5));
                }

                // Check for HealAllies first - prioritize healing allies over attacking enemies
                const healEffect = mon.specialEffects?.find(e => e.Type === 'HealAllies');
                if (healEffect && mon.currentHealth > 0) {
                    const healed = SpecialEffectFactory._performHealAllies(mon, healEffect, scene);
                    if (healed) {
                        if (DEBUG_MODE) {
                            console.log('[resolveCombat][monster] HealAllies prioritized', mon.typeName, 'healed', healed.typeName);
                        }
                        // After healing, skip attacking this turn
                        continue;
                    }
                }

                const attackResult = await tryMonsterAttack(mon, rowsToCheck);
                if (attackResult.removedByAmmo) continue;

                if (!attackResult.attacked) {
                    const isCharmed = StatusEffectFactory.isUnitCharmed(mon);
                    const speedAbs = Number.isFinite(mon.speed) ? Math.abs(mon.speed) : 0;
                    let stepsOverride = null;
                    let maxSteps = null;
                    let shouldTryPostMoveAttack = false;

                    // Skirmisher behavior: if we can reach attack range this wave, stop early and attack.
                    if (speedAbs >= 2) {
                        const moveSteps = CombatFactory._getMonsterMoveSteps(mon, scene);
                        stepsOverride = moveSteps;

                        if (moveSteps > 0) {
                            const range = Math.max(1, Number(mon.range || 0) || 1);
                            const extended = buildDefenceEnemiesForMon(mon, rowsToCheck, range + moveSteps);
                            if (extended.length > 0) {
                                const targetCol = extended[0]?.position?.col;
                                if (Number.isFinite(targetCol) && Number.isFinite(mon.position?.col)) {
                                    const dist = Math.abs(targetCol - mon.position.col);
                                    const needed = Math.max(0, dist - range);
                                    if (needed > 0 && needed <= moveSteps) {
                                        maxSteps = needed;
                                        shouldTryPostMoveAttack = true;
                                    }
                                }
                            }
                        }
                    }

                    CombatFactory.moveMonster(mon, scene, {
                        direction: isCharmed ? 1 : -1,
                        ignoreForceFields: isCharmed,
                        stepsOverride,
                        maxSteps
                    });

                    if (shouldTryPostMoveAttack && !mon._beingRemoved && mon.currentHealth > 0) {
                        const postAttack = await tryMonsterAttack(mon, rowsToCheck);
                        if (postAttack.removedByAmmo) continue;
                    }

                    try {
                        SpecialEffectFactory.tryTriggerPeriodicSummon(mon, scene);
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[resolveCombat] tryTriggerPeriodicSummon(mon) failed', e);
                    }

                    try {
                        if (typeof scene._positionUnitUI === 'function' && scene.time && typeof scene.time.delayedCall === 'function') {
                            scene.time.delayedCall(0, () => {
                                try {
                                    scene._positionUnitUI(mon);
                                } catch (e) {
                                    if (DEBUG_MODE) console.warn('[resolveCombat] post-move _positionUnitUI failed', e);
                                }
                            });
                        } else {
                            try {
                                if (typeof scene._positionUnitUI === 'function') scene._positionUnitUI(mon);
                            } catch (e) {}
                        }
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[resolveCombat] scheduling _positionUnitUI failed', e);
                    }
                }
            } catch (e) {
                if (DEBUG_MODE) console.warn('[resolveCombat][monster] per-monster error', e);
            }

            // small inter-monster pause to smooth out frame updates
            await wait(60);
        }
    }
}
