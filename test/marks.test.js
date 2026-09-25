'use strict';

/**
 * The stars and the notes: the only thing in Ariane that nobody can rebuild.
 *
 * Everything else — the index, its folders, its messages — comes back from the
 * agents' own files in ten seconds. These do not. So the tests here are about
 * one thing: never losing a word of what the person wrote.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Marks, NOTE_MAX } = require('../src/core/marks');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-marks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Marks(dir);
}

const ID = 'claude:64ffbe9a-04de-430a-91ab-f18ff7fc5c92';
const readBack = (marks) => JSON.parse(fs.readFileSync(marks.file, 'utf8'));

test.describe('marking a conversation', () => {
  test('no file yet: nothing is marked, and nothing is invented', (t) => {
    const marks = setup(t);
    assert.deepEqual(marks.of(ID), { favorite: false, note: '', messages: [] });
    assert.deepEqual(marks.all(), {});
    assert.equal(fs.existsSync(marks.file), false, 'reading marks nothing on disk');
  });

  test('a star, then a note, each keeping the other', (t) => {
    const marks = setup(t);
    assert.deepEqual(marks.set(ID, { favorite: true }).mark, { favorite: true, note: '' });
    assert.deepEqual(marks.set(ID, { note: '  le calcul de ponder() est ici  ' }).mark, {
      favorite: true,
      note: 'le calcul de ponder() est ici',
    });
    assert.deepEqual(marks.of(ID), { favorite: true, note: 'le calcul de ponder() est ici', messages: [] });

    const data = readBack(marks);
    assert.equal(data.format, 'ariane-marks');
    assert.equal(data.version, 1);
    assert.match(data.marks[ID].updatedAt, /^\d{4}-\d\d-\d\dT/);
  });

  test('un-starred and emptied, the entry goes rather than lingering', (t) => {
    const marks = setup(t);
    marks.set(ID, { favorite: true, note: 'x' });
    marks.set(ID, { favorite: false });
    assert.deepEqual(marks.of(ID), { favorite: false, note: 'x', messages: [] }, 'the note survives the star');
    marks.set(ID, { note: '' });
    assert.deepEqual(readBack(marks).marks, {}, 'nothing marked, nothing stored');
  });

  test('every marked conversation, at once', (t) => {
    const marks = setup(t);
    marks.set(ID, { favorite: true });
    marks.set('codex:abc', { note: 'à relire' });
    assert.deepEqual(marks.all(), {
      [ID]: { favorite: true, note: '', messages: [] },
      'codex:abc': { favorite: false, note: 'à relire', messages: [] },
    });
  });
});

test.describe('protecting what was written', () => {
  // A file that cannot be parsed still holds someone's words.
  test('a file it cannot read is never overwritten', (t) => {
    const marks = setup(t);
    const broken = '{ "marks": { "claude:x": { "note": "précieux", } }';
    fs.writeFileSync(marks.file, broken);

    const result = marks.set(ID, { favorite: true });
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(marks.file, 'utf8'), broken, 'byte for byte as it was');
    assert.deepEqual(marks.of(ID), { favorite: false, note: '', messages: [] }, 'and nothing is claimed about it');
  });

  test('a file from a newer version is left alone', (t) => {
    const marks = setup(t);
    fs.writeFileSync(marks.file, JSON.stringify({ format: 'ariane-marks', version: 99, marks: {} }));
    assert.equal(marks.set(ID, { favorite: true }).ok, false);
    assert.match(marks.read().error, /newer version/);
  });

  test('keys this version does not know are kept, at both levels', (t) => {
    const marks = setup(t);
    fs.writeFileSync(
      marks.file,
      JSON.stringify({
        format: 'ariane-marks',
        version: 1,
        couleur: 'orange',
        marks: { [ID]: { note: 'gardée', etiquettes: ['client-x'] } },
      })
    );

    marks.set(ID, { favorite: true });
    const data = readBack(marks);
    assert.equal(data.couleur, 'orange');
    assert.deepEqual(data.marks[ID].etiquettes, ['client-x']);
    assert.equal(data.marks[ID].note, 'gardée');
  });

  test('writes through a temporary file, readable by its owner alone', (t) => {
    const marks = setup(t);
    marks.set(ID, { favorite: true });
    assert.deepEqual(fs.readdirSync(path.dirname(marks.file)), ['marks.json'], 'no partial file left');
    if (process.platform !== 'win32') assert.equal(fs.statSync(marks.file).mode & 0o777, 0o600);
  });

  test('refuses what is not an id, and what is not a note', (t) => {
    const marks = setup(t);
    for (const bad of ['', 'sans-agent', '../../etc/passwd', 'claude:', 42, null, { toString: () => ID }]) {
      assert.throws(() => marks.set(bad, { favorite: true }), TypeError, JSON.stringify(bad));
    }
    assert.throws(() => marks.set(ID, { note: 42 }), TypeError);
    assert.throws(() => marks.set(ID, { note: `x${String.fromCharCode(0)}` }), TypeError);
    assert.throws(() => marks.set(ID, { note: 'x'.repeat(NOTE_MAX + 1) }), TypeError);
    assert.equal(fs.existsSync(marks.file), false, 'nothing written along the way');
  });

  test('a note may hold several lines, and any language', (t) => {
    const marks = setup(t);
    const note = 'à relire :\n\t— le calcul\n\t— 日本語 aussi';
    assert.equal(marks.set(ID, { note }).mark.note, note);
    assert.equal(marks.of(ID).note, note);
  });
});

test.describe('forgetting', () => {
  test('a forgotten conversation takes its mark with it', (t) => {
    const marks = setup(t);
    marks.set(ID, { favorite: true, note: 'x' });
    assert.deepEqual(marks.remove(ID), { ok: true, removed: true });
    assert.deepEqual(marks.of(ID), { favorite: false, note: '', messages: [] });
    assert.deepEqual(marks.remove(ID), { ok: true, removed: false }, 'and again is harmless');
  });
});

/**
 * The reason marks live outside the index: the index is thrown away and
 * rebuilt at every schema change. This is that, end to end.
 */
test('a star and a note survive the index being rebuilt from scratch', async (t) => {
  const { Index } = require('../src/core/db');
  const { Indexer } = require('../src/core/indexer');
  const { createFixture, records, resetCounters } = require('./helpers/fixture');

  resetCounters();
  const fx = createFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-rebuild-'));
  let index;
  t.after(() => {
    // Closed BEFORE the directory goes. Hooks run in registration order, so a
    // close registered further down would run after the removal — which Linux
    // forgives and Windows does not: rmSync on a directory still holding an
    // open SQLite file fails with EPERM there.
    index?.close();
    fx.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The same records throughout: a rewritten transcript keeps its own ids.
  const question = records.userText('une question');
  const answer = records.assistantText('la réponse qui compte');
  fx.project('-p', { originalPath: '/p' }).session('s1', [question, answer]);
  const dbFile = path.join(dir, 'index.sqlite3');
  const marks = new Marks(dir);

  index = new Index(dbFile);
  await new Indexer(index, { env: fx.env }).run();
  const [session] = index.sessions(index.folders()[0].id);
  marks.set(session.id, { favorite: true, note: 'celle-ci compte' });
  const stored = index.messages(session.id).find((m) => m.role === 'assistant');
  marks.setMessage(session.id, {
    uuid: stored.uuid,
    seq: stored.seq,
    role: stored.role,
    at: stored.ts,
    preview: stored.text,
  });
  const idBefore = stored.id;
  const seqBefore = stored.seq;
  index.close();

  // The transcript is rewritten with a message inserted BEFORE the starred one:
  // its position moves, and so will the row it lands on.
  fx.project('-p', { originalPath: '/p' }).session('s1', [
    records.userText('une remarque ajoutée avant'),
    question,
    answer,
  ]);

  // What a schema bump does: every table dropped, everything read again.
  const older = new (require('better-sqlite3'))(dbFile);
  older.pragma('user_version = 1');
  older.close();
  index = new Index(dbFile);
  assert.equal(index.stats().sessions, 0, 'the index really was emptied');
  await new Indexer(index, { env: fx.env }).run();

  const rebuilt = index.sessions(index.folders()[0].id)[0];
  assert.equal(rebuilt.id, session.id, 'the global id is what survives a reindexing');
  const mark = marks.of(rebuilt.id);
  assert.equal(mark.favorite, true);
  assert.equal(mark.note, 'celle-ci compte');

  const messages = index.messages(rebuilt.id);
  const resolved = marks.resolve(rebuilt.id, messages);
  assert.equal(resolved.length, 1, 'the starred message is found again');
  const found = messages.find((m) => m.id === resolved[0]);
  assert.equal(found.text, 'la réponse qui compte');
  assert.notEqual(found.seq, seqBefore, 'at a different position than when it was starred');
  assert.notEqual(found.id, idBefore, 'and on a different row');
});

/**
 * A starred MESSAGE has no single stable identifier: measured on a real corpus,
 * 98 % of Claude's messages carry one, 91 % of Codex's, 74 % of Copilot's, and
 * none of VS Code's. So a mark stores several coordinates, and is resolved by
 * the most reliable one that still matches.
 */
test.describe('starring a message inside a conversation', () => {
  const conversation = [
    { id: 101, seq: 0, uuid: 'u-1', role: 'user', text: 'Que fait ce code ?' },
    { id: 102, seq: 1, uuid: 'u-2', role: 'assistant', text: 'Il compte les octets.' },
    { id: 103, seq: 2, uuid: '', role: 'user', text: 'et pourquoi si lentement ?' },
  ];

  test('an id of its own is what identifies it, when the agent wrote one', (t) => {
    const marks = setup(t);
    marks.setMessage(ID, { uuid: 'u-2', seq: 1, role: 'assistant', preview: 'Il compte les octets.' });
    assert.deepEqual(marks.resolve(ID, conversation), [102]);

    // Rebuilt index: every row id changed, and one message was dropped.
    const rebuilt = [
      { id: 500, seq: 0, uuid: 'u-2', role: 'assistant', text: 'Il compte les octets.' },
      { id: 501, seq: 1, uuid: 'u-1', role: 'user', text: 'Que fait ce code ?' },
    ];
    assert.deepEqual(marks.resolve(ID, rebuilt), [500], 'found by its own id, wherever it landed');
  });

  // VS Code writes no id at all: the position, checked against the text.
  test('without an id, the position — and the text confirms it', (t) => {
    const marks = setup(t);
    marks.setMessage(ID, { seq: 2, role: 'user', preview: 'et pourquoi si lentement ?' });
    assert.deepEqual(marks.resolve(ID, conversation), [103]);

    // The extraction changed and everything shifted by one.
    const shifted = conversation.map((m, i) => ({ ...m, id: 200 + i, seq: m.seq + 1 }));
    assert.deepEqual(marks.resolve(ID, shifted), [202], 'the opening of the text catches the shift');
  });

  // L'étoile d'un message sans identifiant, dont la position a bougé depuis (une
  // reconstruction) : resolve() la retrouve par son texte, mais la retirer
  // cherchait sa position d'origine, et ne retirait rien (26 septembre 2026).
  test('a star found again by its text can be taken off where it now stands', (t) => {
    const marks = setup(t);
    marks.setMessage(ID, { seq: 2, role: 'user', preview: 'et pourquoi si lentement ?' });
    const shifted = conversation.map((m, i) => ({ ...m, id: 200 + i, seq: m.seq + 1 }));
    assert.deepEqual(marks.resolve(ID, shifted), [202]);

    marks.setMessage(ID, { seq: 3, role: 'user', preview: 'et pourquoi si lentement ?' }, false);
    assert.deepEqual(marks.resolve(ID, shifted), [], 'l’étoile est partie');
    assert.deepEqual(readBack(marks).marks, {}, 'et le fichier le dit');
  });

  test('a message that no longer exists resolves to nothing, and is kept', (t) => {
    const marks = setup(t);
    marks.setMessage(ID, { uuid: 'u-parti', seq: 9, preview: 'effacé depuis' });
    assert.deepEqual(marks.resolve(ID, conversation), []);
    assert.equal(marks.of(ID).messages.length, 1, 'kept: the conversation may come back whole');
  });

  test('starred, then unstarred, and the conversation entry goes with the last one', (t) => {
    const marks = setup(t);
    marks.setMessage(ID, { uuid: 'u-1', seq: 0, preview: 'Que fait ce code ?' });
    marks.setMessage(ID, { seq: 2, preview: 'et pourquoi si lentement ?' });
    assert.deepEqual(marks.resolve(ID, conversation), [101, 103], 'in the order of the conversation');

    marks.setMessage(ID, { uuid: 'u-1', seq: 0 }, false);
    assert.deepEqual(marks.resolve(ID, conversation), [103]);
    marks.setMessage(ID, { seq: 2 }, false);
    assert.deepEqual(readBack(marks).marks, {}, 'nothing marked, nothing stored');
  });

  test('a note on the conversation survives its messages being starred', (t) => {
    const marks = setup(t);
    marks.set(ID, { note: 'celle-ci compte' });
    marks.setMessage(ID, { uuid: 'u-2', seq: 1 });
    const mark = marks.of(ID);
    assert.equal(mark.note, 'celle-ci compte');
    assert.equal(mark.messages.length, 1);
  });

  test('refuses a message it could never find again', (t) => {
    const marks = setup(t);
    for (const bad of [undefined, {}, { seq: -1 }, { seq: 1.5 }, { seq: '2' }]) {
      assert.throws(() => marks.setMessage(ID, bad), TypeError, JSON.stringify(bad));
    }
    assert.throws(() => marks.setMessage(ID, { seq: 1, uuid: 'x'.repeat(200) }), TypeError);
    assert.throws(() => marks.setMessage('pas-un-id', { seq: 1 }), TypeError);
  });

  test('stores enough to recognise a message, and not a copy of it', (t) => {
    const marks = setup(t);
    marks.setMessage(ID, { uuid: 'u-2', seq: 1, role: 'assistant', at: '2026-09-20T10:00:00.000Z',
      preview: 'x'.repeat(400) });
    const [stored] = marks.of(ID).messages;
    assert.equal(stored.preview.length, 160);
    // L'écran retrouve ce message dans la vue des favoris par la même règle :
    // preview(text, 160) y rendait 159 caractères et « … », et un message de
    // plus de 160 caractères ramenait au premier étoilé (26 septembre 2026).
    return import('../src/renderer/format.js').then((F) => {
      assert.equal(F.markOpening('x'.repeat(400)), stored.preview);
      assert.equal(F.markOpening('  un   texte\n court '), 'un texte court');
    });
    assert.deepEqual(Object.keys(stored).sort(), ['at', 'preview', 'role', 'seq', 'uuid']);
  });
});
