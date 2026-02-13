import { getSocket, emitAuthUser } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import { animateDiceRoll } from '../utils/AnimationManager.js';
import { checkCombo, showComboText, playComboFX } from '../utils/ComboManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import SyncManager from '../utils/SyncManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DebugManager from '../utils/DebugManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const teamLabel = (team) => (team === 'red' ? t('TEAM_RED', 'RED') : t('TEAM_BLUE', 'BLUE'));

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

    // defaults - server will override via game-state
    this.gameConfig = {
      players: data.players ?? 2,
      rounds: data.rounds ?? 20,
      comboRules: data.comboRules ?? false,
      multiplexRules: data.multiplex ?? false,
      teamsEnabled: data.teamsEnabled ?? false
    };

    // If the scene was started with a config (from OnlineLobbyScene), apply it
    if (data && data.config) {
      this.gameConfig.players = data.config.players ?? this.gameConfig.players;
      this.gameConfig.rounds = data.config.rounds ?? this.gameConfig.rounds;
      this.gameConfig.comboRules = data.config.combos ?? this.gameConfig.comboRules;
      this.gameConfig.multiplexRules = data.config.multiplex ?? this.gameConfig.multiplexRules;
      this.gameConfig.teamsEnabled = data.config.teamsEnabled ?? this.gameConfig.teamsEnabled;
    } else {
      this.gameConfig.players = data.players ?? this.gameConfig.players;
      this.gameConfig.rounds = data.rounds ?? this.gameConfig.rounds;
      this.gameConfig.comboRules = data.comboRules ?? this.gameConfig.comboRules;
      this.gameConfig.multiplexRules = data.multiplex ?? this.gameConfig.multiplexRules;
      this.gameConfig.teamsEnabled = data.teamsEnabled ?? this.gameConfig.teamsEnabled;
    }

    this.playerTints = [0x66aaff, 0xffff66, 0x66ff99, 0xff6666, 0xffaa44, 0xee88ff];
    this.teamTints = { blue: 0x66aaff, red: 0xff6666 };

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
    ErrorHandler.setScene(this);
    this.exitLocked = true;
    this.exitModal = null;
    this.debugger = new DebugManager(this, { namespace: 'OnlineGameScene' });
    this.debug = this.debugger.enabled;

    if (this.debug) console.log('[OnlineGameScene] create() room=', this.roomCode);

    this.add.rectangle(600, 480, 1280, 960, 0x111111, 0.95);
    
    // Team score display (if teams enabled)
    this.teamScoreText = null;
    if (this.gameConfig.teamsEnabled) {
      this.teamScoreText = this.add.text(600, 30, '', {
        fontSize: 28,
        color: '#ffffff',
        align: 'center'
      }).setOrigin(0.5);
    }
    
    this.roundTitle = this.add.text(
      600,
      50,
      tf('ONLINE_ROUND_TITLE', 'Online Game - Round {0}/{1}', this.currentRound, this.gameConfig.rounds),
      { fontSize: 32 }
    ).setOrigin(0.5);
    this.info = this.add.text(600, 180, '', { fontSize: 24, align: 'center' }).setOrigin(0.5);

    // Roll button (client -> server)
    this.rollBtn = this.add.text(600, 300, t('UI_ROLL_DICE', 'Roll Dice'), { fontSize: 32, color: '#999999' })
      .setOrigin(0.5)
      .setInteractive()
      .on('pointerdown', () => {
        if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
        this.rollBtn.disableInteractive();
        this.rollBtn.setText(t('UI_ROLLING', 'Rolling...'));
        this.onRollPressed();
      });

    // End Turn (optional, server drives flow)
    this.endTurnBtn = this.add.text(600, 360, t('UI_END_TURN', 'End Turn'), { fontSize: 20, color: '#ffaa66' })
      .setOrigin(0.5)
      .setInteractive()
      .on('pointerdown', () => {
        if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
        if (!this._hasRolledThisTurn) {
          this.info.setText(t('GAME_MUST_ROLL', 'You must roll before ending your turn.'));
          return;
        }
        getSocket().emit('player-end-turn', { code: this.roomCode, playerIndex: this.localPlayerIndex });
        if (this.debugger) {
          this.debugger.turnEnd({
            playerIndex: this.localPlayerIndex,
            playerName: this.playerSlots?.[this.localPlayerIndex]?.name,
            reason: 'button'
          });
        }
        this.endTurnBtn.disableInteractive();
      });
    this.endTurnBtn.disableInteractive();

    // Hotkeys: Space/R = roll, T = end turn, ESC = exit modal toggle
    if (this.input && this.input.keyboard) {
      this._hotkeyHandlers = {
        rollSpace: (event) => { if (event.repeat) return; this.handleHotkeyRoll(); },
        rollR: (event) => { if (event.repeat) return; this.handleHotkeyRoll(); },
        endT: (event) => { if (event.repeat) return; this.handleHotkeyEndTurn(); },
        esc: (event) => { if (event.repeat) return; this.handleEscPressed(); }
      };
      this.input.keyboard.on('keydown-SPACE', this._hotkeyHandlers.rollSpace);
      this.input.keyboard.on('keydown-R', this._hotkeyHandlers.rollR);
      this.input.keyboard.on('keydown-T', this._hotkeyHandlers.endT);
      this.input.keyboard.on('keydown-ESC', this._hotkeyHandlers.esc);
      this.events.once('shutdown', () => this.cleanupHotkeys());
    }

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

    // Setup visibility change handler to sync when page returns from background
    SyncManager.setupVisibilityHandler(() => {
      console.log('[OnlineGameScene] Page became visible - syncing game state');
      try {
        SyncManager.fullSync({
          roomCode: this.roomCode,
          onSuccess: (results) => {
            console.log('[OnlineGameScene] Sync completed:', results);
            // Game state will update via socket handlers
          },
          onError: (err) => {
            console.warn('[OnlineGameScene] Sync error:', err);
          }
        });
      } catch (err) {
        console.warn('[OnlineGameScene] Failed to sync on visibility change:', err);
      }
    });

    try {
      const s = getSocket();
      if (s && !s.data?.user) {
        const raw = localStorage.getItem('fives_user');
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && cached.id) {
            emitAuthUser({
              id: cached.id,
              name: cached.name,
              type: cached.type,
              avatar: cached.avatar || null
            });
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
        if (this.debug) console.log('[OnlineGameScene] fallback check - currentPlayerIndex =', this.currentPlayerIndex);
        if ((this.currentPlayerIndex === null || typeof this.currentPlayerIndex === 'undefined') && getSocket()) {
          if (this.debug) console.log('[OnlineGameScene] re-requesting game-state (fallback)');
          getSocket().emit('request-game-state', { code: this.roomCode });
        }
      });
    } else {
      this.info.setText(t('ONLINE_NOT_CONNECTED', 'Not connected to server.'));
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

  getPlayerTintColor(playerIndex) {
    if (this.gameConfig.teamsEnabled && this.playerSlots && this.playerSlots[playerIndex]) {
      const team = this.playerSlots[playerIndex].team || (playerIndex % 2 === 0 ? 'blue' : 'red');
      return this.teamTints[team] || 0x66aaff;
    } else {
      return this.playerTints[playerIndex % this.playerTints.length] || 0x66aaff;
    }
  }

  // NEW: Load OAuth avatar from URL and display in-game (128x128)
  loadAndSetAvatarFromURL(imageObj, avatarUrl) {
    if (!imageObj || !avatarUrl) {
      imageObj.setTexture('playerIcon');
      return;
    }

    try {
      // Simple approach: create a texture from the URL using fetch
      const textureKey = `avatar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create a small image element and use it as a texture
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          // Add loaded image as a texture to Phaser
          this.textures.addImage(textureKey, img);
          imageObj.setTexture(textureKey);
          imageObj.setDisplaySize(80, 80);
        } catch (err) {
          console.warn('[OnlineGameScene] Failed to create texture from avatar:', err);
          imageObj.setTexture('playerIcon');
        }
      };
      img.onerror = () => {
        console.warn('[OnlineGameScene] Failed to load avatar image:', avatarUrl);
        imageObj.setTexture('playerIcon');
      };
      img.src = avatarUrl;
    } catch (err) {
      console.warn('[OnlineGameScene] Error loading avatar:', err);
      imageObj.setTexture('playerIcon');
    }
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

      // highlight active player and apply ring color based on team/position
      if (slot.ring) {
        slot.ring.setVisible(idx === this.currentPlayerIndex);
        const ringColor = this.getPlayerTintColor(idx);
        slot.ring.setFillStyle(ringColor, 0.25);
        slot.ring.setStrokeStyle(3, ringColor);
      }

      if (this.playerSlots[idx]) {
        // FIX: Handle OAuth avatars (URLs) vs texture keys
        const avatarValue = this.playerSlots[idx].avatar;
        if (avatarValue && (avatarValue.startsWith('http://') || avatarValue.startsWith('https://'))) {
          // OAuth avatar URL - try to load dynamically
          this.loadAndSetAvatarFromURL(slot.icon, avatarValue);
        } else {
          // Texture key or default
          slot.icon.setTexture(avatarValue || 'playerIcon');
        }
        
        slot.icon.setVisible(true);
        slot.tag.setText(this.playerSlots[idx].name || `P${idx + 1}`);
        slot.tag.setVisible(true);

        const sc = (this.scores && typeof this.scores[idx] === 'number') ? String(this.scores[idx]) : '0';
        if (slot.scoreText) { slot.scoreText.setText(sc).setVisible(true); }

        if (this.playerSlots[idx].connected === false) {
          slot.tag.setText(tf('GAME_PLAYER_LEFT', '{0} (left)', this.playerSlots[idx].name));
          if (slot.scoreText) slot.scoreText.setTint(0x444444);
        } else {
          if (slot.scoreText) slot.scoreText.clearTint();
        }
      } else {
        slot.icon.setVisible(false);
        slot.tag.setVisible(false);
        if (slot.scoreText) slot.scoreText.setVisible(false);
      }
    });

    // Update team scores if teams are enabled
    if (this.gameConfig.teamsEnabled) {
      this.updateTeamScoreDisplay();
    }
  }

  updateTeamScoreDisplay() {
    if (!this.gameConfig.teamsEnabled || !this.teamScoreText) return;

    let blueScore = 0;
    let redScore = 0;

    for (let i = 0; i < this.playerSlots.length; i++) {
      const team = this.playerSlots[i]?.team || (i % 2 === 0 ? 'blue' : 'red');
      if (team === 'blue') {
        blueScore += this.scores[i] || 0;
      } else if (team === 'red') {
        redScore += this.scores[i] || 0;
      }
    }

    this.teamScoreText.setText(
      tf(
        'TEAM_SCORE_DISPLAY',
        '{0}: {1} | {2}: {3}',
        teamLabel('blue'),
        blueScore,
        teamLabel('red'),
        redScore
      )
    );
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
      endTurnFailed: (p) => { if (p && p.reason === 'not_rolled') this.info.setText(t('GAME_MUST_ROLL', 'You must roll before ending your turn.')); }
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

    // FIX: Handle visibility changes to sync UI when tab comes back into focus
    this._handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('[OnlineGameScene] Tab hidden - pausing visual updates');
      } else {
        console.log('[OnlineGameScene] Tab visible - syncing game state');
        // Request fresh game state to ensure UI is synchronized
        if (getSocket() && this.roomCode) {
          getSocket().emit('request-game-state', { code: this.roomCode });
        }
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._handleVisibilityChange);
    }

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

    // FIX: Check if this is a NEW turn BEFORE updating currentPlayerIndex
    const previousPlayerIndex = this.currentPlayerIndex;
    const isNewTurn = previousPlayerIndex !== playerIndex;

    // update current player + round
    this.currentPlayerIndex = playerIndex;
    this.currentRound = round;
    this.updateRoundTitle();

    // UI highlight
    this.updatePlayerBar();

    const name = (this.playerSlots[playerIndex] && this.playerSlots[playerIndex].name) || `P${playerIndex + 1}`;
    if (this.debugger) {
      this.debugger.turnStart({ playerIndex, playerName: name, round });
    }

    // enable local controls only if this is our turn
    if (this.localPlayerIndex === playerIndex) {
      // Only reset hasRolledThisTurn on a NEW turn, not on state syncs
      if (isNewTurn || this._hasRolledThisTurn === undefined) {
        this._hasRolledThisTurn = false;
      }
      
      this.info.setText(t('GAME_YOUR_TURN', 'Your turn'));
      // Don't re-enable roll button if we've already rolled this turn (sync doesn't reset state)
      if (!this._hasRolledThisTurn) {
        this.rollBtn.setText(t('UI_ROLL_DICE', 'Roll Dice')).setStyle({ color: '#66ff66' }).setInteractive();
      } else {
        this.rollBtn.setText(t('UI_ROLLED', 'Rolled')).setStyle({ color: '#ffaa44' }).disableInteractive();
      }
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });
      this.startTurnTimer(timeLimitSeconds, payload?.turnExpiresAt || null);
    } else {
      this.info.setText(tf('GAME_TURN', "{0}'s turn", name));
      this.rollBtn.setText(t('UI_WAITING', 'Waiting...')).setStyle({ color: '#999999' }).disableInteractive();
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
        const comboLabel = this.getComboLabel(combo);
        showComboText(this, comboLabel, combo.intensity || 1, combo.key);
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
      const base = this.getBaseScore(dice);
      this.diceScoringDisplay(dice, base);
    }

    // show results header
    const resultName = (this.playerSlots[playerIndex] && this.playerSlots[playerIndex].name) || `P${playerIndex + 1}`;
    if (this.localPlayerIndex === playerIndex) {
      this.info.setText(t('GAME_YOUR_ROLL', 'Your roll'));
    } else {
      this.info.setText(tf('GAME_ROLL_RESULT', "{0}'s roll", resultName));
    }
    this.rollBtn.setText(t('UI_RESULTS', 'Results')).setStyle({ color: '#888888' });

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
    if (this.debugger) {
      this.debugger.rollStart({
        playerIndex: this.localPlayerIndex,
        playerName: this.playerSlots?.[this.localPlayerIndex]?.name
      });
    }
    getSocket().emit('player-roll', { code: this.roomCode, playerIndex: this.localPlayerIndex });
  }

  handleHotkeyRoll() {
    if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
    if (this.rollBtn?.input?.enabled !== true) return;
    this.rollBtn.disableInteractive();
    this.rollBtn.setText(t('UI_ROLLING', 'Rolling...'));
    this.onRollPressed();
  }

  handleHotkeyEndTurn() {
    if (this.localPlayerIndex === null || this.currentPlayerIndex !== this.localPlayerIndex) return;
    if (!this._hasRolledThisTurn) {
      this.info.setText(t('GAME_MUST_ROLL', 'You must roll before ending your turn.'));
      return;
    }
    if (this.endTurnBtn?.input?.enabled !== true) return;
    getSocket().emit('player-end-turn', { code: this.roomCode, playerIndex: this.localPlayerIndex });
    this.endTurnBtn.disableInteractive();
    if (this.debugger) {
      this.debugger.turnEnd({
        playerIndex: this.localPlayerIndex,
        playerName: this.playerSlots?.[this.localPlayerIndex]?.name,
        reason: 'hotkey'
      });
    }
  }

  cleanupHotkeys() {
    if (!this._hotkeyHandlers || !this.input || !this.input.keyboard) return;
    this.input.keyboard.off('keydown-SPACE', this._hotkeyHandlers.rollSpace);
    this.input.keyboard.off('keydown-R', this._hotkeyHandlers.rollR);
    this.input.keyboard.off('keydown-T', this._hotkeyHandlers.endT);
    this.input.keyboard.off('keydown-ESC', this._hotkeyHandlers.esc);
    this._hotkeyHandlers = null;
  }

  // -----------------------
  // Game-state application
  // -----------------------
  applyGameState(payload = {}) {
    const players = Array.isArray(payload.players) ? payload.players : [];

    // build display playerSlots (id, name, avatar/playerIcon, type, connected)
    // Support both OAuth avatars and guest playerIcons
    this.playerSlots = players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || null,        // OAuth avatar (Discord/Google)
      playerIcon: p.playerIcon || null, // Guest avatar
      type: p.type || 'guest',
      connected: p.connected !== false,
      score: p.score || 0  // Include score in playerSlots for easier access
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
      this.gameConfig.multiplexRules = payload.config.multiplex ?? this.gameConfig.multiplexRules;
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
    this.roundTitle.setText(tf('ONLINE_ROUND_TITLE', 'Online Game - Round {0}/{1}', this.currentRound, this.gameConfig.rounds));
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
      // no current player index in payload - clear any transient controls
      this.currentPlayerIndex = null;
      this.rollBtn.setText(t('UI_ROLL_DICE', 'Roll Dice')).disableInteractive().setStyle({ color: '#999999' });
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
      this.rollBtn.setText(t('UI_ROLLING', 'Rolling...')).setStyle({ color: '#c4c70bd2' }).disableInteractive();
      this.endTurnBtn.disableInteractive();
      this.endTurnBtn.setStyle({ color: '#888888' });
    } else {
      this.rollBtn.setText(t('UI_ROLLING', 'Rolling...')).setStyle({ color: '#c4c70bd2' }).disableInteractive();
      this.info.setText(tf('GAME_ROLLING_PLAYER', '{0} is rolling...', name));
    }
  }

  // -----------------------
  // Player left handler
  // -----------------------
  onPlayerLeft(payload) {
    try {
      if (!payload) return;
      
      const id = payload.id;
      let idx = (typeof payload.index === 'number') ? payload.index : -1;

      if (idx === -1 && id) {
        idx = this.playerSlots.findIndex(p => p && String(p.id) === String(id));
      }
      if (idx === -1) {
        console.warn('[OnlineGameScene] Player left but index not found:', id);
        return;
      }

      // Safely mark disconnected
      if (this.playerSlots && this.playerSlots[idx]) {
        this.playerSlots[idx].connected = false;
        
        // Update UI if available
        if (typeof this.updatePlayerBar === 'function') {
          this.updatePlayerBar();
        }
        
        // Display notification
        const name = (this.playerSlots[idx] && this.playerSlots[idx].name) || `P${idx + 1}`;
        if (this.info && typeof this.info.setText === 'function') {
          this.info.setText(tf('GAME_PLAYER_LEFT_NOTICE', '{0} left the game', name));
        }
      }
    } catch (err) {
      console.error('[OnlineGameScene] Error handling player-left:', err);
      ErrorHandler.logError(err);
    }
  }

  // lobby deleted while in-game
  onLobbyDeleted(payload) {
    try {
      // server requested cleanup - return to menu
      if (this.info && typeof this.info.setText === 'function') {
        this.info.setText(t('ONLINE_LOBBY_CLOSED', 'Lobby closed by host.'));
      }
      
      this.clearTurnTimer();
      
      this.time.delayedCall(1500, () => {
        try {
          this.exitLocked = false;
          if (this.scene.isActive()) {
            this.scene.start('MenuScene');
          }
        } catch (e) {
          console.error('[OnlineGameScene] Failed to transition after lobby delete:', e);
          ErrorHandler.logError(e);
        }
      });
    } catch (err) {
      console.error('[OnlineGameScene] Error handling lobby-deleted:', err);
      ErrorHandler.logError(err);
    }
  }

  // -----------------------
  // Game end / postgame
  // -----------------------
  endGame(payload = {}) {
    try {
      const scores = Array.isArray(payload.scores) ? payload.scores : (this.scores || []);
      const combos = Array.isArray(payload.comboStats) ? payload.comboStats : (this.comboStats || []);

      let resultText = `${t('GAME_OVER', 'Game Over')}\n\n`;
      resultText += scores.map((s, i) => {
        const name = (this.playerSlots && this.playerSlots[i] && this.playerSlots[i].name) || `P${i + 1}`;
        return tf('GAME_SCORE_PLAYER', '{0}: {1}', name, s);
      }).join('\n');

      if (this.info && typeof this.info.setText === 'function') {
        this.info.setText(resultText);
      }

      if (this.rollBtn) this.rollBtn.disableInteractive();
      if (this.endTurnBtn) this.endTurnBtn.disableInteractive();
      this.clearTurnTimer();

      this.time.delayedCall(4000, () => {
        try {
          this.exitLocked = false;

          // Ensure scores is a valid array (fallback to 0s if needed)
          let finalScores = scores;
          if (!Array.isArray(finalScores) || finalScores.length === 0) {
            const playerCount = (this.playerSlots && this.playerSlots.length) || 0;
            finalScores = Array(playerCount).fill(0);
            console.warn('[OnlineGameScene] Scores were empty, using zeros fallback');
          }

          // Ensure combos is valid
          let finalCombos = combos;
          if (!Array.isArray(finalCombos) || finalCombos.length === 0) {
            const playerCount = (this.playerSlots && this.playerSlots.length) || 0;
            finalCombos = this.makeDefaultComboStats(playerCount);
            console.warn('[OnlineGameScene] Combos were empty, using defaults fallback');
          }

          // Extract team data from playerSlots
          const teamsArray = (this.playerSlots || []).map((p, i) => p?.team || (i % 2 === 0 ? 'blue' : 'red'));

          this.registry.set('onlinePostGame', {
            players: (this.playerSlots && this.playerSlots.length) || 0,
            names: (this.playerSlots && this.playerSlots.map(p => p?.name || 'Player')) || [],
            scores: finalScores,
            combos: finalCombos,
            teamsEnabled: (this.gameConfig && this.gameConfig.teamsEnabled) || false,
            teams: teamsArray
          });

          if (this.scene.isActive()) {
            this.scene.start('OnlinePostGameScene');
          }
        } catch (e) {
          console.error('[OnlineGameScene] Failed to transition to postgame:', e);
          ErrorHandler.logError(e);
        }
      });
    } catch (err) {
      console.error('[OnlineGameScene] Error in endGame:', err);
      ErrorHandler.logError(err);
    }
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

  multiplexRulesEnabled() {
    return this.gameConfig.multiplexRules === true;
  }

  getBaseScore(dice) {
    if (!Array.isArray(dice) || dice.length === 0) return 0;
    if (this.multiplexRulesEnabled()) {
      return dice.reduce((acc, val) => acc * val, 1);
    }
    return dice.reduce((a, b) => a + b, 0);
  }

  getComboLabel(combo) {
    if (!combo) return '';
    const key = combo.key || '';
    switch (key) {
      case 'pair': return t('COMBO_PAIR', 'PAIR!');
      case 'twoPair': return t('COMBO_TWO_PAIR', 'TWO PAIR!');
      case 'triple': return t('COMBO_TRIPLE', 'TRIPLE!');
      case 'fullHouse': return t('COMBO_FULL_HOUSE', 'FULL HOUSE!');
      case 'fourOfAKind': return t('COMBO_FOUR_KIND', 'FOUR OF A KIND!');
      case 'fiveOfAKind': return t('COMBO_FIVE_KIND', 'FIVE OF A KIND!');
      case 'straight': return t('COMBO_STRAIGHT', 'STRAIGHT!');
      default: return combo.type || key;
    }
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

    const base = this.getBaseScore(dice);
    const combo = checkCombo(dice);

    const lines = [];
    lines.push(tf('SCORE_ROLLED', 'Rolled: {0}', dice.join(', ')));

    if (this.multiplexRulesEnabled()) {
      lines.push(tf('SCORE_MULTIPLEX_LINE', 'Multiplex Score: {0}', base));
    } else {
      lines.push(tf('SCORE_BASE_LINE', 'Base Score: {0}', base));
    }

    if (this.comboRulesEnabled() && combo) {
      const comboLabel = this.getComboLabel(combo);
      lines.push(tf('SCORE_COMBO_LINE', 'Combo: x{0} ({1})', (combo.multiplier || 1).toFixed(1), comboLabel));
    }

    const finalScore = (typeof scored === 'number') ? scored : base;
    lines.push(tf('SCORE_FINAL_LINE', 'Final Score: {0}', finalScore));

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
    this.roundTitle.setText(tf('ONLINE_ROUND_TITLE', 'Online Game - Round {0}/{1}', this.currentRound, this.gameConfig.rounds));
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

    this.timerText.setText(tf('GAME_TIMER', 'Time: {0}s', remaining));

    // Use Phaser timed event to tick every second so every client shows a countdown
    this.turnTimer = this.time.addEvent({
      delay: 1000,
      repeat: Math.max(0, remaining - 1),
      callback: () => {
        remaining--;
        this.timerText.setText(tf('GAME_TIMER', 'Time: {0}s', remaining));
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
    // Safety check: ensure timerText exists and is valid before calling setText
    if (this.timerText && this.timerText.active && this.timerText.data) {
      this.timerText.setText('');
    }
  }

  addBackButton() {
    const back = this.add.text(50, 50, t('UI_BACK', '<- Back'), { fontSize: 24, color: '#ff6666' }).setInteractive();
    back.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      if (this.exitLocked) {
        this.showConfirmExit();
      } else {
        this.scene.start('MenuScene');
      }
    });
  }

  handleEscPressed() {
    if (!this.exitLocked) {
      this.scene.start('MenuScene');
      return;
    }
    if (this.exitModal) {
      this.hideConfirmExit();
      return;
    }
    this.showConfirmExit();
  }

  showConfirmExit() {
    if (this.exitModal) return;
    const bg = this.add.rectangle(600, 300, 500, 250, 0x000000, 0.85);
    const msg = this.add.text(
      600,
      260,
      t('ONLINE_LEAVE_CONFIRM', 'Are you sure you want to leave the match? You may forfeit.'),
      { fontSize: 22, align: 'center' }
    ).setOrigin(0.5);
    const yesBtn = this.add.text(540, 340, t('UI_YES', 'Yes'), { fontSize: 26, color: '#66ff66' }).setOrigin(0.5).setInteractive();
    const noBtn = this.add.text(660, 340, t('UI_NO', 'No'), { fontSize: 26, color: '#ff6666' }).setOrigin(0.5).setInteractive();

    yesBtn.on('pointerdown', () => {
      // match server lobby manager's expected event
      this.hideConfirmExit();
      getSocket().emit('leave-lobby', this.roomCode);
      this.scene.start('MenuScene');
    });
    noBtn.on('pointerdown', () => {
      this.hideConfirmExit();
    });

    this.exitModal = { bg, msg, yesBtn, noBtn };
  }

  hideConfirmExit() {
    if (!this.exitModal) return;
    const { bg, msg, yesBtn, noBtn } = this.exitModal;
    if (bg) bg.destroy();
    if (msg) msg.destroy();
    if (yesBtn) yesBtn.destroy();
    if (noBtn) noBtn.destroy();
    this.exitModal = null;
  }

  // -----------------------
  // Cleanup
  // -----------------------
  shutdown() {
    this._sceneReady = false;
    
    // FIX: Remove visibility change listener
    if (this._handleVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._handleVisibilityChange);
      this._handleVisibilityChange = null;
    }
    
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
    this.cleanupHotkeys();
  }
}
