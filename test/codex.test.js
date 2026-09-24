'use strict';

/**
 * Codex adapter tests.
 *
 * Every case here comes from something the reconnaissance measured on a real
 * 416 MB corpus, not from reading documentation — there is none. The traps are
 * what this file exists for: a mirrored stream that would double-count every
 * turn, three coexisting envelope generations, 25 MB of base64 hidden in image
 * parts, and 78 legacy files whose folder is genuinely unrecoverable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../src/core/agents/' + 'cod' + 'ex');
const { extractCodexRecord } = require('../src/core/agents/' + 'cod' + 'ex-extract');
const { createFixture, cdx, resetCounters } = require('./helpers/fixture');

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

const messagesOf = (chunks) =>
  chunks.map((c) => c.item).filter((i) => i.kind === 'message' && !i.isNotice);

// ── extraction ──────────────────────────────────────────────────────────────

test.describe('record extraction', () => {
  test('reads a turn from the current envelope', () => {
    const item = extractCodexRecord(cdx.message('user', 'Bonjour'));
    assert.equal(item.kind, 'message');
    assert.equal(item.role, 'user');
    assert.equal(item.text, 'Bonjour');
  });

  test('reads the intermediate envelope, which has no ordinal', () => {
    const item = extractCodexRecord(cdx.messageNoOrdinal('assistant', 'Salut'));
    assert.equal(item.kind, 'message');
    assert.equal(item.text, 'Salut');
  });

  test('reads the oldest generation, where the item is unwrapped', () => {
    const item = extractCodexRecord(cdx.bare('user', 'Ancien format'));
    assert.equal(item.kind, 'message');
    assert.equal(item.role, 'user');
    assert.equal(item.text, 'Ancien format');
  });

  test('takes the working directory from session_meta, verbatim', () => {
    const item = extractCodexRecord(cdx.meta('/home/zam/Documents/Mathématiques', 'abc'));
    assert.equal(item.kind, 'meta');
    assert.equal(item.cwd, '/home/zam/Documents/Mathématiques');
    assert.equal(item.sessionId, 'abc');
  });

  // THE trap: event_msg mirrors response_item. Reading both doubles everything.
  test('ignores the event_msg mirror stream', () => {
    const item = extractCodexRecord(cdx.eventMsg('texte deja compte ailleurs'));
    assert.equal(item.kind, 'ignored');
    assert.equal(item.reason, 'known-noise');
  });

  test('ignores compaction replays', () => {
    const item = extractCodexRecord(cdx.compacted([{ role: 'user', content: 'ancien' }]));
    assert.equal(item.kind, 'ignored');
    assert.equal(item.reason, 'known-noise');
  });

  test('drops the developer role, which is injected configuration', () => {
    const record = cdx.message('user', 'x');
    record.payload.role = 'developer';
    assert.equal(extractCodexRecord(record).kind, 'ignored');
  });

  test('keeps an image as metadata and discards its base64', () => {
    const item = extractCodexRecord(cdx.image(4000));
    assert.equal(item.kind, 'message');
    assert.deepEqual(item.parts[0], {
      type: 'attachment', kind: 'image', mediaType: 'image/png', bytes: 3000,
    });
    assert.ok(!JSON.stringify(item).includes('AAAAAAAAAA'), 'base64 must not be retained');
  });

  test('turns a tool call into a preview part, never indexed text', () => {
    const item = extractCodexRecord(cdx.toolCall('shell', { command: 'ls -la' }));
    assert.equal(item.kind, 'ignored');
    assert.equal(item.part.type, 'tool_use');
    assert.equal(item.part.name, 'shell');
    assert.ok(item.part.preview.includes('ls -la'));
  });

  test('truncates an oversized tool output', () => {
    const item = extractCodexRecord(cdx.toolOutput('x'.repeat(50000)));
    assert.equal(item.part.type, 'tool_result');
    assert.ok(item.part.preview.length < 2100);
    assert.ok(item.part.preview.endsWith('…'));
  });

  test('flags harness-injected pseudo-XML as a notice, not as the user speaking', () => {
    const item = extractCodexRecord(cdx.message('user', '<environment_context><cwd>/p</cwd></environment_context>'));
    assert.equal(item.isNotice, true);
    assert.equal(item.text, '', 'injected context must not be indexed');
  });

  test('a user message that merely mentions markup stays theirs', () => {
    const item = extractCodexRecord(cdx.message('user', 'Utilise <cmd>npm test</cmd> ici'));
    assert.equal(item.isNotice, false);
    assert.equal(item.text, 'Utilise <cmd>npm test</cmd> ici');
  });

  test('tolerates garbage', () => {
    for (const bad of [null, undefined, 42, 'str', [], {}]) {
      assert.equal(extractCodexRecord(bad).kind, 'ignored');
    }
  });
});

// ── discovery and reading ───────────────────────────────────────────────────

test.describe('adapter', () => {
  test('detects its data directory', (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    assert.equal(adapter.detect(ctx), false, 'nothing there yet');
    fx.codex().session('u1', [cdx.meta('/p')]);
    assert.equal(adapter.detect(ctx), true);
  });

  test('discovers a session with its exact folder', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.codex().session('11111111-1111-1111-1111-111111111111', [
      cdx.meta('/home/zam/Programmation/c64/Arena64', 'sess-a'),
      cdx.message('user', 'salut'),
    ]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.sessionId, 'sess-a');
    assert.equal(d.folderPath, '/home/zam/Programmation/c64/Arena64');
    assert.equal(d.folderExact, true);
    assert.match(d.fingerprint, /^\d+:\d+$/);
  });

  test('recovers the folder from an injected environment block when no meta exists', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    // The nine oldest files have no session_meta at all.
    fx.codex().session('22222222-2222-2222-2222-222222222222', [
      cdx.bare('user', '<environment_context>\n  <cwd>/home/zam/repos/quake</cwd>\n</environment_context>'),
      cdx.bare('assistant', 'ok'),
    ]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/repos/quake');
    assert.equal(d.folderExact, true);
  });

  test('reads only the real stream, never the mirror', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.codex().session('33333333-3333-3333-3333-333333333333', [
      cdx.meta('/p'),
      cdx.message('user', 'ma question'),
      cdx.eventMsg('ma question'),       // mirror of the line above
      cdx.message('assistant', 'ma reponse'),
      cdx.eventMsg('ma reponse'),        // mirror again
      cdx.noise(),
    ]);

    const [d] = await collect(adapter.discover(ctx));
    const texts = messagesOf(await collect(adapter.read(d, { cursor: null }))).map((m) => m.text);
    assert.deepEqual(texts, ['ma question', 'ma reponse'], 'each turn exactly once');
  });

  test('resumes from a cursor without replaying', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const tree = fx.codex();
    tree.session('44444444-4444-4444-4444-444444444444', [cdx.meta('/p'), cdx.message('user', 'avant')]);

    const [first] = await collect(adapter.discover(ctx));
    const pass1 = await collect(adapter.read(first, { cursor: null }));
    const cursor = pass1.at(-1).cursor;

    tree.append('44444444-4444-4444-4444-444444444444', [cdx.message('assistant', 'apres')]);

    const [second] = await collect(adapter.discover(ctx));
    assert.notEqual(second.fingerprint, first.fingerprint);
    assert.equal(adapter.canResume(second, cursor), true);

    const resumed = messagesOf(await collect(adapter.read(second, { cursor })));
    assert.deepEqual(resumed.map((m) => m.text), ['apres']);
  });

  test('refuses to resume past the end of a rewritten file', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.codex().session('55555555-5555-5555-5555-555555555555', [cdx.meta('/p')]);
    const [d] = await collect(adapter.discover(ctx));
    assert.equal(adapter.canResume(d, String(d.bytes + 1000)), false);
    assert.equal(adapter.canResume(d, '0'), true);
  });

  test('reads a legacy document and admits its folder is unknown', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.codex().legacy('66666666-6666-6666-6666-666666666666', [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'vieux prompt' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'vieille reponse' }] },
      { type: 'reasoning', id: 'r1', summary: 'ignore' },
    ]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.legacy, true);
    assert.equal(d.folderExact, false, 'no cwd exists in this generation');
    assert.equal(d.folderPath, adapter.UNKNOWN_FOLDER);
    // Not false: the rollout file exists, only its folder is unknown. Asserting
    // false here encoded the bug — the UI reads this flag as "transcripts were
    // purged" and told the reader the opposite of the truth.
    assert.equal(d.folderOnDisk, true);

    const items = messagesOf(await collect(adapter.read(d, { cursor: null })));
    assert.deepEqual(items.map((m) => m.text), ['vieux prompt', 'vieille reponse']);
    assert.ok(items.every((m) => m.timestamp), 'the session stamp stands in for missing times');
  });

  test('a legacy document is never resumed', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.codex().legacy('77777777-7777-7777-7777-777777777777', []);
    const [d] = await collect(adapter.discover(ctx));
    assert.equal(adapter.canResume(d, '10'), false);
  });

  test('yields nothing rather than throwing on a missing directory', async () => {
    const ctx = { env: { CODEX_HOME: '/nope/does/not/exist' } };
    assert.equal(adapter.detect(ctx), false);
    assert.deepEqual(await collect(adapter.discover(ctx)), []);
  });

  test('survives a corrupt legacy document', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const tree = fx.codex();
    tree.legacy('88888888-8888-8888-8888-888888888888', []);
    require('fs').writeFileSync(
      require('path').join(tree.home, 'sessions', 'rollout-2025-04-17-88888888-8888-8888-8888-888888888888.json'),
      '{ pas du json'
    );

    const [d] = await collect(adapter.discover(ctx));
    assert.deepEqual(await collect(adapter.read(d, { cursor: null })), []);
  });
});

/**
 * A tool call and its result share one correlation id. Giving both messages
 * that id as their uuid made them collide on the unique (session_id, uuid)
 * index, and `ON CONFLICT DO NOTHING` discarded whichever arrived second —
 * always the result, the half that holds the output.
 *
 * Measured before the fix, over the real corpus: 6172 rows lost for Codex, 435
 * for Copilot, and not one tool result stored for either.
 */
test('a tool call and its result do not collide on one uuid', async (t) => {
  const { fx, ctx, teardown } = setup();
  t.after(teardown);

  fx.codex().session('99999999-9999-9999-9999-999999999999', [
    cdx.meta('/p'),
    cdx.toolCall('shell', { command: 'ls' }),
    cdx.toolOutput('README.md'),
  ]);

  const [d] = await collect(adapter.discover(ctx));
  const items = (await collect(adapter.read(d, { cursor: null }))).map((c) => c.item);

  const uuids = items.filter((i) => i.kind === 'message').map((i) => i.uuid);
  assert.equal(new Set(uuids).size, uuids.length, `uuids collide: ${uuids.join(', ')}`);

  const kinds = items.flatMap((i) => i.parts || []).map((p) => p.type);
  assert.ok(kinds.includes('tool_use'), 'the call survives');
  assert.ok(kinds.includes('tool_result'), 'and so does the result');
});

// Shaped {"record_type":"state"} — no `type` key at all, so a match on raw.type
// never reached them and 1231 known records were reported as format drift.
test('filler lines are recognised rather than reported as drift', () => {
  const item = extractCodexRecord({ record_type: 'state' });
  assert.equal(item.kind, 'ignored');
  assert.equal(item.reason, 'known-noise', 'not "type:unknown"');
  assert.equal(item.detail, 'record_type:state');
});

test('a session whose folder is unknown is not reported as purged', async (t) => {
  const { fx, ctx, teardown } = setup();
  t.after(teardown);

  fx.codex().legacy('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'x' }] },
  ]);

  const [d] = await collect(adapter.discover(ctx));
  assert.equal(d.folderExact, false, 'the folder is genuinely unknown');
  assert.equal(d.folderOnDisk, true, 'but the rollout file is right there');
});

// ── what a reply cost ─────────────────────────────────────────────────────
//
// Every case below was measured on 145 real rollouts (24 September 2026):
// 1 185 repeated events, 10 counters starting over after a resume, and older
// files that write the count BEFORE the reply it paid for.

const fs = require('node:fs');
const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');

/** Codex's own counts: its input INCLUDES what the cache served. */
const counts = (input, cached, output, reasoning = 0) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
});

const usagesOf = (chunks) => chunks.map((c) => c.item).filter((i) => i.kind === 'usage');

test.describe('token usage', () => {
  test('a token_count becomes a usage item carrying both the reply and the total', () => {
    const item = extractCodexRecord(cdx.tokenCount(counts(300, 200, 20), counts(100, 60, 10)));
    assert.equal(item.kind, 'usage');
    assert.equal(item.total.input_tokens, 300);
    assert.equal(item.last.input_tokens, 100);
  });

  test('a token_count with no info is known noise, not drift', () => {
    const item = extractCodexRecord({
      timestamp: 't',
      type: 'event_msg',
      payload: { type: 'token_count', info: null },
    });
    assert.equal(item.kind, 'ignored');
    assert.equal(item.reason, 'known-noise');
  });

  test('a repeat is skipped, a real reply counts, and a counter starting over is a real reply', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.codex().session('66666666-6666-6666-6666-666666666666', [
      cdx.meta('/p'),
      cdx.message('user', 'q'),
      cdx.message('assistant', 'r1'),
      cdx.tokenCount(counts(100, 60, 10)),
      cdx.tokenCount(counts(100, 60, 10)), // the same event again: total unchanged
      cdx.message('assistant', 'r2'),
      cdx.tokenCount(counts(250, 160, 30), counts(150, 100, 20)),
      cdx.tokenCount(counts(80, 50, 5)), // resumed: the total falls back and equals its own last
    ]);

    const [d] = await collect(adapter.discover(ctx));
    const usages = usagesOf(await collect(adapter.read(d, { cursor: null })));
    assert.equal(usages.length, 3, 'three replies, not four events');
    assert.deepEqual(
      usages.map((u) => u.usage.output),
      [10, 20, 5]
    );
  });

  test('the cache is taken out of Codex input, which includes it', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.codex().session('77777777-7777-7777-7777-777777777777', [
      cdx.meta('/p'),
      cdx.message('assistant', 'r'),
      // Measured on a real turn: 2 692 in, of which 1 920 served from cache.
      cdx.tokenCount(counts(2692, 1920, 400, 64)),
    ]);

    const [d] = await collect(adapter.discover(ctx));
    const [{ usage }] = usagesOf(await collect(adapter.read(d, { cursor: null })));
    assert.equal(usage.input, 772, 'fresh input only, as the contract defines it');
    assert.equal(usage.cacheRead, 1920);
    assert.equal(usage.output, 400);
    assert.equal(usage.reasoning, 64);
    assert.equal(usage.cacheWrite, null, 'a field this file does not carry stays null');
  });

  test('a resumed pass still recognises a repeat of the reply it stopped after', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const id = '88888888-8888-8888-8888-888888888888';
    const tree = fx.codex();
    tree.session(id, [
      cdx.meta('/p'),
      cdx.message('assistant', 'r1'),
      cdx.tokenCount(counts(100, 60, 10)),
    ]);

    const [first] = await collect(adapter.discover(ctx));
    const cursor = (await collect(adapter.read(first, { cursor: null }))).at(-1).cursor;

    tree.append(id, [
      cdx.tokenCount(counts(100, 60, 10)), // repeat, across the pass boundary
      cdx.message('assistant', 'r2'),
      cdx.tokenCount(counts(180, 110, 25), counts(80, 50, 15)),
    ]);

    const [second] = await collect(adapter.discover(ctx));
    assert.equal(
      adapter.canResume(second, cursor),
      true,
      'a cursor carrying a total is still an offset'
    );
    const usages = usagesOf(await collect(adapter.read(second, { cursor })));
    assert.deepEqual(
      usages.map((u) => u.usage.output),
      [15],
      'the repeat is not counted twice'
    );
  });

  test('a half-written count is not counted: it will be read whole next time', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const id = '99999999-9999-9999-9999-999999999999';
    const tree = fx.codex();
    tree.session(id, [cdx.meta('/p'), cdx.message('assistant', 'r')]);
    fs.appendFileSync(tree.file(id), JSON.stringify(cdx.tokenCount(counts(100, 60, 10)))); // no newline yet

    const [d] = await collect(adapter.discover(ctx));
    const chunks = await collect(adapter.read(d, { cursor: null }));
    assert.equal(usagesOf(chunks).length, 0);
    assert.ok(
      Number(chunks.at(-1).cursor.split(';')[0]) < d.bytes,
      'and the cursor stops before it'
    );
  });

  test('a subagent is its own conversation, not a replacement for its parent', () => {
    // Its header names the parent in session_id and itself in id.
    const item = extractCodexRecord({
      timestamp: 't',
      type: 'session_meta',
      payload: {
        session_id: 'parent',
        id: 'child',
        parent_thread_id: 'parent',
        thread_source: 'subagent',
        cwd: '/p',
      },
    });
    assert.equal(item.sessionId, 'child');
  });
});

test('through the indexer, a conversation carries the exact sum of its replies', async (t) => {
  const { fx, teardown } = setup();
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    teardown();
  });

  fx.codex().session('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', [
    cdx.meta('/home/ada/p'),
    cdx.message('user', 'q'),
    // Older files write the count BEFORE the reply it paid for: it must wait.
    cdx.tokenCount(counts(100, 60, 10)),
    cdx.message('assistant', 'r1'),
    cdx.tokenCount(counts(100, 60, 10)),
    cdx.tokenCount(counts(250, 160, 30), counts(150, 100, 20)),
    cdx.message('assistant', 'r2'),
  ]);

  const report = await new Indexer(index, { env: fx.env, adapters: [adapter] }).run();
  const [session] = index.sessions(index.folderId('/home/ada/p'));
  assert.equal(session.tokOutput, 30, 'ten and twenty: the repeat is not there');
  assert.equal(session.tokInput, 40 + 50, 'fresh input: what the cache did not serve');
  assert.equal(session.tokCacheRead, 160, 'the running total, exactly');
  assert.ok(!report.unknownKinds['usage-without-reply'], 'the early count found its reply');
});

// ── which model answered ──────────────────────────────────────────────────
//
// Codex names the model in turn_context and nowhere else — 1 963 of them in
// 145 real files — and it changes 23 times inside a conversation.

const turn = (model) => ({ timestamp: 't', type: 'turn_context', payload: { cwd: '/p', model } });

test.describe('model', () => {
  test('turn_context carries the model as well as the folder', () => {
    const item = extractCodexRecord(turn('gpt-6-astra'));
    assert.equal(item.kind, 'meta');
    assert.equal(item.model, 'gpt-6-astra');
  });

  test('each reply gets the model of its own turn, the person none', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    fx.codex().session('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', [
      cdx.meta('/p'),
      turn('gpt-5.2-codex'),
      cdx.message('user', 'q1'),
      cdx.message('assistant', 'r1'),
      cdx.toolCall('shell', { command: ['ls'] }),
      turn('gpt-6-astra'),
      cdx.message('user', 'q2'),
      cdx.message('assistant', 'r2'),
    ]);
    const [d] = await collect(adapter.discover(ctx));
    const items = messagesOf(await collect(adapter.read(d, { cursor: null })));
    assert.deepEqual(
      items.map((m) => [m.role, m.text || m.parts[0].type, m.model]),
      [
        ['user', 'q1', ''],
        ['assistant', 'r1', 'gpt-5.2-codex'],
        ['assistant', 'tool_use', 'gpt-5.2-codex'],
        ['user', 'q2', ''],
        ['assistant', 'r2', 'gpt-6-astra'],
      ]
    );
  });

  test('a resumed pass still knows the model of the turn in progress', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const tree = fx.codex();
    tree.session(id, [cdx.meta('/p'), turn('gpt-6-astra'), cdx.message('assistant', 'r1')]);
    const [first] = await collect(adapter.discover(ctx));
    const cursor = (await collect(adapter.read(first, { cursor: null }))).at(-1).cursor;

    tree.append(id, [cdx.message('assistant', 'r2')]);
    const [second] = await collect(adapter.discover(ctx));
    assert.equal(adapter.canResume(second, cursor), true);
    const resumed = messagesOf(await collect(adapter.read(second, { cursor })));
    assert.deepEqual(
      resumed.map((m) => m.model),
      ['gpt-6-astra']
    );
  });

  test('a cursor carrying both a running total and a model resumes the count too', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);
    const id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const tree = fx.codex();
    tree.session(id, [
      cdx.meta('/p'),
      turn('gpt-6-astra'),
      cdx.message('assistant', 'r1'),
      cdx.tokenCount(counts(100, 60, 10)),
    ]);
    const [first] = await collect(adapter.discover(ctx));
    const cursor = (await collect(adapter.read(first, { cursor: null }))).at(-1).cursor;
    assert.match(cursor, /^\d+;[\d,]+;gpt-6-astra$/);

    tree.append(id, [cdx.tokenCount(counts(100, 60, 10)), cdx.message('assistant', 'r2')]);
    const [second] = await collect(adapter.discover(ctx));
    const chunks = await collect(adapter.read(second, { cursor }));
    assert.equal(usagesOf(chunks).length, 0, 'the repeat is still recognised');
    assert.deepEqual(
      messagesOf(chunks).map((m) => m.model),
      ['gpt-6-astra']
    );
  });
});
