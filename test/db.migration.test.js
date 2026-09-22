'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Index, SCHEMA_VERSION } = require('../src/core/db');
const { Archive } = require('../src/core/archive');

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
  assert.equal(
    index.addMessages('claude:s1', [{ role: 'user', uuid: 'a', text: 'neuf', parts: [] }]),
    1
  );
});

test('a fresh database is created at the current version', (t) => {
  const index = new Index(tmpDb());
  t.after(() => index.close());
  assert.equal(index.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
});

// ── ce qu'une migration doit sauver, sur une base qui n'a pas ses colonnes ──

/** Un index d'aujourd'hui, ramené de force à la forme d'une version antérieure. */
function indexWithoutTokenColumns(t, archive) {
  const file = tmpDb();
  const index = new Index(file, { archive });
  index.upsertAgent('claude', 'Claude Code', '/root');
  index.upsertSession({
    id: 'claude:disparue',
    agent_id: 'claude',
    folder_id: index.folderId('/home/ada/projets/tardis'),
    // Aucun fichier à ce chemin : la session n'est donc PAS prouvée ailleurs,
    // et la migration doit la sauver avant de vider les tables.
    file_path: path.join(os.tmpdir(), 'nulle-part-du-tout.jsonl'),
  });
  index.addMessages('claude:disparue', [
    { role: 'user', uuid: 'm1', text: 'la seule copie qui reste', parts: [] },
  ]);
  index.close();

  const Database = require('better-sqlite3');
  const old = new Database(file);
  for (const column of [
    'tok_input',
    'tok_output',
    'tok_cache_read',
    'tok_cache_write',
    'tok_reasoning',
  ]) {
    old.exec(`ALTER TABLE messages DROP COLUMN ${column}`);
  }
  old.pragma(`user_version = ${SCHEMA_VERSION - 1}`);
  old.close();
  return file;
}

test('la migration sauve une base à laquelle il manque les colonnes du jour', (t) => {
  const archive = new Archive(fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-arch-')));
  const file = indexWithoutTokenColumns(t, archive);

  const index = new Index(file, { archive });
  t.after(() => index.close());

  assert.ok(
    archive.has('claude:disparue'),
    "la sauvegarde d'avant-vidage ne doit pas dépendre de colonnes ajoutées depuis"
  );
  assert.equal(index.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
});

test('une archive écrite avant les colonnes se restaure sans lever', (t) => {
  const archive = new Archive(fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-arch-')));
  const index = new Index(tmpDb(), { archive });
  t.after(() => index.close());
  index.upsertAgent('claude', 'Claude Code', '/root');

  // Un message tel qu'une version antérieure l'avait archivé : sans les cinq clés.
  const ancien = {
    seq: 0,
    uuid: 'm1',
    parent_uuid: null,
    role: 'user',
    ts: '',
    model: '',
    text: 'archivé avant v10',
    thinking: '',
    parts: '[]',
    is_meta: 0,
    is_notice: 0,
    is_sidechain: 0,
    command: null,
  };

  assert.doesNotThrow(() => {
    index.restoreArchived(
      'claude:ancienne',
      { id: 'claude:ancienne', agent_id: 'claude', folder_path: '/home/ada/vieux', title: 'x' },
      [ancien],
      'Claude Code'
    );
  }, 'un paramètre nommé absent lève au lieu de valoir null : il faut le fournir');

  const [message] = index.messages('claude:ancienne');
  assert.equal(message.text, 'archivé avant v10', 'le message revient entier');
  assert.equal(message.usage, null, "et sans usage, puisqu'il n'en portait pas");
});
