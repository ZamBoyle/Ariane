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
