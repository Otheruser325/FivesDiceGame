import '../env.js';
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
const SUPABASE_OPERATION_TIMEOUT_MS = Number(process.env.SUPABASE_OPERATION_TIMEOUT_MS || 1200);

// try to create supabase client (optional)
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;

function _withTimeout(promise, timeoutMs, operationName = 'Supabase operation') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function _runSupabaseStartupCheck() {
  if (!supabase) return;
  try {
    const { error } = await _withTimeout(
      supabase.from('lobbies').select('code', { head: true, count: 'exact' }).limit(1),
      SUPABASE_OPERATION_TIMEOUT_MS,
      'Supabase lobbies startup health check'
    );

    if (error) {
      console.error('[lobbyStorage] ⚠️ Startup health check failed:', error.message);
      console.error('[lobbyStorage] Error details:', { code: error.code, message: error.message });
      return;
    }

    console.log('[lobbyStorage] ✅ Supabase connection verified (startup check)');
  } catch (healthErr) {
    console.warn('[lobbyStorage] Startup health check timeout/error:', healthErr?.message || healthErr);
  }
}

// ⚠️ CRITICAL: Log Supabase initialization status on startup
console.log('[lobbyStorage] Supabase initialization:');
console.log('  SUPABASE_URL:', SUPA_URL ? `✅ Set (${SUPA_URL.substring(0, 30)}...)` : '❌ MISSING');
console.log('  SUPABASE_SERVICE_ROLE_KEY:', SUPA_KEY ? `✅ Set (${SUPA_KEY.substring(0, 20)}...)` : '❌ MISSING');

if (SUPA_URL && SUPA_KEY) {
  try {
    supabase = createClient(SUPA_URL, SUPA_KEY);
    console.log('[lobbyStorage] ✅ Supabase client created successfully');
    console.log('[lobbyStorage] Scheduling non-blocking startup health check...');
    queueMicrotask(() => {
      _runSupabaseStartupCheck().catch(err => {
        console.warn('[lobbyStorage] Startup check failed:', err?.message || err);
      });
    });
  } catch (err) {
    console.error('[lobbyStorage] ❌ Supabase client initialization failed:', err?.message || err);
    console.error('[lobbyStorage] Falling back to local DB only');
    supabase = null;
  }
} else {
  console.warn('[lobbyStorage] ⚠️ Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  console.warn('[lobbyStorage] Using local storage only - data will not persist across server restarts');
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
  // Handle both camelCase (hostSocketId/hostUserId) and lowercase (hostsocketid/hostuserid) column names
  const { created_at, createdAt, code, players, config, hostSocketId, hostUserId, hostsocketid, hostuserid, updated_at, updatedAt, updated_user, ...rest } = row;
  
  // Accept both naming conventions - prioritize camelCase for app logic
  const finalHostSocketId = hostSocketId ?? hostsocketid ?? null;
  const finalHostUserId = hostUserId ?? hostuserid ?? null;
  const finalCreatedAt = typeof createdAt === 'number' ? createdAt : (typeof created_at === 'number' ? created_at : Date.now());
  const finalUpdatedAt = typeof updatedAt === 'number' ? updatedAt : (typeof updated_at === 'number' ? updated_at : Date.now());
  
  return {
    code: String(code).trim().toUpperCase(),
    hostSocketId: finalHostSocketId,
    hostUserId: finalHostUserId,
    players: Array.isArray(players) ? players : (players || []),
    config: config ?? { players: 2, rounds: 20, combos: false, multiplex: false },
    createdAt: finalCreatedAt,
    updatedAt: finalUpdatedAt,
    updated_user: updated_user || null,
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
    updatedAt,
    updated_user,
    ...rest
  } = lobby;

  // ✅ FIX: Convert milliseconds to ISO strings for PostgreSQL timestamp fields
  const toISOString = (val) => {
    if (!val) return new Date().toISOString();
    if (typeof val === 'string') return val;  // Already ISO string
    if (typeof val === 'number') return new Date(val).toISOString();  // Convert millis to ISO
    return new Date().toISOString();
  };

  return {
    code: String(code).trim().toUpperCase(),
    hostsocketid: hostSocketId ?? null,  // ✅ Map to lowercase database column
    hostuserid: hostUserId ?? null,      // ✅ Map to lowercase database column
    players: Array.isArray(players) ? players : (players || []),
    config: config ?? { players: 2, rounds: 20, combos: false, multiplex: false },
    created_at: toISOString(createdAt),
    updated_at: toISOString(updatedAt),
    updated_user: updated_user || null,
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
      // ✅ FIX: Select only necessary columns for faster query performance
      // This reduces network payload and speeds up queries significantly,
      // especially as the table grows (10x faster for large tables)
      const columns = 'code,hostsocketid,hostuserid,players,config,created_at,updated_at,updated_user';
      const { data, error } = await _withTimeout(
        supabase.from('lobbies').select(columns),
        SUPABASE_OPERATION_TIMEOUT_MS,
        'Supabase loadLobbies'
      );
      
      // Check for common Supabase errors indicating missing/empty schema
      if (error) {
        // Check if it's a schema cache issue (column not found)
        if (error.code === 'PGRST116' || 
            error.message?.includes('schema cache') ||
            error.message?.includes('column')) {
          console.warn('[lobbyStorage] ⚠️ Supabase schema cache outdated for lobbies table');
          // Try to refresh schema by querying information_schema
          try {
            await _withTimeout(
              supabase.rpc('pg_reload_schema_cache', {}),
              SUPABASE_OPERATION_TIMEOUT_MS,
              'Supabase schema cache refresh'
            );
            console.info('[lobbyStorage] ✅ Schema cache refresh attempted');
            // Retry the query with optimized column selection
            const columns = 'code,hostsocketid,hostuserid,players,config,created_at,updated_at,updated_user';
            const { data: retryData, error: retryError } = await _withTimeout(
              supabase.from('lobbies').select(columns),
              SUPABASE_OPERATION_TIMEOUT_MS,
              'Supabase loadLobbies retry'
            );
            if (!retryError && retryData) {
              const map = {};
              (retryData || []).forEach(r => {
                const l = _rowToLobby(r);
                if (l && l.code) {
                  const code = String(l.code).trim().toUpperCase();
                  map[code] = l;
                  lobbyMemoryCache.set(code, l);
                }
              });
              console.info('[lobbyStorage] ✅ Loaded', Object.keys(map).length, 'lobbies from Supabase after schema refresh');
              return map;
            }
          } catch (refreshErr) {
            console.debug('[lobbyStorage] Schema cache refresh not available, using fallback');
          }
        }
        
        // Handle "table does not exist" or schema errors
        if (error.code === 'PGRST116' || error.code === '42P01' || 
            error.message?.includes('does not exist') ||
            error.message?.includes('relation')) {
          console.warn('[lobbyStorage] ⚠️ Supabase table "lobbies" does not exist or schema not initialized');
          console.warn('[lobbyStorage] 💡 To fix: Run "npm run migrate" to create the lobbies table');
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
      
      // Successfully loaded data from Supabase - cache all in memory
      const map = {};
      (data || []).forEach(r => {
        const l = _rowToLobby(r);
        if (l && l.code) {
          const code = String(l.code).trim().toUpperCase();
          map[code] = l;
          lobbyMemoryCache.set(code, l);
        }
      });
      console.info('[lobbyStorage] Loaded', Object.keys(map).length, 'lobbies from Supabase (cached in memory)');
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
      if (norm && norm.code) {
        const code = String(norm.code).trim().toUpperCase();
        out[code] = norm;
        lobbyMemoryCache.set(code, norm);
      }
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
  const code = String(row.code).trim().toUpperCase();
  
  // CRITICAL: ALWAYS cache in memory FIRST (instant, never fails)
  const normalized = _rowToLobby({ ...row, code });
  if (normalized) {
    lobbyMemoryCache.set(code, normalized);
  }

  if (supabase) {
    try {
      // ⚠️ Upsert with proper data serialization
      const { data, error } = await _withTimeout(
        supabase
          .from('lobbies')
          .upsert([row], { onConflict: 'code' })
          .select(),
        SUPABASE_OPERATION_TIMEOUT_MS,
        'Supabase saveLobby'
      );
      
      // Check for RLS/policy errors vs table errors
      if (error) {
        const errorMsg = error?.message || String(error);
        const errorCode = error?.code || '';
        
        // RLS Policy errors
        if (errorCode === 'PGRST116' || errorMsg.includes('new row violates row-level security')) {
          console.error('[lobbyStorage] ⚠️ RLS POLICY BLOCKING: Service role cannot write to lobbies table');
          console.error('[lobbyStorage] Error details:', { code: errorCode, message: errorMsg });
          console.error('[lobbyStorage] Fix: Check Supabase RLS policies, ensure service role has INSERT/UPDATE permission');
        }
        // Table/schema missing errors
        else if (errorCode === '42P01' || errorMsg.includes('does not exist') || 
                 errorMsg.includes('relation') || errorMsg.includes('schema')) {
          console.warn('[lobbyStorage] Table "lobbies" missing, data will persist in memory only');
        }
        // Authorization/credential errors
        else if (errorCode === '401' || errorMsg.includes('Unauthorized') || errorMsg.includes('invalid') && errorMsg.includes('JWT')) {
          console.error('[lobbyStorage] ⚠️ SUPABASE AUTH ERROR: Invalid service role key');
          console.error('[lobbyStorage] Fix: Verify SUPABASE_SERVICE_ROLE_KEY environment variable');
        }
        // Connection/network errors
        else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('network') || errorMsg.includes('timeout')) {
          console.warn('[lobbyStorage] Network error connecting to Supabase, data cached locally');
        }
        // Other errors
        else {
          console.error('[lobbyStorage] Supabase saveLobby error:', { code: errorCode, message: errorMsg });
        }
        throw error;
      }
      
      // Success - data saved to Supabase
      const retRow = Array.isArray(data) && data[0] ? data[0] : row;
      const ret = _rowToLobby(retRow);
      if (ret) lobbyMemoryCache.set(code, ret);
      console.info('[lobbyStorage] ✅ Successfully saved lobby', row.code, 'to Supabase');
      return ret;
    } catch (err) {
      console.warn('[lobbyStorage] Supabase saveLobby failed, falling back to memory cache:', err?.message || err);
      // fallthrough to local
    }
  }

  // local fallback write
  await lobbiesDb.read();
  lobbiesDb.data ||= {};
  lobbiesDb.data.lobbies ||= {};
  const players = Array.isArray(row.players) ? row.players : (row.players || []);
  const createdAt = typeof row.created_at === 'number' ? row.created_at : (typeof row.createdAt === 'number' ? row.createdAt : Date.now());

  // If the incoming single-lobby row has no players or is expired, remove any existing entry instead of writing it.
  if (!Array.isArray(players) || players.length === 0 || (Date.now() - createdAt > DEFAULT_EXPIRE_MS)) {
    if (lobbiesDb.data.lobbies && lobbiesDb.data.lobbies[code]) {
      delete lobbiesDb.data.lobbies[code];
      lobbyMemoryCache.delete(code);
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

  // CRITICAL: Always cache in memory FIRST
  arr.forEach(row => {
    const code = String(row.code).trim().toUpperCase();
    const normalized = _rowToLobby({ ...row, code });
    if (normalized) {
      lobbyMemoryCache.set(code, normalized);
    }
  });

  if (supabase) {
    try {
      if (arr.length === 0) return {};
      
      // ⚠️ Upsert with proper data serialization
      const { data, error } = await _withTimeout(
        supabase
          .from('lobbies')
          .upsert(arr, { onConflict: 'code' })
          .select(),
        SUPABASE_OPERATION_TIMEOUT_MS,
        'Supabase saveLobbies'
      );
      
      // Check for RLS/policy errors vs table errors
      if (error) {
        const errorMsg = error?.message || String(error);
        const errorCode = error?.code || '';
        
        // RLS Policy errors
        if (errorCode === 'PGRST116' || errorMsg.includes('new row violates row-level security')) {
          console.error('[lobbyStorage] ⚠️ RLS POLICY BLOCKING saveLobbies: Check Supabase RLS policies');
          console.error('[lobbyStorage] Error:', { code: errorCode, message: errorMsg });
        }
        // Table/schema missing errors
        else if (errorCode === '42P01' || errorMsg.includes('does not exist') || 
                 errorMsg.includes('relation') || errorMsg.includes('schema')) {
          console.warn('[lobbyStorage] Table "lobbies" missing, saving', arr.length, 'lobbies to memory only');
        }
        // Authorization errors
        else if (errorCode === '401' || errorMsg.includes('Unauthorized')) {
          console.error('[lobbyStorage] ⚠️ SUPABASE AUTH ERROR: Invalid service role key');
        }
        // Other errors
        else {
          console.error('[lobbyStorage] Supabase saveLobbies error:', { code: errorCode, message: errorMsg });
        }
        throw error;
      }
      
      // Success
      const map = {};
      (data || []).forEach(r => {
        const l = _rowToLobby(r);
        if (l && l.code) map[String(l.code).trim().toUpperCase()] = l;
      });
      console.info('[lobbyStorage] ✅ Successfully saved', arr.length, 'lobbies to Supabase');
      return map;
    } catch (err) {
      console.warn('[lobbyStorage] Supabase saveLobbies failed, using memory cache:', err?.message || err);
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
    const { error } = await _withTimeout(
      supabase
        .from('lobbies')
        .delete()
        .eq('code', String(code).trim().toUpperCase()),
      SUPABASE_OPERATION_TIMEOUT_MS,
      'Supabase deleteSupabaseLobby'
    );
    if (error) throw error;
  } catch (err) {
    throw err;
  }
}
