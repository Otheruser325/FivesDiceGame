import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A read-only or misconfigured store must fail instead of pretending that an
// account stored only in process memory is durable.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fives-user-storage-'));
process.env.USER_DATA_FILE = tempDir;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';

const { saveUser, loadUser, loadUsers } = await import('../server/utils/userStorage.js');

test('a new OAuth user is not cached when durable persistence fails', async () => {
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

  await assert.rejects(() => saveUser(user));
  assert.equal(await loadUser(id), null);
  const users = await loadUsers();
  assert.equal(users[id], undefined);
  await assert.rejects(() => loadUsers({ strict: true }));
});

test('production refuses unconfigured or broken Supabase rather than silently using local storage', () => {
  for (const config of [
    { USER_STORAGE_MODE: '', USER_DATA_FILE: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    { USER_STORAGE_MODE: 'local', USER_DATA_FILE: path.join(tempDir, 'users.json'), SUPABASE_URL: 'not-a-url', SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
    { USER_STORAGE_MODE: 'local', USER_DATA_FILE: path.join(tempDir, 'users.json'), SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: '' }
  ]) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { saveUser, findUsersByField } = await import('./server/utils/userStorage.js');
      for (const operation of [() => saveUser({ id: 'x', name: 'Guest1234', type: 'guest' }), () => findUsersByField('name', 'Guest1234')]) {
        try { await operation(); process.exitCode = 1; } catch (err) { if (!err.message.includes('not configured')) throw err; }
      }
    `], { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), env: { ...process.env, NODE_ENV: 'production', ...config }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  }
  assert.equal(fs.existsSync(path.join(tempDir, 'users.json')), false);
});

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
