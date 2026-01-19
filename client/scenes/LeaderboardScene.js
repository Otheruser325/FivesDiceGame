import GlobalAudio from '../utils/AudioManager.js';
import { getServerUrl } from '../utils/SocketManager.js';
import SyncManager from '../utils/SyncManager.js';

export default class LeaderboardScene extends Phaser.Scene {
    constructor() {
        super('LeaderboardScene');
        this.currentSort = 'total';
        this.leaderboardData = [];
        this.playerRank = null;
        this.sortButtons = {};
        this.avatarSprites = [];
        this._leaderboardTimeout = null;
        this._retryCount = 0;
        this._loading = false;
        this._abortController = null;
    }

    create() {
        // Back button
        const backBtn = this.add.text(60, 40, '← Back', {
            fontSize: 28,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineMenuScene');
        });

        // Title
        this.add.text(600, 40, '🏆 Leaderboard', {
            fontSize: 48,
            color: '#ffff00',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        // Sort buttons area (smaller Y position)
        const sortY = 100;
        const sortButtons = [
            { label: 'Total Score', value: 'total', x: 200 },
            { label: 'Highest Score', value: 'highest', x: 400 },
            { label: 'Combos Rolled', value: 'combos', x: 600 },
            { label: 'Games Won', value: 'wins', x: 800 },
            { label: 'Best Combo', value: 'best', x: 1000 }
        ];

        sortButtons.forEach(btn => {
            const text = this.add.text(btn.x, sortY, btn.label, {
                fontSize: 16,
                color: this.currentSort === btn.value ? '#66ff66' : '#cccccc'
            }).setOrigin(0.5).setInteractive();

            text.on('pointerdown', () => {
                GlobalAudio.playButton(this);
                this.currentSort = btn.value;
                this.loadLeaderboard();
            });

            text.on('pointerover', () => {
                text.setColor(this.currentSort === btn.value ? '#66ff66' : '#ffff00');
            });

            text.on('pointerout', () => {
                text.setColor(this.currentSort === btn.value ? '#66ff66' : '#cccccc');
            });

            this.sortButtons[btn.value] = text;
        });

        // Container for leaderboard entries (graphics-based)
        this.leaderboardContainer = this.add.container(600, 180);

        // Loading text
        this.leaderboardText = this.add.text(600, 300, 'Loading leaderboard...', {
            fontSize: 18,
            color: '#ffffff',
            align: 'center'
        }).setOrigin(0.5);

        // Load leaderboard data from server
        this.loadLeaderboard();

        // ✅ Setup visibility change handler to refresh leaderboard when page returns from background
        SyncManager.setupVisibilityHandler(() => {
            try {
                this.loadLeaderboard();
            } catch (err) {
                console.warn('[LeaderboardScene] Failed to refresh on visibility change:', err);
            }
        });

        // Cleanup on shutdown
        this.events.once('shutdown', () => {
            if (this._leaderboardTimeout) {
                clearTimeout(this._leaderboardTimeout);
                this._leaderboardTimeout = null;
            }
            if (this._abortController) {
                this._abortController.abort();
                this._abortController = null;
            }
        });
    }



    async loadLeaderboard() {
        // Prevent multiple concurrent requests
        if (this._loading) {
            console.log('[LeaderboardScene] Already loading, skipping');
            return;
        }

        // Clear any pending timeout from previous request
        if (this._leaderboardTimeout) {
            clearTimeout(this._leaderboardTimeout);
            this._leaderboardTimeout = null;
        }

        // Reset retry count
        this._retryCount = 0;

        // Create abort controller for this request
        this._abortController = new AbortController();

        // Validate text object exists
        if (!this.leaderboardText) {
            console.error('[LeaderboardScene] leaderboardText is not initialized');
            return;
        }

        console.log('[LeaderboardScene] loadLeaderboard() called');

        // Fetch leaderboard data via HTTP
        this._fetchLeaderboard();
    }

    _updateLeaderboardText(text) {
        try {
            if (this.leaderboardText) {
                this.leaderboardText.setText(text);
            }
        } catch (err) {
            console.warn('[LeaderboardScene] Failed to update leaderboard text:', err?.message);
        }
    }

    async _fetchLeaderboard() {
        this._loading = true;

        // Disable sort buttons while loading
        Object.values(this.sortButtons).forEach(btn => {
            if (btn && btn.disableInteractive) btn.disableInteractive();
        });

        console.log('[LeaderboardScene] Fetching leaderboard, sort:', this.currentSort);
        this._updateLeaderboardText('Loading...');

        try {
            const server = getServerUrl();
            const url = `${server.replace(/\/$/, '')}/leaderboard?sortBy=${this.currentSort}`;

            const response = await fetch(url, { credentials: 'include', signal: this._abortController.signal });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            console.log('[LeaderboardScene] Received leaderboard data:', data);
            this.leaderboardData = data.topPlayers || [];
            this.playerRank = data.playerRank || null;
            this.displayLeaderboard();

            // Update button colors
            Object.keys(this.sortButtons).forEach(key => {
                const btn = this.sortButtons[key];
                if (btn && btn.setColor) {
                    btn.setColor(this.currentSort === key ? '#66ff66' : '#cccccc');
                }
            });

        } catch (err) {
            // Don't log or retry on abort
            if (err.name === 'AbortError') {
                console.log('[LeaderboardScene] Fetch aborted');
                return;
            }

            console.error('[LeaderboardScene] Error fetching leaderboard:', err);

            // Retry once after 3 seconds
            if (this._retryCount < 1) {
                this._retryCount++;
                this._leaderboardTimeout = setTimeout(() => {
                    if (!this.leaderboardData.length) {
                        console.warn('[LeaderboardScene] Leaderboard fetch failed, retrying...');
                        this._fetchLeaderboard();
                    }
                }, 3000);
            } else {
                this._updateLeaderboardText('Failed to load leaderboard.\nPlease try again.');
            }
        } finally {
            this._loading = false;
            // Re-enable sort buttons
            Object.values(this.sortButtons).forEach(btn => {
                if (btn && btn.setInteractive) btn.setInteractive();
            });
        }
    }

    displayLeaderboard() {
        if (!this.leaderboardData || this.leaderboardData.length === 0) {
            this._updateLeaderboardText('No leaderboard data available.\nPlay some games first!');
            return;
        }

        // Clear previous container
        if (this.leaderboardContainer) {
            this.leaderboardContainer.removeAll(true);
        }
        this.avatarSprites = [];
        this._updateLeaderboardText('');

        // Rank colors for top 3
        const rankColors = {
            1: '#ffd700', // Gold
            2: '#c0c0c0', // Silver
            3: '#cd7f32'  // Bronze
        };

        let yOffset = 0;
        const lineHeight = 90; // Heavily spaced entries
        const screenWidth = 1200;

        // Header (heavy spacing)
        const headerY = yOffset;
        yOffset += 40;

        // Entry label
        let headerLabel = '';
        switch (this.currentSort) {
            case 'total':
                headerLabel = 'Total Score';
                break;
            case 'highest':
                headerLabel = 'Highest Score';
                break;
            case 'combos':
                headerLabel = 'Total Combos';
                break;
            case 'wins':
                headerLabel = 'Games Won';
                break;
            case 'best':
                headerLabel = 'Best Combo';
                break;
        }

        // Column headers with heavy spacing
        const headerText = this.add.text(0, headerY, `RANK    PLAYER                    ${headerLabel}`, {
            fontSize: 16,
            color: '#cccccc',
            fontFamily: 'monospace'
        }).setOrigin(0, 0);
        this.leaderboardContainer.add(headerText);

        // Separator
        const sepText = this.add.text(0, headerY + 25, '─────────────────────────────────────────', {
            fontSize: 14,
            color: '#666666',
            fontFamily: 'monospace'
        }).setOrigin(0, 0);
        this.leaderboardContainer.add(sepText);

        yOffset += 45;

        // Render each player entry
        this.leaderboardData.slice(0, 10).forEach((player, idx) => {
            const rank = idx + 1;
            const rankColor = rankColors[rank] || '#ffffff';

            // Row background
            const graphics = this.make.graphics({ x: 0, y: yOffset - 10, add: false });
            graphics.fillStyle(0x222222, 0.5);
            graphics.fillRect(0, 0, screenWidth, lineHeight - 10);
            this.leaderboardContainer.add(graphics);

            // Rank with medal emoji for top 3
            let rankDisplay = rank.toString().padStart(2, ' ');
            if (rank === 1) rankDisplay = '1st';
            else if (rank === 2) rankDisplay = '2nd';
            else if (rank === 3) rankDisplay = '3rd';
            else rankDisplay = rank + 'th';

            const rankText = this.add.text(-280, yOffset + 15, rankDisplay, {
                fontSize: 20,
                color: rankColor,
                fontStyle: 'bold',
                fontFamily: 'monospace'
            }).setOrigin(1, 0);
            this.leaderboardContainer.add(rankText);

            // Avatar (64x64) - display OAuth avatar, guest icon, or fallback
            const avatarX = -220;
            const avatarY = yOffset + 5;

            // Try to load avatar image (OAuth only)
            if (player.avatar && typeof player.avatar === 'string' && player.avatar.length > 0) {
                try {
                    const avatar = this.add.image(avatarX, avatarY, null);

                    // Load avatar from URL
                    const uniqueKey = `avatar_${player.id}_${Date.now()}`;
                    const img = new Image();
                    img.onload = () => {
                        try {
                            this.textures.addImage(uniqueKey, img);
                            avatar.setTexture(uniqueKey);
                            avatar.setDisplaySize(64, 64);
                        } catch (loadErr) {
                            console.warn(`[LeaderboardScene] Failed to set avatar texture: ${loadErr.message}`);
                            // Fall through to fallback below
                        }
                    };
                    img.onerror = () => {
                        console.warn(`[LeaderboardScene] Failed to load avatar from ${player.avatar}`);
                        // Fall through to fallback below
                    };
                    img.src = player.avatar;
                    this.leaderboardContainer.add(avatar);
                } catch (e) {
                    console.warn(`[LeaderboardScene] Avatar setup failed: ${e.message}`);
                    // Fall through to fallback
                }
            } else if (player.type === 'guest') {
                // Use preloaded playerIcon for guests
                const avatar = this.add.image(avatarX, avatarY, 'playerIcon');
                avatar.setDisplaySize(64, 64);
                this.leaderboardContainer.add(avatar);
            } else {
                // Fallback: colored circle with type indicator for other types without avatar
                const circle = this.make.graphics({ x: avatarX, y: avatarY, add: false });
                const typeColor = player.type === 'discord' ? 0x7289da :
                                  player.type === 'google' ? 0x4285f4 :
                                  0x666666;
                circle.fillStyle(typeColor, 1);
                circle.fillCircle(32, 32, 32);

                // Add icon text for type indicator
                const typeEmoji = player.type === 'discord' ? '🎮' :
                                  player.type === 'google' ? '🔵' :
                                  '•';
                const emojiText = this.add.text(avatarX + 32, avatarY + 32, typeEmoji, {
                    fontSize: 24,
                    color: '#ffffff'
                }).setOrigin(0.5);
                this.leaderboardContainer.add(emojiText);
                this.leaderboardContainer.add(circle);
            }

            // Player name and country flag
            const playerName = (player.name || 'Unknown').substring(0, 20);
            const countryFlag = player.countryFlag || '🌍';
            const nameText = this.add.text(-150, yOffset + 20, `${countryFlag} ${playerName}`, {
                fontSize: 18,
                color: '#ffffff',
                fontStyle: 'bold'
            }).setOrigin(0, 0);
            this.leaderboardContainer.add(nameText);

            // Stat value (right-aligned)
            let statValue = '';
            switch (this.currentSort) {
                case 'total':
                    statValue = (player.totalScore || 0).toString();
                    break;
                case 'highest':
                    statValue = (player.highestScore || 0).toString();
                    break;
                case 'combos':
                    statValue = (player.totalCombosRolled || 0).toString();
                    break;
                case 'wins':
                    statValue = (player.gamesWon || 0).toString();
                    break;
                case 'best':
                    // Get best combo category
                    const bestCombo = this._getBestComboForPlayer(player);
                    statValue = `${bestCombo.count}x ${bestCombo.name}`;
                    break;
            }

            const valueText = this.add.text(260, yOffset + 20, statValue, {
                fontSize: 18,
                color: '#ffff66',
                fontStyle: 'bold',
                fontFamily: 'monospace'
            }).setOrigin(1, 0);
            this.leaderboardContainer.add(valueText);

            yOffset += lineHeight;
        });

        // Player's own rank section
        if (this.playerRank) {
            yOffset += 20;
            const playerRankColor = rankColors[this.playerRank.rank] || '#ffff66';
            
            const yourRankText = this.add.text(0, yOffset, '─────────────────────────────────────────', {
                fontSize: 14,
                color: '#666666',
                fontFamily: 'monospace'
            }).setOrigin(0, 0);
            this.leaderboardContainer.add(yourRankText);

            yOffset += 25;
            const yourRankLabel = this.add.text(0, yOffset, `YOUR RANK: #${this.playerRank.rank} of ${this.playerRank.totalPlayers}`, {
                fontSize: 16,
                color: playerRankColor,
                fontStyle: 'bold'
            }).setOrigin(0, 0);
            this.leaderboardContainer.add(yourRankLabel);

            yOffset += 30;
            const statsInfo = this.add.text(0, yOffset, 
                `Total: ${this.playerRank.totalScore} pts | Played: ${this.playerRank.totalGamesPlayed} | Best: ${this.playerRank.highestScore} pts`,
                {
                    fontSize: 14,
                    color: '#cccccc'
                }).setOrigin(0, 0);
            this.leaderboardContainer.add(statsInfo);
        }
    }

    /**
     * Get the best combo for a player based on ranking hierarchy
     * Five-of-a-Kind > Four-of-a-Kind > Full House > Straight > Triple > Two Pair > Pair
     */
    _getBestComboForPlayer(player) {
        const combos = player.comboStats || {};
        
        const comboHierarchy = [
            { key: 'fiveOfAKind', name: 'Five-of-a-Kind' },
            { key: 'fourOfAKind', name: 'Four-of-a-Kind' },
            { key: 'fullHouse', name: 'Full House' },
            { key: 'straight', name: 'Straight' },
            { key: 'triple', name: 'Triple' },
            { key: 'twoPair', name: 'Two Pair' },
            { key: 'pair', name: 'Pair' }
        ];

        for (const combo of comboHierarchy) {
            if (combos[combo.key] && combos[combo.key] > 0) {
                return {
                    name: combo.name,
                    count: combos[combo.key]
                };
            }
        }

        return { name: 'None', count: 0 };
    }
}
