import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// lowdb (local fallback) setup
const lobbiesFile = path.join(__dirname, "../data/lobbies.json");
const adapter = new JSONFile(lobbiesFile);
const lobbiesDb = new Low(adapter);
await lobbiesDb.read();
lobbiesDb.data ||= {};
lobbiesDb.data.lobbies ||= {};
const LOCAL_DB_PATH = lobbiesFile;
const DEFAULT_EXPIRE_MS = 1000 * 60 * 60 * 3;

// In-memory cache for lobbies (needed for Vercel read-only filesystem)
const lobbyMemoryCache = new Map();
const isVercel = process.env.VERCEL === '1';

// try to create supabase client (optional)
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;
if (SUPA_URL && SUPA_KEY) {
  try {
    supabase = createClient(SUPA_URL, SUPA_KEY);
  } catch (err) {
    console.warn('[lobbyStorage] Supabase init failed, falling back to local DB', err);
    supabase = null;
  }
} else {
  // no env — remain silent-ish but informative
  // console.info('[lobbyStorage] Supabase not configured, using local storage.');
}

let _writeLock = Promise.resolve();
function enqueueWrite(fn) {
  // ensure fn runs only after previous write finished
  _writeLock = _writeLock.then(() => fn()).catch(err => {
    // swallow so the chain continues; caller handles the error if needed
    console.error('[lobbyStorage] enqueueWrite inner error:', err);
  });
  return _writeLock;
}

async function _safeLocalWrite() {
  // On Vercel/serverless, filesystem is read-only, so skip writes
  if (isVercel) {
    console.debug('[lobbyStorage] Vercel environment: skipping filesystem write (read-only)');
    return;
  }

  // attempt lowdb write with simple backoff
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await lobbiesDb.write();
      console.info('[lobbyStorage] wrote local DB via lowdb at', new Date().toISOString());
      return;
    } catch (err) {
      // Read-only filesystem - give up and use memory cache
      if (err && (err.code === 'EROFS' || err.code === 'EACCES')) {
        console.warn(`[lobbyStorage] Filesystem is read-only (${err.code}), using memory cache only`);
        return; // Don't throw - just use memory cache
      }

      // transient-ish errors we want to retry
      if (err && (err.code === 'EPERM' || err.code === 'EBUSY')) {
        const waitMs = 80 * (attempt + 1);
        console.warn(`[lobbyStorage] local write attempt ${attempt + 1} failed (${err.code}), retrying in ${waitMs}ms`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // non-transient: rethrow
      throw err;
    }
  }

  // retries exhausted — final fallback: direct write to file (non-atomic)
  try {
    // Ensure directory exists (should be), then write readable JSON
    const dump = JSON.stringify(lobbiesDb.data || { lobbies: {} }, null, 2);
    await fs.writeFile(LOCAL_DB_PATH, dump, 'utf8');
    console.warn('[lobbyStorage] local write fallback succeeded via direct fs.writeFile (non-atomic). Consider excluding the project from OneDrive/antivirus.');
    console.info('[lobbyStorage] wrote local DB via fs.writeFile at', new Date().toISOString());
    return;
  } catch (err) {
    console.error('[lobbyStorage] direct fs.writeFile fallback failed:', err);
    throw err;
  }
}

function _rowToLobby(row) {
  if (!row) return null;
  // accept either snake_case created_at (supabase) or createdAt (local)
  const { created_at, createdAt, code, players, config, hostSocketId, hostUserId, ...rest } = row;
  return {
    code: String(code).trim().toUpperCase(),
    hostSocketId: hostSocketId ?? null,
    hostUserId: hostUserId ?? null,
    players: Array.isArray(players) ? players : (players || []),
    config: config ?? { players: 2, rounds: 20, combos: false },
    createdAt: typeof createdAt === 'number' ? createdAt : (typeof created_at === 'number' ? created_at : Date.now()),
    ...rest
  };
}

function _lobbyToRow(lobby) {
  if (!lobby) return null;
  const {
    code,
    hostSocketId,
    hostUserId,
    players,
    config,
    createdAt,
    ...rest
  } = lobby;

  return {
    code: String(code).trim().toUpperCase(),
    hostSocketId: hostSocketId ?? null,
    hostUserId: hostUserId ?? null,
    players: Array.isArray(players) ? players : (players || []),
    config: config ?? { players: 2, rounds: 20, combos: false },
    created_at: typeof createdAt === 'number' ? createdAt : Date.now(),
    ...rest
  };
}

// ----------------- Public API -----------------

/**
 * loadLobbies()
 * Returns an object map keyed by lobby code: { CODE: lobby, ... }
 * Handles empty/missing Supabase schema tables gracefully
 */
export async function loadLobbies() {
  // Try Supabase first
  if (supabase) {
    try {
      const { data, error } = await supabase.from('lobbies').select('*');
      
      // Check for common Supabase errors indicating missing/empty schema
      if (error) {
        // Handle "table does not exist" or schema errors
        if (error.code === 'PGRST116' || error.code === '42P01' || 
            error.message?.includes('does not exist') ||
            error.message?.includes('relation') ||
            error.message?.includes('schema')) {
          console.warn('[lobbyStorage] Supabase table "lobbies" does not exist or schema not initialized, falling back to local DB');
        } else {
          console.warn('[lobbyStorage] Supabase loadLobbies error:', error?.message || error);
        }
        throw error;
      }
      
      // Handle empty result set (valid response, just no data)
      if (!data || (Array.isArray(data) && data.length === 0)) {
        console.info('[lobbyStorage] Supabase returned no lobbies (table empty or just initialized)');
        return {};
      }
      
      // Successfully loaded data from Supabase
      const map = {};
      (data || []).forEach(r => {
        const l = _rowToLobby(r);
        if (l && l.code) map[String(l.code).trim().toUpperCase()] = l;
      });
      console.info('[lobbyStorage] Loaded', Object.keys(map).length, 'lobbies from Supabase');
      return map;
    } catch (err) {
      console.warn('[lobbyStorage] Supabase loadLobbies failed, falling back to local DB:', err?.message || err);
      // fall through to local
    }
  }

  // Local fallback
  await lobbiesDb.read();
  lobbiesDb.data ||= {};
  lobbiesDb.data.lobbies ||= {};
  // Ensure normalized shape
  const out = {};
  const raw = lobbiesDb.data.lobbies || {};
  for (const k of Object.keys(raw)) {
    try {
      const norm = _rowToLobby({ ...(raw[k] || {}), code: k });
      if (norm && norm.code) out[String(norm.code).trim().toUpperCase()] = norm;
    } catch (e) {
      // ignore malformed entries
    }
  }
  return out;
}

/**
 * saveLobby(lobby)
 * Upserts a single lobby (expects lobby.code). Returns normalized lobby object.
 * Handles Supabase schema errors gracefully.
 */
export async function saveLobby(lobby) {
  if (!lobby || !lobby.code) throw new Error('saveLobby expects a lobby object with a code');

  const row = _lobbyToRow(lobby);

  if (supabase) {
    try {
      const { data, error } = await supabase.from('lobbies').upsert(row, { onConflict: 'code' }).select();
      
      // Check for schema/table errors
      if (error) {
        if (error.code === 'PGRST116' || error.code === '42P01' ||
            error.message?.includes('does not exist') ||
            error.message?.includes('relation') ||
            error.message?.includes('schema')) {
          console.warn('[lobbyStorage] Supabase table "lobbies" missing or not initialized, saving to local only');
        } else {
          console.warn('[lobbyStorage] Supabase saveLobby error:', error?.message || error);
        }
        throw error;
      }
      
      const retRow = Array.isArray(data) && data[0] ? data[0] : row;
      console.info('[lobbyStorage] Successfully saved lobby', row.code, 'to Supabase');
      return _rowToLobby(retRow);
    } catch (err) {
      console.warn('[lobbyStorage] Supabase saveLobby failed, saving to local file instead:', err?.message || err);
      // fallthrough to local
    }
  }

  // local fallback write
  await lobbiesDb.read();
  lobbiesDb.data ||= {};
  lobbiesDb.data.lobbies ||= {};
  const code = String(row.code).trim().toUpperCase();
  const players = Array.isArray(row.players) ? row.players : (row.players || []);
  const createdAt = typeof row.created_at === 'number' ? row.created_at : (typeof row.createdAt === 'number' ? row.createdAt : Date.now());

  // If the incoming single-lobby row has no players or is expired, remove any existing entry instead of writing it.
  if (!Array.isArray(players) || players.length === 0 || (Date.now() - createdAt > DEFAULT_EXPIRE_MS)) {
    if (lobbiesDb.data.lobbies && lobbiesDb.data.lobbies[code]) {
      delete lobbiesDb.data.lobbies[code];
      await enqueueWrite(async () => _safeLocalWrite());
      console.info(`[lobbyStorage] saveLobby: removed empty/expired lobby ${code} from local DB`);
    }
    return null;
  }
  
  lobbiesDb.data.lobbies[code] = row;
  await enqueueWrite(async () => _safeLocalWrite());
  return _rowToLobby({ ...row, code });
}

/**
 * saveLobbies(lobbies)
 * Accepts object map { CODE: lobby } or array of lobby objects.
 * Returns a map of saved lobbies keyed by code.
 * Handles Supabase schema errors gracefully.
 */
export async function saveLobbies(lobbies) {
  // Normalize to array of rows
  let arr = [];

  if (!lobbies) arr = [];
  else if (Array.isArray(lobbies)) {
    arr = lobbies.map(l => _lobbyToRow(l));
  } else if (typeof lobbies === 'object') {
    arr = Object.keys(lobbies).map(k => _lobbyToRow({ ...(lobbies[k] || {}), code: k }));
  } else {
    throw new Error('saveLobbies expects an object (map) or array');
  }

  if (supabase) {
    try {
      if (arr.length === 0) return {};
      const { data, error } = await supabase.from('lobbies').upsert(arr, { onConflict: 'code' }).select();
      
      // Check for schema/table errors
      if (error) {
        if (error.code === 'PGRST116' || error.code === '42P01' ||
            error.message?.includes('does not exist') ||
            error.message?.includes('relation') ||
            error.message?.includes('schema')) {
          console.warn('[lobbyStorage] Supabase table "lobbies" missing, saving', arr.length, 'lobbies to local only');
        } else {
          console.warn('[lobbyStorage] Supabase saveLobbies error:', error?.message || error);
        }
        throw error;
      }
      
      const map = {};
      (data || []).forEach(r => {
        const l = _rowToLobby(r);
        if (l && l.code) map[String(l.code).trim().toUpperCase()] = l;
      });
      return map;
    } catch (err) {
      console.warn('[lobbyStorage] Supabase saveLobbies failed, saving locally', err);
      // fall through to local
    }
  }

  // Local fallback: write whole map (replace)
  await lobbiesDb.read();
  lobbiesDb.data ||= {};
  lobbiesDb.data.lobbies ||= {};

  // If incoming array is empty -> clear the local DB lobbies entirely.
  if (arr.length === 0) {
    lobbiesDb.data.lobbies = {};
    await enqueueWrite(async () => _safeLocalWrite());
    return {};
  }

  // Convert arr back to map keyed by code:
  const map = {};
  arr.forEach(r => {
    // Defensive: skip null/undefined rows
    if (!r || !r.code) return;
    const code = String(r.code).trim().toUpperCase();

    // Defensive checks: skip entries with no players
    const players = Array.isArray(r.players) ? r.players : (r.players || []);
    if (!Array.isArray(players) || players.length === 0) {
      return;
    }

    // Optional: skip expired entries (same TTL)
    const createdAt = typeof r.created_at === 'number'
      ? r.created_at
      : (typeof r.createdAt === 'number' ? r.createdAt : Date.now());
    if (Date.now() - createdAt > DEFAULT_EXPIRE_MS) {
      return;
    }

    map[code] = r;
  });

  // Replace the DB object's lobbies map wholesale and persist
  lobbiesDb.data.lobbies = map;
  await enqueueWrite(async () => _safeLocalWrite());
  
  // Return normalized map of rows -> lobby objects
  const out = {};
  Object.keys(map).forEach(k => {
    try {
      out[k] = _rowToLobby(map[k]);
    } catch (e) { /* ignore malformed */ }
  });

  return out;
}

export async function pruneLocalLobbies({ expireMs = DEFAULT_EXPIRE_MS } = {}) {
  await lobbiesDb.read();
  lobbiesDb.data ||= {};
  lobbiesDb.data.lobbies ||= {};

  const now = Date.now();
  const raw = lobbiesDb.data.lobbies || {};
  let removed = 0;

  for (const key of Object.keys(raw)) {
    try {
      const row = raw[key] || {};
      // accept created_at (supabase style) or createdAt (local)
      const createdAt = typeof row.created_at === 'number' ? row.created_at
                      : (typeof row.createdAt === 'number' ? row.createdAt : null);
      const players = Array.isArray(row.players) ? row.players : (row.players ? row.players : []);

      // remove if no players or expired
      if ((!Array.isArray(players) || players.length === 0) ||
          (createdAt && (now - createdAt) > expireMs)) {
        delete lobbiesDb.data.lobbies[key];
        removed++;
      }
    } catch (e) {
      // on malformed entry, remove it defensively
      delete lobbiesDb.data.lobbies[key];
      removed++;
    }
  }

  if (removed > 0) {
    // persist cleaned DB
    await enqueueWrite(async () => _safeLocalWrite());
  }

  const remaining = Object.keys(lobbiesDb.data.lobbies || {}).length;
  return { removedCount: removed, remainingCount: remaining };
}

export async function deleteSupabaseLobby(code) {
  if (!supabase) {
    return;
  }

  try {
    const { error } = await supabase
      .from('lobbies')
      .delete()
      .eq('code', String(code).trim().toUpperCase());
    if (error) throw error;
  } catch (err) {
    throw err;
  }
}