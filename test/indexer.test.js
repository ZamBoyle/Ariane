'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { Index } = require('../src/core/db');
const { Indexer, BATCH_SIZE } = require('../src/core/indexer');
const { createFixture, isolatedEnv, records, cdx, resetCounters } = require('./helpers/fixture');

/** Session ids are namespaced by agent; see agents/contract.js. */
const SID = 'claude:s1';

/** Build a fresh in-memory index plus an empty fake Claude home. */
function setup() {
  resetCounters();
  const fx = createFixture();
  const index = new Index(':memory:');
  const run = (options = {}) => new Indexer(index, { env: fx.env, ...options }).run();
  return { fx, index, run, teardown: () => { index.close(); fx.cleanup(); } };
}

test('indexes a transcript into folders, sessions and messages', async (t) => {
  const { fx, index, run, teardown } = setup();
  t.after(teardown);

  fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' }).session('s1', [
    records.aiTitle('Ma conversation'),
    records.userText('Bonjour Claude'),
    records.assistantText('Bonjour !'),
  ]);

  const report = await run();
  assert.equal(report.indexed, 1);
  assert.equal(report.messages, 2);
  assert.deepEqual(index.stats(), { agents: 1, folders: 1, sessions: 1, messages: 2 });

  const [folder] = index.folders();
  assert.equal(folder.path, '/home/zam/demo');
  assert.equal(folder.sessionCount, 1);

  const [session] = index.sessions(folder.id);
  assert.equal(session.title, 'Ma conversation');
  assert.equal(session.source, 'transcript');
  assert.equal(session.messageCount, 2);
  assert.equal(session.firstPrompt, 'Bonjour Claude');
  assert.equal(session.gitBranch, 'main');
});

test.describe('folder path resolution', () => {
  test('prefers originalPath, preserving characters the directory name lost', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    // On disk the accent is destroyed; originalPath is the only exact source.
    fx.project('-home-zam-Documents-Math-matiques', {
      originalPath: '/home/zam/Documents/Mathématiques',
    }).session('s1', [records.userText('salut')]);

    await run();
    assert.equal(index.folders()[0].path, '/home/zam/Documents/Mathématiques');
  });

  test('falls back to cwd when sessions-index.json is absent', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-home-zam-demo').session('s1', [
      records.userText('salut', { cwd: '/home/zam/real/path' }),
    ]);

    await run();
    assert.equal(index.folders()[0].path, '/home/zam/real/path');
  });

  test('falls back to the lossy hint only as a last resort', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-home-zam-demo').session('s1', [
      records.userText('salut', { cwd: undefined }),
    ]);

    await run();
    assert.equal(index.folders()[0].path, '/home/zam/demo');
  });

  test('a reconstructed path is flagged as a guess, an exact one is not', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-home-zam-devine').session('s1', [records.userText('salut', { cwd: undefined })]);
    fx.project('-home-zam-sur', { originalPath: '/home/zam/sur' })
      .session('s2', [records.userText('salut')]);

    await run();
    const byPath = new Map(index.folders().map((f) => [f.path, f]));
    assert.equal(byPath.get('/home/zam/devine').pathExact, 0, 'the decoded name is a guess');
    assert.equal(byPath.get('/home/zam/sur').pathExact, 1, 'originalPath is exact');
  });

  test('a later guess never undoes a path that was confirmed', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    // Same folder, two agents. Codex records the path verbatim; Claude, with no
    // sessions-index.json, can only reconstruct it from the directory name.
    fx.codex().session('11111111-1111-4111-8111-111111111111', [
      cdx.meta('/home/zam/partage'),
      cdx.message('user', 'a'),
    ]);
    await run();
    assert.equal(index.folders()[0].pathExact, 1);

    fx.project('-home-zam-partage').session('s1', [records.userText('b', { cwd: undefined })]);
    await run();
    const folder = index.folders().find((f) => f.path === '/home/zam/partage');
    assert.equal(folder.sessionCount, 2, 'both agents landed in the same folder');
    assert.equal(folder.pathExact, 1, 'a confirmed path must not fall back to a guess');
  });
});

test.describe('incremental indexing', () => {
  test('skips an unchanged transcript on the second run', async (t) => {
    const { fx, run, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('a')]);

    assert.equal((await run()).indexed, 1);
    const second = await run();
    assert.equal(second.skipped, 1);
    assert.equal(second.indexed, 0);
    assert.equal(second.messages, 0, 'nothing should be re-read');
  });

  test('picks up appended records without duplicating earlier ones', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    const project = fx.project('-p', { originalPath: '/p' });
    project.session('s1', [records.userText('premier')]);
    await run();

    project.append('s1', [records.assistantText('deuxieme')]);
    const second = await run();

    assert.equal(second.messages, 1, 'only the appended record is read');
    assert.equal(index.stats().messages, 2);
    const texts = index.messages(SID).map((m) => m.text);
    assert.deepEqual(texts, ['premier', 'deuxieme']);
  });

  test('re-indexes from scratch when a transcript shrank', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    const project = fx.project('-p', { originalPath: '/p' });
    project.session('s1', [
      records.userText('un'),
      records.assistantText('deux'),
      records.userText('trois'),
    ]);
    await run();
    assert.equal(index.stats().messages, 3);

    project.rewrite('s1', [records.userText('remplace')]);
    await run();

    const texts = index.messages(SID).map((m) => m.text);
    assert.deepEqual(texts, ['remplace'], 'stale messages must be dropped');
  });

  test('does not consume a trailing line that is still being written', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    const project = fx.project('-p', { originalPath: '/p' });
    const complete = JSON.stringify({
      sessionId: 's1', type: 'user', uuid: 'u1', cwd: '/p',
      message: { role: 'user', content: 'complet' },
    });
    const partial = '{"sessionId":"s1","type":"user","uuid":"u2","message":{"content":"tronq';
    project.raw('s1', `${complete}\n${partial}`);

    await run();
    assert.equal(index.stats().messages, 1, 'the truncated line must be ignored');

    // The writer finishes the line; the next pass must pick it up exactly once.
    fs.appendFileSync(project.file('s1'), 'ue"}}\n');
    await run();

    const texts = index.messages(SID).map((m) => m.text);
    assert.deepEqual(texts, ['complet', 'tronque']);
  });

  // Une ligne ENTIÈRE, mais dont le retour à la ligne n'est pas encore écrit :
  // la passe tombe entre les deux. Elle était stockée tout de suite, puis relue
  // à la passe suivante — deux fois pour une ligne sans identifiant, et, pour une
  // réponse, son coût posé sur la relecture que l'index refusait (26 septembre 2026).
  const codexPass = (fx, index) => () =>
    new Indexer(index, { env: fx.env, adapters: [require('../src/core/agents/codex')] }).run();
  const codexId = (index) => index.sessions(index.folders()[0].id)[0].id;
  const total = { input_tokens: 100, cached_input_tokens: 60, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 150 };

  test('a whole line whose newline is not written yet is stored once, when it is', async (t) => {
    const { fx, index, teardown } = setup();
    t.after(teardown);
    const run = codexPass(fx, index);
    const tree = fx.codex();
    const file = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    tree.session(file, [cdx.meta('/p', file), cdx.message('assistant', 'bonjour')]);
    // Une question de la personne, sans identifiant, comme Codex les écrit.
    fs.appendFileSync(tree.file(file), JSON.stringify(cdx.message('user', 'la question', { id: undefined })));
    await run();

    fs.appendFileSync(tree.file(file), `\n${JSON.stringify(cdx.message('assistant', 'la réponse'))}\n`);
    await run();
    assert.deepEqual(
      index.messages(codexId(index)).map((m) => m.text),
      ['bonjour', 'la question', 'la réponse'],
      'chaque ligne une fois'
    );
  });

  // Une passe coupée après un premier lot de 500 lignes — l'app fermée pendant
  // la passe de lancement, un disque qui lâche — gardait ces lignes sans
  // avancer le curseur : la passe suivante les relisait (26 septembre 2026).
  test('a pass cut short leaves the conversation exactly as its cursor says', async (t) => {
    const { fx, index, teardown } = setup();
    t.after(teardown);
    const codex = require('../src/core/agents/codex');
    const run = (adapter = codex) => new Indexer(index, { env: fx.env, adapters: [adapter] }).run();
    const tree = fx.codex();
    const file = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const questions = (from, n) =>
      Array.from({ length: n }, (_, i) => cdx.message('user', `question ${from + i}`, { id: undefined }));
    tree.session(file, [cdx.meta('/p', file), ...questions(0, 600)]);
    await run();
    const id = codexId(index);

    fs.appendFileSync(tree.file(file), questions(600, 600).map((r) => `${JSON.stringify(r)}\n`).join(''));
    const cut = {
      ...codex,
      async *read(descriptor, options) {
        let n = 0;
        for await (const chunk of codex.read(descriptor, options)) {
          if (++n > BATCH_SIZE + 20) throw new Error('coupé');
          yield chunk;
        }
      },
    };
    const report = await run(cut);
    assert.equal(report.errors.length, 1);
    assert.equal(index.messages(id).length, 600, 'rien de la lecture coupée ne reste');

    await run();
    const texts = index.messages(id).map((m) => m.text);
    assert.equal(texts.length, 1200, 'chaque question une fois');
    assert.equal(new Set(texts).size, 1200);
  });

  test('a reply read before its newline keeps the cost that follows it', async (t) => {
    const { fx, index, teardown } = setup();
    t.after(teardown);
    const run = codexPass(fx, index);
    const tree = fx.codex();
    const file = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    tree.session(file, [cdx.meta('/p', file), cdx.message('user', 'la question')]);
    fs.appendFileSync(tree.file(file), JSON.stringify(cdx.message('assistant', 'la réponse')));
    await run();

    fs.appendFileSync(tree.file(file), `\n${JSON.stringify(cdx.tokenCount(total))}\n`);
    await run();
    const [, reply] = index.messages(codexId(index));
    assert.equal(reply.text, 'la réponse');
    assert.equal(reply.usage && reply.usage.output, 50, 'le coût de la réponse n’est pas perdu');
  });
});

test.describe('history-only sessions', () => {
  test('are indexed so purged conversations stay searchable', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.history([
      { display: 'prompt perdu', project: '/home/zam/gone', sessionId: 'ghost', timestamp: 1765054827534 },
      { display: 'second prompt', project: '/home/zam/gone', sessionId: 'ghost', timestamp: 1765054867417 },
    ]);

    const report = await run();
    assert.equal(report.orphans, 1);

    const folder = index.folders().find((f) => f.path === '/home/zam/gone');
    assert.equal(folder.existsOnDisk, 0, 'flagged as having no transcript on disk');

    const [session] = index.sessions(folder.id);
    assert.equal(session.source, 'history');
    assert.equal(session.messageCount, 2);
    assert.equal(index.search('perdu').length, 1, 'orphan prompts must be searchable');
  });

  // Seven prompts of 510 measured carry one, and for a purged session it is the
  // only surviving trace of what was being discussed.
  test('keep what was pasted into the prompt, without burying the question', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.history([
      {
        display: 'pourquoi cette erreur ?',
        project: '/home/zam/gone',
        sessionId: 'ghost',
        timestamp: 1765054827534,
        pastedContents: {
          1: { id: 1, type: 'text', lineCount: 3, content: 'ld.so: libgtk3-nocsd.so.0 cannot be preloaded' },
        },
      },
    ]);

    await run();
    const folder = index.folders().find((f) => f.path === '/home/zam/gone');
    const [message] = index.messages(index.sessions(folder.id)[0].id);

    assert.equal(message.text, 'pourquoi cette erreur ?', 'the question stays the question');
    const pasted = message.parts.find((p) => p.type === 'pasted');
    assert.ok(pasted, `no pasted part: ${JSON.stringify(message.parts)}`);
    assert.ok(pasted.preview.includes('libgtk3-nocsd'));
    assert.equal(pasted.lines, 3);
  });

  test('never shadow a session that has a real transcript', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.userText('texte complet du transcript'),
      records.assistantText('reponse'),
    ]);
    fx.history([{ display: 'version tronquee', project: '/p', sessionId: 's1', timestamp: 1 }]);

    const report = await run();
    assert.equal(report.orphans, 0);
    assert.equal(index.session(SID).source, 'transcript');
    assert.equal(index.stats().messages, 2, 'history must not add a duplicate');
  });

  test('ignore rows missing a session or project', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.history([
      { display: 'orphelin', timestamp: 1 },
      { display: 'sans projet', sessionId: 'x', timestamp: 1 },
      { project: '/p', timestamp: 1 },
    ]);

    assert.equal((await run()).orphans, 0);
    assert.equal(index.stats().sessions, 0);
  });
});

test.describe('robustness', () => {
  test('a missing data directory yields an empty report, not a crash', async (t) => {
    const index = new Index(':memory:');
    t.after(() => index.close());

    const report = await new Indexer(index, {
      env: isolatedEnv(),
    }).run();

    assert.equal(report.scanned, 0);
    assert.deepEqual(report.errors, []);
  });

  test('malformed lines are skipped without losing valid neighbours', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    const ok = (uuid, text) => JSON.stringify({
      sessionId: 's1', type: 'user', uuid, cwd: '/p', message: { role: 'user', content: text },
    });
    fx.project('-p', { originalPath: '/p' }).raw('s1', `${ok('u1', 'avant')}\nPAS DU JSON\n${ok('u2', 'apres')}\n`);

    await run();
    assert.deepEqual(index.messages(SID).map((m) => m.text), ['avant', 'apres']);
  });

  test('plumbing records never become messages', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.noise(), records.noise(),
      records.userText('le seul vrai message'),
      records.noise(),
    ]);

    await run();
    assert.equal(index.stats().messages, 1);
  });

  test('attachment payloads never reach the database', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('s1', [records.attachment(40000)]);
    await run();

    const [message] = index.messages(SID);
    assert.equal(message.parts[0].type, 'attachment');
    assert.equal(message.parts[0].mediaType, 'image/png');
    assert.ok(message.parts[0].bytes > 0);
    assert.ok(!JSON.stringify(message).includes('AAAAAAAAAA'), 'base64 must be discarded');
  });

  test('reports progress through every phase', async (t) => {
    const { fx, index, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('a')]);

    const phases = [];
    await new Indexer(index, {
      env: fx.env,
      onProgress: (p) => phases.push(p.phase),
    }).run();

    assert.ok(phases.includes('start'));
    assert.ok(phases.includes('scanning'));
    assert.equal(phases.at(-1), 'done');
  });
});

test('multiple projects are kept apart', async (t) => {
  const { fx, index, run, teardown } = setup();
  t.after(teardown);

  fx.project('-a', { originalPath: '/a' }).session('s1', [records.userText('projet A')]);
  fx.project('-b', { originalPath: '/b' })
    .session('s2', [records.userText('projet B')])
    .session('s3', [records.userText('projet B encore')]);

  await run();

  const byPath = Object.fromEntries(index.folders().map((f) => [f.path, f]));
  assert.equal(byPath['/a'].sessionCount, 1);
  assert.equal(byPath['/b'].sessionCount, 2);

  const hits = index.search('projet');
  assert.equal(hits.length, 3);
  assert.equal(index.search('projet', { folderId: byPath['/b'].id }).length, 2);
});

test.describe('sessions with nothing to read', () => {
  // Measured on a real machine: 50 of 64 VS Code sessions held no message, and
  // 14 folders contained nothing else. Listing them offers rows that open onto
  // an empty pane.
  test('a session holding no message is not listed', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' })
      .session('vide', [records.noise(), records.noise()])
      .session('pleine', [records.userText('une vraie question')]);

    const report = await run();
    assert.equal(report.empty, 1, 'one session was dropped');

    const [folder] = index.folders();
    assert.equal(folder.sessionCount, 1);
    assert.deepEqual(index.sessions(folder.id).map((s) => s.id), ['claude:pleine']);
  });

  test('a folder whose sessions are all empty disappears entirely', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-vide', { originalPath: '/vide' }).session('s1', [records.noise()]);
    fx.project('-plein', { originalPath: '/plein' }).session('s2', [records.userText('salut')]);

    await run();
    assert.deepEqual(index.folders().map((f) => f.path), ['/plein']);
  });

  // The file is still tracked, so a session that later gains messages returns.
  test('a session that later gains a message comes back', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    const project = fx.project('-p', { originalPath: '/p' });
    project.session('tardive', [records.noise()]);

    await run();
    assert.equal(index.stats().sessions, 0);

    project.append('tardive', [records.userText('enfin quelque chose')]);
    await run();

    assert.equal(index.stats().sessions, 1);
    assert.equal(index.session('claude:tardive').messageCount, 1);
  });
});

// The footer reports these numbers while the sidebar lists the rows; if the two
// disagree the app contradicts itself in the same window.
test('the reported counts match what is listed', async (t) => {
  const { fx, index, run, teardown } = setup();
  t.after(teardown);

  fx.project('-vide', { originalPath: '/vide' }).session('s1', [records.noise()]);
  fx.project('-plein', { originalPath: '/plein' }).session('s2', [records.userText('salut')]);

  await run();

  const stats = index.stats();
  assert.equal(stats.folders, index.folders().length, 'folders');
  assert.equal(
    stats.sessions,
    index.folders().reduce((n, f) => n + index.sessions(f.id).length, 0),
    'sessions'
  );
  assert.equal(stats.agents, 1);
});

test.describe('records that repeat a turn stored elsewhere', () => {
  // 555 of 647 last-prompt pointers measured repeated an existing message.
  test('a pointer to a prompt already present is not stored twice', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.userText('ma question'),
      records.assistantText('ma reponse'),
      { type: 'last-prompt', lastPrompt: 'ma question', leafUuid: 'x', sessionId: 's1' },
    ]);

    await run();
    const texts = index.messages('claude:s1').map((m) => m.text);
    assert.deepEqual(texts, ['ma question', 'ma reponse'], 'the prompt appears once');
  });

  // The other 92 exist nowhere else and would be lost.
  test('a pointer to a prompt stored nowhere else is recovered', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.assistantText('une reponse sans question visible'),
      { type: 'last-prompt', lastPrompt: 'la question perdue', leafUuid: 'y', sessionId: 's1' },
    ]);

    await run();
    const messages = index.messages('claude:s1');
    assert.ok(messages.some((m) => m.text === 'la question perdue' && m.role === 'user'));
  });

  test('the check holds whatever the order of the records', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    // Pointer first, real record afterwards.
    fx.project('-p', { originalPath: '/p' }).session('s1', [
      { type: 'last-prompt', lastPrompt: 'meme texte', leafUuid: 'z', sessionId: 's1' },
      records.userText('meme texte'),
    ]);

    await run();
    const same = index.messages('claude:s1').filter((m) => m.text === 'meme texte');
    assert.equal(same.length, 1, 'stored once, not twice');
  });
});

test.describe('recovering from a bad session', () => {
  // first_prompt is derived with COALESCE, so a stale one would outlive the
  // conversation it described.
  test('a replaced conversation is relabelled, not left with the old prompt', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    const project = fx.project('-p', { originalPath: '/p' });
    project.session('s1', [records.userText('une question tres longue posee au depart')]);
    await run();
    assert.equal(
      index.sessions(index.folders()[0].id)[0].firstPrompt,
      'une question tres longue posee au depart'
    );

    // Shorter than what was read, so the stored cursor is past the end: the
    // adapter refuses to resume and the session is re-read from zero.
    project.rewrite('s1', [records.userText('autre sujet')]);
    await run();
    assert.equal(
      index.sessions(index.folders()[0].id)[0].firstPrompt,
      'autre sujet',
      'the old prompt must not survive its conversation'
    );
  });

  test('a session whose read fails leaves no row behind', async (t) => {
    const { fx, index, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('bonne', [records.userText('lisible')]);

    // An adapter that discovers two sessions and throws on one of them.
    const claude = require('../src/core/agents/claude');
    const broken = {
      ...claude,
      async *discover(ctx) {
        for await (const d of claude.discover(ctx)) yield d;
        yield { sessionId: 'cassee', key: '/nowhere', fingerprint: 'x', folderPath: '/p' };
      },
      async *read(d, opts) {
        if (d.sessionId === 'cassee') throw new Error('illisible');
        yield* claude.read(d, opts);
      },
    };

    const report = await new Indexer(index, { env: fx.env, adapters: [broken] }).run();
    assert.equal(report.errors.length, 1, 'the failure is reported');
    assert.equal(index.session('claude:cassee'), null, 'and leaves no ghost row');
    assert.ok(index.session('claude:bonne'), 'the readable one is unaffected');
  });
});

/**
 * Claude Code compacts a conversation by opening a NEW transcript, with a new
 * id. The person lived one conversation; the disk holds two files. The boundary
 * record names the last message of the previous one, and that is the thread.
 */
test.describe('a conversation compacted into a second transcript', () => {
  const boundary = (parentUuid) => ({
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    logicalParentUuid: parentUuid,
    uuid: 'b-1',
    sessionId: 's2',
    timestamp: '2026-09-18T10:00:00.000Z',
    cwd: '/home/zam/demo',
  });

  test('the two parts are read as one chain, in order', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    const first = records.userText('la première partie');
    const last = records.assistantText('le dernier message avant la compaction');
    const project = fx.project('-p', { originalPath: '/p' });
    project.session('s1', [first, last]);
    project.session('s2', [boundary(last.uuid), records.userText('et on continue')]);

    await run();

    const chain = index.chain('claude:s2');
    assert.deepEqual(chain.map((part) => part.id), ['claude:s1', 'claude:s2']);
    assert.deepEqual(index.chain('claude:s1').map((part) => part.id), ['claude:s1', 'claude:s2'],
      'either part answers with the whole chain');
  });

  test('a conversation nobody compacted is a chain of one', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);
    fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('seule')]);
    await run();
    assert.deepEqual(index.chain('claude:s1').map((p) => p.id), ['claude:s1']);
  });

  test('three parts, and a part whose transcript was purged breaks no chain', async (t) => {
    const { fx, index, run, teardown } = setup();
    t.after(teardown);

    const endOfOne = records.assistantText('fin de la première');
    const endOfTwo = records.assistantText('fin de la deuxième');
    const project = fx.project('-p', { originalPath: '/p' });
    project.session('s1', [records.userText('un'), endOfOne]);
    project.session('s2', [boundary(endOfOne.uuid), records.userText('deux'), endOfTwo]);
    project.session('s3', [{ ...boundary(endOfTwo.uuid), sessionId: 's3', uuid: 'b-2' }, records.userText('trois')]);

    await run();
    assert.deepEqual(index.chain('claude:s2').map((p) => p.id), ['claude:s1', 'claude:s2', 'claude:s3']);

    // The middle part's file is gone and its messages with it: what remains is
    // still shown, and nothing is invented to bridge the hole.
    index.resetSession('claude:s2');
    assert.deepEqual(index.chain('claude:s3').map((p) => p.id), ['claude:s3']);
    assert.deepEqual(index.chain('claude:s1').map((p) => p.id), ['claude:s1', 'claude:s2']);
  });
});
