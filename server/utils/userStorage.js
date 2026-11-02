import '../env.js';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lowdb (local fallback) setup - with in-memory cache
// The fallback file can be moved outside the source tree for tests or a host
// with a writable data volume. Deployments keep the existing default.
const usersFile = process.env.USER_DATA_FILE
  ? path.resolve(process.env.USER_DATA_FILE)
  : path.join(__dirname, "../data/users.json");
const usersAdapter = new JSONFile(usersFile);
const usersDb = new Low(usersAdapter);
usersDb.data = { users: {} };
const usersDbReady = usersDb.read()
  .then(() => {
    usersDb.data ||= {};
    usersDb.data.users ||= {};
  })
  .catch((err) => {
    console.warn('[userStorage] local users DB read failed, continuing with in-memory defaults:', err?.message || err);
    usersDb.data ||= {};
    usersDb.data.users ||= {};
  });
const LOCAL_DB_PATH = usersFile;

// In-memory cache for users (needed for Vercel read-only filesystem)
const userMemoryCache = new Map();
const isVercel = process.env.VERCEL === '1';
// Production local storage must be explicitly pointed at a persistent volume.
function localDurable() {
  return process.env.NODE_ENV !== 'production' ||
    (process.env.USER_STORAGE_MODE === 'local' && !!process.env.USER_DATA_FILE && !isVercel);
}
let userWriteQueue = Promise.resolve();
const SUPABASE_OPERATION_TIMEOUT_MS = Number(process.env.SUPABASE_OPERATION_TIMEOUT_MS || 1200);

// Supabase client (optional)
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseConfigured = !!(SUPA_URL || SUPA_KEY);
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
      supabase.from('users').select('id', { head: true, count: 'exact' }).limit(1),
      SUPABASE_OPERATION_TIMEOUT_MS,
      'Supabase users startup health check'
    );

    if (error) {
      console.error('[userStorage] ⚠️ Startup health check failed:', error.message);
      console.error('[userStorage] Error details:', { code: error.code, message: error.message });
      return;
    }

    console.log('[userStorage] ✅ Supabase connection verified (startup check)');
  } catch (healthErr) {
    console.warn('[userStorage] Startup health check timeout/error:', healthErr?.message || healthErr);
  }
}

// ⚠️ CRITICAL: Log Supabase initialization status on startup
console.log('[userStorage] Supabase initialization:');
console.log('  SUPABASE_URL:', SUPA_URL ? `✅ Set (${SUPA_URL.substring(0, 30)}...)` : '❌ MISSING');
console.log('  SUPABASE_SERVICE_ROLE_KEY:', SUPA_KEY ? '✅ Set (redacted)' : '❌ MISSING');

if (SUPA_URL && SUPA_KEY) {
  try {
    supabase = createClient(SUPA_URL, SUPA_KEY);
    console.log('[userStorage] ✅ Supabase client created successfully');
    console.log('[userStorage] Scheduling non-blocking startup health check...');
    queueMicrotask(() => {
      _runSupabaseStartupCheck().catch(err => {
        console.warn('[userStorage] Startup check failed:', err?.message || err);
      });
    });
  } catch (err) {
    console.error('[userStorage] ❌ Supabase client initialization failed:', err?.message || err);
    console.error('[userStorage] User storage will fail closed');
    supabase = null;
  }
} else {
  console.warn('[userStorage] ⚠️ Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  console.warn('[userStorage] Using local storage only - data will not persist across server restarts');
}

async function _safeLocalWrite() {
  // On Vercel/serverless, filesystem is read-only, so skip writes
  if (isVercel) {
    throw new Error('Local user storage is unavailable on Vercel');
  }

  // attempt lowdb write with simple backoff
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await usersDb.write();
      return;
    } catch (err) {
      // Read-only filesystem - give up and use memory cache
      if (err && (err.code === 'EROFS' || err.code === 'EACCES')) {
        throw err;
      }

      // transient-ish errors we want to retry
      if (err && (err.code === 'EPERM' || err.code === 'EBUSY')) {
        const waitMs = 80 * (attempt + 1);
        console.warn(`[userStorage] local write attempt ${attempt + 1} failed (${err.code}), retrying in ${waitMs}ms`);
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
    const dump = JSON.stringify(usersDb.data || { users: {} }, null, 2);
    await fs.writeFile(LOCAL_DB_PATH, dump, 'utf8');
    console.warn('[userStorage] local write fallback succeeded via direct fs.writeFile (non-atomic). Consider excluding the project from OneDrive/antivirus.');
    return;
  } catch (err) {
    console.error('[userStorage] direct fs.writeFile fallback failed:', err);
    throw err;
  }
}

function _rowToUser(row) {
  if (!row) return null;
  // Handle both camelCase (guestPassword) and lowercase (guestpassword) column names
  const guestPassword = row.guestPassword || row.guestpassword;
  const { guestPassword: _, guestpassword, ...rest } = row;
  return { ...rest, id: String(row.id), guestPassword };
}

function _userToRow(user) {
  if (!user || !user.id) throw new Error('user must include id');
  
  // ⚠️ CRITICAL: Map camelCase to lowercase database columns
  // Database uses lowercase 'guestpassword' not camelCase 'guestPassword'
  const row = { ...user };
  
  // Map guestPassword (app format) to guestpassword (DB format)
  if (row.guestPassword !== undefined) {
    row.guestpassword = row.guestPassword;
    delete row.guestPassword;  // Remove camelCase to avoid column mismatch
  } else if (user.type === 'guest' && !row.guestpassword) {
    row.guestpassword = '';  // Ensure field exists for guest users
  }
  
  for (const key of Object.keys(row)) {
    if (row[key] === undefined) delete row[key];
  }
  return row;
}

function _mergeMemoryUsers(usersMap) {
  const merged = { ...(usersMap || {}) };
  for (const [id, row] of userMemoryCache.entries()) {
    if (!merged[id]) {
      merged[id] = _rowToUser(row);
    }
  }
  return merged;
}

function _extractMissingUsersColumn(error) {
  const message = String(error?.message || error || '');
  const patterns = [
    /column\s+"?([a-zA-Z0-9_]+)"?\s+of\s+relation\s+"?users"?\s+does\s+not\s+exist/i,
    /Could not find the '([^']+)' column of 'users'/i,
    /column\s+users\.([a-zA-Z0-9_]+)\s+does\s+not\s+exist/i,
    /column\s+"?([a-zA-Z0-9_]+)"?\s+does\s+not\s+exist/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function _withoutUnsupportedUserColumn(row, columnName) {
  if (!row || typeof row !== 'object' || !columnName) {
    return { row, changed: false };
  }

  const normalizedColumn = String(columnName).trim();
  if (!normalizedColumn) {
    return { row, changed: false };
  }

  const camel = normalizedColumn.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const snake = normalizedColumn.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

  const candidates = new Set([
    normalizedColumn,
    normalizedColumn.toLowerCase(),
    normalizedColumn.toUpperCase(),
    camel,
    camel.toLowerCase(),
    snake,
    snake.toLowerCase()
  ]);

  let changed = false;
  const next = { ...row };
  for (const key of Object.keys(next)) {
    if (key === 'id') continue;
    if (candidates.has(key) || candidates.has(key.toLowerCase())) {
      delete next[key];
      changed = true;
    }
  }

  return { row: next, changed };
}

async function _upsertUsersWithColumnFallback(rows, operationName = 'Supabase saveUsers') {
  let workingRows = (rows || []).map((row) => ({ ...row }));
  const removedColumns = new Set();
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data, error } = await _withTimeout(
      supabase
        .from('users')
        .upsert(workingRows, { onConflict: 'id' })
        .select(),
      SUPABASE_OPERATION_TIMEOUT_MS,
      operationName
    );

    if (!error) {
      return { data, rows: workingRows, removedColumns };
    }

    const missingColumn = _extractMissingUsersColumn(error);
    if (!missingColumn) {
      throw error;
    }

    let changedAny = false;
    workingRows = workingRows.map((row) => {
      const result = _withoutUnsupportedUserColumn(row, missingColumn);
      if (result.changed) changedAny = true;
      return result.row;
    });

    if (!changedAny) {
      throw error;
    }

    removedColumns.add(missingColumn);
    console.warn(`[userStorage] Retrying user upsert without unsupported column "${missingColumn}"`);
  }

  throw new Error('[userStorage] Supabase user upsert failed after column fallback attempts');
}

// ----------------
// Public API
// ----------------

export async function loadUsers({ strict = false } = {}) {
  // Try Supabase if available
  if (supabase) {
    try {
      // ✅ FIX: Attempt to load and auto-populate schema cache if needed
      const { data, error } = await _withTimeout(
        supabase.from('users').select('*'),
        SUPABASE_OPERATION_TIMEOUT_MS,
        'Supabase loadUsers'
      );
      
      // Check for common Supabase errors indicating missing/empty schema
      if (error) {
        // Check if it's a schema cache issue (column not found)
        if (error.code === 'PGRST116' || 
            error.message?.includes('schema cache') ||
            error.message?.includes('column')) {
          console.warn('[userStorage] ⚠️ Supabase schema cache outdated, attempting refresh...');
          // Try to refresh schema by querying information_schema
          try {
            await _withTimeout(
              supabase.rpc('pg_reload_schema_cache', {}),
              SUPABASE_OPERATION_TIMEOUT_MS,
              'Supabase schema cache refresh'
            );
            console.info('[userStorage] ✅ Schema cache refreshed');
            // Retry the query
            const { data: retryData, error: retryError } = await _withTimeout(
              supabase.from('users').select('*'),
              SUPABASE_OPERATION_TIMEOUT_MS,
              'Supabase loadUsers retry'
            );
            if (!retryError && retryData) {
              const map = {};
              (retryData || []).forEach(r => {
                const u = _rowToUser(r);
                if (u && u.id) map[u.id] = u;
              });
              console.info('[userStorage] ✅ Loaded', Object.keys(map).length, 'users from Supabase after schema refresh');
              return _mergeMemoryUsers(map);
            }
          } catch (refreshErr) {
            console.debug('[userStorage] Schema cache refresh not available, using fallback');
          }
        }
        
        if (error.code === 'PGRST116' || error.code === '42P01' || 
            error.message?.includes('does not exist') ||
            error.message?.includes('relation')) {
          console.warn('[userStorage] ⚠️ Supabase table "users" does not exist or schema not initialized');
          console.warn('[userStorage] 💡 To fix: Run "npm run migrate" to create the users table');
        } else {
          console.warn('[userStorage] Supabase loadUsers error:', error?.message || error);
        }
        throw error;
      }
      
      // Handle empty result set (valid response, just no data)
      if (!data || (Array.isArray(data) && data.length === 0)) {
        console.info('[userStorage] Supabase returned no users (table empty or just initialized)');
        return _mergeMemoryUsers({});
      }
      
      // Successfully loaded data from Supabase
      const map = {};
      (data || []).forEach(r => {
        const u = _rowToUser(r);
        if (u && u.id) map[u.id] = u;
      });
      console.info('[userStorage] Loaded', Object.keys(map).length, 'users from Supabase');
      return _mergeMemoryUsers(map);
    } catch (err) {
      if (strict) throw err;
      console.warn('[userStorage] Supabase loadUsers failed, falling back to local DB:', err?.message || err);
    }
  }
  if (strict && (supabaseConfigured || !localDurable())) throw new Error('Durable user storage is not configured');

  // Strict identity lookups must read the durable file, never stale cache.
  try {
    if (strict) await userWriteQueue.catch(() => {});
    await usersDb.read();
  } catch (err) {
    if (strict) throw err;
    console.warn('[userStorage] Local loadUsers read failed, continuing with in-memory cache:', err?.message || err);
  }
  usersDb.data ||= {};
  usersDb.data.users ||= {};
  const users = { ...(usersDb.data.users || {}) };
  return strict ? users : _mergeMemoryUsers(users);
}

export async function saveUsers(users) {
  // accept either object map or array
  const rows = [];
  if (Array.isArray(users)) {
    rows.push(...users.map(_userToRow));
  } else if (users && typeof users === 'object') {
    for (const k of Object.keys(users)) {
      rows.push(_userToRow({ ...(users[k] || {}), id: k }));
    }
  } else {
    return [];
  }

  // CRITICAL: Always cache in memory FIRST
  rows.forEach(row => {
    userMemoryCache.set(String(row.id), row);
  });

  if (supabase) {
    try {
      // ⚠️ Upsert with proper data serialization
      const { data, error } = await _withTimeout(
        supabase
          .from('users')
          .upsert(rows, { onConflict: 'id' })
          .select(),
        SUPABASE_OPERATION_TIMEOUT_MS,
        'Supabase saveUsers'
      );
      
      // Check for RLS/policy errors vs table errors
      if (error) {
        const errorMsg = error?.message || String(error);
        const errorCode = error?.code || '';
        
        // ✅ FIX: Handle schema cache issues
        if (errorMsg.includes('schema cache') || errorMsg.includes('column')) {
          console.warn('[userStorage] ⚠️ Schema cache outdated, attempting recovery...');
          console.warn('[userStorage] Supabase write failed, falling back to local cache:', errorMsg);
          // Continue to local fallback
          throw error;
        }
        
        // RLS Policy errors
        if (errorCode === 'PGRST116' || errorMsg.includes('new row violates row-level security')) {
          console.error('[userStorage] ⚠️ RLS POLICY BLOCKING saveUsers: Check Supabase RLS policies');
          console.error('[userStorage] Error:', { code: errorCode, message: errorMsg });
        }
        // Table/schema missing errors
        else if (errorCode === '42P01' || errorMsg.includes('does not exist') || 
                 errorMsg.includes('relation') || errorMsg.includes('schema')) {
          console.warn('[userStorage] ⚠️ Table "users" missing in Supabase, data will persist in memory only');
          console.warn('[userStorage] 💡 To fix: Run "npm run migrate" to create the users table');
        }
        // Authorization errors
        else if (errorCode === '401' || errorMsg.includes('Unauthorized')) {
          console.error('[userStorage] ⚠️ SUPABASE AUTH ERROR: Invalid service role key');
        }
        // Other errors
        else {
          console.error('[userStorage] Supabase saveUsers error:', { code: errorCode, message: errorMsg });
        }
        throw error;
      }
      
      // Success
      const map = {};
      (data || []).forEach(r => { map[String(r.id)] = _rowToUser(r); });
      console.info('[userStorage] ✅ Successfully saved', rows.length, 'users to Supabase');
      return map;
    } catch (err) {
      console.warn('[userStorage] Supabase write failed, falling back to local cache:', err?.message || err);
      console.log('[userStorage] Saving user to local fallback...');
      // fallthrough to local save
    }
  }

  // Local fallback write (replace users map entries given)
  await usersDb.read();
  usersDb.data ||= {};
  usersDb.data.users ||= {};
  for (const r of rows) {
    usersDb.data.users[r.id] = r;
  }
  await _safeLocalWrite();
  return { ...(usersDb.data.users || {}) };
}

// Query exact identity fields rather than relying on a potentially paginated
// full-table scan. PostgREST can return fewer rows than requested, so continue
// until an empty page and fail closed if the configured page size cannot advance.
async function selectUsersByField(field, value) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; ) {
    const { data, error } = await _withTimeout(
      supabase.from('users').select('*').eq(field, value).order('id').range(offset, offset + pageSize - 1),
      SUPABASE_OPERATION_TIMEOUT_MS,
      'Supabase identity lookup'
    );
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('User storage returned an invalid lookup result');
    if (!data.length) return rows.map(_rowToUser);
    rows.push(...data);
    offset += data.length;
  }
}

export async function findUsersByField(field, value) {
  if (!['name', 'oauthGoogle', 'oauthDiscord'].includes(field)) throw new Error('Unsupported identity field');
  if (supabase) return selectUsersByField(field, value);
  const users = await loadUsers({ strict: true });
  return Object.values(users).filter(user => user?.[field] === value);
}

export async function loadUser(id, { strict = false } = {}) {
  if (!id) return null;
  
  // Check memory cache first (fastest for Vercel)
  const cached = !strict && userMemoryCache.get(String(id));
  if (cached) {
    return _rowToUser(cached);
  }

  if (supabase) {
    try {
      const { data, error } = await _withTimeout(
        supabase.from('users').select('*').eq('id', id).limit(1),
        SUPABASE_OPERATION_TIMEOUT_MS,
        'Supabase loadUser'
      );
      
      // Check for schema/table errors
      if (error) {
        if (error.code === 'PGRST116' || error.code === '42P01' ||
            error.message?.includes('does not exist') ||
            error.message?.includes('relation') ||
            error.message?.includes('schema')) {
          console.warn('[userStorage] Supabase table "users" missing, falling back to local');
        } else {
          console.warn('[userStorage] Supabase loadUser error:', error?.message || error);
        }
        throw error;
      }
      
      if (!data || data.length === 0) return null;
      const user = _rowToUser(data[0]);
      // Cache in memory
      userMemoryCache.set(String(id), data[0]);
      return user;
    } catch (err) {
      if (strict) throw err;
      console.warn('[userStorage] Supabase loadUser failed, trying local:', err?.message || err);
    }
  }
  if (strict && (supabaseConfigured || !localDurable())) throw new Error('Durable user storage is not configured');

  // local fallback
  try {
    if (strict) await userWriteQueue.catch(() => {});
    await usersDb.read();
  } catch (err) {
    if (strict) throw err;
    console.warn('[userStorage] Failed to read local DB:', err?.message);
  }
  
  usersDb.data ||= {};
  usersDb.data.users ||= {};
  const user = usersDb.data.users?.[id] || null;
  
  // Cache in memory
  if (user) {
    userMemoryCache.set(String(id), user);
  }
  
  return user;
}

export async function saveUser(user) {
  if (!user || !user.id) throw new Error('saveUser expects user with id');
  const row = _userToRow(user);

  if (supabase) {
    // Do not remove columns or fall back to process memory: profile, identity
    // and password fields must either persist together or the write fails.
    const { data, error } = await _withTimeout(
      supabase.from('users').upsert([row], { onConflict: 'id' }).select(),
      SUPABASE_OPERATION_TIMEOUT_MS,
      'Supabase saveUser'
    );
    if (error) throw error;
    if (!Array.isArray(data) || !data[0]) throw new Error('User storage did not confirm the write');
    const saved = data[0];
    for (const key of Object.keys(row)) {
      const identityFields = ['id', 'name', 'type', 'guestpassword', 'oauthGoogle', 'oauthDiscord', 'oauthProvider', 'oauthProviderId'];
      if (!Object.hasOwn(saved, key) || (row[key] !== null && saved[key] == null) ||
          (identityFields.includes(key) && saved[key] !== row[key])) {
        throw new Error(`User storage did not retain required field: ${key}`);
      }
    }
    userMemoryCache.set(String(row.id), saved);
    return _rowToUser(saved);
  }

  if (supabaseConfigured || !localDurable()) throw new Error('Durable user storage is not configured');
  // Serialize the complete read/modify/write cycle to avoid concurrent account
  // creation or profile updates silently overwriting each other.
  const write = userWriteQueue.catch(() => {}).then(async () => {
    await usersDbReady;
    await usersDb.read();
    usersDb.data ||= {};
    usersDb.data.users ||= {};
    const previous = usersDb.data.users[String(row.id)];
    usersDb.data.users[String(row.id)] = row;
    try {
      await _safeLocalWrite();
    } catch (err) {
      if (previous === undefined) delete usersDb.data.users[String(row.id)];
      else usersDb.data.users[String(row.id)] = previous;
      throw err;
    }
    userMemoryCache.set(String(row.id), row);
    return _rowToUser(row);
  });
  userWriteQueue = write;
  return write;
}
