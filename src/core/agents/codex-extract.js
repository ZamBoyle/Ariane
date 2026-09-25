'use strict';

/**
 * Codex record extraction. Pure: same input, same output, no I/O.
 *
 * Codex writes far more than a conversation, and two of its streams are traps
 * rather than data. Measured over 23,402 records on a real 416 MB corpus:
 *
 *  - `event_msg` (30.1% of all bytes) MIRRORS the `response_item` stream. Every
 *    turn appears in both. Reading it double-counts the whole conversation.
 *  - `compacted` (14.4% of bytes) replays up to 1,529 earlier messages as
 *    context compaction. Reading it double-counts again.
 *  - `input_image` parts hide 25.8 MB of base64 inside just 28 images, so
 *    content[] must be filtered by part type, never mapped blindly.
 *  - role `developer` (455 records, 1.8 MB) is injected system configuration,
 *    not human conversation.
 *
 * Only `response_item` is read, and the result is 0.64% of the bytes on disk.
 *
 * Three envelope generations coexist and all three must parse:
 *   current      {timestamp, ordinal, type, payload}
 *   intermediate {timestamp, type, payload}          (no ordinal)
 *   oldest       the response item IS the top-level object, unwrapped
 */

/** Tool payloads are kept only as a preview; the full text is never stored. */
const TOOL_PREVIEW_LIMIT = 2000;

/** Record types that carry no conversational value, with why they are skipped. */
const IGNORED_TYPES = new Map([
  ['event_msg', 'mirror of response_item'],
  ['compacted', 'replay of earlier messages'],
  ['token_usage_record', 'accounting'],
  ['turn_context', 'context, read separately for cwd'],
  ['world_state', 'accounting'],
  ['thread_settings_applied', 'settings'],
  ['task_started', 'lifecycle'],
  ['task_complete', 'lifecycle'],
  ['inter_agent_communication', 'plumbing'],
  ['inter_agent_communication_metadata', 'plumbing'],
  ['ghost_snapshot', 'plumbing'],
]);

/** Roles that are machine configuration rather than conversation. */
const DROPPED_ROLES = new Set(['developer', 'system']);

/**
 * Pseudo-XML the harness injects into user turns. As with the Claude adapter
 * this is an ALLOWLIST: a message merely starting with "<" is not enough,
 * because people legitimately write markup.
 */
const INJECTED_OPENERS = [
  'environment_context',
  'recommended_plugins',
  'skills_instructions',
  'multi_agent_role',
  'multi_agent_mode',
  'collaboration_mode',
  'model_switch',
  'turn_aborted',
  'apps_instructions',
  'image_resize_notice',
  'send_user_message_question_reply',
  'user_instructions',
];

const INJECTED_RE = new RegExp(`^\\s*<(${INJECTED_OPENERS.join('|')})>`);

/**
 * Normalise one Codex record.
 * @param {unknown} raw A parsed JSONL line.
 * @returns {{kind: 'message'|'meta'|'ignored'} & object}
 */
function extractCodexRecord(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'ignored', reason: 'not-an-object' };

  // The session header carries the working directory, verbatim.
  if (raw.type === 'session_meta') {
    const payload = raw.payload || {};
    return {
      kind: 'meta',
      cwd: str(payload.cwd),
      // The thread's own id first. A subagent's header names its PARENT in
      // `session_id` and itself in `id`; reading session_id first filed the
      // subagent under the parent's id, and the parent — 25 replies — vanished
      // behind it. In the 130 other headers carrying both, they are equal.
      sessionId: str(payload.id) || str(payload.session_id),
      timestamp: str(payload.timestamp) || str(raw.timestamp),
      // The conversation that spawned this one, when it is a subagent's (7 of
      // 145 rollouts, 25 September 2026). Named nowhere else.
      parentId: str(payload.parent_thread_id),
      // What the parent called it: "Huygens", "Laplace".
      nickname: str(payload.agent_nickname),
      // The conversation this one was forked from. A subagent carries it too
      // (its parent), so it only means "continues" without parent_thread_id:
      // 1 such rollout of 8 carrying it, 25 September 2026.
      forkedFrom: str(payload.forked_from_id),
    };
  }

  // turn_context also carries cwd, and tracks changes mid-session.
  // …and it is the ONLY place Codex names the model: 1 963 turn_context records
  // in 145 files, and the model changes 23 times inside a conversation.
  if (raw.type === 'turn_context') {
    const payload = raw.payload || {};
    const cwd = str(payload.cwd);
    const model = str(payload.model);
    return cwd || model ? { kind: 'meta', cwd, model } : { kind: 'ignored', reason: 'known-noise' };
  }

  // Filler lines are shaped {"record_type":"state"} — they carry no `type` key
  // at all, so matching on raw.type never reached them and 1231 known records
  // were reported as format drift on every pass.
  if (!raw.type && typeof raw.record_type === 'string') {
    return { kind: 'ignored', reason: 'known-noise', detail: `record_type:${raw.record_type}` };
  }

  // What a reply cost travels in the mirror stream, and only there. The raw
  // counts go to the reader, which alone can tell a new turn from a repeat
  // (see codex.js, usageOf): a record on its own cannot.
  if (raw.type === 'event_msg' && raw.payload && raw.payload.type === 'token_count') {
    const info = raw.payload.info;
    if (!info || !info.total_token_usage || !info.last_token_usage) {
      return { kind: 'ignored', reason: 'known-noise', detail: 'token_count without info' };
    }
    return { kind: 'usage', total: info.total_token_usage, last: info.last_token_usage };
  }

  if (IGNORED_TYPES.has(raw.type)) {
    return { kind: 'ignored', reason: 'known-noise', detail: IGNORED_TYPES.get(raw.type) };
  }

  // Current and intermediate envelopes.
  if (raw.type === 'response_item') {
    return fromResponseItem(raw.payload, str(raw.timestamp));
  }

  // Oldest generation: the response item is the top-level object itself.
  if (raw.type === 'message' || raw.role) {
    return fromResponseItem(raw, str(raw.timestamp));
  }

  if (raw.type === 'function_call' || raw.type === 'function_call_output' || raw.type === 'reasoning') {
    return { kind: 'ignored', reason: 'known-noise', detail: 'bare tool record' };
  }

  // The 2025-04 header: {id, timestamp, instructions, git} with no type at all.
  // One per legacy file, nine in all, and it carries no prose — the cwd this
  // generation lacks is not in it either (see the adapter's header note).
  if (!raw.type && typeof raw.id === 'string' && 'instructions' in raw) {
    return { kind: 'ignored', reason: 'known-noise', detail: 'legacy session header' };
  }

  return { kind: 'ignored', reason: `type:${raw.type || 'unknown'}` };
}

function fromResponseItem(payload, timestamp) {
  if (!payload || typeof payload !== 'object') return { kind: 'ignored', reason: 'empty-payload' };

  const type = str(payload.type);
  if (type && type !== 'message') {
    // custom_tool_call_output alone is 28.8% of bytes: preview only.
    return {
      kind: 'ignored',
      reason: 'known-noise',
      detail: type,
      part: toolPart(type, payload),
    };
  }

  const role = str(payload.role);
  if (DROPPED_ROLES.has(role)) return { kind: 'ignored', reason: 'known-noise', detail: `role:${role}` };
  if (role !== 'user' && role !== 'assistant') {
    return { kind: 'ignored', reason: role ? `role:${role}` : 'no-role' };
  }

  const parts = [];
  const texts = [];

  for (const block of Array.isArray(payload.content) ? payload.content : []) {
    if (!block || typeof block !== 'object') continue;
    readBlock(block, parts, texts);
  }

  const text = texts.join('\n\n').trim();
  // Harness-injected context arrives with the user's role but is not their words.
  const isNotice = text !== '' && INJECTED_RE.test(text);

  return {
    kind: 'message',
    role,
    uuid: str(payload.id),
    parentUuid: null,
    timestamp,
    cwd: '',
    gitBranch: '',
    version: '',
    model: '',
    text: isNotice ? '' : text,
    thinking: '',
    parts,
    isMeta: false,
    isNotice,
    isSidechain: false,
    command: null,
  };
}

function readBlock(block, parts, texts) {
  switch (block.type) {
    case 'input_text':
    case 'output_text':
    case 'text': {
      const value = str(block.text).trim();
      if (value) {
        parts.push({ type: 'text', text: value });
        texts.push(value);
      }
      break;
    }

    case 'input_image':
    case 'image':
      // 25.8 MB of base64 across 28 images: metadata only, payload discarded.
      parts.push({
        type: 'attachment',
        kind: 'image',
        mediaType: mediaTypeOf(block.image_url),
        bytes: dataUrlBytes(block.image_url),
      });
      break;

    case 'encrypted_content':
      parts.push({ type: 'other', name: 'encrypted' });
      break;

    default:
      parts.push({ type: 'other', name: str(block.type) || 'block' });
  }
}

function toolPart(type, payload) {
  if (type === 'reasoning') return null;
  const isOutput = type.endsWith('_output');
  return {
    type: isOutput ? 'tool_result' : 'tool_use',
    id: str(payload.call_id) || str(payload.id),
    name: str(payload.name) || type.replace(/_call$/, ''),
    isError: false,
    preview: preview(isOutput ? payload.output : payload.arguments ?? payload.input),
  };
}

// -- helpers -----------------------------------------------------------------

function preview(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : stringify(value);
  return text.length > TOOL_PREVIEW_LIMIT ? `${text.slice(0, TOOL_PREVIEW_LIMIT)}…` : text;
}

function stringify(value) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** `data:image/png;base64,AAAA...` -> its media type. */
function mediaTypeOf(url) {
  const match = /^data:([^;,]+)[;,]/.exec(str(url));
  return match ? match[1] : 'application/octet-stream';
}

/** Decoded byte length of a data URL, without decoding it. */
function dataUrlBytes(url) {
  const value = str(url);
  const comma = value.indexOf(',');
  if (comma === -1) return 0;
  const data = value.slice(comma + 1);
  if (!data) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = {
  extractCodexRecord,
  IGNORED_TYPES,
  DROPPED_ROLES,
  INJECTED_OPENERS,
  TOOL_PREVIEW_LIMIT,
};
