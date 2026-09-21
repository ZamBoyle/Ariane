'use strict';

/**
 * Antigravity CLI (`agy`) adapter.
 *
 * Layout:
 *   ~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl
 *   ~/.gemini/antigravity-cli/conversations/<id>.db          live store, protobuf
 *   ~/.gemini/antigravity-cli/conversation_summaries.db      an index, not maintained
 *
 * **The protobuf is a decoy.** `agy` keeps its live state in one SQLite file per
 * conversation, whose `steps.step_payload` is schema-less protobuf — measured at
 * 7.37 bits/byte, 36 % readable. Decoding that was judged too costly, and the
 * judgement was right; it was also unnecessary. Beside it, `agy` writes a plain
 * JSONL log with the whole conversation in clear text, one record per line:
 *
 *   {step_index, source, type, status, created_at, content, thinking,
 *    truncated_fields}
 *
 * `source` is what makes this adapter honest: `USER_EXPLICIT` is the person,
 * `MODEL` is the assistant, `SYSTEM` is the harness. Nothing has to be guessed
 * from the shape of the text.
 *
 * ── The working directory, which `agy` does not record ─────────────────────
 * Ariane groups by the folder a conversation ran in, and `agy` writes it
 * nowhere reliable: not in the log, not in the conversation's own database.
 * `conversation_summaries.db` has a `workspace_uris` column but is not kept up
 * to date — measured on a real corpus: 2 rows, dated eight months before the 15
 * conversations on disk.
 *
 * So the folder comes from three sources, in this order, and never from a guess:
 *
 *   1. `workspace_uris`, when a row exists          -> exact
 *   2. DERIVED, when it can be derived              -> marked approximate
 *   3. nothing                                      -> null, "unknown folder"
 *
 * The derivation is a subtraction, not a guess: the person writes a RELATIVE
 * path in their request ("Lis debate-papier/00-LECTURE.md") that a tool call
 * later resolves to an ABSOLUTE one; an absolute path ending in that relative
 * path names the directory they were standing in. **One candidate or nothing**:
 * two candidates mean ambiguity, and ambiguity is ignorance. Measured over 15
 * conversations: 7 derived, each with exactly one candidate, every one pointing
 * at a directory that exists. Of the eight others, five genuinely have no
 * folder to find — they name no file at all.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const Database = require('better-sqlite3');

const { readRecords } = require('../jsonl');
const { remember, stampOf } = require('../memo');
const { TOOL_PREVIEW_LIMIT } = require('../extract');

const ID = 'antigravity';

const TRANSCRIPT = path.join('.system_generated', 'logs', 'transcript.jsonl');

/**
 * Wrapper blocks the harness writes into a prompt. As in extract.js this is an
 * ALLOWLIST, and for the same reason: a generic "strip anything in angle
 * brackets" rule would eat the real prose. Measured on this corpus, the model
 * and the person write `<b>`, `<em>`, `<li>`, `<html>` and `<style>` in their
 * own text.
 *
 * `<USER_REQUEST>` is UNWRAPPED — what it holds IS the request. The other two
 * are removed with their contents: they say what time it is and which model was
 * picked, and indexing them would make every conversation match on
 * "Model Selection".
 */
const UNWRAPPED = ['USER_REQUEST'];
const INJECTED = ['ADDITIONAL_METADATA', 'USER_SETTINGS_CHANGE'];

const UNWRAP_RE = new RegExp(`<\\/?(?:${UNWRAPPED.join('|')})>`, 'g');
const INJECTED_RE = new RegExp(`<(${INJECTED.join('|')})>[\\s\\S]*?<\\/\\1>`, 'g');

/** What the harness says about the session rather than in it, and its code. */
const NOTICES = {
  CHECKPOINT: 'compact-boundary', // "earlier parts … truncated due to its length"
  ERROR_MESSAGE: 'failure',
  SYSTEM_MESSAGE: null, // no name of ours: the reader is shown "Notice"
};

/** Record types that carry no conversation, with why — counted, never silent. */
const IGNORED_TYPES = new Map();

function root(ctx = {}) {
  const own = ctx.env && ctx.env.ANTIGRAVITY_CLI_DIR;
  if (own && own.trim()) return path.resolve(own.trim());
  const gemini = ctx.env && ctx.env.GEMINI_CONFIG_DIR;
  const base = gemini && gemini.trim() ? path.resolve(gemini.trim()) : path.join(ctx.home || require('os').homedir(), '.gemini');
  return path.join(base, 'antigravity-cli');
}

const brainDir = (ctx) => path.join(root(ctx), 'brain');
const conversationsDir = (ctx) => path.join(root(ctx), 'conversations');
const summariesFile = (ctx) => path.join(root(ctx), 'conversation_summaries.db');

const adapter = {
  id: ID,
  label: 'Antigravity CLI',
  // GEMINI_CONFIG_DIR moves this agent too: `agy` stores its data inside
  // ~/.gemini. Declared so a test that blanks every root blanks this one.
  envKeys: ['ANTIGRAVITY_CLI_DIR', 'GEMINI_CONFIG_DIR'],
  root,

  detect(ctx = {}) {
    try {
      return fs.statSync(brainDir(ctx)).isDirectory();
    } catch {
      return false;
    }
  },

  async *discover(ctx = {}) {
    const base = brainDir(ctx);

    let entries;
    try {
      entries = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      return;
    }

    const exact = await knownWorkspaces(ctx);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(base, entry.name, TRANSCRIPT);

      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        continue; // a brain directory without a log: nothing to read
      }

      const header = await remember(ctx, `antigravity:header:${filePath}`, stampOf(stat), () =>
        readHeader(filePath)
      );

      const folder = exact.get(entry.name)
        ? { path: exact.get(entry.name), exact: true }
        : { path: await deriveFolder(ctx, entry.name, header.mentions), exact: false };

      yield {
        sessionId: entry.name,
        key: filePath,
        fingerprint: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
        folderPath: folder.path,
        folderExact: folder.exact && Boolean(folder.path),
        title: header.title || undefined,
        bytes: stat.size,
        // adapter-private
        filePath,
      };
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
      yield { item: extractAntigravityRecord(record.value), cursor: next };
    }
  },
};

/**
 * Normalise one record of the log.
 *
 * @returns {{kind: 'message'|'ignored'} & object}
 */
function extractAntigravityRecord(raw) {
  if (!raw || typeof raw !== 'object') return { kind: 'ignored', reason: 'not-an-object' };

  const source = str(raw.source);
  const type = str(raw.type);
  const content = str(raw.content);
  const thinking = str(raw.thinking);

  if (IGNORED_TYPES.has(type)) {
    return { kind: 'ignored', reason: 'known-noise', detail: IGNORED_TYPES.get(type) };
  }

  if (source === 'SYSTEM') {
    if (!Object.hasOwn(NOTICES, type)) return { kind: 'ignored', reason: `system:${type || 'unknown'}` };
    return message(raw, {
      role: 'assistant',
      text: content.trim(),
      isNotice: true,
      command: NOTICES[type] ? { name: NOTICES[type], args: '' } : null,
    });
  }

  if (source === 'USER_EXPLICIT') {
    // The only place the person speaks. Envelopes off before anything else.
    const text = cleanPrompt(content);
    if (!text) return { kind: 'ignored', reason: 'empty-prompt' };
    return message(raw, { role: 'user', text });
  }

  if (source !== 'MODEL') return { kind: 'ignored', reason: `source:${source || 'unknown'}` };

  // Tool machinery, written by the model but said by nobody: stored as a
  // truncated result so the reader sees that something ran, never indexed, and
  // credited to no one (format.isToolResultTurn).
  if (type === 'GENERIC') {
    if (!content.trim()) return { kind: 'ignored', reason: 'empty-tool-output' };
    return message(raw, {
      role: 'user',
      text: '',
      parts: [{ type: 'tool_result', id: '', isError: false, preview: content.slice(0, TOOL_PREVIEW_LIMIT) }],
    });
  }

  if (type !== 'PLANNER_RESPONSE') return { kind: 'ignored', reason: `model:${type || 'unknown'}` };

  // 107 of 118 measured replies carry no text at all — a thought, or nothing.
  // They are kept, like Claude's empty shells, so the counts stay honest;
  // format.hasContent() decides what is worth drawing.
  return message(raw, { role: 'assistant', text: content.trim(), thinking });
}

/** One normalised message, shaped like extract.js output. */
function message(raw, { role, text = '', thinking = '', parts = null, isNotice = false, command = null }) {
  const body = parts || (text ? [{ type: 'text', text }] : []);
  if (thinking) body.unshift({ type: 'thinking', text: thinking });
  return {
    kind: 'message',
    role,
    uuid: '',
    parentUuid: null,
    timestamp: str(raw.created_at),
    cwd: '',
    gitBranch: '',
    version: '',
    model: '',
    text,
    thinking,
    parts: body,
    isMeta: false,
    isNotice,
    isSidechain: false,
    command,
  };
}

/**
 * A prompt as the person wrote it: the request unwrapped, the harness's own
 * additions removed with their contents.
 */
function cleanPrompt(value) {
  if (typeof value !== 'string') return '';
  return value.replace(INJECTED_RE, '').replace(UNWRAP_RE, '').trim();
}

/**
 * The opening of a conversation: its title, and the relative paths the person
 * named — the raw material the folder is derived from.
 */
async function readHeader(file) {
  const out = { title: '', mentions: [] };
  let seen = 0;

  try {
    for await (const record of readRecords(file)) {
      const value = record.value;
      if (!value || typeof value !== 'object') continue;
      if (str(value.source) === 'USER_EXPLICIT') {
        const text = cleanPrompt(str(value.content));
        if (text) {
          if (!out.title) out.title = titleOf(text);
          out.mentions.push(...relativeMentions(text));
        }
      }
      if (++seen > 200) break; // the person speaks early, or not at all
    }
  } catch {
    /* unreadable: no title, no derivation — never a guess */
  }
  out.mentions = [...new Set(out.mentions)];
  return out;
}

/** The first line that says something, short enough to be a title. */
function titleOf(text) {
  for (const line of text.split('\n')) {
    const clean = line.replace(/^#+\s*/, '').trim();
    if (clean) return clean.slice(0, 120);
  }
  return '';
}

/**
 * `debate-papier/00-LECTURE.md`, `dossier/` — a path as one writes it in a
 * sentence. The segments accept anything but whitespace and the punctuation a
 * sentence puts around a path: `\w` alone would stop at the first accent, and
 * `Mathématiques/notes.md` is a path like any other.
 */
const SEGMENT = '[^\\s"\'`<>|*?()\\[\\]{},;:]';
const RELATIVE = new RegExp(`(?:^|[\\s"\'\`([])((?:${SEGMENT}+\\/){1,6}${SEGMENT}*)`, 'g');

function relativeMentions(text) {
  const found = [];
  for (const match of String(text).matchAll(RELATIVE)) {
    const rel = match[1].replace(/\/$/, '');
    if (!rel || rel.startsWith('/') || rel.includes('://')) continue;
    // A bare "x.y/z" is far more often a URL or a version than a path.
    if (/^[\w.-]+\.[a-z]{2,4}\//i.test(match[1])) continue;
    found.push(rel);
  }
  return found;
}

/**
 * The subtraction. Absolute paths come from the conversation's own database —
 * the tool calls recorded there — and an absolute path ending in a relative one
 * the person wrote names the directory they were in.
 *
 * @returns {Promise<string|null>} One candidate, or nothing.
 */
async function deriveFolder(ctx, id, mentions) {
  if (!mentions.length) return null;

  const dbFile = path.join(conversationsDir(ctx), `${id}.db`);
  let stat;
  try {
    stat = await fsp.stat(dbFile);
  } catch {
    return null;
  }

  const absolutes = await remember(ctx, `antigravity:paths:${dbFile}`, stampOf(stat), () =>
    absolutePathsIn(dbFile)
  );
  if (!absolutes.length) return null;

  const candidates = new Set();
  for (const absolute of absolutes) {
    for (const rel of mentions) {
      if (!absolute.endsWith(`/${rel}`)) continue;
      const dir = absolute.slice(0, -(rel.length + 1));
      // A directory that is only the home, or shorter, names nothing useful.
      if (dir.split('/').filter(Boolean).length < 3) continue;
      candidates.add(dir);
    }
  }
  // Two candidates mean the evidence disagrees, and a disagreement is not a
  // finding: the conversation goes to the unknown folder rather than to a
  // plausible one.
  return candidates.size === 1 ? [...candidates][0] : null;
}

/** Every absolute path the conversation's store mentions, tool calls included. */
function absolutePathsIn(dbFile) {
  const found = new Set();
  let db;
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }
  try {
    for (const table of ['steps', 'gen_metadata']) {
      let rows;
      try {
        rows = db.prepare(`SELECT * FROM ${table}`).all();
      } catch {
        continue;
      }
      for (const row of rows) {
        for (const value of Object.values(row)) {
          if (Buffer.isBuffer(value)) for (const run of readableRuns(value)) collectPaths(run, found);
          else if (typeof value === 'string') collectPaths(value, found);
        }
      }
    }
  } catch {
    /* a store being written to: this pass derives nothing, the next one will */
  } finally {
    try {
      db.close();
    } catch {
      /* already gone */
    }
  }
  return [...found];
}

/**
 * An absolute POSIX path, accents and all. Spaces are NOT allowed inside: in
 * prose they would swallow the rest of the sentence ("lis /home/ada/projet et
 * dis-moi"), and a path that really holds one arrives percent-encoded.
 */
const ABSOLUTE = new RegExp(`(?:file://)?(/(?:${SEGMENT}+/)+${SEGMENT}+)`, 'g');

function collectPaths(text, found) {
  for (const match of String(text).matchAll(ABSOLUTE)) {
    let value = match[1];
    try {
      value = decodeURIComponent(value);
    } catch {
      /* not percent-encoded, or badly: take it as written */
    }
    // Antigravity's own kitchen is not a working directory.
    if (value.includes('/.gemini/')) continue;
    found.add(value.replace(/[.,;:)\]}]+$/, ''));
  }
}

/**
 * The readable runs of a blob: where paths hide inside protobuf.
 *
 * Everything above 0x7f is kept, lead bytes AND continuation bytes: taking only
 * the lead bytes cuts `santé` in two, and the half-path that comes out matches
 * nothing. It cost a test to see, because the paths on the corpus this was
 * written against are percent-encoded and never showed it.
 */
function readableRuns(buffer, min = 6) {
  const out = [];
  let run = [];
  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || (byte >= 32 && byte < 127) || byte >= 0x80) run.push(byte);
    else {
      if (run.length >= min) out.push(Buffer.from(run).toString('utf8'));
      run = [];
    }
  }
  if (run.length >= min) out.push(Buffer.from(run).toString('utf8'));
  return out;
}

/**
 * The only place `agy` states a working directory — when it states one at all.
 * Read once per pass, and only when the file changed.
 */
async function knownWorkspaces(ctx) {
  const file = summariesFile(ctx);
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return new Map();
  }
  const pairs = await remember(ctx, `antigravity:workspaces:${file}`, stampOf(stat), () => readWorkspaces(file));
  return new Map(pairs);
}

function readWorkspaces(file) {
  const pairs = [];
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    return pairs;
  }
  try {
    for (const row of db.prepare('SELECT conversation_id, workspace_uris FROM conversation_summaries').all()) {
      const id = str(row.conversation_id);
      if (!id) continue;
      let uris;
      try {
        uris = JSON.parse(str(row.workspace_uris) || '[]');
      } catch {
        continue; // an unreadable row vouches for nothing
      }
      if (!Array.isArray(uris) || !uris.length) continue;
      const first = str(uris[0]).replace(/^file:\/\//, '');
      if (!first.startsWith('/')) continue;
      try {
        pairs.push([id, decodeURIComponent(first)]);
      } catch {
        pairs.push([id, first]);
      }
    }
  } catch {
    /* no such table, or a store mid-write: no workspace is known this pass */
  } finally {
    try {
      db.close();
    } catch {
      /* already gone */
    }
  }
  return pairs;
}

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = adapter;
module.exports.extractAntigravityRecord = extractAntigravityRecord;
module.exports.cleanPrompt = cleanPrompt;
module.exports.relativeMentions = relativeMentions;
module.exports.titleOf = titleOf;
module.exports.readableRuns = readableRuns;
