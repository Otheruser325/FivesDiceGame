/**
 * LeaderboardManager - Tracks and manages player statistics for online games only
 * Statistics tracked:
 * - Total games played
 * - Total score across all games
 * - Highest single-game score
 * - Total combos rolled
 * - Best combo: Five-of-a-Kind count (lifetime)
 * - Games won
 * - Combo breakdown by type
 * 
 * Note: Does NOT track singleplayer/local games
 */

import { loadUser, saveUser, loadUsers } from './userStorage.js';

const COMBO_CATEGORIES = {
  TRIPLE: 'triple',              // Three of a kind
  FOUR_OF_A_KIND: 'fourOfAKind', // Four of a kind
  FULL_HOUSE: 'fullHouse',       // Three + pair
  STRAIGHT: 'straight',          // 1-2-3-4-5 or 2-3-4-5-6
  PAIR: 'pair',                  // One pair
  TWO_PAIR: 'twoPair',           // Two pairs
  FIVE_OF_A_KIND: 'fiveOfAKind', // Five of a kind (the best!)
};

export class LeaderboardManager {
  /**
   * Initialize player leaderboard entry if it doesn't exist
   * @param {string} userId - User ID
   * @param {Object} user - User object from database
   * @returns {Promise<Object>} User object with initialized leaderboard stats
   */
  static async initializeStats(userId, user = null) {
    if (!userId) return null;
    
    const playerUser = user || await loadUser(userId);
    if (!playerUser) {
      console.warn(`[LeaderboardManager] User not found: ${userId}`);
      return null;
    }

    // Initialize leaderboard if missing
    if (!playerUser.leaderboard) {
      playerUser.leaderboard = {
        totalGamesPlayed: 0,
        totalScore: 0,
        highestScore: 0,
        gamesWon: 0,
        totalCombosRolled: 0,
        fiveOfAKindCount: 0,      // ✅ Best combo: Five-of-a-Kind tracking
        comboStats: {
          triple: 0,
          fourOfAKind: 0,
          fullHouse: 0,
          straight: 0,
          pair: 0,
          twoPair: 0,
          fiveOfAKind: 0
        },
        lastPlayedAt: null,
        createdAt: new Date().toISOString()
      };
      
      await saveUser(playerUser);
    }

    return playerUser;
  }

  /**
   * Update player stats after game completion
   * @param {string} userId - User ID
   * @param {number} finalScore - Player's final score in the game
   * @param {boolean} won - Whether player won
   * @param {Array|Object} combosInGame - Array of combos OR comboStats dictionary from game
   * @returns {Promise<void>}
   */
  static async updatePlayerStats(userId, finalScore, won, combosInGame = []) {
    if (!userId) {
      console.warn('[LeaderboardManager] No userId provided');
      return;
    }

    try {
      const player = await this.initializeStats(userId);
      if (!player || !player.leaderboard) {
        console.warn(`[LeaderboardManager] Could not initialize stats for ${userId}`);
        return;
      }

      const lb = player.leaderboard;

      // Update basic stats
      lb.totalGamesPlayed = (lb.totalGamesPlayed || 0) + 1;
      lb.totalScore = (lb.totalScore || 0) + (finalScore || 0);
      lb.highestScore = Math.max(lb.highestScore || 0, finalScore || 0);
      if (won) lb.gamesWon = (lb.gamesWon || 0) + 1;
      lb.lastPlayedAt = new Date().toISOString();

      // Update combo statistics
      // ✅ Handle both: array of combo objects OR comboStats dictionary
      if (combosInGame) {
        if (Array.isArray(combosInGame)) {
          // Combo objects array format: [{name, score, ...}, ...]
          lb.totalCombosRolled = (lb.totalCombosRolled || 0) + combosInGame.length;
          
          for (const combo of combosInGame) {
            const category = this._categorizeCombo(combo);
            if (category && lb.comboStats[category] !== undefined) {
              lb.comboStats[category] = (lb.comboStats[category] || 0) + 1;
              
              // ✅ Track Five-of-a-Kind as the best combo
              if (category === COMBO_CATEGORIES.FIVE_OF_A_KIND) {
                lb.fiveOfAKindCount = (lb.fiveOfAKindCount || 0) + 1;
              }
            }
          }
        } else if (typeof combosInGame === 'object') {
          // ComboStats dictionary format: {pair: 0, triple: 1, fiveOfAKind: 2, ...}
          const totalCombos = Object.values(combosInGame).reduce((sum, v) => sum + (v || 0), 0);
          lb.totalCombosRolled = (lb.totalCombosRolled || 0) + totalCombos;
          
          // Merge comboStats directly
          for (const [key, count] of Object.entries(combosInGame)) {
            if (lb.comboStats[key] !== undefined) {
              lb.comboStats[key] = (lb.comboStats[key] || 0) + (count || 0);
              
              // ✅ Track Five-of-a-Kind as the best combo
              if (key === COMBO_CATEGORIES.FIVE_OF_A_KIND && count > 0) {
                lb.fiveOfAKindCount = (lb.fiveOfAKindCount || 0) + count;
              }
            }
          }
        }
      }

      // Save updated stats
      await saveUser(player);
      const comboCount = Array.isArray(combosInGame) 
        ? combosInGame.length 
        : (combosInGame ? Object.values(combosInGame).reduce((sum, v) => sum + (v || 0), 0) : 0);
      console.log(`[LeaderboardManager] Updated stats for ${userId}: +${finalScore} pts, combos: ${comboCount}`);
    } catch (err) {
      console.error(`[LeaderboardManager] Failed to update stats for ${userId}:`, err.message);
    }
  }

  /**
   * Get formatted leaderboard for top N players
   * @param {number} limit - Number of top players to return (default: 10)
   * @param {string} sortBy - Sort key: 'total', 'highest', 'combos', 'wins', 'best'
   * @returns {Promise<Array>} Array of top players with formatted stats
   */
  static async getTopPlayers(limit = 10, sortBy = 'total') {
    try {
      const allUsers = await loadUsers();
      
      // ✅ FIX: Convert object map to array if needed
      // loadUsers() returns object map {userId: user, userId2: user2, ...} not an array
      let userArray = [];
      if (Array.isArray(allUsers)) {
        userArray = allUsers;
      } else if (typeof allUsers === 'object' && allUsers !== null) {
        userArray = Object.values(allUsers);
      } else {
        console.warn('[LeaderboardManager] Invalid users format, expected object or array');
        return [];
      }

      if (userArray.length === 0) {
        console.info('[LeaderboardManager] No users in database');
        return [];
      }

      // ✅ FIX: Filter users with leaderboard data and map to leaderboard entries
      const leaderboardEntries = userArray
        .filter(u => {
          // Only include players with leaderboard data and at least 1 game played
          if (!u || !u.leaderboard) {
            return false;
          }
          if (u.leaderboard.totalGamesPlayed <= 0) {
            return false;
          }
          return true;
        })
        .map(u => {
          // ✅ ENHANCED: Include avatar from user profile
          return {
            id: u.id,
            name: u.name || u.username || `User${u.id.substring(0, 6)}`,
            avatar: u.avatar || null,  // Google/Discord OAuth avatar or null
            country: u.country || null,
            countryFlag: u.countryFlag || this._getCountryFlag(u.country),
            type: u.type || 'guest',  // Track user type for UI
            ...u.leaderboard
          };
        });

      console.log(`[LeaderboardManager] Found ${leaderboardEntries.length} players with stats`);

      // Sort based on requested metric
      const sorted = this._sortLeaderboard(leaderboardEntries, sortBy);

      // Return top N with rankings
      return sorted.slice(0, limit).map((entry, idx) => ({
        rank: idx + 1,
        ...entry
      }));
    } catch (err) {
      console.error('[LeaderboardManager] Failed to get top players:', err.message || err);
      console.error('[LeaderboardManager] Stack:', err.stack);
      return [];
    }
  }

  /**
   * Get specific player's rank and stats
   * @param {string} userId - User ID
   * @param {string} sortBy - Sort key for ranking
   * @returns {Promise<Object>} Player's rank info and stats
   */
  static async getPlayerRank(userId, sortBy = 'total') {
    try {
      const topPlayers = await this.getTopPlayers(10000, sortBy);
      const playerEntry = topPlayers.find(p => p.id === userId);

      if (!playerEntry) {
        return null;
      }

      return {
        rank: playerEntry.rank,
        totalPlayers: topPlayers.length,
        ...playerEntry
      };
    } catch (err) {
      console.error('[LeaderboardManager] Failed to get player rank:', err.message);
      return null;
    }
  }

  /**
   * Get combo statistics for display
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Formatted combo stats with human-readable names
   */
  static async getComboStats(userId) {
    try {
      const player = await loadUser(userId);
      if (!player || !player.leaderboard || !player.leaderboard.comboStats) {
        return null;
      }

      const stats = player.leaderboard.comboStats;
      return {
        totalCombos: player.leaderboard.totalCombosRolled,
        fiveOfAKindCount: player.leaderboard.fiveOfAKindCount || 0,
        breakdown: {
          'Triple (3oaK)': stats.triple || 0,
          'Full House': stats.fullHouse || 0,
          'Four of a Kind': stats.fourOfAKind || 0,
          'Five of a Kind (Best!)': stats.fiveOfAKind || 0,
          'Straight': stats.straight || 0,
          'Pair': stats.pair || 0,
          'Two Pair': stats.twoPair || 0
        }
      };
    } catch (err) {
      console.error('[LeaderboardManager] Failed to get combo stats:', err.message);
      return null;
    }
  }

  /**
   * Private helper: Categorize a combo into a category
   * @private
   */
  static _categorizeCombo(combo) {
    // combo object format: { name: string, score: number, ... }
    if (!combo || !combo.name) return null;

    const name = combo.name.toUpperCase();
    
    if (name.includes('FIVE OF A KIND') || name.includes('FIVE')) return COMBO_CATEGORIES.FIVE_OF_A_KIND;
    if (name.includes('FOUR') && name.includes('KIND')) return COMBO_CATEGORIES.FOUR_OF_A_KIND;
    if (name.includes('FULL') && name.includes('HOUSE')) return COMBO_CATEGORIES.FULL_HOUSE;
    if (name.includes('THREE') || name.includes('TRIPLE')) return COMBO_CATEGORIES.TRIPLE;
    if (name.includes('STRAIGHT')) return COMBO_CATEGORIES.STRAIGHT;
    if (name.includes('TWO PAIR')) return COMBO_CATEGORIES.TWO_PAIR;
    if (name.includes('PAIR')) return COMBO_CATEGORIES.PAIR;
    
    return null;
  }

  /**
   * Get best combo score for a player (by hierarchy with weighted scoring)
   * Returns a weighted score where higher hierarchy combos have exponentially higher weights
   * This ensures Four-of-a-Kind always beats Full House, regardless of counts
   * Hierarchy: Five-of-a-Kind > Four-of-a-Kind > Full House > Straight > Triple > Two Pair > Pair
   * @private
   */
  static _getBestComboScore(player) {
    const stats = player.comboStats || {};
    
    // Assign exponentially higher weights to better combos
    // Weight * count ensures rank hierarchy is maintained
    // Example: 1x Four-of-a-Kind (100K) > 100x Full House (1M) is impossible because:
    // 1x Four-of-a-Kind = 1 * 100000 = 100000
    // 100x Full House = 100 * 10000 = 1000000 (higher wins)
    // Wait, that's wrong. Let me recalculate:
    // The weights should be such that even 1x of higher combo > any count of lower combo
    // 1x Four-of-a-Kind should beat 999x Full House
    // So: 1 * 100000 (100K) vs 999 * 10000 (9.99M) - this fails!
    // Solution: Use additive weighting where the combo TYPE determines ranking
    // Not count-based, but type-based ranking
    const hierarchy = [
      { key: 'fiveOfAKind', rank: 7 },      // Best
      { key: 'fourOfAKind', rank: 6 },
      { key: 'fullHouse', rank: 5 },
      { key: 'straight', rank: 4 },
      { key: 'triple', rank: 3 },
      { key: 'twoPair', rank: 2 },
      { key: 'pair', rank: 1 }               // Worst
    ];

    // Find the best combo type and return (rank * 1000000 + count)
    // This ensures rank matters first, count is tiebreaker
    for (const combo of hierarchy) {
      if (stats[combo.key] && stats[combo.key] > 0) {
        return (combo.rank * 1000000) + (stats[combo.key] || 0);
      }
    }

    return 0;
  }

  /**
   * Private helper: Sort leaderboard entries by requested metric
   * @private
   */
  static _sortLeaderboard(entries, sortBy) {
    const sorted = [...entries];
    
    switch (sortBy.toLowerCase()) {
      case 'highest':
        return sorted.sort((a, b) => (b.highestScore || 0) - (a.highestScore || 0));
      
      case 'combos':
        return sorted.sort((a, b) => (b.totalCombosRolled || 0) - (a.totalCombosRolled || 0));
      
      case 'wins':
        return sorted.sort((a, b) => (b.gamesWon || 0) - (a.gamesWon || 0));
      
      case 'best':
        // Sort by best combo hierarchy with rank-based scoring
        // Four-of-a-Kind always beats Full House, even with more Full House counts
        // Uses rank-based scoring: (rank * 1000000 + count)
        return sorted.sort((a, b) => {
          const aScore = this._getBestComboScore(a);
          const bScore = this._getBestComboScore(b);
          return bScore - aScore;
        });
      
      case 'total':
      default:
        return sorted.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    }
  }

  /**
   * Get country flag emoji
   * @private
   */
  static _getCountryFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '🌍';
    
    // Convert country code to flag emoji
    return String.fromCodePoint(
      ...countryCode.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0))
    );
  }
}

export default LeaderboardManager;
