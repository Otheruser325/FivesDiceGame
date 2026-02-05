const STORAGE_KEY = 'protodice_achievements';

const DEFAULTS = {
  totals: {
    gamesPlayed: 0,
    playTimeSeconds: 0,
    wavesPlayed: 0,
    wins: 0,
    monstersDefeated: 0,
    defencesDestroyed: 0
  },
  unlocked: {
    firstPlay: false,
    waves100: false,
    waves500: false,
    waves2500: false,
    time1h: false,
    time12h: false,
    wins1: false,
    wins10: false,
    defeatEnemies: false,
    augmented: false,
    darkestHour: false,
    hellscape: false,
    stunWave: false
  },
  completedChallenges: {
    daily: false,
    deucifer: false
  }
};

const ENEMY_DEFEAT_TARGET = 250;
const STUN_WAVE_TARGET = 5;

class AchievementsManager {
  constructor() {
    this._data = this._load() || JSON.parse(JSON.stringify(DEFAULTS));
    // Ensure defaults exist for backward compatibility
    this._data.totals = {
      ...DEFAULTS.totals,
      ...(this._data.totals || {})
    };
    this._data.unlocked = {
      ...DEFAULTS.unlocked,
      ...(this._data.unlocked || {})
    };
    this._data.completedChallenges = {
      ...DEFAULTS.completedChallenges,
      ...(this._data.completedChallenges || {})
    };
    this._notifications = [];
    this._achieveNotificationRunning = false;
    this._scene = null;

    if (!this._playHeartbeatStarted) {
      this._startPlayHeartbeat();
    }
    this._bindVisibilityHandler();
  }

  // allow a scene to be registered for UI display. Pass `null` to unregister.
  registerScene(scene) {
    this._scene = scene || null;

    if (scene && scene.events && typeof scene.events.once === 'function') {
      scene.events.once('shutdown', () => { if (this._scene === scene) this._scene = null; });
      scene.events.once('destroy', () => { if (this._scene === scene) this._scene = null; });
    }

    // Start global playtime heartbeat if not already
    if (!this._playHeartbeatStarted) {
      this._startPlayHeartbeat();
    }

    // Try flush queued notifications
    this._maybeDisplayNotifications();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[Achievements] failed to load', e);
      return null;
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
    } catch (e) {
      console.warn('[Achievements] failed to save', e);
    }
  }

  getAll() {
    return this._data;
  }

  // Read & clear notifications (returns array of achievement keys)
  getNotifications() {
    const copy = this._notifications.slice();
    this._notifications.length = 0;
    return copy;
  }

  // ---- Totals / recorders ----
  addGame() {
    this._data.totals.gamesPlayed = (this._data.totals.gamesPlayed || 0) + 1;
    this.maybeUnlock('firstPlay');
    this._save();
  }

  addWaves(n) {
    n = Math.max(0, Math.floor(n || 0));
    this._data.totals.wavesPlayed = (this._data.totals.wavesPlayed || 0) + n;
    this._checkWaveMilestones();
    this._save();
  }

  // Backwards-compatible alias (rounds -> waves)
  addRounds(n) {
    this.addWaves(n);
  }
  
  addWin(n = 1) {
    n = Math.max(0, Math.floor(n || 1));
    this._data.totals.wins = (this._data.totals.wins || 0) + n;
    if (this._data.totals.wins >= 1) this.maybeUnlock('wins1');
    if (this._data.totals.wins >= 10) this.maybeUnlock('wins10');
    this._save();
  }

  addMonsterDefeats(n = 1) {
    n = Math.max(0, Math.floor(n || 0));
    if (n <= 0) return;
    this._data.totals.monstersDefeated = (this._data.totals.monstersDefeated || 0) + n;
    this._checkEnemyMilestone();
    this._save();
  }

  addDefenceDefeats(n = 1) {
    n = Math.max(0, Math.floor(n || 0));
    if (n <= 0) return;
    this._data.totals.defencesDestroyed = (this._data.totals.defencesDestroyed || 0) + n;
    this._checkEnemyMilestone();
    this._save();
  }

  recordShopPurchase(rarity) {
    if (!rarity) return;
    const r = String(rarity).toLowerCase();
    if (r === 'epic') this.maybeUnlock('augmented');
    if (r === 'legendary') this.maybeUnlock('darkestHour');
  }

  recordWaveStun(waveKey, targetId) {
    if (!waveKey || !targetId) return;
    if (!this._waveStunTracker || this._waveStunTracker.waveKey !== waveKey) {
      this._waveStunTracker = { waveKey, targets: new Set() };
    }
    this._waveStunTracker.targets.add(targetId);
    if (this._waveStunTracker.targets.size >= STUN_WAVE_TARGET) {
      this.maybeUnlock('stunWave');
    }
  }

  // add total play seconds (called when session ends or on regular heartbeat if you want)
  addPlaySeconds(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    this._data.totals.playTimeSeconds = (this._data.totals.playTimeSeconds || 0) + seconds;
    this._checkTimeMilestones();
    this._save();
  }

  // Complete a challenge
  completeChallenge(key) {
    if (!key) return;
    if (!this._data.completedChallenges) {
      this._data.completedChallenges = {};
    }
    if (!this._data.completedChallenges[key]) {
      this._data.completedChallenges[key] = true;
      this._save();
    }
  }

  // Check if challenge completed
  isChallengeCompleted(key) {
    return (this._data.completedChallenges && this._data.completedChallenges[key]) || false;
  }

  // Checkers
  _checkWaveMilestones() {
    const w = this._data.totals.wavesPlayed || 0;
    if (w >= 100) this.maybeUnlock('waves100');
    if (w >= 500) this.maybeUnlock('waves500');
    if (w >= 2500) this.maybeUnlock('waves2500');
  }

  _checkEnemyMilestone() {
    const monsters = this._data.totals.monstersDefeated || 0;
    const defences = this._data.totals.defencesDestroyed || 0;
    const total = monsters + defences;
    if (total >= ENEMY_DEFEAT_TARGET) {
      this.maybeUnlock('defeatEnemies');
    }
  }

  _checkTimeMilestones() {
    const t = this._data.totals.playTimeSeconds || 0;
    if (t >= 3600) this.maybeUnlock('time1h');
    if (t >= 12 * 3600) this.maybeUnlock('time12h');
  }

  // mark unlocked and enqueue notification
  maybeUnlock(key) {
    if (!key) return false;
    if (this._data.unlocked[key]) return false;
    if (typeof this._data.unlocked[key] === 'undefined') {
      this._data.unlocked[key] = true;
    } else {
      this._data.unlocked[key] = true;
    }

    this._notifications.unshift(key);
    if (this._notifications.length > 200) this._notifications.length = 200;
    this._save();
    this._maybeDisplayNotifications();

    return true;
  }

  // attempt to display queued notifications using the registered scene (if any)
  _maybeDisplayNotifications() {
    if (!this._notifications || this._notifications.length === 0) return;
    if (!this._scene) return;
    if (this._achieveNotificationRunning) {
      try {
        this._scene.time.delayedCall(200, () => this._maybeDisplayNotifications());
      } catch (e) {}
      return;
    }
    const notifs = this._notifications.slice();
    this._notifications.length = 0;
    this._displayAchievementSequence(notifs);
  }

  /**
   * Display a sequence of achievement popups.
   * - notifs: array of achievement keys (required)
   * - onComplete: optional callback when finished
   * - sceneOverride: optional Phaser.Scene to use for UI (useful for mid-game popups)
   */
  _displayAchievementSequence(notifs, onComplete, sceneOverride) {
    if (!Array.isArray(notifs) || notifs.length === 0) {
      if (onComplete) onComplete();
      return;
    }

    const displayScene = sceneOverride || this._scene;
    if (!displayScene) {
      this._notifications = notifs.concat(this._notifications);
      if (onComplete) onComplete();
      return;
    }

    const meta = {
      firstPlay: { title: "I'm New to This", desc: 'Play Protodice for the first time.' },
      waves100: { title: 'Warm-Up Waves', desc: 'Progress 100 waves total.' },
      waves500: { title: 'Battle-Seasoned', desc: 'Progress 500 waves total.' },
      waves2500: { title: 'Endless War', desc: 'Progress 2,500 waves total.' },
      time1h: { title: 'Just One More', desc: 'Play Protodice for 1 hour total.' },
      time12h: { title: 'All In', desc: 'Play Protodice for 12 hours total.' },
      wins1: { title: 'First Victory', desc: 'Win your first match.' },
      wins10: { title: 'Veteran Commander', desc: 'Win 10 matches.' },
      defeatEnemies: { title: 'Enemy Down', desc: `Defeat ${ENEMY_DEFEAT_TARGET} enemies (monsters as defender / defences as attacker).` },
      augmented: { title: 'Augmented', desc: 'Buy an Epic unit in the shop.' },
      darkestHour: { title: 'In Our Darkest Hour...', desc: 'Buy a Legendary unit in the shop.' },
      hellscape: { title: 'Hellscape', desc: "Defeat Deucifer in Deucifer's Pit." },
      stunWave: { title: "Who's Stunning Now?", desc: `Stun or freeze ${STUN_WAVE_TARGET} enemies in one wave.` }
    };

    this._achieveNotificationRunning = true;

    const displayOne = (idx) => {
      if (!displayScene || !displayScene.add) {
        const remainder = notifs.slice(idx);
        this._notifications = remainder.concat(this._notifications);
        this._achieveNotificationRunning = false;
        if (onComplete) onComplete();
        return;
      }

      if (idx >= notifs.length) {
        this._achieveNotificationRunning = false;
        if (onComplete) onComplete();
        return;
      }

      const key = notifs[idx];
      const item = meta[key] || { title: key, desc: '' };

      // popup coordinates
      const boxY = displayScene.cameras.main.height - 120;
      const boxW = Math.min(800, displayScene.cameras.main.width - 120);
      const boxH = 72;
      const x = displayScene.cameras.main.centerX;

      let rect, title, desc;
      try {
        rect = displayScene.add.rectangle(x, boxY + 40, boxW, boxH, 0x111111, 0.95).setDepth(1000).setAlpha(0);
        rect.setStrokeStyle(2, 0x66ff66, 1);

        title = displayScene.add.text(x - boxW / 2 + 18, boxY + 12, item.title, { fontSize: 20, fontFamily: '"Press Start 2P", cursive', color: '#66ff66' }).setDepth(1001);
        desc = displayScene.add.text(x - boxW / 2 + 18, boxY + 36, item.desc, { fontSize: 14, fontFamily: '"Press Start 2P", cursive', color: '#ffffff' }).setDepth(1001);

        displayScene.tweens.add({
          targets: [rect, title, desc],
          y: `-=${40}`,
          alpha: 1,
          duration: 260,
          ease: 'Cubic.easeOut',
        });
      } catch (e) {
        const remainder = notifs.slice(idx);
        this._notifications = remainder.concat(this._notifications);
        this._achieveNotificationRunning = false;
        if (onComplete) onComplete();
        return;
      }

      const hold = 1500;
      try {
        displayScene.time.delayedCall(hold, () => {
          if (!displayScene || !displayScene.tweens) {
            const remainder = notifs.slice(idx + 1);
            this._notifications = remainder.concat(this._notifications);
            this._achieveNotificationRunning = false;
            if (onComplete) onComplete();
            return;
          }

          displayScene.tweens.add({
            targets: [rect, title, desc],
            y: `+=40`,
            alpha: 0,
            duration: 260,
            ease: 'Cubic.easeIn',
            onComplete: () => {
              try { rect.destroy(); } catch (e) {}
              try { title.destroy(); } catch (e) {}
              try { desc.destroy(); } catch (e) {}
              try {
                displayScene.time.delayedCall(130, () => displayOne(idx + 1));
              } catch (e) {
                const remainder = notifs.slice(idx + 1);
                this._notifications = remainder.concat(this._notifications);
                this._achieveNotificationRunning = false;
                if (onComplete) onComplete();
              }
            }
          });
        });
      } catch (e) {
        const remainder = notifs.slice(idx);
        this._notifications = remainder.concat(this._notifications);
        this._achieveNotificationRunning = false;
        if (onComplete) onComplete();
        return;
      }
    };

    displayOne(0);
  }
  
  // ---------- playtime heartbeat (global) ----------
  _startPlayHeartbeat() {
    if (this._playHeartbeatStarted) return;
    this._playHeartbeatStarted = true;
    this._heartbeatId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.addPlaySeconds(1);
      }
    }, 1000);
	
    window.addEventListener('beforeunload', () => { this._save(); });
  }

  _bindVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this._maybeDisplayNotifications();
      }
    });
  }
}

const GlobalAchievements = new AchievementsManager();
export default GlobalAchievements;
