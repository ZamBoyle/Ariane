'use strict';

/**
 * Qwen Code adapter tests, and with them the shared GenAI extractor that
 * Gemini will reuse.
 *
 * These matter more than usual: the single Qwen session on the machine this was
 * written on contains nothing but two `system` records, so real data can prove
 * the adapter finds a session but not that it reads one correctly. Everything
 * below is built from the shapes the reconnaissance measured in Qwen's own
 * source (`createUserContent` / `createModelContent` / `createBaseRecord`).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../src/core/agents/qwen');
const { extractQwenRecord } = require('../src/core/agents/qwen');
const { extractGenAiContent, normaliseRole } = require('../src/core/agents/genai-extract');
const { createFixture, qwn, resetCounters } = require('./helpers/fixture');

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

// ── the shared GenAI extractor ──────────────────────────────────────────────

test.describe('GenAI content', () => {
  test('maps the "model" role onto assistant', () => {
    assert.equal(normaliseRole('model'), 'assistant');
    assert.equal(normaliseRole('assistant'), 'assistant');
    assert.equal(normaliseRole('user'), 'user');
    assert.equal(normaliseRole(undefined), 'user');
  });

  test('joins text parts', () => {
    const out = extractGenAiContent({ role: 'user', parts: [{ text: 'un' }, { text: 'deux' }] });
    assert.equal(out.text, 'un\ndeux');
    assert.equal(out.role, 'user');
  });

  // Reasoning is a FLAG here, and a part can carry both `thought` and `text`.
  test('separates reasoning from the answer, even on the same part', () => {
    const out = extractGenAiContent({
      role: 'model',
      parts: [{ text: 'la reponse' }, qwn.thought('mon raisonnement')],
    });
    assert.equal(out.text, 'la reponse', 'reasoning must not be indexed');
    assert.equal(out.thinking, 'mon raisonnement');
    assert.equal(out.role, 'assistant');
  });

  test('a part that is ONLY a thought contributes no text', () => {
    const out = extractGenAiContent({ role: 'model', parts: [qwn.thought('interne')] });
    assert.equal(out.text, '');
    assert.equal(out.thinking, 'interne');
  });

  test('recognises a tool call by its shape, not a type field', () => {
    const out = extractGenAiContent({
      role: 'model',
      parts: [qwn.functionCall('read_file', { path: '/a.js' })],
    });
    assert.equal(out.text, '');
    assert.equal(out.parts[0].type, 'tool_use');
    assert.equal(out.parts[0].name, 'read_file');
    assert.ok(out.parts[0].preview.includes('/a.js'));
  });

  test('recognises a tool response the same way', () => {
    const out = extractGenAiContent({
      role: 'user',
      parts: [{ functionResponse: { id: 'f1', name: 'read_file', response: { ok: true } } }],
    });
    assert.equal(out.parts[0].type, 'tool_result');
    assert.equal(out.parts[0].isError, false);
  });

  test('an inline attachment keeps its metadata and loses its payload', () => {
    const out = extractGenAiContent({ role: 'user', parts: [qwn.inlineImage(4000)] });
    assert.deepEqual(out.parts[0], {
      type: 'attachment', kind: 'image', mediaType: 'image/png', bytes: 3000,
    });
    assert.ok(!JSON.stringify(out).includes('AAAAAAAAAA'));
  });

  // Assuming one shape silently drops a whole side of the conversation.
  test('accepts a bare string as well as a parts array', () => {
    const out = extractGenAiContent('juste du texte', { role: 'model' });
    assert.equal(out.text, 'juste du texte');
    assert.equal(out.role, 'assistant');
  });

  test('tolerates garbage', () => {
    for (const bad of [null, undefined, 42, [], {}]) {
      const out = extractGenAiContent(bad);
      assert.equal(out.text, '');
      assert.ok(Array.isArray(out.parts));
    }
  });

  test('truncates an oversized tool payload', () => {
    const out = extractGenAiContent({
      role: 'user',
      parts: [{ functionResponse: { name: 'x', response: 'y'.repeat(50000) } }],
    });
    assert.ok(out.parts[0].preview.length < 2100);
    assert.ok(out.parts[0].preview.endsWith('…'));
  });
});

// ── record normalisation ────────────────────────────────────────────────────

test.describe('record extraction', () => {
  test('reads a user turn', () => {
    const item = extractQwenRecord(qwn.user('ma question'));
    assert.equal(item.kind, 'message');
    assert.equal(item.role, 'user');
    assert.equal(item.text, 'ma question');
    assert.equal(item.cwd, '/home/zam/repos/1541Ultimate');
    assert.equal(item.gitBranch, 'main');
  });

  test('reads a model turn as assistant', () => {
    const item = extractQwenRecord(qwn.model('ma reponse'));
    assert.equal(item.role, 'assistant');
    assert.equal(item.text, 'ma reponse');
    assert.equal(item.model, 'qwen3-coder');
  });

  // tool_result is a top-level record type here, not a nested block.
  test('reads a top-level tool_result record', () => {
    const item = extractQwenRecord(qwn.toolResult('read_file', { content: 'abc' }));
    assert.equal(item.kind, 'message');
    assert.equal(item.role, 'user', 'a tool answering is recorded under the user role');
    assert.equal(item.text, '');
    assert.equal(item.parts[0].type, 'tool_result');
  });

  test('ignores system records, the only kind the real session holds', () => {
    for (const subtype of ['slash_command', 'chat_compression', 'ui_telemetry', 'at_command']) {
      const item = extractQwenRecord(qwn.system(subtype));
      assert.equal(item.kind, 'ignored', subtype);
      assert.equal(item.reason, 'known-noise');
    }
  });

  test('ignores a message with nothing in it', () => {
    assert.equal(extractQwenRecord(qwn.base('user', { message: { role: 'user', parts: [] } })).kind,
      'ignored');
  });

  test('records an unknown type by name, so drift is visible', () => {
    assert.equal(extractQwenRecord(qwn.base('brand-new')).reason, 'type:brand-new');
  });

  test('tolerates garbage', () => {
    for (const bad of [null, undefined, 42, 'str', []]) {
      assert.equal(extractQwenRecord(bad).kind, 'ignored');
    }
  });
});

// ── discovery and reading ───────────────────────────────────────────────────

test.describe('adapter', () => {
  test('detects its data directory', (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    assert.equal(adapter.detect(ctx), false);
    fx.qwen().session('-home-zam-repos-1541Ultimate', 'u1', [qwn.user('x')]);
    assert.equal(adapter.detect(ctx), true);
  });

  test('finds sessions under the extra chats/ level', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.qwen().session('-home-zam-repos-1541Ultimate', 'ff808076', [qwn.user('salut')]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.sessionId, 'qsess-1');
    assert.equal(d.folderPath, '/home/zam/repos/1541Ultimate');
    assert.equal(d.folderExact, true);
  });

  // The directory name uses the same lossy scheme as Claude Code.
  test('takes cwd from the record, never from the directory name', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const record = qwn.user('salut');
    record.cwd = '/home/zam/Documents/Mathématiques';
    fx.qwen().session('-home-zam-Documents-Math-matiques', 'u1', [record]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/Documents/Mathématiques', 'the accent survives');
  });

  test('falls back to the lossy hint when no record carries a cwd', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const record = qwn.user('salut');
    delete record.cwd;
    fx.qwen().session('-a-b', 'u1', [record]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/a/b');
    assert.equal(d.folderExact, false, 'an approximation must say so');
  });

  test('reads a whole conversation in order', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.qwen().session('-p', 'u1', [
      qwn.system(),
      qwn.user('lis le fichier'),
      qwn.model('je regarde', [qwn.thought('reflexion'), qwn.functionCall('read_file', { p: 'a' })]),
      qwn.toolResult('read_file', { content: 'abc' }),
      qwn.model('voila le contenu'),
    ]);

    const [d] = await collect(adapter.discover(ctx));
    const items = (await collect(adapter.read(d, { cursor: null })))
      .map((c) => c.item)
      .filter((i) => i.kind === 'message');

    assert.deepEqual(items.map((i) => i.role), ['user', 'assistant', 'user', 'assistant']);
    assert.deepEqual(
      items.filter((i) => i.text).map((i) => i.text),
      ['lis le fichier', 'je regarde', 'voila le contenu']
    );
    assert.equal(items[1].thinking, 'reflexion');
  });

  test('resumes from a cursor without replaying', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const tree = fx.qwen();
    tree.session('-p', 'u1', [qwn.user('avant')]);

    const [first] = await collect(adapter.discover(ctx));
    const cursor = (await collect(adapter.read(first, { cursor: null }))).at(-1).cursor;

    const fsp = require('fs');
    const file = require('path').join(tree.home, 'projects', '-p', 'chats', 'u1.jsonl');
    fsp.appendFileSync(file, JSON.stringify(qwn.model('apres')) + '\n');

    const [second] = await collect(adapter.discover(ctx));
    assert.notEqual(second.fingerprint, first.fingerprint);
    assert.equal(adapter.canResume(second, cursor), true);

    const texts = (await collect(adapter.read(second, { cursor })))
      .map((c) => c.item)
      .filter((i) => i.kind === 'message')
      .map((i) => i.text);
    assert.deepEqual(texts, ['apres']);
  });

  test('refuses to resume past the end of a rewritten file', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.qwen().session('-p', 'u1', [qwn.user('x')]);
    const [d] = await collect(adapter.discover(ctx));
    assert.equal(adapter.canResume(d, String(d.bytes + 100)), false);
  });

  test('skips a project directory that has no chats level', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.qwen().empty('-sans-chats').session('-avec', 'u1', [qwn.user('x')]);
    const found = await collect(adapter.discover(ctx));
    assert.equal(found.length, 1);
  });

  // This is exactly the state of the one real session on this machine.
  test('a session holding only system records yields no messages', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.qwen().session('-p', 'u1', [qwn.system(), qwn.system('ui_telemetry')]);

    const [d] = await collect(adapter.discover(ctx));
    assert.ok(d, 'the session is still discovered');
    const messages = (await collect(adapter.read(d, { cursor: null })))
      .filter((c) => c.item.kind === 'message');
    assert.equal(messages.length, 0);
  });

  test('yields nothing rather than throwing on a missing directory', async () => {
    const ctx = { env: { QWEN_CONFIG_DIR: '/nope/does/not/exist' } };
    assert.equal(adapter.detect(ctx), false);
    assert.deepEqual(await collect(adapter.discover(ctx)), []);
  });
});
