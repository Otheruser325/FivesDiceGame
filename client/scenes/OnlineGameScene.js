import { getSocket } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import { animateDiceRoll } from '../utils/AnimationManager.js';
import { checkCombo, showComboText, playComboFX } from '../utils/ComboManager.js';

export default class OnlineGameScene extends Phaser.Scene {
  constructor() {
    super('OnlineGameScene');
  }

  init(data) {
    this.roomCode = data.code || null;

    // authoritative display/state set by server game-state
    this.playerSlots = [];
    this.localPlayerIndex = null;
    this.currentPlayerIndex = null;

    // defaults — server will override via game-state
    this.gameConfig = {
      players: data.players ?? 2,
      rounds: data.rounds ?? 20,
      comboRules: data.comboRules ?? false
    };

    // If the scene was started with a config (from OnlineLobbyScene), apply it
    if (data && data.config) {
      this.gameConfig.players = data.config.players ?? this.gameConfig.players;
      this.gameConfig.rounds = data.config.rounds ?? this.gameConfig.rounds;
      this.gameConfig.comboRules = data.config.combos ?? this.gameConfig.comboRules;
    } else {
      this.gameConfig.players = data.players ?? this.gameConfig.players;
      this.gameConfig.rounds = data.rounds ?? this.gameConfig.rounds;
      this.gameConfig.comboRules = data.comboRules ?? this.gameConfig.comboRules;
    }

    // runtime
    this.currentRound = 1;
    this.scores = [];
    this.comboStats = [];
    this.waitingForRoll = [];
    this._hasRolledThisTurn = false;

    // timer (client side mirror only)
    this.turnTimer = null;
    this.turnTimeoutSeconds = 30;
  }

  create() {
    this.exitLocked = true;
    this.debug = false;

    if (this.debug) console.log('[OnlineGameScene] create() room=', this.roomCode);

    this.add.rectangle(600, 480, 1280, 960, 0x111111, 0.95);
    this.roundTitle = this.add.text(600, 50, 'Online Game', { fontSize: 32 }).setOrigin(0.5);
    this.info = this.add.text(600, 180, '', { fontSize: 24, align: 'center' }).setOrigin(0.5);

    // Roll button (client -> server)
    this.rollBtn = this.add.text(600, 300, 'Roll Dice', { fontSize: 32, color: '#999999' })
      .setOrigin(0.5)
      .setInteractive()
      .on('pointerdown', () => {
        if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
        this.rollBtn.disableInteractive();
        this.rollBtn.setText('Rolling...');
        this.onRollPressed();
      });

    // End Turn (optional, server drives flow)
    this.endTurnBtn = this.add.text(600, 360, 'End Turn', { fontSize: 20, color: '#ffaa66' })
      .setOrigin(0.5)
      .setInteractive()
      .on('pointerdown', () => {
        if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
        if (!this._hasRolledThisTurn) {
          this.info.setText('You must roll before ending your turn.');
          return;
        }
        getSocket().emit('player-end-turn', { code: this.roomCode, playerIndex: this.localPlayerIndex });
        this.endTurnBtn.disableInteractive();
      });
    this.endTurnBtn.disableInteractive();

    this.timerText = this.add.text(600, 580, '', { fontSize: 20 }).setOrigin(0.5);

    // dice sprites (5)
    this.diceSprites = [];
    const startX = 600 - (5 * 70) / 2;
    const y = 240;
    for (let i = 0; i < 5; i++) {
      const s = this.add.image(startX + i * 70, y, 'dice1').setScale(0.9).setVisible(false);
      s.originalX = s.x; s.originalY = s.y;
      this.diceSprites.push(s);
    }

    this.scoreBreakdown = this.add.text(600, 420, '', {
      fontSize: 20,
      align: 'center',
      color: '#ffffaa'
    }).setOrigin(0.5).setAlpha(0).setDepth(50);

    this.playerBar = [];

    this.addBackButton();
    this.installSocketHandlers();

    try {
      const s = getSocket();
      if (s && !s.data?.user) {
        const raw = localStorage.getItem('fives_user');
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && cached.id) {
            s.emit('auth-user', { id: cached.id, name: cached.name, type: cached.type, avatar: cached.avatar || null });
            s.userId = cached.id;
          }
        }
      }
    } catch (e) { /* ignore */ }

    // request server authoritative state
    if (getSocket()) {
      getSocket().emit('request-game-state', { code: this.roomCode });
      // fallback: if no current player index arrived quickly, re-request once
      this.time.delayedCall(250, () => {
        if (this.debug) console.log('[OnlineGameScene] fallback check — currentPlayerIndex =', this.currentPlayerIndex);
        if ((this.currentPlayerIndex === null || typeof this.currentPlayerIndex === 'undefined') && getSocket()) {
          if (this.debug) console.log('[OnlineGameScene] re-requesting game-state (fallback)');
          getSocket().emit('request-game-state', { code: this.roomCode });
        }
      });
    } else {
      this.info.setText('Not connected to server.');
    }

    // small flag so handlers don't run before scene is ready
    this._sceneReady = true;
  }

  // -----------------------
  // Player bar helpers
  // -----------------------
  createPlayerBar() {
    // destroy previous visuals (if any)
    if (Array.isArray(this.playerBar) && this.playerBar.length) {
      this.playerBar.forEach(item => {
        if (item.icon) item.icon.destroy();
        if (item.tag) item.tag.destroy();
        if (item.ring) item.ring.destroy();
        if (item.scoreText) item.scoreText.destroy();
      });
    }
    this.playerBar = [];

    const total = Math.max(this.playerSlots.length || 1, this.gameConfig.players || 1);
    const spacing = 200;
    const startX = 600 - ((total - 1) * spacing) / 2;
    const y = 850;

    for (let i = 0; i < total; i++) {
      const icon = this.add.image(startX + i * spacing, y, 'playerIcon').setScale(0.7).setVisible(false);
      const tag = this.add.text(startX + i * spacing, y + 70, `P${i + 1}`, { fontSize: 26, color: '#ffffff' }).setOrigin(0.5).setVisible(false);
      const scoreText = this.add.text(startX + i * spacing, y - 70, '0', { fontSize: 20, color: '#ffff88' }).setOrigin(0.5).setVisible(false);
      const ring = this.add.rectangle(startX + i * spacing, y, 90, 90, 0x66ccff, 0.25).setStrokeStyle(3, 0x66ccff).setVisible(false);
      this.playerBar.push({ ring, icon, tag, scoreText });
    }

    this.updatePlayerBar();
  }

  updatePlayerBar() {
    const total = Math.max(this.playerSlots.length || 1, this.gameConfig.players || 1);
    const spacing = 200;
    const startX = 600 - ((total - 1) * spacing) / 2;
    const y = 850;

    this.playerBar.forEach((slot, idx) => {
      const x = startX + idx * spacing;

      // reposition visuals in case layout changed
      if (slot.icon) { slot.icon.x = x; slot.icon.y = y; slot.icon.setVisible(idx < total); }
      if (slot.tag) { slot.tag.x = x; slot.tag.y = y + 70; slot.tag.setVisible(idx < total); }
      if (slot.scoreText) { slot.scoreText.x = x; slot.scoreText.y = y - 70; slot.scoreText.setVisible(idx < total); }
      if (slot.ring) { slot.ring.x = x; slot.ring.y = y; slot.ring.setVisible(idx < total); }

      // highlight active
      if (slot.ring) slot.ring.setVisible(idx === this.currentPlayerIndex);

      if (this.playerSlots[idx]) {
        slot.icon.setTexture(this.playerSlots[idx].avatar || 'playerIcon');
        slot.icon.setVisible(true);
        slot.tag.setText(this.playerSlots[idx].name || `P${idx + 1}`);
        slot.tag.setVisible(true);

        const sc = (this.scores && typeof this.scores[idx] === 'number') ? String(this.scores[idx]) : '0';
        if (slot.scoreText) { slot.scoreText.setText(sc).setVisible(true); }

        if (this.playerSlots[idx].connected === false) {
          slot.icon.setTint(0x444444);
          slot.tag.setText(`${this.playerSlots[idx].name} (left)`);
          if (slot.scoreText) slot.scoreText.setTint(0x444444);
        } else {
          slot.icon.clearTint();
          if (slot.scoreText) slot.scoreText.clearTint();
        }
      } else {
        slot.icon.setVisible(false);
        slot.tag.setVisible(false);
        if (slot.scoreText) slot.scoreText.setVisible(false);
      }
    });
  }

  // -----------------------
  // Socket handlers
  // -----------------------
  installSocketHandlers() {
    const s = getSocket();
    if (!s) return;

    // store bound handlers so we can remove them cleanly
    this._handlers = {
      gameState: (p) => { if (this.debug) console.log('[socket] game-state', p); this.applyGameState(p); },
      turnStart: (p) => { if (this.debug) console.log('[socket] turn-start', p); this.onTurnStart(p); },
      turnResult: (p) => { if (this.debug) console.log('[socket] turn-result', p); this.onTurnResult(p); },
      playerTimeout: (p) => { if (this.debug) console.log('[socket] player-timeout', p); this.onPlayerTimeout(p); },
      playerLeft: (p) => this.onPlayerLeft(p),
      gameStarting: (p) => this.onGameStarting(p),
      gameFinished: (p) => this.endGame(p),
      lobbyDeleted: (p) => this.onLobbyDeleted(p),
      playerRolling: (p) => this.onPlayerRolling(p),
      endTurnFailed: (p) => { if (p && p.reason === 'not_rolled') this.info.setText('You must roll before ending your turn.'); }
    };

    s.on('game-state', this._handlers.gameState);
    s.on('turn-start', this._handlers.turnStart);
    s.on('turn-result', this._handlers.turnResult);
    s.on('player-timeout', this._handlers.playerTimeout);
    s.on('player-left', this._handlers.playerLeft);
    s.on('game-starting', this._handlers.gameStarting);
    s.on('game-finished', this._handlers.gameFinished);
    s.on('lobby-deleted', this._handlers.lobbyDeleted);
    s.on('player-rolling', this._handlers.playerRolling);
    s.on('end-turn-failed', this._handlers.endTurnFailed);

    // legacy / alternative names
    s.on('game-over', this._handlers.gameFinished); // support either event name

    // ensure cleanup on scene stop
    this.events.once('shutdown', () => this.shutdown());
    this.events.once('destroy', () => this.shutdown());
  }

  // -----------------------
  // Game starting (server told lobby->game)
  // -----------------------
  onGameStarting(payload) {
    // server: lobby -> game transition. Request fresh game-state to sync.
    if (!this._sceneReady) return;
    if (!getSocket()) return;
    getSocket().emit('request-game-state', { code: this.roomCode });
  }

  // -----------------------
  // Turn lifecycle
  // -----------------------
  onTurnStart(payload) {
    // accept multiple shape variants
    const playerIndex = (typeof payload.playerIndex === 'number')
      ? payload.playerIndex
      : (typeof payload.currentPlayerIndex === 'number' ? payload.currentPlayerIndex : null);

    if (playerIndex === null) {
      console.warn('onTurnStart: invalid payload (no player index)', payload);
      return;
    }

    const round = typeof payload.round === 'number' ? payload.round : this.currentRound;
    const timeLimitSeconds = typeof payload.timeLimitSeconds === 'number' ? payload.timeLimitSeconds : this.turnTimeoutSeconds;

    // clear previous client timer
    this.clearTurnTimer();

    // update current player + round
    this.currentPlayerIndex = playerIndex;
    this.currentRound = round;
    this.updateRoundTitle();

    // UI highlight
    this.updatePlayerBar();

    const name = (this.playerSlots[playerIndex] && this.playerSlots[playerIndex].name) || `P${playerIndex + 1}`;

    // enable local controls only if this is our turn
    if (this.localPlayerIndex === playerIndex) {
      this._hasRolledThisTurn = false;
      this.info.setText(`🎲 Your turn`);
      this.rollBtn.setText('Roll Dice').setStyle({ color: '#66ff66' }).setInteractive();
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });
      this.startTurnTimer(timeLimitSeconds, payload?.turnExpiresAt || null);
    } else {
      this.info.setText(`🎲 ${name}'s turn`);
      this.rollBtn.setText('Waiting...').setStyle({ color: '#999999' }).disableInteractive();
      this.endTurnBtn.disableInteractive();
      this.startTurnTimer(timeLimitSeconds, payload?.turnExpiresAt || null);
    }
  }

  // unify result rendering for turn-result and player-timeout
  async _renderTurnResult(payload = {}, { isTimeout = false } = {}) {
    if (!payload || typeof payload.playerIndex !== 'number') {
      console.warn('_renderTurnResult: invalid payload', payload);
      return;
    }

    if (payload.turnExpiresAt) {
      const remSec = Math.max(0, Math.ceil((payload.turnExpiresAt - Date.now()) / 1000));
      this.startTurnTimer(remSec, payload.turnExpiresAt);
    }

    const playerIndex = payload.playerIndex;
    const dice = Array.isArray(payload.dice) ? payload.dice : [];
    const scored = payload.scored;
    const combo = payload.combo;

    // Ensure arrays length matches current player count
    const playerCount = Math.max(this.playerSlots.length, this.gameConfig.players || 0);
    if (!Array.isArray(this.comboStats) || this.comboStats.length !== playerCount) {
      this.comboStats = this.makeDefaultComboStats(playerCount);
    }
    if (!Array.isArray(this.scores) || this.scores.length !== playerCount) {
      this.scores = Array(playerCount).fill(0);
    }

    // Animate dice if we have 5 faces
    if (dice.length === 5) {
      try {
        await animateDiceRoll(this, dice);
      } catch (err) {
        console.warn('animateDiceRoll failed', err);
      }
    }

    // apply final textures (defensive)
    if (dice.length) {
      dice.forEach((face, i) => {
        if (this.diceSprites[i]) this.diceSprites[i].setTexture(`dice${face}`).setVisible(true);
      });
    }

    // server authoritative arrays (scores/comboStats)
    if (Array.isArray(payload.scores) && payload.scores.length === playerCount) {
      this.scores = payload.scores.slice();
    } else if (typeof scored === 'number') {
      // if server didn't send full scores, apply to local index only (fallback)
      this.scores[playerIndex] = scored + (this.scores[playerIndex] || 0);
    }

    if (Array.isArray(payload.comboStats) && payload.comboStats.length === playerCount) {
      // ensure we have objects for each slot
      this.comboStats = payload.comboStats.map(c => (c || this.makeDefaultComboStats(1)[0]));
    }

    // Show combo fx (client-side visual)
    if (combo && this.comboRulesEnabled()) {
      try {
        playComboFX(this, combo.key);
        showComboText(this, combo.type || combo.key, combo.intensity || 1);
        if (GlobalAudio && combo.key && typeof GlobalAudio.comboSFX === 'function') {
          GlobalAudio.comboSFX(this, combo.key);
        }
      } catch (err) {
        console.warn('combo display error', err);
      }
    }

    // Update breakdown - if scored provided show final, else show base
    if (dice.length && typeof scored !== 'undefined') {
      this.diceScoringDisplay(dice, scored);
    } else if (dice.length) {
      const base = dice.reduce((a, b) => a + b, 0);
      this.diceScoringDisplay(dice, base);
    }

    // show results header
    const resultName = (this.playerSlots[playerIndex] && this.playerSlots[playerIndex].name) || `P${playerIndex + 1}`;
    if (this.localPlayerIndex === playerIndex) {
      this.info.setText(`🎲 Your roll`);
    } else {
      this.info.setText(`🎲 ${resultName}'s roll`);
    }
    this.rollBtn.setText('Results').setStyle({ color: '#888888' });

    this.updatePlayerBar();

    // If this was the local player's roll and NOT a timeout, allow End Turn after 3s
    if (!isTimeout && this.localPlayerIndex === playerIndex) {
      this._hasRolledThisTurn = true;
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });

      this.time.delayedCall(3000, () => {
        if (this.currentPlayerIndex === playerIndex) {
          this.endTurnBtn.setInteractive();
          this.endTurnBtn.setStyle({ color: '#ff4444' });
        }
      });
    } else {
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });
    }

    // clear the client timer (server confirmed outcome)
    this.clearTurnTimer();
  }

  // called when server sends 'turn-result'
  onTurnResult(payload) {
    this._renderTurnResult(payload, { isTimeout: false });
  }

  // called when server emits 'player-timeout'
  onPlayerTimeout(payload) {
    if (payload.turnExpiresAt) {
      const remSec = Math.max(0, Math.ceil((payload.turnExpiresAt - Date.now()) / 1000));
      this.startTurnTimer(remSec, payload.turnExpiresAt);
    }
    this._renderTurnResult(payload, { isTimeout: true });
  }

  // -----------------------
  // Roll press (client)
  // -----------------------
  onRollPressed() {
    if (!getSocket()) return;
    if (this.localPlayerIndex === null) return;

    if (GlobalAudio) {
      if (typeof GlobalAudio.playDice === 'function') {
        GlobalAudio.playDice(this);
      }
    }
    getSocket().emit('player-roll', { code: this.roomCode, playerIndex: this.localPlayerIndex });
  }

  // -----------------------
  // Game-state application
  // -----------------------
  applyGameState(payload = {}) {
    const players = Array.isArray(payload.players) ? payload.players : [];

    // build display playerSlots (id, name, avatar, connected)
    this.playerSlots = players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || 'playerIcon',
      connected: p.connected !== false
    }));

    // local index detection (server may provide)
    if (typeof payload.localIndex === 'number') {
      this.localPlayerIndex = payload.localIndex;
    } else if (payload.localId) {
      const idx = this.playerSlots.findIndex(p => String(p.id) === String(payload.localId));
      this.localPlayerIndex = idx >= 0 ? idx : null;
    } else {
      let localId = null;
      try {
        localId = getSocket().data?.user?.id || getSocket().userId || null;
      } catch (e) { localId = null; }

      // fallback to localStorage cached user if present
      if (!localId) {
        try {
          const raw = localStorage.getItem('fives_user');
          if (raw) {
            const cached = JSON.parse(raw);
            if (cached && cached.id) localId = cached.id;
          }
        } catch (e) { /* ignore */ }
      }

      if (localId) {
        const idx = this.playerSlots.findIndex(p => String(p.id) === String(localId));
        this.localPlayerIndex = idx >= 0 ? idx : null;
      } else {
        this.localPlayerIndex = null;
      }
    }

    // apply config override if present
    if (payload.config) {
      this.gameConfig.players = payload.config.players ?? this.gameConfig.players;
      this.gameConfig.rounds = payload.config.rounds ?? this.gameConfig.rounds;
      this.gameConfig.comboRules = payload.config.combos ?? this.gameConfig.comboRules;
    }

    // ensure arrays sized properly
    const playerCount = this.playerSlots.length;
    this.scores = (Array.isArray(payload.scores) && payload.scores.length === playerCount)
      ? payload.scores.slice()
      : Array(playerCount).fill(0);

    this.comboStats = (Array.isArray(payload.comboStats) && payload.comboStats.length === playerCount)
      ? payload.comboStats.map(c => (c || this.makeDefaultComboStats(1)[0]))
      : this.makeDefaultComboStats(playerCount);

    this.waitingForRoll = (Array.isArray(payload.waitingForRoll) && payload.waitingForRoll.length === playerCount)
      ? payload.waitingForRoll.slice()
      : Array(playerCount).fill(false);

    // round/room
    this.currentRound = typeof payload.round === 'number' ? payload.round : this.currentRound;
    this.totalRounds = this.gameConfig.rounds;
    this.roomCode = payload.room || this.roomCode;

    // Update UI
    this.roundTitle.setText(`Online Game — Round ${this.currentRound}/${this.totalRounds}`);
    this.createPlayerBar();
    this.updatePlayerBar();

    // If server included whose turn it is, trigger turn-start handling
    const cpIndex = (typeof payload.currentPlayerIndex === 'number')
      ? payload.currentPlayerIndex
      : (typeof payload.currentIndex === 'number' ? payload.currentIndex : null);

    if (cpIndex !== null) {
      this.currentPlayerIndex = cpIndex;
      if (this.debug) console.log('[OnlineGameScene] applyGameState -> start turn', cpIndex, 'timeLimit:', payload.timeLimitSeconds);
      this.onTurnStart({
        playerIndex: cpIndex,
        round: this.currentRound,
        timeLimitSeconds: typeof payload.timeLimitSeconds === 'number' ? payload.timeLimitSeconds : this.turnTimeoutSeconds,
        turnExpiresAt: payload.turnExpiresAt ?? null
      });
    } else {
      // no current player index in payload — clear any transient controls
      this.currentPlayerIndex = null;
      this.rollBtn.setText('Roll Dice').disableInteractive().setStyle({ color: '#999999' });
      this.endTurnBtn.disableInteractive();
    }
  }

  onPlayerRolling(payload = {}) {
    if (!payload || typeof payload.playerIndex !== 'number') return;
    const rollingIndex = payload.playerIndex;

    // who is rolling
    const name = (this.playerSlots[rollingIndex] && this.playerSlots[rollingIndex].name) || `P${rollingIndex + 1}`;

    // If it's our own index, set the local Roll button to Rolling...
    if (rollingIndex === this.localPlayerIndex) {
      this.rollBtn.setText('Rolling...').setStyle({ color: '#c4c70bd2' }).disableInteractive();
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });
    } else {
      this.rollBtn.setText('Rolling...').setStyle({ color: '#c4c70bd2' }).disableInteractive();
      this.info.setText(`🎲 ${name} is rolling...`);
    }
  }

  // -----------------------
  // Player left handler
  // -----------------------
  onPlayerLeft(payload) {
    if (!payload) return;
    const id = payload.id;
    let idx = (typeof payload.index === 'number') ? payload.index : -1;

    if (idx === -1 && id) {
      idx = this.playerSlots.findIndex(p => String(p.id) === String(id));
    }
    if (idx === -1) {
      return;
    }

    // mark disconnected
    if (this.playerSlots[idx]) {
      this.playerSlots[idx].connected = false;
      this.updatePlayerBar();
      const name = this.playerSlots[idx].name || `P${idx + 1}`;
      this.info.setText(`${name} left the game`);
    }
  }

  // lobby deleted while in-game
  onLobbyDeleted(payload) {
    // server requested cleanup — return to menu
    this.info.setText('Lobby closed by host.');
    this.clearTurnTimer();
    this.time.delayedCall(1500, () => {
      this.exitLocked = false;
      this.scene.start('MenuScene');
    });
  }

  // -----------------------
  // Game end / postgame
  // -----------------------
  endGame(payload = {}) {
    const scores = Array.isArray(payload.scores) ? payload.scores : (this.scores || []);
    const combos = Array.isArray(payload.comboStats) ? payload.comboStats : (this.comboStats || []);

    let resultText = 'Game Over\n\n';
    resultText += scores.map((s, i) => {
      const name = (this.playerSlots[i] && this.playerSlots[i].name) || `P${i + 1}`;
      return `${name}: ${s}`;
    }).join('\n');

    this.info.setText(resultText);
    this.rollBtn.disableInteractive();
    this.endTurnBtn.disableInteractive();
    this.clearTurnTimer();

    this.time.delayedCall(4000, () => {
      this.exitLocked = false;
      this.registry.set('onlinePostGame', {
        players: this.playerSlots.length,
        names: this.playerSlots.map(p => p.name),
        scores: scores,
        combos: combos
      });
      this.scene.start('OnlinePostGameScene');
    });
  }

  // -----------------------
  // Helpers
  // -----------------------
  makeDefaultComboStats(n) {
    const template = () => ({
      pair: 0, twoPair: 0, triple: 0, fullHouse: 0, fourOfAKind: 0, fiveOfAKind: 0, straight: 0
    });
    return Array.from({ length: n }, () => template());
  }

  comboRulesEnabled() {
    return this.gameConfig.comboRules === true;
  }

  applyBonus(dice, baseScore) {
    if (!this.comboRulesEnabled()) return baseScore;
    const combo = checkCombo(dice);
    if (combo) return Math.floor(baseScore * (combo.multiplier || 1));
    return baseScore;
  }

  diceScoringDisplay(dice = [], scored) {
    if (!Array.isArray(dice) || dice.length === 0) {
      this.scoreBreakdown.setText('');
      this.scoreBreakdown.setAlpha(0);
      return;
    }

    const base = dice.reduce((a, b) => a + b, 0);
    const combo = checkCombo(dice);

    const lines = [];
    lines.push(`Rolled: ${dice.join(', ')}`);
    lines.push(`Base Score: ${base}`);

    if (this.comboRulesEnabled() && combo) {
      lines.push(`Combo: x${(combo.multiplier || 1).toFixed(1)} (${combo.type})`);
    }

    lines.push(`Final Score: ${typeof scored === 'number' ? scored : base}`);

    // set text and animate a gentle fade-in
    this.scoreBreakdown.setText(lines.join('\n'));
    try {
      this.scoreBreakdown.setAlpha(0);
      this.tweens.killTweensOf(this.scoreBreakdown);
      this.tweens.add({
        targets: this.scoreBreakdown,
        alpha: 1,
        duration: 220,
        ease: 'Cubic.easeOut'
      });
    } catch (e) {
      // ignore tween failures in headless / fallback cases
    }

    // auto-hide after a short while (clear previous timer so repeated rolls reset it)
    if (this._scoreDisplayTimer) this._scoreDisplayTimer.remove(false);
    this._scoreDisplayTimer = this.time.delayedCall(4000, () => {
      if (this.scoreBreakdown) {
        // smoothly fade out
        try {
          this.tweens.add({
            targets: this.scoreBreakdown,
            alpha: 0,
            duration: 300,
            onComplete: () => this.scoreBreakdown.setText('')
          });
        } catch (e) {
          this.scoreBreakdown.setText('');
        }
      }
      this._scoreDisplayTimer = null;
    });
  }

  updateRoundTitle() {
    this.roundTitle.setText(`Online Game — Round ${this.currentRound}/${this.gameConfig.rounds}`);
  }

  // -----------------------
  // Turn timer (client display only)
  // -----------------------
  startTurnTimer(seconds, expireAt = null) {
    this.clearTurnTimer();

    let remaining = seconds;

    // If server provided an expireAt timestamp (ms), compute remaining
    if (expireAt && typeof expireAt === 'number') {
      const remMs = Math.max(0, expireAt - Date.now());
      remaining = Math.ceil(remMs / 1000);
    }

    this.timerText.setText(`Time: ${remaining}s`);

    // Use Phaser timed event to tick every second so every client shows a countdown
    this.turnTimer = this.time.addEvent({
      delay: 1000,
      repeat: Math.max(0, remaining - 1),
      callback: () => {
        remaining--;
        this.timerText.setText(`Time: ${remaining}s`);
        if (remaining <= 0) {
          // local client: notify server only if we are the current player.
          // Server is still authoritative and will handle auto-roll; this just helps UX.
          if (this.localPlayerIndex !== null && this.localPlayerIndex === this.currentPlayerIndex) {
            getSocket().emit('player-timeout', { code: this.roomCode, playerIndex: this.localPlayerIndex });
          }
          this.clearTurnTimer();
        }
      }
    });
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      this.turnTimer.remove();
      this.turnTimer = null;
    }
    this.timerText.setText('');
  }

  addBackButton() {
    const back = this.add.text(50, 50, '← Back', { fontSize: 24, color: '#ff6666' }).setInteractive();
    back.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      if (this.exitLocked) {
        this.showConfirmExit();
      } else {
        this.scene.start('MenuScene');
      }
    });
  }

  showConfirmExit() {
    const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.85);
    const msg = this.add.text(600, 260, 'Are you sure you want to leave the match?\nYou may forfeit.', { fontSize: 22, align: 'center' }).setOrigin(0.5);
    const yesBtn = this.add.text(540, 340, 'Yes', { fontSize: 26, color: '#66ff66' }).setOrigin(0.5).setInteractive();
    const noBtn = this.add.text(660, 340, 'No', { fontSize: 26, color: '#ff6666' }).setOrigin(0.5).setInteractive();

    yesBtn.on('pointerdown', () => {
      // match server lobby manager's expected event
      getSocket().emit('leave-lobby', this.roomCode);
      this.scene.start('MenuScene');
    });
    noBtn.on('pointerdown', () => {
      bg.destroy(); msg.destroy(); yesBtn.destroy(); noBtn.destroy();
    });
  }

  // -----------------------
  // Cleanup
  // -----------------------
  shutdown() {
    this._sceneReady = false;
    const s = getSocket();
    if (s && this._handlers) {
      // remove only the handlers we added
      s.off('game-state', this._handlers.gameState);
      s.off('turn-start', this._handlers.turnStart);
      s.off('turn-result', this._handlers.turnResult);
      s.off('player-timeout', this._handlers.playerTimeout);
      s.off('player-left', this._handlers.playerLeft);
      s.off('game-starting', this._handlers.gameStarting);
      s.off('game-finished', this._handlers.gameFinished);
      s.off('lobby-deleted', this._handlers.lobbyDeleted);
      s.off('game-over', this._handlers.gameFinished);
      s.off('player-rolling', this._handlers.playerRolling);
      s.off('end-turn-failed', this._handlers.endTurnFailed);
      this._handlers = null;
    } else if (s) {
      // fallback: remove named events completely
      s.off('game-state'); s.off('turn-start'); s.off('turn-result');
      s.off('player-timeout'); s.off('player-left'); s.off('game-starting');
      s.off('game-finished'); s.off('lobby-deleted'); s.off('game-over');
      s.off('player-rolling'); s.off('end-turn-failed');
    }
    this.clearTurnTimer();
  }
}