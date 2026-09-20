'use strict';

/**
 * Qwen Code adapter.
 *
 * Layout:
 *   ~/.qwen/projects/<encoded-path>/chats/<uuid>.jsonl
 *
 * Qwen borrowed Claude Code's ON-DISK ENVELOPE but not its message format, and
 * that split is the whole story of this file:
 *
 *   same as Claude   {uuid, parentUuid, sessionId, timestamp, type, cwd,
 *                     version, gitBranch}, and the same lossy directory naming
 *   different        `message` is a Google GenAI Content — role "model" rather
 *                    than "assistant", reasoning as a `thought` flag rather
 *                    than a block type, tool calls as `functionCall` shapes
 *   different        `tool_result` is a TOP-LEVEL record type here, where
 *                    Claude nests it as a block inside a user record
 *   different        four record types (user, assistant, tool_result, system)
 *                    against Claude's seventeen
 *
 * Note the extra `chats/` level that Claude does not have.
 *
 * Folder attribution is easy despite the lossy directory name: `cwd` is written
 * on EVERY record by createBaseRecord, so the first record settles it.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { readRecords } = require('../jsonl');
const { remember, stampOf } = require('../memo');
const { extractGenAiContent } = require('./genai-extract');
const paths = require('../paths');

const ID = 'qwen';

/** Record types that carry no conversation, with why. */
const IGNORED_TYPES = new Map([
  ['system', 'slash_command / compression / telemetry'],
]);

function root(ctx = {}) {
  const override = ctx.env && ctx.env.QWEN_CONFIG_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(ctx.home || require('os').homedir(), '.qwen');
}

const projectsDir = (ctx) => path.join(root(ctx), 'projects');

const adapter = {
  id: ID,
  label: 'Qwen Code',
  envKeys: ['QWEN_CONFIG_DIR'],
  root,

  detect(ctx = {}) {
    try {
      return fs.statSync(projectsDir(ctx)).isDirectory();
    } catch {
      return false;
    }
  },

  async *discover(ctx = {}) {
    const base = projectsDir(ctx);

    let entries;
    try {
      entries = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const chatsDir = path.join(base, entry.name, 'chats');

      let files;
      try {
        files = await fsp.readdir(chatsDir);
      } catch {
        continue; // a project directory without a chats/ level
      }

      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue;
        const filePath = path.join(chatsDir, name);

        let stat;
        try {
          stat = await fsp.stat(filePath);
        } catch {
          continue;
        }

        const header = await remember(ctx, `qwen:header:${filePath}`, stampOf(stat), () =>
          readHeader(filePath)
        );
        // The directory name is the same lossy encoding as Claude's, so it is
        // only ever a fallback for display.
        const folder = header.cwd
          ? { path: header.cwd, exact: true }
          : { path: paths.decodeHint(entry.name), exact: false };

        yield {
          sessionId: header.sessionId || name.slice(0, -'.jsonl'.length),
          key: filePath,
          fingerprint: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
          folderPath: folder.path,
          folderExact: folder.exact,
          bytes: stat.size,
          // adapter-private
          filePath,
          dirName: entry.name,
        };
      }
    }
  },

  canResume(descriptor, cursor) {
    const offset = Number(cursor);
    return Number.isFinite(offset) && offset <= (descriptor.bytes ?? 0);
  },

  async *read(descriptor, { cursor = null } = {}) {
    const start = cursor == null ? 0 : Number(cursor) || 0;
    let last = cursor;

    for await (const record of readRecords(descriptor.filePath, { start })) {
      const next = record.endOffset > record.offset ? String(record.endOffset) : last;
      last = next;
      yield { item: extractQwenRecord(record.value), cursor: next };
    }
  },
};

/**
 * Normalise one Qwen record.
 * @returns {{kind: 'message'|'ignored'} & object}
 */
function extractQwenRecord(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'ignored', reason: 'not-an-object' };

  const type = str(raw.type);
  if (IGNORED_TYPES.has(type)) {
    return { kind: 'ignored', reason: 'known-noise', detail: IGNORED_TYPES.get(type) };
  }

  // tool_result is its own record type here rather than a nested block.
  const isToolResult = type === 'tool_result';
  if (type !== 'user' && type !== 'assistant' && !isToolResult) {
    return { kind: 'ignored', reason: `type:${type || 'unknown'}` };
  }

  const content = extractGenAiContent(raw.message, {
    role: isToolResult ? 'user' : type,
  });

  if (!content.text && !content.thinking && content.parts.length === 0) {
    return { kind: 'ignored', reason: 'empty-message' };
  }

  return {
    kind: 'message',
    role: isToolResult ? 'user' : content.role,
    uuid: str(raw.uuid),
    parentUuid: raw.parentUuid == null ? null : str(raw.parentUuid),
    timestamp: str(raw.timestamp),
    cwd: str(raw.cwd),
    gitBranch: str(raw.gitBranch),
    version: str(raw.version),
    model: str(raw.model),
    text: content.text,
    thinking: content.thinking,
    parts: content.parts,
    isMeta: false,
    isNotice: false,
    isSidechain: false,
    command: null,
  };
}

/** `cwd` is on every record, so the first one settles the folder. */
async function readHeader(file) {
  const out = { cwd: '', sessionId: '' };
  let seen = 0;

  try {
    for await (const record of readRecords(file)) {
      const value = record.value;
      if (!value || typeof value !== 'object') continue;
      if (!out.cwd && typeof value.cwd === 'string' && value.cwd) out.cwd = value.cwd;
      if (!out.sessionId && typeof value.sessionId === 'string') out.sessionId = value.sessionId;
      if (out.cwd && out.sessionId) break;
      if (++seen > 50) break;
    }
  } catch {
    /* unreadable: the caller falls back to the directory name */
  }
  return out;
}

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = adapter;
module.exports.extractQwenRecord = extractQwenRecord;
