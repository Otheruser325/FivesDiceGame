import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the local fallback at a directory so both its read and write fail, the
// way a read-only/misconfigured host can. The account is still cached in memory
// before any storage operation, so saveUser must return it successfully.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fives-user-storage-'));
process.env.USER_DATA_FILE = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { saveUser, loadUser, loadUsers } = await import('../server/utils/userStorage.js');

test('a new OAuth user survives a local persistence failure via the memory cache', async () => {
  const id = randomUUID();
  const user = {
    id,
    name: 'Fallback Tester',
    type: 'discord',
    oauthDiscord: '123456789',
    oauthProvider: 'discord',
    oauthProviderId: '123456789',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const saved = await saveUser(user);
  assert.equal(saved.id, id);
  assert.equal(saved.name, user.name);
  assert.equal(saved.type, 'discord');
  assert.equal(saved.oauthDiscord, user.oauthDiscord);

  const loaded = await loadUser(id);
  assert.equal(loaded?.id, id);
  assert.equal(loaded?.type, 'discord');

  // OAuth account lookup falls back to loadUsers(); it must also survive the
  // unreadable local file instead of rejecting the provider callback.
  const users = await loadUsers();
  assert.equal(users[id]?.type, 'discord');
});

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
