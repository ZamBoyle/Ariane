'use strict';

/**
 * Copilot CLI adapter tests.
 *
 * As with the other adapters, every case comes from something measured on a
 * real corpus rather than from documentation. The traps here are quieter than
 * Codex's but just as costly: a wrapped copy of the prompt that is not what the
 * person typed, 200 assistant records carrying no prose at all, and six session
 * directories with no log that would simply vanish if discovery required one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const adapter = require('../src/core/agents/copilot-cli');
const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const { extractCopilotRecord } = require('../src/core/agents/copilot-extract');
const { createFixture, cop, resetCounters } = require('./helpers/fixture');

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

const prose = (chunks) =>
  chunks.map((c) => c.item).filter((i) => i.kind === 'message' && !i.isNotice && i.text);

// ── extraction ──────────────────────────────────────────────────────────────

test.describe('record extraction', () => {
  test('the speaker comes from the event type, not a role field', () => {
    assert.equal(extractCopilotRecord(cop.user('salut')).role, 'user');
    assert.equal(extractCopilotRecord(cop.assistant('bonjour')).role, 'assistant');
  });

  // transformedContent wraps the prompt in an injected preamble: indexing it
  // would attribute ~166 bytes of text the person never wrote.
  test('reads data.content and never transformedContent', () => {
    const item = extractCopilotRecord(cop.user('ma vraie question'));
    assert.equal(item.text, 'ma vraie question');
    assert.ok(!JSON.stringify(item).includes('<preamble/>'));
  });

  test('takes cwd, git root and branch from session.start', () => {
    const item = extractCopilotRecord(cop.start('/home/zam/Documents/Véro/santé-debate'));
    assert.equal(item.kind, 'meta');
    assert.equal(item.cwd, '/home/zam/Documents/Véro/santé-debate');
    assert.equal(item.gitBranch, 'main');
  });

  test('drops the static system prompt, which is a tenth of all bytes', () => {
    const item = extractCopilotRecord(cop.systemPrompt());
    assert.equal(item.kind, 'ignored');
    assert.equal(item.reason, 'known-noise');
  });

  test('drops assistant records that carry neither prose nor tools', () => {
    assert.equal(extractCopilotRecord(cop.assistant('')).kind, 'ignored');
    assert.equal(extractCopilotRecord(cop.assistant('   ')).kind, 'ignored');
  });

  test('keeps an assistant record that carries only tool requests', () => {
    const item = extractCopilotRecord(cop.assistantToolsOnly('bash', '{"cmd":"ls"}'));
    assert.equal(item.kind, 'message');
    assert.equal(item.text, '');
    assert.equal(item.parts[0].type, 'tool_use');
    assert.equal(item.parts[0].name, 'bash');
  });

  test('reasoning is kept for display but never becomes indexed text', () => {
    const item = extractCopilotRecord(cop.assistant('reponse', { reasoningText: 'raisonnement' }));
    assert.equal(item.text, 'reponse');
    assert.equal(item.thinking, 'raisonnement');
    assert.ok(item.parts.some((p) => p.type === 'thinking'));
  });

  test('tool execution becomes a truncated preview, in and out', () => {
    const start = extractCopilotRecord(cop.toolStart('bash', '{"cmd":"ls -la"}'));
    assert.equal(start.part.type, 'tool_use');
    assert.ok(start.part.preview.includes('ls -la'));

    const done = extractCopilotRecord(cop.toolDone('x'.repeat(50000)));
    assert.equal(done.part.type, 'tool_result');
    assert.ok(done.part.preview.length < 2100);
    assert.ok(done.part.preview.endsWith('…'));
  });

  test('a failed tool says so', () => {
    assert.equal(extractCopilotRecord(cop.toolDone('boom', true)).part.isError, true);
  });

  test('a tool-generated user message is a notice, not the person speaking', () => {
    const item = extractCopilotRecord(cop.user('texte injecte', { source: 'system' }));
    assert.equal(item.isNotice, true);
  });

  test('lifecycle events are ignored', () => {
    for (const type of ['assistant.turn_start', 'assistant.turn_end', 'permission.requested']) {
      assert.equal(extractCopilotRecord(cop.noise(type)).kind, 'ignored');
    }
  });

  test('tolerates garbage', () => {
    for (const bad of [null, undefined, 42, 'str', [], {}]) {
      assert.equal(extractCopilotRecord(bad).kind, 'ignored');
    }
  });
});

// ── discovery and reading ───────────────────────────────────────────────────

test.describe('adapter', () => {
  test('detects its data directory', (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    assert.equal(adapter.detect(ctx), false);
    fx.copilot().session('u1', [cop.start('/p')]);
    assert.equal(adapter.detect(ctx), true);
  });

  test('discovers a session with its exact folder and branch', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.copilot().session('aaaa-1', [cop.start('/home/zam/repos/1541Ultimate'), cop.user('salut')]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/repos/1541Ultimate');
    assert.equal(d.folderExact, true);
    assert.equal(d.gitBranch, 'main');
  });

  // Six of twenty-three real directories are in this state.
  test('a session with no log is still surfaced, using workspace.yaml alone', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.copilot().withoutLog('bbbb-2', {
      cwd: '/home/zam/orphelin',
      branch: 'master',
      name: 'Une question posee',
    });

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/orphelin');
    assert.equal(d.folderExact, true, 'the yaml is an exact source too');
    assert.equal(d.title, 'Une question posee');
    assert.equal(d.logFile, null);
    assert.equal(d.fingerprint, 'no-log');

    assert.deepEqual(await collect(adapter.read(d, { cursor: null })), [], 'nothing to read');
    assert.equal(adapter.canResume(d, '0'), false);
  });

  test('reads a conversation and skips the machinery', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.copilot().session('cccc-3', [
      cop.start('/p'),
      cop.systemPrompt(),
      cop.user('ma question'),
      cop.noise(),
      cop.assistantToolsOnly('bash', '{}'),
      cop.toolStart('bash', '{}'),
      cop.toolDone('resultat'),
      cop.assistant('ma reponse'),
      cop.noise('assistant.turn_end'),
    ]);

    const [d] = await collect(adapter.discover(ctx));
    const chunks = await collect(adapter.read(d, { cursor: null }));

    assert.deepEqual(prose(chunks).map((m) => m.text), ['ma question', 'ma reponse']);
    const parts = chunks.flatMap((c) => c.item.parts || []).map((p) => p.type);
    assert.ok(parts.includes('tool_use'));
    assert.ok(parts.includes('tool_result'));
  });

  test('carries the branch onto every message', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.copilot().session('dddd-4', [cop.start('/p'), cop.user('x')]);
    const [d] = await collect(adapter.discover(ctx));
    const [first] = prose(await collect(adapter.read(d, { cursor: null })));
    assert.equal(first.gitBranch, 'main');
  });

  test('resumes from a cursor without replaying', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const tree = fx.copilot();
    tree.session('eeee-5', [cop.start('/p'), cop.user('avant')]);

    const [first] = await collect(adapter.discover(ctx));
    const cursor = (await collect(adapter.read(first, { cursor: null }))).at(-1).cursor;

    tree.append('eeee-5', [cop.assistant('apres')]);

    const [second] = await collect(adapter.discover(ctx));
    assert.notEqual(second.fingerprint, first.fingerprint);
    assert.equal(adapter.canResume(second, cursor), true);
    assert.deepEqual(prose(await collect(adapter.read(second, { cursor }))).map((m) => m.text), ['apres']);
  });

  test('refuses to resume past the end of a rewritten log', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.copilot().session('ffff-6', [cop.start('/p')]);
    const [d] = await collect(adapter.discover(ctx));
    assert.equal(adapter.canResume(d, String(d.bytes + 500)), false);
  });

  test('parses quoted and unquoted workspace values', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.copilot().withoutLog('gggg-7', { cwd: '"/home/zam/avec espaces"', name: "'Un titre'" });
    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/avec espaces');
    assert.equal(d.title, 'Un titre');
  });

  test('yields nothing rather than throwing on a missing directory', async () => {
    const ctx = { env: { COPILOT_HOME: '/nope/does/not/exist' } };
    assert.equal(adapter.detect(ctx), false);
    assert.deepEqual(await collect(adapter.discover(ctx)), []);
  });

  test('survives a session directory with neither log nor workspace', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const tree = fx.copilot();
    require('fs').mkdirSync(tree.dir('hhhh-8'), { recursive: true });

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.sessionId, 'hhhh-8', 'the directory name is the last resort');
    assert.equal(d.folderPath, null, 'an unknown folder is admitted, never guessed');
    assert.equal(d.folderExact, false);
  });
});

/** Same collision as Codex: `toolCallId` is reused by start and complete. */
test('a tool call and its result do not collide on one uuid', async (t) => {
  const { fx, ctx, teardown } = setup();
  t.after(teardown);

  fx.copilot().session('zzzz-9', [
    cop.start('/p'),
    cop.toolStart('bash', '{"cmd":"ls"}'),
    cop.toolDone('README.md'),
  ]);

  const [d] = await collect(adapter.discover(ctx));
  const items = (await collect(adapter.read(d, { cursor: null }))).map((c) => c.item);

  const uuids = items.filter((i) => i.kind === 'message').map((i) => i.uuid);
  assert.equal(new Set(uuids).size, uuids.length, `uuids collide: ${uuids.join(', ')}`);

  const kinds = items.flatMap((i) => i.parts || []).map((p) => p.type);
  assert.ok(kinds.includes('tool_use') && kinds.includes('tool_result'));
});

// ── which model answered, and what the conversation is called ─────────────
//
// Measured on 18 real conversations (24 September 2026): 269 replies of 283
// name their own model, the other 14 — two conversations on gpt-5.4 — only in
// session.model_change; and 7 titles read "|-", workspace.yaml's block marker.

const modelChange = (newModel) => ({
  type: 'session.model_change',
  id: 'e-change',
  timestamp: '2026-06-21T18:00:00.000Z',
  data: { previousModel: 'kimi-k3', newModel },
});

test.describe('model', () => {
  test('a reply naming its own model keeps it', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    fx.copilot().session('m1', [
      cop.start('/p'),
      cop.user('q'),
      cop.assistant('r', { model: 'kimi-k3' }),
    ]);
    const [d] = await collect(adapter.discover(ctx));
    assert.deepEqual(
      prose(await collect(adapter.read(d, { cursor: null })))
        .filter((m) => m.role === 'assistant')
        .map((m) => m.model),
      ['kimi-k3']
    );
  });

  test('a reply without one gets the model in use: selected at start, then changed', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    fx.copilot().session('m2', [
      cop.start('/p'), // selectedModel: gpt-5
      cop.user('q1'),
      cop.assistant('r1', { model: '' }),
      modelChange('gpt-5.4'),
      cop.user('q2'),
      cop.assistant('r2', { model: '' }),
    ]);
    const [d] = await collect(adapter.discover(ctx));
    const replies = prose(await collect(adapter.read(d, { cursor: null }))).filter(
      (m) => m.role === 'assistant'
    );
    assert.deepEqual(
      replies.map((m) => m.model),
      ['gpt-5', 'gpt-5.4']
    );
  });

  test('a resumed pass still knows the model in use', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    const tree = fx.copilot();
    tree.session('m3', [
      cop.start('/p'),
      modelChange('gpt-5.4'),
      cop.assistant('r1', { model: '' }),
    ]);
    const [first] = await collect(adapter.discover(ctx));
    const cursor = (await collect(adapter.read(first, { cursor: null }))).at(-1).cursor;

    tree.append('m3', [cop.assistant('r2', { model: '' })]);
    const [second] = await collect(adapter.discover(ctx));
    assert.equal(
      adapter.canResume(second, cursor),
      true,
      'a cursor carrying a model is still an offset'
    );
    const resumed = prose(await collect(adapter.read(second, { cursor })));
    assert.deepEqual(
      resumed.map((m) => m.model),
      ['gpt-5.4']
    );
  });

  test('what the person typed carries no model', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    fx.copilot().session('m4', [cop.start('/p'), cop.user('q')]);
    const [d] = await collect(adapter.discover(ctx));
    const [question] = prose(await collect(adapter.read(d, { cursor: null })));
    assert.equal(question.model, '');
  });
});

// ── tokens ──────────────────────────────────────────────────────────────────
//
// Copilot writes no count per reply. Its only count is a RUNNING total, at each
// session.shutdown: 23 real ones, 4 without tokenDetails, and one session that
// wrote the same total three times before growing it on resume.

const usagesOf = (chunks) => chunks.map((c) => c.item).filter((i) => i.kind === 'usage');

test.describe('tokens', () => {
  test('a shutdown carries the running total, split as the contract splits it', () => {
    const record = cop.shutdown({ input: 2, cacheWrite: 24107, output: 211, reasoning: 40 });
    record.data.modelMetrics['kimi-k3'] = { usage: { reasoningTokens: 60 } };
    const item = extractCopilotRecord(record);
    assert.equal(item.kind, 'usage');
    assert.deepEqual(item.total, {
      input: 2,
      cacheRead: 0,
      cacheWrite: 24107,
      output: 211,
      reasoning: 100,
    });
  });

  test('a shutdown without counts is known noise', () => {
    const item = extractCopilotRecord({ type: 'session.shutdown', id: 'e', data: {} });
    assert.equal(item.kind, 'ignored');
    assert.equal(item.reason, 'known-noise');
  });

  test('each shutdown counts what grew since the last, and a repeat counts nothing', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    fx.copilot().session('t1', [
      cop.start('/p'),
      cop.user('q1'),
      cop.assistant('r1'),
      cop.shutdown({ input: 100, cacheRead: 50, output: 10 }),
      cop.shutdown({ input: 100, cacheRead: 50, output: 10 }), // resumed, nothing said
      cop.user('q2'),
      cop.assistant('r2'),
      cop.shutdown({ input: 160, cacheRead: 250, output: 25, reasoning: 5 }),
    ]);
    const [d] = await collect(adapter.discover(ctx));
    const usages = usagesOf(await collect(adapter.read(d, { cursor: null })));
    assert.deepEqual(
      usages.map((u) => u.usage),
      [
        { input: 100, output: 10, cacheRead: 50, cacheWrite: 0, reasoning: 0 },
        { input: 60, output: 15, cacheRead: 200, cacheWrite: 0, reasoning: 5 },
      ],
      'two differences, never the running total twice'
    );
  });

  test('a total that falls back is a counter starting over, and counts whole', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    fx.copilot().session('t2', [
      cop.start('/p'),
      cop.assistant('r1'),
      cop.shutdown({ input: 100, output: 10 }),
      cop.assistant('r2'),
      cop.shutdown({ input: 30, output: 4 }),
    ]);
    const [d] = await collect(adapter.discover(ctx));
    const usages = usagesOf(await collect(adapter.read(d, { cursor: null })));
    assert.deepEqual(
      usages.map((u) => u.usage.output),
      [10, 4]
    );
  });

  test('a resumed pass remembers the last total', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    const tree = fx.copilot();
    tree.session('t3', [
      cop.start('/p'),
      cop.assistant('r1'),
      cop.shutdown({ input: 100, output: 10 }),
      cop.user('q2'), // the pass stops after the shutdown, not on it
    ]);
    const [first] = await collect(adapter.discover(ctx));
    const cursor = (await collect(adapter.read(first, { cursor: null }))).at(-1).cursor;

    tree.append('t3', [cop.assistant('r2'), cop.shutdown({ input: 130, output: 18 })]);
    const [second] = await collect(adapter.discover(ctx));
    assert.equal(
      adapter.canResume(second, cursor),
      true,
      'a cursor carrying a total is still an offset'
    );
    const resumed = await collect(adapter.read(second, { cursor }));
    assert.deepEqual(
      usagesOf(resumed).map((u) => [u.usage.input, u.usage.output]),
      [[30, 8]]
    );
    assert.deepEqual(
      prose(resumed).map((m) => m.model),
      ['gpt-5'],
      'and the model still rides along'
    );
  });

  test('a half-written shutdown is not counted: it will be read whole next time', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    const tree = fx.copilot();
    tree.session('t4', [cop.start('/p'), cop.assistant('r')]);
    fs.appendFileSync(
      path.join(tree.dir('t4'), 'events.jsonl'),
      JSON.stringify(cop.shutdown({ input: 100, output: 10 })) // no newline yet
    );
    const [d] = await collect(adapter.discover(ctx));
    const chunks = await collect(adapter.read(d, { cursor: null }));
    assert.equal(usagesOf(chunks).length, 0);
    assert.ok(
      Number(chunks.at(-1).cursor.split(';')[0]) < d.bytes,
      'and the cursor stops before it'
    );
  });

  test('through the indexer, a conversation carries its last total exactly', async (t) => {
    const { fx, teardown } = setup();
    const index = new Index(':memory:');
    t.after(() => {
      index.close();
      teardown();
    });
    fx.copilot().session('t5', [
      cop.start('/home/ada/p'),
      cop.user('q1'),
      cop.assistant('r1'),
      cop.shutdown({ input: 24216, cacheRead: 56960, output: 1882, reasoning: 832 }),
      cop.shutdown({ input: 24216, cacheRead: 56960, output: 1882, reasoning: 832 }),
      cop.user('q2'),
      cop.assistant('r2'),
      cop.shutdown({ input: 57295, cacheRead: 155648, output: 5798, reasoning: 1984 }),
    ]);
    await new Indexer(index, { env: fx.env, adapters: [adapter] }).run();
    const [session] = index.sessions(index.folderId('/home/ada/p'));
    assert.equal(session.tokInput, 57295, 'the last total, not the sum of the three');
    assert.equal(session.tokCacheRead, 155648);
    assert.equal(session.tokOutput, 5798);
  });
});

test.describe('title from workspace.yaml', () => {
  const titleOf = async (t, name) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    fx.copilot().session('w1', [cop.start('/p'), cop.user('q')], { name });
    const [d] = await collect(adapter.discover(ctx));
    return d.title;
  };

  test('a block value is the text under it, not its "|-" marker', async (t) => {
    const title = await titleOf(
      t,
      '|-\n  Lis le brief puis réponds.\n\n  Deuxième paragraphe.\nuser_named: false'
    );
    assert.equal(title, 'Lis le brief puis réponds.');
  });

  test('a folded block, ">", is read the same way', async (t) => {
    assert.equal(await titleOf(t, '>-\n  Une seule idée\nsummary_count: 0'), 'Une seule idée');
  });

  test('an apostrophe doubled inside single quotes is one apostrophe', async (t) => {
    assert.equal(await titleOf(t, "'réalise l''audit d''import'"), "réalise l'audit d'import");
  });

  test('a prompt opening on a Markdown heading loses its hashes', async (t) => {
    assert.equal(
      await titleOf(t, '|-\n  # ANALYSE APPROFONDIE — dossier\n  suite'),
      'ANALYSE APPROFONDIE — dossier'
    );
  });

  test('a plain value is untouched', async (t) => {
    assert.equal(
      await titleOf(t, "Que penses-tu de ce code ? L'idée ?"),
      "Que penses-tu de ce code ? L'idée ?"
    );
  });
});
