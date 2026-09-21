'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Index, SCHEMA_VERSION } = require('../src/core/db');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-mig-'));
  return path.join(dir, 'index.sqlite3');
}

test('an index written by an older schema is rebuilt, not patched', (t) => {
  const file = tmpDb();

  // Stand in for a v1 database: a `messages` table without is_notice.
  const Database = require('better-sqlite3');
  const old = new Database(file);
  old.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT)');
  old.prepare('INSERT INTO messages (text) VALUES (?)').run('ancienne donnee');
  old.pragma('user_version = 1');
  old.close();

  const index = new Index(file);
  t.after(() => index.close());

  assert.equal(index.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(index.stats().messages, 0, 'stale rows must be gone');

  // The new columns exist, so a write that needs them succeeds.
  const folderId = index.folderId('/p');
  index.upsertAgent('claude', 'Claude Code', '/root');
  index.upsertSession({ id: 'claude:s1', agent_id: 'claude', folder_id: folderId });
  assert.equal(index.addMessages('claude:s1', [{ role: 'user', uuid: 'a', text: 'neuf', parts: [] }]), 1);
});

test('a fresh database is created at the current version', (t) => {
  const index = new Index(tmpDb());
  t.after(() => index.close());
  assert.equal(index.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
});
