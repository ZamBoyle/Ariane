'use strict';

/**
 * Guards the most dangerous mistake this codebase can make: putting a record
 * type on a noise list when it carries something a person wrote.
 *
 * It is the most dangerous because it is the only one that makes NO noise. The
 * indexer reports record types it does not RECOGNISE, so an unknown shape
 * surfaces on the first run — but a type that was examined once, judged to be
 * plumbing, and added to the list is discarded for ever without a word. That is
 * how half of one person's messages vanished: `queue-operation` was inspected
 * early, seen to hold only {type, operation, timestamp, sessionId}, and
 * dismissed. It also carries the text of every message typed mid-turn, and that
 * record is the only place the message is ever stored.
 *
 * Each case below feeds an extractor a record of a type it discards, containing
 * an unmistakable sentence, and asserts the sentence is not lost. A future
 * addition to any noise list has to pass through here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractRecord, IGNORED_TYPES } = require('../src/core/extract');
const { extractCodexRecord, IGNORED_TYPES: CODEX_IGNORED } = require('../src/core/agents/codex-extract');
const {
  extractCopilotRecord,
  IGNORED_TYPES: COPILOT_IGNORED,
} = require('../src/core/agents/copilot-extract');
const { extractQwenRecord } = require('../src/core/agents/qwen');

/** Unmistakable: if this survives anywhere, the record was not swallowed. */
const SENTENCE = 'ceci est une phrase ecrite par la personne et ne doit jamais disparaitre';

/** Every readable string in a value, however deeply nested. */
function strings(value, depth = 0, out = []) {
  if (depth > 6 || value == null) return out;
  if (typeof value === 'string') return (out.push(value), out);
  if (Array.isArray(value)) {
    for (const v of value) strings(v, depth + 1, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) strings(v, depth + 1, out);
  }
  return out;
}

const survives = (item) => strings(item).some((s) => s.includes(SENTENCE));

// ── the type that caused the bug ────────────────────────────────────────────

test.describe('Claude Code', () => {
  test('a message typed mid-turn survives its queue record', () => {
    const item = extractRecord({
      type: 'queue-operation',
      operation: 'enqueue',
      content: SENTENCE,
      timestamp: '2026-09-18T09:00:00.000Z',
      sessionId: 's1',
    });
    assert.equal(item.kind, 'message');
    assert.ok(survives(item), 'the sentence must reach the reader');
  });

  test('the last-prompt pointer survives', () => {
    const item = extractRecord({ type: 'last-prompt', lastPrompt: SENTENCE, sessionId: 's1' });
    assert.equal(item.kind, 'message');
    assert.ok(survives(item));
  });

  /**
   * The remaining entries are asserted to be genuinely empty of prose. Each one
   * is a shape that was measured on a real corpus; if a future version of the
   * format starts carrying text in one of them, the sentence appears where the
   * fixture put it and this test says so.
   */
  test('every other discarded type is examined, not assumed', () => {
    const shapes = {
      'file-history-snapshot': { snapshot: { files: {} } },
      'file-history-delta': { delta: {} },
      'atis-latch': { state: 'open' },
      'bridge-session': { id: 'x' },
      'frame-link': { url: 'about:blank' },
      'artifact-comment-monitor': { watching: true },
      'artifact-autoreact-ledger': { entries: [] },
      'cost-state': { total: 0 },
      mode: { mode: 'default' },
      attachment: { id: 'a1' },
      // 907 records of exactly {permissionMode, sessionId} on a real corpus.
      'permission-mode': { permissionMode: 'auto' },
    };

    for (const type of IGNORED_TYPES) {
      assert.ok(type in shapes, `${type} is discarded with no case here — add one`);
      const item = extractRecord({ type, ...shapes[type] });
      assert.equal(item.kind, 'ignored', type);
    }
  });
});

// ── the same guarantee for every other adapter ──────────────────────────────

test.describe('Codex', () => {
  test('the mirrored stream is a duplicate, not a loss', () => {
    // event_msg repeats what response_item already carries; dropping it is
    // right ONLY because the text is stored elsewhere.
    const mirrored = extractCodexRecord({
      timestamp: '2026-06-21T15:42:11.016Z',
      type: 'event_msg',
      payload: { type: 'AgentMessage', message: SENTENCE },
    });
    assert.equal(mirrored.kind, 'ignored');

    const real = extractCodexRecord({
      timestamp: '2026-06-21T15:42:11.016Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: SENTENCE }] },
    });
    assert.ok(survives(real), 'the same text must reach the reader through response_item');
  });

  test('a discarded record keeps its tool text as a preview', () => {
    const item = extractCodexRecord({
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'c1', output: SENTENCE },
    });
    assert.equal(item.kind, 'ignored');
    assert.ok(survives(item), 'tool output is previewed, never silently dropped');
  });

  test('injected configuration is discarded, and says which role', () => {
    const item = extractCodexRecord({
      type: 'response_item',
      payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: SENTENCE }] },
    });
    assert.equal(item.kind, 'ignored');
    assert.equal(item.detail, 'role:developer');
  });

  // The same exhaustive guard as Claude's: a new entry on the list cannot be
  // added without writing down here what the record actually looks like.
  test('every discarded type is examined, not assumed', () => {
    const shapes = {
      event_msg: { payload: { type: 'AgentMessage', message: SENTENCE } },
      compacted: { payload: { message: SENTENCE } },
      token_usage_record: { payload: { input_tokens: 1 } },
      turn_context: { payload: { cwd: '/p' } },
      world_state: { payload: {} },
      thread_settings_applied: { payload: { settings: {} } },
      task_started: { payload: {} },
      task_complete: { payload: {} },
      inter_agent_communication: { payload: { message: SENTENCE } },
      inter_agent_communication_metadata: { payload: { trigger_turn: false } },
      ghost_snapshot: { payload: {} },
    };

    for (const type of CODEX_IGNORED.keys()) {
      assert.ok(type in shapes, `${type} is discarded with no case here — add one`);
      // `turn_context` is on the list yet answers 'meta': it is read for the
      // working directory before being set aside. Either way it must never
      // become a turn in the conversation.
      const kind = extractCodexRecord({ type, ...shapes[type] }).kind;
      assert.ok(kind === 'ignored' || kind === 'meta', `${type} became ${kind}`);
    }
  });
});

test.describe('Copilot CLI', () => {
  test('a prompt is read from content, and the wrapped variant is not preferred', () => {
    const item = extractCopilotRecord({
      type: 'user.message',
      timestamp: '2026-08-21T22:51:23.484Z',
      data: { content: SENTENCE, transformedContent: `<preamble/>${SENTENCE}` },
    });
    assert.equal(item.text, SENTENCE, 'exactly what was typed, with nothing prepended');
  });

  test('tool output is previewed rather than dropped', () => {
    const item = extractCopilotRecord({
      type: 'tool.execution_complete',
      timestamp: '2026-08-21T22:51:23.484Z',
      data: { toolCallId: 't1', result: SENTENCE },
    });
    assert.equal(item.kind, 'ignored');
    assert.ok(survives(item));
  });

  test('the static system prompt is the one thing genuinely discarded', () => {
    const item = extractCopilotRecord({
      type: 'system.message',
      timestamp: '2026-08-21T22:51:23.484Z',
      data: { role: 'system', content: SENTENCE },
    });
    assert.equal(item.kind, 'ignored');
    assert.equal(item.detail, 'static system prompt');
  });

  // A hook.start carries the prompt the person submitted. It is discarded only
  // because the same text is also written as a user.message — checked on the
  // one such record that exists in the measured corpus.
  test('a prompt a hook repeats is stored by the turn itself', () => {
    const hook = extractCopilotRecord({
      type: 'hook.start',
      timestamp: '2026-09-17T22:44:50.284Z',
      data: { hookType: 'userPromptSubmitted', input: { prompt: SENTENCE } },
    });
    assert.equal(hook.kind, 'ignored');

    const turn = extractCopilotRecord({
      type: 'user.message',
      timestamp: '2026-09-17T22:44:50.284Z',
      data: { content: SENTENCE },
    });
    assert.ok(survives(turn), 'the same prompt must reach the reader through user.message');
  });

  test('every discarded type is examined, not assumed', () => {
    const shapes = {
      'assistant.turn_start': {},
      'assistant.turn_end': {},
      'permission.requested': { command: 'ls' },
      'permission.completed': { granted: true },
      'session.shutdown': {},
      'session.model_change': { model: 'gpt-4o' },
      'session.usage_checkpoint': { tokens: 1 },
      'system.message': { role: 'system', content: SENTENCE },
      'skill.invoked': { name: 'une-competence' },
      'hook.start': { hookType: 'userPromptSubmitted', input: { prompt: SENTENCE } },
      'hook.end': { hookType: 'userPromptSubmitted', success: true },
      'session.resume': {},
      'session.auto_mode_resolved': { mode: 'auto' },
      'model.turn_started': { model: 'gpt-4o' },
      'model.turn_ended': { model: 'gpt-4o' },
      'model.model_call_started': { model: 'gpt-4o' },
      'model.captured_assignment_context': { assignmentContext: 'a:1;b:2' },
      // Its message is the same one model.turn_failed carries, and that one is
      // shown to the reader.
      'model.model_call_failure': { modelCall: { error: SENTENCE } },
    };

    for (const type of COPILOT_IGNORED.keys()) {
      assert.ok(type in shapes, `${type} is discarded with no case here — add one`);
      const item = extractCopilotRecord({ type, timestamp: '2026-09-18T10:00:00.000Z', data: shapes[type] });
      assert.equal(item.kind, 'ignored', type);
    }
  });

  // The other half of that pair: the turn's own failure IS shown.
  test('a failed turn says why, instead of leaving the question unanswered', () => {
    const item = extractCopilotRecord({
      type: 'model.turn_failed',
      timestamp: '2026-09-18T14:16:00.000Z',
      data: { model: 'gpt-4o-mini', error: '400 reasoning_effort non supporté' },
    });
    assert.equal(item.kind, 'message');
    assert.equal(item.isNotice, true, 'nobody said it: it is the tool reporting');
    assert.ok(item.text.includes('400 reasoning_effort non supporté'));
  });
});

test.describe('Qwen Code', () => {
  test('a prompt survives whichever record type carries it', () => {
    const item = extractQwenRecord({
      type: 'user',
      uuid: 'q1',
      sessionId: 's1',
      timestamp: '2026-04-18T19:12:17.811Z',
      cwd: '/p',
      message: { role: 'user', parts: [{ text: SENTENCE }] },
    });
    assert.ok(survives(item));
  });

  test('a system record is discarded, and only that', () => {
    const item = extractQwenRecord({
      type: 'system',
      subtype: 'slash_command',
      systemPayload: { command: '/help' },
    });
    assert.equal(item.kind, 'ignored');
  });
});

test.describe('a queued command delivered as an attachment', () => {
  const attachment = (extra) => ({
    type: 'attachment',
    sessionId: 's1',
    attachment: { type: 'queued_command', prompt: SENTENCE, timestamp: '2026-08-28T17:37:26.336Z', ...extra },
  });

  // 109 measured: 74 duplicated a queue record, 3 a user record, 35 existed
  // nowhere else at all.
  test('survives when the origin is human', () => {
    const item = extractRecord(attachment({ origin: { kind: 'human' } }));
    assert.equal(item.kind, 'message');
    assert.equal(item.role, 'user');
    assert.ok(survives(item));
    assert.equal(item.dedupeByText, true, 'most of these repeat a record read elsewhere');
  });

  // Without this discriminator, 74 task notifications would be read as the
  // person speaking — the very mistake this file guards against, inverted.
  test('is discarded when the tool wrote it', () => {
    assert.equal(extractRecord(attachment({ origin: { kind: 'system' } })).kind, 'ignored');
    assert.equal(extractRecord(attachment({})).kind, 'ignored');
  });

  // `prompt` comes in two shapes. Handling only the string lost 36 of the 113
  // human records measured — the same failure as the mid-turn queue loss this
  // project already fixed once, fixed for one shape only.
  test('survives whichever shape the prompt was written in', () => {
    const asString = extractRecord(attachment({ origin: { kind: 'human' } }));
    const asBlocks = extractRecord(attachment({
      origin: { kind: 'human' },
      prompt: [{ type: 'text', text: SENTENCE }],
    }));
    assert.equal(asBlocks.kind, 'message', 'the array shape must not be dropped');
    assert.equal(asBlocks.text, asString.text, 'both shapes yield the same words');
  });

  // One of the 36 carries a base64 image beside its text.
  test('joins only the text blocks, never an attached image', () => {
    const item = extractRecord(attachment({
      origin: { kind: 'human' },
      prompt: [
        { type: 'text', text: SENTENCE },
        { type: 'image', source: { type: 'base64', data: 'A'.repeat(4000) } },
      ],
    }));
    assert.equal(item.text, SENTENCE);
    assert.ok(!JSON.stringify(item).includes('AAAAAAAAAA'), 'no base64 may reach the index');
  });

  test('a system-origin array is still ignored', () => {
    const item = extractRecord(attachment({
      origin: { kind: 'system' },
      prompt: [{ type: 'text', text: SENTENCE }],
    }));
    assert.equal(item.kind, 'ignored');
    assert.equal(item.detail, 'queued_command:system');
  });

  test('an empty or malformed prompt carries nothing', () => {
    for (const prompt of [[], [{ type: 'image' }], null, 42]) {
      assert.equal(
        extractRecord(attachment({ origin: { kind: 'human' }, prompt })).kind,
        'ignored',
        JSON.stringify(prompt)
      );
    }
  });

  test('other attachment kinds stay noise', () => {
    const item = extractRecord({
      type: 'attachment',
      attachment: { type: 'todo_reminder', content: SENTENCE },
    });
    assert.equal(item.kind, 'ignored');
    assert.equal(item.detail, 'attachment');
  });
});
