import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdentityAuthority } from '../identity-authority.js';

test('identity adapter preserves exact UID and fails closed for unknown, disabled and deleted accounts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authority-identity-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: ' exact UID ', name: 'active' }, { id: 'off', disabled: true }, { id: 'gone', deleted: true }] }));
  const identity = createIdentityAuthority({ dbPath: path.join(dir, 'db.json') });
  assert.deepEqual(identity.get(' exact UID '), { uid: ' exact UID ', activity: 'ACTIVE', active: true });
  assert.equal(identity.get('exact UID').activity, 'UNKNOWN');
  assert.equal(identity.get('off').activity, 'DISABLED');
  assert.equal(identity.get('gone').activity, 'DELETED');
});
