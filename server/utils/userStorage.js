import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lowdb (local fallback) setup - with in-memory cache
const usersFile = path.join(__dirname, "../data/users.json");
const usersAdapter = new JSONFile(usersFile);
const usersDb = new Low(usersAdapter);
await usersDb.read();
usersDb.data ||= {};
usersDb.data.users ||= {};
const LOCAL_DB_PATH = usersFile;

// In-memory cache for users (needed for Vercel read-only filesystem)
const userMemoryCache = new Map();
const isVercel = process.env.VERCEL === '1';

// Supabase client (optional)
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;

// ⚠️ CRITICAL: Log Supabase initialization status on startup
console.log('[userStorage] Supabase initialization:');
console.log('  SUPABASE_URL:', SUPA_URL ? `✅ Set (${SUPA_URL.substring(0, 30)}...)` : '❌ MISSING');
console.log('  SUPABASE_SERVICE_ROLE_KEY:', SUPA_KEY ? `✅ Set (${SUPA_KEY.substring(0, 20)}...)` : '❌ MISSING');

if (SUPA_URL && SUPA_KEY) {
  try {
    supabase = createClient(SUPA_URL, SUPA_KEY);
    console.log('[userStorage] ✅ Supabase client created successfully');
    console.log('[userStorage] Attempting initial health check...');
    
    // Test connection immediately
    try {
      const { data, error } = await supabase.from('users').select('count');
      if (error) {
        console.error('[userStorage] ⚠️ Health check failed:', error.message);
        console.error('[userStorage] Error details:', { code: error.code, message: error.message });
        
        // Provide specific guidance for common errors
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          console.error('[userStorage] ❌ TABLE MISSING: Run "npm run migrate" to create the users table');
        } else if (error.code === 'PGRST116') {
          console.error('[userStorage] ❌ RLS POLICY ISSUE: Check Supabase RLS policies');
        }
      } else {
        console.log('[userStorage] ✅ Supabase connection verified, table accessible');
      }
    } catch (healthErr) {
      console.error('[userStorage] Health check error:', healthErr?.message || healthErr);
    }
  } catch (err) {
    console.error('[userStorage] ❌ Supabase client initialization failed:', err?.message || err);
    console.error('[userStorage] Falling back to local DB only');
    supabase = null;
  }
} else {
  console.warn('[userStorage] ⚠️ Supabase not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  console.warn('[userStorage] Using local storage only - data will not persist across server restarts');
}

async function _safeLocalWrite() {
  // On Vercel/serverless, filesystem is read-only, so skip writes
  if (isVercel) {
    console.debug('[userStorage] Vercel environment: skipping filesystem write (read-only)');
    return;
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
        console.warn(`[userStorage] Filesystem is read-only (${err.code}), using memory cache only`);
        return; // Don't throw - just use memory cache
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
  const { guestPassword, ...rest } = row;
  return { ...rest, id: String(row.id) };
}

function _userToRow(user) {
  if (!user || !user.id) throw new Error('user must include id');
  
  // ⚠️ CRITICAL: Ensure guestPassword is included for guest users
  // This fixes the "Could not find the 'guestPassword' column" error
  const row = { ...user };
  
  // For guest users, ensure guestPassword is present (even if empty)
  if (user.type === 'guest' && !row.guestPassword) {
    row.guestPassword = user.guestPassword || '';
  }
  
  return row;
}

// ----------------
// Public API
// ----------------

export async function loadUsers() {
  // Try Supabase if available
  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*');
      
      // Check for common Supabase errors indicating missing/empty schema
      if (error) {
        if (error.code === 'PGRST116' || error.code === '42P01' || 
            error.message?.includes('does not exist') ||
            error.message?.includes('relation') ||
            error.message?.includes('schema')) {
          console.warn('[userStorage] Supabase table "users" does not exist or schema not initialized, falling back to local DB');
        } else {
          console.warn('[userStorage] Supabase loadUsers error:', error?.message || error);
        }
        throw error;
      }
      
      // Handle empty result set (valid response, just no data)
      if (!data || (Array.isArray(data) && data.length === 0)) {
        console.info('[userStorage] Supabase returned no users (table empty or just initialized)');
        return {};
      }
      
      // Successfully loaded data from Supabase
      const map = {};
      (data || []).forEach(r => {
        const u = _rowToUser(r);
        if (u && u.id) map[u.id] = u;
      });
      console.info('[userStorage] Loaded', Object.keys(map).length, 'users from Supabase');
      return map;
    } catch (err) {
      console.warn('[userStorage] Supabase loadUsers failed, falling back to local DB:', err?.message || err);
    }
  }

  // Local fallback
  await usersDb.read();
  usersDb.data ||= {};
  usersDb.data.users ||= {};
  return { ...(usersDb.data.users || {}) };
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
      const { data, error } = await supabase
        .from('users')
        .upsert(rows, { onConflict: 'id' })
        .select();
      
      // Check for RLS/policy errors vs table errors
      if (error) {
        const errorMsg = error?.message || String(error);
        const errorCode = error?.code || '';
        
        // RLS Policy errors
        if (errorCode === 'PGRST116' || errorMsg.includes('new row violates row-level security')) {
          console.error('[userStorage] ⚠️ RLS POLICY BLOCKING saveUsers: Check Supabase RLS policies');
          console.error('[userStorage] Error:', { code: errorCode, message: errorMsg });
        }
        // Table/schema missing errors
        else if (errorCode === '42P01' || errorMsg.includes('does not exist') || 
                 errorMsg.includes('relation') || errorMsg.includes('schema')) {
          console.warn('[userStorage] Table "users" missing, saving', rows.length, 'users to memory only');
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
      console.warn('[userStorage] Supabase saveUsers failed, using memory cache:', err?.message || err);
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

export async function loadUser(id) {
  if (!id) return null;
  
  // Check memory cache first (fastest for Vercel)
  const cached = userMemoryCache.get(String(id));
  if (cached) {
    return _rowToUser(cached);
  }

  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*').eq('id', id).limit(1);
      
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
      console.warn('[userStorage] Supabase loadUser failed, trying local:', err?.message || err);
    }
  }

  // local fallback
  try {
    await usersDb.read();
  } catch (err) {
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

  console.log('[userStorage] Saving user:', { id: user.id, name: user.name, type: user.type });

  // CRITICAL: Always cache in memory FIRST (for Vercel read-only filesystem)
  // This ensures data is available even if Supabase fails
  userMemoryCache.set(String(row.id), row);

  let supabaseSuccess = false;
  let localSuccess = false;

  if (supabase) {
    try {
      console.log('[userStorage] Attempting to save user to Supabase...');
      
      // ⚠️ Upsert with proper data serialization
      // Supabase expects all fields including id, and will use RLS policies
      // Service role key bypasses RLS, so this should always work if table exists
      const { data, error } = await supabase
        .from('users')
        .upsert([row], { onConflict: 'id' })
        .select();
      
      // Check for RLS/policy errors vs table errors
      if (error) {
        const errorMsg = error?.message || String(error);
        const errorCode = error?.code || '';
        
        // RLS Policy errors - service role should bypass these, but log them
        if (errorCode === 'PGRST116' || errorMsg.includes('new row violates row-level security')) {
          console.error('[userStorage] ⚠️ RLS POLICY BLOCKING: Service role cannot write to users table');
          console.error('[userStorage] Error details:', { code: errorCode, message: errorMsg });
          console.error('[userStorage] Fix: Check Supabase RLS policies, ensure service role has INSERT permission');
        }
        // Table/schema missing errors
        else if (errorCode === '42P01' || errorMsg.includes('does not exist') ||
                 errorMsg.includes('relation') || errorMsg.includes('schema')) {
          console.warn('[userStorage] Table "users" missing in Supabase, data will persist in memory only');
          console.warn('[userStorage] To fix: Run "npm run migrate" to create the users table');
        }
        // Column missing errors
        else if (errorCode === '42703' || errorMsg.includes('column') && errorMsg.includes('does not exist')) {
          console.error('[userStorage] ⚠️ COLUMN MISSING in Supabase users table:', errorMsg);
          console.error('[userStorage] To fix: Run "npm run migrate" to update the table schema');
        }
        // Authorization/credential errors
        else if (errorCode === '401' || errorMsg.includes('Unauthorized') || errorMsg.includes('invalid') && errorMsg.includes('JWT')) {
          console.error('[userStorage] ⚠️ SUPABASE AUTH ERROR: Invalid service role key');
          console.error('[userStorage] Fix: Verify SUPABASE_SERVICE_ROLE_KEY environment variable');
        }
        // Connection/network errors
        else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('network') || errorMsg.includes('timeout')) {
          console.warn('[userStorage] Network error connecting to Supabase, data cached locally');
        }
        // Unexpected errors
        else {
          console.error('[userStorage] Supabase saveUser error:', { code: errorCode, message: errorMsg });
        }
        throw error;
      }
      
      // Verify the data was actually saved by reading it back
      if (data && data.length > 0) {
        const saved = _rowToUser(data[0]);
        console.info('[userStorage] ✅ Successfully saved user', user.id, 'to Supabase');
        console.log('[userStorage] Verification - saved user data:', { id: saved.id, name: saved.name, type: saved.type });
        supabaseSuccess = true;
        return saved;
      } else {
        console.warn('[userStorage] Supabase returned no data after save, falling back to local');
        throw new Error('No data returned from Supabase after save');
      }
    } catch (err) {
      // Supabase failed - data is cached in memory, try local fallback
      console.warn('[userStorage] Supabase write failed, falling back to local cache:', err?.message || err);
      // Don't rethrow - memory cache is sufficient
    }
  }

  // Local fallback write
  console.log('[userStorage] Saving user to local fallback...');
  await usersDb.read();
  usersDb.data ||= {};
  usersDb.data.users ||= {};
  usersDb.data.users[String(row.id)] = row;
  
  // Try to write to filesystem (may fail on Vercel)
  try {
    await _safeLocalWrite();
    console.info('[userStorage] ✅ Saved user to local DB');
    localSuccess = true;
  } catch (err) {
    // Write to filesystem failed - but we have it in memory cache, so it's ok
    console.warn('[userStorage] Local write failed, but user cached in memory:', err?.message);
  }
  
  // Verify the user can be retrieved from cache
  const cachedUser = userMemoryCache.get(String(row.id));
  if (cachedUser) {
    console.log('[userStorage] ✅ User verified in memory cache:', { id: cachedUser.id, name: cachedUser.name });
    return _rowToUser(cachedUser);
  } else {
    console.error('[userStorage] ❌ User not found in cache after save - this should not happen');
    throw new Error('User save verification failed');
  }
}