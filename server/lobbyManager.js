import { loadLobbies, saveLobby, saveLobbies, pruneLocalLobbies, deleteSupabaseLobby } from "./utils/lobbyStorage.js";
import { checkCombo } from "../client/utils/ComboManager.js";

export default class LobbyManager {
  constructor(io) {
    this.io = io;
    this.lobbies = {};
    this.activeGames = {};
    this.init();
  }

  async init() {
    // 1) load any existing DB state to populate this.lobbies
    await this.load();

    // 2) prune the local DB (this will write file if needed)
    try {
      const res = await pruneLocalLobbies();
      if (res && res.removedCount) {
        console.info(`[LobbyManager] initial prune removed ${res.removedCount} stale entries (remaining ${res.remainingCount})`);
      }
    } catch (err) {
      console.warn('[LobbyManager] initial pruneLocalLobbies failed:', err);
    }

    // 3) reload the cleaned storage into memory so this.lobbies is the canonical (pruned) view
    await this.load();

    // 4) start polling/prune intervals after initial sync
    this._pollHandle = setInterval(() => this.load().catch(err => {
      console.warn("[LobbyManager] periodic load failed:", err);
    }), this._pollIntervalMs || 60000);

    this._pruneHandle = setInterval(() => {
      pruneLocalLobbies().then(res => {
        if (res.removedCount && res.removedCount > 0) {
          console.info(`[LobbyManager] pruneLocalLobbies removed ${res.removedCount} stale entries (remaining ${res.remainingCount})`);
          // sync memory with disk after pruning
          return this.load();
        }
      }).catch(err => {
        console.warn("[LobbyManager] pruneLocalLobbies failed:", err);
      });
    }, this._pollIntervalMs || 60000);
  }

  // Load all lobbies from storage (defensive: supports array or map)
  async load() {
    try {
      const raw = await loadLobbies();
      if (!raw) {
        this.lobbies = {};
        return;
      }

      // If storage returned an array (e.g. supabase rows), convert into map keyed by code
      if (Array.isArray(raw)) {
        const map = {};
        for (const item of raw) {
          // expect item.code (or item.id) as unique key
          const key = (item.code || item.id || "").toString().trim().toUpperCase();
          if (!key) continue;
          // normalize structure: ensure players array and config exist
          map[key] = {
            code: key,
            hostSocketId: item.hostSocketId || item.host || null,
            hostUserId: item.hostUserId || item.hostUserId || item.hostUser || null,
            players: Array.isArray(item.players) ? item.players : (item.players ? JSON.parse(item.players) : []),
            config: item.config || (item.config_json ? item.config_json : { players: 2, rounds: 20, combos: false }),
            createdAt: item.createdAt || item.created_at || Date.now()
          };
        }
        this.lobbies = map;
      } else if (typeof raw === "object") {
        // assume map
        this.lobbies = { ...raw };
      } else {
        this.lobbies = {};
      }

      // Basic cleanup: ensure shapes are valid
      const now = Date.now();
      const EXPIRE_MS = 1000 * 60 * 60 * 3; // 3 hours
      let changed = false;
      for (const code of Object.keys(this.lobbies)) {
        const lobby = this.lobbies[code];
        if (!lobby || !Array.isArray(lobby.players) || !lobby.config) {
          delete this.lobbies[code];
          changed = true;
          continue;
        }
        if (lobby.players.length === 0) {
          delete this.lobbies[code];
          changed = true;
          continue;
        }
        if (now - (lobby.createdAt || 0) > EXPIRE_MS) {
          delete this.lobbies[code];
          changed = true;
          continue;
        }
      }

      if (changed) {
        try { await this.save(); } catch (e) { console.warn("[LobbyManager] save after cleanup failed:", e); }
      }
    } catch (err) {
      console.error("[LobbyManager] loadLobbies() failed:", err);
      // keep current in-memory lobbies if DB fails
    }
  }

  // Save entire map. The storage layer may implement this as a bulk replace or per-row upsert.
  async save() {
    try {
      await saveLobbies(this.lobbies || {});
    } catch (err) {
      console.error("[LobbyManager] saveLobbies() failed:", err);
      throw err;
    }
  }

  // Delete lobby (and persist)
  async deleteLobby(code) {
    if (!code) return;
    code = String(code).trim().toUpperCase();

    if (this.lobbies[code]) {
      delete this.lobbies[code];
    }

    try {
      // save to lowdb
      await this.save();

      // remove from Supabase
      await deleteSupabaseLobby(code);

    } catch (e) {
      console.warn("[LobbyManager] deleteLobby failed:", e);
    }
  }

  // Register socket connection + handlers
  async registerSocket(socket) {
    // refresh latest lobbies from DB before handling new socket
    try { await this.load(); } catch (e) { /* already logged */ }

    // ensure socket.data.user container exists
    socket.data.user = socket.data.user || null;

    // ---------- AUTH USER ----------
    socket.on("auth-user", async (user) => {
      // minimal sanitisation
      if (!user || !user.id) return;
      socket.data.user = { ...user, ready: false };
    });

    // ---------- CREATE LOBBY ----------
    socket.on("create-lobby", async (config = {}) => {
      if (!socket.data.user) return socket.emit("create-failed", { reason: "unauthenticated" });

      // ensure unique code (retry if collision)
      let code;
      for (let i = 0; i < 6; i++) {
        code = Math.random().toString(36).slice(2, 7).toUpperCase();
        if (!this.lobbies[code]) break;
        code = null;
      }
      if (!code) {
        // fallback: generate using timestamp
        code = ("L" + Date.now()).slice(-6).toUpperCase();
      }

      const lobby = {
        code,
        hostSocketId: socket.id,
        hostUserId: socket.data.user.id,
        players: [{ ...socket.data.user, id: socket.data.user.id, ready: false }],
        config: {
          players: config.players || 2,
          rounds: config.rounds || 20,
          combos: !!config.combos
        },
        createdAt: Date.now()
      };

      this.lobbies[code] = lobby;

      try {
        await this.save();
      } catch (e) {
        console.warn("[LobbyManager] failed to persist created lobby:", e);
      }

      socket.join(code);
      socket.emit("lobby-created", code);
      this.broadcastLobbyUpdate(code);
    });

    // ---------- JOIN LOBBY ----------
    socket.on("join-lobby", async (codeRaw) => {
      if (!socket.data.user) return socket.emit("join-failed", { reason: "unauthenticated" });
      if (typeof codeRaw !== "string") return socket.emit("join-failed", { reason: "invalid_code" });

      const code = codeRaw.trim().toUpperCase();
      const lobby = this.lobbies[code];
      if (!lobby) return socket.emit("join-failed", { reason: "notfound" });

      if (lobby.players.length >= (lobby.config?.players || 2)) {
        return socket.emit("join-failed", { reason: "full" });
      }

      const existing = lobby.players.find(p => String(p.id) === String(socket.data.user.id));
      if (!existing) {
        lobby.players.push({ ...socket.data.user, id: socket.data.user.id, ready: false });
        lobby.players = lobby.players.filter(Boolean).reduce((acc, p) => {
          if (!acc.find(x => String(x.id) === String(p.id))) acc.push(p);
          return acc;
        }, []);
        try { await this.save(); } catch (e) { console.warn("[LobbyManager] save after join failed:", e); }
      }

      socket.join(code);
      socket.emit("join-success", {
        code,
        players: lobby.players,
        hostSocketId: lobby.hostSocketId || lobby.host || null,
        hostUserId: lobby.hostUserId || lobby.hostUserId || null
      });
      this.broadcastLobbyUpdate(code);
    });

    // ---------- REQUEST LOBBY DATA ----------
    socket.on("request-lobby-data", async (codeRaw) => {
      if (typeof codeRaw !== "string") return;
      const code = codeRaw.trim().toUpperCase();
      const lobby = this.lobbies[code];
      if (!lobby) return;
      socket.emit("lobby-data", {
        code,
        players: lobby.players,
        hostSocketId: lobby.hostSocketId || lobby.host || null,
        hostUserId: lobby.hostUserId || lobby.hostUserId || null,
        config: lobby.config
      });
    });

    // ---------- REQUEST GAME STATE ----------
    socket.on("request-game-state", (payload) => {
      const code = (payload && payload.code) ? String(payload.code).trim().toUpperCase() : null;
      if (!code) return;
      const game = this.activeGames[code];
      if (!game) {
        // return lobby snapshot if game not started
        const lobby = this.lobbies[code];
        if (lobby) {
          const players = Array.isArray(lobby.players) ? lobby.players : [];
          const localIndex = players.findIndex(p => p.id === socket.data.user?.id);
          socket.emit("game-state", {
            players,
            config: lobby.config,
            room: code,
            localIndex: localIndex >= 0 ? localIndex : null
          });
        }
        return;
      }

      // server-authoritative game state
      const players = game.players.map(p => ({ id: p.id, name: p.name, score: p.score, comboStats: p.comboStats }));
      const localIndex = players.findIndex(p => p.id === socket.data.user?.id);

      socket.emit("game-state", {
        players,
        localIndex: localIndex >= 0 ? localIndex : null,
        scores: game.players.map(p => p.score),
        comboStats: game.players.map(p => p.comboStats),
        round: game.round,
        totalRounds: game.totalRounds,
        room: code,
        currentPlayerIndex: game.currentIndex,
        timeLimitSeconds: game.timeLimitSeconds,
        config: game.config,
        turnExpiresAt: game.turnExpiresAt || null
      });
    });

    // ---------- TOGGLE READY ----------
    socket.on("toggle-ready", async (codeRaw) => {
      if (typeof codeRaw !== "string") return;
      const code = codeRaw.trim().toUpperCase();
      const lobby = this.lobbies[code];
      if (!lobby) return;

      const player = lobby.players.find(p => String(p.id) === String(socket.data.user?.id));
      if (!player) return;

      player.ready = !player.ready;
      try { await this.save(); } catch (e) { console.warn("[LobbyManager] save after toggle-ready failed:", e); }
      this.broadcastLobbyUpdate(code);
    });

    // ---------- LEAVE LOBBY ----------
    socket.on("leave-lobby", async (codeRaw) => {
      if (typeof codeRaw !== "string") return;
      await this.removePlayerFromLobby(codeRaw.trim().toUpperCase(), socket);
    });

    // ---------- START GAME ----------
    socket.on("start-game", async (codeRaw) => {
      if (typeof codeRaw !== "string") return;
      const code = codeRaw.trim().toUpperCase();
      const lobby = this.lobbies[code];
      if (!lobby) return;

      // ensure host
      if (socket.id !== lobby.hostSocketId) return;

      const allReady = lobby.players.every(p => p.ready);
      if (!allReady || lobby.players.length < 2) return;

      // create game state
      const game = {
        code,
        config: lobby.config || { players: 2, rounds: 20, combos: false },
        players: lobby.players.map(p => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar || null,
          score: 0,
          comboStats: { pair:0, twoPair:0, triple:0, fullHouse:0, fourOfAKind:0, fiveOfAKind:0, straight:0 },
          hasRolled: false
        })),
        currentIndex: 0,
        round: 1,
        totalRounds: lobby.config?.rounds || 20,
        combosEnabled: !!lobby.config?.combos,
        turnTimer: null,
        turnExpiresAt: null,
        timeLimitSeconds: lobby.config?.timeLimitSeconds || 30
      };

      this.activeGames[code] = game;

      // notify clients (invite to transition)
      this.io.to(code).emit("game-starting", { code, config: lobby.config, players: lobby.players });

      // build per-socket state and send
      const statePayload = {
        config: game.config,
        players: game.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, connected: true })),
        scores: game.players.map(p => p.score),
        comboStats: game.players.map(p => p.comboStats),
        round: game.round,
        totalRounds: game.totalRounds,
        room: code,
        currentPlayerIndex: game.currentIndex,
        timeLimitSeconds: game.timeLimitSeconds,
        turnExpiresAt: game.turnExpiresAt || null
      };

      try {
        const roomSet = this.io.sockets.adapter.rooms.get(code);
        if (roomSet && roomSet.size) {
          for (const sid of roomSet) {
            const sock = this.io.sockets.sockets.get(sid);
            if (!sock) continue;
            const li = game.players.findIndex(p => p.id === sock.data?.user?.id);
            const personalized = { ...statePayload, localIndex: li >= 0 ? li : null };
            sock.emit("game-state", personalized);
          }
        } else {
          this.io.to(code).emit("game-state", statePayload);
        }
      } catch (err) {
        console.warn("[LobbyManager] per-socket game-state failed, broadcasting fallback", err);
        this.io.to(code).emit("game-state", statePayload);
      }

      // small delays to allow clients to transition and register handlers
      setTimeout(() => this.io.to(code).emit("game-state", statePayload), 80);
      setTimeout(() => this.startTurn(code), 180);
    });

    // ---------- PLAYER ROLL ----------
    socket.on("player-roll", ({ code } = {}) => {
      if (!code || typeof code !== "string") return;
      const codeU = code.trim().toUpperCase();
      const game = this.activeGames[codeU];
      if (!game) return;

      const playerIndex = game.currentIndex;
      const player = game.players[playerIndex];
      if (!player) return;

      // ensure this socket is the active player
      if (player.id !== socket.data.user?.id) return;

      // announce rolling
      this.io.to(codeU).emit("player-rolling", { playerIndex });

      if (game.turnTimer) { clearTimeout(game.turnTimer); game.turnTimer = null; }

      setTimeout(() => {
        const dice = this.rollDice(5);
        const { points, combo } = this.calculateScore(dice, game.combosEnabled);

        player.score += points;
        if (combo && combo.key) player.comboStats[combo.key] = (player.comboStats[combo.key] || 0) + 1;
        player.hasRolled = true;

        const graceMs = 10_000;
        game.turnExpiresAt = Date.now() + graceMs;

        this.io.to(codeU).emit("turn-result", {
          playerIndex,
          dice,
          scored: points,
          combo: combo || null,
          scores: game.players.map(p => p.score),
          comboStats: game.players.map(p => p.comboStats),
          round: game.round,
          turnExpiresAt: game.turnExpiresAt
        });

        if (game.turnTimer) { clearTimeout(game.turnTimer); game.turnTimer = null; }
        game.turnTimer = setTimeout(() => this.advanceTurn(codeU), graceMs);
      }, 700);
    });

    // ---------- PLAYER END TURN ----------
    socket.on("player-end-turn", ({ code, playerIndex } = {}) => {
      if (!code || typeof code !== "string") return;
      const codeU = code.trim().toUpperCase();
      const game = this.activeGames[codeU];
      if (!game) return;

      const currentPlayer = game.players[game.currentIndex];
      if (!currentPlayer || currentPlayer.id !== socket.data.user?.id) return;

      if (!currentPlayer.hasRolled) {
        socket.emit("end-turn-failed", { reason: "not_rolled" });
        return;
      }

      this.advanceTurn(codeU);
    });

    // ---------- PLAYER TIMEOUT ----------
    socket.on("player-timeout", ({ code } = {}) => {
      if (!code || typeof code !== "string") return;
      const codeU = code.trim().toUpperCase();
      const game = this.activeGames[codeU];
      if (!game) return;

      const currentPlayer = game.players[game.currentIndex];
      if (!currentPlayer || currentPlayer.id !== socket.data.user?.id) return;

      this.handleTimeout(codeU);
    });

    // ---------- GAME FINISHED ----------
    socket.on("game-finished", async (codeRaw) => {
      if (!codeRaw || typeof codeRaw !== "string") return;
      const code = codeRaw.trim().toUpperCase();

      await this.deleteLobby(code);
      this.io.to(code).emit("lobby-deleted", { code });
      if (this.activeGames[code]) delete this.activeGames[code];
    });

    // ---------- DISCONNECT ----------
    socket.on("disconnect", async () => {
      // remove this socket's user from any lobby where they are a member
      const uid = socket.data.user?.id;
      if (!uid) return;

      // Iterate lobbies and only call removePlayerFromLobby when this user is present
      const codes = Object.keys(this.lobbies);
      for (const code of codes) {
        const lobby = this.lobbies[code];
        if (!lobby || !Array.isArray(lobby.players)) continue;
        const found = lobby.players.find(p => String(p.id) === String(uid));
        if (found) {
          try {
            await this.removePlayerFromLobby(code, socket);
          } catch (e) {
            console.warn("[LobbyManager] removePlayerFromLobby during disconnect failed:", e);
          }
        }
      }
    });
  }

  // Remove player (and handle host transfer / cleanup)
  async removePlayerFromLobby(codeRaw, socket) {
  if (!codeRaw || typeof codeRaw !== "string") return;
  const code = codeRaw.trim().toUpperCase();

  const lobby = this.lobbies[code];
  if (!lobby) {
    const gameOnly = this.activeGames[code];
    if (gameOnly) {
      const beforeLen = gameOnly.players.length;
      gameOnly.players = gameOnly.players.filter(p => p.id !== socket.data.user?.id);
      if (gameOnly.players.length !== beforeLen) {
        if (gameOnly.currentIndex >= gameOnly.players.length) gameOnly.currentIndex = 0;
        this.io.to(code).emit("player-left", { id: socket.data.user?.id });
        if (gameOnly.players.length === 1) {
          this.io.to(code).emit("game-finished", {
            code,
            scores: gameOnly.players.map(p => p.score),
            comboStats: gameOnly.players.map(p => p.comboStats),
            names: gameOnly.players.map(p => p.name),
            players: gameOnly.players
          });
          delete this.activeGames[code];
        }
      }
    }
    return;
  }

  // remove the player (by user id)
  const before = lobby.players.length;
  const removedId = String(socket.data.user?.id);
  lobby.players = lobby.players.filter(p => String(p.id) !== removedId);

  // If nothing changed, nothing to do
  if (lobby.players.length === before) return;

  // ---------- CASE: lobby now empty -> delete the lobby ----------
  if (lobby.players.length === 0) {
    if (this.lobbies[code]) delete this.lobbies[code];

    try {
      await this.save();
    } catch (e) {
      console.warn("[LobbyManager] save after removing last player failed:", e);
    }

    try {
      await deleteSupabaseLobby(code);
    } catch (e) {
      console.warn("[LobbyManager] deleteSupabaseLobby failed while deleting empty lobby:", e);
    }

    // notify room (clients can handle lobby-deleted)
    try { this.io.to(code).emit("lobby-deleted", { code }); } catch (e) {}
    return;
  }

  // ---------- CASE: lobby still has players -> ensure host is valid ----------
  // If hostUserId no longer present among players or hostSocketId invalid, transfer host to first player
  const remainingIds = new Set(lobby.players.map(p => String(p.id)));
  if (!lobby.hostUserId || !remainingIds.has(String(lobby.hostUserId))) {
    const newHostUser = lobby.players[0];
    lobby.hostUserId = newHostUser.id;
    const newHostSocket = [...this.io.sockets.sockets.values()].find(s => String(s.data?.user?.id) === String(newHostUser.id));
    lobby.hostSocketId = newHostSocket ? newHostSocket.id : null;
  } else {
    if (lobby.hostSocketId) {
      const sockExists = Boolean(this.io.sockets.sockets.get(lobby.hostSocketId));
      if (!sockExists) {
        const newHostSocket = [...this.io.sockets.sockets.values()].find(s => String(s.data?.user?.id) === String(lobby.hostUserId));
        lobby.hostSocketId = newHostSocket ? newHostSocket.id : null;
      }
    }
  }

  // persist changes and broadcast update
  try {
    await this.save();
  } catch (e) {
    console.warn("[LobbyManager] save after removePlayer failed:", e);
  }

  this.broadcastLobbyUpdate(code);

  // If there is an active game associated with this room, remove the player from it too
  const game = this.activeGames[code];
  if (game) {
    const beforeLen = game.players.length;
    game.players = game.players.filter(p => String(p.id) !== removedId);

    this.io.to(code).emit("player-left", { id: removedId });

    if (game.players.length === 0) {
      delete this.activeGames[code];
      return;
    }

    if (game.currentIndex >= game.players.length) {
      game.currentIndex = 0;
    }

    if (game.players.length === 1) {
      this.io.to(code).emit("game-finished", { code, players: game.players });
      delete this.activeGames[code];
      return;
    }

    try {
      const payload = {
        players: game.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar || null, connected: true })),
        scores: game.players.map(p => p.score),
        comboStats: game.players.map(p => p.comboStats),
        round: game.round,
        totalRounds: game.totalRounds,
        room: code,
        currentPlayerIndex: game.currentIndex,
        timeLimitSeconds: game.timeLimitSeconds || 30,
        turnExpiresAt: game.turnExpiresAt || null
      };
      this.io.to(code).emit('game-state', payload);
    } catch (err) {
      console.warn("[LobbyManager] emit game-state after player-left failed:", err);
    }

    // small delay so clients process the game-state update before server starts the next turn
    setTimeout(() => {
      try {
        const g = this.activeGames[code];
        if (g && g.players && g.players.length > 1) {
          this.startTurn(code);
        }
      } catch (e) {
        console.warn("[LobbyManager] deferred startTurn failed:", e);
      }
    }, 120);
  }
}

  // Broadcast lobby update to room
  broadcastLobbyUpdate(code) {
    const lobby = this.lobbies[code];
    if (!lobby) return;
    this.io.to(code).emit("lobby-updated", {
      code,
      players: lobby.players,
      hostSocketId: lobby.hostSocketId,
      hostUserId: lobby.hostUserId,
      config: lobby.config
    });
  }

  // Emit authoritative game-state (personalized per socket)
  emitGameState(code) {
    const game = this.activeGames[code];
    if (!game) return;

    const statePayloadBase = {
      players: game.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, connected: true })),
      scores: game.players.map(p => p.score),
      comboStats: game.players.map(p => p.comboStats),
      round: game.round,
      totalRounds: game.totalRounds,
      room: code,
      currentPlayerIndex: game.currentIndex,
      timeLimitSeconds: game.timeLimitSeconds
    };

    try {
      const roomSet = this.io.sockets.adapter.rooms.get(code);
      if (roomSet && roomSet.size) {
        for (const sid of roomSet) {
          const sock = this.io.sockets.sockets.get(sid);
          if (!sock) continue;
          const li = game.players.findIndex(p => p.id === sock.data?.user?.id);
          const personalized = { ...statePayloadBase, localIndex: li >= 0 ? li : null };
          sock.emit('game-state', personalized);
        }
      } else {
        this.io.to(code).emit('game-state', statePayloadBase);
      }
    } catch (err) {
      console.warn('[LobbyManager] emitGameState failed, falling back to broadcast', err);
      this.io.to(code).emit('game-state', statePayloadBase);
    }
  }

  // Start a server-authoritative turn
  startTurn(code) {
    const game = this.activeGames[code];
    if (!game) return;

    const playerIndex = game.currentIndex;
    const player = game.players[playerIndex];
    if (!player) return;

    player.hasRolled = false;

    const timeLimitSeconds = typeof game.timeLimitSeconds === 'number' ? game.timeLimitSeconds : 30;
    game.turnExpiresAt = Date.now() + (timeLimitSeconds * 1000);

    this.io.to(code).emit("turn-start", {
      playerIndex,
      currentPlayerIndex: playerIndex,
      round: game.round,
      timeLimitSeconds,
      scores: game.players.map(p => p.score),
      comboStats: game.players.map(p => p.comboStats),
      turnExpiresAt: game.turnExpiresAt
    });

    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
      game.turnTimer = null;
    }

    game.turnTimer = setTimeout(() => this.handleTimeout(code), timeLimitSeconds * 1000);
  }

  // Utility: roll N dice
  rollDice(count = 5) {
    return Array.from({ length: count }, () => Math.ceil(Math.random() * 6));
  }

  calculateScore(dice = [], combosEnabled) {
    const base = Array.isArray(dice) && dice.length ? dice.reduce((a, b) => a + b, 0) : 0;
    const combo = checkCombo(dice);

    const points = (combo && combosEnabled)
      ? Math.floor(base * (combo.multiplier || 1))
      : base;

    return { points, combo };
  }

  applyBonus(dice, baseScore, combosEnabled) {
    if (!combosEnabled) return baseScore;
    const combo = checkCombo(dice);
    if (!combo) return baseScore;
    return Math.floor(baseScore * (combo.multiplier || 1));
  }

  handleTimeout(code) {
    const game = this.activeGames[code];
    if (!game) return;

    const playerIndex = game.currentIndex;
    const player = game.players[playerIndex];
    if (!player) return;

    const dice = this.rollDice(5);
    const { points, combo } = this.calculateScore(dice, game.combosEnabled);

    player.score += points;
    if (combo && combo.key) player.comboStats[combo.key] = (player.comboStats[combo.key] || 0) + 1;

    game.turnExpiresAt = Date.now() + 3000;

    this.io.to(code).emit("player-timeout", {
      playerIndex,
      dice,
      scored: points,
      combo: combo || null,
      scores: game.players.map(p => p.score),
      comboStats: game.players.map(p => p.comboStats),
      round: game.round,
      turnExpiresAt: game.turnExpiresAt
    });

    setTimeout(() => this.advanceTurn(code), 3000);
  }

  advanceTurn(code) {
    const game = this.activeGames[code];
    if (!game) return;

    if (game.turnTimer) { clearTimeout(game.turnTimer); game.turnTimer = null; }

    game.currentIndex++;

    if (game.currentIndex >= game.players.length) {
      game.currentIndex = 0;
      game.round++;

      if (game.round > game.totalRounds) {
        this.io.to(code).emit("game-finished", {
          code,
          scores: game.players.map(p => p.score),
          comboStats: game.players.map(p => p.comboStats),
          names: game.players.map(p => p.name),
          players: game.players
        });
        delete this.activeGames[code];
        return;
      }
    }

    this.startTurn(code);
  }

  // Clean up poll interval if manager is disposed
  dispose() {
    if (this._pollHandle) {
      clearInterval(this._pollHandle);
      this._pollHandle = null;
    }
    if (this._pruneHandle) {
      clearInterval(this._pruneHandle);
      this._pruneHandle = null;
    }
  }
}