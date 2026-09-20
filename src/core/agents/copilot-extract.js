'use strict';

/**
 * GitHub Copilot CLI record extraction. Pure: same input, same output, no I/O.
 *
 * The log is an event stream rather than a message list, so the speaker comes
 * from the top-level `type` and not from a role field. Measured over 1803
 * records on a real 4.7 MB corpus:
 *
 *  - `tool.execution_complete` is 56.1% of all bytes on its own (`data.result`
 *    holds the whole tool output) and `tool.execution_start` another 7.7%.
 *  - `system.message` is 10.5%: the static system prompt, repeated once per
 *    session. Never conversation.
 *  - 200 of 275 `assistant.message` records carry an empty `content` and exist
 *    only to hold `toolRequests[]`. Emitting them as messages would produce 200
 *    blank bubbles.
 *  - `data.transformedContent` on a user message looks like the prompt but is
 *    a wrapped variant, ~166 bytes longer, carrying an injected preamble. The
 *    person's actual words are in `data.content`.
 *
 * The result is 3.54% of the bytes on disk.
 */

/** Tool payloads are kept only as a preview; the full text is never stored. */
const TOOL_PREVIEW_LIMIT = 2000;

/** Event types with no conversational value, and why they are skipped. */
const IGNORED_TYPES = new Map([
  ['assistant.turn_start', 'lifecycle'],
  ['assistant.turn_end', 'lifecycle'],
  ['permission.requested', 'lifecycle'],
  ['permission.completed', 'lifecycle'],
  ['session.shutdown', 'lifecycle'],
  ['session.model_change', 'lifecycle'],
  ['session.usage_checkpoint', 'accounting'],
  ['system.message', 'static system prompt'],
  ['skill.invoked', 'skill body, not conversation'],
  // Named rather than left unrecognised: every one was read on a real corpus
  // and holds model pricing, feature flags or a hook's own bookkeeping. The
  // one prompt a `hook.start` carried was also stored as a `user.message`.
  ['hook.start', 'hook bookkeeping'],
  ['hook.end', 'hook bookkeeping'],
  ['session.resume', 'lifecycle'],
  ['session.auto_mode_resolved', 'lifecycle'],
  ['model.turn_started', 'lifecycle'],
  ['model.turn_ended', 'lifecycle'],
  ['model.model_call_started', 'lifecycle'],
  ['model.captured_assignment_context', 'feature flags'],
  ['model.model_call_failure', 'covered by model.turn_failed'],
]);

/**
 * Normalise one Copilot CLI event.
 * @param {unknown} raw A parsed JSONL line.
 * @returns {{kind: 'message'|'meta'|'ignored'} & object}
 */
function extractCopilotRecord(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'ignored', reason: 'not-an-object' };

  const type = str(raw.type);
  const data = raw.data && typeof raw.data === 'object' ? raw.data : {};
  const timestamp = str(raw.timestamp);

  if (type === 'session.start') {
    const context = data.context && typeof data.context === 'object' ? data.context : {};
    return {
      kind: 'meta',
      cwd: str(context.cwd),
      gitRoot: str(context.gitRoot),
      gitBranch: str(context.branch),
      sessionId: str(data.sessionId),
      model: str(data.selectedModel),
      timestamp: str(data.startTime) || timestamp,
    };
  }

  if (IGNORED_TYPES.has(type)) {
    return { kind: 'ignored', reason: 'known-noise', detail: IGNORED_TYPES.get(type) };
  }

  if (type === 'tool.execution_start') {
    return {
      kind: 'ignored',
      reason: 'known-noise',
      detail: 'tool start',
      part: {
        type: 'tool_use',
        id: str(data.toolCallId),
        name: str(data.name) || str(data.toolTitle) || 'outil',
        preview: preview(data.arguments),
      },
    };
  }

  if (type === 'tool.execution_complete') {
    return {
      kind: 'ignored',
      reason: 'known-noise',
      detail: 'tool result',
      part: {
        type: 'tool_result',
        id: str(data.toolCallId),
        isError: Boolean(data.error) || data.status === 'error',
        preview: preview(data.result ?? data.error),
      },
    };
  }

  // A turn that never produced an answer. Without this the transcript ends on
  // the person's question, reading as if the assistant had simply ignored it.
  if (type === 'model.turn_failed') {
    const reason = str(data.error) || str(data.reason);
    if (!reason) return { kind: 'ignored', reason: 'known-noise', detail: 'turn failed, no reason given' };
    return {
      kind: 'message',
      role: 'assistant',
      uuid: str(raw.id),
      parentUuid: str(raw.parentId) || null,
      timestamp,
      cwd: '',
      gitBranch: '',
      version: '',
      model: str(data.model),
      // The tool's own words; what they are — a failure — travels as a code.
      text: reason,
      thinking: '',
      parts: [],
      isMeta: false,
      isNotice: true,
      isSidechain: false,
      command: { name: 'failure', args: '' },
    };
  }

  if (type === 'user.message') {
    // data.content, never transformedContent: the latter wraps the prompt in an
    // injected preamble, so indexing it would attribute words nobody typed.
    const text = str(data.content).trim();
    if (!text) return { kind: 'ignored', reason: 'empty-user-message' };
    return message('user', text, timestamp, {
      // A message carrying a `source` was generated by the tool, not typed.
      isNotice: Boolean(data.source),
    });
  }

  if (type === 'assistant.message') {
    const text = str(data.content).trim();
    const parts = [];

    for (const request of Array.isArray(data.toolRequests) ? data.toolRequests : []) {
      if (!request || typeof request !== 'object') continue;
      parts.push({
        type: 'tool_use',
        id: str(request.toolCallId),
        name: str(request.name) || str(request.toolTitle) || 'outil',
        preview: preview(request.arguments),
      });
    }

    // 200 of 275 such records have no prose at all; without parts they are pure noise.
    if (!text && parts.length === 0) return { kind: 'ignored', reason: 'empty-assistant-message' };

    return message('assistant', text, timestamp, {
      parts,
      model: str(data.model),
      // reasoningText is kept for display but, like Claude's thinking, is never indexed.
      thinking: str(data.reasoningText).trim(),
    });
  }

  return { kind: 'ignored', reason: `type:${type || 'unknown'}` };
}

function message(role, text, timestamp, extra = {}) {
  const parts = extra.parts ? extra.parts.slice() : [];
  if (text) parts.unshift({ type: 'text', text });
  const thinking = str(extra.thinking);
  if (thinking) parts.push({ type: 'thinking', text: thinking });

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
    thinking,
    parts,
    isMeta: false,
    isNotice: Boolean(extra.isNotice),
    isSidechain: false,
    command: null,
  };
}

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

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = { extractCopilotRecord, IGNORED_TYPES, TOOL_PREVIEW_LIMIT };
