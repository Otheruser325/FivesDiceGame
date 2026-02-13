export const DEBUG_MODE = false;

export default class DebugManager {
  constructor(scene, { namespace = 'Debug' } = {}) {
    this.scene = scene || null;
    this.namespace = namespace;
    this.enabled = DEBUG_MODE;
  }

  log(...args) {
    if (!this.enabled) return;
    console.log(`[${this.namespace}]`, ...args);
  }

  warn(...args) {
    if (!this.enabled) return;
    console.warn(`[${this.namespace}]`, ...args);
  }

  error(...args) {
    if (!this.enabled) return;
    console.error(`[${this.namespace}]`, ...args);
  }

  turnStart({ playerIndex, playerName, round } = {}) {
    this.log('turn-start', {
      playerIndex,
      playerName,
      round
    });
  }

  turnEnd({ playerIndex, playerName, reason } = {}) {
    this.log('turn-end', {
      playerIndex,
      playerName,
      reason
    });
  }

  rollStart({ playerIndex, playerName } = {}) {
    this.log('roll-start', { playerIndex, playerName });
  }

  rollResult({ playerIndex, playerName, dice, scored } = {}) {
    this.log('roll-result', { playerIndex, playerName, dice, scored });
  }
}
