import AlertManager from '../utils/AlertManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import GlobalAchievements from '../utils/AchievementsManager.js';
import { DEBUG_MODE } from '../utils/DebugManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import { formatCompact } from '../utils/FormatManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DefenceFactory from '../utils/factories/DefenceFactory.js';
import MonsterFactory from '../utils/factories/MonsterFactory.js';
import PuddleFactory from '../utils/factories/PuddleFactory.js';

export default class OnlineLoadoutScene extends Phaser.Scene {
    constructor() {
        super('OnlineLoadoutScene');

        this.currentTab = 'defence';
        this.currentSubTab = 'normal';
        this.defenceNormalLoadout = JSON.parse(localStorage.getItem('online_defenceNormalLoadout')) || [
            'SniperTower', 'Cannon', 'Mortar', 'MachineGun', 'Flamethrower'
        ];
        this.defenceProtoLoadout = JSON.parse(localStorage.getItem('online_defenceProtoLoadout')) || [
            'BoomCannon', 'LazorBeam', 'ShockBlaster', 'AcidShooter', 'Microwavr'
        ];
        this.monsterNormalLoadout = JSON.parse(localStorage.getItem('online_monsterNormalLoadout')) || [
            'Goblin', 'Orc', 'Troll', 'Bat', 'FireImp'
        ];
        this.monsterProtoLoadout = JSON.parse(localStorage.getItem('online_monsterProtoLoadout')) || [
            'Golem', 'Harpy', 'IceLizard', 'Demon', 'ElectroMage'
        ];
        this.ownedDefences = JSON.parse(localStorage.getItem('online_ownedDefences')) || [
            'SniperTower', 'Cannon', 'Mortar', 'MachineGun', 'Flamethrower', 'BoomCannon', 'LazorBeam', 'ShockBlaster', 'AcidShooter', 'Microwavr'
        ];
        this.ownedMonsters = JSON.parse(localStorage.getItem('online_ownedMonsters')) || [
            'Goblin', 'Orc', 'Troll', 'Bat', 'FireImp', 'Golem', 'Harpy', 'IceLizard', 'Demon', 'ElectroMage'
        ];

        // UI Groups
        this.unitIcons = [];
        this.statModal = null;
        this.selectedUnit = null;
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

        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const fmt = (key, ...args) => GlobalLocalization.format(key, ...args);
        const unitName = (unitKey, unitData = null) => {
            const typeName = unitData?.TypeName || unitKey;
            const fallback = unitData?.FullName || unitKey;
            return GlobalLocalization.t(`UNIT_${typeName}`, fallback);
        };
        const unitDesc = (unitKey, unitData = null) => {
            const typeName = unitData?.TypeName || unitKey;
            const fallback = unitData?.Description || unitData?.FullName || unitKey;
            return GlobalLocalization.t(`UNIT_DESC_${typeName}`, fallback);
        };
        this._t = t;
        this._fmt = fmt;
        this._unitName = unitName;
        this._unitDesc = unitDesc;

        // Title with pixel font
        this.add.text(600, 40, t('LOADOUT_TITLE', 'Loadouts'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '32px'
        }).setOrigin(0.5).setDepth(10);

        // read tokens ONCE at scene start
        this.diceTokens = parseInt(localStorage.getItem('online_diceTokens')) || 0;
        this.tokenText = this.add.text(600, 80, fmt('LOADOUT_TOKENS', 'Tokens: {0}', formatCompact(this.diceTokens)), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '16px'
        }).setOrigin(0.5).setDepth(10);

        // Tab buttons with pixel font
        this.defenceTab = this.add.text(350, 120, t('LOADOUT_DEFENCES', 'Defences'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '20px',
            color: this.currentTab === 'defence' ? '#ffff66' : '#ffffff'
        }).setOrigin(0.5).setInteractive().setDepth(10);

        this.monsterTab = this.add.text(850, 120, t('LOADOUT_MONSTERS', 'Monsters'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '20px',
            color: this.currentTab === 'monster' ? '#ffff66' : '#ffffff'
        }).setOrigin(0.5).setInteractive().setDepth(10);

        this.defenceTab.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.currentTab = 'defence';
            this.refresh();
        });

        this.monsterTab.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.currentTab = 'monster';
            this.refresh();
        });

        // Subtab buttons
        this.normalSubTab = this.add.text(500, 160, t('LOADOUT_NORMAL', 'Normal'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '16px',
            color: this.currentSubTab === 'normal' ? '#ffff66' : '#ffffff'
        }).setOrigin(0.5).setInteractive().setDepth(10);

        this.protoSubTab = this.add.text(700, 160, t('LOADOUT_PROTO', 'Proto'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '16px',
            color: this.currentSubTab === 'proto' ? '#ffff66' : '#ffffff'
        }).setOrigin(0.5).setInteractive().setDepth(10);

        this.normalSubTab.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.currentSubTab = 'normal';
            this.refresh();
        });

        this.protoSubTab.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.currentSubTab = 'proto';
            this.refresh();
        });

        // Loadout slots section
        this.add.text(600, 200, t('LOADOUT_YOUR', 'Your Loadout'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '14px',
            color: '#aaaaaa'
        }).setOrigin(0.5).setDepth(10);

        this.slotSprites = [];
        this.slotNumbers = [];
        for (let i = 0; i < 5; i++) {
            const y = 240 + i * 60;
            const x = 600;
            const slotBg = this.add.rectangle(x, y, 280, 50, 0x333333).setStrokeStyle(2, 0x666666).setDepth(5);
            const numText = this.add.text(x - 120, y, fmt('LOADOUT_SLOT', '{0}.', i + 1), {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '14px',
                color: '#ffffff'
            }).setOrigin(0, 0.5).setDepth(10);
            this.slotNumbers.push(numText);
        }

        // Available Units section
        this.add.text(200, 200, t('LOADOUT_AVAILABLE', 'Available Units'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '14px',
            color: '#aaaaaa'
        }).setOrigin(0.5).setDepth(10);

        // Back button
        const backBtn = this.add.text(600, 550, t('UI_BACK', '<- BACK'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '20px',
            color: '#ff6666'
        }).setOrigin(0.5).setInteractive().setDepth(10);

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.saveData();
            this.scene.start('OnlineMenuScene');
        });

        // SHOP button top-right
        const shopBtn = this.add.text(1200, 40, t('LOADOUT_SHOP', 'Shop'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '16px',
            color: '#ffd700',
            backgroundColor: '#222',
            padding: { x: 8, y: 6 }
        }).setOrigin(1, 0).setInteractive().setDepth(10);

        shopBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.openShop();
        });

        if (DEBUG_MODE) {
            const devBtn = this.add.text(20, 40, t('LOADOUT_DEV', 'DEV'), {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '14px',
                color: '#ff6666',
                backgroundColor: '#222',
                padding: { x: 8, y: 6 }
            }).setInteractive().setDepth(10);

            devBtn.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.openDevMenu();
            });
        }

        // Setup ESC key handler for closing popups
        this.input.keyboard.on('keydown-ESC', () => {
             GlobalAudio.playButton(this);
            if (this.statModal) {
                this.closeStatModal();
            } else if (this.shopGroup) {
                this.closeShop();
            } else if (this.devGroup) {
                this.closeDevMenu();
            } else {
                this.scene.start('OnlineMenuScene');
            }
        });

        this.refresh();
    }

    refresh() {
        // Update tab colors
        this.defenceTab.setColor(this.currentTab === 'defence' ? '#ffff66' : '#ffffff');
        this.monsterTab.setColor(this.currentTab === 'monster' ? '#ffff66' : '#ffffff');
        this.normalSubTab.setColor(this.currentSubTab === 'normal' ? '#ffff66' : '#ffffff');
        this.protoSubTab.setColor(this.currentSubTab === 'proto' ? '#ffff66' : '#ffffff');

        // Update token text
        if (this.tokenText) {
            this.tokenText.setText(this._fmt ? this._fmt('LOADOUT_TOKENS', 'Tokens: {0}', formatCompact(this.diceTokens)) : `Tokens: ${formatCompact(this.diceTokens)}`);
        }

        // Refresh all UI elements
        this.refreshSlots();
        this.refreshUnitGrid();
    }

    getRarityColor(rarity) {
        const colors = {
            'Common': 0xffffff,      // White
            'Uncommon': 0x00ff00,    // Green
            'Rare': 0x00aaff,        // Blue
            'Epic': 0xaa00ff,        // Purple
            'Legendary': 0xffd700    // Gold
        };
        return colors[rarity] || 0xffffff;
    }

    refreshUnitGrid() {
        // Clear existing unit icons
        if (this.unitIcons) {
            this.unitIcons.forEach(icon => {
                if (icon.sprite) icon.sprite.destroy();
                if (icon.border) icon.border.destroy();
                if (icon.ownedIndicator) icon.ownedIndicator.destroy();
            });
        }
        this.unitIcons = [];

        const factory = this.currentTab === 'defence' ? DefenceFactory : MonsterFactory;
        const data = factory.defenceData || factory.monsterData;
        const ownedList = this.currentTab === 'defence' ? this.ownedDefences : this.ownedMonsters;

        // Get all units for current tab/subtab
        const allUnits = Object.keys(data).filter(key => {
            return data[key].IsProto === (this.currentSubTab === 'proto');
        });

        // Display units in a grid
        const startX = 80;
        const startY = 240;
        const iconSize = 50;
        const spacing = 60;
        const perRow = 6;

        allUnits.forEach((unitKey, index) => {
            const row = Math.floor(index / perRow);
            const col = index % perRow;
            const x = startX + col * spacing;
            const y = startY + row * spacing;

            const unitData = data[unitKey];
            const isOwned = ownedList.includes(unitKey);
            const rarityColor = this.getRarityColor(unitData.Rarity);

            // Create icon background (rarity colored border)
            const border = this.add.rectangle(x, y, iconSize, iconSize, rarityColor)
                .setStrokeStyle(2, rarityColor)
                .setDepth(5)
                .setInteractive();

            // Create inner background
            const bg = this.add.rectangle(x, y, iconSize - 4, iconSize - 4, 0x222222).setDepth(6);

            // Create unit sprite
            const spriteKey = unitData.DisplaySprite;
            const fallbackKey = 'dice' + ((index % 6) + 1);
            const useKey = (spriteKey && this.textures.exists(spriteKey)) ? spriteKey : fallbackKey;
            const sprite = this.add.sprite(x, y, useKey)
                .setScale(0.4)
                .setDepth(7)
                .setInteractive();

            // Ownership indicator (lock icon for unowned)
            let ownedIndicator = null;
            if (!isOwned) {
                ownedIndicator = this.add.text(x + 12, y + 12, '🔒', {
                    fontSize: '16px'
                }).setOrigin(0.5).setDepth(8);
            }

            // Hover effects
            border.on('pointerover', () => {
                border.setScale(1.1);
                sprite.setScale(0.45);
                this.tweens.add({
                    targets: [border, bg, sprite],
                    alpha: 1,
                    duration: 100
                });
            });

            border.on('pointerout', () => {
                border.setScale(1);
                sprite.setScale(0.4);
            });

            // Click to show stat modal
            border.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.showStatModal(unitKey, unitData, isOwned, x, y);
            });

            sprite.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.showStatModal(unitKey, unitData, isOwned, x, y);
            });

            this.unitIcons.push({
                key: unitKey,
                sprite,
                border,
                bg,
                ownedIndicator,
                data: unitData,
                isOwned
            });
        });
    }

    showStatModal(unitKey, unitData, isOwned, iconX, iconY) {
        // Close existing modal
        this.closeStatModal();

        this.selectedUnit = unitKey;
        const factory = this.currentTab === 'defence' ? DefenceFactory : MonsterFactory;
        const data = factory.defenceData || factory.monsterData;

        // Modal dimensions
        const modalWidth = 400;
        const modalHeight = 520;
        const modalX = 640;
        const modalY = 300;

        this.statModal = this.add.group();

        // Full-screen interactive backdrop that blocks clicks to main UI
        const backdrop = this.add.rectangle(640, 300, 1280, 600, 0x000000, 0.6)
            .setDepth(50)
            .setInteractive();
        this.statModal.add(backdrop);

        // Modal background
        const modalBg = this.add.rectangle(modalX, modalY, modalWidth, modalHeight, 0x1a1a1a)
            .setStrokeStyle(3, this.getRarityColor(unitData.Rarity))
            .setDepth(51);
        this.statModal.add(modalBg);

        // Close button (X)
        const closeBtn = this.add.text(modalX + modalWidth / 2 - 20, modalY - modalHeight / 2 + 20, '✕', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '16px',
            color: '#ff6666'
        }).setOrigin(0.5).setDepth(52).setInteractive();
        closeBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.closeStatModal();
        });
        this.statModal.add(closeBtn);

        let currentY = modalY - modalHeight / 2 + 50;

        // Unit Name
        const nameText = this.add.text(modalX, currentY, this._unitName(unitKey, unitData), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '16px',
            color: '#ffffff'
        }).setOrigin(0.5).setDepth(52);
        this.statModal.add(nameText);
        currentY += 30;

        // Rarity
        const rarityKey = `RARITY_${String(unitData.Rarity || 'Common').toUpperCase()}`;
        const rarityText = this.add.text(modalX, currentY, this._t ? this._t(rarityKey, unitData.Rarity || 'Common') : (unitData.Rarity || 'Common'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '12px',
            color: '#' + this.getRarityColor(unitData.Rarity).toString(16).padStart(6, '0')
        }).setOrigin(0.5).setDepth(52);
        this.statModal.add(rarityText);
        currentY += 35;

        // Class / Placement overview
        const classInfo = this._getUnitClassInfo(unitKey, unitData);
        if (classInfo) {
            const classLabel = this._t ? this._t('LOADOUT_CLASS', 'Class') : 'Class';
            const classText = this.add.text(modalX, currentY, `${classLabel}: ${classInfo.className}`, {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '11px',
                color: '#ffff99'
            }).setOrigin(0.5).setDepth(52);
            this.statModal.add(classText);
            currentY += 18;

            const placementLabel = this._t ? this._t('LOADOUT_PLACEMENT', 'Placement') : 'Placement';
            const placementText = this.add.text(modalX, currentY, `${placementLabel}: ${classInfo.placement}`, {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '10px',
                color: '#cccccc'
            }).setOrigin(0.5).setDepth(52);
            this.statModal.add(placementText);
            currentY += 22;
        }

        // Unit Sprite (larger)
        const spriteKey = unitData.DisplaySprite;
        const fallbackKey = 'dice1';
        const useKey = (spriteKey && this.textures.exists(spriteKey)) ? spriteKey : fallbackKey;
        const largeSprite = this.add.sprite(modalX, currentY, useKey)
            .setScale(0.8)
            .setDepth(52);
        this.statModal.add(largeSprite);
        currentY += 50;

        // Ownership status
        const ownedLabel = this._t ? this._t('LOADOUT_OWNED', '✓ Owned') : '✓ Owned';
        const lockedLabel = this._t ? this._t('LOADOUT_LOCKED', '🔒 Locked') : '🔒 Locked';
        const ownedText = this.add.text(modalX, currentY, isOwned ? ownedLabel : lockedLabel, {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '12px',
            color: isOwned ? '#66ff66' : '#ff6666'
        }).setOrigin(0.5).setDepth(52);
        this.statModal.add(ownedText);
        currentY += 30;

        // Stats section
        const stats = [];
        if (unitData.Health !== undefined && unitData.Health !== null) {
            stats.push(`${this._t ? this._t('STAT_HP', 'HP') : 'HP'}: ${unitData.Health}`);
        }
        if (unitData.Damage !== undefined && unitData.Damage !== null) {
            stats.push(`${this._t ? this._t('STAT_DMG', 'DMG') : 'DMG'}: ${unitData.Damage}`);
        }
        if (unitData.Ammo !== undefined && unitData.Ammo !== null) {
            stats.push(`${this._t ? this._t('STAT_AMMO', 'Ammo') : 'Ammo'}: ${unitData.Ammo}`);
        }
        if (unitData.Range !== undefined && unitData.Range !== null) {
            stats.push(`${this._t ? this._t('STAT_RANGE', 'Range') : 'Range'}: ${unitData.Range}`);
        }
        if (unitData.ReloadDelay !== undefined && unitData.ReloadDelay !== null) {
            const reloadLabel = this._t ? this._t('STAT_RELOAD', 'Reload') : 'Reload';
            stats.push(`${reloadLabel}: ${unitData.ReloadDelay}t`);
        }

        if (stats.length > 0) {
            const statsText = this.add.text(modalX, currentY, stats.join(' | '), {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '10px',
                color: '#cccccc'
            }).setOrigin(0.5).setDepth(52);
            this.statModal.add(statsText);
            currentY += 25;
        }

        // Description
        const description = this._unitDesc ? this._unitDesc(unitKey, unitData) : (unitData.Description || unitData.FullName || unitKey);
        const descText = this.add.text(modalX, currentY, description, {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '10px',
            color: '#aaaaaa',
            align: 'center',
            wordWrap: { width: modalWidth - 40 }
        }).setOrigin(0.5).setDepth(52);
        this.statModal.add(descText);
        currentY += 40;

        // Status Effects with detailed info
        if (unitData.StatusEffects && unitData.StatusEffects.length > 0) {
            const statusTitle = this.add.text(modalX, currentY, this._t ? this._t('LOADOUT_STATUS_EFFECTS', 'Status Effects:') : 'Status Effects:', {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '10px',
                color: '#ffaa66',
                align: 'center'
            }).setOrigin(0.5).setDepth(52);
            this.statModal.add(statusTitle);
            currentY += 18;

            unitData.StatusEffects.forEach(s => {
                let statusDesc = this._formatStatusEffect(s);
                const statusText = this.add.text(modalX, currentY, statusDesc, {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '9px',
                    color: '#ffcc99',
                    align: 'center',
                    wordWrap: { width: modalWidth - 40 }
                }).setOrigin(0.5).setDepth(52);
                this.statModal.add(statusText);
                currentY += 16;
            });
            currentY += 10;
        }

        // Special Effects with detailed info
        if (unitData.SpecialEffects && unitData.SpecialEffects.length > 0) {
            const effectsTitle = this.add.text(modalX, currentY, this._t ? this._t('LOADOUT_SPECIAL_EFFECTS', 'Special Effects:') : 'Special Effects:', {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '10px',
                color: '#66ccff',
                align: 'center'
            }).setOrigin(0.5).setDepth(52);
            this.statModal.add(effectsTitle);
            currentY += 18;

            unitData.SpecialEffects.forEach(e => {
                let effectDesc = this._formatSpecialEffect(e);
                const effectText = this.add.text(modalX, currentY, effectDesc, {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '9px',
                    color: '#99ddff',
                    align: 'center',
                    wordWrap: { width: modalWidth - 40 }
                }).setOrigin(0.5).setDepth(52);
                this.statModal.add(effectText);
                currentY += 16;
            });
            currentY += 10;
        }

        // Unit Abilities (non-special effect properties)
        const abilities = this._getUnitAbilities(unitData);
        if (abilities.length > 0) {
            const abilitiesTitle = this.add.text(modalX, currentY, this._t ? this._t('LOADOUT_ABILITIES', 'Abilities:') : 'Abilities:', {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '10px',
                color: '#cc99ff',
                align: 'center'
            }).setOrigin(0.5).setDepth(52);
            this.statModal.add(abilitiesTitle);
            currentY += 18;

            abilities.forEach(ability => {
                const abilityText = this.add.text(modalX, currentY, ability, {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '9px',
                    color: '#ddbbff',
                    align: 'center',
                    wordWrap: { width: modalWidth - 40 }
                }).setOrigin(0.5).setDepth(52);
                this.statModal.add(abilityText);
                currentY += 16;
            });
            currentY += 10;
        }

        currentY += 10;

        // Action buttons
        if (isOwned) {
            // Add to loadout button
            const addBtn = this.add.text(modalX - 70, currentY, this._t ? this._t('LOADOUT_ADD', 'Add') : 'Add', {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '12px',
                color: '#66ff66',
                backgroundColor: '#224422',
                padding: { x: 10, y: 5 }
            }).setOrigin(0.5).setDepth(52).setInteractive();

            addBtn.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.addToLoadout(unitKey);
            });
            this.statModal.add(addBtn);
        } else {
            // Show cost and buy option
            const cost = this.getCost(unitKey);
            const costText = this.add.text(modalX, currentY, this._fmt ? this._fmt('LOADOUT_COST', 'Cost: {0} tokens', formatCompact(cost)) : `Cost: ${formatCompact(cost)} tokens`, {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '12px',
                color: '#ffd700'
            }).setOrigin(0.5).setDepth(52);
            this.statModal.add(costText);
            currentY += 25;

            const buyBtn = this.add.text(modalX, currentY, this._t ? this._t('LOADOUT_BUY_SHOP', 'Buy in Shop') : 'Buy in Shop', {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '12px',
                color: '#66ccff',
                backgroundColor: '#222244',
                padding: { x: 10, y: 5 }
            }).setOrigin(0.5).setDepth(52).setInteractive();

            buyBtn.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.closeStatModal();
                this.openShop();
            });
            this.statModal.add(buyBtn);
        }
    }

    closeStatModal() {
        if (this.statModal) {
            this.statModal.getChildren().forEach(child => {
                if (child.disableInteractive) child.disableInteractive();
            });
            
            this.statModal.getChildren().forEach(child => {
                if (child.destroy) child.destroy();
            });
            this.statModal.clear(true);
            this.statModal.destroy();
            this.statModal = null;
        }
        this.selectedUnit = null;
    }

    /**
     * Format a status effect for display in the stat modal
     */
    _formatStatusEffect(effect) {
        const t = this._t || ((key, fallback) => GlobalLocalization.t(key, fallback));
        const fmt = this._fmt || ((key, ...args) => GlobalLocalization.format(key, ...args));
        if (!effect || !effect.Type) return t('LOADOUT_UNKNOWN_EFFECT', 'Unknown Effect');
        
        const type = effect.Type;
        const duration = effect.Duration !== undefined ? `${effect.Duration}t` : '';
        const value = effect.Value !== undefined ? effect.Value : '';
        const chanceText = (effect.PercentageChance !== undefined && effect.PercentageChance < 1)
            ? ` (${Math.round(effect.PercentageChance * 100)}%)`
            : '';
        const filterText = this._formatTargetingFilter(effect.TargetingFilter);
        
        switch (type) {
            case 'Fire':
                return fmt('STATUS_FIRE_DESC', 'Fire: {0} dmg/turn{1}{2}{3}', value, duration ? ` (${duration})` : '', chanceText, filterText);
            case 'Poison':
                return fmt('STATUS_POISON_DESC', 'Poison: {0} dmg/turn{1}{2}{3}', value, duration ? ` (${duration})` : '', chanceText, filterText);
            case 'Slow':
                const slowValue = effect.Value !== undefined ? `+${effect.Value} reload` : '';
                const speedRed = effect.SpeedReduction !== undefined ? `${Math.round((1 - effect.SpeedReduction) * 100)}% slow` : '';
                return fmt('STATUS_SLOW_DESC', 'Slow{0}{1}{2}{3}{4}',
                    slowValue ? `: ${slowValue}` : '',
                    speedRed ? `, ${speedRed}` : '',
                    duration ? ` (${duration})` : '',
                    chanceText,
                    filterText
                );
            case 'Stun':
                return fmt('STATUS_STUN_DESC', 'Stun: Prevents action{0}{1}{2}', duration ? ` (${duration})` : '', chanceText, filterText);
            case 'Frozen':
                return fmt('STATUS_FROZEN_DESC', 'Frozen: Prevents action{0}{1}{2}', duration ? ` (${duration})` : '', chanceText, filterText);
            case 'Acid':
                const bonusDmg = effect.BonusDamage !== undefined ? `${Math.round((effect.BonusDamage - 1) * 100)}% bonus dmg` : '';
                return fmt('STATUS_ACID_DESC', 'Acid{0}{1}{2}{3}',
                    bonusDmg ? `: ${bonusDmg}` : '',
                    duration ? ` (${duration})` : '',
                    chanceText,
                    filterText
                );
            case 'Purge':
                return fmt('STATUS_PURGE_DESC', 'Purge: Removes all status effects{0}{1}', chanceText, filterText);
            case 'Charm':
                return fmt('STATUS_CHARM_DESC', 'Charm: Attacks allies{0}{1}{2}', duration ? ` (${duration})` : '', chanceText, filterText);
            case 'Undetectable':
                return fmt('STATUS_UNDETECTABLE_DESC', 'Undetectable: Cannot be targeted{0}{1}{2}', duration ? ` (${duration})` : '', chanceText, filterText);
            default:
                return fmt('STATUS_GENERIC_DESC', '- {0}{1}{2}{3}{4}',
                    type,
                    value ? `: ${value}` : '',
                    duration ? ` (${duration})` : '',
                    chanceText,
                    filterText
                );
        }
    }

    _formatTargetingFilter(tf) {
        const t = this._t || ((key, fallback) => GlobalLocalization.t(key, fallback));
        if (!tf || typeof tf !== 'object') return '';
        const parts = [];

        const inc = tf.Include && typeof tf.Include === 'object' ? tf.Include : null;
        const exc = tf.Exclude && typeof tf.Exclude === 'object' ? tf.Exclude : null;

        if (inc) {
            if (Array.isArray(inc.MonsterType) && inc.MonsterType.length) parts.push(`${t('FILTER_INCLUDE_MONSTERS', 'Include Monsters')}: ${inc.MonsterType.join(', ')}`);
            if (Array.isArray(inc.DefenceType) && inc.DefenceType.length) parts.push(`${t('FILTER_INCLUDE_DEFENCES', 'Include Defences')}: ${inc.DefenceType.join(', ')}`);
            if (Array.isArray(inc.StatusEffect) && inc.StatusEffect.length) parts.push(`${t('FILTER_REQUIRE_STATUS', 'Require Status')}: ${inc.StatusEffect.join(', ')}`);
        }
        if (exc) {
            if (Array.isArray(exc.MonsterType) && exc.MonsterType.length) parts.push(`${t('FILTER_EXCLUDE_MONSTERS', 'Exclude Monsters')}: ${exc.MonsterType.join(', ')}`);
            if (Array.isArray(exc.DefenceType) && exc.DefenceType.length) parts.push(`${t('FILTER_EXCLUDE_DEFENCES', 'Exclude Defences')}: ${exc.DefenceType.join(', ')}`);
            if (Array.isArray(exc.StatusEffect) && exc.StatusEffect.length) parts.push(`${t('FILTER_EXCLUDE_STATUS', 'Exclude Status')}: ${exc.StatusEffect.join(', ')}`);
        }

        if (!parts.length) return '';
        return ` [${t('FILTER_LABEL', 'Filter')}: ${parts.join(' | ')}]`;
    }

    _formatSpecialEffect(effect) {
        const t = this._t || ((key, fallback) => GlobalLocalization.t(key, fallback));
        const fmt = this._fmt || ((key, ...args) => GlobalLocalization.format(key, ...args));
        if (!effect || !effect.Type) return t('LOADOUT_UNKNOWN_EFFECT', 'Unknown Effect');
        
        const type = effect.Type;
        
        switch (type) {
            case 'AreaOfEffect':
                const aoeSize = effect.Value || '1x1';
                const splash = effect.SplashFactor !== undefined ? `${Math.round(effect.SplashFactor * 100)}% splash` : '';
                const condense = effect.CondenseTargeting ? ' (Smart)' : '';
                const omnidir = effect.IsOmnidirectional ? ' (Omni)' : '';
                const aoeFilter = this._formatTargetingFilter(effect.TargetingFilter);
                return fmt('EFFECT_AOE_DESC', 'Area of Effect: {0}{1}{2}{3}{4}', aoeSize, splash ? `, ${splash}` : '', condense, omnidir, aoeFilter);
            case 'LaserBeam':
                const ext = effect.Extension !== undefined ? `+${effect.Extension} pierce` : '';
                const fullRow = effect.TravelEntireRow ? ' (Full Row)' : '';
                const targetingFilter = this._formatTargetingFilter(effect.TargetingFilter);
                return fmt('EFFECT_LASER_DESC', 'Laser Beam{0}{1}{2}', ext ? `: ${ext}` : '', fullRow, targetingFilter);
            case 'MultiFire':
                const fireDelay = effect.FireDelay !== undefined ? ` (${effect.FireDelay}s delay)` : '';
                return fmt('EFFECT_MULTIFIRE_DESC', 'Multi-Fire: {0} shots{1}', effect.FireCount || 1, fireDelay);
            case 'SpreadTargeting':
                const minEnemies = effect.MinimumEnemies ? `(${effect.MinimumEnemies}+ enemies)` : '';
                const onlyWhenEnough = effect.OnlyActivateWhenEnoughEnemies ? ' (Conditional)' : '';
                const ammoIndices = effect.AmmoIndices ? ' (Multi-mode)' : '';
                const ammoIndex = effect.AmmoIndex !== undefined ? ` [Ammo ${effect.AmmoIndex}]` : '';
                return fmt('EFFECT_SPREAD_DESC', 'Spread Targeting{0}{1}{2}{3}',
                    minEnemies ? ` ${minEnemies}` : '',
                    onlyWhenEnough,
                    ammoIndices,
                    ammoIndex
                );
            case 'SummonUnit':
                const unit = effect.UnitType || 'Unit';
                const cooldown = effect.Cooldown !== undefined ? ` (${effect.Cooldown}t cd)` : '';
                const count = effect.SpawnCount || 1;
                const spawnDir = effect.SpawnDirection ? ` ${effect.SpawnDirection}` : '';
                const spawnPos = effect.SpawnPosition ? ` @${effect.SpawnPosition}` : '';
                return fmt('EFFECT_SUMMON_DESC', 'Summon: {0}x {1}{2}{3}{4}', count, unit, spawnDir, spawnPos, cooldown);
            case 'CreatePuddle':
                const puddleType = effect.PuddleType || 'Generic';
                const def = (PuddleFactory.puddleData && puddleType) ? PuddleFactory.puddleData[puddleType] : null;
                const damageVal = (effect.Damage !== undefined) ? effect.Damage : def?.Damage;
                const durationVal = (effect.Duration !== undefined) ? effect.Duration : def?.Duration;
                const spriteVal = effect.Sprite || def?.Sprite;
                const statusList = Array.isArray(effect.StatusEffects) ? effect.StatusEffects :
                    (Array.isArray(def?.StatusEffects) ? def.StatusEffects : []);
                const tf = effect.TargetingFilter || def?.TargetingFilter;

                const puddleDmg = damageVal !== undefined ? ` ${damageVal} dmg` : '';
                const puddleDur = durationVal !== undefined ? ` (${durationVal}t)` : '';
                const puddleSprite = spriteVal ? ` [${spriteVal}]` : '';
                const puddleStatuses = Array.isArray(statusList) && statusList.length ?
                    ` Status: ${statusList.map(s => (typeof s === 'string' ? s : (s?.Type || JSON.stringify(s)))).join(', ')}` : '';
                const puddleFilter = this._formatTargetingFilter(tf);
                return fmt('EFFECT_PUDDLE_DESC', 'Create Puddle: {0}{1}{2}{3}{4}{5}', puddleType, puddleDmg, puddleDur, puddleStatuses, puddleSprite, puddleFilter);
            case 'DeathEffect':
                const radius = effect.Radius || effect.Value || '1x1';
                const deathDmg = effect.DeathDamage !== undefined ? `${effect.DeathDamage} dmg` : '';
                const deathHeal = effect.DeathHealing !== undefined ? `${effect.DeathHealing} heal` : '';
                const deathStatuses = effect.DeathStatuses && effect.DeathStatuses.length > 0 ? ` Status: ${effect.DeathStatuses.join(', ')}` : '';
                const deathFilter = this._formatTargetingFilter(effect.TargetingFilter);
                const deathSprite = effect.Sprite ? ` [${effect.Sprite}]` : '';
                const effects = [deathDmg, deathHeal].filter(Boolean).join(', ');
                return fmt('EFFECT_DEATH_DESC', 'Death Effect: {0}{1}{2}{3}{4}', radius, effects ? `, ${effects}` : '', deathStatuses, deathFilter, deathSprite);
            case 'Lifesteal':
                const lsPercent = effect.Value !== undefined ? `${Math.round(effect.Value * 100)}%` : '';
                return fmt('EFFECT_LIFESTEAL_DESC', 'Lifesteal{0}', lsPercent ? `: ${lsPercent}` : '');
            case 'Armor':
                const armorVal = effect.Value !== undefined ? `${effect.Value} armor` : '';
                const dmgRed = effect.DamageReduction !== undefined ? `${Math.round((1 - effect.DamageReduction) * 100)}% reduction` : '';
                return fmt('EFFECT_ARMOR_DESC', 'Armor{0}{1}', armorVal ? ` ${armorVal}` : '', dmgRed ? `, ${dmgRed}` : '');
            case 'ArmorPiercing':
                const pierceVal = effect.Value !== undefined ? `${Math.round(effect.Value * 100)}% pierce` : '';
                return fmt('EFFECT_PIERCE_DESC', 'Armor Piercing{0}', pierceVal ? `: ${pierceVal}` : '');
            case 'Revive':
                const maxRevives = effect.MaxRevives !== undefined ? `${effect.MaxRevives}x` : '';
                const chance = effect.ReviveChance !== undefined && effect.ReviveChance < 1 ? ` (${Math.round(effect.ReviveChance * 100)}% chance)` : '';
                const healthMult = effect.HealthMult !== undefined ? ` HP:${Math.round(effect.HealthMult * 100)}%` : '';
                const damageMult = effect.DamageMult !== undefined ? ` DMG:${Math.round(effect.DamageMult * 100)}%` : '';
                return fmt('EFFECT_REVIVE_DESC', 'Revive{0}{1}{2}{3}', maxRevives ? `: ${maxRevives}` : '', chance, healthMult, damageMult);
            case 'HealAllies':
                const healAmt = effect.HealAmount !== undefined ? `${effect.HealAmount}` : (effect.HealMult !== undefined ? `${Math.round(effect.HealMult * 100)}%` : '');
                const range = effect.Range !== undefined ? ` (${effect.Range} range)` : '';
                const consumesAtk = effect.ConsumesAttack !== false ? ' (Uses Attack)' : '';
                const targetingDir = effect.TargetingDirection ? ` ${effect.TargetingDirection}` : '';
                const targetingFilterHeal = this._formatTargetingFilter(effect.TargetingFilter);
                return fmt('EFFECT_HEAL_DESC', 'Heal Allies{0}{1}{2}{3}{4}', healAmt ? `: ${healAmt}` : '', range, consumesAtk, targetingDir, targetingFilterHeal);
            case 'DamageBooster':
                const boostRadius = effect.Radius || effect.Value || '3x3';
                const boostVal = effect.Value !== undefined ? `${Math.round((effect.Value - 1) * 100)}%` : '';
                return fmt('EFFECT_BOOST_DESC', 'Damage Boost: {0}{1}', boostRadius, boostVal ? `, ${boostVal}` : '');
            case 'Accuracy':
                const minAcc = effect.MinValue !== undefined ? `${Math.round(effect.MinValue * 100)}%` : '';
                const maxAcc = effect.MaxValue !== undefined ? `${Math.round(effect.MaxValue * 100)}%` : '';
                return fmt('EFFECT_ACCURACY_DESC', 'Accuracy{0}', minAcc ? `: ${minAcc}-${maxAcc}` : '');
            case 'BlockAllLanes':
                const shield = effect.ShieldValue !== undefined ? ` (${effect.ShieldValue} shield)` : '';
                const dissipates = effect.DissipatesWhenDestroyed ? ' (Dissipates)' : '';
                return fmt('EFFECT_BLOCK_DESC', 'Block All Lanes{0}{1}', shield, dissipates);
            default:
                return fmt('EFFECT_GENERIC_DESC', '- {0}', type);
        }
    }

_getUnitAbilities(unitData) {
        const t = this._t || ((key, fallback) => GlobalLocalization.t(key, fallback));
        const abilities = [];

        // Targeting abilities
        if (unitData.CanTargetAdjacentLanes) {
            abilities.push(t('ABILITY_ADJACENT', '↔️ Can Target Adjacent Lanes'));
        }
        if (unitData.BackTargeting) {
            abilities.push(t('ABILITY_BACK', '🔙 Can Target Behind'));
        }
        if (unitData.HasBlindSpot) {
            const blindRange = unitData.BlindRange !== undefined ? ` (${unitData.BlindRange} tile${unitData.BlindRange > 1 ? 's' : ''})` : '';
            abilities.push(`${t('ABILITY_BLIND', '🙈 Blind Spot')}${blindRange}`);
        }

        // Lifespan/Temporary
        if (unitData.HasLifespan || unitData.Lifespan) {
            const lifespan = unitData.Lifespan || unitData.lifespan || '?';
            abilities.push(`${t('ABILITY_TEMP', '⏱️ Temporary')}: ${lifespan} ${t('ABILITY_TURNS', 'turns')}`);
        }

        // Targeting mode (if not default)
        if (unitData.TargetingMode && unitData.TargetingMode !== 'First') {
            abilities.push(`${t('ABILITY_TARGETING', '🎯 Targeting')}: ${unitData.TargetingMode}`);
        }

        // Speed (for monsters)
        if (unitData.Speed !== undefined && unitData.Speed !== null) {
            abilities.push(`${t('ABILITY_SPEED', '🏃 Speed')}: ${unitData.Speed} ${t('ABILITY_TILE', 'tile')}${unitData.Speed > 1 ? 's' : ''}/${t('ABILITY_TURN', 'turn')}`);
        }
        // Visibility / detection
        if (unitData.DontAttack) {
            abilities.push(t('ABILITY_NO_ATTACK', 'Cannot Attack'));
        }
        if (unitData.CanDetect) {
            abilities.push(t('ABILITY_DETECT', 'Can Detect Invisible Units'));
        }
        if (unitData.IsUndetectable) {
            abilities.push(t('ABILITY_UNDETECTABLE', 'Innate Undetectable'));
        }
        if (unitData.StartsWithNoAmmo) {
            abilities.push(t('ABILITY_NO_AMMO', 'Starts With No Ammo'));
        }
        if (unitData.RemoveWhenOutOfAmmo) {
            abilities.push(t('ABILITY_REMOVE_NO_AMMO', 'Removed When Out Of Ammo'));
        }
        if (unitData.CanBeTrampled) {
            abilities.push(t('ABILITY_TRAMPLED', 'Can Be Trampled (Not Targetable)'));
        }

        return abilities;
    }

    _getUnitClassInfo(unitKey, unitData) {
        if (!unitKey || !unitData) return null;
        const isDefence = this.currentTab === 'defence';
        const t = this._t || ((key, fallback) => GlobalLocalization.t(key, fallback));

        const defenceMap = {
            AcidShooter: { className: 'Control', placement: 'Mid/Backline' },
            Ballista: { className: 'Damage Dealer', placement: 'Mid/Backline' },
            Barricade: { className: 'Tank', placement: 'Frontline' },
            BoomCannon: { className: 'Damage Dealer', placement: 'Midline' },
            Cannon: { className: 'Damage Dealer', placement: 'Midline' },
            CryoFan: { className: 'Control', placement: 'Mid/Backline' },
            DamageAmplifier: { className: 'Support', placement: 'Backline' },
            DestroyTower: { className: 'Finisher', placement: 'Backline' },
            Flamethrower: { className: 'Bruiser', placement: 'Frontline' },
            ForceField: { className: 'Hybrid', placement: 'Frontline' },
            Landmine: { className: 'Hybrid', placement: 'Frontline' },
            LazorBeam: { className: 'Generalist', placement: 'Mid/Backline' },
            MachineGun: { className: 'Damage Dealer', placement: 'Midline' },
            MicroSentry: { className: 'Generalist', placement: 'Midline' },
            Microwavr: { className: 'Bruiser', placement: 'Frontline' },
            Mortar: { className: 'Artillery', placement: 'Backline' },
            Multishot: { className: 'Generalist', placement: 'Midline' },
            RadialLauncher: { className: 'Artillery', placement: 'Backline' },
            RocketLauncher: { className: 'Artillery', placement: 'Backline' },
            SIMO: { className: 'Generalist', placement: 'Midline' },
            ShockBlaster: { className: 'Generalist', placement: 'Midline' },
            ShockLauncher: { className: 'Artillery', placement: 'Backline' },
            Shredder: { className: 'Bruiser', placement: 'Frontline' },
            SniperTower: { className: 'Damage Dealer', placement: 'Mid/Backline' }
        };

        const monsterMap = {
            Archer: { className: 'Damage Dealer', placement: 'Midline' },
            Bat: { className: 'Skirmisher', placement: 'Frontline' },
            Bomber: { className: 'Artillery', placement: 'Backline' },
            Catapult: { className: 'Siege', placement: 'Backline' },
            Cupid: { className: 'Control', placement: 'Midline' },
            Demon: { className: 'Hybrid', placement: 'Midline' },
            ElectroMage: { className: 'Control', placement: 'Midline' },
            FireImp: { className: 'Damage Dealer', placement: 'Frontline' },
            Ghost: { className: 'Skirmisher', placement: 'Frontline' },
            Goblin: { className: 'Swarm', placement: 'Frontline' },
            Golem: { className: 'Tank', placement: 'Frontline' },
            Harpy: { className: 'Skirmisher', placement: 'Frontline' },
            IceLizard: { className: 'Control', placement: 'Midline' },
            Knight: { className: 'Tank', placement: 'Frontline' },
            Mech: { className: 'Bruiser', placement: 'Midline' },
            Necromancer: { className: 'Summoner', placement: 'Midline' },
            Orc: { className: 'Bruiser', placement: 'Frontline' },
            PoisonWard: { className: 'Control', placement: 'Midline' },
            Skeleton: { className: 'Swarm', placement: 'Frontline' },
            Surgeon: { className: 'Support', placement: 'Midline' },
            Tank: { className: 'Tank', placement: 'Frontline' },
            Thrower: { className: 'Damage Dealer', placement: 'Midline' },
            Troll: { className: 'Bruiser', placement: 'Frontline' },
            Zombie: { className: 'Swarm', placement: 'Frontline' }
        };

        // Fallback if not mapped
        const fallback = {
            className: isDefence ? 'Generalist' : 'Bruiser',
            placement: 'Midline'
        };
        const info = (isDefence && defenceMap[unitKey]) ? defenceMap[unitKey]
            : (!isDefence && monsterMap[unitKey]) ? monsterMap[unitKey]
            : fallback;

        const classKey = `CLASS_${String(info.className).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
        const placeKey = `PLACEMENT_${String(info.placement).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
        return {
            className: t(classKey, info.className),
            placement: t(placeKey, info.placement)
        };
    }

    addToLoadout(unitKey) {
        const loadout = this.getCurrentLoadout();
        const emptySlot = loadout.findIndex(slot => !slot);

        if (emptySlot === -1) {
            AlertManager.show(this, this._t ? this._t('LOADOUT_FULL', 'Loadout is full! Remove a unit first.') : 'Loadout is full! Remove a unit first.', 'warning');
            return;
        }

        if (loadout.includes(unitKey)) {
            AlertManager.show(this, this._t ? this._t('LOADOUT_ALREADY', 'Unit already in loadout!') : 'Unit already in loadout!', 'info');
            return;
        }

        loadout[emptySlot] = unitKey;
        this.saveData();
        this.refresh();
        this.closeStatModal();
        AlertManager.show(this, this._t ? this._t('LOADOUT_ADDED', 'Unit added to loadout!') : 'Unit added to loadout!', 'success');
    }

    refreshSlots() {
        // Clear existing slot visuals
        if (this.slotSprites) {
            this.slotSprites.forEach(s => s.destroy && s.destroy());
        }
        this.slotSprites = [];

        const loadout = this.getCurrentLoadout();
        const factory = this.currentTab === 'defence' ? DefenceFactory : MonsterFactory;
        const data = factory.defenceData || factory.monsterData;

        for (let i = 0; i < 5; i++) {
            const y = 240 + i * 60;
            const x = 600;
            const unit = loadout[i];

            if (unit) {
                const unitData = data[unit];
                const spriteKey = unitData?.DisplaySprite;
                const fallbackKey = 'dice' + ((i % 6) + 1);
                const useKey = (spriteKey && this.textures.exists(spriteKey)) ? spriteKey : fallbackKey;

                // Slot background
                const slotBg = this.add.rectangle(x, y, 260, 45, 0x2a2a2a)
                    .setStrokeStyle(2, 0x444444)
                    .setDepth(5);

                // Unit sprite
                const sprite = this.add.sprite(x - 100, y, useKey)
                    .setScale(0.35)
                    .setDepth(10);

                // Unit name
                const nameText = this.add.text(x - 70, y, this._unitName ? this._unitName(unit, unitData) : (unitData?.FullName || unit), {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '12px',
                    color: '#ffffff'
                }).setOrigin(0, 0.5).setDepth(10);

                // Remove button
                const removeBtn = this.add.text(x + 110, y, '✕', {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '14px',
                    color: '#ff6666'
                }).setOrigin(0.5).setDepth(10).setInteractive();

                removeBtn.on('pointerdown', () => {
                    GlobalAudio.playButton(this);
                    loadout[i] = null;
                    this.saveData();
                    this.refresh();
                });

                this.slotSprites.push(slotBg, sprite, nameText, removeBtn);
            } else {
                // Empty slot
                const emptyText = this.add.text(x, y, this._t ? this._t('LOADOUT_EMPTY_SLOT', 'Empty Slot') : 'Empty Slot', {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '12px',
                    color: '#666666'
                }).setOrigin(0.5).setDepth(10);
                this.slotSprites.push(emptyText);
            }
        }
    }

    getAvailableUnits() {
        const factory = this.currentTab === 'defence' ? DefenceFactory : MonsterFactory;
        const data = factory.defenceData || factory.monsterData;
        const all = Object.keys(data);
        const filtered = all.filter(u => data[u].IsProto === (this.currentSubTab === 'proto'));
        return filtered;
    }

    isOwned(unit) {
        const owned = this.currentTab === 'defence' ? this.ownedDefences : this.ownedMonsters;
        return owned.includes(unit);
    }

    getCost(unit) {
        const factory = this.currentTab === 'defence' ? DefenceFactory : MonsterFactory;
        const data = factory.defenceData || factory.monsterData;
        const rarity = data[unit].Rarity;
        const costs = {
            Common: 100,
            Uncommon: 300,
            Rare: 750,
            Epic: 2500,
            Legendary: 50000
        };
        return costs[rarity] || 0;
    }

    addOwned(unit) {
        const owned = this.currentTab === 'defence' ? this.ownedDefences : this.ownedMonsters;
        if (!owned.includes(unit)) owned.push(unit);
    }

    setSlot(slotIndex, unit) {
        const loadout = this.getCurrentLoadout();
        if (loadout.includes(unit)) return;
        loadout[slotIndex] = unit;
        this.refresh();
    }

    getCurrentLoadout() {
        if (this.currentTab === 'defence') {
            return this.currentSubTab === 'normal' ? this.defenceNormalLoadout : this.defenceProtoLoadout;
        } else {
            return this.currentSubTab === 'normal' ? this.monsterNormalLoadout : this.monsterProtoLoadout;
        }
    }

    saveData() {
        localStorage.setItem('online_diceTokens', this.diceTokens);
        localStorage.setItem('online_defenceNormalLoadout', JSON.stringify(this.defenceNormalLoadout));
        localStorage.setItem('online_defenceProtoLoadout', JSON.stringify(this.defenceProtoLoadout));
        localStorage.setItem('online_monsterNormalLoadout', JSON.stringify(this.monsterNormalLoadout));
        localStorage.setItem('online_monsterProtoLoadout', JSON.stringify(this.monsterProtoLoadout));
        localStorage.setItem('online_ownedDefences', JSON.stringify(this.ownedDefences));
        localStorage.setItem('online_ownedMonsters', JSON.stringify(this.ownedMonsters));
        if (this.tokenText) {
            const text = this._fmt ? this._fmt('LOADOUT_TOKENS', 'Tokens: {0}', formatCompact(this.diceTokens)) : `Tokens: ${this.diceTokens}`;
            this.tokenText.setText(text);
        }
    }

    openShop() {
        if (this.shopGroup) return;
        this.closeStatModal();
        this.shopGroup = this.add.group();

        const factory = this.currentTab === 'defence' ? DefenceFactory : MonsterFactory;
        const data = factory.defenceData || factory.monsterData;
        const all = Object.keys(data).filter(k => data[k].IsProto === (this.currentSubTab === 'proto'));

        const perRow = 4;
        const cardW = 160;
        const cardH = 180;
        const padding = 20;
        const rows = Math.ceil(all.length / perRow);
        const modalW = perRow * (cardW + padding) + padding;
        const modalH = 140 + rows * (cardH + padding) + 60;

        const centerX = 640;
        const centerY = 120 + modalH / 2;

        // Full-screen interactive backdrop that blocks clicks to main UI
        const backdrop = this.add.rectangle(640, 300, 1280, 600, 0x000000, 0.7)
            .setDepth(100)
            .setInteractive();
        this.shopGroup.add(backdrop);

        // Panel
        const panel = this.add.rectangle(centerX, centerY, modalW, modalH, 0x1a1a1a)
            .setStrokeStyle(3, 0xffffff)
            .setDepth(101);
        this.shopGroup.add(panel);

        // Title
        const title = this.add.text(centerX, centerY - modalH / 2 + 35, this._t ? this._t('SHOP_TITLE', 'Unit Shop') : 'Unit Shop', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '24px',
            color: '#ffd700'
        }).setOrigin(0.5).setDepth(102);
        this.shopGroup.add(title);

        // Close X
        const close = this.add.text(centerX + modalW / 2 - 25, centerY - modalH / 2 + 25, '✕', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '20px',
            color: '#ff6666'
        }).setOrigin(0.5).setDepth(102).setInteractive();
        close.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.closeShop();
        });
        this.shopGroup.add(close);

        // Build grid of cards
        all.forEach((key, idx) => {
            const col = idx % perRow;
            const row = Math.floor(idx / perRow);

            const itemX = centerX - modalW / 2 + padding + col * (cardW + padding) + cardW / 2;
            const itemY = centerY - modalH / 2 + 90 + row * (cardH + padding) + cardH / 2;

            const fullName = this._unitName ? this._unitName(key, data[key]) : (data[key]?.FullName || key);
            const owned = (this.currentTab === 'defence' ? this.ownedDefences : this.ownedMonsters).includes(key);
            const rarity = data[key].Rarity || 'Common';
            const cost = this.getCost(key) || 0;
            const displayCost = formatCompact(cost);
            const rarityColor = this.getRarityColor(rarity);

            const spriteKey = data[key]?.DisplaySprite;
            const fallbackKey = 'dice' + ((idx % 6) + 1);
            const iconKey = (spriteKey && this.textures.exists(spriteKey)) ? spriteKey : fallbackKey;

            // Card background with rarity color
            const cardBg = this.add.rectangle(itemX, itemY, cardW, cardH, 0x2a2a2a)
                .setStrokeStyle(3, rarityColor)
                .setDepth(101);
            this.shopGroup.add(cardBg);

            // Icon
            const icon = this.add.sprite(itemX, itemY - 25, iconKey).setScale(0.5).setDepth(102);
            this.shopGroup.add(icon);

            // Name
            const name = this.add.text(itemX, itemY + 25, fullName, {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '10px',
                color: '#ffffff'
            }).setOrigin(0.5).setDepth(102);
            this.shopGroup.add(name);

            // Rarity
            const rarityText = this.add.text(itemX, itemY + 45, rarity, {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '10px',
                color: '#' + rarityColor.toString(16).padStart(6, '0')
            }).setOrigin(0.5).setDepth(102);
            this.shopGroup.add(rarityText);

            // Cost or Owned status
            if (owned) {
                const ownedText = this.add.text(itemX, itemY + 70, this._t ? this._t('SHOP_OWNED', '✓ Owned') : '✓ Owned', {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '12px',
                    color: '#66ff66'
                }).setOrigin(0.5).setDepth(102);
                this.shopGroup.add(ownedText);
            } else {
                const costText = this.add.text(itemX, itemY + 65, `${displayCost}`, {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '12px',
                    color: '#ffd700'
                }).setOrigin(0.5).setDepth(102);
                this.shopGroup.add(costText);

                const buyBtn = this.add.text(itemX, itemY + 82, this._t ? this._t('SHOP_BUY', 'Buy') : 'Buy', {
                    fontFamily: '"Press Start 2P", cursive',
                    fontSize: '12px',
                    color: '#ffffff',
                    backgroundColor: this.diceTokens >= cost ? '#226622' : '#662222',
                    padding: { x: 15, y: 5 }
                }).setOrigin(0.5).setDepth(102).setInteractive();

                buyBtn.on('pointerdown', () => {
                    if ((this.currentTab === 'defence' ? this.ownedDefences : this.ownedMonsters).includes(key)) {
                        AlertManager.show(this, this._fmt ? this._fmt('SHOP_ALREADY_OWNED', '{0} is already owned.', fullName) : `${fullName} is already owned.`, 'info');
                        return;
                    }
                    if (this.diceTokens < cost) {
                        AlertManager.show(this, this._fmt ? this._fmt('SHOP_NOT_ENOUGH', 'Not enough tokens ({0} required).', displayCost) : `Not enough tokens (${displayCost} required).`, 'error');
                        return;
                    }
                    GlobalAudio.playButton(this);
                    this.diceTokens -= cost;
                    this.addOwned(key);
                    this.saveData();
                    try {
                        GlobalAchievements.recordShopPurchase(rarity);
                    } catch (e) {}
                    this.closeShop();
                    this.openShop();
                    AlertManager.show(this, this._fmt ? this._fmt('SHOP_PURCHASED', 'Purchased {0}!', fullName) : `Purchased ${fullName}!`, 'success');
                });
                this.shopGroup.add(buyBtn);
            }
        });
    }

    closeShop() {
        if (!this.shopGroup) return;
        
        // Disable all interactive elements before destroying to prevent lingering clicks
        this.shopGroup.getChildren().forEach(c => {
            if (c.disableInteractive) c.disableInteractive();
        });
        
        this.shopGroup.getChildren().forEach(c => {
            if (c.destroy) c.destroy();
        });
        this.shopGroup.clear(true);
        this.shopGroup.destroy();
        this.shopGroup = null;
        this.refresh();
    }

    openDevMenu() {
        if (this.devGroup) return;
        this.devGroup = this.add.group();

        const cx = 640;
        const cy = 360;
        const w = 500;
        const h = 360;

        const bg = this.add.rectangle(cx, cy, 1280, 600, 0x000000, 0.85).setDepth(200).setInteractive();
        const panel = this.add.rectangle(cx, cy, w - 20, h - 20, 0x1a1a1a).setStrokeStyle(3, 0xff6666).setDepth(201);

        const title = this.add.text(cx, cy - h / 2 + 35, this._t ? this._t('DEV_MENU_TITLE', 'DEV MENU') : 'DEV MENU', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '20px',
            color: '#ff6666'
        }).setOrigin(0.5).setDepth(202);

        const close = this.add.text(cx + w / 2 - 35, cy - h / 2 + 30, '✕', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '18px',
            color: '#ff6666'
        }).setOrigin(0.5).setDepth(202).setInteractive();
        close.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.closeDevMenu();
        });

        this.devGroup.addMultiple([bg, panel, title, close]);

        let y = cy - 80;

        // Add Tokens
        const addTokens = this.add.text(cx, y, this._t ? this._t('DEV_ADD_TOKENS', '+10,000 Tokens') : '+10,000 Tokens', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '14px',
            color: '#66ff66',
            backgroundColor: '#224422',
            padding: { x: 15, y: 8 }
        }).setOrigin(0.5).setDepth(202).setInteractive();

        addTokens.on('pointerdown', () => {
            this.diceTokens += 10000;
            console.log('[DEV] Added 10,000 tokens');
            this.saveData();
            this.refresh();
        });
        this.devGroup.add(addTokens);

        y += 50;

        // Unlock All
        const unlockAll = this.add.text(cx, y, this._t ? this._t('DEV_UNLOCK_ALL', 'Unlock ALL Units') : 'Unlock ALL Units', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '14px',
            color: '#66ccff',
            backgroundColor: '#222244',
            padding: { x: 15, y: 8 }
        }).setOrigin(0.5).setDepth(202).setInteractive();

        unlockAll.on('pointerdown', () => this.unlockAllUnits());
        this.devGroup.add(unlockAll);

        y += 50;

        // Unlock by Key
        const unlockOne = this.add.text(cx, y, this._t ? this._t('DEV_UNLOCK_BY_KEY', 'Unlock by Key...') : 'Unlock by Key...', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '14px',
            color: '#ffaa66',
            backgroundColor: '#442222',
            padding: { x: 15, y: 8 }
        }).setOrigin(0.5).setDepth(202).setInteractive();

        unlockOne.on('pointerdown', () => {
            const promptText = this._t ? this._t('DEV_PROMPT_UNIT_KEY', 'Enter unit key (e.g. ForceField, Golem):') : 'Enter unit key (e.g. ForceField, Golem):';
            const key = prompt(promptText);
            if (key) this.devUnlockUnit(key.trim());
        });
        this.devGroup.add(unlockOne);

        y += 50;

        // Log Loadouts
        const logLoadouts = this.add.text(cx, y, this._t ? this._t('DEV_LOG_LOADOUTS', 'Log Loadouts') : 'Log Loadouts', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '14px',
            color: '#dddddd',
            backgroundColor: '#444444',
            padding: { x: 15, y: 8 }
        }).setOrigin(0.5).setDepth(202).setInteractive();

        logLoadouts.on('pointerdown', () => {
            console.log('[DEV] Defence Normal:', this.defenceNormalLoadout);
            console.log('[DEV] Defence Proto:', this.defenceProtoLoadout);
            console.log('[DEV] Monster Normal:', this.monsterNormalLoadout);
            console.log('[DEV] Monster Proto:', this.monsterProtoLoadout);
            console.log('[DEV] Owned Defences:', this.ownedDefences);
            console.log('[DEV] Owned Monsters:', this.ownedMonsters);
        });
        this.devGroup.add(logLoadouts);
    }

    closeDevMenu() {
        if (!this.devGroup) return;
        this.devGroup.getChildren().forEach(c => {
            if (c.disableInteractive) c.disableInteractive();
        });
        this.devGroup.getChildren().forEach(c => c.destroy && c.destroy());
        this.devGroup.clear(true);
        this.devGroup.destroy();
        this.devGroup = null;
    }

    unlockAllUnits() {
        const allDef = Object.keys(DefenceFactory.defenceData || {});
        const allMon = Object.keys(MonsterFactory.monsterData || {});

        this.ownedDefences = [...new Set([...this.ownedDefences, ...allDef])];
        this.ownedMonsters = [...new Set([...this.ownedMonsters, ...allMon])];

        console.log('[DEV] Unlocked ALL units');
        this.saveData();
        this.refresh();
    }

    devUnlockUnit(key) {
        const defData = DefenceFactory.defenceData || {};
        const monData = MonsterFactory.monsterData || {};

        if (defData[key]) {
            if (!this.ownedDefences.includes(key)) {
                this.ownedDefences.push(key);
                console.log(`[DEV] Unlocked Defence: ${key}`);
            }
        } else if (monData[key]) {
            if (!this.ownedMonsters.includes(key)) {
                this.ownedMonsters.push(key);
                console.log(`[DEV] Unlocked Monster: ${key}`);
            }
        } else {
            console.warn('[DEV] Unknown unit key:', key);
            AlertManager.show(this, this._fmt ? this._fmt('DEV_UNKNOWN_UNIT', 'Unknown unit: {0}', key) : `Unknown unit: ${key}`, 'error');
            return;
        }

        this.saveData();
        this.refresh();
    }
}
