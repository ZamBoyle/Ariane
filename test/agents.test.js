'use strict';

/**
 * Contract-level tests.
 *
 * These are the tests every future adapter must also pass. When Codex, Gemini,
 * Qwen or the VS Code adapters land, `conformsToContract` below runs against
 * each of them unchanged — that is the point of having a contract at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertAdapter, globalSessionId } = require('../src/core/agents/contract');
const registry = require('../src/core/agents');
const { Memo } = require('../src/core/memo');
const claude = require('../src/core/agents/claude');
const {
  createFixture, isolatedEnv, records, cdx, cop, qwn, gem, vsc, agy, resetCounters,
} = require('./helpers/fixture');

// ── the contract itself ─────────────────────────────────────────────────────

test.describe('assertAdapter', () => {
  const valid = () => ({
    id: 'demo',
    label: 'Demo',
    root: () => '/tmp',
    detect: () => true,
    discover: async function* () {},
    read: async function* () {},
  });

  test('accepts a complete adapter', () => {
    assert.equal(assertAdapter(valid()).id, 'demo');
  });

  test('rejects a missing field, naming it', () => {
    const broken = valid();
    delete broken.discover;
    assert.throws(() => assertAdapter(broken), /discover/);
  });

  test('rejects a field of the wrong type', () => {
    assert.throws(() => assertAdapter({ ...valid(), read: 'nope' }), /read must be a function/);
  });

  test('rejects an id that is not a slug', () => {
    for (const id of ['Claude', 'claude code', '1claude', '']) {
      assert.throws(() => assertAdapter({ ...valid(), id }), /id|missing/);
    }
  });

  test('rejects a non-object', () => {
    assert.throws(() => assertAdapter(null), /must be an object/);
  });
});

test('session ids are namespaced by agent', () => {
  assert.equal(globalSessionId('claude', 'abc'), 'claude:abc');
  assert.equal(globalSessionId('codex', 'abc'), 'codex:abc');
});

// ── the registry ────────────────────────────────────────────────────────────

test.describe('registry', () => {
  test('every registered adapter satisfies the contract', () => {
    for (const adapter of registry.all()) assert.doesNotThrow(() => assertAdapter(adapter));
  });

  test('ids are unique', () => {
    const ids = registry.all().map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('lookup by id', () => {
    assert.equal(registry.byId('claude').label, 'Claude Code');
    assert.equal(registry.byId('inexistant'), null);
  });

  test('available() filters on detection and survives a throwing detect', () => {
    const ctx = { env: isolatedEnv() };
    assert.deepEqual(registry.available(ctx).map((a) => a.id), []);
  });
});

// ── the Claude adapter, as the reference implementation ─────────────────────

/** Drain an async iterable into an array. */
async function collect(iterable) {
  const out = [];
  for await (const value of iterable) out.push(value);
  return out;
}

function setup() {
  resetCounters();
  const fx = createFixture();
  return { fx, ctx: { env: fx.env }, teardown: () => fx.cleanup() };
}

test.describe('claude adapter', () => {
  test('detects its data directory', (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    // The fixture creates projects/ up front, which is what detection looks for.
    assert.equal(claude.detect(ctx), true);
    assert.equal(claude.root(ctx), fx.root);
    assert.equal(claude.detect({ env: isolatedEnv() }), false);
  });

  test('discovers transcripts with an exact folder path', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.project('-home-zam-Documents-Math-matiques', {
      originalPath: '/home/zam/Documents/Mathématiques',
    }).session('s1', [records.userText('salut')]);

    const [descriptor] = await collect(claude.discover(ctx));
    assert.equal(descriptor.sessionId, 's1');
    assert.equal(descriptor.folderPath, '/home/zam/Documents/Mathématiques');
    assert.equal(descriptor.folderExact, true);
    assert.match(descriptor.fingerprint, /^\d+:\d+$/);
    assert.ok(descriptor.bytes > 0);
  });

  test('falls back to cwd, then flags the lossy hint', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.project('-a').session('s1', [records.userText('x', { cwd: '/real/path' })]);
    fx.project('-b-c').session('s2', [records.userText('x', { cwd: undefined })]);

    const found = Object.fromEntries(
      (await collect(claude.discover(ctx))).map((d) => [d.sessionId, d])
    );
    assert.equal(found.s1.folderPath, '/real/path');
    assert.equal(found.s1.folderExact, true);
    assert.equal(found.s2.folderPath, '/b/c');
    assert.equal(found.s2.folderExact, false, 'an approximation must say so');
  });

  test('reads messages and advances the cursor', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.aiTitle('Un titre'),
      records.userText('premier'),
      records.assistantText('second'),
    ]);

    const [descriptor] = await collect(claude.discover(ctx));
    const chunks = await collect(claude.read(descriptor, { cursor: null, ctx }));

    const kinds = chunks.map((c) => c.item.kind);
    assert.deepEqual(kinds, ['title', 'message', 'message']);
    assert.equal(chunks[0].item.title, 'Un titre');
    assert.deepEqual(
      chunks.filter((c) => c.item.kind === 'message').map((c) => c.item.text),
      ['premier', 'second']
    );

    const cursors = chunks.map((c) => Number(c.cursor));
    assert.ok(cursors.every((n, i) => i === 0 || n > cursors[i - 1]), 'cursor must advance');
  });

  test('resumes from a cursor without replaying', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const project = fx.project('-p', { originalPath: '/p' });
    project.session('s1', [records.userText('avant')]);

    const [first] = await collect(claude.discover(ctx));
    const firstPass = await collect(claude.read(first, { cursor: null, ctx }));
    const cursor = firstPass.at(-1).cursor;

    project.append('s1', [records.assistantText('apres')]);

    const [second] = await collect(claude.discover(ctx));
    assert.notEqual(second.fingerprint, first.fingerprint, 'fingerprint must change');

    const resumed = await collect(claude.read(second, { cursor, ctx }));
    assert.deepEqual(resumed.map((c) => c.item.text), ['apres']);
  });

  test('does not advance the cursor past a half-written line', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const complete = JSON.stringify({
      sessionId: 's1', type: 'user', uuid: 'u1', cwd: '/p',
      message: { role: 'user', content: 'complet' },
    });
    fx.project('-p', { originalPath: '/p' }).raw('s1', `${complete}\n{"type":"user","mess`);

    const [descriptor] = await collect(claude.discover(ctx));
    const chunks = await collect(claude.read(descriptor, { cursor: null, ctx }));

    const messages = chunks.filter((c) => c.item.kind === 'message');
    assert.equal(messages.length, 1);
    assert.equal(Number(messages.at(-1).cursor), complete.length + 1);
  });

  test('surfaces history-only sessions, and never shadows a real transcript', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.project('-p', { originalPath: '/p' }).session('vivante', [records.userText('transcript')]);
    fx.history([
      { display: 'prompt perdu', project: '/home/zam/gone', sessionId: 'fantome', timestamp: 1765054827534 },
      { display: 'autre', project: '/home/zam/gone', sessionId: 'fantome', timestamp: 1765054867417 },
      { display: 'doublon', project: '/p', sessionId: 'vivante', timestamp: 1 },
    ]);

    const found = await collect(claude.discover(ctx));
    const ghost = found.find((d) => d.sessionId === 'fantome');
    assert.ok(ghost, 'the purged session must be discovered');
    assert.equal(ghost.folderPath, '/home/zam/gone');
    assert.equal(found.filter((d) => d.sessionId === 'vivante').length, 1, 'no duplicate');

    const chunks = await collect(claude.read(ghost, { cursor: null, ctx }));
    assert.deepEqual(chunks.map((c) => c.item.text), ['prompt perdu', 'autre']);
    assert.ok(chunks.every((c) => c.item.role === 'user'));
  });

  test('yields nothing rather than throwing on a missing directory', async () => {
    const ctx = { env: isolatedEnv() };
    assert.deepEqual(await collect(claude.discover(ctx)), []);
    assert.equal(claude.detect(ctx), false);
  });
});

// ── the shared conformance suite ────────────────────────────────────────────

/**
 * Structural checks every adapter must satisfy, whatever it reads. Future
 * adapters are added to this list and must pass without the suite changing.
 */
/**
 * Give EVERY adapter something to find.
 *
 * Without this the suite was theatre: `setup()` built a Claude project only, so
 * `discover()` yielded nothing for the other five and the assertion loop never
 * ran once. Five tests passed having checked nothing at all — which is why the
 * defects an eight-dimension audit later found had a clear path through.
 */
function populate(fx) {
  fx.project('-p', { originalPath: '/p' }).session('s1', [
    records.userText('a'),
    records.assistantText('b'),
  ]);

  fx.codex().session('11111111-1111-1111-1111-111111111111', [
    cdx.meta('/p'),
    cdx.message('user', 'a'),
    cdx.message('assistant', 'b'),
    cdx.toolCall('shell', { command: 'ls' }),
    cdx.toolOutput('ok'),
  ]);

  fx.copilot().session('cop-1', [
    cop.start('/p'),
    cop.user('a'),
    cop.assistant('b'),
    cop.toolStart('bash', '{}'),
    cop.toolDone('ok'),
  ]);

  fx.qwen().session('-p', 'q1', [qwn.user('a'), qwn.model('b')]);

  fx.gemini()
    .projectRoot('p', '/p')
    .log('p', 'gem1', [gem.set([gem.user('a'), gem.model('b')])]);

  fx.antigravity()
    .session('ag1', [agy.user('a'), agy.model('b'), agy.tool('ok')])
    .summary('ag1', '/p');

  fx.vscode()
    .workspace('h1', '/p')
    .snapshot('h1', 'vs1', vsc.session([vsc.request('a', [vsc.markdown('b')])]));
}

test.describe('contract conformance', () => {
  for (const adapter of registry.all()) {
    test(`${adapter.id}: descriptors are well formed`, async (t) => {
      const { fx, ctx, teardown } = setup();
      t.after(teardown);

      populate(fx);

      let seen = 0;
      for (const d of await collect(adapter.discover(ctx))) {
        seen += 1;
        assert.equal(typeof d.sessionId, 'string', 'sessionId');
        assert.ok(d.sessionId.length > 0, 'sessionId not empty');
        assert.equal(typeof d.key, 'string', 'key');
        assert.equal(typeof d.fingerprint, 'string', 'fingerprint');
        assert.ok(d.folderPath === null || typeof d.folderPath === 'string', 'folderPath');

        for (const { item, cursor } of await collect(adapter.read(d, { cursor: null, ctx }))) {
          assert.ok(
            ['message', 'title', 'summary', 'ignored'].includes(item.kind),
            `unknown kind "${item.kind}"`
          );
          assert.ok(cursor === null || typeof cursor === 'string', 'cursor');
          if (item.kind === 'message') {
            assert.ok(['user', 'assistant'].includes(item.role), `role "${item.role}"`);
            assert.equal(typeof item.text, 'string', 'text');
            assert.ok(Array.isArray(item.parts), 'parts');
            assert.equal(typeof item.timestamp, 'string', 'timestamp');
            assert.equal(typeof item.isNotice, 'boolean', 'isNotice');
          }
        }
      }

      // The guard that stops this suite ever again passing by checking nothing.
      assert.ok(seen > 0, `${adapter.id} yielded no descriptor — the suite would assert nothing`);
    });
  }

  // The memo is what makes a background pass every 30 s cost nothing. Every
  // adapter reads something per file during discovery; on a second pass over
  // unchanged files, none of it may be read again — and the answer must be
  // exactly the one given without a memo at all.
  for (const adapter of registry.all()) {
    test(`${adapter.id}: an unchanged second pass reads nothing again`, async (t) => {
      const { fx, ctx, teardown } = setup();
      t.after(teardown);
      populate(fx);

      const memo = new Memo();
      const withMemo = { ...ctx, memo };
      const first = await collect(adapter.discover(withMemo));
      const computed = memo.misses;
      const second = await collect(adapter.discover(withMemo));

      assert.ok(computed > 0, `${adapter.id} reads nothing through the memo`);
      assert.equal(memo.misses, computed, `${adapter.id} re-read an unchanged file`);
      assert.ok(memo.hits >= computed, 'every answer came from the memo');
      assert.deepEqual(second, first, 'the same descriptors');
      assert.deepEqual(second, await collect(adapter.discover(ctx)), 'the same as with no memo');
    });
  }

  // A uuid collision between a tool call and its result silently cost 6607
  // messages across two adapters. The contract now says so out loud.
  test('no adapter gives two messages of one session the same uuid', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    populate(fx);

    for (const adapter of registry.all()) {
      for (const d of await collect(adapter.discover(ctx))) {
        const uuids = (await collect(adapter.read(d, { cursor: null, ctx })))
          .map((c) => c.item)
          .filter((i) => i.kind === 'message' && i.uuid)
          .map((i) => i.uuid);
        assert.equal(
          new Set(uuids).size,
          uuids.length,
          `${adapter.id} repeats a uuid: ${uuids.join(', ')}`
        );
      }
    }
  });
});
