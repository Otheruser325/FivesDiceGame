/**
 * RaceConditionHandler
 * Handles race conditions in online scenes when socket loses connection or server resets
 * This prevents UI from getting into inconsistent states due to socket state changes
 */

import { getSocket, didServerReset, resetServerResetFlag, getLastConnectionId } from './SocketManager.js';

export default class RaceConditionHandler {
  constructor(scene) {
    this.scene = scene;
    this.isShuttingDown = false;
    this.socketResetListener = null;
    this.disconnectListener = null;
  }

  /**
   * Start monitoring for socket issues (call in scene.create)
   */
  start() {
    const socket = getSocket();
    if (!socket) return;

    // Check for existing server reset
    if (didServerReset()) {
      console.warn('[RaceCondition] Server reset detected on scene init');
      resetServerResetFlag();
      this.handleServerReset();
      return;
    }

    // Listen for server resets
    this.socketResetListener = () => {
      if (!this.isShuttingDown) {
        console.warn('[RaceCondition] Server reset event detected in', this.scene.key);
        resetServerResetFlag();
        this.handleServerReset();
      }
    };
    window.addEventListener('socket-server-reset', this.socketResetListener);

    // Listen for disconnections
    this.disconnectListener = (reason) => {
      if (!this.isShuttingDown) {
        console.warn('[RaceCondition] Socket disconnected:', reason, 'in', this.scene.key);
        if (reason === 'transport error' || reason === 'ping timeout') {
          this.handleConnectionLoss(reason);
        }
      }
    };
    socket.on('disconnect', this.disconnectListener);
  }

  /**
   * Stop monitoring (call in scene shutdown)
   */
  stop() {
    this.isShuttingDown = true;
    const socket = getSocket();
    
    if (this.socketResetListener) {
      window.removeEventListener('socket-server-reset', this.socketResetListener);
      this.socketResetListener = null;
    }
    
    if (this.disconnectListener && socket) {
      socket.off('disconnect', this.disconnectListener);
      this.disconnectListener = null;
    }
  }

  /**
   * Handle server reset - override in subclasses to provide specific behavior
   */
  handleServerReset() {
    console.warn('[RaceCondition] Server reset in scene:', this.scene.key);
    
    // Generic response: show message and return to menu
    if (this.scene.add) {
      this.scene.add.text(600, 360, '⚠️ Server Reset', { fontSize: 32, color: '#ffaa00' }).setOrigin(0.5);
      this.scene.add.text(600, 400, 'Returning to menu...', { fontSize: 20, color: '#cccccc' }).setOrigin(0.5);
    }
    
    // Return to online menu after 2 seconds
    this.scene.time.delayedCall(2000, () => {
      if (!this.isShuttingDown) {
        this.scene.scene.start('OnlineMenuScene');
      }
    });
  }

  /**
   * Handle connection loss - override in subclasses
   */
  handleConnectionLoss(reason) {
    console.warn('[RaceCondition] Connection loss:', reason, 'in', this.scene.key);
    
    // Generic response: show message
    if (this.scene.add) {
      this.scene.add.text(600, 360, '⚠️ Connection Lost', { fontSize: 32, color: '#ff6666' }).setOrigin(0.5);
      this.scene.add.text(600, 400, 'Attempting to reconnect...', { fontSize: 20, color: '#cccccc' }).setOrigin(0.5);
    }
  }

  /**
   * Verify socket is still connected before making critical operations
   * Returns true if socket is connected, false if not
   */
  isSocketSafe() {
    const socket = getSocket();
    return socket && socket.connected && !didServerReset();
  }

  /**
   * Wrapper for socket emit that checks connection first
   */
  safeEmit(event, data, callback) {
    const socket = getSocket();
    
    if (!socket || !socket.connected) {
      console.warn('[RaceCondition] Socket not connected, cannot emit:', event);
      if (callback) {
        callback({ ok: false, error: 'Socket disconnected' });
      }
      return false;
    }

    if (didServerReset()) {
      console.warn('[RaceCondition] Server has reset, cannot safely emit:', event);
      if (callback) {
        callback({ ok: false, error: 'Server reset detected' });
      }
      return false;
    }

    try {
      if (callback) {
        socket.emit(event, data, callback);
      } else {
        socket.emit(event, data);
      }
      return true;
    } catch (err) {
      console.error('[RaceCondition] Error emitting event:', err);
      if (callback) {
        callback({ ok: false, error: err.message });
      }
      return false;
    }
  }

  /**
   * Wait for socket to be ready (useful at scene start)
   */
  async waitForSocketReady(timeoutMs = 3000) {
    const socket = getSocket();
    
    if (socket && socket.connected) {
      return true;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[RaceCondition] Socket ready timeout after', timeoutMs, 'ms');
        resolve(false);
      }, timeoutMs);

      const onConnect = () => {
        clearTimeout(timeout);
        if (socket) {
          socket.off('connect', onConnect);
          socket.off('connect_error', onError);
        }
        resolve(true);
      };

      const onError = () => {
        clearTimeout(timeout);
        if (socket) {
          socket.off('connect', onConnect);
          socket.off('connect_error', onError);
        }
        resolve(false);
      };

      if (socket) {
        socket.on('connect', onConnect);
        socket.on('connect_error', onError);
      } else {
        resolve(false);
      }
    });
  }
}
