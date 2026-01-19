/**
 * PlayerStateManager - Utility for consistent player state management
 * Handles:
 * - Filtering active (non-left) players
 * - Getting accurate usernames from database
 * - Reducing race conditions in player data
 * - Normalizing player objects for emission
 */

import { loadUser } from './userStorage.js';

/**
 * Get only active players (those who haven't left)
 * @param {Array} players - Array of player objects potentially with left:true flag
 * @returns {Array} Filtered array of active players
 */
export function getActivePlayers(players) {
  if (!Array.isArray(players)) return [];
  return players.filter(p => !p.left);
}

/**
 * Count active players
 * @param {Array} players - Array of player objects
 * @returns {number} Count of active players
 */
export function countActivePlayers(players) {
  return getActivePlayers(players).length;
}

/**
 * Get username from database by user ID
 * Falls back to socket.data.user.name if DB unavailable, then generates fallback
 * @param {string} userId - User ID to look up
 * @param {Object} socketUserData - Optional socket.data.user object as fallback
 * @returns {Promise<string>} Username from database or fallback
 */
export async function getUsernameFromDB(userId, socketUserData = null) {
  if (!userId) return 'Unknown Player';
  
  try {
    // First try to get from database
    const user = await loadUser(userId);
    if (user && user.name) {
      return user.name;
    }
  } catch (err) {
    console.warn(`[playerStateManager] Failed to load username from DB for ${userId}:`, err.message);
  }
  
  // Fallback to socket data if available
  if (socketUserData && socketUserData.name) {
    return socketUserData.name;
  }
  
  // Last resort: use a generic name (should be rare with DB lookup)
  return `Player${userId.substring(0, 6)}`;
}

/**
 * Normalize a player object for emission to clients
 * Ensures consistent shape and uses DB usernames
 * @param {Object} player - Raw player object from lobby
 * @param {Object} socketDataUser - Optional socket.data.user for fallback
 * @returns {Promise<Object>} Normalized player object
 */
export async function normalizePlayer(player, socketDataUser = null) {
  if (!player) return null;
  
  const username = await getUsernameFromDB(player.uid || player.id, socketDataUser);
  
  return {
    id: player.uid || player.id,
    uid: player.uid || player.id,
    name: username,
    socketId: player.socketid || player.socketId,
    team: player.team || null,
    ready: player.ready || false,
    left: player.left || false,
    // Preserve any other fields that might be needed
    ...Object.keys(player)
      .filter(k => !['uid', 'id', 'socketid', 'socketId', 'name'].includes(k))
      .reduce((acc, k) => ({ ...acc, [k]: player[k] }), {})
  };
}

/**
 * Normalize all players in a lobby for safe emission
 * Filters out left players and ensures accurate usernames
 * @param {Array} players - Array of raw player objects
 * @param {Map} socketDataMap - Optional map of userId -> socket.data.user for fallback
 * @returns {Promise<Array>} Array of normalized active players
 */
export async function normalizeAllPlayers(players, socketDataMap = null) {
  if (!Array.isArray(players)) return [];
  
  // Get only active players
  const activePlayers = getActivePlayers(players);
  
  // Normalize each player with DB lookups
  const normalized = await Promise.all(
    activePlayers.map(p => {
      const socketData = socketDataMap ? socketDataMap.get(p.uid || p.id) : null;
      return normalizePlayer(p, socketData);
    })
  );
  
  return normalized;
}

/**
 * Calculate empty slots for display
 * Takes into account number of active players vs max capacity
 * @param {number} activePlayers - Number of active players
 * @param {number} maxSlots - Max players allowed (default 4)
 * @returns {number} Number of empty slots
 */
export function calculateEmptySlots(activePlayers, maxSlots = 4) {
  const empty = maxSlots - activePlayers;
  return Math.max(0, empty);
}

/**
 * Get display status for a lobby
 * @param {Array} players - Array of all players (including left)
 * @param {number} maxSlots - Max slots in lobby (default 4)
 * @returns {Object} Status object with counts and display string
 */
export function getLobbyStatus(players, maxSlots = 4) {
  const activePlayers = getActivePlayers(players);
  const activeCount = activePlayers.length;
  const emptySlots = calculateEmptySlots(activeCount, maxSlots);
  
  return {
    active: activeCount,
    empty: emptySlots,
    total: maxSlots,
    isFull: emptySlots === 0,
    displayText: `${activeCount}/${maxSlots} Players`
  };
}

export default {
  getActivePlayers,
  countActivePlayers,
  getUsernameFromDB,
  normalizePlayer,
  normalizeAllPlayers,
  calculateEmptySlots,
  getLobbyStatus
};
