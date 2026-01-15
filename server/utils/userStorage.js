import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lowdb (local fallback) setup
const usersFile = path.join(__dirname, "../data/users.json");
const usersAdapter = new JSONFile(usersFile);
const usersDb = new Low(usersAdapter);
await usersDb.read();
usersDb.data ||= {};
usersDb.data.users ||= {};
const LOCAL_DB_PATH = usersFile;

// Supabase client (optional)
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;
if (SUPA_URL && SUPA_KEY) {
  try {
    supabase = createClient(SUPA_URL, SUPA_KEY);
  } catch (err) {
    console.warn('[userStorage] Supabase init failed, falling back to local DB', err);
    supabase = null;
  }
} else {
  // no env — remain silent-ish but informative
  // console.info('[userStorage] Supabase not configured, using local storage.');
}

async function _safeLocalWrite() {
  // attempt lowdb write with simple backoff
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await usersDb.write();
      return;
    } catch (err) {
      // transient-ish errors we want to retry
      if (err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES')) {
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
  return { ...user };
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

  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').upsert(rows, { onConflict: 'id' }).select();
      
      // Check for schema/table errors
      if (error) {
        if (error.code === 'PGRST116' || error.code === '42P01' ||
            error.message?.includes('does not exist') ||
            error.message?.includes('relation') ||
            error.message?.includes('schema')) {
          console.warn('[userStorage] Supabase table "users" missing, saving', rows.length, 'users to local only');
        } else {
          console.warn('[userStorage] Supabase saveUsers error:', error?.message || error);
        }
        throw error;
      }
      
      const map = {};
      (data || []).forEach(r => { map[String(r.id)] = _rowToUser(r); });
      console.info('[userStorage] Successfully saved', rows.length, 'users to Supabase');
      return map;
    } catch (err) {
      console.warn('[userStorage] Supabase saveUsers failed, writing to local file:', err?.message || err);
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
      return _rowToUser(data[0]);
    } catch (err) {
      console.warn('[userStorage] Supabase loadUser failed, trying local:', err?.message || err);
    }
  }

  // local fallback
  await usersDb.read();
  usersDb.data ||= {};
  usersDb.data.users ||= {};
  return usersDb.data.users?.[id] || null;
}

export async function saveUser(user) {
  if (!user || !user.id) throw new Error('saveUser expects user with id');
  const row = _userToRow(user);

  if (supabase) {
    try {
      const { data, error } = await supabase.from('users').upsert(row, { onConflict: 'id' }).select();
      
      // Check for schema/table errors
      if (error) {
        if (error.code === 'PGRST116' || error.code === '42P01' ||
            error.message?.includes('does not exist') ||
            error.message?.includes('relation') ||
            error.message?.includes('schema')) {
          console.warn('[userStorage] Supabase table "users" missing, saving to local only');
        } else {
          console.warn('[userStorage] Supabase saveUser error:', error?.message || error);
        }
        throw error;
      }
      
      const saved = Array.isArray(data) && data[0] ? _rowToUser(data[0]) : _rowToUser(row);
      console.info('[userStorage] Successfully saved user', user.id, 'to Supabase');
      return saved;
    } catch (err) {
      console.warn('[userStorage] Supabase saveUser failed, writing to local:', err?.message || err);
      // fallthrough to local save
    }
  }

  await usersDb.read();
  usersDb.data ||= {};
  usersDb.data.users ||= {};
  usersDb.data.users[String(row.id)] = row;
  await _safeLocalWrite();
  return row;
}