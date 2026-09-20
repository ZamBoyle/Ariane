'use strict';

/**
 * Google GenAI `Content` extraction. Pure: same input, same output, no I/O.
 *
 * Shared by Qwen Code and the Gemini CLI, which both store a message as
 * `{role, parts[]}` rather than as Anthropic-style typed blocks. Three
 * differences matter and are the reason this could not be a manifest:
 *
 *  - The role is "model", not "assistant".
 *  - Reasoning is a FLAG on a part (`part.thought`), not a block type. A part
 *    can carry both `thought: true` and `text`, so skipping by type would keep
 *    the reasoning and skipping by text would drop the answer.
 *  - Tool calls and results are shapes, not types: a part is a tool call when
 *    it has `functionCall`, a result when it has `functionResponse`.
 *
 * `content` is also permissive: it may be an array of parts for one role and a
 * bare string for another, and assuming either shape silently drops a whole
 * side of the conversation.
 */

/** Tool payloads are kept only as a preview; the full text is never stored. */
const TOOL_PREVIEW_LIMIT = 2000;

/**
 * Normalise one GenAI `Content` into the parts the rest of the app expects.
 *
 * @param {unknown} content `{role, parts}`, or a bare string.
 * @param {{role?: string}} [options] Role to use when the content carries none.
 * @returns {{role: string, text: string, thinking: string, parts: object[]}}
 */
function extractGenAiContent(content, options = {}) {
  const out = { role: 'user', text: '', thinking: '', parts: [] };

  if (typeof content === 'string') {
    const value = content.trim();
    if (value) {
      out.text = value;
      out.parts.push({ type: 'text', text: value });
    }
    out.role = normaliseRole(options.role);
    return out;
  }

  if (!content || typeof content !== 'object') {
    out.role = normaliseRole(options.role);
    return out;
  }

  out.role = normaliseRole(content.role || options.role);

  const texts = [];
  const thoughts = [];

  for (const part of Array.isArray(content.parts) ? content.parts : []) {
    if (!part || typeof part !== 'object') continue;

    // Reasoning first: a part may carry `thought: true` AND `text`, so the flag
    // must win or the reasoning would be indexed as the answer.
    if (part.thought) {
      const value = str(part.text).trim();
      if (value) {
        thoughts.push(value);
        out.parts.push({ type: 'thinking', text: value });
      }
      continue;
    }

    if (part.functionCall && typeof part.functionCall === 'object') {
      out.parts.push({
        type: 'tool_use',
        id: str(part.functionCall.id),
        name: str(part.functionCall.name) || 'outil',
        preview: preview(part.functionCall.args),
      });
      continue;
    }

    if (part.functionResponse && typeof part.functionResponse === 'object') {
      out.parts.push({
        type: 'tool_result',
        id: str(part.functionResponse.id),
        isError: Boolean(part.functionResponse.error),
        preview: preview(part.functionResponse.response ?? part.functionResponse.error),
      });
      continue;
    }

    if (part.inlineData && typeof part.inlineData === 'object') {
      // Metadata only: the payload is base64 and would dwarf the conversation.
      out.parts.push({
        type: 'attachment',
        kind: String(part.inlineData.mimeType || '').startsWith('image/') ? 'image' : 'document',
        mediaType: str(part.inlineData.mimeType) || 'application/octet-stream',
        bytes: base64Bytes(part.inlineData.data),
      });
      continue;
    }

    if (typeof part.text === 'string') {
      const value = part.text.trim();
      if (value) {
        texts.push(value);
        out.parts.push({ type: 'text', text: value });
      }
      continue;
    }

    out.parts.push({ type: 'other', name: Object.keys(part)[0] || 'part' });
  }

  out.text = texts.join('\n').trim();
  out.thinking = thoughts.join('\n').trim();
  return out;
}

/** GenAI says "model" where the rest of this app says "assistant". */
function normaliseRole(role) {
  const value = str(role);
  if (value === 'model' || value === 'assistant') return 'assistant';
  return 'user';
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

/** Decoded byte length of a base64 payload, without decoding it. */
function base64Bytes(data) {
  if (typeof data !== 'string' || data.length === 0) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = { extractGenAiContent, normaliseRole, TOOL_PREVIEW_LIMIT };
