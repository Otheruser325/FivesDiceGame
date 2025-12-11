import { loadLobbies, saveLobbies } from "./utils/lobbyStorage.js";
import { checkCombo } from "../client/utils/ComboManager.js";

export default class LobbyManager {
  constructor(io) {
    this.io = io;
    // Periodically clean up lobbies
    setInterval(() => this.load(), 60_000);
    this.lobbies = {};
    this.activeGames = {}; // keyed by lobby code
  }

  async load() {
    this.lobbies = (await loadLobbies()) || {};

    const now = Date.now();
    const EXPIRE_MS = 1000 * 60 * 60 * 3; // 3 hours

    let changed = false;
    for (const code of Object.keys(this.lobbies)) {
      const lobby = this.lobbies[code];
      if (!lobby || !lobby.players || !Array.isArray(lobby.players) || !lobby.config) {
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

    if (changed) await this.save();
  }

  async save() {
    await saveLobbies(this.lobbies);
  }

  async deleteLobby(code) {
    if (this.lobbies[code]) {
      delete this.lobbies[code];
      await this.save();
    }
  }

  async registerSocket(socket) {
    await this.load();

    // ensure socket has data.user container
    socket.data.user = socket.data.user || null;

    // -----------------------------
    // AUTH USER
    // -----------------------------
    socket.on("auth-user", async (user) => {
      socket.data.user = {
        ...user,
        ready: false
      };
    });

    // -----------------------------
    // CREATE LOBBY
    // -----------------------------
    socket.on("create-lobby", async (config = {}) => {
      if (!socket.data.user) return;

      const code = Math.random().toString(36).slice(2, 7).toUpperCase();
      this.lobbies[code] = {
        hostSocketId: socket.id,
        hostUserId: socket.data.user.id,
        players: [
          { ...socket.data.user, id: socket.data.user.id, ready: false }
        ],
        config: {
          players: config.players || 2,
          rounds: config.rounds || 20,
          combos: !!config.combos
        },
        createdAt: Date.now()
      };

      await this.save();
      socket.join(code);
      socket.emit("lobby-created", code);
      this.broadcastLobbyUpdate(code);
    });

    // -----------------------------
    // JOIN LOBBY
    // -----------------------------
    socket.on("join-lobby", async (code) => {
      if (typeof code !== "string") return socket.emit("join-failed", { reason: "notfound" });
      code = code.trim().toUpperCase();

      const lobby = this.lobbies[code];
      if (!lobby) return socket.emit("join-failed", { reason: "notfound" });
      if (!socket.data.user) return socket.emit("join-failed", { reason: "unauthenticated" });

      if (lobby.players.length >= (lobby.config?.players || 2)) {
        return socket.emit("join-failed", { reason: "full" });
      }

      const existing = lobby.players.find(p => p.id === socket.data.user.id);
      if (!existing) {
        lobby.players.push({ ...socket.data.user, ready: false });
        await this.save();
      }

      socket.join(code);
      socket.emit("join-success", {
        code,
        players: lobby.players,
        hostSocketId: lobby.hostSocketId || lobby.host,
        hostUserId: lobby.hostUserId || lobby.hostUserId
      });
      this.broadcastLobbyUpdate(code);
    });

    // -----------------------------
    // REQUEST LOBBY DATA
    // -----------------------------
    socket.on("request-lobby-data", async (code) => {
      if (typeof code !== "string") return;
      code = code.trim().toUpperCase();
      const lobby = this.lobbies[code];
      if (!lobby) return;
      socket.emit("lobby-data", {
        code,
        players: lobby.players,
        hostSocketId: lobby.hostSocketId || lobby.host,
        hostUserId: lobby.hostUserId || lobby.hostUserId,
        config: lobby.config
      });
    });

    // -----------------------------
    // REQUEST GAME STATE (client in OnlineGameScene calls this)
    // -----------------------------
    socket.on("request-game-state", (payload) => {
      const code = (payload && payload.code) ? String(payload.code).trim().toUpperCase() : null;
      if (!code) return;
      const game = this.activeGames[code];
      if (!game) {
        // If game hasn't started yet, return lobby snapshot
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

      // Build players payload (id,name,score,comboStats)
      const players = game.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        comboStats: p.comboStats
      }));

      // find local index for this socket
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

    // -----------------------------
    // READY TOGGLE
    // -----------------------------
    socket.on("toggle-ready", async (code) => {
      const lobby = this.lobbies[code];
      if (!lobby) return;
      const player = lobby.players.find(p => p.id === socket.data.user?.id);
      if (!player) return;
      player.ready = !player.ready;
      await this.save();
      this.broadcastLobbyUpdate(code);
    });

    // -----------------------------
    // LEAVE LOBBY
    // -----------------------------
    socket.on("leave-lobby", async (code) => {
      if (typeof code !== "string") return;
      await this.removePlayerFromLobby(code.trim().toUpperCase(), socket);
    });

    // -----------------------------
    // START GAME (host only)
    // -----------------------------
    socket.on("start-game", async (code) => {
      if (typeof code !== "string") return;
      code = code.trim().toUpperCase();
      const lobby = this.lobbies[code];
      if (!lobby) return;

      // check host by socket id stored in lobby
      if (socket.id !== lobby.hostSocketId) return;

      const allReady = lobby.players.every(p => p.ready);
      if (!allReady || lobby.players.length < 2) return;

      // create authoritative active game state
      this.activeGames[code] = {
        code,
        config: lobby.config || { players: 2, rounds: 20, combos: false },
        players: lobby.players.map(p => ({
          id: p.id,
          name: p.name,
          score: 0,
          comboStats: {
            pair: 0,
            twoPair: 0,
            triple: 0,
            fullHouse: 0,
            fourOfAKind: 0,
            fiveOfAKind: 0,
            straight: 0
          },
          hasRolled: false
        })),
        currentIndex: 0,
        round: 1,
        totalRounds: lobby.config?.rounds || 20,
        combosEnabled: !!lobby.config?.combos,
        turnTimer: null,
        turnExpiresAt: null
      };

      // small debug
      console.log(`[LobbyManager] game started in ${code}, players:`, lobby.players.map(p => p.name));

      // notify clients (lobby -> game)
      this.io.to(code).emit("game-starting", {
        code,
        config: lobby.config,
        players: lobby.players
      });

      const game = this.activeGames[code];
      const statePayload = {
        config: this.activeGames[code].config,
        players: game.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, connected: true })),
        localIndex: null,
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
        // room is a Set of socket ids
        const roomSet = this.io.sockets.adapter.rooms.get(code);
        if (roomSet && roomSet.size) {
          for (const sid of roomSet) {
            const sock = this.io.sockets.sockets.get(sid);
            if (!sock) continue;
            const li = game.players.findIndex(p => p.id === sock.data?.user?.id);
            const personalized = {
              ...statePayload,
              localIndex: li >= 0 ? li : null
            };
            sock.emit("game-state", personalized);
          }
        } else {
          // fallback: broadcast if we can't enumerate room sockets
          this.io.to(code).emit("game-state", statePayload);
        }
      } catch (err) {
        console.warn('[LobbyManager] failed to send per-socket game-state, falling back to broadcast', err);
        this.io.to(code).emit("game-state", statePayload);
      }

      // small delay so clients can transition and register handlers
      setTimeout(() => {
        this.io.to(code).emit("game-state", statePayload);
      }, 80); // 50–100ms works well in local testing

      // give a bit more time before actually starting the first turn (server will still call startTurn)
      setTimeout(() => {
        this.startTurn(code);
      }, 180);
    });

    // -----------------------------
    // PLAYER ROLL (client requests roll)
    // -----------------------------
    socket.on("player-roll", ({ code }) => {
  if (!code || typeof code !== "string") return;
  code = code.trim().toUpperCase();
  const game = this.activeGames[code];
  if (!game) return;

  // authoritative player index & id
  const playerIndex = game.currentIndex;
  const player = game.players[playerIndex];
  if (!player) return;

  // only allow the player whose id matches the request socket
  if (player.id !== socket.data.user?.id) return;

  // announce to the room that this player has started rolling (for UI flair)
  this.io.to(code).emit("player-rolling", { playerIndex });

  // clear any existing turnTimer set by startTurn
  if (game.turnTimer) {
    clearTimeout(game.turnTimer);
    game.turnTimer = null;
  }

  // add a short processing delay so clients have time to animate "rolling"
  setTimeout(() => {
    // perform server-side dice roll
    const dice = this.rollDice(5);

    // score
    const { points, combo } = this.calculateScore(dice, game.combosEnabled);

    // apply points & combo stats (server authoritative)
    player.score += points;
    if (combo && combo.key) {
      player.comboStats[combo.key] = (player.comboStats[combo.key] || 0) + 1;
    }

    player.hasRolled = true;

    const graceMs = 10_000;
    game.turnExpiresAt = Date.now() + graceMs;

    // broadcast authoritative result
    this.io.to(code).emit("turn-result", {
      playerIndex,
      dice,
      scored: points,
      combo: combo || null,
      scores: game.players.map(p => p.score),
      comboStats: game.players.map(p => p.comboStats),
      round: game.round,
      turnExpiresAt: game.turnExpiresAt
    });

    // schedule auto-advance after a longer grace period so player can press End Turn (client enables after 3s)
    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
      game.turnTimer = null;
    }
    game.turnTimer = setTimeout(() => this.advanceTurn(code), graceMs);
  }, 700); // 700ms delay to let clients animate
});

    // -----------------------------
    // PLAYER END TURN
    // -----------------------------
    socket.on('player-end-turn', ({ code, playerIndex } = {}) => {
      if (!code || typeof code !== 'string') return;
      code = code.trim().toUpperCase();
      const game = this.activeGames[code];
      if (!game) return;

      const currentPlayer = game.players[game.currentIndex];
      if (!currentPlayer || currentPlayer.id !== socket.data.user?.id) return;

      if (!currentPlayer.hasRolled) {
        socket.emit('end-turn-failed', { reason: 'not_rolled' });
        return;
      }

      this.advanceTurn(code);
    });

    // -----------------------------
    // PLAYER TIMEOUT
    // -----------------------------
    socket.on('player-timeout', ({ code, playerIndex } = {}) => {
      if (!code || typeof code !== 'string') return;
      code = code.trim().toUpperCase();
      const game = this.activeGames[code];
      if (!game) return;

      const currentPlayer = game.players[game.currentIndex];
      if (!currentPlayer || currentPlayer.id !== socket.data.user?.id) return;

      // call authoritative handler (server will roll/advance)
      this.handleTimeout(code);
    });

    // -----------------------------
    // GAME FINISHED (manual cleanup)
    // -----------------------------
    socket.on("game-finished", async (code) => {
      if (!code || typeof code !== "string") return;
      code = code.trim().toUpperCase();
      await this.deleteLobby(code);
      this.io.to(code).emit("lobby-deleted", { code });
      if (this.activeGames[code]) delete this.activeGames[code];
    });

    // -----------------------------
    // DISCONNECT handler
    // -----------------------------
    socket.on("disconnect", async () => {
      for (const code of Object.keys(this.lobbies)) {
        await this.removePlayerFromLobby(code, socket);
      }
    });
  }

  // -----------------------------------------------------
  //  REMOVE PLAYER / HOST TRANSFER / AUTO-DELETE EMPTY
  // -----------------------------------------------------
  async removePlayerFromLobby(code, socket) {
    if (!code || typeof code !== "string") return;
    const lobby = this.lobbies[code];
    if (!lobby) {
      // If no lobby, still check active game
      const gameOnly = this.activeGames[code];
      if (gameOnly) {
        // remove player if present
        const beforeLen = gameOnly.players.length;
        gameOnly.players = gameOnly.players.filter(p => p.id !== socket.data.user?.id);
        if (gameOnly.players.length !== beforeLen) {
          // if currentIndex out of bounds, clamp
          if (gameOnly.currentIndex >= gameOnly.players.length) gameOnly.currentIndex = 0;
          this.io.to(code).emit("player-left", { id: socket.data.user?.id });
          // if only one left -> finish game
          if (gameOnly.players.length === 1) {
            this.io.to(code).emit("game-finished", { code, players: gameOnly.players });
            delete this.activeGames[code];
          }
        }
      }
      return;
    }

    const before = lobby.players.length;
    lobby.players = lobby.players.filter(p => p.id !== (socket.data.user?.id || null));

    if (lobby.players.length !== before) {
      if (socket.id === lobby.hostSocketId) {
        if (lobby.players.length > 0) {
          const newHostUser = lobby.players[0];
          const newHostSocket = [...this.io.sockets.sockets.values()].find(s => s.data?.user?.id === newHostUser.id);
          if (newHostSocket) {
            lobby.hostSocketId = newHostSocket.id;
            lobby.hostUserId = newHostUser.id;
          } else {
            lobby.hostUserId = newHostUser.id;
            lobby.hostSocketId = null;
          }
        } else {
          await this.deleteLobby(code);
          return;
        }
      }

      await this.save();
      this.broadcastLobbyUpdate(code);
    }

    // If an active game exists, remove player from it as well
    const game = this.activeGames[code];
    if (game) {
      const beforeLen = game.players.length;
      game.players = game.players.filter(p => p.id !== socket.data.user?.id);

      // broadcast player-left for clients
      this.io.to(code).emit("player-left", { id: socket.data.user?.id });

      // adjust currentIndex if needed
      if (game.players.length === 0) {
        // no players left -> cleanup
        delete this.activeGames[code];
        return;
      }

      if (game.currentIndex >= game.players.length) {
        game.currentIndex = 0;
      }

      // if only one player left -> finish game
      if (game.players.length === 1) {
        this.io.to(code).emit("game-finished", { code, players: game.players });
        delete this.activeGames[code];
        return;
      }

      this.startTurn(code);
    }
  }

  // -----------------------------------------------------
  //  BROADCAST LOBBY UPDATE
  // -----------------------------------------------------
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
    timeLimitSeconds: 30
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

  // -----------------------------------------------------
  //  START TURN (server authoritative)
  // -----------------------------------------------------
  startTurn(code) {
  const game = this.activeGames[code];
  if (!game) return;

  const playerIndex = game.currentIndex;
  const player = game.players[playerIndex];
  if (!player) return;

  // reset hasRolled for current player
  player.hasRolled = false;

  // compute expire timestamp
  const timeLimitSeconds = typeof game.timeLimitSeconds === 'number' ? game.timeLimitSeconds : 30;
  game.turnExpiresAt = Date.now() + (timeLimitSeconds * 1000);

  // broadcast turn-start (include server expire timestamp)
  this.io.to(code).emit("turn-start", {
    playerIndex,
    currentPlayerIndex: playerIndex,
    round: game.round,
    timeLimitSeconds,
    scores: game.players.map(p => p.score),
    comboStats: game.players.map(p => p.comboStats),
    turnExpiresAt: game.turnExpiresAt
  });

  // clear existing timer
  if (game.turnTimer) {
    clearTimeout(game.turnTimer);
    game.turnTimer = null;
  }

  // set server timeout that auto-rolls (AFK) at expiry
  game.turnTimer = setTimeout(() => this.handleTimeout(code), timeLimitSeconds * 1000);
}

  // -----------------------------------------------------
  //  ROLL HELPERS
  // -----------------------------------------------------
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

  // -----------------------------------------------------
  //  TIMEOUT (AFK) HANDLING
  // -----------------------------------------------------
  handleTimeout(code) {
    const game = this.activeGames[code];
    if (!game) return;

    const playerIndex = game.currentIndex;
    const player = game.players[playerIndex];
    if (!player) return;

    const dice = this.rollDice(5);
    const { points, combo } = this.calculateScore(dice, game.combosEnabled);

    // apply result
    player.score += points;
    if (combo && combo.key) player.comboStats[combo.key] = (player.comboStats[combo.key] || 0) + 1;

    // broadcast an AFK/timeout result (client can show different UI)
    // set a small post-timeout display window (3s)

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

    // advance immediately (or after short delay)
    setTimeout(() => this.advanceTurn(code), 3000);
  }

  // -----------------------------------------------------
  //  ADVANCE TURN
  // -----------------------------------------------------
  advanceTurn(code) {
    const game = this.activeGames[code];
    if (!game) return;

    // clear any pending timer
    if (game.turnTimer) {
      clearTimeout(game.turnTimer);
      game.turnTimer = null;
    }

    game.currentIndex++;

    // if end of round
    if (game.currentIndex >= game.players.length) {
      game.currentIndex = 0;
      game.round++;

      // game finished?
      if (game.round > game.totalRounds) {
        this.io.to(code).emit("game-finished", {
          code,
          players: game.players
        });
        delete this.activeGames[code];
        return;
      }
    }

    // start next turn
    this.startTurn(code);
  }
}