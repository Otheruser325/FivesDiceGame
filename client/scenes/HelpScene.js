import GlobalAchievements from '../utils/AchievementsManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import GlobalBackground from '../utils/BackgroundManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';

export default class HelpScene extends Phaser.Scene {
    constructor() {
        super('HelpScene');
        this.popupOpen = false;
        this._helpButtons = {};
        this._activeSection = 'Gameplay';
        this._classRows = null;
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

        this.add.text(600, 70, t('HELP_TITLE', 'Help'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '40px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.add.text(600, 130, t('HELP_SUBTITLE', 'How to Play Protodice'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '20px',
            color: '#ffff66'
        }).setOrigin(0.5);

        this._createHelpButtons();
        this._createSectionPanel();
        this._setSection(this._activeSection);
        this._loadClassTemplate();

        this.backBtn = this.add.text(600, 650, t('UI_BACK', '<- BACK'), {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '24px',
            color: '#ff6666'
        })
        .setOrigin(0.5)
        .setInteractive();

        this.backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });   
        
        this.input.keyboard.on('keydown-ESC', () => {
            GlobalAudio.playButton(this);
            this.scene.start('MenuScene');
        });
    }

    _createHelpButtons() {
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const labels = ['Abilities', 'Classes', 'Gameplay', 'Wincon'];
        const startX = 260;
        const gap = 220;
        const y = 190;

        labels.forEach((label, i) => {
            const displayLabel = t(`HELP_SECTION_${label.toUpperCase()}`, label);
            const x = startX + (i * gap);
            const btn = this.add.text(x, y, displayLabel, {
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '14px',
                color: '#cccccc'
            }).setOrigin(0.5).setInteractive();

            btn.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this._setSection(label);
            });

            this._helpButtons[label] = btn;
        });
    }

    _createSectionPanel() {
        this.sectionTitle = this.add.text(600, 240, '', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '18px',
            color: '#ffff66'
        }).setOrigin(0.5);

        this.sectionText = this.add.text(600, 420, '', {
            fontFamily: '"Press Start 2P", cursive',
            fontSize: '12px',
            color: '#ffffff',
            align: 'center',
            wordWrap: { width: 900 }
        }).setOrigin(0.5);
    }

    _setSection(label) {
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        this._activeSection = label;
        Object.entries(this._helpButtons).forEach(([key, btn]) => {
            if (!btn) return;
            const isActive = key === label;
            btn.setColor(isActive ? '#ffff66' : '#cccccc');
        });

        if (this.sectionTitle) this.sectionTitle.setText(t(`HELP_SECTION_${label.toUpperCase()}`, label));

        if (!this.sectionText) return;
        if (label === 'Abilities') {
            this.sectionText.setText(t('HELP_TEXT_ABILITIES',
                "Abilities are split into Special Effects and Status Effects.\n\n" +
                "Special Effects: Area of Effect, Armor Piercing, Laser Beam,\n" +
                "Multi-Fire, Summon Unit, Block All Lanes, and more.\n\n" +
                "Status Effects: Fire, Poison, Slow, Stun, Charm, Acid,\n" +
                "Undetectable, and other powerful debuffs.\n\n" +
                "Traits like Blind Spot, Back Targeting, and Adjacent Lanes\n" +
                "change how a unit plays its role."
            ));
            return;
        }

        if (label === 'Gameplay') {
            this.sectionText.setText(t('HELP_TEXT_GAMEPLAY',
                "Protodice is a strategic tower defense dice game.\n\n" +
                "• Take turns: one side plays Defence, the other Monsters.\n" +
                "• Roll dice to summon units from your loadout.\n" +
                "• Defences protect the left; Monsters attack from the right.\n" +
                "• Units attack automatically based on stats each wave.\n\n" +
                "Dice system:\n" +
                "• Roll 1-5: Summon that loadout slot.\n" +
                "• Roll 6: Reroll for a Prototype unit."
            ));
            return;
        }

        if (label === 'Wincon') {
            this.sectionText.setText(t('HELP_TEXT_WINCON',
                "Defence wins by surviving all waves.\n" +
                "Monsters win by breaking through to the far left.\n\n" +
                "Survive, hold the line, and manage your economy to outlast.\n" +
                "Or overwhelm the lanes to punch through the defenders."
            ));
            return;
        }

        if (label === 'Classes') {
            const text = this._getClassesHelpText();
            this.sectionText.setText(text);
        }
    }

    _getFallbackClassRows() {
        return [
            { Faction: 'Defence', Class: 'Artillery', PrimaryRole: 'Long-ranged splash units', IdealPlacement: 'Backline', Weaknesses: 'Blind spot and early pressure' },
            { Faction: 'Defence', Class: 'Bruiser', PrimaryRole: 'High health and high damage close range', IdealPlacement: 'Frontline', Weaknesses: 'Kited by range' },
            { Faction: 'Defence', Class: 'Control', PrimaryRole: 'Debuff and stall', IdealPlacement: 'Mid/Backline', Weaknesses: 'Low burst' },
            { Faction: 'Defence', Class: 'Damage Dealer', PrimaryRole: 'High sustained or burst damage', IdealPlacement: 'Midline', Weaknesses: 'Needs protection' },
            { Faction: 'Defence', Class: 'Finisher', PrimaryRole: 'Removes key threats after charge-up', IdealPlacement: 'Backline', Weaknesses: 'Slow setup' },
            { Faction: 'Defence', Class: 'Generalist', PrimaryRole: 'Versatile all-rounder', IdealPlacement: 'Midline', Weaknesses: 'Not best at one role' },
            { Faction: 'Defence', Class: 'Hybrid', PrimaryRole: 'Combines multiple roles', IdealPlacement: 'Varies', Weaknesses: 'Needs correct placement' },
            { Faction: 'Defence', Class: 'Support', PrimaryRole: 'Buffs or heals allies', IdealPlacement: 'Backline', Weaknesses: 'Low damage' },
            { Faction: 'Defence', Class: 'Tank', PrimaryRole: 'High health with low damage', IdealPlacement: 'Frontline', Weaknesses: 'Low kill pressure' },
            { Faction: 'Monster', Class: 'Artillery', PrimaryRole: 'Long-ranged splash units', IdealPlacement: 'Backline', Weaknesses: 'Low HP and pressure' },
            { Faction: 'Monster', Class: 'Bruiser', PrimaryRole: 'High health with moderate or high damage', IdealPlacement: 'Frontline', Weaknesses: 'Kited by range' },
            { Faction: 'Monster', Class: 'Control', PrimaryRole: 'Debuff and stall', IdealPlacement: 'Midline', Weaknesses: 'Lower damage' },
            { Faction: 'Monster', Class: 'Damage Dealer', PrimaryRole: 'High sustained or burst damage', IdealPlacement: 'Midline', Weaknesses: 'Needs cover' },
            { Faction: 'Monster', Class: 'Hybrid', PrimaryRole: 'Combines multiple roles', IdealPlacement: 'Midline', Weaknesses: 'Needs support' },
            { Faction: 'Monster', Class: 'Skirmisher', PrimaryRole: 'Fast movement pressure', IdealPlacement: 'Frontline', Weaknesses: 'Fragile' },
            { Faction: 'Monster', Class: 'Swarm', PrimaryRole: 'High quantity pressure', IdealPlacement: 'Frontline', Weaknesses: 'Weak to AoE' },
            { Faction: 'Monster', Class: 'Siege', PrimaryRole: 'Very long range heavy hits', IdealPlacement: 'Backline', Weaknesses: 'Slow' },
            { Faction: 'Monster', Class: 'Support', PrimaryRole: 'Buffs or heals allies', IdealPlacement: 'Midline', Weaknesses: 'Low DPS' },
            { Faction: 'Monster', Class: 'Summoner', PrimaryRole: 'Spawns units for overtime pressure', IdealPlacement: 'Midline', Weaknesses: 'Vulnerable if focused' },
            { Faction: 'Monster', Class: 'Tank', PrimaryRole: 'High health with low damage', IdealPlacement: 'Frontline', Weaknesses: 'Low kill pressure' }
        ];
    }

    _parseClassCsv(text) {
        if (!text) return [];
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (!lines.length) return [];
        const headers = lines[0].split(',').map(h => h.trim());
        return lines.slice(1).map(line => {
            const parts = line.split(',').map(p => p.trim());
            const row = {};
            headers.forEach((h, i) => {
                row[h] = parts[i] || '';
            });
            return row;
        });
    }

    _loadClassTemplate() {
        fetch('config/class_performance_template.csv')
            .then(res => res.ok ? res.text() : '')
            .then(text => {
                const parsed = this._parseClassCsv(text);
                this._classRows = parsed.length ? parsed : this._getFallbackClassRows();
                if (this._activeSection === 'Classes') this._setSection('Classes');
            })
            .catch(() => {
                this._classRows = this._getFallbackClassRows();
                if (this._activeSection === 'Classes') this._setSection('Classes');
            });
    }

    _getClassesHelpText() {
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const rows = Array.isArray(this._classRows) && this._classRows.length
            ? this._classRows
            : this._getFallbackClassRows();

        const formatRow = (r) => {
            const weaknessLabel = t('HELP_WEAKNESS', 'Weak');
            const weakness = r.Weaknesses ? ` — ${weaknessLabel}: ${r.Weaknesses}` : '';
            return `• ${r.Class}: ${r.PrimaryRole} (${r.IdealPlacement})${weakness}`;
        };
        const defRows = rows.filter(r => r.Faction === 'Defence');
        const monRows = rows.filter(r => r.Faction === 'Monster');

        const defText = defRows.map(formatRow).join('\n');
        const monText = monRows.map(formatRow).join('\n');

        const defHeader = t('HELP_DEFENCE_CLASSES', 'Defence Classes');
        const monHeader = t('HELP_MONSTER_CLASSES', 'Monster Classes');
        return `${defHeader}:\n${defText}\n\n${monHeader}:\n${monText}`;
    }
}
