import { DEBUG_MODE } from '../DebugManager.js';
import CombatFactory from './CombatFactory.js';
import SpecialEffectFactory from './SpecialEffectFactory.js';
import StatusEffectFactory from './StatusEffectFactory.js';

/**
 * Manages puddle definitions and runtime puddle objects.
 * Puddles are grid-tile hazards that apply damage/statuses over time.
 */
export default class PuddleFactory {
    static puddleData = {};

    /**
     * Load puddle definitions from a manifest (assets/gamedata/PuddleDefinitions/manifest.json).
     * This is optional; CreatePuddle can also be configured directly in unit data.
     */
    static async loadData() {
        try {
            const response = await fetch('assets/gamedata/PuddleDefinitions/manifest.json');
            if (!response.ok) return;
            const manifest = await response.json();
            if (!manifest || !Array.isArray(manifest.files)) return;

            for (const file of manifest.files) {
                try {
                    const res = await fetch(`assets/gamedata/PuddleDefinitions/${file}`);
                    if (!res.ok) continue;
                    const raw = await res.text();
                    if (!raw || !raw.trim()) continue;
                    const data = JSON.parse(raw);
                    if (!data || !data.TypeName) continue;
                    this.puddleData[data.TypeName] = data;
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[PuddleFactory] failed to load', file, e);
                }
            }
        } catch (e) {
            if (DEBUG_MODE) console.warn('[PuddleFactory] loadData failed', e);
        }
    }

    /**
     * Ensure the scene has a puddle grid matching the board size.
     */
    static _ensureGrid(scene) {
        if (!scene) return;
        const rows = scene.GRID_ROWS || (scene.grid ? scene.grid.length : 5);
        const cols = scene.GRID_COLS || (scene.grid && scene.grid[0] ? scene.grid[0].length : 9);
        if (!Array.isArray(scene.puddles)) scene.puddles = [];
        for (let r = 0; r < rows; r++) {
            if (!Array.isArray(scene.puddles[r])) scene.puddles[r] = [];
            for (let c = 0; c < cols; c++) {
                if (!Array.isArray(scene.puddles[r][c])) scene.puddles[r][c] = [];
            }
        }
    }

    /**
     * Resolve a puddle config by merging PuddleType definition with effect overrides.
     * @param {Object} effect - CreatePuddle effect payload
     * @returns {Object} normalized config
     */
    static _resolveConfig(effect = {}) {
        const puddleType = (typeof effect.PuddleType === 'string' && effect.PuddleType) ?
            effect.PuddleType :
            (typeof effect.Puddle === 'string' && effect.Puddle) ? effect.Puddle : null;
        const base = puddleType ? this.puddleData[puddleType] : null;
        const merged = { ...(base || {}), ...(effect || {}) };

        const durationRaw = (merged.Duration !== undefined) ? merged.Duration : (merged.Lifespan !== undefined ? merged.Lifespan : 1);
        const duration = Math.max(0, Number(durationRaw || 0));
        const damage = Number((merged.Damage !== undefined) ? merged.Damage : (merged.Value !== undefined ? merged.Value : 0)) || 0;

        const statusEffects = Array.isArray(merged.StatusEffects) ? merged.StatusEffects : [];
        const specialEffects = Array.isArray(merged.SpecialEffects) ? merged.SpecialEffects : [];

        return {
            typeName: merged.TypeName || puddleType || 'Puddle',
            puddleType: puddleType || merged.TypeName || 'Generic',
            damage,
            duration,
            sprite: merged.Sprite || merged.DisplaySprite || null,
            targetingFilter: merged.TargetingFilter || null,
            statusEffects,
            specialEffects
        };
    }

    /**
     * Place a puddle on a grid cell.
     * @param {Object} scene - Active scene
     * @param {number} row - Grid row
     * @param {number} col - Grid column
     * @param {Object} effect - CreatePuddle effect config
     * @param {Object|null} sourceUnit - The unit that created the puddle
     * @returns {Object|null} The created puddle object
     */
    static placePuddle(scene, row, col, effect, sourceUnit = null) {
        if (!scene) return null;
        this._ensureGrid(scene);

        const rows = scene.GRID_ROWS || (scene.grid ? scene.grid.length : 5);
        const cols = scene.GRID_COLS || (scene.grid && scene.grid[0] ? scene.grid[0].length : 9);
        if (row < 0 || row >= rows || col < 0 || col >= cols) return null;

        const cfg = this._resolveConfig(effect);
        const puddle = {
            typeName: cfg.typeName,
            puddleType: cfg.puddleType,
            damage: cfg.damage,
            duration: cfg.duration,
            targetingFilter: cfg.targetingFilter,
            statusEffects: cfg.statusEffects,
            specialEffects: cfg.specialEffects,
            row,
            col,
            source: sourceUnit || null,
            sprite: null
        };

        // spawn sprite if available
        if (cfg.sprite && scene.add && scene.textures && scene.textures.exists(cfg.sprite)) {
            try {
                const t = (typeof scene.getTileXY === 'function') ? scene.getTileXY(row, col) : { x: 300 + col * 60, y: 150 + row * 60 };
                const spr = scene.add.sprite(t.x, t.y, cfg.sprite);
                spr.setOrigin(0.5, 0.5);
                spr.setAlpha(0.85);
                spr.setDepth(6);
                if (scene.TILE_SIZE && spr.setDisplaySize) {
                    const size = Math.max(8, Math.floor(scene.TILE_SIZE * 0.7));
                    spr.setDisplaySize(size, size);
                }
                puddle.sprite = spr;
            } catch (e) {
                if (DEBUG_MODE) console.warn('[PuddleFactory] sprite create failed', e);
            }
        }

        scene.puddles[row][col].push(puddle);
        return puddle;
    }

    /**
     * Apply puddle effects and decrement durations at wave start.
     * @param {Object} scene - Active scene
     */
    static tickPuddles(scene) {
        if (!scene || !Array.isArray(scene.puddles)) return;

        const rows = scene.GRID_ROWS || scene.puddles.length;
        const cols = scene.GRID_COLS || (scene.puddles[0] ? scene.puddles[0].length : 9);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const list = Array.isArray(scene.puddles[r]?.[c]) ? scene.puddles[r][c] : [];
                if (!list.length) continue;

                const unit = scene.grid?.[r]?.[c]?.unit || null;
                const next = [];

                for (const puddle of list) {
                    if (!puddle) continue;

                    // apply to unit on tile
                    if (unit && unit.currentHealth > 0) {
                        try {
                            this._applyPuddleToUnit(puddle, unit, scene);
                        } catch (e) {
                            if (DEBUG_MODE) console.warn('[PuddleFactory] apply failed', e);
                        }
                    }

                    // decrement duration
                    puddle.duration = Math.max(0, Number(puddle.duration || 0) - 1);
                    if (puddle.duration > 0) {
                        next.push(puddle);
                    } else {
                        if (puddle.sprite) {
                            try { puddle.sprite.destroy(); } catch (e) {}
                        }
                    }
                }

                scene.puddles[r][c] = next;
            }
        }
    }

    /**
     * Destroy all puddle sprites and clear puddle grid.
     * @param {Object} scene - Active scene
     */
    static cleanupPuddles(scene) {
        if (!scene || !Array.isArray(scene.puddles)) return;
        for (const row of scene.puddles) {
            if (!Array.isArray(row)) continue;
            for (const cell of row) {
                if (!Array.isArray(cell)) continue;
                for (const puddle of cell) {
                    try {
                        if (puddle && puddle.sprite) puddle.sprite.destroy();
                    } catch (e) {}
                }
            }
        }
        scene.puddles = [];
    }

    /**
     * Apply puddle damage/statuses to a unit if it passes filters.
     * @param {Object} puddle - Puddle object
     * @param {Object} unit - Target unit
     * @param {Object} scene - Active scene
     */
    static _applyPuddleToUnit(puddle, unit, scene) {
        if (!puddle || !unit) return;
        const source = puddle.source || null;

        // Puddles only affect enemies of the source (if source exists)
        if (source && !SpecialEffectFactory._isEnemyUnit(source, unit)) return;

        // Targeting filter
        if (puddle.targetingFilter && !SpecialEffectFactory._passesTargetingFilter(unit, puddle.targetingFilter, source)) return;

        // Damage
        const baseDmg = Number(puddle.damage || 0);
        if (baseDmg > 0) {
            const final = SpecialEffectFactory.applyDamageModifiers(source || {}, unit, baseDmg, scene);
            if (final > 0) {
                const preHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                unit.takeDamage(final, source);
                const postHp = (typeof unit.currentHealth === 'number') ? unit.currentHealth : null;
                const dealt = (preHp !== null && postHp !== null) ? Math.max(0, preHp - postHp) : Math.max(0, final);
                if (scene && typeof scene._trackDamage === 'function') {
                    scene._trackDamage(source, dealt);
                }
                CombatFactory._showDamage(scene, unit, final);
            }
        }

        // Status effects
        if (Array.isArray(puddle.statusEffects) && puddle.statusEffects.length) {
            for (const s of puddle.statusEffects) {
                if (!s) continue;
                const copy = { ...s, _source: source };
                StatusEffectFactory.applyStatusToTarget(copy, unit);
            }
        }

        // Cleanup if the unit died from puddle damage/statuses
        if (unit.currentHealth !== undefined && unit.currentHealth <= 0 && !unit._beingRemoved) {
            try {
                if (typeof scene._removeUnitCompletely === 'function') {
                    scene._removeUnitCompletely(unit);
                    return;
                }
            } catch (e) {}

            try {
                unit._beingRemoved = true;
                SpecialEffectFactory.handleOnDeath?.(unit, scene);
                SpecialEffectFactory.handleOnRemove?.(unit, scene);
            } catch (e) {}

            try {
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
        }

        // Optional: apply puddle special effects as on-hit effects
        if (Array.isArray(puddle.specialEffects) && puddle.specialEffects.length) {
            const filtered = puddle.specialEffects.filter(e => e && e.Type !== 'CreatePuddle');
            if (filtered.length) {
                const pseudo = {
                    typeName: source?.typeName || puddle.typeName,
                    specialEffects: filtered,
                    statusEffects: [],
                    damage: baseDmg,
                    _lastDamageDealtRaw: baseDmg,
                    _lastDamageDealt: baseDmg,
                    position: { row: puddle.row, col: puddle.col }
                };
                try {
                    SpecialEffectFactory.applyOnHitEffects(pseudo, unit, scene);
                } catch (e) {
                    if (DEBUG_MODE) console.warn('[PuddleFactory] special effects failed', e);
                }
            }
        }
    }
}
