'use strict';

/**
 * VS Code chat extraction. Pure: same input, same output, no I/O.
 *
 * Shared by VS Code, Cursor and any other fork that keeps the same layout, so
 * this module knows about the FORMAT and nothing about where files live.
 *
 * Two things here are genuinely hostile and are the reason this could never be
 * a declarative manifest:
 *
 *  1. A `.jsonl` session is NOT one message per line. It is a delta log:
 *       {kind:0, v:<snapshot>}      the whole session
 *       {kind:1, k:[path], v}       set the value at that path
 *       {kind:2, k:[path], v:[...]} append those values at that path
 *     The paths go deep, e.g. k = ['requests', 0, 'response']. Treating
 *     `k[0] === 'requests'` as an append inflated one 3-request session to 134
 *     phantom requests in the reconnaissance.
 *
 *  2. There is no role field. One `request` object IS one exchange:
 *     `request.message` is the person, `request.response[]` is the model.
 *
 * Response parts are overwhelmingly plumbing: `toolInvocationSerialized` alone
 * is the single biggest consumer of bytes. Only three shapes carry prose.
 */

/** Tool payloads are kept only as a preview; the full text is never stored. */
const TOOL_PREVIEW_LIMIT = 2000;

/** Path segments that would reach the prototype chain instead of the data. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Response part kinds that carry no prose, with what they actually are. */
const NOISE_KINDS = new Map([
  ['inlineReference', 'a link to a symbol'],
  ['textEditGroup', 'an edit applied to a file'],
  ['codeblockUri', 'the target of a code block'],
  ['prepareToolInvocation', 'UI state'],
  ['undoStop', 'UI state'],
  ['progressMessage', 'UI state'],
  ['progressTask', 'UI state'],
  ['command', 'UI state'],
  ['confirmation', 'UI state'],
  ['warning', 'UI state'],
  ['codeCitation', 'attribution metadata'],
]);

/**
 * Apply a delta log to reconstruct the final session object.
 *
 * @param {Iterable<unknown>} records Parsed lines, in file order.
 * @returns {object|null} The session, or null when no snapshot was seen.
 */
function applyDeltas(records) {
  let session = null;

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;

    if (record.kind === 0) {
      session = record.v && typeof record.v === 'object' ? record.v : null;
      if (session && !Array.isArray(session.requests)) session.requests = [];
      continue;
    }

    if (!session || !Array.isArray(record.k) || record.k.length === 0) continue;

    // The path comes from a file this app does not write. A key of __proto__ or
    // constructor would let one line of a session log alter every object in the
    // process, so such a path is refused rather than followed.
    if (record.k.some((step) => UNSAFE_KEYS.has(step))) continue;

    // Walk to the parent of the target, creating nothing: a path into a branch
    // the snapshot never had is a malformed log, not a value to invent.
    let target = session;
    let reachable = true;
    for (let i = 0; i < record.k.length - 1; i += 1) {
      const step = record.k[i];
      if (target == null || typeof target !== 'object') {
        reachable = false;
        break;
      }
      target = target[step];
    }
    if (!reachable || target == null || typeof target !== 'object') continue;

    const leaf = record.k[record.k.length - 1];

    if (record.kind === 1) {
      target[leaf] = record.v;
    } else if (record.kind === 2) {
      // Append, and ONLY at the named path. This is the distinction that
      // inflated a 3-request session to 134 when it was got wrong.
      if (!Array.isArray(target[leaf])) target[leaf] = [];
      const values = Array.isArray(record.v) ? record.v : [record.v];
      target[leaf].push(...values);
    }
  }

  return session;
}

/**
 * Turn one `request` into the pair of turns it represents.
 *
 * @param {unknown} request
 * @param {{creationDate?: number, lastMessageDate?: number}} [session]
 * @returns {object[]} Zero, one or two normalised items.
 */
function extractRequest(request, session = {}) {
  if (!request || typeof request !== 'object') return [];

  const out = [];
  // 36 of 61 measured requests store -1; only the session dates are dependable.
  const askedAt = epoch(request.timestamp) || epoch(session.creationDate);
  const answeredAt =
    epoch(request.responseTimestamp) || askedAt || epoch(session.lastMessageDate);

  const prompt = str(request.message && request.message.text).trim();
  if (prompt) {
    out.push(item('user', prompt, askedAt, { model: '' }));
  }

  const answer = readResponse(request.response);
  if (answer.text || answer.thinking || answer.parts.length > 0) {
    out.push(
      item('assistant', answer.text, answeredAt, {
        model: str(request.modelId),
        thinking: answer.thinking,
        extraParts: answer.parts,
      })
    );
  }

  // Four of 53 measured requests failed or were cancelled. Their prompt was
  // stored and nothing else, so the transcript showed a question the assistant
  // appeared to have ignored — the reason it never answered was on disk the
  // whole time, in result.errorDetails.
  const failure = failureOf(request);
  if (failure) {
    out.push(
      item('assistant', failure.text, answeredAt, {
        model: str(request.modelId),
        isNotice: true,
        // A code the renderer names in the reader's language: « failure », « cancelled ».
        command: { name: failure.code, args: '' },
      })
    );
  }

  return out;
}

/**
 * Why this turn produced no answer, or null when it did: the tool's own
 * message when it gave one, and what kind of ending it was.
 * @returns {{code: 'failure'|'cancelled', text: string} | null}
 */
function failureOf(request) {
  const details = request.result && request.result.errorDetails;
  const message = details && typeof details === 'object' ? str(details.message).trim() : '';
  if (message) return { code: 'failure', text: message };
  return request.isCanceled === true ? { code: 'cancelled', text: '' } : null;
}

/**
 * Collect prose, reasoning and tool previews from `request.response[]`.
 *
 * Prose arrives as STREAMED FRAGMENTS — "Voici ", "la ", "reponse" — so the
 * pieces are concatenated end to end with no separator and trimmed only once,
 * at the end. Joining them with a newline, or trimming each fragment, tears
 * words apart.
 */
function readResponse(response) {
  const texts = [];
  const thoughts = [];
  const parts = [];

  for (const part of Array.isArray(response) ? response : []) {
    if (part == null) continue;

    // A bare markdown string arrives with no `kind` at all.
    if (typeof part === 'string') {
      pushText(part, texts);
      continue;
    }
    if (typeof part !== 'object') continue;

    if (part.kind === undefined) {
      if (typeof part.value === 'string') pushText(part.value, texts);
      continue;
    }

    if (part.kind === 'markdownContent') {
      pushText(str(part.content && part.content.value), texts);
      continue;
    }

    if (part.kind === 'thinking') {
      const value = (typeof part.value === 'string' ? part.value : str(part.text)).trim();
      if (value) {
        thoughts.push(value);
        parts.push({ type: 'thinking', text: value });
      }
      continue;
    }

    if (part.kind === 'toolInvocationSerialized' || part.kind === 'toolInvocation') {
      parts.push({
        type: 'tool_use',
        id: str(part.toolCallId),
        name: str(part.toolId) || str(part.toolSpecificData && part.toolSpecificData.kind) || 'outil',
        preview: preview(part.invocationMessage ?? part.toolSpecificData ?? part.resultDetails),
      });
      continue;
    }

    if (NOISE_KINDS.has(part.kind)) continue;

    parts.push({ type: 'other', name: str(part.kind) || 'part' });
  }

  // Fragments concatenate; the render plan gets ONE text part, not a hundred.
  const text = texts.join('').trim();
  const rendered = parts.filter((p) => p.type !== 'text');
  if (text) rendered.unshift({ type: 'text', text });

  return { text, thinking: thoughts.join('\n').trim(), parts: rendered };
}

function pushText(value, texts) {
  const text = str(value);
  if (text) texts.push(text);
}

function item(role, text, timestamp, extra = {}) {
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  for (const part of extra.extraParts || []) {
    if (part.type !== 'text') parts.push(part);
  }

  return {
    kind: 'message',
    role,
    uuid: '',
    parentUuid: null,
    timestamp,
    cwd: '',
    gitBranch: '',
    version: '',
    model: str(extra.model),
    text,
    thinking: str(extra.thinking),
    parts,
    isMeta: false,
    isNotice: Boolean(extra.isNotice),
    isSidechain: false,
    command: extra.command || null,
  };
}

/** Epoch milliseconds to ISO, rejecting the -1 that means "unknown". */
function epoch(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function preview(value) {
  if (value == null) return '';
  let text;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'object' && typeof value.value === 'string') text = value.value;
  else text = stringify(value);
  return text.length > TOOL_PREVIEW_LIMIT ? `${text.slice(0, TOOL_PREVIEW_LIMIT)}…` : text;
}

function stringify(value) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** `file:///home/zam/mon%20projet` -> `/home/zam/mon projet`. */
function folderFromUri(uri) {
  const value = str(uri);
  if (!value) return null;
  const withoutScheme = value.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(withoutScheme) || null;
  } catch {
    return withoutScheme || null;
  }
}

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = {
  applyDeltas,
  extractRequest,
  readResponse,
  folderFromUri,
  epoch,
  NOISE_KINDS,
  TOOL_PREVIEW_LIMIT,
};
