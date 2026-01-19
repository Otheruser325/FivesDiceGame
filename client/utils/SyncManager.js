import { getSocket } from './SocketManager.js';

/**
 * SyncManager - Handles game state synchronization with the server
 * Useful for recovering from background/foreground transitions or connection issues
 */
class SyncManager {
  /**
   * Request fresh game state from server
   * @param {string} roomCode - Game room code
   * @returns {Promise<Object>} Current game state from server
   */
  static async refreshGameState(roomCode) {
    return new Promise((resolve, reject) => {
      const socket = getSocket();
      if (!socket || !socket.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      if (!roomCode || typeof roomCode !== 'string') {
        reject(new Error('Invalid room code'));
        return;
      }

      console.log(`[SyncManager] Requesting fresh game state for room ${roomCode}`);

      // Set up one-time listener for game state response
      const timeoutId = setTimeout(() => {
        socket.off('game-state', stateHandler);
        reject(new Error('Game state request timeout'));
      }, 5000);

      const stateHandler = (data) => {
        clearTimeout(timeoutId);
        socket.off('game-state', stateHandler);
        
        if (data && data.room === roomCode) {
          console.log('[SyncManager] ✅ Received fresh game state');
          resolve(data);
        }
      };

      socket.on('game-state', stateHandler);

      // Request the latest game state
      socket.emit('request-game-state', { code: roomCode });
    });
  }

  /**
   * Request fresh leaderboard data
   * @param {string} sortBy - Sort metric ('total', 'highest', 'combos', 'wins', 'best')
   * @returns {Promise<Object>} Leaderboard data with topPlayers and playerRank
   */
  static async refreshLeaderboard(sortBy = 'total') {
    return new Promise((resolve, reject) => {
      const socket = getSocket();
      if (!socket || !socket.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      console.log(`[SyncManager] Requesting fresh leaderboard (sortBy=${sortBy})`);

      // Set up one-time listener for leaderboard response
      const timeoutId = setTimeout(() => {
        socket.off('leaderboard-data', dataHandler);
        socket.off('leaderboard-error', errorHandler);
        reject(new Error('Leaderboard request timeout'));
      }, 5000);

      const dataHandler = (data) => {
        clearTimeout(timeoutId);
        socket.off('leaderboard-data', dataHandler);
        socket.off('leaderboard-error', errorHandler);
        console.log('[SyncManager] ✅ Received fresh leaderboard data');
        resolve(data);
      };

      const errorHandler = (error) => {
        clearTimeout(timeoutId);
        socket.off('leaderboard-data', dataHandler);
        socket.off('leaderboard-error', errorHandler);
        reject(new Error(error));
      };

      socket.once('leaderboard-data', dataHandler);
      socket.once('leaderboard-error', errorHandler);

      // Request the latest leaderboard
      socket.emit('get-leaderboard', { sortBy });
    });
  }

  /**
   * Request fresh lobby data
   * @param {string} lobbyCode - Lobby code
   * @returns {Promise<Object>} Current lobby data
   */
  static async refreshLobby(lobbyCode) {
    return new Promise((resolve, reject) => {
      const socket = getSocket();
      if (!socket || !socket.connected) {
        reject(new Error('Socket not connected'));
        return;
      }

      if (!lobbyCode || typeof lobbyCode !== 'string') {
        reject(new Error('Invalid lobby code'));
        return;
      }

      console.log(`[SyncManager] Requesting fresh lobby data for ${lobbyCode}`);

      // Set up one-time listener for lobby response
      const timeoutId = setTimeout(() => {
        socket.off('lobby-data', dataHandler);
        reject(new Error('Lobby data request timeout'));
      }, 5000);

      const dataHandler = (data) => {
        clearTimeout(timeoutId);
        socket.off('lobby-data', dataHandler);
        
        if (data && data.code === lobbyCode) {
          console.log('[SyncManager] ✅ Received fresh lobby data');
          resolve(data);
        }
      };

      socket.on('lobby-data', dataHandler);

      // Request the latest lobby data
      socket.emit('request-lobby-data', lobbyCode);
    });
  }

  /**
   * Set up visibility change handler to sync when page becomes visible
   * @param {Function} onVisibilityChange - Callback when visibility changes
   */
  static setupVisibilityHandler(onVisibilityChange) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('[SyncManager] Page hidden - pausing updates');
      } else {
        console.log('[SyncManager] Page visible - triggering sync');
        if (typeof onVisibilityChange === 'function') {
          onVisibilityChange();
        }
      }
    });
  }

  /**
   * Perform a full sync of all game/lobby data
   * Useful after extended background time
   * @param {Object} options - Sync options
   * @param {string} options.roomCode - Game room code (optional)
   * @param {string} options.lobbyCode - Lobby code (optional)
   * @param {Function} options.onSuccess - Callback on successful sync
   * @param {Function} options.onError - Callback on sync error
   */
  static async fullSync(options = {}) {
    const { roomCode, lobbyCode, onSuccess, onError } = options;
    
    console.log('[SyncManager] Starting full sync...');
    const results = {};

    try {
      // Sync game state if in a game
      if (roomCode) {
        try {
          results.gameState = await this.refreshGameState(roomCode);
        } catch (err) {
          console.warn('[SyncManager] Failed to sync game state:', err.message);
          results.gameStateError = err;
        }
      }

      // Sync lobby data if in a lobby
      if (lobbyCode) {
        try {
          results.lobbyData = await this.refreshLobby(lobbyCode);
        } catch (err) {
          console.warn('[SyncManager] Failed to sync lobby data:', err.message);
          results.lobbyDataError = err;
        }
      }

      console.log('[SyncManager] ✅ Full sync complete', results);
      if (typeof onSuccess === 'function') {
        onSuccess(results);
      }
      return results;
    } catch (err) {
      console.error('[SyncManager] Full sync failed:', err);
      if (typeof onError === 'function') {
        onError(err);
      }
      throw err;
    }
  }
}

export default SyncManager;
