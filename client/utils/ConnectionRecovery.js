/**
 * ConnectionRecovery.js
 * Handles Socket.io connection recovery and maintenance mode scenarios.
 * Provides mechanisms for graceful degradation when server is unreachable.
 */

import { getSocket, isInMaintenanceMode, getConnectionRetries, resetConnectionState, getServerUrl } from './SocketManager.js';

let _lastHealthCheck = 0;
let _recoveryAttempts = 0;
const HEALTH_CHECK_INTERVAL = 10000;      // Check every 10s
const MAX_RECOVERY_ATTEMPTS = 5;
const RECOVERY_WAIT_MS = 3000;

/**
 * Perform a server health check
 * @returns {Promise<boolean>} true if server is healthy
 */
export async function performHealthCheck() {
  try {
    const server = getServerUrl();
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 5000);
    
    const resp = await fetch(`${server.replace(/\/$/, '')}/health`, {
      signal: ctrl.signal,
      credentials: 'include'
    });
    
    clearTimeout(timeoutId);
    
    if (resp.ok) {
      const data = await resp.json();
      console.info('[ConnectionRecovery] Health check successful:', {
        uptime: data.uptime,
        socketConnected: data.socketIO?.connected,
        database: data.database
      });
      return true;
    } else {
      console.warn('[ConnectionRecovery] Health check failed with status:', resp.status);
      return false;
    }
  } catch (err) {
    console.warn('[ConnectionRecovery] Health check error:', err?.message || err);
    return false;
  }
}

/**
 * Attempt to recover socket connection
 * @returns {Promise<boolean>} true if recovery successful
 */
export async function attemptRecovery() {
  try {
    // Check if already in maintenance mode with too many attempts
    if (isInMaintenanceMode() && _recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      console.error('[ConnectionRecovery] Max recovery attempts reached, service unavailable');
      return false;
    }

    // Perform health check
    const healthyServer = await performHealthCheck();
    
    if (!healthyServer) {
      _recoveryAttempts++;
      console.warn('[ConnectionRecovery] Server unhealthy, recovery attempt', _recoveryAttempts, 'of', MAX_RECOVERY_ATTEMPTS);
      
      if (_recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
        // Wait before next attempt
        await new Promise(r => setTimeout(r, RECOVERY_WAIT_MS));
        return attemptRecovery(); // Retry
      }
      return false;
    }

    // Server is healthy, reset connection state and try to reconnect
    console.info('[ConnectionRecovery] Server recovered, resetting connection state');
    resetConnectionState();
    _recoveryAttempts = 0;
    
    // Force socket reconnection
    const socket = getSocket();
    if (socket && !socket.connected) {
      console.info('[ConnectionRecovery] Triggering socket reconnection');
      socket.connect();
    }
    
    return true;
  } catch (err) {
    console.error('[ConnectionRecovery] Recovery attempt failed:', err?.message || err);
    return false;
  }
}

/**
 * Start periodic health monitoring
 * @param {Function} onMaintenanceMode callback when entering maintenance mode
 * @param {Function} onRecovered callback when recovered from maintenance
 */
export function startHealthMonitoring(onMaintenanceMode, onRecovered) {
  setInterval(async () => {
    const now = Date.now();
    
    // Check if we're in maintenance mode or having issues
    if (isInMaintenanceMode() || getConnectionRetries() > 10) {
      if (now - _lastHealthCheck > HEALTH_CHECK_INTERVAL) {
        _lastHealthCheck = now;
        
        console.info('[ConnectionRecovery] Starting recovery sequence...');
        const recovered = await attemptRecovery();
        
        if (recovered) {
          console.info('[ConnectionRecovery] Connection recovered!');
          onRecovered?.();
        } else if (isInMaintenanceMode()) {
          console.error('[ConnectionRecovery] Server in maintenance mode');
          onMaintenanceMode?.();
        }
      }
    } else {
      // Connection is healthy, reset recovery counter periodically
      _recoveryAttempts = 0;
      _lastHealthCheck = now;
    }
  }, 3000); // Check every 3 seconds for quick recovery
}

/**
 * Get current recovery status
 */
export function getRecoveryStatus() {
  return {
    inMaintenanceMode: isInMaintenanceMode(),
    connectionRetries: getConnectionRetries(),
    recoveryAttempts: _recoveryAttempts,
    maxRecoveryAttempts: MAX_RECOVERY_ATTEMPTS,
    canRecover: _recoveryAttempts < MAX_RECOVERY_ATTEMPTS
  };
}

/**
 * Reset recovery state (useful after manual intervention)
 */
export function resetRecoveryState() {
  _recoveryAttempts = 0;
  resetConnectionState();
  _lastHealthCheck = 0;
  console.info('[ConnectionRecovery] Recovery state reset');
}

/**
 * Force immediate recovery attempt
 */
export function forceRecovery() {
  console.info('[ConnectionRecovery] Forcing immediate recovery attempt');
  _lastHealthCheck = 0;
  _recoveryAttempts = 0;
  return attemptRecovery();
}
