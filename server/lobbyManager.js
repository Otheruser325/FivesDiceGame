import { loadLobbies, saveLobby, saveLobbies, pruneLocalLobbies, deleteSupabaseLobby } from "./utils/lobbyStorage.js";
import { checkCombo } from "../client/utils/ComboManager.js";
import { getUsernameFromDB, getActivePlayers, normalizeAllPlayers } from "./utils/playerStateManager.js";
import { loadUser } from "./utils/userStorage.js";
import LeaderboardManager from "./utils/leaderboardManager.js";

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

    // 5) start server-side lobby pruning (clean up dead lobbies and games)
    this._serverPruneHandle = setInterval(() => {
      this.pruneInMemoryLobbies();
    }, 5 * 60 * 1000); // Prune every 5 minutes
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
            hostsocketid: item.hostsocketid || item.host || null,
            hostuserid: item.hostuserid || item.hostuser || null,
            players: Array.isArray(item.players) ? item.players : (item.players ? JSON.parse(item.players) : []),
            config: item.config || (item.config_json ? item.config_json : { players: 2, rounds: 20, combos: false }),
            createdAt: item.createdAt || item.created_at || Date.now(),
            updatedAt: item.updatedAt || item.updated_at || Date.now()
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

  // Helper: Ensure socket has user data (try auto-auth if missing)
  ensureAuthenticated(socket) {
    // If already authenticated, return true
    if (socket.data.user && socket.data.user.id) {
      return true;
    }

    // Try to auto-authenticate from session if available
    if (socket.request && socket.request.user && !socket.data.authEmitted) {
      try {
        socket.data.user = {
          id: String(socket.request.user.id).trim(),
          name: (socket.request.user.name && String(socket.request.user.name).trim().substring(0, 32)) || `Guest${String(socket.request.user.id).substring(0, 6)}`,
          type: (socket.request.user.type && String(socket.request.user.type).trim()) || 'guest'
        };
        socket.data.authEmitted = true;
        console.log(`[LobbyManager] ✅ Auto-authenticated socket as: ${socket.data.user.name} (from session)`);
        socket.emit('auth-success', {
          user: socket.data.user,
          socketid: socket.id,
          timestamp: Date.now(),
          autoAuth: true
        });
        return true;
      } catch (err) {
        console.warn('[LobbyManager] Auto-auth from session failed:', err?.message);
        return false;
      }
    }

    return false;
  }

  // Register socket connection + handlers
  async registerSocket(socket) {
    // refresh latest lobbies from DB before handling new socket
    try { await this.load(); } catch (e) { /* already logged */ }

    // ensure socket.data.user container exists
    socket.data.user = socket.data.user || null;
    socket.data.authAttempts = 0;
    socket.data.lastHeartbeat = Date.now();

    // ✅ AUTO-AUTH: Try to authenticate from request session if available
    // ✅ FIX: Only emit auth-success once per socket, mark as handled to prevent duplicate events
    if (socket.request && socket.request.user && !socket.data.authEmitted) {
      try {
        socket.data.user = {
          id: String(socket.request.user.id).trim(),
          name: (socket.request.user.name && String(socket.request.user.name).trim().substring(0, 32)) || `Guest${String(socket.request.user.id).substring(0, 6)}`,
          type: (socket.request.user.type && String(socket.request.user.type).trim()) || 'guest'
        };
        // Mark that we've emitted auth success to prevent duplicates
        socket.data.authEmitted = true;
        console.log(`[LobbyManager] ✅ Auto-authenticated socket as: ${socket.data.user.name} (from session)`);
        socket.emit('auth-success', {
          user: socket.data.user,
          socketid: socket.id,
          timestamp: Date.now(),
          autoAuth: true
        });
      } catch (err) {
        console.warn('[LobbyManager] Auto-auth from session failed:', err?.message);
      }
    }

    // ---------- HEARTBEAT / KEEPALIVE ----------
    socket.on('ping', () => {
      socket.data.lastHeartbeat = Date.now();
      socket.emit('pong', { timestamp: Date.now() });
    });

    // ---------- AUTH USER ----------
    socket.on("auth-user", async (user) => {
      try {
        socket.data.authAttempts = (socket.data.authAttempts || 0) + 1;
        
        // ✅ CRITICAL: Proper null user handling
        if (!user) {
          console.warn(`[LobbyManager] auth-user: received null user (attempt ${socket.data.authAttempts})`);
          socket.emit('auth-failed', { 
            reason: 'null_user',
            message: 'User object is null',
            attempt: socket.data.authAttempts
          });
          return;
        }

        if (!user.id) {
          console.warn(`[LobbyManager] auth-user: user missing id`);
          socket.emit('auth-failed', { 
            reason: 'missing_id',
            message: 'User ID is missing',
            attempt: socket.data.authAttempts
          });
          return;
        }
        
        // ✅ Build user object safely
        socket.data.user = { 
          id: String(user.id).trim(),
          name: (user.name && String(user.name).trim().substring(0, 32)) || `Guest${String(user.id).substring(0, 6)}`,
          type: (user.type && String(user.type).trim()) || 'guest'
        };
        
        socket.data.lastHeartbeat = Date.now();
        
        console.log(`[LobbyManager] ✅ Socket authenticated as: ${socket.data.user.name}`);
        
        // ✅ Confirm auth to client
        socket.emit('auth-success', { 
          user: socket.data.user,
          socketid: socket.id,
          timestamp: Date.now()
        });
      } catch (err) {
        console.error(`[LobbyManager] Error in auth-user: ${err.message}`);
        socket.data.user = null;
        socket.emit('auth-failed', { 
          reason: 'error',
          message: err.message
        });
      }
    });

    // ---------- CREATE LOBBY ----------
    socket.on("create-lobby", async (config = {}, maybeUserId) => {
      try {
        // ✅ Check authentication first
        if (!socket.data.user || !socket.data.user.id) {
          console.warn(`[LobbyManager] create-lobby: unauthenticated socket (no user)`);
          console.warn(`[LobbyManager] 💡 Client should: (1) call /auth/me to verify session, (2) emit auth-user event, (3) retry create-lobby`);
          socket.emit('auth-required', {
            event: 'create-lobby',
            message: 'Must authenticate before creating lobby. Call /auth/me and emit auth-user event.',
            code: 'AUTH_EXPIRED'
          });
          return socket.emit("create-failed", { reason: "unauthenticated", code: "AUTH_EXPIRED" });
        }

        let uid = socket.data.user.id;
        if (!uid) {
          console.error('[LobbyManager] create-lobby: CRITICAL - user.id is undefined after auth check');
          return socket.emit("create-failed", { reason: "invalid_user" });
        }

        // ensure unique code (retry if collision)
        let code;
        for (let i = 0; i < 6; i++) {
          code = Math.random().toString(36).slice(2, 7).toUpperCase();
          if (!this.lobbies[code]) break;
          code = null;
        }
        if (!code) code = ("L" + Date.now()).slice(-6).toUpperCase();

        const playerObj = {
          id: socket.data.user.id,
          name: socket.data.user.name || `Guest${String(uid).substring(0, 6)}`,
          ready: false,
          left: false,
          connected: true
        };

        const lobby = {
          code,
          hostSocketId: socket.id,
          hostUserId: socket.data.user.id,
          players: [playerObj],
          config: {
            players: config.players || 2,
            rounds: config.rounds || 20,
            combos: !!config.combos
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          updated_user: {
            id: socket.data.user.id,
            name: socket.data.user.name,
            timestamp: Date.now()
          }
        };

        this.lobbies[code] = lobby;

        try { await this.save(); } catch (e) { console.warn("[LobbyManager] failed to persist created lobby:", e); }

        socket.join(code);
        socket.emit("lobby-created", { code, timestamp: Date.now() });
        this.broadcastLobbyUpdate(code);
      } catch (err) {
        console.error('[LobbyManager] Error in create-lobby:', err);
        socket.emit("create-failed", { reason: "server_error" });
      }
    });

    // ---------- JOIN LOBBY ----------
    socket.on("join-lobby", async (codeRaw, maybeUserId) => {
      try {
        // ✅ Check authentication first (with auto-auth attempt)
        if (!this.ensureAuthenticated(socket)) {
          // ✅ CRITICAL FIX: If socket not authenticated but userId provided, try to use it as fallback
          if (maybeUserId && typeof maybeUserId === 'string') {
            console.log(`[LobbyManager] join-lobby: Socket unauthenticated, but userId provided as fallback: ${maybeUserId}`);
            // Accept the join with the provided userId, but log it as unverified
            // The socket will be authenticated via auth-user event shortly
            // Continue without auth for now - socket may be in flight with auth event
          } else {
            console.warn(`[LobbyManager] join-lobby: unauthenticated socket (no user) - attempt ${socket.data.authAttempts + 1}`);
            socket.emit('auth-required', {
              event: 'join-lobby',
              message: 'Must authenticate before joining lobby. Please sign in or create an account.',
              code: 'AUTH_REQUIRED',
              retryable: true
            });
            return socket.emit("join-failed", { reason: "unauthenticated", retryable: true });
          }
        }

        if (!codeRaw || typeof codeRaw !== "string") return socket.emit("join-failed", { reason: "invalid_code" });
        const code = codeRaw.trim().toUpperCase();
        const lobby = this.lobbies[code];
        if (!lobby) return socket.emit("join-failed", { reason: "notfound" });

        let uid = socket.data.user?.id || maybeUserId;
        if (!uid) {
          console.warn(`[LobbyManager] join-lobby: No user ID available from socket or parameter`);
          return socket.emit("join-failed", { reason: "invalid_user" });
        }

        // check capacity using only present players (not counting left)
        const presentCount = (lobby.players || []).filter(p => !p.left).length;
        if (presentCount >= (lobby.config?.players || 2)) {
          console.info('[LobbyManager] Lobby full:', code);
          return socket.emit("join-failed", { reason: "full" });
        }

        // ✅ FIX: Use uid (which could be from socket.data.user.id or fallback maybeUserId)
        const existing = lobby.players.find(p => String(p.id) === String(uid));
        if (!existing) {
          // ✅ FIX: Get actual username from DB instead of socket fallback to reduce race condition
          let playerName = socket.data.user?.name;
          if (!playerName) {
            try {
              playerName = await getUsernameFromDB(uid, socket.data.user);
            } catch (err) {
              console.warn(`[LobbyManager] Failed to get username for ${uid}:`, err.message);
              playerName = `Player${String(uid).substring(0, 6)}`;
            }
          }
          
          lobby.players.push({
            id: uid,
            name: playerName,
            ready: false,
            left: false,
            connected: true
          });

          const dedup = [];
          for (const p of lobby.players) {
            if (!dedup.find(x => String(x.id) === String(p.id))) dedup.push(p);
          }
          lobby.players = dedup;

          // ✅ Track who updated this lobby (use actual name from DB)
          lobby.updatedAt = Date.now();
          lobby.updated_user = {
            id: uid,
            name: playerName,
            timestamp: Date.now()
          };

          try { await this.save(); } catch (e) { console.warn("[LobbyManager] save after join failed:", e); }
        } else {
          if (existing.left) {
            existing.left = false;
            existing.connected = true;
            existing.ready = false;
            try { await this.save(); } catch (e) { console.warn("[LobbyManager] save after rejoin failed:", e); }
          } else {
            existing.connected = true;
          }
        }

        socket.join(code);
        
        // ✅ CRITICAL FIX: Ensure socket.data.user is set for future operations
        // If we used fallback userId, now authenticate the socket properly
        if (!socket.data.user && uid) {
          const joiningPlayer = lobby.players.find(p => String(p.id) === String(uid));
          if (joiningPlayer) {
            socket.data.user = {
              id: joiningPlayer.id,
              name: joiningPlayer.name
            };
            console.log(`[LobbyManager] ✅ Auto-authenticated socket after join: ${joiningPlayer.name}`);
          }
        }
        
        socket.emit("join-success", {
          code,
          players: lobby.players,
          hostSocketId: lobby.hostsocketid || lobby.hostSocketId || lobby.host || null,
          hostUserId: lobby.hostuserid || lobby.hostUserId || null,
          updated_user: lobby.updated_user || null,
          // ✅ Include current user info for client to populate socket.data.user
          currentUser: socket.data.user ? { id: socket.data.user.id, name: socket.data.user.name } : null
        });
        this.broadcastLobbyUpdate(code);
      } catch (err) {
        console.error('[LobbyManager] Error in join-lobby:', err);
        socket.emit("join-failed", { reason: "server_error" });
      }
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
    socket.on("toggle-ready", async (codeRaw, maybeUserId) => {
      try {
        // ✅ Check authentication first (with auto-auth attempt)
        if (!this.ensureAuthenticated(socket)) {
          console.warn(`[LobbyManager] toggle-ready: unauthenticated socket`);
          socket.emit('auth-required', {
            event: 'toggle-ready',
            message: 'Must authenticate to toggle ready status',
            retryable: true
          });
          return;
        }

        if (typeof codeRaw !== "string") return;
        const code = codeRaw.trim().toUpperCase();
        const lobby = this.lobbies[code];
        if (!lobby) return;

        let uid = socket.data.user?.id || maybeUserId || null;
        if (!uid) return;

        const player = lobby.players.find(p => String(p.id) === String(uid));
        if (!player) return;

        player.ready = !player.ready;
        
        // ✅ Track who updated this lobby
        lobby.updatedAt = Date.now();
        if (socket.data.user) {
          lobby.updated_user = {
            id: socket.data.user.id,
            name: socket.data.user.name,
            timestamp: Date.now()
          };
        }
        
        try { await this.save(); } catch (e) { console.warn("[LobbyManager] save after toggle-ready failed:", e); }
        this.broadcastLobbyUpdate(code);
      } catch (err) {
        console.error('[LobbyManager] Error in toggle-ready:', err);
      }
    });

    // ---------- LEAVE LOBBY ----------
    socket.on("leave-lobby", async (codeRaw) => {
      if (typeof codeRaw !== "string") return;
      const code = codeRaw.trim().toUpperCase();
      socket.leave(code);  // ✅ Ensure socket leaves the room
      await this.removePlayerFromLobby(code, socket);
    });

    // ---------- START GAME ----------
    socket.on("start-game", async (codeRaw) => {
      try {
        if (typeof codeRaw !== "string") {
          socket.emit("game-failed", { reason: "invalid_code" });
          return;
        }

        const code = codeRaw.trim().toUpperCase();
        const lobby = this.lobbies[code];
        if (!lobby) {
          socket.emit("game-failed", { reason: "lobby_notfound" });
          return;
        }

        // ✅ Verify host (ensure socket is authenticated first)
        if (!socket.data.user || !socket.data.user.id) {
          console.warn(`[LobbyManager] start-game: unauthenticated socket`);
          socket.emit('auth-required', {
            event: 'start-game',
            message: 'Host must be authenticated to start the game',
            retryable: true
          });
          return socket.emit("game-failed", { reason: "host_unauthenticated" });
        }

        if (socket.id !== lobby.hostSocketId) {
          socket.emit("game-failed", { reason: "not_host" });
          return;
        }

        // ensure players are present
        const activePlayers = (lobby.players || []).filter(p => !p.left);

        const allReady = activePlayers.length > 0 && activePlayers.every(p => p.ready);
        if (!allReady || activePlayers.length < 2) {
          socket.emit("game-failed", { reason: "players_not_ready" });
          return;
        }

        // create game state - assign avatars appropriately
        // Guests: use playerIcon
        // Discord/Google: fetch avatar from user profile
        let gamePlayersWithAvatars = [];
        for (const p of lobby.players) {
          let avatar = null;
          let playerIcon = null;
          let userType = 'guest';
          
          try {
            const user = await loadUser(p.id);
            userType = user?.type || 'guest';
            
            // OAuth users (Discord/Google): fetch avatar from DB
            if (userType === 'discord' || userType === 'google') {
              avatar = user?.avatar || null;
            }
            // Guest users: use playerIcon
            else if (userType === 'guest') {
              playerIcon = user?.playerIcon || null;
            }
          } catch (err) {
            console.warn(`[LobbyManager] Failed to load user data for player ${p.id}:`, err.message);
          }
          
          gamePlayersWithAvatars.push({
            id: p.id,
            name: p.name,
            type: userType,
            avatar: avatar,          // OAuth users (Discord/Google)
            playerIcon: playerIcon,  // Guest users
            score: 0,
            comboStats: { pair:0, twoPair:0, triple:0, fullHouse:0, fourOfAKind:0, fiveOfAKind:0, straight:0 },
            hasRolled: false,
            left: false,
            connected: true
          });
        }

        const game = {
          code,
          config: lobby.config || { players: 2, rounds: 20, combos: false },
          players: gamePlayersWithAvatars,
          currentIndex: 0,
          round: 1,
          totalRounds: lobby.config?.rounds || 20,
          combosEnabled: !!lobby.config?.combos,
          turnTimer: null,
          turnExpiresAt: null,
          timeLimitSeconds: lobby.config?.timeLimitSeconds || 30,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        this.activeGames[code] = game;

        // notify clients (invite to transition)
        this.io.to(code).emit("game-starting", { code, config: lobby.config, players: lobby.players });

        // build per-socket state and send
        const statePayload = {
          config: game.config,
          players: game.players.map(p => ({ id: p.id, name: p.name, type: p.type, avatar: p.avatar, playerIcon: p.playerIcon, connected: true })),
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
      } catch (err) {
        console.error('[LobbyManager] Error in start-game:', err);
        socket.emit("game-failed", { reason: "server_error" });
      }
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

      // check if the player has left
      if (player.left) return;

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

      // check if the player has left
      if (currentPlayer.left) return;

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
      // ✅ Ensure socket is fully removed from all rooms
      try {
        socket.leaveAll();
      } catch (e) {
        console.warn("[LobbyManager] socket.leaveAll() failed:", e);
      }

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
  let uid = socket.data.user?.id;
  
  console.log(`[LobbyManager] removePlayerFromLobby called for code=${code}, uid=${uid}, socketId=${socket.id}`);
  
  // ✅ Ensure socket fully leaves this room
  try {
    socket.leave(code);
  } catch (e) {
    console.debug("[LobbyManager] socket.leave() during removePlayerFromLobby failed:", e);
  }

  const lobby = this.lobbies[code];
  if (!lobby) {
    const gameOnly = this.activeGames[code];
    if (gameOnly) {
      // If no uid, try to find player by socket connection (fallback)
      if (!uid) {
        const roomSockets = this.io.sockets.adapter.rooms.get(code) || new Set();
        const socketInRoom = [...roomSockets].includes(socket.id);
        if (!socketInRoom) {
          console.warn(`[LobbyManager] Socket ${socket.id} not in room ${code} and no uid available`);
          return;
        }
        // If socket is in game but we don't have uid, try to find player by socket id match
        // This is a fallback - ideally sockets should always have user.id
        console.warn(`[LobbyManager] No uid for socket ${socket.id}, searching for player by connection match`);
      }
      
      if (uid) {
        const pl = gameOnly.players.find(p => String(p.id) === String(uid));
        if (pl) {
          console.log(`[LobbyManager] Marking player ${uid} as left in active game ${code}`);
          pl.left = true;
          pl.connected = false;
        }
      }
      const activeCount = gameOnly.players.filter(p => !p.left).length;
      if (activeCount <= 1) {
        // ✅ NEW: Update leaderboard stats (online games only)
        this._updateGameStats(gameOnly.players).catch(err => console.warn('[LobbyManager] Leaderboard update failed:', err));
        
        this.io.to(code).emit("game-finished", {
          code,
          scores: gameOnly.players.map(p => p.score),
          comboStats: gameOnly.players.map(p => p.comboStats),
          names: gameOnly.players.map(p => p.name),
          players: gameOnly.players
        });
        delete this.activeGames[code];
        
        // ✅ FIX: Also delete the corresponding lobby when game ends with all players gone
        if (this.lobbies[code]) {
          console.log(`[LobbyManager] Deleting lobby ${code} since game ended with all players gone`);
          delete this.lobbies[code];
          this.save().catch(e => console.warn("[LobbyManager] save after deleting lobby failed:", e));
          deleteSupabaseLobby(code).catch(e => console.warn("[LobbyManager] deleteSupabaseLobby failed:", e));
        }
      } else {
        this.io.to(code).emit("player-left", { id: uid });
      }
    }
    return;
  }

  if (!uid) {
    // Fallback: if no uid, try to identify player by other means
    // This shouldn't normally happen, but handle it gracefully
    console.warn(`[LobbyManager] No user id for socket ${socket.id}, cannot remove from lobby ${code}`);
    return;
  }
  const pl = (lobby.players || []).find(p => String(p.id) === String(uid));
  if (!pl) {
    console.warn(`[LobbyManager] Player ${uid} not found in lobby ${code}`);
    return;
  }

  console.log(`[LobbyManager] Marking player ${uid} as left in lobby ${code}`);
  pl.left = true;
  pl.connected = false;

  // If everyone left -> delete lobby
  const activeCount = (lobby.players || []).filter(p => !p.left).length;
  if (activeCount === 0) {
    console.log(`[LobbyManager] All players left lobby ${code}, deleting...`);
    delete this.lobbies[code];
    try { 
      await this.save(); 
      console.log(`[LobbyManager] ✅ Saved empty lobby deletion for ${code}`);
    } catch (e) { 
      console.warn("[LobbyManager] save after deleting empty lobby failed:", e); 
    }
    try { 
      await deleteSupabaseLobby(code); 
      console.log(`[LobbyManager] ✅ Deleted ${code} from Supabase`);
    } catch (e) { 
      console.warn("[LobbyManager] deleteSupabaseLobby failed:", e); 
    }
    try { this.io.to(code).emit("lobby-deleted", { code }); } catch (e) {}
    return;
  }

  // ensure host is valid (transfer if needed to first non-left player)
  const remainingIds = new Set(lobby.players.filter(p => !p.left).map(p => String(p.id)));
  if (!lobby.hostUserId || !remainingIds.has(String(lobby.hostUserId))) {
    const newHost = lobby.players.find(p => !p.left);
    lobby.hostUserId = newHost ? newHost.id : null;
    const newHostSocket = [...this.io.sockets.sockets.values()].find(s => String(s.data?.user?.id) === String(newHost?.id));
    lobby.hostSocketId = newHostSocket ? newHostSocket.id : null;
    console.log(`[LobbyManager] Host transferred to ${newHost?.id} for lobby ${code}`);
  } else {
    if (lobby.hostSocketId) {
      const sockExists = Boolean(this.io.sockets.sockets.get(lobby.hostSocketId));
      if (!sockExists) {
        const newHostSocket = [...this.io.sockets.sockets.values()].find(s => String(s.data?.user?.id) === String(lobby.hostUserId));
        lobby.hostSocketId = newHostSocket ? newHostSocket.id : null;
        console.log(`[LobbyManager] Updated host socket ID for ${lobby.hostUserId} in lobby ${code}`);
      }
    }
  }

  // persist changes
  try { 
    await this.save(); 
    console.log(`[LobbyManager] ✅ Persisted player left status for ${uid} in lobby ${code} to database`);
  } catch (e) { 
    console.warn("[LobbyManager] save after removePlayer failed:", e); 
  }

  // broadcast update (clients will display left/connected false)
  this.broadcastLobbyUpdate(code);

  // If there is an active game associated with this room, mark player as left there too (do not re-index)
  const game = this.activeGames[code];
  if (game) {
    const gpl = game.players.find(p => String(p.id) === String(uid));
    if (gpl) {
      console.log(`[LobbyManager] Marking player ${uid} as left in active game ${code}`);
      gpl.left = true;
      gpl.connected = false;
    }

    // emit player-left event (UI will tint player and show left)
    try {
      this.io.to(code).emit("player-left", { id: uid });
    } catch (err) { console.warn("[LobbyManager] emit player-left failed:", err); }

    // If active players reduced to <=1, finish the game
    const activeCountG = game.players.filter(p => !p.left).length;
    if (activeCountG <= 1) {
      console.log(`[LobbyManager] Game ${code} finished, only ${activeCountG} active player(s) remaining`);
      // ✅ NEW: Update leaderboard stats (online games only)
      this._updateGameStats(game.players).catch(err => console.warn('[LobbyManager] Leaderboard update failed:', err));
      
      this.io.to(code).emit("game-finished", {
        code,
        scores: game.players.map(p => p.score),
        comboStats: game.players.map(p => p.comboStats),
        names: game.players.map(p => p.name),
        players: game.players
      });
      delete this.activeGames[code];
      
      // ✅ FIX: Also delete the corresponding lobby when game ends with all players gone
      if (this.lobbies[code]) {
        console.log(`[LobbyManager] Deleting lobby ${code} since game ended with all players gone`);
        delete this.lobbies[code];
        this.save().catch(e => console.warn("[LobbyManager] save after deleting lobby failed:", e));
        deleteSupabaseLobby(code).catch(e => console.warn("[LobbyManager] deleteSupabaseLobby failed:", e));
      }
      return;
    }

    // Adjust currentIndex if it now points to a left player: advance to next active index
    if (game.currentIndex >= game.players.length || game.players[game.currentIndex].left) {
      // find next active index
      let next = game.currentIndex % game.players.length;
      let tries = 0;
      while (tries < game.players.length && game.players[next].left) {
        next = (next + 1) % game.players.length;
        tries++;
      }
      game.currentIndex = next;
    }

    // send updated game-state to clients and ensure server continues turn flow
    try {
      this.emitGameState(code);
      // small delay then attempt to startTurn if needed
      setTimeout(() => {
        const g = this.activeGames[code];
        if (g && g.players && g.players.filter(p => !p.left).length > 0) {
          this.startTurn(code);
        }
      }, 120);
    } catch (err) {
      console.warn("[LobbyManager] post-remove game update failed:", err);
    }
  }
}

  // Broadcast lobby update to room
  // Prune dead lobbies and games from memory
  // Removes lobbies that are empty or inactive for 3 hours
  pruneInMemoryLobbies() {
    const now = Date.now();
    const EXPIRE_MS = 1000 * 60 * 60 * 3; // 3 hours
    let prunedLobbies = 0;
    let prunedGames = 0;

    // Prune lobbies
    for (const code of Object.keys(this.lobbies)) {
      const lobby = this.lobbies[code];
      if (!lobby) continue;

      // Check if lobby is empty (no connected players) or expired
      const connectedPlayers = Array.isArray(lobby.players) 
        ? lobby.players.filter(p => p.connected !== false).length 
        : 0;
      
      const isExpired = (now - (lobby.updatedAt || lobby.createdAt || 0)) > EXPIRE_MS;
      const isEmpty = connectedPlayers === 0;

      if (isEmpty || isExpired) {
        // Try to delete from database
        if (lobby.code) {
          deleteSupabaseLobby(lobby.code).catch(err => {
            console.warn(`[LobbyManager] Failed to delete lobby ${lobby.code} from Supabase:`, err);
          });
        }
        
        delete this.lobbies[code];
        prunedLobbies++;
        console.log(`[LobbyManager] Pruned lobby ${code} (empty: ${isEmpty}, expired: ${isExpired})`);
      }
    }

    // Prune finished games
    for (const code of Object.keys(this.activeGames)) {
      const game = this.activeGames[code];
      if (!game) continue;

      // Check if game is finished or expired
      const isFinished = game.finished === true;
      const isExpired = (now - (game.updatedAt || game.createdAt || 0)) > EXPIRE_MS;

      if (isFinished || isExpired) {
        delete this.activeGames[code];
        prunedGames++;
        console.log(`[LobbyManager] Pruned game ${code} (finished: ${isFinished}, expired: ${isExpired})`);
      }
    }

    if (prunedLobbies > 0 || prunedGames > 0) {
      console.info(`[LobbyManager] Pruned ${prunedLobbies} lobbies and ${prunedGames} games`);
    }
  }

  /**
   * Update player leaderboard stats when a game completes (ONLINE GAMES ONLY)
   * @private
   */
  async _updateGameStats(players) {
    if (!Array.isArray(players)) return;
    
    // Find the highest score (1st place)
    let maxScore = -Infinity;
    for (const player of players) {
      if (player.score !== undefined && player.score > maxScore) {
        maxScore = player.score;
      }
    }

    // Only update for players with IDs (online games)
    for (const player of players) {
      const playerId = player.id || player.uid;
      const finalScore = player.score || 0;
      // Only award "won" if this player has the highest score (1st place, no ties)
      const won = finalScore === maxScore && maxScore > -Infinity;
      const combos = player.comboStats || [];
      
      try {
        await LeaderboardManager.updatePlayerStats(playerId, finalScore, won, combos);
      } catch (err) {
        console.warn(`[LobbyManager] Failed to update stats for player ${playerId}:`, err.message);
      }
    }
  }

  broadcastLobbyUpdate(code) {
    const lobby = this.lobbies[code];
    if (!lobby) return;
    
    // ✅ FIX: Only send active players (filter out left:true) to reduce client-side confusion
    const activePlayers = getActivePlayers(lobby.players);
    
    this.io.to(code).emit("lobby-updated", {
      code,
      players: activePlayers,  // Only active players
      hostSocketId: lobby.hostsocketid || lobby.hostSocketId,
      hostUserId: lobby.hostuserid || lobby.hostUserId,
      config: lobby.config,
      updated_user: lobby.updated_user || null,
      updated_at: lobby.updatedAt || lobby.updated_at
    });
  }

  // Emit authoritative game-state (personalized per socket)
  emitGameState(code) {
    const game = this.activeGames[code];
    if (!game) return;

    const statePayloadBase = {
      players: game.players.map(p => ({ id: p.id, name: p.name, type: p.type, avatar: p.avatar, playerIcon: p.playerIcon, score: p.score, connected: true })),
      scores: game.players.map(p => p.score),
      comboStats: game.players.map(p => p.comboStats),
      round: game.round,
      totalRounds: game.totalRounds,
      room: code,
      currentPlayerIndex: game.currentIndex,
      timeLimitSeconds: game.timeLimitSeconds,
      config: game.config // Include game config so client can display rounds, players, etc.
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

  async advanceTurn(code) {
    const game = this.activeGames[code];
    if (!game) return;

    if (game.turnTimer) { clearTimeout(game.turnTimer); game.turnTimer = null; }

    // move to the next non-left player
    const playerCount = game.players.length;
    if (playerCount === 0) return;

    const previousIndex = game.currentIndex;
    let nextIdx = (game.currentIndex + 1) % playerCount;
    let attempts = 0;
    while (attempts < playerCount && game.players[nextIdx].left) {
      nextIdx = (nextIdx + 1) % playerCount;
      attempts++;
    }

    // if nobody active found -> finish game
    const activeCount = game.players.filter(p => !p.left).length;
    if (activeCount <= 1) {
      // ✅ NEW: Update leaderboard stats (online games only)
      this._updateGameStats(game.players).catch(err => console.warn('[LobbyManager] Leaderboard update failed:', err));
      
      this.io.to(code).emit("game-finished", {
        code,
        scores: game.players.map(p => p.score),
        comboStats: game.players.map(p => p.comboStats),
        names: game.players.map(p => p.name),
        players: game.players
      });
      delete this.activeGames[code];
      
      // ✅ FIX: Also clean up the corresponding lobby when game ends
      if (this.lobbies[code]) {
        console.log(`[LobbyManager] Deleting lobby ${code} after game finished with insufficient players`);
        delete this.lobbies[code];
        try { 
          await this.save(); 
          console.log(`[LobbyManager] ✅ Saved lobby deletion for ${code}`);
        } catch (e) { 
          console.warn("[LobbyManager] save after deleting lobby failed:", e); 
        }
        try { 
          await deleteSupabaseLobby(code); 
          console.log(`[LobbyManager] ✅ Deleted ${code} from Supabase`);
        } catch (e) { 
          console.warn("[LobbyManager] deleteSupabaseLobby failed:", e); 
        }
      }
      return;
    }

    // ✅ FIX: Increment round when we wrap back to player 0 (new round)
    if (nextIdx < previousIndex || nextIdx === 0) {
      game.round += 1;
      
      // Check if we've completed all rounds
      if (game.round > game.totalRounds) {
        // ✅ NEW: Update leaderboard stats (online games only)
        this._updateGameStats(game.players).catch(err => console.warn('[LobbyManager] Leaderboard update failed:', err));
        
        this.io.to(code).emit("game-finished", {
          code,
          scores: game.players.map(p => p.score),
          comboStats: game.players.map(p => p.comboStats),
          names: game.players.map(p => p.name),
          players: game.players
        });
        delete this.activeGames[code];
        
        // ✅ FIX: Delay lobby deletion to allow client to show PostGameScene first
        // Lobby will be cleaned up after ~8 seconds to prevent race conditions
        if (this.lobbies[code]) {
          const gameCode = code;
          setTimeout(() => {
            if (this.lobbies[gameCode]) {
              console.log(`[LobbyManager] Cleaning up lobby ${gameCode} (post-game cleanup)`);
              delete this.lobbies[gameCode];
              try { 
                this.save().catch(e => console.warn("[LobbyManager] save after delayed lobby deletion failed:", e));
              } catch (e) { /* ignore */ }
              try { 
                deleteSupabaseLobby(gameCode).catch(e => console.warn("[LobbyManager] deleteSupabaseLobby delayed failed:", e));
              } catch (e) { /* ignore */ }
            }
          }, 8000);
        }
        return;
      }
    }

    game.currentIndex = nextIdx;
    if (game.currentIndex >= game.players.length) game.currentIndex = 0;

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
    if (this._serverPruneHandle) {
      clearInterval(this._serverPruneHandle);
      this._serverPruneHandle = null;
    }
  }
}