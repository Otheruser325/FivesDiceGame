import { DEBUG_MODE } from './DebugManager.js';

/**
 * StatusEffectVisuals - Handles visual effects for unit status effects
 * Creates and manages particle effects, animations, and overlays for:
 * - Fire: Flame animation with lingering physics
 * - Poison: Green particles with occasional skulls
 * - Slow: Blue chill effect with down arrows
 * - Acid: Yellow splatter coating
 * - Stun: Three spinning stars above unit
 * - Frozen: Ice shards and cold aura
 * - Charm: Floating hearts
 * - Undetectable: Ghost shimmer + lowered alpha
 * - Fire/Frozen cancel: Steam puff burst
 */
export default class StatusEffectVisuals {
    /**
     * Create or update status effect visuals for a unit
     * Call this in the scene's update() loop or when status changes
     */
    static updateUnitVisuals(unit, scene) {
        if (!unit || !scene) return;
        
        // Initialize visual state tracking
        unit._statusVisuals = unit._statusVisuals || {};
        
        // Get current statuses
        const hasFire = unit.status?.some(s => s.Type === 'Fire');
        const hasPoison = unit.status?.some(s => s.Type === 'Poison');
        const hasSlow = unit.status?.some(s => s.Type === 'Slow');
        const hasAcid = unit.status?.some(s => s.Type === 'Acid');
        const hasStun = unit.status?.some(s => s.Type === 'Stun');
        const hasFrozen = unit.status?.some(s => s.Type === 'Frozen');
        const hasCharm = unit.status?.some(s => s.Type === 'Charm');
        const hasUndetectable = unit.status?.some(s => s.Type === 'Undetectable');
        
        // Update each effect type
        if (hasFire) {
            this._ensureFireEffect(unit, scene);
        } else {
            this._removeFireEffect(unit);
        }
        
        if (hasPoison) {
            this._ensurePoisonEffect(unit, scene);
        } else {
            this._removePoisonEffect(unit);
        }
        
        if (hasSlow) {
            this._ensureSlowEffect(unit, scene);
        } else {
            this._removeSlowEffect(unit);
        }
        
        if (hasAcid) {
            this._ensureAcidEffect(unit, scene);
        } else {
            this._removeAcidEffect(unit);
        }
        
        if (hasStun) {
            this._ensureStunEffect(unit, scene);
        } else {
            this._removeStunEffect(unit);
        }

        if (hasFrozen) {
            this._ensureFrozenEffect(unit, scene);
        } else {
            this._removeFrozenEffect(unit);
        }

        if (hasCharm) {
            this._ensureCharmEffect(unit, scene);
        } else {
            this._removeCharmEffect(unit);
        }

        if (hasUndetectable) {
            this._ensureUndetectableEffect(unit, scene);
        } else {
            this._removeUndetectableEffect(unit);
        }
        
        // Update positions of existing effects
        this._updateEffectPositions(unit);
    }
    
    /**
     * Clean up all status visuals for a unit
     */
    static cleanupUnitVisuals(unit) {
        if (!unit || !unit._statusVisuals) return;
        
        this._removeFireEffect(unit);
        this._removePoisonEffect(unit);
        this._removeSlowEffect(unit);
        this._removeAcidEffect(unit);
        this._removeStunEffect(unit);
        this._removeFrozenEffect(unit);
        this._removeCharmEffect(unit);
        this._removeUndetectableEffect(unit);
        
        delete unit._statusVisuals;
    }

    /**
     * Spawn a small steam puff burst when Fire/Frozen cancel each other.
     */
    static spawnSteamPuff(unit, scene) {
        if (!unit || !scene) return;

        let x, y;
        if (unit.sprite && typeof unit.sprite.x === 'number' && typeof unit.sprite.y === 'number') {
            x = unit.sprite.x;
            y = unit.sprite.y;
        } else if (unit.position && scene && typeof scene.getTileXY === 'function') {
            const t = scene.getTileXY(unit.position.row, unit.position.col);
            x = t.x;
            y = t.y + (scene.UNIT_Y_OFFSET || 0);
        } else {
            return;
        }

        const puff = scene.add.container(x, y - 10);
        puff.setDepth(120);

        const circles = [];
        for (let i = 0; i < 4; i++) {
            const c = scene.add.circle(0, 0, 4 + Math.random() * 3, 0xffffff, 0.8);
            c.setAlpha(0.7);
            c.x = (Math.random() - 0.5) * 12;
            c.y = (Math.random() - 0.5) * 6;
            puff.add(c);
            circles.push(c);
        }

        scene.tweens.add({
            targets: circles,
            y: (t, i, target) => target.y - (10 + Math.random() * 6),
            alpha: 0,
            scale: 1.6,
            duration: 450,
            ease: 'Cubic.easeOut',
            onComplete: () => {
                try { puff.destroy(); } catch (e) {}
            }
        });
    }
    
    /**
     * Fire Effect: Raging flame particles emanating from unit
     */
    static _ensureFireEffect(unit, scene) {
        if (unit._statusVisuals.fire) return;
        
        const container = scene.add.container(0, 0);
        container.setDepth(100);
        
        // Create flame particles
        const flames = [];
        for (let i = 0; i < 5; i++) {
            const flame = scene.add.circle(0, 0, 4 + Math.random() * 4, 0xff4400);
            flame.setAlpha(0.7 + Math.random() * 0.3);
            container.add(flame);
            flames.push({
                sprite: flame,
                offsetX: (Math.random() - 0.5) * 20,
                offsetY: (Math.random() - 0.5) * 10,
                speed: 0.5 + Math.random() * 1,
                phase: Math.random() * Math.PI * 2
            });
        }
        
        // Add yellow core
        const core = scene.add.circle(0, 0, 6, 0xffaa00);
        core.setAlpha(0.8);
        container.add(core);
        flames.push({ sprite: core, isCore: true });
        
        unit._statusVisuals.fire = {
            container,
            flames,
            time: 0
        };
        
        // Animation update function
        const updateFire = () => {
            if (!unit._statusVisuals?.fire) return;
            
            const visuals = unit._statusVisuals.fire;
            visuals.time += 0.1;
            
            visuals.flames.forEach(flame => {
                if (flame.isCore) return;
                
                const flicker = Math.sin(visuals.time * flame.speed + flame.phase);
                const yOffset = -10 - Math.abs(flicker) * 8;
                const xOffset = flame.offsetX + Math.sin(visuals.time * 2 + flame.phase) * 3;
                const scale = 0.8 + Math.abs(flicker) * 0.4;
                
                flame.sprite.y = yOffset;
                flame.sprite.x = xOffset;
                flame.sprite.setScale(scale);
                flame.sprite.setAlpha(0.6 + Math.abs(flicker) * 0.4);
            });
            
            // Flicker core
            const coreScale = 0.9 + Math.sin(visuals.time * 3) * 0.2;
            const coreAlpha = 0.7 + Math.sin(visuals.time * 5) * 0.2;
            core.setScale(coreScale);
            core.setAlpha(coreAlpha);
        };
        
        scene.events.on('update', updateFire);
        unit._statusVisuals.fire.updateFn = updateFire;
    }
    
    static _removeFireEffect(unit) {
        if (!unit._statusVisuals?.fire) return;
        
        const visuals = unit._statusVisuals.fire;
        if (visuals.updateFn) {
            // Remove update listener
            const scene = visuals.container.scene;
            if (scene) scene.events.off('update', visuals.updateFn);
        }
        visuals.container.destroy();
        delete unit._statusVisuals.fire;
    }
    
    /**
     * Poison Effect: Green particles with occasional skulls
     */
    static _ensurePoisonEffect(unit, scene) {
        if (unit._statusVisuals.poison) return;
        
        const container = scene.add.container(0, 0);
        container.setDepth(100);
        
        // Green bubbles
        const bubbles = [];
        for (let i = 0; i < 4; i++) {
            const bubble = scene.add.circle(0, 0, 3 + Math.random() * 3, 0x00ff44);
            bubble.setAlpha(0.5);
            container.add(bubble);
            bubbles.push({
                sprite: bubble,
                offsetX: (Math.random() - 0.5) * 16,
                speed: 0.3 + Math.random() * 0.5,
                phase: Math.random() * Math.PI * 2
            });
        }
        
        // Skull that appears occasionally
        const skull = scene.add.text(0, -25, '☠', {
            fontSize: '16px',
            color: '#00ff44'
        }).setOrigin(0.5);
        skull.setAlpha(0);
        container.add(skull);
        
        unit._statusVisuals.poison = {
            container,
            bubbles,
            skull,
            time: 0,
            lastSkullTime: 0
        };
        
        const updatePoison = () => {
            if (!unit._statusVisuals?.poison) return;
            
            const visuals = unit._statusVisuals.poison;
            visuals.time += 0.05;
            
            // Update bubbles
            visuals.bubbles.forEach(bubble => {
                const float = Math.sin(visuals.time * bubble.speed + bubble.phase);
                bubble.sprite.y = -5 - Math.abs(float) * 10;
                bubble.sprite.x = bubble.offsetX + Math.sin(visuals.time + bubble.phase) * 2;
                bubble.sprite.setAlpha(0.4 + Math.abs(float) * 0.3);
            });
            
            // Occasional skull popup
            const skullInterval = 3000; // ms
            const now = Date.now();
            if (now - visuals.lastSkullTime > skullInterval) {
                visuals.lastSkullTime = now;
                
                // Show skull animation
                scene.tweens.add({
                    targets: visuals.skull,
                    alpha: 1,
                    y: -35,
                    duration: 400,
                    ease: 'Power2',
                    onComplete: () => {
                        scene.tweens.add({
                            targets: visuals.skull,
                            alpha: 0,
                            y: -45,
                            duration: 600,
                            ease: 'Power2'
                        });
                    }
                });
            }
        };
        
        scene.events.on('update', updatePoison);
        unit._statusVisuals.poison.updateFn = updatePoison;
    }
    
    static _removePoisonEffect(unit) {
        if (!unit._statusVisuals?.poison) return;
        
        const visuals = unit._statusVisuals.poison;
        if (visuals.updateFn) {
            const scene = visuals.container.scene;
            if (scene) scene.events.off('update', visuals.updateFn);
        }
        visuals.container.destroy();
        delete unit._statusVisuals.poison;
    }
    
    /**
     * Slow Effect: Blue chill with down arrows
     */
    static _ensureSlowEffect(unit, scene) {
        if (unit._statusVisuals.slow) return;
        
        const container = scene.add.container(0, 0);
        container.setDepth(100);
        
        // Blue overlay tint on unit
        if (unit.sprite) {
            unit.sprite.setTint(0xaaddff);
        }
        
        // Down arrows
        const arrows = [];
        for (let i = 0; i < 3; i++) {
            const arrow = scene.add.text(0, 0, '▼', {
                fontSize: '12px',
                color: '#88ccff'
            }).setOrigin(0.5);
            arrow.setAlpha(0.6);
            container.add(arrow);
            arrows.push({
                sprite: arrow,
                offsetX: (i - 1) * 10,
                phase: i * Math.PI * 0.6
            });
        }
        
        unit._statusVisuals.slow = {
            container,
            arrows,
            time: 0
        };
        
        const updateSlow = () => {
            if (!unit._statusVisuals?.slow) return;
            
            const visuals = unit._statusVisuals.slow;
            visuals.time += 0.08;
            
            visuals.arrows.forEach(arrow => {
                const yOffset = Math.sin(visuals.time + arrow.phase) * 3;
                const alpha = 0.3 + Math.sin(visuals.time + arrow.phase) * 0.3;
                arrow.sprite.y = -20 + yOffset;
                arrow.sprite.x = arrow.offsetX;
                arrow.sprite.setAlpha(Math.max(0, alpha));
            });
        };
        
        scene.events.on('update', updateSlow);
        unit._statusVisuals.slow.updateFn = updateSlow;
    }
    
    static _removeSlowEffect(unit) {
        if (!unit._statusVisuals?.slow) return;
        
        const visuals = unit._statusVisuals.slow;
        if (visuals.updateFn) {
            const scene = visuals.container.scene;
            if (scene) scene.events.off('update', visuals.updateFn);
        }
        
        // Remove blue tint
        if (unit.sprite && unit.sprite.clearTint) {
            const stillFrozen = unit.status?.some(s => s.Type === 'Frozen');
            if (!stillFrozen) {
                unit.sprite.clearTint();
            }
        }
        
        visuals.container.destroy();
        delete unit._statusVisuals.slow;
    }
    
    /**
     * Acid Effect: Yellow splatter coating on unit
     */
    static _ensureAcidEffect(unit, scene) {
        if (unit._statusVisuals.acid) return;
        
        const container = scene.add.container(0, 0);
        container.setDepth(100);
        
        // Yellow splatter spots
        const splatters = [];
        for (let i = 0; i < 6; i++) {
            const splat = scene.add.circle(0, 0, 4 + Math.random() * 6, 0xffe600);
            splat.setAlpha(0.5 + Math.random() * 0.3);
            container.add(splat);
            splatters.push({
                sprite: splat,
                offsetX: (Math.random() - 0.5) * 30,
                offsetY: (Math.random() - 0.5) * 30,
                pulseSpeed: 0.5 + Math.random() * 0.5
            });
        }
        
        // Occasional drip
        const drip = scene.add.circle(0, 15, 3, 0xffe600);
        drip.setAlpha(0);
        container.add(drip);
        
        unit._statusVisuals.acid = {
            container,
            splatters,
            drip,
            time: 0,
            lastDripTime: 0
        };
        
        const updateAcid = () => {
            if (!unit._statusVisuals?.acid) return;
            
            const visuals = unit._statusVisuals.acid;
            visuals.time += 0.05;
            
            // Pulse splatters
            visuals.splatters.forEach(splat => {
                const pulse = Math.sin(visuals.time * splat.pulseSpeed);
                const scale = 0.8 + pulse * 0.2;
                splat.sprite.setScale(scale);
                splat.sprite.x = splat.offsetX;
                splat.sprite.y = splat.offsetY;
            });
            
            // Occasional drip
            const now = Date.now();
            if (now - visuals.lastDripTime > 2000 && Math.random() < 0.02) {
                visuals.lastDripTime = now;
                
                scene.tweens.add({
                    targets: visuals.drip,
                    alpha: 0.8,
                    y: 30,
                    duration: 500,
                    ease: 'Linear',
                    onComplete: () => {
                        visuals.drip.setAlpha(0);
                        visuals.drip.y = 15;
                    }
                });
            }
        };
        
        scene.events.on('update', updateAcid);
        unit._statusVisuals.acid.updateFn = updateAcid;
    }
    
    static _removeAcidEffect(unit) {
        if (!unit._statusVisuals?.acid) return;
        
        const visuals = unit._statusVisuals.acid;
        if (visuals.updateFn) {
            const scene = visuals.container.scene;
            if (scene) scene.events.off('update', visuals.updateFn);
        }
        visuals.container.destroy();
        delete unit._statusVisuals.acid;
    }
    
    /**
     * Stun Effect: Three spinning stars above unit
     */
    static _ensureStunEffect(unit, scene) {
        if (unit._statusVisuals.stun) return;
        
        const container = scene.add.container(0, 0);
        container.setDepth(100);
        
        // Three stars in a circle
        const stars = [];
        const starColors = [0xffff00, 0xffaa00, 0xffdd00];
        
        for (let i = 0; i < 3; i++) {
            const star = scene.add.text(0, 0, '★', {
                fontSize: '14px',
                color: '#ffff00'
            }).setOrigin(0.5);
            star.setTint(starColors[i]);
            container.add(star);
            stars.push({
                sprite: star,
                angle: (i * 120) * (Math.PI / 180)
            });
        }
        
        unit._statusVisuals.stun = {
            container,
            stars,
            time: 0
        };
        
        const updateStun = () => {
            if (!unit._statusVisuals?.stun) return;
            
            const visuals = unit._statusVisuals.stun;
            visuals.time += 0.1;
            
            const radius = 15;
            const height = -30;
            
            visuals.stars.forEach((star, i) => {
                const rotationSpeed = 2; // radians per second
                const currentAngle = star.angle + visuals.time * rotationSpeed;
                
                star.sprite.x = Math.cos(currentAngle) * radius;
                star.sprite.y = height + Math.sin(visuals.time * 3 + i) * 3;
                
                // Scale stars based on their "depth" in the rotation
                const scale = 0.8 + Math.sin(currentAngle) * 0.3;
                star.sprite.setScale(Math.max(0.5, scale));
                star.sprite.setAlpha(0.7 + Math.sin(visuals.time * 4 + i) * 0.3);
            });
        };
        
        scene.events.on('update', updateStun);
        unit._statusVisuals.stun.updateFn = updateStun;
    }
    
    static _removeStunEffect(unit) {
        if (!unit._statusVisuals?.stun) return;
        
        const visuals = unit._statusVisuals.stun;
        if (visuals.updateFn) {
            const scene = visuals.container.scene;
            if (scene) scene.events.off('update', visuals.updateFn);
        }
        visuals.container.destroy();
        delete unit._statusVisuals.stun;
    }

    /**
     * Frozen Effect: Ice shards and cold aura
     */
    static _ensureFrozenEffect(unit, scene) {
        if (unit._statusVisuals.frozen) return;

        const container = scene.add.container(0, 0);
        container.setDepth(100);

        // Light blue tint on unit
        if (unit.sprite) {
            unit.sprite.setTint(0x99ddff);
        }

        const shards = [];
        for (let i = 0; i < 5; i++) {
            const tri = scene.add.triangle(0, 0, 0, 6, 3, -6, -3, -6, 0x66ccff, 0.8);
            container.add(tri);
            shards.push({
                sprite: tri,
                offsetX: (Math.random() - 0.5) * 24,
                offsetY: -12 + (Math.random() - 0.5) * 8,
                phase: Math.random() * Math.PI * 2
            });
        }

        unit._statusVisuals.frozen = {
            container,
            shards,
            time: 0
        };

        const updateFrozen = () => {
            if (!unit._statusVisuals?.frozen) return;
            const visuals = unit._statusVisuals.frozen;
            visuals.time += 0.07;

            visuals.shards.forEach((shard, i) => {
                const bob = Math.sin(visuals.time + shard.phase) * 2;
                shard.sprite.x = shard.offsetX + Math.cos(visuals.time + i) * 2;
                shard.sprite.y = shard.offsetY + bob;
                shard.sprite.setAlpha(0.6 + Math.abs(bob) * 0.1);
            });
        };

        scene.events.on('update', updateFrozen);
        unit._statusVisuals.frozen.updateFn = updateFrozen;
    }

    static _removeFrozenEffect(unit) {
        if (!unit._statusVisuals?.frozen) return;

        const visuals = unit._statusVisuals.frozen;
        if (visuals.updateFn) {
            const scene = visuals.container.scene;
            if (scene) scene.events.off('update', visuals.updateFn);
        }

        if (unit.sprite && unit.sprite.clearTint) {
            const stillSlowed = unit.status?.some(s => s.Type === 'Slow');
            if (!stillSlowed) {
                unit.sprite.clearTint();
            }
        }

        visuals.container.destroy();
        delete unit._statusVisuals.frozen;
    }

    /**
     * Charm Effect: Floating hearts
     */
    static _ensureCharmEffect(unit, scene) {
        if (unit._statusVisuals.charm) return;

        const container = scene.add.container(0, 0);
        container.setDepth(100);

        const hearts = [];
        for (let i = 0; i < 3; i++) {
            const heart = scene.add.text(0, 0, '♥', {
                fontSize: '12px',
                color: '#ff77cc'
            }).setOrigin(0.5);
            container.add(heart);
            hearts.push({
                sprite: heart,
                offsetX: (i - 1) * 10,
                phase: i * Math.PI * 0.7
            });
        }

        unit._statusVisuals.charm = {
            container,
            hearts,
            time: 0
        };

        const updateCharm = () => {
            if (!unit._statusVisuals?.charm) return;
            const visuals = unit._statusVisuals.charm;
            visuals.time += 0.08;

            visuals.hearts.forEach(heart => {
                const yOffset = -25 + Math.sin(visuals.time + heart.phase) * 4;
                const alpha = 0.5 + Math.sin(visuals.time + heart.phase) * 0.3;
                heart.sprite.x = heart.offsetX;
                heart.sprite.y = yOffset;
                heart.sprite.setAlpha(Math.max(0.2, alpha));
            });
        };

        scene.events.on('update', updateCharm);
        unit._statusVisuals.charm.updateFn = updateCharm;
    }

    static _removeCharmEffect(unit) {
        if (!unit._statusVisuals?.charm) return;

        const visuals = unit._statusVisuals.charm;
        if (visuals.updateFn) {
            const scene = visuals.container.scene;
            if (scene) scene.events.off('update', visuals.updateFn);
        }
        visuals.container.destroy();
        delete unit._statusVisuals.charm;
    }

    /**
     * Undetectable Effect: Ghost shimmer and reduced alpha
     */
    static _ensureUndetectableEffect(unit, scene) {
        if (unit._statusVisuals.undetectable) return;

        const container = scene.add.container(0, 0);
        container.setDepth(100);

        const ring = scene.add.circle(0, 0, 18, 0x66ccff, 0.15);
        ring.setStrokeStyle(2, 0x99ddff, 0.6);
        container.add(ring);

        const dots = [];
        for (let i = 0; i < 4; i++) {
            const dot = scene.add.circle(0, 0, 2, 0xbbeeff, 0.7);
            container.add(dot);
            dots.push({
                sprite: dot,
                angle: i * (Math.PI / 2)
            });
        }

        let prevAlpha = null;
        if (unit.sprite && typeof unit.sprite.alpha === 'number') {
            prevAlpha = unit.sprite.alpha;
            unit.sprite.setAlpha(0.45);
        }

        unit._statusVisuals.undetectable = {
            container,
            ring,
            dots,
            prevAlpha,
            time: 0
        };

        const updateUndetectable = () => {
            if (!unit._statusVisuals?.undetectable) return;
            const visuals = unit._statusVisuals.undetectable;
            visuals.time += 0.06;

            const radius = 18;
            visuals.dots.forEach(dot => {
                const ang = dot.angle + visuals.time * 1.5;
                dot.sprite.x = Math.cos(ang) * radius;
                dot.sprite.y = Math.sin(ang) * radius - 10;
            });

            const alphaPulse = 0.3 + Math.sin(visuals.time * 3) * 0.1;
            visuals.ring.setAlpha(alphaPulse);
        };

        scene.events.on('update', updateUndetectable);
        unit._statusVisuals.undetectable.updateFn = updateUndetectable;
    }

    static _removeUndetectableEffect(unit) {
        if (!unit._statusVisuals?.undetectable) return;

        const visuals = unit._statusVisuals.undetectable;
        if (visuals.updateFn) {
            const scene = visuals.container.scene;
            if (scene) scene.events.off('update', visuals.updateFn);
        }

        if (unit.sprite && visuals.prevAlpha !== null && visuals.prevAlpha !== undefined) {
            unit.sprite.setAlpha(visuals.prevAlpha);
        } else if (unit.sprite) {
            unit.sprite.setAlpha(1);
        }

        visuals.container.destroy();
        delete unit._statusVisuals.undetectable;
    }
    
    /**
     * Update positions of all effect containers to follow the unit
     */
    static _updateEffectPositions(unit) {
        if (!unit._statusVisuals) return;
        
        // Get sprite position - handle both direct sprite and unit.position cases
        let x, y;
        if (unit.sprite && typeof unit.sprite.x === 'number' && typeof unit.sprite.y === 'number') {
            x = unit.sprite.x;
            y = unit.sprite.y;
        } else if (unit.position && unit.scene && typeof unit.scene.getTileXY === 'function') {
            const tilePos = unit.scene.getTileXY(unit.position.row, unit.position.col);
            x = tilePos.x;
            y = tilePos.y + (unit.scene.UNIT_Y_OFFSET || 0);
        } else {
            return;
        }
        
        // Validate position is within reasonable bounds (not 0,0 default)
        if (x === 0 && y === 0) {
            if (unit.position && unit.scene && typeof unit.scene.getTileXY === 'function') {
                const tilePos = unit.scene.getTileXY(unit.position.row, unit.position.col);
                x = tilePos.x;
                y = tilePos.y + (unit.scene.UNIT_Y_OFFSET || 0);
            }
        }
        
        Object.values(unit._statusVisuals).forEach(visual => {
            if (visual && visual.container) {
                visual.container.x = x;
                visual.container.y = y;
            }
        });
    }
}
