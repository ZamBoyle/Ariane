'use strict';

/**
 * Gemini CLI adapter tests.
 *
 * The two cases worth the most here are the ones that quietly corrupt data
 * rather than crashing: a `$set` mutation that REPLACES the message list (a
 * parser that appends multiplies the conversation), and a `content` field whose
 * shape depends on the role (a parser that assumes one shape drops every
 * message of the other role, silently).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../src/core/agents/gemini');
const { replayLog, toItem } = require('../src/core/agents/gemini');
const { createFixture, gem, resetCounters } = require('./helpers/fixture');

const collect = async (iterable) => {
  const out = [];
  for await (const value of iterable) out.push(value);
  return out;
};

function setup() {
  resetCounters();
  const fx = createFixture();
  return { fx, ctx: { env: fx.env }, teardown: () => fx.cleanup() };
}

const readAll = async (d) => (await collect(adapter.read(d))).map((c) => c.item);

// ── one turn ────────────────────────────────────────────────────────────────

test.describe('turn normalisation', () => {
  const descriptor = { folderPath: '/p', startedAt: '2026-06-27T22:10:00.000Z' };

  // Perfect correlation measured over 40 messages: array for user, string for model.
  test('reads a user turn, whose content is an array of parts', () => {
    const item = toItem(gem.user('ma question'), descriptor);
    assert.equal(item.role, 'user');
    assert.equal(item.text, 'ma question');
  });

  test('reads a model turn, whose content is a bare string', () => {
    const item = toItem(gem.model('ma reponse'), descriptor);
    assert.equal(item.role, 'assistant', '"gemini" maps to assistant');
    assert.equal(item.text, 'ma reponse');
    assert.equal(item.model, 'gemini-2.5-pro');
  });

  test('neither shape is assumed: both survive the same parser', () => {
    const items = [gem.user('question'), gem.model('reponse')].map((m) => toItem(m, descriptor));
    assert.deepEqual(items.map((i) => i.text), ['question', 'reponse']);
    assert.deepEqual(items.map((i) => i.role), ['user', 'assistant']);
  });

  test('keeps reasoning out of the indexed text', () => {
    const item = toItem(gem.model('reponse', { thoughts: ['une idee', 'une autre'] }), descriptor);
    assert.equal(item.text, 'reponse');
    assert.equal(item.thinking, 'une idee\nune autre');
  });

  test('accepts thoughts given as objects or as a string', () => {
    assert.equal(toItem(gem.model('x', { thoughts: 'brut' }), descriptor).thinking, 'brut');
    assert.equal(
      toItem(gem.model('x', { thoughts: [{ subject: 'sujet' }] }), descriptor).thinking,
      'sujet'
    );
  });

  // Measured on the 11 real replies that carry counts: total = input + output
  // + thoughts + tool, every time — so `cached` is inside `input`.
  test('a reply’s count is read in the contract’s words', () => {
    const item = toItem(
      gem.model('r', {
        tokens: { input: 12000, output: 187, cached: 8000, thoughts: 300, tool: 0, total: 12487 },
      }),
      descriptor
    );
    assert.deepEqual(item.usage, {
      input: 4000,
      output: 487,
      cacheRead: 8000,
      cacheWrite: null,
      reasoning: 300,
    });
  });

  test('no count is no usage, and the person’s turn never carries one', () => {
    assert.equal(toItem(gem.model('r'), descriptor).usage, null);
    assert.equal(toItem(gem.model('r', { tokens: 'n/a' }), descriptor).usage, null);
    assert.equal(
      toItem(gem.user('q', { tokens: { input: 5, output: 5 } }), descriptor).usage,
      null
    );
  });

  test('turns tool calls into preview parts', () => {
    const item = toItem(gem.model('', { toolCalls: [{ id: 't1', name: 'read_file', args: { p: '/a' } }] }),
      descriptor);
    assert.equal(item.parts[0].type, 'tool_use');
    assert.equal(item.parts[0].name, 'read_file');
    assert.ok(item.parts[0].preview.includes('/a'));
  });

  test('flags the injected session preamble as a notice', () => {
    const item = toItem(gem.user('<session_context>contexte injecte</session_context>'), descriptor);
    assert.equal(item.isNotice, true, 'the harness wrote this, not the person');
  });

  test('falls back to the session start when a turn has no timestamp', () => {
    const raw = gem.user('x');
    delete raw.timestamp;
    assert.equal(toItem(raw, descriptor).timestamp, '2026-06-27T22:10:00.000Z');
  });

  test('skips anything empty or unknown', () => {
    assert.equal(toItem(gem.user(''), descriptor), null);
    assert.equal(toItem({ type: 'autre', content: 'x' }, descriptor), null);
    assert.equal(toItem(null, descriptor), null);
  });
});

// ── the mutation log ────────────────────────────────────────────────────────

test.describe('$set replays as replacement, never as accumulation', () => {
  test('the last $set wins outright', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const first = [gem.user('un'), gem.model('deux')];
    const second = [...first, gem.user('trois')];

    fx.gemini()
      .projectRoot('projet', '/home/zam/projet')
      .log('projet', 'aaaa1111', [gem.set(first), gem.touch(), gem.set(second)]);

    const [d] = await collect(adapter.discover(ctx));
    const texts = (await readAll(d)).map((i) => i.text);

    // Appending instead of replacing would yield five messages, not three.
    assert.deepEqual(texts, ['un', 'deux', 'trois']);
  });

  test('a $set carrying no messages leaves the list alone', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini()
      .projectRoot('p', '/p')
      .log('p', 'bbbb2222', [gem.set([gem.user('seul')]), gem.touch(), gem.touch()]);

    const [d] = await collect(adapter.discover(ctx));
    assert.deepEqual((await readAll(d)).map((i) => i.text), ['seul']);
  });

  test('bare appended turns are added after the last replacement', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini()
      .projectRoot('p', '/p')
      .log('p', 'cccc3333', [gem.set([gem.user('depuis set')]), gem.user('ajoute apres')]);

    const [d] = await collect(adapter.discover(ctx));
    assert.deepEqual((await readAll(d)).map((i) => i.text), ['depuis set', 'ajoute apres']);
  });

  test('replayLog survives a malformed line', async (t) => {
    const { fx, teardown } = setup();
    t.after(teardown);

    const tree = fx.gemini().projectRoot('p', '/p');
    tree.log('p', 'dddd4444', [gem.set([gem.user('valide')])]);

    const file = require('path').join(
      tree.home, 'tmp', 'p', 'chats', 'session-2026-06-27T22-10-dddd4444.jsonl'
    );
    require('fs').appendFileSync(file, 'PAS DU JSON\n');

    assert.equal((await replayLog(file)).length, 1);
  });

  test('never resumes: a partial read would apply $set to a state we lost', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini().projectRoot('p', '/p').log('p', 'eeee5555', [gem.set([gem.user('x')])]);
    const [d] = await collect(adapter.discover(ctx));
    assert.equal(adapter.canResume(d, '0'), false);
  });
});

// ── discovery ───────────────────────────────────────────────────────────────

test.describe('adapter', () => {
  test('detects its data directory', (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    assert.equal(adapter.detect(ctx), false);
    fx.gemini().bare('p');
    assert.equal(adapter.detect(ctx), true);
  });

  // projects.json maps DIRECTORY -> slug, so it must be read backwards.
  test('inverts projects.json to turn a slug into a path', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini()
      .projects({ '/home/zam/Programmation/c64/Arena64': 'arena64' })
      .log('arena64', 'ffff6666', [gem.set([gem.user('x')])]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/Programmation/c64/Arena64');
    assert.equal(d.folderExact, true);
  });

  test('falls back to .project_root when projects.json is absent', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini()
      .projectRoot('sant-debate', '/home/zam/Documents/Véro/santé-debate')
      .log('sant-debate', 'aaaa7777', [gem.set([gem.user('x')])]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/Documents/Véro/santé-debate', 'accents survive');
  });

  // history/<slug>/ looks like the transcript store and holds only .project_root.
  test('ignores the history/ decoy entirely', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini().decoyHistory('leurre', '/home/zam/leurre');
    assert.deepEqual(await collect(adapter.discover(ctx)), []);
  });

  test('reads the legacy snapshot format too', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini()
      .projectRoot('p', '/p')
      .snapshot('p', 'bbbb8888', [gem.user('ancien prompt'), gem.model('ancienne reponse')]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.legacy, true);
    assert.deepEqual((await readAll(d)).map((i) => i.text), ['ancien prompt', 'ancienne reponse']);
  });

  test('a session whose folder is unknown says so rather than guessing', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini().log('orphelin', 'cccc9999', [gem.set([gem.user('x')])]);
    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, null);
    assert.equal(d.folderExact, false);
  });

  test('skips a tmp entry with no chats level', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.gemini().bare('vide').projectRoot('plein', '/p').log('plein', 'dddd0000', [gem.set([gem.user('x')])]);
    assert.equal((await collect(adapter.discover(ctx))).length, 1);
  });

  test('yields nothing rather than throwing on a missing directory', async () => {
    const ctx = { env: { GEMINI_CONFIG_DIR: '/nope/does/not/exist' } };
    assert.equal(adapter.detect(ctx), false);
    assert.deepEqual(await collect(adapter.discover(ctx)), []);
  });

  test('survives a corrupt legacy snapshot', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const tree = fx.gemini().projectRoot('p', '/p');
    tree.snapshot('p', 'eeee1111', []);
    require('fs').writeFileSync(
      require('path').join(tree.home, 'tmp', 'p', 'chats', 'session-2026-04-21T10-00-eeee1111.json'),
      '{ casse'
    );

    const [d] = await collect(adapter.discover(ctx));
    assert.deepEqual(await readAll(d), []);
  });
});
