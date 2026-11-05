import { randomInt } from "node:crypto";
import { loadLobbies, saveLobby, saveLobbies, pruneLocalLobbies, deleteSupabaseLobby, deleteLocalLobby } from "./utils/lobbyStorage.js";

// lobby codes are the only thing hiding a lobby, so use a CSPRNG.
// skip look-alike characters so codes are easy to read out.
const LOBBY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateLobbyCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += LOBBY_CODE_ALPHABET[randomInt(0, LOBBY_CODE_ALPHABET.length)];
  }
  return code;
}
import { rollDice, calculateScore } from "./utils/DiceManager.js";
import { getUsernameFromDB, getActivePlayers, normalizeAllPlayers } from "./utils/playerStateManager.js";
import { loadUser } from "./utils/userStorage.js";
import LeaderboardManager from "./utils/leaderboardManager.js";
import { diceathonSchedule, randomDiceathonConfig } from './utils/diceathon.js';

function normalizeGameMode(mode, combosFallback = false, multiplexFallback = false) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'combanity') return 'combanity';
  if (normalized === 'multiplex') return 'multiplex';
  if (normalized === 'classic') {
    if (multiplexFallback && !combosFallback) return 'multiplex';
    if (combosFallback) return 'combanity';
    return 'classic';
  }
  if (multiplexFallback && !combosFallback) return 'multiplex';
  return combosFallback ? 'combanity' : 'classic';
}

function getRuleFlags(mode, combosFallback = false, multiplexFallback = false, allowCombined = false) {
  const gameMode = normalizeGameMode(mode, combosFallback, multiplexFallback);
  return {
    gameMode,
    combos: gameMode === 'combanity' || (allowCombined && !!combosFallback),
    multiplex: gameMode === 'multiplex' || (allowCombined && !!multiplexFallback)
  };
}

function isDiceathonConfig(config = {}) {
  const eventMode = String(config.eventMode ?? config.eventType ?? config.eventKey ?? '').trim().toLowerCase();
  return !!config.diceathon || eventMode === 'diceathon';
}

function normalizeLobbyConfig(config = {}) {
  const players = Math.min(6, Math.max(2, Number(config.players) || 2));
  const rounds = Math.min(30, Math.max(5, Number(config.rounds) || 20));
  const rules = getRuleFlags(
    config.gamemode ?? config.gameMode,
    !!config.combos,
    !!config.multiplex,
    isDiceathonConfig(config)
  );
  const teamsEnabled = !!config.teamsEnabled;
  const teams = teamsEnabled
    ? Array.from({ length: players }, (_, index) => {
        const team = Array.isArray(config.teams) ? config.teams[index] : null;
        if (team === 'red' || team === 'blue') return team;
        return index % 2 === 0 ? 'blue' : 'red';
      })
    : [];

  return {
    ...config,
    players,
    rounds,
    gamemode: rules.gameMode,
    gameMode: rules.gameMode,
    combos: rules.combos,
    multiplex: rules.multiplex,
    teamsEnabled,
    teams
  };
}

function sanitizeAuthenticatedUser(user) {
  if (!user?.id) return null;
  return {
    id: String(user.id).trim(),
    name: (user.name && String(user.name).trim().substring(0, 32)) || `Guest${String(user.id).substring(0, 6)}`,
    type: (user.type && String(user.type).trim()) || 'guest'
  };
}

export default class LobbyManager {
  constructor(io) {
    this.io = io;
    this.lobbies = {};
    this.activeGames = {};
    this.diceathonQueue = new Map();
    this.diceathonMatching = false;
    this.diceathonReservations = new Map();
    this.diceathonQueueTimer = null;
    this.diceathonRateBuckets = new Map();
    this.socketRateBuckets = new Map();
    this._loadInFlight = null;
    this._lastLoadAt = 0;
    this.isServerless = process.env.VERCEL === '1' || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.NOW_REGION;
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

    // 4) start periodic background jobs only on persistent server processes.
    if (!this.isServerless) {
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
  }

  // Load all lobbies from storage (defensive: supports array or map)
  async load() {
    // Coalesce overlapping reloads so a connection burst cannot multiply a
    // full-table read.
    if (this._loadInFlight) return this._loadInFlight;
    this._loadInFlight = this._loadNow().finally(() => {
      this._loadInFlight = null;
      this._lastLoadAt = Date.now();
    });
    return this._loadInFlight;
  }

  async _loadNow() {
    try {
      const raw = await loadLobbies();
      if (!raw) return;

      // A storage refresh must not replace live lobby objects with stale
      // snapshots while a game is running or being started.
      const liveLobbies = Object.fromEntries(Object.entries(this.lobbies).filter(
        ([code, lobby]) => this.activeGames[code] || lobby?.starting
      ));

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
            config: normalizeLobbyConfig(item.config || item.config_json || {}),
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

      Object.assign(this.lobbies, liveLobbies);

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
        lobby.config = normalizeLobbyConfig(lobby.config);
        if (lobby.players.length === 0) {
          delete this.lobbies[code];
          changed = true;
          continue;
        }
        if (!this.activeGames[code] && !lobby.starting && now - (lobby.createdAt || 0) > EXPIRE_MS) {
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

  // A new connection only needs a recent view of storage. Explicit loads (init,
  // admin paths) still run immediately; this throttles the per-connection path.
  async refreshLobbies(minIntervalMs = 5000) {
    if (this._loadInFlight) return this._loadInFlight;
    if (this._lastLoadAt && (Date.now() - this._lastLoadAt) < minIntervalMs) return;
    return this.load();
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

  // write just this lobby instead of re-upserting the whole map
  async persistLobby(code) {
    const key = String(code || "").trim().toUpperCase();
    const lobby = this.lobbies[key];
    if (!lobby) return null;

    try {
      return await saveLobby(lobby);
    } catch (err) {
      console.warn(`[LobbyManager] persistLobby(${key}) failed:`, err?.message || err);
      return null;
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
      // remove this row from local fallback, then Supabase
      await deleteLocalLobby(code);
      await deleteSupabaseLobby(code);

    } catch (e) {
      console.warn("[LobbyManager] deleteLobby failed:", e);
    }
  }

  getPlayerTeam(config, playerIndex) {
    if (!config?.teamsEnabled) return null;
    const team = Array.isArray(config.teams) ? config.teams[playerIndex] : null;
    if (team === 'red' || team === 'blue') return team;
    return playerIndex % 2 === 0 ? 'blue' : 'red';
  }

  attachLobbyTeams(players = [], config = {}) {
    return (Array.isArray(players) ? players : []).map((player, index) => ({
      ...player,
      team: config?.teamsEnabled ? (player?.team || this.getPlayerTeam(config, index)) : null
    }));
  }

  getAuthoritativeSocketUser(socket) {
    return sanitizeAuthenticatedUser(socket?.request?.user);
  }

  // Per-address token bucket for socket actions that write lobby state. Codes
  // are short, so unthrottled joins also make rooms guessable.
  consumeSocketRate(socket, action, limit, windowMs = 60 * 1000) {
    this.socketRateBuckets ||= new Map();
    const address = socket?.data?.diceathonRateKey || String(socket?.request?.socket?.remoteAddress || socket?.handshake?.address || 'unknown').replace(/^::ffff:/, '');
    const key = `${action}:${address}`;
    const now = Date.now();
    let bucket = this.socketRateBuckets.get(key);
    if (!bucket || (now - bucket.startedAt) >= windowMs) {
      if (this.socketRateBuckets.size >= 5000) {
        const oldest = this.socketRateBuckets.keys().next();
        if (!oldest.done) this.socketRateBuckets.delete(oldest.value);
      }
      bucket = { startedAt: now, count: 0 };
      this.socketRateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count > limit;
  }

  ensureSessionAuthenticated(socket, emitSuccess = true) {
    if (socket.data.user && socket.data.user.id) {
      const authoritativeUser = this.getAuthoritativeSocketUser(socket);
      if (authoritativeUser && String(authoritativeUser.id) === String(socket.data.user.id)) {
        return true;
      }

      console.warn(`[LobbyManager] Clearing mismatched socket auth for ${socket.id}`);
      socket.data.user = null;
      socket.data.authEmitted = false;
    }

    const authoritativeUser = this.getAuthoritativeSocketUser(socket);
    if (!authoritativeUser) {
      return false;
    }

    socket.data.user = authoritativeUser;
    socket.data.authEmitted = true;
    socket.data.lastHeartbeat = Date.now();

    if (emitSuccess) {
      socket.emit('auth-success', {
        user: socket.data.user,
        socketid: socket.id,
        timestamp: Date.now(),
        autoAuth: true
      });
    }

    return true;
  }

  // Membership checks for lobby/game state access. Lobby codes are short and
  // guessable, so knowing a code must never be enough to read or destroy it.
  isLobbyMember(lobby, socket) {
    if (!lobby || !socket?.data?.user?.id) return false;
    const uid = String(socket.data.user.id);
    if (lobby.hostUserId && String(lobby.hostUserId) === uid) return true;
    if (!Array.isArray(lobby.players)) return false;
    return lobby.players.some((p) => p && String(p.id) === uid);
  }

  isGameMember(game, socket) {
    if (!game || !socket?.data?.user?.id) return false;
    const uid = String(socket.data.user.id);
    if (!Array.isArray(game.players)) return false;
    return game.players.some((p) => p && String(p.id) === uid);
  }

  // Helper: Ensure socket has user data (try auto-auth if missing)
  ensureAuthenticated(socket) {
    return this.ensureSessionAuthenticated(socket);

    // If already authenticated, return true
    if (socket.data.user && socket.data.user.id) {
      return true;
    }

    // Try to auto-authenticate from session if available
    if (false && socket.request && socket.request.user && !socket.data.authEmitted) {
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

  async matchDiceathon() {
    if (this.diceathonMatching) return;
    this.diceathonMatching = true;
    try {
      while (this.diceathonQueue.size >= 6 && this.getDiceathonSchedule().active) {
        const entries = [...this.diceathonQueue.entries()].slice(0, 6);
        // An idle socket can outlive its session. Check all six again immediately
        // before matching rather than trusting their original handshake.
        const results = await Promise.all(entries.map(async ([uid, member]) => {
          const valid = await new Promise(resolve => {
            const session = member.request.session;
            if (!member.connected || !session?.reload) return resolve(false);
            const timer = setTimeout(() => resolve(false), 5000);
            session.reload(err => {
              clearTimeout(timer);
              const current = member.request.session;
              const expires = current?.cookie?.expires ? new Date(current.cookie.expires).getTime() : null;
              resolve(!err && member.connected && String(member.data.user?.id || '') === uid && String(current?.passport?.user || '') === uid &&
                (expires === null || (Number.isFinite(expires) && expires > Date.now())));
            });
          });
          return [uid, member, valid];
        }));
        for (const [uid, member, valid] of results) {
          if (!valid) {
            if (this.diceathonQueue.get(uid) === member) this.diceathonQueue.delete(uid);
            if (member.connected) member.disconnect(true);
          }
        }
        if (!this.getDiceathonSchedule().active) break;
        if (entries.some(([uid, member]) => this.diceathonQueue.get(uid) !== member || !member.connected)) {
          this.notifyDiceathonQueue();
          continue;
        }
        let code;
        for (let i = 0; i < 30 && !code; i++) {
          const candidate = generateLobbyCode(6);
          if (!this.lobbies[candidate] && !this.activeGames[candidate]) code = candidate;
        }
        if (!code) {
          for (const [, member] of entries) member.emit('diceathon-error', { reason: 'server_error' });
          break;
        }
        const config = normalizeLobbyConfig(randomDiceathonConfig());
        const players = entries.map(([, member]) => ({ id: member.data.user.id, name: member.data.user.name, ready: true, left: false, connected: true }));
        const lobby = { code, hostUserId: players[0].id, hostSocketId: entries[0][1].id, players, config, createdAt: Date.now(), updatedAt: Date.now() };
        this.lobbies[code] = lobby;
        lobby.starting = true;
        for (const [id, member] of entries) {
          this.diceathonQueue.delete(id);
          this.diceathonReservations.set(id, code);
          member.join(code);
        }
        this.notifyDiceathonQueue();
        try {
          await entries[0][1].data.startDiceathonGame(code);
        } catch (err) {
          console.error('[Diceathon] Failed to start matched game:', err);
        } finally {
          for (const [id] of entries) this.diceathonReservations.delete(id);
        }
        if (this.activeGames[code]) {
          for (const [, member] of entries) member.emit('diceathon-matched', { code, config });
        } else {
          delete this.lobbies[code];
          for (const [, member] of entries) {
            member.leave(code);
            member.emit('diceathon-error', { reason: 'server_error' });
          }
        }
      }
      if (!this.getDiceathonSchedule().active) this.diceathonState({ data: {} });
    } finally {
      this.diceathonMatching = false;
    }
  }

  getDiceathonSchedule(now = Date.now()) {
    return diceathonSchedule(now);
  }

  diceathonState(socket) {
    const now = Date.now();
    const schedule = { ...this.getDiceathonSchedule(now), serverNow: now, available: !this.isServerless };
    const queue = this.diceathonQueue;
    if (!this.diceathonQueueTimer && queue?.size && schedule.active) {
      this.diceathonQueueTimer = setTimeout(() => {
        this.diceathonQueueTimer = null;
        this.diceathonState({ data: {} });
      }, Math.max(0, schedule.endsAt - now));
    }
    if (queue && !schedule.active && queue.size) {
      const waiting = [...queue.values()];
      queue.clear();
      for (const entry of waiting) entry.emit('diceathon-status', { ...schedule, queued: false, count: 0 });
    }
    return { ...schedule, queued: !!queue?.has(String(socket.data.user?.id)), count: queue?.size || 0 };
  }

  notifyDiceathonQueue() {
    if (!this.diceathonQueue?.size && this.diceathonQueueTimer) {
      clearTimeout(this.diceathonQueueTimer);
      this.diceathonQueueTimer = null;
    }
    for (const socket of this.diceathonQueue?.values() || []) {
      socket.emit('diceathon-status', this.diceathonState(socket));
    }
  }

  leaveDiceathonQueue(socket, allConnections = false) {
    const userId = String(socket.data.user?.id || '');
    for (const [uid, member] of this.diceathonQueue || []) {
      if (member === socket || (allConnections && userId && uid === userId)) {
        this.diceathonQueue.delete(uid);
        if (member !== socket) member.emit('diceathon-status', this.diceathonState(member));
        this.notifyDiceathonQueue();
        break;
      }
    }
  }

  // Register socket connection + handlers
  async registerSocket(socket) {
    // refresh latest lobbies from DB before handling new socket
    this.refreshLobbies().catch(e => console.warn('[LobbyManager] socket refresh failed:', e));

    // ensure socket.data.user container exists
    socket.data.user = socket.data.user || null;
    socket.data.authAttempts = 0;
    socket.data.lastHeartbeat = Date.now();

    if (this.ensureSessionAuthenticated(socket, !socket.data.authEmitted)) {
      console.log(`[LobbyManager] Session-authenticated socket as: ${socket.data.user.name}`);
    }

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

    socket.on('clear-auth', () => {
      // Disconnect while identity and room membership are still available to
      // disconnecting; clearing them first would strand players in games.
      socket.disconnect(true);
    });

    // ---------- AUTH USER ----------
    socket.on("auth-user", async (user) => {
      try {
        socket.data.authAttempts = (socket.data.authAttempts || 0) + 1;
        
        // ✅ CRITICAL: Proper null user handling
        if (!user) {
          socket.disconnect(true);
          return;
        }

        if (user.id) {
          const authoritativeUser = this.getAuthoritativeSocketUser(socket);
          if (!authoritativeUser) {
            console.warn(`[LobbyManager] auth-user rejected for ${socket.id}: no authenticated session`);
            socket.data.user = null;
            socket.data.authEmitted = false;
            socket.emit('auth-failed', {
              reason: 'session_required',
              message: 'Socket authentication requires a valid server session.',
              attempt: socket.data.authAttempts
            });
            return;
          }

          if (String(user.id).trim() !== String(authoritativeUser.id)) {
            console.warn(`[LobbyManager] auth-user rejected for ${socket.id}: payload id mismatch`);
            socket.data.user = null;
            socket.data.authEmitted = false;
            socket.emit('auth-failed', {
              reason: 'identity_mismatch',
              message: 'Socket identity does not match the authenticated session.',
              attempt: socket.data.authAttempts
            });
            return;
          }

          socket.data.user = authoritativeUser;
          socket.data.authEmitted = true;
          socket.data.lastHeartbeat = Date.now();

          console.log(`[LobbyManager] Session-authenticated socket as: ${socket.data.user.name}`);
          socket.emit('auth-success', {
            user: socket.data.user,
            socketid: socket.id,
            timestamp: Date.now(),
            verified: true
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
        socket.data.authEmitted = true;
        
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
        socket.data.authEmitted = false;
        socket.emit('auth-failed', { 
          reason: 'error',
          message: err.message
        });
      }
    });

    // ---------- DICEATHON MATCHMAKING ----------
    socket.on('diceathon-status', () => {
      socket.emit('diceathon-status', this.diceathonState(socket));
    });

    socket.on('diceathon-leave', () => {
      this.leaveDiceathonQueue(socket);
      socket.emit('diceathon-status', this.diceathonState(socket));
    });

    socket.on('diceathon-join', () => {
      this.diceathonRateBuckets ||= new Map();
      const address = socket.data.diceathonRateKey || String(socket.request.socket?.remoteAddress || socket.handshake?.address || 'unknown').replace(/^::ffff:/, '');
      const now = Date.now();
      for (const [key, bucket] of this.diceathonRateBuckets) {
        if (now - bucket.startedAt < 1000) break;
        this.diceathonRateBuckets.delete(key);
      }
      let bucket = this.diceathonRateBuckets.get(address);
      if (!bucket) {
        if (this.diceathonRateBuckets.size >= 2000) return socket.emit('diceathon-error', { reason: 'rate_limited' });
        bucket = { startedAt: now, count: 0 };
        this.diceathonRateBuckets.set(address, bucket);
      }
      if (++bucket.count > 12) return socket.emit('diceathon-error', { reason: 'rate_limited' });
      if (!this.ensureSessionAuthenticated(socket, false)) return socket.emit('diceathon-error', { reason: 'authentication_required' });
      if (this.isServerless) return socket.emit('diceathon-error', { reason: 'persistent_server_required' });
      this.diceathonQueue ||= new Map();
      this.diceathonReservations ||= new Map();
      const status = this.diceathonState(socket);
      if (!status.active) return socket.emit('diceathon-error', { reason: 'event_inactive', ...status });
      const uid = String(socket.data.user.id);
      if (this.diceathonReservations.has(uid)) return socket.emit('diceathon-error', { reason: 'already_in_lobby' });
      const alreadyPlaying = Object.values(this.activeGames).some(game => game.players.some(player => String(player.id) === uid && !player.left));
      const inLobby = Object.values(this.lobbies).some(lobby => lobby.players?.some(player => String(player.id) === uid && !player.left));
      if (alreadyPlaying || inLobby) return socket.emit('diceathon-error', { reason: 'already_in_lobby' });
      const existing = this.diceathonQueue.get(uid);
      if (existing && existing !== socket) return socket.emit('diceathon-error', { reason: 'already_queued' });
      if (!existing && this.diceathonQueue.size >= 600) return socket.emit('diceathon-error', { reason: 'queue_full' });
      this.diceathonQueue.set(uid, socket);
      this.notifyDiceathonQueue();
      this.matchDiceathon().catch(err => console.error('[Diceathon] Matchmaking failed:', err));
    });

    // ---------- CREATE LOBBY ----------
    socket.on("create-lobby", async (config = {}, maybeUserId) => {
      try {
        // ✅ Check authentication first
        if (!this.ensureSessionAuthenticated(socket)) {
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
        if (this.diceathonReservations?.has(String(uid))) return socket.emit('create-failed', { reason: 'already_in_lobby' });
        if (!uid) {
          console.error('[LobbyManager] create-lobby: CRITICAL - user.id is undefined after auth check');
          return socket.emit("create-failed", { reason: "invalid_user" });
        }

        if (this.consumeSocketRate(socket, 'create-lobby', 5)) {
          return socket.emit('create-failed', { reason: 'rate_limited', retryable: true });
        }
        const configuredLobbyLimit = Number(process.env.MAX_LOBBIES);
        const lobbyLimit = Number.isInteger(configuredLobbyLimit) && configuredLobbyLimit > 0 ? configuredLobbyLimit : 500;
        if (Object.keys(this.lobbies).length >= lobbyLimit) {
          return socket.emit('create-failed', { reason: 'server_full', retryable: true });
        }
        const ownedLobbies = Object.values(this.lobbies)
          .filter((entry) => String(entry?.hostUserId || entry?.hostuserid || '') === String(uid)).length;
        if (ownedLobbies >= 3) {
          return socket.emit('create-failed', { reason: 'lobby_limit' });
        }

        if (!config || typeof config !== 'object' || Array.isArray(config)) return socket.emit('create-failed', { reason: 'invalid_config' });
        // Official event tables may only be created by the matchmaking server.
        const { diceathon, eventMode, eventType, eventKey, eventName, allowCombinedModes, ...ordinaryConfig } = config;
        const lobbyConfig = normalizeLobbyConfig(ordinaryConfig);
        this.leaveDiceathonQueue(socket, true);

        // ensure unique code (retry if collision)
        let code = null;
        for (let i = 0; i < 12 && !code; i++) {
          const candidate = generateLobbyCode(6);
          if (!this.lobbies[candidate]) code = candidate;
        }
        if (!code) code = generateLobbyCode(6);

        const playerObj = {
          id: socket.data.user.id,
          name: socket.data.user.name || `Guest${String(uid).substring(0, 6)}`,
          team: this.getPlayerTeam(lobbyConfig, 0),
          ready: false,
          left: false,
          connected: true
        };

        const lobby = {
          code,
          hostSocketId: socket.id,
          hostUserId: socket.data.user.id,
          players: [playerObj],
          config: lobbyConfig,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          updated_user: {
            id: socket.data.user.id,
            name: socket.data.user.name,
            timestamp: Date.now()
          }
        };

        this.lobbies[code] = lobby;

        try { await this.persistLobby(code); } catch (e) { console.warn("[LobbyManager] failed to persist created lobby:", e); }

        const hostUserId = lobby.hostuserid || lobby.hostUserId || null;
        if (hostUserId && String(hostUserId) === String(uid)) {
          lobby.hostSocketId = socket.id;
          lobby.hostsocketid = socket.id;
        }

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
        maybeUserId = null;
        // ✅ Check authentication first (with auto-auth attempt)
        if (!this.ensureSessionAuthenticated(socket)) {
          // ✅ CRITICAL FIX: If socket not authenticated but userId provided, try to use it as fallback
          if (false && maybeUserId && typeof maybeUserId === 'string') {
            console.log(`[LobbyManager] join-lobby: unreachable legacy branch hit unexpectedly`);
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

        if (!codeRaw || typeof codeRaw !== "string" || codeRaw.length > 12) return socket.emit("join-failed", { reason: "invalid_code" });
        const code = codeRaw.trim().toUpperCase();
        if (this.consumeSocketRate(socket, 'join-lobby', 30)) {
          return socket.emit("join-failed", { reason: "rate_limited", retryable: true });
        }
        const lobby = this.lobbies[code];
        if (!lobby) return socket.emit("join-failed", { reason: "notfound" });
        lobby.config = normalizeLobbyConfig(lobby.config);

        let uid = socket.data.user?.id || null;
        if (this.diceathonReservations?.has(String(uid))) return socket.emit('join-failed', { reason: 'already_in_lobby' });
        if (!uid) {
          console.warn(`[LobbyManager] join-lobby: No authenticated user ID available`);
          return socket.emit("join-failed", { reason: "invalid_user" });
        }

        const existing = lobby.players.find(p => String(p.id) === String(uid));
        if (isDiceathonConfig(lobby.config) && (!existing || existing.left)) return socket.emit('join-failed', { reason: 'game_started' });
        this.leaveDiceathonQueue(socket, true);
        const game = this.activeGames[code];
        if (game && !game.players.some(p => String(p.id) === String(uid) && !p.left)) {
          return socket.emit('join-failed', { reason: 'game_started' });
        }
        // A present player may open a second connection even in a full lobby.
        const presentCount = (lobby.players || []).filter(p => !p.left).length;
        if ((!existing || existing.left) && presentCount >= (lobby.config?.players || 2)) {
          console.info('[LobbyManager] Lobby full:', code);
          return socket.emit("join-failed", { reason: "full" });
        }

        // ✅ FIX: Use uid (which could be from socket.data.user.id or fallback maybeUserId)
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
            team: this.getPlayerTeam(lobby.config, presentCount),
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

          try { await this.persistLobby(code); } catch (e) { console.warn("[LobbyManager] save after join failed:", e); }
        } else {
          if (existing.left) {
            existing.left = false;
            existing.connected = true;
            existing.ready = false;
            const existingIndex = lobby.players.findIndex(p => String(p.id) === String(uid));
            existing.team = this.getPlayerTeam(lobby.config, existingIndex);
            try { await this.persistLobby(code); } catch (e) { console.warn("[LobbyManager] save after rejoin failed:", e); }
          } else {
            existing.connected = true;
          }
        }

        socket.join(code);
        
        // ✅ CRITICAL FIX: Ensure socket.data.user is set for future operations
        // If we used fallback userId, now authenticate the socket properly
        if (false && !socket.data.user && uid) {
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
          players: this.attachLobbyTeams(lobby.players, lobby.config),
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
      if (!this.ensureSessionAuthenticated(socket, false) || !this.isLobbyMember(lobby, socket)) {
        console.warn(`[LobbyManager] request-lobby-data denied for ${socket.id}: not a member of ${code}`);
        socket.emit("lobby-data-denied", { code, reason: "not_member" });
        return;
      }
      socket.emit("lobby-data", {
        code,
        players: this.attachLobbyTeams(lobby.players, lobby.config),
        hostSocketId: lobby.hostsocketid || lobby.hostSocketId || lobby.host || null,
        hostUserId: lobby.hostuserid || lobby.hostUserId || null,
        config: lobby.config
      });
    });

    // ---------- REQUEST GAME STATE ----------
    socket.on("request-game-state", (payload) => {
      const code = (payload && payload.code) ? String(payload.code).trim().toUpperCase() : null;
      if (!code) return;
      const game = this.activeGames[code];
      const lobbySnapshot = this.lobbies[code];
      if (!this.ensureSessionAuthenticated(socket, false)) {
        socket.emit("game-state-denied", { code, reason: "unauthenticated" });
        return;
      }
      const isMember = (game && this.isGameMember(game, socket)) || (lobbySnapshot && this.isLobbyMember(lobbySnapshot, socket));
      if (!isMember) {
        console.warn(`[LobbyManager] request-game-state denied for ${socket.id}: not a member of ${code}`);
        socket.emit("game-state-denied", { code, reason: "not_member" });
        return;
      }
      if (!game) {
        // return lobby snapshot if game not started
        const lobby = this.lobbies[code];
        if (lobby) {
          const players = this.attachLobbyTeams(lobby.players, lobby.config);
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
      const players = game.players.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        avatar: p.avatar,
        playerIcon: p.playerIcon,
        team: p.team || null,
        left: !!p.left,
        connected: p.connected !== false,
        score: p.score,
        comboStats: p.comboStats
      }));
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
        currentPlayerHasRolled: !!game.players[game.currentIndex]?.hasRolled,
        currentPlayerRolling: !!game.rollInProgress,
        timeLimitSeconds: game.timeLimitSeconds,
        config: game.config,
        turnExpiresAt: game.turnExpiresAt || null
      });
    });

    // ---------- TOGGLE READY ----------
    socket.on("toggle-ready", async (codeRaw, maybeUserId) => {
      try {
        // ✅ Check authentication first (with auto-auth attempt)
        if (!this.ensureSessionAuthenticated(socket)) {
          console.warn(`[LobbyManager] toggle-ready: unauthenticated socket`);
          socket.emit('auth-required', {
            event: 'toggle-ready',
            message: 'Must authenticate to toggle ready status',
            retryable: true
          });
          return;
        }

        if (this.consumeSocketRate(socket, 'toggle-ready', 60)) return;
        if (typeof codeRaw !== "string") return;
        const code = codeRaw.trim().toUpperCase();
        const lobby = this.lobbies[code];
        if (!lobby || isDiceathonConfig(lobby.config)) return;

        let uid = socket.data.user?.id || null;
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
        
        try { await this.persistLobby(code); } catch (e) { console.warn("[LobbyManager] save after toggle-ready failed:", e); }
        this.broadcastLobbyUpdate(code);
      } catch (err) {
        console.error('[LobbyManager] Error in toggle-ready:', err);
      }
    });

    // ---------- TEAM CHANGED ----------
    socket.on("team-changed", async (payload) => {
      try {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
        const { code: codeRaw, playerId, team } = payload;
        if (!this.ensureSessionAuthenticated(socket, false)) return;
        if (typeof codeRaw !== "string") return;
        const code = codeRaw.trim().toUpperCase();
        const lobby = this.lobbies[code];
        if (!lobby) return;

        lobby.config = normalizeLobbyConfig(lobby.config);
        if (!lobby.config.teamsEnabled) return;
        const hostUserId = lobby.hostuserid || lobby.hostUserId || null;
        if (!socket.data.user?.id || String(socket.data.user.id) !== String(hostUserId)) return;
        if (this.consumeSocketRate(socket, 'team-changed', 30)) return;

        const playerIndex = lobby.players.findIndex((player) => String(player.id) === String(playerId));
        if (playerIndex < 0) return;

        const safeTeam = team === 'red' ? 'red' : 'blue';
        lobby.config.teams[playerIndex] = safeTeam;
        lobby.players[playerIndex].team = safeTeam;
        lobby.updatedAt = Date.now();
        if (socket.data.user) {
          lobby.updated_user = {
            id: socket.data.user.id,
            name: socket.data.user.name,
            timestamp: Date.now()
          };
        }

        const activeGame = this.activeGames[code];
        if (activeGame?.players?.[playerIndex]) {
          activeGame.players[playerIndex].team = safeTeam;
        }

        await this.persistLobby(code);
        this.broadcastLobbyUpdate(code);
        if (activeGame) {
          this.emitGameState(code);
        }
      } catch (err) {
        console.error('[LobbyManager] Error in team-changed:', err);
      }
    });

    // ---------- LEAVE LOBBY ----------
    socket.on("leave-lobby", async (codeRaw) => {
      if (typeof codeRaw !== "string") return;
      const code = codeRaw.trim().toUpperCase();
      if (!this.ensureSessionAuthenticated(socket, false)) return;
      if (this.consumeSocketRate(socket, 'leave-lobby', 30)) return;
      await this.removePlayerFromLobby(code, socket);
    });

    // ---------- START GAME ----------
    const startGame = async (codeRaw, serverStarted = false) => {
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
        if (!this.ensureSessionAuthenticated(socket)) {
          console.warn(`[LobbyManager] start-game: unauthenticated socket`);
          socket.emit('auth-required', {
            event: 'start-game',
            message: 'Host must be authenticated to start the game',
            retryable: true
          });
          return socket.emit("game-failed", { reason: "host_unauthenticated" });
        }

        const hostUserId = lobby.hostuserid || lobby.hostUserId || null;
        if (isDiceathonConfig(lobby.config) && !serverStarted) return socket.emit('game-failed', { reason: 'server_authoritative' });
        if (this.activeGames[code]) return socket.emit('game-failed', { reason: 'already_started' });
        if (!hostUserId || String(socket.data.user.id) !== String(hostUserId)) {
          socket.emit("game-failed", { reason: "not_host" });
          return;
        }

        lobby.hostSocketId = socket.id;
        lobby.hostsocketid = socket.id;

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
        if ((lobby.starting && !serverStarted) || this.activeGames[code]) return socket.emit('game-failed', { reason: 'already_started' });
        lobby.starting = true;
        let gamePlayersWithAvatars = [];
        for (const p of activePlayers) {
          const playerIndex = gamePlayersWithAvatars.length;
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
            team: this.getPlayerTeam(lobby.config, playerIndex),
            score: 0,
            comboStats: { pair:0, twoPair:0, triple:0, fullHouse:0, fourOfAKind:0, fiveOfAKind:0, straight:0 },
            hasRolled: false,
            left: false,
            connected: true
          });
        }

        const gameConfig = normalizeLobbyConfig(lobby.config || {});
        const game = {
          code,
          config: gameConfig,
          players: gamePlayersWithAvatars,
          currentIndex: 0,
          round: 1,
          totalRounds: gameConfig.rounds,
          combosEnabled: !!gameConfig.combos,
          multiplexEnabled: !!gameConfig.multiplex,
          turnTimer: null,
          turnExpiresAt: null,
          rollInProgress: false,
          timeLimitSeconds: gameConfig.timeLimitSeconds || 30,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        // Players may have left while profile data was loading.
        if (this.lobbies[code] !== lobby || activePlayers.some(p => p.left) ||
            (serverStarted && (!this.getDiceathonSchedule().active || activePlayers.length !== 6 || activePlayers.some(p => !p.connected || ![...this.io.sockets.sockets.values()].some(s => s.connected && s.rooms.has(code) && String(s.data.user?.id) === String(p.id)))))) {
          lobby.starting = false;
          return socket.emit('game-failed', { reason: 'players_not_ready' });
        }
        this.activeGames[code] = game;
        lobby.starting = false;

        // notify clients (invite to transition)
        this.io.to(code).emit("game-starting", { code, config: game.config, players: this.attachLobbyTeams(lobby.players, game.config) });

        // build per-socket state and send
        const statePayload = {
          config: game.config,
          players: game.players.map(p => ({ id: p.id, name: p.name, type: p.type, avatar: p.avatar, playerIcon: p.playerIcon, team: p.team || null, connected: true })),
          scores: game.players.map(p => p.score),
          comboStats: game.players.map(p => p.comboStats),
          round: game.round,
          totalRounds: game.totalRounds,
          room: code,
          currentPlayerIndex: game.currentIndex,
          currentPlayerHasRolled: !!game.players[game.currentIndex]?.hasRolled,
          currentPlayerRolling: !!game.rollInProgress,
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
        setTimeout(() => { if (this.activeGames[code] === game) this.emitGameState(code); }, 80);
        setTimeout(() => { if (this.activeGames[code] === game && !game.turnStarted && !game.turnAdvancing && !game.turnId) this.startTurn(code); }, 180);
      } catch (err) {
        const code = typeof codeRaw === 'string' ? codeRaw.trim().toUpperCase() : '';
        if (this.lobbies[code]) this.lobbies[code].starting = false;
        console.error('[LobbyManager] Error in start-game:', err);
        socket.emit("game-failed", { reason: "server_error" });
      }
    };
    socket.on('start-game', code => startGame(code));
    socket.data.startDiceathonGame = code => startGame(code, true);

    // ---------- PLAYER ROLL ----------
    socket.on("player-roll", (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const { code } = payload;
      if (!code || typeof code !== "string" || !this.ensureSessionAuthenticated(socket, false)) return;
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
      if (!game.turnStarted || player.hasRolled || game.rollInProgress || Date.now() >= game.turnExpiresAt) return;
      game.rollInProgress = true;
      const turnId = game.turnId;

      // announce rolling
      this.io.to(codeU).emit("player-rolling", { playerIndex, currentPlayerRolling: true });

      if (game.turnTimer) { clearTimeout(game.turnTimer); game.turnTimer = null; }

      setTimeout(() => {
        const liveGame = this.activeGames[codeU];
        if (!liveGame || liveGame !== game || game.turnId !== turnId || player.left || !game.rollInProgress) return;

        try {
          const dice = rollDice(5);
          const { points, combo } = calculateScore(dice, game.combosEnabled, game.multiplexEnabled);

          player.score += points;
          if (combo && combo.key) player.comboStats[combo.key] = (player.comboStats[combo.key] || 0) + 1;
          player.hasRolled = true;

          const graceMs = 10_000;
          game.turnExpiresAt = Date.now() + graceMs;
          game.rollInProgress = false;

          this.io.to(codeU).emit("turn-result", {
            playerIndex,
            dice,
            scored: points,
            combo: combo || null,
            scores: game.players.map(p => p.score),
            comboStats: game.players.map(p => p.comboStats),
            round: game.round,
            currentPlayerHasRolled: true,
            currentPlayerRolling: false,
            turnExpiresAt: game.turnExpiresAt
          });

          if (game.turnTimer) { clearTimeout(game.turnTimer); game.turnTimer = null; }
          game.turnTimer = setTimeout(() => {
            if (this.activeGames[codeU] === game && game.turnId === turnId) this.advanceTurn(codeU);
          }, graceMs);
        } catch (err) {
          game.rollInProgress = false;
          console.error('[LobbyManager] player-roll processing failed:', err);
        }
      }, 700);
    });

    // ---------- PLAYER END TURN ----------
    socket.on("player-end-turn", (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const { code } = payload;
      if (!code || typeof code !== "string" || !this.ensureSessionAuthenticated(socket, false)) return;
      const codeU = code.trim().toUpperCase();
      const game = this.activeGames[codeU];
      if (!game || !game.turnStarted || game.turnAdvancing) return;

      const currentPlayer = game.players[game.currentIndex];

      // check if the player has left
      if (!currentPlayer || currentPlayer.left || currentPlayer.id !== socket.data.user?.id) return;
      if (!currentPlayer.hasRolled) {
        socket.emit("end-turn-failed", { reason: "not_rolled" });
        return;
      }

      this.advanceTurn(codeU);
    });

    // ---------- PLAYER TIMEOUT ----------
    // The server's timer alone decides when a turn expires. Client timeout
    // notifications are intentionally ignored; browser clocks can be wrong.
    socket.on("player-timeout", () => {});

    // ---------- GAME FINISHED ----------
    socket.on("game-finished", async (codeRaw) => {
      if (!codeRaw || typeof codeRaw !== "string") return;
      const code = codeRaw.trim().toUpperCase();

      // Game completion is server-authoritative. A player wishing to forfeit
      // uses leave-lobby instead; knowing a code must never end someone’s game.
      socket.emit("game-finished-denied", { code, reason: "server_authoritative" });
    });

    // ---------- DISCONNECT ----------
    socket.on("disconnecting", async () => {
      this.leaveDiceathonQueue(socket);
      // remove this socket's user from any lobby where they are a member
      const uid = socket.data.user?.id;
      if (!uid) return;

      // Iterate lobbies and only call removePlayerFromLobby when this user is present
      const codes = [...socket.rooms].filter(code => code !== socket.id && !code.startsWith('session:'));
      await Promise.all(codes.map(code => this.removePlayerFromLobby(code, socket, { disconnecting: true }).catch(e => {
        console.warn('[LobbyManager] removePlayerFromLobby during disconnect failed:', e);
      })));
    });
  }

  // Remove player (and handle host transfer / cleanup)
  async removePlayerFromLobby(codeRaw, socket, { disconnecting = false } = {}) {
  if (!codeRaw || typeof codeRaw !== "string") return;
  const code = codeRaw.trim().toUpperCase();
  let uid = socket.data.user?.id;
  
  console.log(`[LobbyManager] removePlayerFromLobby called for code=${code}, uid=${uid}, socketId=${socket.id}`);
  
  // A second connection for the same account must not surrender the first
  // connection's game when it disconnects or leaves another room.
  const wasInRoom = !!socket.rooms?.has(code);
  if (!wasInRoom) return;
  const room = this.io.sockets.adapter.rooms.get(code);
  const otherConnections = [...(room || [])].map(id => this.io.sockets.sockets.get(id))
    .filter(other => other && other.id !== socket.id && other.connected &&
      other.rooms.has(code) && String(other.data?.user?.id) === String(uid));
  socket.leave(code);
  if (disconnecting && otherConnections.length) return;
  // Explicitly leaving is surrender, even if this account has another tab.
  for (const other of otherConnections) other.leave(code);

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
      if (!uid || !gameOnly.players.some(p => String(p.id) === String(uid))) return;
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
        if (gameOnly.turnTimer) clearTimeout(gameOnly.turnTimer);
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
        if (String(gameOnly.players[gameOnly.currentIndex]?.id) === String(uid)) {
          if (gameOnly.turnTimer) clearTimeout(gameOnly.turnTimer);
          gameOnly.rollInProgress = false;
          await this.advanceTurn(code);
        } else {
          this.emitGameState(code);
        }
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
  if (!pl || pl.left) {
    return;
  }

  console.log(`[LobbyManager] Marking player ${uid} as left in lobby ${code}`);
  pl.left = true;
  pl.connected = false;

  // Mark the game immediately, before asynchronous persistence permits a
  // pending roll or another departure to observe a stale active player.
  const game = this.activeGames[code];
  const gamePlayer = game?.players.find(p => String(p.id) === String(uid));
  const wasCurrentPlayer = !!gamePlayer && game.players[game.currentIndex] === gamePlayer;
  if (gamePlayer) {
    gamePlayer.left = true;
    gamePlayer.connected = false;
    if (wasCurrentPlayer) {
      game.turnStarted = false;
      game.rollInProgress = false;
      if (game.turnTimer) clearTimeout(game.turnTimer);
      game.turnTimer = null;
    }
  }

  // If everyone left -> delete lobby
  const activeCount = (lobby.players || []).filter(p => !p.left).length;
  if (activeCount === 0) {
    console.log(`[LobbyManager] All players left lobby ${code}, deleting...`);
    delete this.lobbies[code];
    if (game) {
      if (game.turnTimer) clearTimeout(game.turnTimer);
      delete this.activeGames[code];
    }
    try { 
      await deleteLocalLobby(code);
      console.log(`[LobbyManager] ✅ Removed empty lobby ${code} from local storage`);
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
  const currentHost = lobby.hostuserid || lobby.hostUserId;
  if (!currentHost || !remainingIds.has(String(currentHost))) {
    const newHost = lobby.players.find(p => !p.left);
    lobby.hostUserId = lobby.hostuserid = newHost ? newHost.id : null;
    const newHostSocket = [...this.io.sockets.sockets.values()].find(s => String(s.data?.user?.id) === String(newHost?.id));
    lobby.hostSocketId = lobby.hostsocketid = newHostSocket ? newHostSocket.id : null;
    console.log(`[LobbyManager] Host transferred to ${newHost?.id} for lobby ${code}`);
  } else {
    const hostSocketId = lobby.hostsocketid || lobby.hostSocketId;
    if (hostSocketId) {
      const sockExists = Boolean(this.io.sockets.sockets.get(hostSocketId));
      if (!sockExists) {
        const newHostSocket = [...this.io.sockets.sockets.values()].find(s => String(s.data?.user?.id) === String(currentHost));
        lobby.hostSocketId = lobby.hostsocketid = newHostSocket ? newHostSocket.id : null;
        console.log(`[LobbyManager] Updated host socket ID for ${currentHost} in lobby ${code}`);
      }
    }
  }

  // broadcast update (clients will display left/connected false)
  this.broadcastLobbyUpdate(code);

  // If there is an active game associated with this room, mark player as left there too (do not re-index)
  if (game && this.activeGames[code] === game) {
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
      if (game.turnTimer) clearTimeout(game.turnTimer);
      delete this.activeGames[code];
      
      // ✅ FIX: Also delete the corresponding lobby when game ends with all players gone
      if (this.lobbies[code]) {
        console.log(`[LobbyManager] Deleting lobby ${code} since game ended with all players gone`);
        delete this.lobbies[code];
        deleteLocalLobby(code).catch(e => console.warn("[LobbyManager] deleteLocalLobby failed:", e));
        deleteSupabaseLobby(code).catch(e => console.warn("[LobbyManager] deleteSupabaseLobby failed:", e));
      }
      return;
    }

    // Only advance when the current player surrendered. A non-current player's
    // departure must not reset the current turn, roll state, score or timer.
    if (wasCurrentPlayer) {
      await this.advanceTurn(code);
    } else {
      this.emitGameState(code);
    }
  }

  // Do not block turn progression on a slow lobby store.
  try {
    await this.persistLobby(code);
    console.log(`[LobbyManager] ✅ Persisted player left status for ${uid} in lobby ${code}`);
  } catch (e) {
    console.warn("[LobbyManager] persist after removePlayer failed:", e);
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
      
      const isExpired = !this.activeGames[code] && !lobby.starting && (now - (lobby.updatedAt || lobby.createdAt || 0)) > EXPIRE_MS;
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
    const activePlayers = this.attachLobbyTeams(getActivePlayers(lobby.players), lobby.config);
    
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
      players: game.players.map(p => ({ id: p.id, name: p.name, type: p.type, avatar: p.avatar, playerIcon: p.playerIcon, team: p.team || null, score: p.score, left: !!p.left, connected: p.connected !== false })),
      scores: game.players.map(p => p.score),
      comboStats: game.players.map(p => p.comboStats),
      round: game.round,
      totalRounds: game.totalRounds,
      room: code,
      currentPlayerIndex: game.currentIndex,
      currentPlayerHasRolled: !!game.players[game.currentIndex]?.hasRolled,
      currentPlayerRolling: !!game.rollInProgress,
      timeLimitSeconds: game.timeLimitSeconds,
      turnExpiresAt: game.turnExpiresAt || null,
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
    game.rollInProgress = false;
    game.turnStarted = true;
    game.turnAdvancing = false;
    game.turnId = (game.turnId || 0) + 1;
    const turnId = game.turnId;

    const timeLimitSeconds = Number.isFinite(game.timeLimitSeconds) && game.timeLimitSeconds >= 5 && game.timeLimitSeconds <= 300
      ? game.timeLimitSeconds : 30;
    game.turnExpiresAt = Date.now() + (timeLimitSeconds * 1000);

    this.io.to(code).emit("turn-start", {
      playerIndex,
      currentPlayerIndex: playerIndex,
      currentPlayerHasRolled: false,
      currentPlayerRolling: false,
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

    game.turnTimer = setTimeout(() => {
      if (this.activeGames[code] === game && game.turnId === turnId) this.handleTimeout(code);
    }, timeLimitSeconds * 1000);
  }

  handleTimeout(code) {
    const game = this.activeGames[code];
    if (!game) return;

    const playerIndex = game.currentIndex;
    const player = game.players[playerIndex];
    if (!player || player.left || player.hasRolled || game.rollInProgress || !game.turnStarted) return;
    const remaining = game.turnExpiresAt - Date.now();
    if (remaining > 0) {
      const turnId = game.turnId;
      game.turnTimer = setTimeout(() => {
        if (this.activeGames[code] === game && game.turnId === turnId) this.handleTimeout(code);
      }, remaining);
      return;
    }
    player.hasRolled = true;
    const turnId = game.turnId;
    if (game.turnTimer) clearTimeout(game.turnTimer);

    const dice = rollDice(5);
    const { points, combo } = calculateScore(dice, game.combosEnabled, game.multiplexEnabled);

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
      currentPlayerHasRolled: true,
      currentPlayerRolling: false,
      turnExpiresAt: game.turnExpiresAt
    });

    game.turnTimer = setTimeout(() => {
      if (this.activeGames[code] === game && game.turnId === turnId) this.advanceTurn(code);
    }, 3000);
  }

  async advanceTurn(code) {
    const game = this.activeGames[code];
    if (!game || game.turnAdvancing) return;
    game.turnAdvancing = true;
    game.turnStarted = false;

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
          await deleteLocalLobby(code);
          console.log(`[LobbyManager] ✅ Removed lobby ${code} from local storage`);
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
          const finishedLobby = this.lobbies[gameCode];
          setTimeout(() => {
            if (this.lobbies[gameCode] === finishedLobby && !this.activeGames[gameCode]) {
              console.log(`[LobbyManager] Cleaning up lobby ${gameCode} (post-game cleanup)`);
              delete this.lobbies[gameCode];
              try { 
                deleteLocalLobby(gameCode).catch(e => console.warn("[LobbyManager] deleteLocalLobby delayed failed:", e));
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
    if (this.diceathonQueueTimer) clearTimeout(this.diceathonQueueTimer);
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
