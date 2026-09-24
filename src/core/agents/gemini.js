'use strict';

/**
 * Gemini CLI adapter.
 *
 * Layout, and the first trap is finding it at all:
 *   ~/.gemini/tmp/<slug>/chats/session-<ISO>-<id8>.jsonl   current
 *   ~/.gemini/tmp/<slug>/chats/session-<ISO>-<id8>.json    legacy snapshot
 *   ~/.gemini/tmp/<slug>/.project_root                     the real path
 *   ~/.gemini/projects.json                                {absoluteDir: slug}
 *
 * `~/.gemini/history/<slug>/` LOOKS like the transcript store and is a decoy:
 * it holds nothing but a `.project_root` file. The conversations are under
 * `tmp/`.
 *
 * Three things shape this file, all measured:
 *
 *  - The `.jsonl` is NOT one message per line. It is a mutation log where
 *    `{$set:{messages:[...]}}` REPLACES the accumulated array wholesale. Lines
 *    must be applied in order, and a parser that concatenates them multiplies
 *    the conversation.
 *  - `content` changes shape with the role: an ARRAY of `{text}` parts for
 *    `user` (29/29 measured), a PLAIN STRING for `gemini` (11/11). Assuming
 *    either shape silently drops one whole side of the conversation.
 *  - `projects.json` maps directory -> slug, so it must be INVERTED to go from
 *    a slug back to a path.
 *
 * ONE HONEST LIMITATION: on the corpus this was written against, model replies
 * are absent from every recent session. All 11 `gemini` turns came from the 7
 * legacy `.json` files; the 12 `.jsonl` files hold user prompts only. The
 * adapter reads whatever is there and does not pretend otherwise.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { readRecords } = require('../jsonl');
const { extractGenAiContent } = require('./genai-extract');
const { usageOf } = require('./contract');
const { remember, stampOf } = require('../memo');

const ID = 'gemini';

function root(ctx = {}) {
  const override = ctx.env && ctx.env.GEMINI_CONFIG_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(ctx.home || require('os').homedir(), '.gemini');
}

const tmpDir = (ctx) => path.join(root(ctx), 'tmp');

const adapter = {
  id: ID,
  label: 'Gemini CLI',
  envKeys: ['GEMINI_CONFIG_DIR'],
  root,

  detect(ctx = {}) {
    try {
      return fs.statSync(tmpDir(ctx)).isDirectory();
    } catch {
      return false;
    }
  },

  async *discover(ctx = {}) {
    const base = tmpDir(ctx);
    const slugToDir = await readProjectMap(ctx);

    let slugs;
    try {
      slugs = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      return;
    }

    for (const slug of slugs) {
      if (!slug.isDirectory()) continue;
      const slugDir = path.join(base, slug.name);
      const chatsDir = path.join(slugDir, 'chats');

      let files;
      try {
        files = await fsp.readdir(chatsDir);
      } catch {
        continue; // a tmp/ entry that holds no conversations
      }

      // Two independent exact sources; neither is a decoded directory name.
      const folder =
        slugToDir.get(slug.name) || (await readProjectRoot(path.join(slugDir, '.project_root')));

      for (const name of files) {
        const legacy = name.endsWith('.json');
        if (!legacy && !name.endsWith('.jsonl')) continue;

        const filePath = path.join(chatsDir, name);
        let stat;
        try {
          stat = await fsp.stat(filePath);
        } catch {
          continue;
        }

        // A legacy snapshot is parsed whole for its header: once per version.
        const header = await remember(ctx, `gemini:header:${filePath}`, stampOf(stat), () =>
          legacy ? readLegacyHeader(filePath) : readHeader(filePath)
        );

        yield {
          sessionId: header.sessionId || name.replace(/\.jsonl?$/, ''),
          key: filePath,
          fingerprint: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
          folderPath: folder || null,
          folderExact: Boolean(folder),
          folderOnDisk: Boolean(folder),
          bytes: stat.size,
          // adapter-private
          filePath,
          legacy,
          startedAt: header.startTime || '',
        };
      }
    }
  },

  /**
   * Never resume. `$set` replays the whole message array, so a partial read
   * would apply a replacement to a state we no longer hold. These files are
   * small (the largest corpus measured was 460 KB in total), so re-reading is
   * cheap and always correct.
   */
  canResume() {
    return false;
  },

  async *read(descriptor) {
    const messages = descriptor.legacy
      ? await readLegacyMessages(descriptor.filePath)
      : await replayLog(descriptor.filePath);

    for (const raw of messages) {
      const item = toItem(raw, descriptor);
      if (item) yield { item, cursor: null };
    }
  },
};

// ── the mutation log ────────────────────────────────────────────────────────

/**
 * Replay a `.jsonl` session into its final message list.
 *
 * Line 0 is a header. After that a line is either a `$set` mutation, whose
 * `messages` REPLACES what came before, or a bare appended turn.
 */
async function replayLog(file) {
  let messages = [];

  try {
    for await (const record of readRecords(file)) {
      const row = record.value;
      if (!row || typeof row !== 'object') continue;

      if (row.$set && typeof row.$set === 'object') {
        // Replacement, not a merge: anything accumulated so far is superseded.
        if (Array.isArray(row.$set.messages)) messages = row.$set.messages.slice();
        continue;
      }

      if (row.sessionId && row.startTime) continue; // the header
      if (row.type) messages.push(row);
    }
  } catch {
    return messages;
  }
  return messages;
}

async function readLegacyMessages(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return Array.isArray(parsed && parsed.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

// ── one turn ────────────────────────────────────────────────────────────────

/** @returns {object|null} A normalised item, or null when there is nothing to show. */
function toItem(raw, descriptor) {
  if (!raw || typeof raw !== 'object') return null;

  const type = str(raw.type);
  if (type !== 'user' && type !== 'gemini') return null;

  // The shape of `content` depends on the role; extractGenAiContent accepts both.
  const content = Array.isArray(raw.content)
    ? extractGenAiContent({ role: type === 'gemini' ? 'model' : 'user', parts: raw.content })
    : extractGenAiContent(str(raw.content), { role: type === 'gemini' ? 'model' : 'user' });

  const parts = content.parts.slice();

  for (const call of Array.isArray(raw.toolCalls) ? raw.toolCalls : []) {
    if (!call || typeof call !== 'object') continue;
    parts.push({
      type: 'tool_use',
      id: str(call.id),
      name: str(call.name) || 'outil',
      preview: preview(call.args ?? call.arguments),
    });
  }

  const thinking = content.thinking || thoughtsText(raw.thoughts);
  if (!content.text && !thinking && parts.length === 0) return null;

  return {
    kind: 'message',
    role: type === 'gemini' ? 'assistant' : 'user',
    uuid: str(raw.id),
    parentUuid: null,
    timestamp: str(raw.timestamp) || descriptor.startedAt,
    cwd: descriptor.folderPath || '',
    gitBranch: '',
    version: '',
    model: str(raw.model),
    usage: type === 'gemini' ? geminiUsage(raw.tokens) : null,
    text: content.text,
    thinking,
    parts,
    isMeta: false,
    // The harness injects a <session_context> preamble as if the user typed it.
    isNotice: /^\s*<session_context>/.test(content.text),
    isSidechain: false,
    command: null,
  };
}

/**
 * Gemini's counts in the contract's words. Measured on every reply that
 * carries them (11, 24 September 2026): `total = input + output + thoughts +
 * tool`, every time. So `cached` is INSIDE `input` — taken out, as for Codex —
 * and `thoughts` is BESIDE `output`, added to it, since the contract's output
 * includes the reasoning. `tool` counts prompt tokens spent on tool results,
 * outside `input`: it joins the fresh input (always 0 in what was measured).
 */
function geminiUsage(tokens) {
  if (!tokens || typeof tokens !== 'object') return null;
  const n = (key) =>
    typeof tokens[key] === 'number' && tokens[key] >= 0 ? tokens[key] : undefined;
  const input = n('input');
  const cached = n('cached');
  const output = n('output');
  const thoughts = n('thoughts');
  return usageOf({
    input: input === undefined ? undefined : input - (cached || 0) + (n('tool') || 0),
    output: output === undefined ? undefined : output + (thoughts || 0),
    cacheRead: cached,
    reasoning: thoughts,
  });
}

function thoughtsText(thoughts) {
  if (typeof thoughts === 'string') return thoughts.trim();
  if (!Array.isArray(thoughts)) return '';
  return thoughts
    .map((t) => (typeof t === 'string' ? t : str(t && (t.text || t.subject))))
    .filter(Boolean)
    .join('\n')
    .trim();
}

// ── folder resolution ───────────────────────────────────────────────────────

/**
 * `projects.json` is `{projects: {"<absolute dir>": "<slug>"}}`, so it must be
 * inverted to answer the question we actually have: which directory is this slug?
 */
async function readProjectMap(ctx) {
  const map = new Map();
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(root(ctx), 'projects.json'), 'utf8'));
    const projects = parsed && parsed.projects;
    if (projects && typeof projects === 'object') {
      for (const [dir, slug] of Object.entries(projects)) {
        if (typeof slug === 'string' && slug && !map.has(slug)) map.set(slug, dir);
      }
    }
  } catch {
    /* absent or unreadable: .project_root is the other exact source */
  }
  return map;
}

async function readProjectRoot(file) {
  try {
    const value = (await fsp.readFile(file, 'utf8')).trim();
    return value || null;
  } catch {
    return null;
  }
}

// ── headers ─────────────────────────────────────────────────────────────────

async function readHeader(file) {
  try {
    for await (const record of readRecords(file)) {
      const row = record.value;
      if (row && typeof row === 'object' && row.sessionId) {
        return { sessionId: str(row.sessionId), startTime: str(row.startTime) };
      }
      break; // the header is line 0 or not present
    }
  } catch {
    /* fall through */
  }
  return { sessionId: '', startTime: '' };
}

async function readLegacyHeader(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return { sessionId: str(parsed && parsed.sessionId), startTime: str(parsed && parsed.startTime) };
  } catch {
    return { sessionId: '', startTime: '' };
  }
}

function preview(value) {
  if (value == null) return '';
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  } catch {
    text = '';
  }
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = adapter;
module.exports.replayLog = replayLog;
module.exports.toItem = toItem;
