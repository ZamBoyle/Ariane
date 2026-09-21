'use strict';

/**
 * The archive: conversations whose files are gone, kept where no rebuild of
 * the index can reach them — and forgotten, for good, only when asked.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const { Archive } = require('../src/core/archive');
const codexAdapter = require('../src/core/agents/codex');
const { createFixture, records, cdx, cop, resetCounters } = require('./helpers/fixture');

const CODEX_ID = '44444444-4444-4444-8444-444444444444';

function setup(t) {
  resetCounters();
  const fx = createFixture();
  const archive = new Archive(path.join(fx.root, 'ariane-archive'));
  const opened = [];
  const open = (file = ':memory:') => {
    const index = new Index(file, { archive });
    opened.push(index);
    return index;
  };
  const pass = (index, extra = {}) => new Indexer(index, { env: fx.env, archive, ...extra }).run();
  t.after(() => {
    for (const index of opened) {
      try {
        index.close();
      } catch {
        /* already closed by the test */
      }
    }
    fx.cleanup();
  });
  return { fx, archive, open, pass };
}

/** A Claude conversation whose prompts history.jsonl also keeps, as it does. */
function claudeWithHistory(fx) {
  const project = fx.project('-p', { originalPath: '/p' });
  project.session('s1', [
    records.userText('la vraie question'),
    records.assistantText('la réponse complète, qui n’existe que dans la transcription'),
  ]);
  fx.history([{ display: 'la vraie question', project: '/p', sessionId: 's1', timestamp: 1765054827534 }]);
  return path.join(project.dirPath, 's1.jsonl');
}

/** The rollout file of CODEX_ID, wherever the fixture filed it. */
function rolloutPath(fx) {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.includes(CODEX_ID)) found.push(full);
    }
  };
  walk(fx.env.CODEX_HOME);
  return found[0];
}

function codexSession(fx) {
  // The session id is the header's, not the file name's: give it the same one.
  fx.codex().session(CODEX_ID, [
    cdx.meta('/q', CODEX_ID),
    cdx.message('user', 'bonjour codex'),
    cdx.message('assistant', 'la réponse de codex'),
  ]);
  return rolloutPath(fx);
}

const texts = (index, id) => index.messages(id).map((m) => m.text);

// ── the case this whole feature exists for ──────────────────────────────────

test.describe('a transcript the agent deletes', () => {
  // Claude Code deletes old transcripts, but history.jsonl keeps the prompts.
  // The session then comes back as "prompts only" — and reading it used to
  // start by deleting every message the index held.
  test('is saved whole, not reduced to the prompts history.jsonl kept', async (t) => {
    const { fx, archive, open, pass } = setup(t);
    const transcript = claudeWithHistory(fx);
    const index = open();

    await pass(index);
    assert.equal(index.session('claude:s1').source, 'transcript');

    fs.rmSync(transcript);
    const report = await pass(index);

    assert.equal(report.saved, 1);
    assert.equal(index.session('claude:s1').source, 'archive', 'marked as living in the archive');
    assert.ok(
      texts(index, 'claude:s1').some((t2) => t2.includes('réponse complète')),
      'the assistant’s words are still there'
    );
    assert.ok(archive.has('claude:s1'), 'and on disk, out of the index’s reach');
  });

  test('a later pass does not degrade it either', async (t) => {
    const { fx, open, pass } = setup(t);
    const transcript = claudeWithHistory(fx);
    const index = open();
    await pass(index);
    fs.rmSync(transcript);
    await pass(index);

    fx.history([
      { display: 'la vraie question', project: '/p', sessionId: 's1', timestamp: 1765054827534 },
      { display: 'une autre', project: '/p', sessionId: 's1', timestamp: 1765054899999 },
    ]);
    await pass(index);
    assert.equal(index.session('claude:s1').source, 'archive');
    assert.ok(texts(index, 'claude:s1').some((t2) => t2.includes('réponse complète')));
  });

  test('a vanished Codex rollout is saved, and stays searchable', async (t) => {
    const { fx, open, pass } = setup(t);
    const rollout = codexSession(fx);
    const index = open();
    await pass(index);

    fs.rmSync(rollout);
    await pass(index);
    assert.equal(index.session(`codex:${CODEX_ID}`).source, 'archive');
    assert.equal(index.search('réponse codex').length, 1, 'found by search like any other');
  });
});

// ── surviving a rebuild ─────────────────────────────────────────────────────

test.describe('a rebuild of the index', () => {
  test('brings saved conversations back whole, prompts-only copy or not', async (t) => {
    const { fx, open, pass } = setup(t);
    const transcript = claudeWithHistory(fx);
    const first = open();
    await pass(first);
    fs.rmSync(transcript); // purged by the agent, saved by the next pass
    await pass(first);

    // A fresh index, as after a schema change: the agents offer only prompts.
    const rebuilt = open();
    const report = await pass(rebuilt);
    assert.equal(report.restored, 1);
    assert.equal(rebuilt.session('claude:s1').source, 'archive');
    assert.ok(texts(rebuilt, 'claude:s1').some((t2) => t2.includes('réponse complète')));
  });

  // The dangerous window: a file deleted while the app was closed, then an
  // update that changes the schema. The migration itself must save it.
  test('saves, before dropping anything, what no file proves still exists', async (t) => {
    const { fx, archive, open, pass } = setup(t);
    const rollout = codexSession(fx);
    const live = claudeWithHistory(fx);
    fx.copilot().session('cop-1', [cop.start('/r'), cop.user('salut'), cop.assistant('bonjour')]);

    const file = path.join(fx.root, 'index.sqlite3');
    const before = open(file);
    await pass(before);
    before.close();

    fs.rmSync(rollout); // gone while Ariane was closed
    const raw = new Database(file);
    raw.pragma('user_version = 1'); // an update with a new schema
    raw.close();

    const migrated = open(file);
    assert.equal(migrated.stats().sessions, 0, 'the tables were rebuilt');
    assert.ok(archive.has(`codex:${CODEX_ID}`), 'the vanished rollout was saved first');
    assert.ok(!archive.has('claude:s1'), 'a transcript still on disk needs no copy');
    assert.ok(fs.existsSync(live));

    const report = await pass(migrated);
    assert.equal(migrated.session(`codex:${CODEX_ID}`).source, 'archive');
    assert.ok(texts(migrated, `codex:${CODEX_ID}`).includes('la réponse de codex'));
    // Copilot keeps no source path, so it was copied to be safe; seen whole
    // again, that copy is gone.
    assert.deepEqual(archive.list().map((a) => a.id), [`codex:${CODEX_ID}`]);
    assert.equal(report.errors.length, 0);
  });
});

// ── what the archive must NOT do ────────────────────────────────────────────

test.describe('the archive keeps only what exists nowhere else', () => {
  test('a file that comes back takes over again, and the copy goes', async (t) => {
    const { fx, archive, open, pass } = setup(t);
    const rollout = codexSession(fx);
    const index = open();
    await pass(index);
    const bytes = fs.readFileSync(rollout);
    fs.rmSync(rollout);
    await pass(index);
    assert.ok(archive.has(`codex:${CODEX_ID}`));

    fs.writeFileSync(rollout, bytes);
    await pass(index);
    assert.equal(index.session(`codex:${CODEX_ID}`).source, 'transcript');
    assert.ok(!archive.has(`codex:${CODEX_ID}`));
  });

  test('a run told to index one agent does not judge the others vanished', async (t) => {
    const { fx, archive, open, pass } = setup(t);
    claudeWithHistory(fx);
    codexSession(fx);
    const index = open();
    await pass(index);

    await pass(index, { adapters: [codexAdapter] });
    assert.equal(archive.list().length, 0);
    assert.equal(index.session('claude:s1').source, 'transcript');
  });

  test('an agent whose discovery failed does not vouch that anything is gone', async (t) => {
    const { fx, archive, open, pass } = setup(t);
    codexSession(fx);
    const index = open();
    await pass(index, { adapters: [codexAdapter] });

    const broken = {
      ...codexAdapter,
      async *discover() {
        throw new Error('disque débranché');
      },
    };
    const report = await pass(index, { adapters: [broken] });
    assert.equal(report.saved, 0);
    assert.equal(archive.list().length, 0);
  });

  test('an unreadable archive is reported and left exactly where it is', async (t) => {
    const { archive, open, pass } = setup(t);
    const file = archive.fileFor('codex:abimee');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'pas du tout du JSON\n');

    const report = await pass(open());
    assert.equal(report.errors.length, 1);
    assert.ok(fs.existsSync(file), 'never deleted');
  });
});

// ── the format ──────────────────────────────────────────────────────────────

test.describe('the archive format', () => {
  test('refuses an id that would steer a path', () => {
    const archive = new Archive('/tmp/nulle-part');
    for (const bad of ['sans-deux-points', ':vide', '../x:y', 'Claude:x']) {
      assert.throws(() => archive.fileFor(bad), /invalide/, bad);
    }
    assert.ok(archive.fileFor('claude:a/../b').endsWith(`claude${path.sep}a%2F..%2Fb.jsonl`));
  });

  test('refuses an archive written by a newer version, without touching it', (t) => {
    const { archive } = setup(t);
    const file = archive.fileFor('claude:x');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ format: 'ariane-archive', version: 99, id: 'claude:x' })}\n`);
    assert.throws(() => archive.read(file), /newer version/);
  });

  test('ignores a write that never finished', (t) => {
    const { archive } = setup(t);
    const file = archive.fileFor('claude:x');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.123.partial`, 'à moitié');
    assert.deepEqual(archive.list(), []);
  });
});

// ── forgetting ──────────────────────────────────────────────────────────────

test.describe('forgetting a saved conversation', () => {
  // Forgotten because of what it contained: a deleted row that stays readable
  // on disk would make "forget" a lie. So this reads the file's own bytes.
  test('leaves no trace of its words in the index file', async (t) => {
    const { fx, archive, open, pass } = setup(t);
    const SECRET = 'Xk42ZqMotDePasse';
    fx.codex().session(CODEX_ID, [
      cdx.meta('/q', CODEX_ID),
      cdx.message('user', `voici mon mot de passe : ${SECRET}`),
      cdx.message('assistant', 'noté'),
    ]);

    const file = path.join(fx.root, 'forget.sqlite3');
    const index = open(file);
    await pass(index);
    const bytes = () =>
      ['', '-wal', '-shm']
        .map((suffix) => (fs.existsSync(file + suffix) ? fs.readFileSync(file + suffix).toString('latin1') : ''))
        .join('');
    // The test can see the secret before, or it would prove nothing after.
    assert.ok(bytes().includes(SECRET), 'visible in the file before');
    assert.ok(bytes().toLowerCase().includes(SECRET.toLowerCase()), 'and as a search term');

    fs.rmSync(rolloutPath(fx));
    await pass(index);
    assert.equal(index.session(`codex:${CODEX_ID}`).source, 'archive');
    archive.remove(`codex:${CODEX_ID}`);
    index.forgetSession(`codex:${CODEX_ID}`);

    // Read while the database is still OPEN, as it is for the app's whole
    // life: closing checkpoints the journal by itself, and would hide a
    // forget that left the old pages in the main file.
    assert.equal(bytes().includes(SECRET), false, 'the message text is gone from the file');
    assert.equal(bytes().toLowerCase().includes(SECRET.toLowerCase()), false, 'and so is the search term');
    assert.equal(archive.list().length, 0);
    index.close();
  });
});
