import { DEBUG_MODE } from '../DebugManager.js';
import CombatFactory from './CombatFactory.js';
import DefenceFactory from './DefenceFactory.js';
import MonsterFactory from './MonsterFactory.js';
import PuddleFactory from './PuddleFactory.js';
import StatusEffectFactory from './StatusEffectFactory.js';
import StatusEffectVisuals from '../StatusEffectVisuals.js';

/**
 * Handles special effect logic (summons, AoE, healing, force fields, etc.).
 */
export default class SpecialEffectFactory {
    /**
     * Check if two units are enemies (defence vs monster).
     * @param {Object} attacker - Acting unit
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
     * Determine enemy status while accounting for Charm on the attacker.
     * Charmed units treat allies as enemies for their own actions.
     * @param {Object} attacker - Acting unit
     * @param {Object} unit - Candidate target unit
     * @returns {boolean} True if the unit is an enemy for this attacker
     */
    static _isEnemyUnitConsideringCharm(attacker, unit) {
        const base = SpecialEffectFactory._isEnemyUnit(attacker, unit);
        const isCharmed = StatusEffectFactory.isUnitCharmed(attacker);
        return isCharmed ? !base : base;
    }

    /**
     * Summon helper (updated visuals to use getTileXY).
     * @param {Object} attacker - Unit performing the summon
     * @param {Object} summonEffect - Summon effect config
     * @param {Object} scene - Active scene
     */
    static _performSummon(attacker, summonEffect, scene) {
        if (!scene || !attacker || !attacker.position) return;
        const grid = scene.grid || [];
        const row = attacker.position.row;
        const col = attacker.position.col;
        const maxRows = scene.GRID_ROWS ?? grid.length ?? 5;
        const maxCols = scene.GRID_COLS ?? (grid[0]?.length ?? 9);

        const spawnCount = Math.max(1, Number(summonEffect.SpawnCount || 1));
        const dir = summonEffect.SpawnDirection || 'Near';

        const positions = [];
        if (dir === 'Plus') {
            const deltas = [
                [-1, 0],
                [1, 0],
                [0, -1],
                [0, 1]
            ];
            for (let d of deltas) {
                if (positions.length >= spawnCount) break;
                const r = row + d[0],
                    c = col + d[1];
                if (r >= 0 && r < maxRows && c >= 0 && c < maxCols && !grid[r][c].unit) positions.push([r, c]);
            }
        } else if (dir === 'Near') {
            const forward = (attacker.position && typeof attacker.position.col === 'number') ?
                (((scene.players && scene.players[0] && scene.players[0].role === 'defence') ? 1 : -1)) : 1;
            const candidate = [
                [row, col + forward],
                [row, col - forward],
                [row - 1, col + forward],
                [row + 1, col + forward],
                [row, col + 2 * forward]
            ];
            for (const [r, c] of candidate) {
                if (positions.length >= spawnCount) break;
                if (r >= 0 && r < maxRows && c >= 0 && c < maxCols && !grid[r][c].unit) positions.push([r, c]);
            }
        } else if (Array.isArray(dir)) {
            const r = row + (dir[0] || 0),
                c = col + (dir[1] || 0);
            if (r >= 0 && r < maxRows && c >= 0 && c < maxCols && !grid[r][c].unit) positions.push([r, c]);
        } else {
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const r = row + dr,
                        c = col + dc;
                    if (positions.length >= spawnCount) break;
                    if (r >= 0 && r < maxRows && c >= 0 && c < maxCols && !grid[r][c].unit) positions.push([r, c]);
                }
            }
        }

        // Play summon sound effect if available
        if (summonEffect.Audio && scene && scene.sound) {
            try {
                scene.sound.play(summonEffect.Audio, { volume: 0.6 });
            } catch (e) {
                if (DEBUG_MODE) console.warn('[Summon] sound effect failed', e);
            }
        }

        for (let i = 0; i < Math.min(spawnCount, positions.length); i++) {
            const [r, c] = positions[i];
            if (scene && typeof CombatFactory.instantSpawnUnit === 'function') {
                CombatFactory.instantSpawnUnit(scene, summonEffect.UnitType, r, c, attacker);
            } else {
                try {
                    const beforeHolders = Array.isArray(scene.holders) ? scene.holders.slice() : [];

                    // ask scene to create a holder (scene should add it to scene.holders)
                    if (scene && typeof CombatFactory.summonUnit === 'function') {
                        CombatFactory.summonUnit(scene, summonEffect.UnitType);
                    }

                    // try to find the most recently added holder of the requested type that wasn't in beforeHolders
                    let newly = null;
                    if (Array.isArray(scene.holders)) {
                        for (let i = scene.holders.length - 1; i >= 0; i--) {
                            const h = scene.holders[i];
                            if (!h) continue;
                            if (!beforeHolders.includes(h) && h.typeName === summonEffect.UnitType) {
                                newly = h;
                                scene.holders.splice(i, 1);
                                break;
                            }
                        }
                    }

                    // fallback: if still not found, pop the most recent holder safely
                    if (!newly && Array.isArray(scene.holders) && scene.holders.length) {
                        newly = scene.holders.pop();
                    }

                    if (!newly) {
                        if (DEBUG_MODE) console.warn('[Summon] no holder produced by scene.summonUnit fallback for', summonEffect.UnitType);
                        continue;
                    }

                    // ensure grid cell exists
                    if (!scene.grid[r]) scene.grid[r] = [];
                    if (!scene.grid[r][c]) scene.grid[r][c] = {
                        sprite: null,
                        unit: null
                    };

                    newly.position = {
                        row: r,
                        col: c
                    };
                    if (attacker && attacker._owner !== undefined) newly._owner = attacker._owner;

                    // create sprite (defensive: check newly.displaySprite)
                    const spriteKey = newly.displaySprite || null;
                    const t = (typeof scene.getTileXY === 'function') ? scene.getTileXY(r, c) : {
                        x: 300 + c * 60,
                        y: 150 + r * 60
                    };
                    const spr = scene.add.sprite(t.x, t.y + ((newly.displaySprite && newly.speed) ? 25 : 0), spriteKey || 'dice1').setInteractive();
                    spr.setOrigin(0.5, 0.5);
                    if (scene.TILE_SIZE && spr.setDisplaySize) {
                        const size = Math.max(8, Math.floor(scene.TILE_SIZE * 0.8));
                        spr.setDisplaySize(size, size);
                    }
                    newly.sprite = spr;

                    scene.grid[r][c].unit = newly;
                    scene.grid[r][c].sprite = spr;
                    scene.units.push(newly);
                    if (typeof scene.addUnitBars === 'function') scene.addUnitBars(newly, spr);
                    SpecialEffectFactory.handleOnPlace(newly, scene);
                } catch (e) {
                    console.warn('SpecialEffectFactory: fallback summon failed', e);
                }
            }
        }
    }

    /**
     * Attempt to trigger a periodic SummonUnit special effect if off cooldown.
     * @param {Object} attacker - Unit with the summon effect
     * @param {Object} scene - Active scene
     */
    static tryTriggerPeriodicSummon(attacker, scene) {
        if (!attacker || !scene || !Array.isArray(attacker.specialEffects)) return;
        const summon = attacker.specialEffects.find(e => e.Type === 'SummonUnit');
        if (!summon) return;

        // Check if unit is stunned - if so, skip summon attempt
        const hasStunStatus = Array.isArray(attacker.status) && attacker.status.some(s => (s.Type === 'Stun' || s.Type === 'Frozen') && (s.Duration || 0) > 0);
        const hasStunTurns = (typeof attacker.stunTurns === 'number' && attacker.stunTurns > 0);
        const hasPrivateStun = (typeof attacker._stunTurns === 'number' && attacker._stunTurns > 0) || !!attacker._stunned;
        const isStunned = hasStunStatus || hasStunTurns || hasPrivateStun;
        
        if (isStunned) {
            if (DEBUG_MODE) console.log('[SummonUnit] BLOCKED - unit is stunned', attacker.typeName);
            return;
        }

        attacker._summonCooldown = attacker._summonCooldown || 0;
        if (attacker._summonCooldown <= 0) {
            const player = scene.players[scene.currentPlayer];
            if (!player) return;
            const wave = (typeof scene.currentWave === 'number') ? scene.currentWave : 1;
            let baseCooldown = Math.max(0, Number(summon.Cooldown || 0));
            attacker._summonCooldown = baseCooldown;
            if (DEBUG_MODE) console.log('Periodic Summon executed', {
                attacker: attacker.typeName,
                summon,
                cooldown: attacker._summonCooldown
            });
            
            try {
                // Pass the summoner so _performSummon can apply wave scaling to spawned units
                SpecialEffectFactory._performSummon(attacker, summon, scene);
            } catch (e) {
                if (DEBUG_MODE) console.warn('[SummonUnit] _performSummon failed', e);
            }
        }
    }

    /**
     * Apply or remove a damage booster across an area centered at (row,col).
     * @param {Object} scene - Active scene
     * @param {number} centerRow - Center row
     * @param {number} centerCol - Center column
     * @param {number} rows - Area height
     * @param {number} cols - Area width
     * @param {number} multiplier - Damage multiplier
     * @param {Object|null} sourceUnit - Unit providing the boost
     * @param {boolean} apply - True to apply, false to remove
     */
    static _applyDamageBoosterArea(scene, centerRow, centerCol, rows, cols, multiplier = 1.0, sourceUnit = null, apply = true) {
        if (!scene || typeof scene.grid === 'undefined') return;
        const radR = Math.floor((rows || 1) / 2);
        const radC = Math.floor((cols || 1) / 2);
        for (let rr = centerRow - radR; rr <= centerRow + radR; rr++) {
            for (let cc = centerCol - radC; cc <= centerCol + radC; cc++) {
                if (rr < 0 || rr >= (scene.GRID_ROWS || scene.grid.length) || cc < 0 || cc >= (scene.GRID_COLS || (scene.grid[0] || []).length)) continue;
                const u = scene.grid[rr][cc]?.unit;
                if (!u) continue;
                if (!SpecialEffectFactory._isEnemyUnit(sourceUnit, u)) {
                    if (apply) {
                        u._damageMultiplier = (u._damageMultiplier || 1) * Number(multiplier || 1);
                    } else {
                        if (u._damageMultiplier) {
                            u._damageMultiplier = u._damageMultiplier / (Number(multiplier || 1) || 1);
                            if (Math.abs(u._damageMultiplier - 1) < 0.0001) delete u._damageMultiplier;
                        }
                    }
                }
            }
        }
    }

    /**
     * Apply nearby damage booster effects onto a unit.
     * @param {Object} unit - Unit to modify
     * @param {Object} scene - Active scene
     */
    static applyDamageBoostsToUnit(unit, scene) {
        if (!unit || !scene || !Array.isArray(scene.grid)) return;
        let totalMultiplier = 1.0;
        const maxR = (scene.GRID_ROWS || scene.grid.length);
        const maxC = (scene.GRID_COLS || (scene.grid[0] || []).length);
        for (const other of (scene.units || [])) {
            if (!other || !other.position || !Array.isArray(other.specialEffects)) continue;
            const booster = other.specialEffects.find(e => e.Type === 'DamageBooster');
            if (!booster) continue;
            let r = 1,
                c = 1;
            const radius = booster.Radius || booster.Value || '3x3';
            if (typeof radius === 'string' && radius.includes('x')) {
                const parts = radius.split('x').map(p => parseInt(p, 10) || 1);
                r = parts[0];
                c = parts[1];
            } else if (typeof radius === 'number') {
                r = c = radius;
            }
            const dr = Math.abs(unit.position.row - other.position.row);
            const dc = Math.abs(unit.position.col - other.position.col);
            if (dr <= Math.floor(r / 2) && dc <= Math.floor(c / 2)) {
                totalMultiplier *= Number(booster.Value || 1.0) || 1.0;
            }
        }

        if (totalMultiplier !== 1.0) {
            unit._damageMultiplier = (unit._damageMultiplier || 1) * totalMultiplier;
        }
    }

    /**
     * Apply armor/piercing/acid/multiplier modifiers to base damage.
     * @param {Object} attacker - Attacking unit
     * @param {Object} target - Target unit
     * @param {number} baseDamage - Raw damage
     * @param {Object|null} scene - Active scene
     * @returns {number} Final rounded damage
     */
    static applyDamageModifiers(attacker = {}, target = {}, baseDamage = 0, scene = null) {
        attacker._lastDamageDealtRaw = baseDamage;
        let dmg = Number(baseDamage || 0);

        const armorEffect = Array.isArray(target.specialEffects) ?
            target.specialEffects.find(e => e.Type === 'Armor') :
            null;

        const armorValue = armorEffect ? Number(armorEffect.Value) || 0 : 0;
        const damageReduction = (armorEffect && armorEffect.DamageReduction !== undefined) ? Number(armorEffect.DamageReduction) : null;

        const piercing = Array.isArray(attacker.specialEffects) ?
            attacker.specialEffects.find(e => e.Type === 'ArmorPiercing') :
            null;

        const hasPiercing = !!piercing;
        const piercingFactor = (piercing && piercing.Value !== undefined) ? Number(piercing.Value) : 1.0;

        // Check if target has Acid status - Acid ignores armor
        const hasAcidStatus = Array.isArray(target.status) && target.status.some(s => s.Type === 'Acid');

        // --- Flat armor ---
        if (armorValue > 0) {
            if (hasPiercing || hasAcidStatus) {
                const factor = hasPiercing ? piercingFactor : 1.0;
                dmg = dmg * factor;
                if (DEBUG_MODE) console.log(hasPiercing ? '[ArmorPiercing][FlatArmor]' : '[Acid][IgnoreArmor]', attacker.typeName, 'factor=', factor, 'newDmg=', dmg);
            } else {
                dmg = Math.max(0, dmg - armorValue);
                if (DEBUG_MODE) console.log('[Armor][FlatArmor]', target.typeName, 'armor=', armorValue, 'newDmg=', dmg);
            }
        }

        // --- Damage Reduction (percent) ---
        if (Number.isFinite(damageReduction)) {
            if (hasPiercing || hasAcidStatus) {
                const factor = hasPiercing ? piercingFactor : 1.0;
                dmg = dmg * factor;
                if (DEBUG_MODE) console.log(hasPiercing ? '[ArmorPiercing][BypassDR]' : '[Acid][BypassDR]', attacker.typeName, 'dr=', damageReduction);
            } else {
                dmg = Math.round(dmg * damageReduction);
                if (DEBUG_MODE) console.log('[Armor][DamageReduction]', target.typeName, 'dr=', damageReduction, 'newDmg=', dmg);
            }
        }

        // --- Acid bonus ---
        if (target._acidBonusMultiplier && typeof target._acidBonusMultiplier === 'number') {
            dmg = dmg * target._acidBonusMultiplier;
            if (DEBUG_MODE) console.log('[SpecialEffect][AcidMultiplier]', target.typeName, 'mult=', target._acidBonusMultiplier, 'newDmg=', dmg);
        }

        // --- Attacker multiplier ---
        const attackerMultiplier = (attacker && (attacker._damageMultiplier !== undefined)) ? Number(attacker._damageMultiplier) : 1.0;
        dmg = dmg * attackerMultiplier;

        return Math.max(0, Math.round(dmg));
    }

    /**
     * Call on unit removal/destruction so any area buffs provided by that unit are removed.
     * @param {Object} unit - Unit being removed
     * @param {Object|null} scene - Active scene
     */
    static handleOnRemove(unit, scene = null) {
        if (!unit || !unit.specialEffects || !scene) return;

        // Clean up shield VFX when unit is removed
        try {
            if (unit._shieldVFX && Array.isArray(unit._shieldVFX)) {
                unit._shieldVFX.forEach(spr => {
                    try {
                        if (spr && spr.destroy) spr.destroy();
                    } catch (e) {}
                });
                unit._shieldVFX = [];
            }
        } catch (e) {}

        unit.specialEffects.forEach(effect => {
            if (effect.Type === 'DamageBooster') {
                let r = 1,
                    c = 1;
                const radius = effect.Radius || effect.Value || '3x3';
                if (typeof radius === 'string' && radius.includes('x')) {
                    const parts = radius.split('x').map(p => parseInt(p, 10) || 1);
                    r = parts[0];
                    c = parts[1];
                } else if (typeof radius === 'number') {
                    r = c = radius;
                }
                const mult = Number(effect.Value || 1.0);
                SpecialEffectFactory._applyDamageBoosterArea(scene, unit.position.row, unit.position.col, r, c, mult, unit, false);
            }
            if (effect.Type === 'DeathEffect') {
                if (unit._deathEffectTriggered) {
                    if (DEBUG_MODE) console.log('[DeathEffect] skipped duplicate on remove', unit.typeName);
                    return;
                }
                unit._deathEffectTriggered = true;
                try {
                    SpecialEffectFactory._performDeathEffect(unit, effect, scene);
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[DeathEffect] perform failed', e);
                }
            }
            if (effect.Type === 'Revive') {
                try {
                    SpecialEffectFactory.reviveUnit(unit, scene);
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[Revive] perform failed', e);
                }
            }
        });
    }

    /**
     * Resolve multi-shot targets (SpreadTargeting, AmmoIndex/AmmoIndices).
     * @param {Object} attacker - Attacking unit
     * @param {Object[]} enemies - Candidate targets
     * @returns {Object[]} Targets for this volley/shot sequence
     */
    static getMultiShotTargets(attacker, enemies = []) {
        const shots = (attacker?.currentAmmo !== undefined && attacker?.currentAmmo !== null) ?
            Number(attacker.currentAmmo) :
            (attacker?.ammo !== undefined && attacker?.ammo !== null) ?
            Number(attacker.ammo) :
            1;
        if (!Array.isArray(enemies)) enemies = [];
        if (!enemies.length) return [];

        // 1) MultiFire special-case: per-lane targets when CanTargetAdjacentLanes is set
        const multi = attacker.specialEffects?.find(e => e.Type === 'MultiFire');
        if (multi) {
            const mfShots = Math.max(1, Number(multi.FireCount || 1));
            const results = [];

            if (attacker.CanTargetAdjacentLanes || attacker.canTargetAdjacentLanes) {
                const centerRow = Number.isFinite(attacker.position?.row) ? attacker.position.row : 0;
                const maxRows = attacker.scene?.GRID_ROWS ?? 5;
                const attackerCol = Number.isFinite(attacker.position?.col) ? attacker.position.col : 0;
                const range = Math.max(1, Number(attacker.range || 0) || 1);

                // Build lane order: center, upper, lower (like Threepeater from PvZ)
                const laneOrder = [];
                if (mfShots >= 1) laneOrder.push(centerRow);
                if (mfShots >= 2 && centerRow - 1 >= 0) laneOrder.push(centerRow - 1);
                if (mfShots >= 3 && centerRow + 1 < maxRows) laneOrder.push(centerRow + 1);
                const allLanes = [centerRow, centerRow - 1, centerRow + 1].filter(r => r >= 0 && r < maxRows);

                const pickRowTarget = (row) => {
                    const rowEnemies = enemies.filter(e => {
                        if (!e?.position || e.currentHealth <= 0) return false;
                        if (e.position.row !== row) return false;
                        const dist = Math.abs((e.position.col ?? 0) - attackerCol);
                        return dist <= range;
                    });
                    if (!rowEnemies.length) return null;
                    rowEnemies.sort((a, b) => {
                        const da = Math.abs((a.position?.col ?? 0) - attackerCol);
                        const db = Math.abs((b.position?.col ?? 0) - attackerCol);
                        return da - db;
                    });
                    return CombatFactory.pickTargetByMode(
                        rowEnemies,
                        attacker.targetingMode || 'First',
                        attacker
                    );
                };

                const laneCycle = laneOrder.length ? laneOrder : allLanes;

                // Fire only on lanes that have targets; do not repeat shots when adjacent lanes are empty.
                for (const row of laneCycle) {
                    if (results.length >= mfShots) break;
                    const t = pickRowTarget(row);
                    if (t) results.push(t);
                }

                return results;
            }

            // Non-adjacent-lane multifire
            const t = CombatFactory.pickTargetByMode(enemies, attacker.targetingMode || 'First', attacker);
            return Array.from({
                length: mfShots
            }, () => t);
        }

        // 2) SpreadTargeting handling (falls back to standard if no spread)
        const spread = attacker.specialEffects?.find(e => e.Type === 'SpreadTargeting');
        if (!spread) {
            let t = null;
            try {
                const aoe = attacker.specialEffects?.find(e => e.Type === 'AreaOfEffect' && e.CondenseTargeting);
                if (aoe) {
                    t = SpecialEffectFactory.getCondensedTarget(attacker, enemies);
                }
            } catch (e) {}
            if (!t) t = CombatFactory.pickTargetByMode(enemies, attacker.targetingMode || 'First', attacker);
            return Array.from({
                length: shots
            }, () => t);
        }

        // If we do have spread, optionally condense AoE targeting first
        const aoe = attacker.specialEffects?.find(e => e.Type === 'AreaOfEffect' && e.CondenseTargeting);
        if (aoe) {
            const condensed = SpecialEffectFactory.getCondensedTarget(attacker, enemies);
            if (condensed) {
                enemies = [condensed, ...enemies.filter(e => e !== condensed)];
            }
        }

        const onlyWhenEnough = !!spread.OnlyActivateWhenEnoughEnemies;
        const threshold = spread.MinimumEnemies || 2;
        const useSpread = !onlyWhenEnough || enemies.length >= threshold;

        const ammoIndexMap = {};
        if (spread.AmmoIndex !== undefined) {
            ammoIndexMap[Number(spread.AmmoIndex)] = spread.TargetMode || 'Last';
        } else if (Array.isArray(spread.AmmoIndices)) {
            for (const entry of spread.AmmoIndices) {
                if (entry && typeof entry === 'object' && entry.Index !== undefined) {
                    ammoIndexMap[Number(entry.Index)] = entry.Mode || 'Last';
                }
            }
        }

        const results = [];
        for (let s = 0; s < shots; s++) {
            const specialMode = ammoIndexMap[s];
            if (!useSpread || !specialMode) {
                results.push(CombatFactory.pickTargetByMode(enemies, attacker.targetingMode || 'First', attacker));
            } else {
                results.push(CombatFactory.pickTargetByMode(enemies, specialMode, attacker));
            }
        }

        return results;
    }

    /**
     * Determine if an attack should hit (Accuracy/DontAttack handling).
     * @param {Object} attacker - Attacking unit
     * @param {Object} target - Target unit
     * @param {Object|null} scene - Active scene
     * @returns {boolean} True if hit
     */
    static canHit(attacker = {}, target = {}, scene = null) {
        if (!attacker) return false;
        if (attacker.dontAttack || attacker.DontAttack) {
            if (DEBUG_MODE) console.log('[SpecialEffect][DontAttack] prevented attack', attacker.typeName);
            return false;
        }
        if (StatusEffectFactory.isUnitUndetectable(target)) {
            const canDetect = !!attacker.canDetect || !!attacker.CanDetect;
            if (!canDetect) {
                if (DEBUG_MODE) console.log('[SpecialEffect][Undetectable] prevented attack', attacker.typeName);
                return false;
            }
        }

        const acc = (attacker.specialEffects || []).find(e => e.Type === 'Accuracy');
        if (!acc) return true;

        if (!target || !target.position || !attacker.position) return true;

        const rawDist = Math.abs(Number(attacker.position.col) - Number(target.position.col));
        const rangeNum = Math.max(1, Number(attacker.range || 0) || 1);

        // clamp distance into sensible range [1, rangeNum] to avoid accidental >range hits
        const distClamped = Math.max(1, Math.min(rangeNum, rawDist || 1));

        if (rangeNum <= 1) return true;

        const minV = (acc.MinValue !== undefined) ? Number(acc.MinValue) : 0.0;
        const maxV = (acc.MaxValue !== undefined) ? Number(acc.MaxValue) : 1.0;
        const clampedMin = Math.max(0, Math.min(1, minV));
        const clampedMax = Math.max(0, Math.min(1, maxV));

        // linear interpolation from max at dist=1 to min at dist=rangeNum
        const chance = clampedMax - (clampedMax - clampedMin) * (distClamped - 1) / Math.max(1, (rangeNum - 1));
        const roll = Math.random();
        if (DEBUG_MODE) {
            console.log('[SpecialEffect][Accuracy]', {
                attacker: attacker.typeName,
                target: target.typeName,
                rawDist,
                distClamped,
                rangeNum,
                min: clampedMin,
                max: clampedMax,
                chance,
                roll,
                hit: roll < chance
            });
        }
        return roll < Math.max(0, Math.min(1, chance));
    }

    /**
     * Choose a condensed AoE target that maximizes splash coverage.
     * @param {Object} attacker - Attacking unit
     * @param {Object[]} enemies - Candidate targets
     * @returns {Object|null} Best target to center AoE on
     */
    static getCondensedTarget(attacker, enemies = []) {
        if (!attacker || !Array.isArray(enemies) || enemies.length === 0) return null;
        
        // Check if attacker has CondenseTargeting enabled
        const aoe = (attacker.specialEffects || []).find(e => e.Type === 'AreaOfEffect' && !!e.Value);
        if (!aoe || !aoe.CondenseTargeting) return null;

        // Parse AoE dimensions
        let rows = 1, cols = 1;
        if (typeof aoe.Value === 'string' && aoe.Value.includes('x')) {
            const parts = aoe.Value.split('x').map(p => parseInt(p, 10) || 1);
            rows = parts[0];
            cols = parts[1];
        } else if (typeof aoe.Value === 'number') {
            rows = cols = aoe.Value;
        }
        const radR = Math.floor(rows / 2);
        const radC = Math.floor(cols / 2);

        // Get attacker's range and position
        const atkRange = Math.max(1, Number(attacker.range || 0) || 1);
        const atkCol = attacker.position?.col ?? 0;
        const atkRow = attacker.position?.row ?? 0;

        // Filter to enemies within range and valid rows (same row unless CanTargetAdjacentLanes)
        const canTargetAdjacent = attacker.CanTargetAdjacentLanes || attacker.canTargetAdjacentLanes;
        const validEnemies = enemies.filter(e => {
            if (!e?.position) return false;
            const distToAttacker = Math.abs(e.position.col - atkCol);
            if (distToAttacker > atkRange) return false;
            if (!canTargetAdjacent && e.position.row !== atkRow) return false;
            return true;
        });

        if (validEnemies.length === 0) return null;

        // CondenseTargeting: Prioritize enemies on the SAME ROW as the attacker
        // This makes splash units focus on hitting crowds on their own row
        const sameRowEnemies = validEnemies.filter(e => e.position.row === atkRow);
        
        // If there are enemies on the same row, prioritize them
        const enemiesToConsider = sameRowEnemies.length > 0 ? sameRowEnemies : validEnemies;

        // SMART CLUSTER DETECTION:
        // Find the best target that maximizes the number of enemies hit by the AoE
        let bestTarget = null;
        let bestHitCount = 0;
        let bestDistance = Number.POSITIVE_INFINITY;

        // Evaluate each enemy as a potential center target
        for (const candidate of enemiesToConsider) {
            const centerCol = candidate.position.col;
            const centerRow = candidate.position.row;
            
            // Count how many enemies would be hit if we target this candidate
            let hitCount = 0;
            for (const e of enemiesToConsider) {
                const dc = Math.abs(e.position.col - centerCol);
                const dr = Math.abs(e.position.row - centerRow);
                if (dc <= radC && dr <= radR) {
                    hitCount++;
                }
            }
            
            const distance = Math.abs(centerCol - atkCol);
            
            // Prioritize: 1) Higher hit count, 2) Closer distance
            if (hitCount > bestHitCount || 
                (hitCount === bestHitCount && distance < bestDistance)) {
                bestTarget = candidate;
                bestHitCount = hitCount;
                bestDistance = distance;
            }
        }

        // Fallback: if no good target found, use closest enemy
        if (!bestTarget && validEnemies.length > 0) {
            bestTarget = validEnemies.sort((a, b) => {
                const distA = Math.abs(a.position.col - atkCol);
                const distB = Math.abs(b.position.col - atkCol);
                return distA - distB;
            })[0];
            bestHitCount = 1;
        }

        if (DEBUG_MODE && bestTarget) {
            console.log('[CondenseTargeting] selected target:', {
                attacker: attacker.typeName,
                target: bestTarget.typeName,
                targetPos: bestTarget.position,
                clusterSize: bestHitCount,
                aoeSize: `${rows}x${cols}`,
                sameRowPriority: sameRowEnemies.length > 0
            });
        }

        return bestTarget;
    }

    /**
     * Check if any in-range target sits inside the unit's blind spot.
     * @param {Object} attacker - Attacking unit
     * @param {Object[]} inRangeTargets - Targets already in range
     * @param {boolean} isDefence - Whether attacker is a defence unit
     * @returns {boolean} True if blind spot blocks targeting
     */
    static hasBlindSpot(attacker, inRangeTargets = [], isDefence = false) {
        if (!isDefence) return false;
        const blind = attacker.hasBlindSpot || attacker.HasBlindSpot;
        if (!blind) return false;
        const blindRange = attacker.blindRange || attacker.BlindRange || 1;
        return inRangeTargets.some(t => Math.abs(t.position.col - attacker.position.col) <= blindRange);
    }

    /**
     * Apply on-hit special effects (AoE, lifesteal, statuses, etc.).
     * @param {Object} attacker - Attacking unit
     * @param {Object} target - Target unit
     * @param {Object} scene - Active scene
     */
    static applyOnHitEffects(attacker, target, scene) {
        if (!attacker || !target || !scene) return;

        const base = (typeof attacker.damage === 'number') ? attacker.damage : 0;
        const createPuddle = (attacker.specialEffects || []).find(e => e.Type === 'CreatePuddle');
        const placedPuddles = new Set();
        const placePuddleAt = (row, col) => {
            if (!createPuddle) return;
            if (row === undefined || col === undefined) return;
            const key = `${row},${col}`;
            if (placedPuddles.has(key)) return;
            placedPuddles.add(key);
            try {
                PuddleFactory.placePuddle(scene, row, col, createPuddle, attacker);
            } catch (e) {
                if (DEBUG_MODE) console.warn('[CreatePuddle] place failed', e);
            }
        };

        // Direct hit puddle placement
        if (createPuddle && target.position) {
            placePuddleAt(target.position.row, target.position.col);
        }

        // --- LaserBeam handling ---
        const laser = (attacker.specialEffects || []).find(e => e.Type === 'LaserBeam');
        if (laser && scene && target.position) {
            if (DEBUG_MODE) console.log('Laser beam triggered', {
                attacker: attacker.typeName,
                target: target.typeName,
                laser
            });

            const dir = (target.position.col - (attacker.position?.col ?? 0)) >= 0 ? 1 : -1;
            const grid = scene.grid || [];
            const maxCols = grid[0]?.length || 0;

            // Check if laser can hit a unit
            const canLaserHit = (unit) => {
                if (!unit || unit.currentHealth <= 0 || unit === target) return false;
                if (!SpecialEffectFactory._isEnemyUnitConsideringCharm(attacker, unit)) return false;
                if (!SpecialEffectFactory._passesTargetingFilter(unit, laser.TargetingFilter, attacker)) return false;
                return true;
            };

            if (laser.TravelEntireRow) {
                let c = target.position.col + dir;
                while (c >= 0 && c < maxCols) {
                    const unit = scene.grid[target.position.row][c]?.unit;
                    if (canLaserHit(unit)) {
                        const dmgL = SpecialEffectFactory.applyDamageModifiers(attacker, unit, base, scene);
                        const preHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                        unit.takeDamage(dmgL, attacker);
                        const postHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                        const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, dmgL);
                        if (scene && typeof scene._trackDamage === 'function') {
                            scene._trackDamage(attacker, dealt);
                        }
                        CombatFactory._showDamage(scene, unit, dmgL);
                        StatusEffectFactory.applyStatusEffectsFromSourceToTarget(attacker, unit);
                        if (DEBUG_MODE) console.log('Laser hit unit', {
                            at: [target.position.row, c],
                            unit: unit.typeName,
                            damage: dmgL
                        });
                    }
                    c += dir;
                }
            } else {
                const ext = Math.max(0, Number(laser.Extension || 0));
                for (let step = 1; step <= ext; step++) {
                    const c = target.position.col + (step * dir);
                    if (c < 0 || c >= maxCols) break;
                    const unit = scene.grid[target.position.row][c]?.unit;
                    if (canLaserHit(unit)) {
                        const dmgL = SpecialEffectFactory.applyDamageModifiers(attacker, unit, base, scene);
                        const preHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                        unit.takeDamage(dmgL, attacker);
                        const postHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                        const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, dmgL);
                        if (scene && typeof scene._trackDamage === 'function') {
                            scene._trackDamage(attacker, dealt);
                        }
                        CombatFactory._showDamage(scene, unit, dmgL);
                        StatusEffectFactory.applyStatusEffectsFromSourceToTarget(attacker, unit);
                        if (DEBUG_MODE) console.log('Laser extension hit', {
                            at: [target.position.row, c],
                            unit: unit.typeName,
                            damage: dmgL
                        });
                    }
                }
            }

            // Create puddles along the beam path (target + extension/row)
            if (createPuddle) {
                try {
                    const row = target.position.row;
                    const startCol = target.position.col;
                    if (laser.TravelEntireRow) {
                        let c = startCol;
                        while (c >= 0 && c < maxCols) {
                            placePuddleAt(row, c);
                            c += dir;
                        }
                    } else {
                        placePuddleAt(row, startCol);
                        const extP = Math.max(0, Number(laser.Extension || 0));
                        for (let step = 1; step <= extP; step++) {
                            const c = startCol + (step * dir);
                            if (c < 0 || c >= maxCols) break;
                            placePuddleAt(row, c);
                        }
                    }
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[CreatePuddle][LaserBeam] failed', e);
                }
            }

            if (scene && laser.Sprite && typeof scene.getTileXY === 'function') {
                const t = scene.getTileXY(target.position.row, target.position.col);
                const s = scene.add.sprite(t.x, t.y, laser.Sprite);
                scene.time.delayedCall(400, () => s.destroy());
            }
        }

        // --- AreaOfEffect (splash) handling with targeting filter support ---
        const aoe = (attacker.specialEffects || []).find(e => e.Type === 'AreaOfEffect');
        if (aoe && aoe.Value && scene) {
            if (DEBUG_MODE) console.log('AoE triggered', {
                attacker: attacker.typeName,
                aoe
            });

            let rows = 1,
                cols = 1;
            if (typeof aoe.Value === 'string' && aoe.Value.includes('x')) {
                const parts = aoe.Value.split('x').map(p => parseInt(p, 10) || 1);
                rows = parts[0];
                cols = parts[1];
            } else if (typeof aoe.Value === 'number') {
                rows = cols = aoe.Value;
            }
            const radR = Math.floor(rows / 2);
            const radC = Math.floor(cols / 2);
            const units = scene.units || [];

            // choose centre: attacker (omnidir) or target (default)
            const centerRow = (aoe.IsOmnidirectional && attacker.position) ? attacker.position.row : (target.position?.row);
            const centerCol = (aoe.IsOmnidirectional && attacker.position) ? attacker.position.col : (target.position?.col);
            if (centerRow === undefined || centerCol === undefined) {
                // no valid centre, skip AoE
            } else {
                const alreadyDamaged = new Set();
                if (target) alreadyDamaged.add(target);

                // Create puddles for AoE footprint
                if (createPuddle) {
                    const maxR = (scene.GRID_ROWS || (scene.grid ? scene.grid.length : 5));
                    const maxC = (scene.GRID_COLS || (scene.grid && scene.grid[0] ? scene.grid[0].length : 9));
                    for (let rr = centerRow - radR; rr <= centerRow + radR; rr++) {
                        for (let cc = centerCol - radC; cc <= centerCol + radC; cc++) {
                            if (rr < 0 || rr >= maxR || cc < 0 || cc >= maxC) continue;
                            placePuddleAt(rr, cc);
                        }
                    }
                }

                // collect affected enemy units
                const affected = units.filter(u => {
                    if (!u || !u.position || u.currentHealth <= 0) return false;
                    if (!SpecialEffectFactory._isEnemyUnitConsideringCharm(attacker, u)) return false;
                    if (u === target && !aoe.IncludeDirectTarget) return false;
                    if (!SpecialEffectFactory._passesTargetingFilter(u, aoe.TargetingFilter, attacker)) return false;
                    const dr = Math.abs(u.position.row - centerRow);
                    const dc = Math.abs(u.position.col - centerCol);
                    return dr <= radR && dc <= radC;
                });

                if (DEBUG_MODE) console.log('AoE affected units', affected.map(u => ({
                    type: u.typeName,
                    pos: u.position
                })));

                // If AoE damage is derived from last damage, we still want statuses to apply even if last damage was 0.
                const last = Math.max(0, Math.round(attacker._lastDamageDealtRaw ?? attacker._lastDamageDealt ?? 0));

                for (const u of affected) {
                    if (!u || u.currentHealth <= 0) continue;
                    const rawSplash = Math.round(last * (aoe.SplashFactor !== undefined ? aoe.SplashFactor : 1.0));

                    if (rawSplash > 0) {
                        const finalSplash = SpecialEffectFactory.applyDamageModifiers(attacker, u, rawSplash, scene);
                        if (finalSplash > 0) {
                            const preHp = (typeof u.currentHealth === 'number') ? u.currentHealth : null;
                            u.takeDamage(finalSplash, attacker);
                            const postHp = (typeof u.currentHealth === 'number') ? u.currentHealth : null;
                            const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, finalSplash);
                            if (scene && typeof scene._trackDamage === 'function') {
                                scene._trackDamage(attacker, dealt);
                            }
                            CombatFactory._showDamage(scene, u, finalSplash);
                        }
                    } else {
                        if (DEBUG_MODE) console.info('[AoE] zero splash damage — statuses will still apply', {
                            attacker: attacker.typeName,
                            target: u.typeName
                        });
                    }

                    try {
                        StatusEffectFactory.applyStatusEffectsFromSourceToTarget(attacker, u);
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[AoE] applyStatusEffectsFromSourceToTarget failed', e);
                    }

                    alreadyDamaged.add(u);
                }

                // visual sprite if available
                if (scene && aoe.Sprite && typeof scene.getTileXY === 'function') {
                    const t = scene.getTileXY(centerRow, centerCol);
                    const s = scene.add.sprite(t.x, t.y, aoe.Sprite);
                    scene.time.delayedCall(400, () => s.destroy());
                }

                // Play AoE sound effect if defined
                if (aoe.Audio && scene && scene.sound) {
                    try {
                        scene.sound.play(aoe.Audio, { volume: 0.6 });
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[AoE] sound effect failed', e);
                    }
                }
            }
        }

        // --- Lifesteal handling ---
        const lifesteal = attacker.specialEffects?.find(e => e.Type === 'Lifesteal');
        if (lifesteal && typeof attacker.currentHealth === 'number') {
            const v = lifesteal.Value || 0;
            const healed = Math.round((attacker._lastDamageDealt || 0) * v);
            attacker.currentHealth = Math.min(attacker.health, attacker.currentHealth + healed);
            if (DEBUG_MODE) console.log('Lifesteal healed', {
                attacker: attacker.typeName,
                healed
            });
        }

        // --- SummonUnit handling ---
        const summon = (attacker.specialEffects || []).find(e => e.Type === 'SummonUnit');
        if (summon && scene) {
            attacker._summonCooldown = attacker._summonCooldown || 0;
            if ((attacker._summonCooldown || 0) <= 0) {
                SpecialEffectFactory._performSummon(attacker, summon, scene);
                attacker._summonCooldown = Math.max(0, Number(summon.Cooldown || 0));
                if (DEBUG_MODE) console.log('Perform summon executed', {
                    attacker: attacker.typeName,
                    summon
                });
            }
        }
    }

    /**
     * Execute a DeathEffect payload (AoE heal/damage/purge, etc.).
     * @param {Object} unit - Unit that died
     * @param {Object} effect - DeathEffect configuration
     * @param {Object} scene - Active scene
     */
    static _performDeathEffect(unit, effect, scene) {
        if (!unit || !effect || !scene) return;
        const rows = scene.GRID_ROWS || (scene.grid ? scene.grid.length : 5);
        const cols = scene.GRID_COLS || (scene.grid && scene.grid[0] ? scene.grid[0].length : 9);

        // parse size
        let r = 1,
            c = 1;
        const radius = effect.Radius || effect.Value || '1x1';
        if (typeof radius === 'string' && radius.includes('x')) {
            const parts = radius.split('x').map(p => parseInt(p, 10) || 1);
            r = parts[0];
            c = parts[1];
        } else if (typeof radius === 'number') {
            r = c = radius;
        }
        const radR = Math.floor(r / 2);
        const radC = Math.floor(c / 2);

        const centerRow = unit.position?.row ?? 0;
        const centerCol = unit.position?.col ?? 0;

        const isWithinRadius = (pos) => {
            if (!pos) return false;
            const dr = Math.abs(pos.row - centerRow);
            const dc = Math.abs(pos.col - centerCol);
            return dr <= radR && dc <= radC;
        };

        const targets = [];
        const targetSet = new Set();
        for (let rr = centerRow - radR; rr <= centerRow + radR; rr++) {
            for (let cc = centerCol - radC; cc <= centerCol + radC; cc++) {
                if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
                const u = scene.grid?.[rr]?.[cc]?.unit;
                if (!u || u === unit) continue;
                targets.push(u);
                targetSet.add(u);
            }
        }

        // Include units that are mid-move with a pending position (e.g., trample targets)
        if (Array.isArray(scene.units)) {
            for (const u of scene.units) {
                if (!u || u === unit) continue;
                const pendingPos = u._pendingPosition;
                if (!pendingPos) continue;
                if (isWithinRadius(pendingPos) && !targetSet.has(u)) {
                    targets.push(u);
                    targetSet.add(u);
                }
            }
        }

        // Target filtering helpers
        const passesFilter = (candidate) => {
            return SpecialEffectFactory._passesTargetingFilter(candidate, effect.TargetingFilter, unit);
        };

        // Determine unit type for faction-based filtering
        const unitIsMonster = (unit.typeName in MonsterFactory.monsterData);
        const unitIsDefence = (unit.typeName in DefenceFactory.defenceData);

        // Check if target is enemy or ally for filtering
        const isEnemy = (candidate) => {
            if (unitIsMonster) return (candidate.typeName in DefenceFactory.defenceData);
            if (unitIsDefence) return (candidate.typeName in MonsterFactory.monsterData);
            return SpecialEffectFactory._isEnemyUnit(unit, candidate);
        };
        const isAlly = (candidate) => !isEnemy(candidate);

        // Calculate wave scaling for death damage (monsters past wave 10)
        const wave = CombatFactory.getUnitWave(unit, scene);
        const waveScaling = CombatFactory.getWaveScalingFactor(wave, unitIsMonster);
        const scaledDeathDamage = typeof effect.DeathDamage === 'number' ? 
            Math.round(effect.DeathDamage * waveScaling) : 0;
        const scaledDeathHealing = typeof effect.DeathHealing === 'number' ? 
            Math.round(effect.DeathHealing * waveScaling) : 0;

        if (DEBUG_MODE && waveScaling > 1) {
            console.log('[DeathEffect] Wave scaling applied', {
                unit: unit.typeName,
                wave: wave,
                scalingFactor: waveScaling,
                baseDamage: effect.DeathDamage,
                scaledDamage: scaledDeathDamage,
                baseHealing: effect.DeathHealing,
                scaledHealing: scaledDeathHealing
            });
        }

        // Track units killed by death damage for cleanup
        const unitsKilledByDeathDamage = [];

        for (const tgt of targets) {
            if (!passesFilter(tgt)) continue;

            // Death damage - ONLY hits enemies (opposite type), not allies
            if (scaledDeathDamage > 0) {
                if (isEnemy(tgt)) {
                    const dmg = Math.max(0, scaledDeathDamage);
                    const final = SpecialEffectFactory.applyDamageModifiers(unit, tgt, dmg, scene);
                    const preHp = (typeof tgt.currentHealth === 'number') ? tgt.currentHealth : null;
                    tgt.currentHealth = Math.max(0, tgt.currentHealth - final);
                    const postHp = (typeof tgt.currentHealth === 'number') ? tgt.currentHealth : null;
                    const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, final);
                    if (scene && typeof scene._trackDamage === 'function') {
                        scene._trackDamage(unit, dealt);
                    }
                    CombatFactory._showDamage(scene, tgt, final);
                    if (DEBUG_MODE) console.log('[DeathEffect][Damage] hit enemy', tgt.typeName, 'dmg=', final);
                    if (tgt.currentHealth <= 0 && !tgt._beingRemoved) {
                        unitsKilledByDeathDamage.push(tgt);
                    }
                } else {
                    if (DEBUG_MODE) console.log('[DeathEffect][Damage] skipped ally', tgt.typeName);
                }
            }

            // Death statuses - apply to all valid targets (both allies and enemies)
            if (Array.isArray(effect.DeathStatuses)) {
                try {
                    effect.DeathStatuses.forEach(stat => {
                        if (!stat) return;
                        const copy = {
                            ...stat,
                            _source: unit
                        };
                        StatusEffectFactory.applyStatusToTarget(copy, tgt);
                    });
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[DeathEffect] apply statuses failed', e);
                }
            }

            // Death healing - ONLY applies to allies (same type), not enemies
            if (scaledDeathHealing > 0) {
                if (isAlly(tgt)) {
                    const heal = scaledDeathHealing;
                    tgt.currentHealth = Math.min(tgt.health, (tgt.currentHealth || 0) + heal);
                    if (DEBUG_MODE) console.log('[DeathEffect][Healing] healed ally', tgt.typeName, 'heal=', heal);
                } else {
                    if (DEBUG_MODE) console.log('[DeathEffect][Healing] skipped enemy', tgt.typeName);
                }
            }
        }

        // Clean up units killed by death damage immediately
        for (const u of unitsKilledByDeathDamage) {
            try {
                if (u._beingRemoved) continue;
                u._beingRemoved = true;
                
                // Clean up status effect visuals first
                try {
                    StatusEffectVisuals.cleanupUnitVisuals(u);
                } catch (e) {}
                
                // Clear grid position immediately
                if (u.position && scene.grid && scene.grid[u.position.row] && scene.grid[u.position.row][u.position.col]) {
                    const cell = scene.grid[u.position.row][u.position.col];
                    if (cell.unit === u) {
                        cell.unit = null;
                        cell.sprite = null;
                    }
                }
                
                // Destroy UI elements
                try {
                    if (u.healthBar) { u.healthBar.destroy(); u.healthBar = null; }
                    if (u.healthBarBg) { u.healthBarBg.destroy(); u.healthBarBg = null; }
                    if (u.ammoBar) { u.ammoBar.destroy(); u.ammoBar = null; }
                    if (u.ammoBarBg) { u.ammoBarBg.destroy(); u.ammoBarBg = null; }
                    if (u.reloadBar) { u.reloadBar.destroy(); u.reloadBar = null; }
                    if (u.reloadBarBg) { u.reloadBarBg.destroy(); u.reloadBarBg = null; }
                } catch (e) {}
                
                // Destroy sprite
                try {
                    if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
                } catch (e) {}
                
                // Remove from units array
                if (Array.isArray(scene.units)) {
                    scene.units = scene.units.filter(unit => unit !== u);
                }
                
                if (DEBUG_MODE) console.log('[DeathEffect] cleaned up unit killed by death damage', u.typeName);
            } catch (e) {
                if (DEBUG_MODE) console.warn('[DeathEffect] cleanup failed', e);
            }
        }

        // optional visual
        if (scene && effect.Sprite && typeof scene.getTileXY === 'function') {
            const t = scene.getTileXY(centerRow, centerCol);
            const s = scene.add.sprite(t.x, t.y, effect.Sprite);
            scene.time.delayedCall(600, () => s.destroy());
        }

        // Play death sound effect if defined
        if (effect.Audio && scene && scene.sound) {
            try {
                scene.sound.play(effect.Audio, { volume: 0.6 });
            } catch (e) {
                if (DEBUG_MODE) console.warn('[DeathEffect] sound effect failed', e);
            }
        }
    }

    /**
     * Handle unit death effects (DeathEffect, shield cleanup, etc.).
     * @param {Object} unit - Unit that died
     * @param {Object} scene - Active scene
     */
    static handleOnDeath(unit, scene) {
        if (!unit) return;
        if (!Array.isArray(unit.specialEffects) || !scene || !unit.position) return;

        const death = unit.specialEffects.find(e => e.Type === 'DeathEffect');
        const createPuddle = unit.specialEffects.find(e => e.Type === 'CreatePuddle');
        if (!death) return;
        
        // Mark that DeathEffect has been triggered to prevent double-triggering
        if (unit._deathEffectTriggered) return;
        unit._deathEffectTriggered = true;

        const baseDamage = Number(death.DeathDamage || 0);
        const heal = Number(death.DeathHealing || 0);

        // Calculate wave scaling for monsters past wave 10
        const wave = CombatFactory.getUnitWave(unit, scene);
        let scaling = CombatFactory.getWaveScalingFactor(wave, unit.typeName in MonsterFactory.monsterData);
        const scaledBaseDamage = Math.round(baseDamage * scaling);
        const scaledHeal = Math.round(heal * scaling);
        
        if (DEBUG_MODE && scaling > 1) {
            console.log('[handleOnDeath] Wave scaling applied', {
                unit: unit.typeName,
                wave: wave,
                scalingFactor: scaling,
                baseDamage: baseDamage,
                scaledDamage: scaledBaseDamage,
                baseHeal: heal,
                scaledHeal: scaledHeal
            });
        }

        const rowsCols = (() => {
            const raw = death.Radius ?? death.Value ?? null;
            if (typeof raw === 'string' && raw.includes('x')) {
                const p = raw.split('x').map(n => parseInt(n, 10) || 1);
                return {
                    rows: p[0],
                    cols: p[1]
                };
            } else if (typeof raw === 'number') {
                return {
                    rows: raw,
                    cols: raw
                };
            }
            return {
                rows: 1,
                cols: 1
            };
        })();
        const radR = Math.floor(rowsCols.rows / 2);
        const radC = Math.floor(rowsCols.cols / 2);

        const centerRow = unit.position.row;
        const centerCol = unit.position.col;
        const allUnits = scene.units || [];

        // Create puddles around the unit on death (uses DeathEffect radius)
        if (createPuddle && unit.position) {
            const maxR = scene.GRID_ROWS || (scene.grid ? scene.grid.length : 5);
            const maxC = scene.GRID_COLS || (scene.grid && scene.grid[0] ? scene.grid[0].length : 9);
            for (let rr = centerRow - radR; rr <= centerRow + radR; rr++) {
                for (let cc = centerCol - radC; cc <= centerCol + radC; cc++) {
                    if (rr < 0 || rr >= maxR || cc < 0 || cc >= maxC) continue;
                    try {
                        PuddleFactory.placePuddle(scene, rr, cc, createPuddle, unit);
                    } catch (e) {
                        if (DEBUG_MODE) console.warn('[CreatePuddle][DeathEffect] place failed', e);
                    }
                }
            }
        }

        // Determine unit type (monster or defence)
        const unitIsMonster = (unit.typeName in MonsterFactory.monsterData);
        const unitIsDefence = (unit.typeName in DefenceFactory.defenceData);

        const tf = death.TargetingFilter || {};
        const shouldInclude = (candidate, forHealing) => {
            if (!candidate) return false;
            const pos = candidate._pendingPosition || candidate.position;
            if (!pos) return false;

            // Skip the unit that triggered the death effect
            if (candidate === unit) return false;

            // Determine candidate type
            const candidateIsMonster = (candidate.typeName in MonsterFactory.monsterData);
            const candidateIsDefence = (candidate.typeName in DefenceFactory.defenceData);

            // Death damage should only hit enemies (opposite type), not allies
            // Death healing should only hit allies (same type)
            if (forHealing) {
                if (unitIsMonster && !candidateIsMonster) return false;
                if (unitIsDefence && !candidateIsDefence) return false;
            } else {
                if (unitIsMonster && !candidateIsDefence) return false;
                if (unitIsDefence && !candidateIsMonster) return false;
            }

            // Apply targeting filters using unified method
            if (!SpecialEffectFactory._passesTargetingFilter(candidate, tf, unit)) return false;

            return true;
        };

        // Track units that died from death damage for cleanup
        const unitsToCleanup = [];

        // Apply death effect damage/healing but DO NOT finalize deaths
        // Let the lifecycle phase handle that
        const getUnitPos = (candidate) => candidate?._pendingPosition || candidate?.position;

        for (const u of allUnits.slice()) {
            const pos = getUnitPos(u);
            if (!pos) continue;
            const dr = Math.abs(pos.row - centerRow);
            const dc = Math.abs(pos.col - centerCol);
            if (dr <= radR && dc <= radC) {
                try {
                    // Death damage - only hits enemies
                    if (scaledBaseDamage > 0 && shouldInclude(u, false)) {
                        const final = SpecialEffectFactory.applyDamageModifiers(unit, u, scaledBaseDamage, scene);
                        const preHp = (typeof u.currentHealth === 'number') ? u.currentHealth : null;
                        u.currentHealth = Math.max(0, u.currentHealth - final);
                        const postHp = (typeof u.currentHealth === 'number') ? u.currentHealth : null;
                        const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, final);
                        if (scene && typeof scene._trackDamage === 'function') {
                            scene._trackDamage(unit, dealt);
                        }
                        CombatFactory._showDamage(scene, u, final);
                        if (u.currentHealth <= 0 && !u._beingRemoved) {
                            u.currentHealth = 0;
                            unitsToCleanup.push(u);
                            if (DEBUG_MODE) console.log('[DeathEffect] unit killed by death damage', u.typeName, u.position);
                        }
                    }
                    
                    // Death healing - only hits allies
                    if (scaledHeal > 0 && shouldInclude(u, true)) {
                        u.currentHealth = Math.min(u.health, (u.currentHealth || u.health) + scaledHeal);
                    }

                    // Death statuses - apply to both allies and enemies (but not self)
                    if (Array.isArray(death.DeathStatuses) && death.DeathStatuses.length && u !== unit) {
                        for (const s of death.DeathStatuses) {
                            const copy = {
                                ...s,
                                _source: unit
                            };
                            StatusEffectFactory.applyStatusToTarget(copy, u);
                        }
                    }
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[DeathEffect] apply failed', e);
                }
            }
        }
        
        // Clean up units that died from death damage immediately
        // This prevents issues with units having negative health lingering
        for (const u of unitsToCleanup) {
            try {
                if (u._beingRemoved) continue;
                u._beingRemoved = true;

                // Clean up status effect visuals first
                try {
                    StatusEffectVisuals.cleanupUnitVisuals(u);
                } catch (e) {}
                
                // Clear grid position immediately
                if (u.position && scene.grid && scene.grid[u.position.row] && scene.grid[u.position.row][u.position.col]) {
                    const cell = scene.grid[u.position.row][u.position.col];
                    if (cell.unit === u) {
                        cell.unit = null;
                        cell.sprite = null;
                    }
                }
                
                // Destroy UI elements
                try {
                    if (u.healthBar) { u.healthBar.destroy(); u.healthBar = null; }
                    if (u.healthBarBg) { u.healthBarBg.destroy(); u.healthBarBg = null; }
                    if (u.ammoBar) { u.ammoBar.destroy(); u.ammoBar = null; }
                    if (u.ammoBarBg) { u.ammoBarBg.destroy(); u.ammoBarBg = null; }
                    if (u.reloadBar) { u.reloadBar.destroy(); u.reloadBar = null; }
                    if (u.reloadBarBg) { u.reloadBarBg.destroy(); u.reloadBarBg = null; }
                } catch (e) {}
                
                // Destroy sprite
                try {
                    if (u.sprite) { u.sprite.destroy(); u.sprite = null; }
                } catch (e) {}
                
                // Remove from units array
                if (Array.isArray(scene.units)) {
                    scene.units = scene.units.filter(unit => unit !== u);
                }
                
                if (DEBUG_MODE) console.log('[DeathEffect] cleaned up unit killed by death damage', u.typeName);
            } catch (e) {
                if (DEBUG_MODE) console.warn('[DeathEffect] cleanup failed', e);
            }
        }

        // VFX
        try {
            if (death.Sprite && typeof scene.getTileXY === 'function') {
                const t = scene.getTileXY(centerRow, centerCol);
                const s = scene.add.sprite(t.x, t.y, death.Sprite);
                scene.time.delayedCall(400, () => s.destroy());
            }
        } catch (e) {}
    }

    /**
     * Attempt to revive a unit according to its Revive special effect.
     * @param {Object} unit - Unit to revive
     * @param {Object|null} scene - Active scene
     * @returns {boolean} True if revived
     */
    static reviveUnit(unit, scene = null) {
        if (!unit || !Array.isArray(unit.specialEffects)) return false;
        const revive = unit.specialEffects.find(e => e.Type === 'Revive');
        if (!revive) return false;

        // Initialize revive count if not set
        unit._reviveCount = unit._reviveCount || 0;
        const maxRevives = (revive.MaxRevives !== undefined) ? Number(revive.MaxRevives) : 1;
        
        // Check revive count BEFORE attempting - if already at max, don't even try
        if (unit._reviveCount >= maxRevives) {
            if (DEBUG_MODE) console.log('[Revive] max revives reached', unit.typeName, unit._reviveCount, '>=', maxRevives);
            return false;
        }

        // Check chance BEFORE incrementing count
        const chance = (revive.ReviveChance !== undefined) ? Number(revive.ReviveChance) : 1.0;
        const roll = Math.random();
        if (roll > chance) {
            // FAILED: increment count for failed attempt
            unit._reviveCount++;
            if (DEBUG_MODE) console.log('[Revive] chance failed', unit.typeName, 'roll=', roll, 'chance=', chance, 'count=', unit._reviveCount, '/', maxRevives);
            
            // If this was the last allowed attempt and it failed, ensure unit is cleaned up
            if (unit._reviveCount >= maxRevives) {
                if (DEBUG_MODE) console.log('[Revive] final attempt failed, marking for cleanup', unit.typeName);
                unit._reviveExhausted = true;
            }
            return false;
        }

        // SUCCESS: increment revive usage
        unit._reviveCount++;
        if (DEBUG_MODE) console.log('[Revive] chance succeeded', unit.typeName, 'roll=', roll, 'chance=', chance, 'count=', unit._reviveCount, '/', maxRevives);

        // Save original base stats ONCE on first revive attempt (successful or not)
        // This ensures we always scale from the original stats, not progressively weaker stats
        if (!Number.isFinite(unit._originalBaseHealth)) {
            unit._originalBaseHealth = Number.isFinite(unit.health) ? Number(unit.health) : (Number.isFinite(unit.currentHealth) ? Number(unit.currentHealth) : 1);
        }
        if (!Number.isFinite(unit._originalBaseDamage)) {
            unit._originalBaseDamage = Number.isFinite(unit.damage) ? Number(unit.damage) : 0;
        }

        // If the unit is currently flagged as being removed, allow revive to reclaim it
        // but clear the flag here so other cleanup paths won't prematurely ignore the revived unit.
        unit._beingRemoved = false;

        // capture last known position if available (end-turn cleanup should set this)
        // Validate the position is within grid bounds
        const gridRows = scene?.GRID_ROWS ?? (scene?.grid?.length ?? 5);
        const gridCols = scene?.GRID_COLS ?? (scene?.grid?.[0]?.length ?? 9);
        
        if (unit.position && (!unit._lastPosition)) {
            try {
                const row = unit.position.row;
                const col = unit.position.col;

                // Only save if position is valid
                if (Number.isFinite(row) && Number.isFinite(col) &&
                    row >= 0 && row < gridRows && col >= 0 && col < gridCols) {
                    unit._lastPosition = { row, col };
                }
            } catch (e) {
                // Invalid position, don't save
            }
        }

        // reset lifespan to default if unit has lifespan enabled
        if (Number.isFinite(unit.lifespan) || Number.isFinite(unit.Lifespan)) {
            unit._lifespan = Number(unit.lifespan ?? unit.Lifespan);
        }

        // Play revive sound effect
        try {
            if (scene.sound) {
                scene.sound.play('revive', { volume: 0.7 });
            }
        } catch (e) {}

        // compute new stats from ORIGINAL bases (not current stats)
        // Apply multiplier based on how many revives have been USED (including this one)
        const hMult = (revive.HealthMult !== undefined) ? Number(revive.HealthMult) : 1.0;
        const dMult = (revive.DamageMult !== undefined) ? Number(revive.DamageMult) : 1.0;

        // Calculate cumulative multiplier: each revive applies the multiplier to the original
        // e.g., if HealthMult=0.5: 1st revive = 0.5, 2nd revive = 0.25, etc.
        const reviveMultiplier = Math.pow(hMult, unit._reviveCount);
        const damageMultiplier = Math.pow(dMult, unit._reviveCount);

        // base values to use: prefer _originalBaseHealth/_originalBaseDamage which we've ensured above
        const baseHealth = Number.isFinite(unit._originalBaseHealth) ? Number(unit._originalBaseHealth) : Math.max(1, Number(unit.health || unit.currentHealth || 1));
        const baseDamage = Number.isFinite(unit._originalBaseDamage) ? Number(unit._originalBaseDamage) : Math.max(0, Number(unit.damage || 0));

        unit.health = Math.max(1, Math.round(baseHealth * reviveMultiplier));
        unit.currentHealth = Math.max(1, Math.round(unit.health));
        unit.damage = Math.max(0, Math.round(baseDamage * damageMultiplier));

        // Determine placement origin: prefer _lastPosition, then unit.position
        let placedRow = Number.isFinite(unit._lastPosition?.row) ? unit._lastPosition.row : (Number.isFinite(unit.position?.row) ? unit.position.row : undefined);
        let placedCol = Number.isFinite(unit._lastPosition?.col) ? unit._lastPosition.col : (Number.isFinite(unit.position?.col) ? unit.position.col : undefined);

        // Validate that the position is within grid bounds
        if (Number.isFinite(placedRow) && Number.isFinite(placedCol)) {
            placedRow = Math.max(0, Math.min(gridRows - 1, placedRow));
            placedCol = Math.max(0, Math.min(gridCols - 1, placedCol));
        }

        // If origin missing or invalid, try to derive from scene (best-effort)
        if (!Number.isFinite(placedRow) || !Number.isFinite(placedCol)) {
            if (scene && Array.isArray(scene.grid)) {
                outerLoop: for (let r = 0; r < gridRows; r++) {
                    for (let c = 0; c < gridCols; c++) {
                        const occ = scene.grid[r]?.[c]?.unit;
                        if (!occ || occ === unit || occ._beingRemoved || (typeof occ.currentHealth === 'number' && occ.currentHealth <= 0)) {
                            placedRow = r;
                            placedCol = c;
                            break outerLoop;
                        }
                    }
                }
            }
        }

        // If still missing placedRow/placedCol, fail safely
        if (!Number.isFinite(placedRow) || !Number.isFinite(placedCol)) {
            if (DEBUG_MODE) console.warn('[Revive] missing origin position, cancel revive', unit.typeName);
            return false;
        }

        // Defensive: ensure scene.grid arrays exist for indices used below
        try {
            if (scene && !Array.isArray(scene.grid)) scene.grid = [];
            for (let r = 0; r < gridRows; r++) {
                scene.grid[r] = scene.grid[r] || [];
                for (let c = 0; c < gridCols; c++) {
                    scene.grid[r][c] = scene.grid[r][c] || { sprite: null, unit: null };
                }
            }
        } catch (e) {}

        // If the original spot contains another unit which is dead or beingRemoved, clear it so we can reclaim
        try {
            const occupant = scene?.grid?.[placedRow]?.[placedCol]?.unit;
            if (occupant && occupant !== unit) {
                if (occupant._beingRemoved || (typeof occupant.currentHealth === 'number' && occupant.currentHealth <= 0)) {
                    try {
                        if (occupant.healthBar) { occupant.healthBar.destroy(); occupant.healthBar = null; }
                        if (occupant.healthBarBg) { occupant.healthBarBg.destroy(); occupant.healthBarBg = null; }
                        if (occupant.ammoBar) { occupant.ammoBar.destroy(); occupant.ammoBar = null; }
                        if (occupant.ammoBarBg) { occupant.ammoBarBg.destroy(); occupant.ammoBarBg = null; }
                        if (occupant.reloadBar) { occupant.reloadBar.destroy(); occupant.reloadBar = null; }
                        if (occupant.reloadBarBg) { occupant.reloadBarBg.destroy(); occupant.reloadBarBg = null; }
                    } catch (e) {}
                    try {
                        if (scene.grid[placedRow][placedCol].sprite) {
                            try {
                                scene.grid[placedRow][placedCol].sprite.destroy();
                            } catch (e) {}
                        }
                    } catch (e) {}
                    scene.grid[placedRow][placedCol].unit = null;
                    scene.grid[placedRow][placedCol].sprite = null;
                    try {
                        if (Array.isArray(scene.units)) scene.units = scene.units.filter(x => x !== occupant);
                    } catch (e) {}
                } else {
                    let foundNearby = false;
                    for (let r = Math.max(0, placedRow - 2); r <= Math.min(gridRows - 1, placedRow + 2) && !foundNearby; r++) {
                        for (let c = Math.max(0, placedCol - 2); c <= Math.min(gridCols - 1, placedCol + 2) && !foundNearby; c++) {
                            const occ2 = scene.grid[r]?.[c]?.unit;
                            if (!occ2 || occ2 === unit || occ2._beingRemoved || (typeof occ2.currentHealth === 'number' && occ2.currentHealth <= 0)) {
                                if (occ2 && occ2 !== unit) {
                                    try {
                                        if (occ2.healthBar) { occ2.healthBar.destroy(); occ2.healthBar = null; }
                                        if (occ2.healthBarBg) { occ2.healthBarBg.destroy(); occ2.healthBarBg = null; }
                                        if (occ2.ammoBar) { occ2.ammoBar.destroy(); occ2.ammoBar = null; }
                                        if (occ2.ammoBarBg) { occ2.ammoBarBg.destroy(); occ2.ammoBarBg = null; }
                                        if (occ2.reloadBar) { occ2.reloadBar.destroy(); occ2.reloadBar = null; }
                                        if (occ2.reloadBarBg) { occ2.reloadBarBg.destroy(); occ2.reloadBarBg = null; }
                                        if (occ2.sprite) { occ2.sprite.destroy(); }
                                    } catch (e) {}
                                }
                                placedRow = r;
                                placedCol = c;
                                foundNearby = true;
                                break;
                            }
                        }
                    }
                    if (!foundNearby) {
                        if (DEBUG_MODE) console.warn('[Revive] no empty tile near origin to respawn', unit.typeName);
                        return false;
                    }
                }
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('[Revive] occupant check failed', e);
        }

        // assign position
        unit.position = {
            row: placedRow,
            col: placedCol
        };

        // create or reassign sprite
        try {
            let spr = unit.sprite;
            if (!spr || !spr.scene) {
                if (scene && typeof scene.ensureSpriteForUnit === 'function') {
                    const t = (typeof scene.getTileXY === 'function') ? scene.getTileXY(placedRow, placedCol) : {
                        x: (scene.GRID_OFFSET_X ?? 300) + placedCol * (scene.TILE_SIZE ?? 60),
                        y: (scene.GRID_OFFSET_Y ?? 150) + placedRow * (scene.TILE_SIZE ?? 60)
                    };
                    spr = scene.ensureSpriteForUnit(unit, t.x, t.y + (scene.UNIT_Y_OFFSET || 0), false);
                    if (spr && spr.setInteractive) {
                        try {
                            spr.setInteractive();
                        } catch (e) {}
                    }
                } else if (scene) {
                    const t = (typeof scene.getTileXY === 'function') ? scene.getTileXY(placedRow, placedCol) : {
                        x: (scene.GRID_OFFSET_X ?? 300) + placedCol * (scene.TILE_SIZE ?? 60),
                        y: (scene.GRID_OFFSET_Y ?? 150) + placedRow * (scene.TILE_SIZE ?? 60)
                    };
                    try {
                        spr = scene.add.sprite(t.x, t.y + (scene.UNIT_Y_OFFSET || 0), unit.displaySprite || 'dice1');
                        spr.setOrigin && spr.setOrigin(0.5, 0.5);
                    } catch (e) {}
                }
                unit.sprite = spr;
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('[Revive] sprite recreation failed', e);
        }

        // ensure grid references & arrays updated
        try {
            scene.grid[placedRow] = scene.grid[placedRow] || [];
            scene.grid[placedRow][placedCol] = scene.grid[placedRow][placedCol] || {
                sprite: null,
                unit: null
            };
            scene.grid[placedRow][placedCol].unit = unit;
            scene.grid[placedRow][placedCol].sprite = unit.sprite || scene.grid[placedRow][placedCol].sprite;
        } catch (e) {
            if (DEBUG_MODE) console.warn('[Revive] grid assignment failed', e);
        }

        // ensure unit is present in scene.units and not duplicated
        try {
            scene.units = scene.units || [];
            if (!scene.units.includes(unit)) scene.units.push(unit);
            // also remove any other references to this exact object that might exist duplicated (defensive)
            scene.units = scene.units.filter((x, i, arr) => arr.indexOf(x) === i);
        } catch (e) {
            if (DEBUG_MODE) console.warn('[Revive] scene.units push failed', e);
        }

        // reset removal flags so other code won't dismiss it
        try {
            unit._beingRemoved = false;
        } catch (e) {}
        try {
            delete unit._pendingRemoval;
        } catch (e) {}

        // Clean up any existing UI bars on the revived unit to prevent duplicates
        try {
            if (unit.healthBar) { unit.healthBar.destroy(); unit.healthBar = null; }
            if (unit.healthBarBg) { unit.healthBarBg.destroy(); unit.healthBarBg = null; }
            if (unit.ammoBar) { unit.ammoBar.destroy(); unit.ammoBar = null; }
            if (unit.ammoBarBg) { unit.ammoBarBg.destroy(); unit.ammoBarBg = null; }
            if (unit.reloadBar) { unit.reloadBar.destroy(); unit.reloadBar = null; }
            if (unit.reloadBarBg) { unit.reloadBarBg.destroy(); unit.reloadBarBg = null; }
        } catch (e) {}

        // add UI bars and run place-time effects
        try {
            if (typeof scene.addUnitBars === 'function') scene.addUnitBars(unit, unit.sprite);
        } catch (e) {
            if (DEBUG_MODE) console.warn('[Revive] addUnitBars failed', e);
        }
        try {
            SpecialEffectFactory.handleOnPlace(unit, scene);
        } catch (e) {
            if (DEBUG_MODE) console.warn('[Revive] handleOnPlace failed', e);
        }

        if (DEBUG_MODE) console.log('[Revive] SUCCESS - unit revived', unit.typeName, 'revivesUsed=', unit._reviveCount, 'pos=', unit.position, 'hp=', unit.currentHealth, 'max=', unit.health, 'dmg=', unit.damage);
        return true;
    }

    /**
     * Intercept damage with force fields (BlockAllLanes, shields).
     * Returns remaining damage after interception.
     * @param {Object} attacker - Attacking unit
     * @param {Object} target - Intended target unit
     * @param {number} damage - Incoming damage
     * @param {Object} scene - Active scene
     * @returns {number} Remaining damage after force field absorption
     */
    static handleForceField(attacker, target, damage, scene) {
        // Return early for invalid inputs
        if (!scene || !attacker || !target || typeof damage !== 'number' || !Array.isArray(scene.grid)) {
            return damage;
        }

        scene.forceFields = scene.forceFields || {};

        try {
            // if attacker/target lack positions, do nothing
            if (!attacker.position || !target.position ||
                !Number.isFinite(attacker.position.col) ||
                !Number.isFinite(target.position.col)) {
                return damage;
            }

            // Direction from attacker toward target: +1 or -1
            const dir = Math.sign(target.position.col - attacker.position.col) || 1;
            let c = attacker.position.col + dir;
            const maxCol = scene.grid[0]?.length ?? (scene.GRID_COLS || 9);

            // Remaining damage that still needs to be applied to target
            let remaining = Math.max(0, Math.round(damage));

            const removeShieldEntry = (col, ff) => {
                try {
                    const colEntry = scene.forceFields[col];
                    if (Array.isArray(colEntry)) {
                        scene.forceFields[col] = colEntry.filter(x => x !== ff);
                        if (scene.forceFields[col].length === 0) delete scene.forceFields[col];
                    } else if (colEntry === ff) {
                        delete scene.forceFields[col];
                    }
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[handleForceField] removeShieldEntry failed', e);
                }
            };

            // iterate columns between attacker and target (inclusive of target's column for BlockAllLanes)
            // We need to check ALL columns including the target's column for BlockAllLanes shields
            while ((dir > 0 && c <= target.position.col) || (dir < 0 && c >= target.position.col)) {
                if (remaining <= 0) return 0;

                const colEntry = scene.forceFields[c];
                if (!colEntry) {
                    c += dir;
                    if (c < 0 || c >= maxCol) break;
                    continue;
                }

                // Normalize to array copy to avoid mutation issues while iterating
                const ffList = Array.isArray(colEntry) ? colEntry.slice() : [colEntry];

                // process each force-field generator in this column
                for (const ff of ffList) {
                    if (!ff || ff.currentHealth <= 0) continue;
                    
                    // only intercept if unit is an enemy of the attacker
                    if (!SpecialEffectFactory._isEnemyUnit(attacker, ff)) continue;
                    
                    // Check if this force field has BlockAllLanes - if so, it intercepts regardless of row
                    const hasBlockAllLanes = ff.specialEffects?.some(e => e.Type === 'BlockAllLanes');
                    
                    // For BlockAllLanes, the shield blocks ALL attacks passing through this column
                    // regardless of which row they come from or go to
                    if (!hasBlockAllLanes) {
                        const atkRow = attacker.position?.row;
                        const ffRow = ff.position?.row;
                        if (atkRow !== undefined && ffRow !== undefined && atkRow !== ffRow) {
                            continue;
                        }
                    }

                    // ensure shield bookkeeping vars exist
                    ff._blockShield = Number.isFinite(ff._blockShield) ? ff._blockShield : Number(ff.ShieldValue ?? ff._blockShield ?? 0);
                    ff._blockDissipates = (ff._blockDissipates !== undefined) ? !!ff._blockDissipates : !!ff.DissipatesWhenDestroyed;

                    // If shield present and >0, it absorbs first (shield takes damage BEFORE generator)
                    if (ff._blockShield > 0 && remaining > 0) {
                        const beforeShield = ff._blockShield;
                        const absorbed = Math.min(remaining, beforeShield);

                        ff._blockShield = Math.max(0, beforeShield - absorbed);
                        remaining = Math.max(0, remaining - absorbed);

                        // record last dealt portion for visual/stats usage
                        attacker._lastDamageDealt = absorbed;

                        if (DEBUG_MODE) {
                            console.log('[handleForceField] shield absorbed', {
                                column: c,
                                generator: ff.typeName || ff.TypeName || ff,
                                absorbed,
                                shieldBefore: beforeShield,
                                shieldAfter: ff._blockShield,
                                remaining,
                                blockAllLanes: hasBlockAllLanes
                            });
                        }

                        // Shield damage VFX - show shield_break when shield takes damage (but isn't depleted)
                        if (ff._blockShield > 0 && absorbed > 0) {
                            try {
                                if (scene && ff.position && typeof scene.getTileXY === 'function') {
                                    const t = scene.getTileXY(ff.position.row, ff.position.col);
                                    const s = scene.add.sprite(t.x, t.y, 'shield_break');
                                    s.setOrigin(0.5, 0.5);
                                    s.setScale(0.8);
                                    scene.time.delayedCall(300, () => s.destroy());
                                }
                            } catch (e) {}
                        }

                        // if shield now depleted, handle dissipation or leave generator intact without shield
                        if (ff._blockShield === 0) {
                            try {
                                if (scene && ff.position && typeof scene.getTileXY === 'function') {
                                    const t = scene.getTileXY(ff.position.row, ff.position.col);
                                    const s = scene.add.sprite(t.x, t.y, 'shield_burst');
                                    s.setOrigin(0.5, 0.5);
                                    s.setScale(1.0);
                                    scene.time.delayedCall(600, () => s.destroy());
                                }
                            } catch (e) {}

                            // Play shield break sound effect
                            try {
                                if (scene.sound) {
                                    scene.sound.play('shield_break', { volume: 0.6 });
                                }
                            } catch (e) {}

                            // Clean up shield VFX when shield is depleted
                            try {
                                if (ff._shieldVFX && Array.isArray(ff._shieldVFX)) {
                                    ff._shieldVFX.forEach(spr => {
                                        try {
                                            if (spr && spr.destroy) spr.destroy();
                                        } catch (e) {}
                                    });
                                    ff._shieldVFX = [];
                                }
                            } catch (e) {}

                            if (ff._blockDissipates) {
                                try {
                                    if (typeof scene._removeUnitCompletely === 'function') {
                                        if (DEBUG_MODE) console.log('[handleForceField] shield dissipates => removing generator', ff.typeName);
                                        scene._removeUnitCompletely(ff);
                                    } else {
                                        removeShieldEntry(c, ff);
                                        try {
                                            if (ff.position && scene.grid[ff.position.row] && scene.grid[ff.position.row][ff.position.col]) {
                                                const cell = scene.grid[ff.position.row][ff.position.col];
                                                if (cell.sprite) try {
                                                    cell.sprite.destroy();
                                                } catch (e) {}
                                                cell.unit = null;
                                                cell.sprite = null;
                                            }
                                        } catch (e) {}
                                        try {
                                            if (ff.sprite) ff.sprite.destroy();
                                        } catch (e) {}
                                        try {
                                            scene.units = (scene.units || []).filter(x => x !== ff);
                                        } catch (e) {}
                                    }
                                } catch (e) {
                                    if (DEBUG_MODE) console.warn('[handleForceField] dissipate destroy failed', e);
                                }
                            } else {
                                try {
                                    removeShieldEntry(c, ff);
                                } catch (e) {}
                            }
                        }

                        // If the shield absorbed all remaining damage, the attack stops here
                        if (remaining <= 0) return 0;
                    }

                    // If there is still damage left, and the generator has health, allow overflow to damage the generator itself
                    // BUT only if the shield is depleted or this is not a BlockAllLanes shield
                    if (remaining > 0 && ff.currentHealth > 0 && ff._blockShield <= 0) {
                        const beforeHP = ff.currentHealth;
                        const dmgToGen = Math.min(remaining, beforeHP);

                        ff.currentHealth = Math.max(0, beforeHP - dmgToGen);
                        remaining = Math.max(0, remaining - dmgToGen);
                        attacker._lastDamageDealt = dmgToGen;

                        if (DEBUG_MODE) {
                            console.log('[handleForceField] overflow damaged generator', {
                                column: c,
                                generator: ff.typeName || ff.TypeName || ff,
                                dmgToGen,
                                hpBefore: beforeHP,
                                hpAfter: ff.currentHealth,
                                remaining
                            });
                        }

                        // if generator reached 0 and it's supposed to be removed (DissipatesWhenDestroyed or forced), remove it
                        if (ff.currentHealth === 0) {
                            try {
                                if (typeof scene._removeUnitCompletely === 'function') {
                                    if (DEBUG_MODE) console.log('[handleForceField] generator destroyed by overflow', ff.typeName);
                                    scene._removeUnitCompletely(ff);
                                } else {
                                    removeShieldEntry(c, ff);
                                    try {
                                        if (ff.position && scene.grid[ff.position.row] && scene.grid[ff.position.row][ff.position.col]) {
                                            const cell = scene.grid[ff.position.row][ff.position.col];
                                            if (cell.sprite) try {
                                                cell.sprite.destroy();
                                            } catch (e) {}
                                            cell.unit = null;
                                            cell.sprite = null;
                                        }
                                    } catch (e) {}
                                    try {
                                        if (ff.sprite) ff.sprite.destroy();
                                    } catch (e) {}
                                    try {
                                        scene.units = (scene.units || []).filter(x => x !== ff);
                                    } catch (e) {}
                                }
                            } catch (e) {
                                if (DEBUG_MODE) console.warn('[handleForceField] cleanup after generator death failed', e);
                            }
                        }

                        if (remaining <= 0) return 0;
                    }
                }

                c += dir;
                if (c < 0 || c >= maxCol) break;
            }

            return Math.max(0, Math.round(remaining));
        } catch (e) {
            if (DEBUG_MODE) console.warn('handleForceField: shield path interception failed', e);
            return damage;
        }
    }

    /**
     * Pick a force field that should intercept attacks between attacker and targets.
     * @param {Object} attacker - Attacking unit
     * @param {Object[]} enemies - Candidate targets
     * @param {Object} scene - Active scene
     * @returns {Object|null} Intercepting force field or null
     */
    static interceptWithForceField(attacker, enemies, scene) {
        if (!attacker || !attacker.position || !scene) return null;
        const grid = scene.grid || [];
        if (scene.forceFields && Object.keys(scene.forceFields).length) {
            const enemyCols = enemies.filter(e => e && e.position).map(e => e.position.col);
            if (enemyCols.length) {
                const nearestEnemyCol = enemyCols.reduce((a, b) => Math.abs(a - attacker.position.col) < Math.abs(b - attacker.position.col) ? a : b);
                const dir = (nearestEnemyCol >= attacker.position.col) ? 1 : -1;
                let c = attacker.position.col + dir;
                while ((dir > 0 && c <= nearestEnemyCol) || (dir < 0 && c >= nearestEnemyCol)) {
                    const colEntry = scene.forceFields && scene.forceFields[c];
                    const ffList = Array.isArray(colEntry) ? colEntry : (colEntry ? [colEntry] : []);
                    for (const ff of ffList) {
                        if (ff && ff.currentHealth > 0 && SpecialEffectFactory._isEnemyUnit(attacker, ff)) {
                            const hasBlockAllLanes = ff.specialEffects?.some(e => e.Type === 'BlockAllLanes');
                            if (hasBlockAllLanes) {
                                const hasShield = ff._blockShield > 0 || ff.ShieldValue > 0;
                                if (hasShield || c === nearestEnemyCol) {
                                    return ff;
                                }
                            }
                            // For other force fields, check if it's in the enemies list
                            if (enemies.some(e => e === ff)) {
                                return ff;
                            }
                        }
                    }
                    c += dir;
                    if (c < 0 || c >= (grid[0]?.length || scene.GRID_COLS || 9)) break;
                }
            }
        }
        return null;
    }

    /**
     * Helper function to check if a candidate passes targeting filters
     * @param {Object} candidate - The unit to check
     * @param {Object} targetingFilter - The targeting filter configuration
     * @param {Object} sourceUnit - The unit applying the effect (for faction checks)
     * @returns {boolean} - Whether the candidate passes the filter
     */
    static _passesTargetingFilter(candidate, targetingFilter, sourceUnit = null) {
        if (!targetingFilter || typeof targetingFilter !== 'object') return true;

        const tf = targetingFilter;

        // Check Exclude filters first
        if (tf.Exclude && typeof tf.Exclude === 'object') {
            if (tf.Exclude.StatusEffect && Array.isArray(tf.Exclude.StatusEffect)) {
                if (Array.isArray(candidate.status) && candidate.status.some(s => tf.Exclude.StatusEffect.includes(s.Type))) return false;
            }
            if (tf.Exclude.MonsterType && Array.isArray(tf.Exclude.MonsterType)) {
                if (tf.Exclude.MonsterType.includes(candidate.typeName)) return false;
            }
            if (tf.Exclude.DefenceType && Array.isArray(tf.Exclude.DefenceType)) {
                if (tf.Exclude.DefenceType.includes(candidate.typeName)) return false;
            }
        }

        // Check Include filters
        if (tf.Include && typeof tf.Include === 'object') {
            let included = false;
            if (tf.Include.MonsterType && Array.isArray(tf.Include.MonsterType) && tf.Include.MonsterType.includes(candidate.typeName)) included = true;
            if (tf.Include.DefenceType && Array.isArray(tf.Include.DefenceType) && tf.Include.DefenceType.includes(candidate.typeName)) included = true;
            if (tf.Include.StatusEffect && Array.isArray(tf.Include.StatusEffect)) {
                if (Array.isArray(candidate.status) && candidate.status.some(s => tf.Include.StatusEffect.includes(s.Type))) included = true;
            }
            return included;
        }

        return true;
    }

    /**
     * Helper function to check if a candidate is an ally of the source unit
     * @param {Object} sourceUnit - The unit to check allegiance from
     * @param {Object} candidate - The unit to check
     * @returns {boolean} - Whether the candidate is an ally
     */
    static _isAlly(sourceUnit, candidate) {
        if (!sourceUnit || !candidate) return false;
        const sourceIsMonster = (sourceUnit.typeName in MonsterFactory.monsterData);
        const sourceIsDefence = (sourceUnit.typeName in DefenceFactory.defenceData);
        const candidateIsMonster = (candidate.typeName in MonsterFactory.monsterData);
        const candidateIsDefence = (candidate.typeName in DefenceFactory.defenceData);

        if (sourceIsMonster && candidateIsMonster) return true;
        if (sourceIsDefence && candidateIsDefence) return true;
        return false;
    }

    /**
     * HealAllies effect: When an ally is within attack range, consume attack to heal the closest ally
     * @param {Object} healer - The unit with HealAllies effect
     * @param {Object} effect - The HealAllies effect configuration
     * @param {Object} scene - The game scene
     * @returns {Object|null} - The ally that was healed, or null if no healing occurred
     */
    static _performHealAllies(healer, effect, scene) {
        if (!healer || !effect || !scene || !healer.position) return null;

        // Check if healer is stunned
        if (StatusEffectFactory.isUnitStunned(healer)) {
            if (DEBUG_MODE) console.log('[HealAllies] BLOCKED - healer is stunned', healer.typeName);
            return null;
        }

        // Check if healer has ammo to consume
        const healConsumesAttack = effect.ConsumesAttack !== false;
        if (healConsumesAttack) {
            if (healer.currentAmmo <= 0 || healer.reloadTimer > 0) {
                if (DEBUG_MODE) console.log('[HealAllies] BLOCKED - no ammo or reloading', healer.typeName);
                return null;
            }
        }

        const range = effect.Range || healer.range || 3;
        const healMult = Number(effect.HealMult || 1.0);
        const baseHeal = effect.HealAmount || healer.damage || 6;
        const finalHeal = Math.round(baseHeal * healMult);

        // Determine facing direction: monsters face left (-1), defences face right (+1)
        const healerIsMonster = (healer.typeName in MonsterFactory.monsterData);
        const facingDir = healerIsMonster ? -1 : 1;

        // Check if targeting direction is specified (default to Forward)
        const targetingDirection = effect.TargetingDirection || 'Forward';

        // Determine which rows to check (same row only, unless CanTargetAdjacentLanes is set)
        let rowsToCheck = [healer.position.row];
        if (healer.canTargetAdjacentLanes || healer.CanTargetAdjacentLanes) {
            rowsToCheck = [healer.position.row - 1, healer.position.row, healer.position.row + 1]
                .filter(r => r >= 0 && r < (scene.GRID_ROWS ?? 5));
        }

        // Find allies within range and in the correct direction
        const alliesInRange = (scene.units || []).filter(u => {
            if (!u || u === healer || u.currentHealth <= 0 || !u.position) return false;

            // Must be on the same row (or adjacent if CanTargetAdjacentLanes is set)
            if (!rowsToCheck.includes(u.position.row)) return false;

            // Must be an ally (same faction)
            if (!SpecialEffectFactory._isAlly(healer, u)) return false;

            // Check direction - allies must be in the direction the healer is facing
            const colDiff = u.position.col - healer.position.col;
            
            if (targetingDirection === 'Forward') {
                if (colDiff * facingDir <= 0) return false;
            } else if (targetingDirection === 'Backward') {
                if (colDiff * facingDir >= 0) return false;
            }
            // 'Both' or any other value allows any direction

            // Check range
            const dist = Math.abs(colDiff);
            if (dist > range) return false;

            // Check targeting filter if present
            if (!SpecialEffectFactory._passesTargetingFilter(u, effect.TargetingFilter, healer)) return false;

            // Only heal units that need healing
            if (u.currentHealth >= u.health) return false;

            return true;
        });

        if (alliesInRange.length === 0) {
            if (DEBUG_MODE) console.log('[HealAllies] No valid allies in range', healer.typeName);
            return null;
        }

        // Sort by targeting mode (default to 'First' - closest)
        const targetingMode = effect.TargetingMode || 'First';
        let target;
        switch (targetingMode) {
            case 'First':
                target = alliesInRange.sort((a, b) => {
                    const distA = Math.abs(a.position.col - healer.position.col);
                    const distB = Math.abs(b.position.col - healer.position.col);
                    return distA - distB;
                })[0];
                break;
            case 'Last':
                target = alliesInRange.sort((a, b) => {
                    const distA = Math.abs(a.position.col - healer.position.col);
                    const distB = Math.abs(b.position.col - healer.position.col);
                    return distB - distA;
                })[0];
                break;
            case 'Weak':
                target = alliesInRange.sort((a, b) => (a.currentHealth / a.health) - (b.currentHealth / b.health))[0];
                break;
            case 'Strong':
                target = alliesInRange.sort((a, b) => (b.currentHealth / b.health) - (a.currentHealth / a.health))[0];
                break;
            default:
                target = alliesInRange[0];
        }

        if (!target) return null;

        // Apply healing
        const oldHealth = target.currentHealth;
        target.currentHealth = Math.min(target.health, target.currentHealth + finalHeal);
        const actualHeal = target.currentHealth - oldHealth;

        // Consume ammo if required
        if (healConsumesAttack) {
            healer.currentAmmo = Math.max(0, healer.currentAmmo - 1);
            if (healer.currentAmmo === 0 && healer.reloadDelay > 0) {
                healer.reloadTimer = healer.reloadDelay;
            }
        }

        // Show heal visual
        try {
            if (scene && typeof scene.getTileXY === 'function') {
                const t = scene.getTileXY(target.position.row, target.position.col);
                const healText = scene.add.text(t.x, t.y - 20, `+${actualHeal}`, {
                    fontSize: '18px',
                    color: '#66ff66',
                    stroke: '#000000',
                    strokeThickness: 3
                }).setOrigin(0.5);

                scene.tweens.add({
                    targets: healText,
                    y: healText.y - 30,
                    alpha: 0,
                    duration: 900,
                    ease: 'Cubic.easeOut',
                    onComplete: () => healText.destroy()
                });
            }
        } catch (e) {}

        if (DEBUG_MODE) {
            console.log('[HealAllies] Heal applied', {
                healer: healer.typeName,
                target: target.typeName,
                healAmount: actualHeal,
                oldHealth,
                newHealth: target.currentHealth,
                ammoConsumed: healConsumesAttack,
                direction: targetingDirection,
                facingDir: facingDir
            });
        }

        return target;
    }

    /**
     * Handle on-place special effects for a newly placed unit.
     * @param {Object} unit - Unit being placed
     * @param {Object|null} scene - Active scene
     */
    static handleOnPlace(unit, scene = null) {
        if (!unit || !unit.specialEffects) return;
        unit.specialEffects.forEach(effect => {
            switch (effect.Type) {
                case 'AreaOfEffect':
                    break;
                case 'Accuracy':
                    effect.MinValue = effect.MinValue || 0.0;
                    effect.MaxValue = effect.MaxValue || 1.0;
                    break;
                case 'SpreadTargeting':
                    break;
                case 'SummonUnit':
                    unit._summonCooldown = unit._summonCooldown || 0;
                    if (scene) {
                        try {
                            SpecialEffectFactory._performSummon(unit, effect, scene);
                            unit._summonCooldown = Math.max(0, Number(effect.Cooldown || 0));
                            if (DEBUG_MODE) console.log('[SummonUnit][onPlace] performed immediate summon', {
                                unit: unit.typeName,
                                effect
                            });
                        } catch (e) {
                            if (DEBUG_MODE) console.warn('[SummonUnit][onPlace] failed', e);
                        }
                    }
                    break;
                case 'HealAllies':
                    break;
                case 'BlockAllLanes':
                    unit._blockShield = Number(effect.ShieldValue || 0);
                    unit._blockDissipates = !!effect.DissipatesWhenDestroyed;
                    if (scene && unit.position) {
                        scene.forceFields = scene.forceFields || {};
                        const col = unit.position.col;
                        if (!Array.isArray(scene.forceFields[col])) scene.forceFields[col] = [];
                        scene.forceFields[col].push(unit);

                        // Show shield VFX for all lanes when BlockAllLanes is placed
                        try {
                            // Show shield sprite on each row in this column
                            const gridRows = scene.GRID_ROWS || (scene.grid ? scene.grid.length : 5);
                            for (let r = 0; r < gridRows; r++) {
                                if (typeof scene.getTileXY === 'function') {
                                    const t = scene.getTileXY(r, col);
                                    const shieldSpr = scene.add.sprite(t.x, t.y, 'shield');
                                    shieldSpr.setOrigin(0.5, 0.5);
                                    shieldSpr.setScale(0.9);
                                    shieldSpr.setAlpha(0.7);
                                    if (!unit._shieldVFX) unit._shieldVFX = [];
                                    unit._shieldVFX.push(shieldSpr);
                                }
                            }
                        } catch (e) {
                            if (DEBUG_MODE) console.warn('[BlockAllLanes] shield VFX creation failed', e);
                        }
                    }
                    break;
                case 'DamageBooster':
                    const radius = effect.Radius || effect.Value || '3x3';
                    const mult = Number(effect.Value || 1.0) || 1.0;
                    let r = 1,
                        c = 1;
                    if (typeof radius === 'string' && radius.includes('x')) {
                        const parts = radius.split('x').map(p => parseInt(p, 10) || 1);
                        r = parts[0];
                        c = parts[1];
                    } else if (typeof radius === 'number') {
                        r = c = radius;
                    }
                    SpecialEffectFactory._applyDamageBoosterArea(scene, unit.position.row, unit.position.col, r, c, mult, unit, true);
                    break;
                case 'DeathEffect':
                    break;
                default:
                    break;
            }
        });
    }
}
