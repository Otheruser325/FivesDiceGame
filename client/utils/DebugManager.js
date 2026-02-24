export const DEBUG_MODE = false;

export default class DebugManager {
  static _namespace(ns) {
    return ns || 'Debug';
  }

  static get enabled() {
    return DEBUG_MODE;
  }

  static create(scene = null, { namespace = 'Debug' } = {}) {
    const ns = DebugManager._namespace(namespace);
    return {
      scene,
      namespace: ns,
      get enabled() {
        return DEBUG_MODE;
      },
      log(...args) {
        DebugManager.log(ns, ...args);
      },
      warn(...args) {
        DebugManager.warn(ns, ...args);
      },
      error(...args) {
        DebugManager.error(ns, ...args);
      },
      turnStart(payload = {}) {
        DebugManager.turnStart(ns, payload);
      },
      turnEnd(payload = {}) {
        DebugManager.turnEnd(ns, payload);
      },
      rollStart(payload = {}) {
        DebugManager.rollStart(ns, payload);
      },
      rollResult(payload = {}) {
        DebugManager.rollResult(ns, payload);
      }
    };
  }

  static log(namespace, ...args) {
    if (!DEBUG_MODE) return;
    console.log(`[${DebugManager._namespace(namespace)}]`, ...args);
  }

  static warn(namespace, ...args) {
    if (!DEBUG_MODE) return;
    console.warn(`[${DebugManager._namespace(namespace)}]`, ...args);
  }

  static error(namespace, ...args) {
    if (!DEBUG_MODE) return;
    console.error(`[${DebugManager._namespace(namespace)}]`, ...args);
  }

  static turnStart(namespace, { playerIndex, playerName, round } = {}) {
    DebugManager.log(namespace, 'turn-start', { playerIndex, playerName, round });
  }

  static turnEnd(namespace, { playerIndex, playerName, reason } = {}) {
    DebugManager.log(namespace, 'turn-end', { playerIndex, playerName, reason });
  }

  static rollStart(namespace, { playerIndex, playerName } = {}) {
    DebugManager.log(namespace, 'roll-start', { playerIndex, playerName });
  }

  static rollResult(namespace, { playerIndex, playerName, dice, scored } = {}) {
    DebugManager.log(namespace, 'roll-result', { playerIndex, playerName, dice, scored });
  }
}
