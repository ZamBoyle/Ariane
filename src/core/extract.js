'use strict';

/**
 * Turns raw transcript records into the normalised shape the index and the UI
 * both consume. This module is pure: same input, same output, no I/O.
 *
 * The whole point of this file is selectivity. A transcript is ~98% tool
 * results, file snapshots and base64 attachments; only the `text` blocks are
 * conversation. We keep every part needed to *render* a message faithfully,
 * but only the prose goes into the full-text index:
 *
 *   text        -> rendered AND indexed
 *   thinking    -> rendered (collapsed), never indexed
 *   tool_use    -> rendered (collapsed) as a truncated preview, never indexed
 *   tool_result -> idem
 *   image/document -> metadata only; the base64 payload is discarded outright
 */

/** Tool payloads are kept only as a preview; the full text is never stored. */
const { usageOf } = require('./agents/contract');

const TOOL_PREVIEW_LIMIT = 2000;

/** Record types that carry no conversational value. */
const IGNORED_TYPES = new Set([
  'file-history-snapshot',
  'file-history-delta',
  'atis-latch',
  'bridge-session',
  'frame-link',
  'artifact-comment-monitor',
  'artifact-autoreact-ledger',
  'cost-state',
  'mode',
  'attachment',
  // 907 records of {permissionMode, sessionId} and nothing else. Left unnamed
  // they were 99% of the drift report, which is how a real new type would have
  // gone unnoticed in it.
  'permission-mode',
  // Measured on 25 September 2026: 308 `agent-name` records repeating the
  // generated title word for word, and `agent-setting` naming the agent
  // ("claude"). Nothing to show; named so the drift report lists only news.
  'agent-name',
  'agent-setting',
]);

/**
 * Context injected by the harness, not written by the user. Indexing these
 * would make every session match on the contents of CLAUDE.md and friends.
 */
/**
 * Wrapper blocks the harness injects INTO a user turn. They are written by the
 * tool, never typed by the person, so attributing them to the user is a
 * faithfulness bug - the one kind this app cannot afford.
 *
 * This is deliberately an ALLOWLIST. A generic "strip anything in angle
 * brackets" rule would destroy real user prose: measured on a real corpus,
 * users legitimately write <cmd>, <path>, <indent>, <Esc>, <digest> and more
 * when discussing config, markup or keyboard shortcuts.
 *
 * Children are swallowed with the parent, which is why <task-id>, <summary>,
 * <status> and friends need no entry of their own.
 */
const NOTICE_BLOCKS = [
  'system-reminder',
  'local-command-stdout',
  'local-command-caveat',
  'command-stdout',
  'command-name',
  'command-message',
  'command-args',
  'command-contents',
  'task-notification',
  'ide_opened_file',
  'ide_selection',
  'bash-input',
  'bash-stdout',
  'bash-stderr',
  'init',
];

const INJECTED_BLOCK = new RegExp(`<(${NOTICE_BLOCKS.join('|')})>[\\s\\S]*?<\\/\\1>`, 'g');

/**
 * Markers the harness writes in place of a turn: an interruption, a compaction
 * handover. Real records, but nobody said them.
 */
const SYNTHETIC_MARKER = /^\[(Request interrupted[^\]]*|Tool use was rejected[^\]]*)\]$/;
const COMPACTION_OPENER = /^This session is being continued from a previous/;
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/**
 * Classify and normalise one record.
 * @returns {{kind: 'message'|'title'|'summary'|'ignored'} & object}
 */
function extractRecord(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'ignored', reason: 'not-an-object' };

  const type = raw.type;

  // A message typed while the assistant is still working is QUEUED. When it is
  // `remove`d from the queue, that record is the only place it is ever written:
  // discarding these loses the person's words outright - measured on one real
  // session, 30 of their ~50 messages lived only here. When it is `dequeue`d,
  // Claude Code now writes it again as a `user` line: agents/claude.js marks
  // that line, and the indexer drops the queued copy.
  //
  // `enqueue` is the arrival. `remove` repeats the same text once the message
  // has been handled, and `dequeue` carries none, so both are skipped or every
  // queued message would appear twice.
  // A pointer to the last prompt of a session, written for `--resume`. Usually
  // it repeats a message that already has a `user` record, but some exist
  // NOWHERE else - prompts that would otherwise be lost. It is emitted with
  // `dedupeByText`, and the indexer drops it when the session already holds that
  // text. The text is in the pointer's own shape — blanks flattened, cut past
  // 200 characters with "…" (archive.js, echoOf). Counted exactly, that first
  // measure's "92 of 647 exist nowhere else" was mostly those cut echoes: on 25
  // September 2026, 11 of 101 pointers left in an index did.
  if (type === 'last-prompt') {
    const prompt = typeof raw.lastPrompt === 'string' ? raw.lastPrompt.trim() : '';
    if (!prompt) return { kind: 'ignored', reason: 'known-noise', detail: 'last-prompt:empty' };
    return { ...queuedMessage(raw, prompt), queued: false, dedupeByText: true };
  }

  // A queued command delivered as an attachment. Most are task notifications
  // written by the tool; `origin.kind === 'human'` is the only thing that tells
  // them apart from something the person typed. Measured over a corpus: 109 of
  // these, 74 already covered by their queue record, 3 by a user record, and 35
  // found nowhere else.
  if (type === 'attachment') {
    const a = raw.attachment;
    if (a && typeof a === 'object' && a.type === 'queued_command' && a.origin) {
      // `origin.kind` is the only thing separating a person's words from a task
      // notification: 113 of 226 measured are human, and the rest must stay out.
      if (a.origin.kind !== 'human') {
        return { kind: 'ignored', reason: 'known-noise', detail: 'queued_command:system' };
      }

      const prompt = promptText(a.prompt);
      if (prompt) {
        return {
          ...queuedMessage({ ...raw, timestamp: a.timestamp || raw.timestamp }, prompt),
          queued: false,
          dedupeByText: true,
        };
      }
    }
    return { kind: 'ignored', reason: 'known-noise', detail: 'attachment' };
  }

  if (type === 'queue-operation') {
    const queued = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (raw.operation !== 'enqueue' || !queued) {
      return { kind: 'ignored', reason: 'known-noise', detail: `queue:${raw.operation || '?'}` };
    }
    return queuedMessage(raw, queued);
  }
  if (type === 'ai-title') {
    const title = typeof raw.aiTitle === 'string' ? raw.aiTitle.trim() : '';
    return title
      ? { kind: 'title', sessionId: raw.sessionId, title }
      : { kind: 'ignored', reason: 'empty-title' };
  }
  // Written into the OLD transcript when the conversation is resumed in a new
  // one, naming it — the one thread between the two (Index.chain).
  if (type === 'continued-in') {
    const next =
      typeof raw.continuedInSessionId === 'string' ? raw.continuedInSessionId.trim() : '';
    return next
      ? { kind: 'continuation', continuedIn: next }
      : { kind: 'ignored', reason: 'known-noise', detail: 'continued-in:empty' };
  }
  if (type === 'system') return extractSystem(raw);
  if (type !== 'user' && type !== 'assistant') {
    return { kind: 'ignored', reason: IGNORED_TYPES.has(type) ? 'known-noise' : `type:${type}` };
  }
  return extractMessage(raw);
}

/**
 * The text of a queued prompt, whichever shape it was written in.
 *
 * `prompt` is sometimes a bare string and sometimes an array of content blocks.
 * Handling only the string lost 36 of the 113 human records measured — the same
 * failure as the mid-turn queue loss this project already fixed once, fixed for
 * one shape only. Only `text` blocks are joined: one of the 36 carries a base64
 * image beside its text.
 */
function promptText(prompt) {
  if (typeof prompt === 'string') return prompt.trim();
  if (!Array.isArray(prompt)) return '';
  return prompt
    .filter((b) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n\n')
    .trim();
}

/**
 * The `system` subtypes worth showing, and the code they are stored under. A
 * code, never a sentence: the index outlives any choice of language, and the
 * renderer names each notice in the reader's own (format.noticeCode).
 */
const SYSTEM_LABELS = {
  away_summary: 'away-summary',
  compact_boundary: 'compact-boundary',
};

/**
 * A `system` record: the harness talking about the session rather than in it.
 *
 * Measured over 38 211 Claude records, 407 of them are `system`, and two
 * subtypes carry something a reader would want:
 *
 *  - `away_summary` (71): prose written FOR the person, summarising what
 *    happened while they were away. It exists nowhere else in the transcript.
 *    It was being discarded whole, which is exactly the shape of mistake this
 *    codebase has already paid for four times.
 *  - `compact_boundary` (8): the reason the thread suddenly jumps. Without it
 *    the gap reads as lost messages.
 *
 * The other 328 are telemetry (`turn_duration` alone is 237), retry logs and UI
 * chatter. They are named here rather than lumped together so that the next
 * subtype to appear is reported as drift instead of vanishing.
 */
function extractSystem(raw) {
  const subtype = str(raw.subtype);
  const content = str(raw.content).trim();

  const label = SYSTEM_LABELS[subtype];
  if (label && content) {
    const notice = noticeMessage(raw, content, label);
    // A compaction starts a NEW transcript, with a new id: this is the only
    // thread back to the previous one — the uuid of its last message.
    const parent = str(raw.logicalParentUuid);
    if (subtype === 'compact_boundary' && parent) notice.continuesUuid = parent;
    return notice;
  }

  // A slug names the session; several subtypes carry one, so it is read before
  // the record is set aside.
  if (typeof raw.slug === 'string' && raw.slug) {
    return { kind: 'summary', sessionId: raw.sessionId, slug: raw.slug };
  }

  return { kind: 'ignored', reason: 'known-noise', detail: `system:${subtype || '?'}` };
}

/**
 * A record nobody said: shown, searchable, but credited to no speaker.
 * `isNotice` is what keeps it out of the person's mouth in the transcript.
 */
function noticeMessage(raw, text, detail) {
  return {
    kind: 'message',
    uuid: str(raw.uuid),
    parentUuid: str(raw.parentUuid) || null,
    sessionId: str(raw.sessionId),
    role: 'assistant',
    timestamp: str(raw.timestamp),
    cwd: str(raw.cwd),
    gitBranch: str(raw.gitBranch),
    version: str(raw.version),
    model: '',
    usage: null,
    text,
    thinking: '',
    parts: [{ type: 'text', text }],
    isMeta: false,
    isNotice: true,
    isSidechain: Boolean(raw.isSidechain),
    command: { name: detail, args: '' },
    slug: typeof raw.slug === 'string' && raw.slug ? raw.slug : undefined,
  };
}

/** A message the person typed mid-turn, recovered from the queue record. */
function queuedMessage(raw, text) {
  const cleaned = clean(text);
  const command = detectCommand(text);
  // Text that the strip leaves empty was the harness's, not the person's — the
  // rule extractMessage applies. The queue did not: 218 <task-notification>
  // rows were stored as empty messages from the person rather than as notices.
  const strippedToNothing = String(text).trim() !== '' && cleaned === '';

  return {
    kind: 'message',
    uuid: '',
    parentUuid: null,
    sessionId: str(raw.sessionId),
    role: 'user',
    timestamp: str(raw.timestamp),
    cwd: '',
    gitBranch: '',
    version: '',
    model: '',
    usage: null,
    text: cleaned,
    thinking: '',
    parts: cleaned ? [{ type: 'text', text: cleaned }] : [],
    isMeta: false,
    isNotice: strippedToNothing,
    isSidechain: false,
    command,
    queued: true,
  };
}

/**
 * Claude's `usage`, said in the contract's words.
 *
 * Nothing is subtracted: Claude's `input_tokens` already excludes what was
 * served from cache, which is not true of every agent. The dictionary and the
 * reason live in agents/contract.js.
 */
function claudeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const details = usage.output_tokens_details || {};
  return usageOf({
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
    reasoning: details.thinking_tokens,
  });
}

function extractMessage(raw) {
  const message = raw.message || {};
  const parts = [];
  const texts = [];
  const thinkings = [];

  const content = message.content;
  const rawText = [];
  if (typeof content === 'string') {
    rawText.push(content);
    pushText(content, parts, texts);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') rawText.push(block.text);
      readBlock(block, parts, texts, thinkings);
    }
  }

  // Detect on the raw text: clean() removes the very envelope we match on.
  const command = detectCommand(rawText.join('\n'));
  const joinedText = joined(texts);
  const rawJoined = rawText.join('\n').trim();

  // Nothing of the person's own words survived the strip, yet there WAS text:
  // the whole turn was harness-injected.
  const strippedToNothing = rawJoined !== '' && joinedText === '';
  const isNotice =
    Boolean(raw.isMeta) ||
    Boolean(raw.isCompactSummary) ||
    strippedToNothing ||
    SYNTHETIC_MARKER.test(joinedText) ||
    COMPACTION_OPENER.test(joinedText);

  return {
    kind: 'message',
    uuid: str(raw.uuid),
    parentUuid: raw.parentUuid == null ? null : str(raw.parentUuid),
    sessionId: str(raw.sessionId),
    role: raw.type,
    timestamp: str(raw.timestamp),
    cwd: str(raw.cwd),
    gitBranch: str(raw.gitBranch),
    version: str(raw.version),
    model: str(message.model),
    usage: claudeUsage(message.usage),
    text: joinedText,
    thinking: joined(thinkings),
    parts,
    isMeta: Boolean(raw.isMeta),
    // Rendered as a system notice and excluded from search: this app must never
    // put words in the user's mouth.
    isNotice,
    isSidechain: Boolean(raw.isSidechain),
    isCompactSummary: Boolean(raw.isCompactSummary),
    command,
  };
}

function readBlock(block, parts, texts, thinkings) {
  switch (block.type) {
    case 'text':
      pushText(block.text, parts, texts);
      break;

    case 'thinking': {
      // `signature` is an opaque cryptographic blob; only the prose is useful.
      const value = clean(block.thinking);
      if (value) {
        parts.push({ type: 'thinking', text: value });
        thinkings.push(value);
      } else if (block.signature) {
        // Masked: since April 2026 Claude Code keeps no readable reasoning, only
        // its signature (0 readable of 1 408 in August). Nothing to show, but a
        // trace to count — 6 093 of the 6 561 records that show nothing were
        // these, and without it the statistics could only call them "empty".
        parts.push({ type: 'other', name: 'masked-thinking' });
      }
      break;
    }

    case 'tool_use':
      parts.push({
        type: 'tool_use',
        id: str(block.id),
        name: str(block.name) || 'tool',
        preview: preview(block.input),
      });
      break;

    case 'tool_result':
      parts.push({
        type: 'tool_result',
        id: str(block.tool_use_id),
        isError: Boolean(block.is_error),
        preview: preview(block.content),
      });
      break;

    case 'image':
    case 'document':
      // Discard the payload: base64 attachments are the bulk of transcript bytes.
      parts.push({
        type: 'attachment',
        kind: block.type,
        mediaType: str(block.source && block.source.media_type) || 'application/octet-stream',
        bytes: base64Bytes(block.source && block.source.data),
      });
      break;

    default:
      // e.g. model `fallback` events - recorded so rendering stays faithful.
      parts.push({ type: 'other', name: str(block.type) || 'block' });
  }
}

function pushText(value, parts, texts) {
  const cleaned = clean(value);
  if (!cleaned) return;
  parts.push({ type: 'text', text: cleaned });
  texts.push(cleaned);
}

/** Strip harness-injected context and slash-command envelopes. */
function clean(value) {
  if (typeof value !== 'string') return '';
  return value.replace(INJECTED_BLOCK, '').trim();
}

function detectCommand(rawContent) {
  if (typeof rawContent !== 'string') return null;
  const name = COMMAND_NAME.exec(rawContent);
  if (!name) return null;
  const args = COMMAND_ARGS.exec(rawContent);
  return {
    name: name[1].trim(),
    args: args ? args[1].trim() : '',
  };
}

function preview(value) {
  if (value == null) return '';
  let text;
  if (typeof value === 'string') {
    text = value;
  } else if (Array.isArray(value)) {
    text = value
      .map((b) =>
        b && typeof b === 'object' && typeof b.text === 'string' ? b.text : stringify(b)
      )
      .join('\n');
  } else {
    text = stringify(value);
  }
  return text.length > TOOL_PREVIEW_LIMIT ? `${text.slice(0, TOOL_PREVIEW_LIMIT)}…` : text;
}

function stringify(value) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** Decoded byte length of a base64 payload, without decoding it. */
function base64Bytes(data) {
  if (typeof data !== 'string' || data.length === 0) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

const str = (v) => (typeof v === 'string' ? v : '');
const joined = (list) => list.join('\n\n').trim();

module.exports = {
  extractRecord,
  clean,
  detectCommand,
  base64Bytes,
  TOOL_PREVIEW_LIMIT,
  IGNORED_TYPES,
};
