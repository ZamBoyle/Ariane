'use strict';

/**
 * Claude Code adapter — the reference implementation of the contract.
 *
 * Layout:
 *   ~/.claude/projects/<encoded-path>/<sessionId>.jsonl   transcripts
 *   ~/.claude/projects/<encoded-path>/sessions-index.json  holds originalPath
 *   ~/.claude/history.jsonl                                every prompt + its folder
 *
 * Two things make this agent worth reading closely, because other adapters hit
 * the same problems:
 *
 *  - The directory name is a LOSSY encoding of the project path (accents
 *    destroyed, real hyphens indistinguishable from separators), so the real
 *    path comes from `originalPath` or from a message's `cwd`, never from the
 *    directory name.
 *  - `history.jsonl` outlives the transcripts. Sessions whose transcript was
 *    purged are surfaced as synthetic prompt-only sessions rather than lost.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const paths = require('../paths');
const { readRecords } = require('../jsonl');
const { extractRecord } = require('../extract');
const { remember, stampOf } = require('../memo');
const { USAGE_FIELDS } = require('./contract');

const ID = 'claude';

/** Marks the synthetic sessions rebuilt from history.jsonl. */
const HISTORY_KEY = 'history';

/** Same ceiling as every other stored preview: enough to recognise, not to store. */
const PASTE_PREVIEW_LIMIT = 2000;

const adapter = {
  id: ID,
  label: 'Claude Code',
  envKeys: ['CLAUDE_CONFIG_DIR'],
  // A resumed session begins with a copy of the one it resumes, uuids and
  // times unchanged (contract.js).
  globalIds: true,

  root(ctx = {}) {
    return paths.configDir(ctx.env, ctx.home);
  },

  detect(ctx = {}) {
    return paths.isAvailable(ctx.env, ctx.home);
  },

  async *discover(ctx = {}) {
    yield* discoverTranscripts(ctx);
    yield* discoverHistoryOnly(ctx);
  },

  /**
   * A byte offset past the current end of file means the transcript was
   * rewritten shorter, so everything stored for it is stale.
   */
  canResume(descriptor, cursor) {
    if (descriptor.source === HISTORY_KEY) return false;
    const { offset } = parseCursor(cursor);
    return Number.isFinite(offset) && offset <= (descriptor.bytes ?? 0);
  },

  async *read(descriptor, { cursor = null, ctx = {} } = {}) {
    if (descriptor.source === HISTORY_KEY) {
      yield* readHistorySession(descriptor, ctx);
      return;
    }

    const resumed = parseCursor(cursor);
    const start = cursor == null ? 0 : resumed.offset || 0;
    // The reply whose usage was counted last, and how much of it was: carried
    // in the cursor so that a pass resuming between two lines of one reply
    // counts only what the later lines add.
    let counted = resumed.reply;
    let seen = resumed.seen;
    let last = cursor;

    for await (const record of readRecords(descriptor.filePath, { start })) {
      let item = extractRecord(record.value);
      const reply = replyIdOf(record.value);
      if (reply && item.kind === 'message' && item.usage) {
        if (reply !== counted) {
          counted = reply;
          seen = item.usage;
        } else {
          const usage = seen ? growth(item.usage, seen) : null;
          if (seen) seen = highest(item.usage, seen);
          item = { ...item, usage };
        }
      }
      // A trailing line with no newline reports endOffset === offset; yielding
      // the previous cursor makes the indexer re-read it once complete.
      const next =
        record.endOffset > record.offset ? makeCursor(record.endOffset, counted, seen) : last;
      last = next;
      yield { item, cursor: next };
    }
  },
};

// ── one reply, several lines ────────────────────────────────────────────────

/**
 * Claude Code writes one reply as several lines — its thinking, its text, each
 * tool call — and every line carries the reply's usage. Stored as it came, a
 * conversation counted its tokens 2.26 times over: 34 096 lines carried usage
 * for 15 069 replies (24 September 2026), and on the largest conversation
 * Ariane 0.3.3 showed 2.2 G read where the truth was 1.0 G. The lines of a
 * reply share `message.id` and always follow one another — not one exception
 * in 434 transcripts, subagents included.
 *
 * But the lines do not always carry the SAME usage. In a main transcript they
 * repeat the final count, every time (6 379 replies of several lines, none
 * differing). In a subagent's transcript each line holds the count as it stood
 * when it was written — `8, 8, 177` — and only the last is the reply's
 * (4 169 of 4 484; counting the first line read 235 K for 4.4 M, 25 September
 * 2026; anthropics/claude-code#93620). So a line counts what it ADDS to the
 * highest count already seen for its reply: the whole of it for the first
 * line, nothing for a repeat, the growth for a later snapshot. The sum over a
 * reply is then its highest count, whichever kind of file it came from.
 */
function replyIdOf(raw) {
  if (!raw || raw.type !== 'assistant' || !raw.message) return null;
  return typeof raw.message.id === 'string' && raw.message.id ? raw.message.id : null;
}

/** What `usage` adds to `seen`, field by field; null when it adds nothing. */
function growth(usage, seen) {
  const added = {};
  let any = false;
  for (const field of USAGE_FIELDS) {
    if (usage[field] == null) {
      added[field] = null;
      continue;
    }
    added[field] = Math.max(0, usage[field] - (seen[field] || 0));
    if (added[field] > 0) any = true;
  }
  return any ? added : null;
}

/** The highest count seen so far for each field. */
function highest(usage, seen) {
  const top = {};
  for (const field of USAGE_FIELDS) {
    const values = [usage[field], seen[field]].filter((v) => v != null);
    top[field] = values.length ? Math.max(...values) : null;
  }
  return top;
}

/**
 * "offset", "offset;msg_…" or "offset;msg_…;in,out,read,write,reasoning". A
 * cursor written before a part existed simply lacks it — and without the
 * counts, a later line of the same reply is not counted at all, as before.
 */
function makeCursor(offset, reply, seen) {
  if (!reply) return String(offset);
  if (!seen) return `${offset};${reply}`;
  const counts = USAGE_FIELDS.map((field) => (seen[field] == null ? '' : seen[field])).join(',');
  return `${offset};${reply};${counts}`;
}

function parseCursor(cursor) {
  if (cursor == null) return { offset: 0, reply: null, seen: null };
  const [offset, reply, counts] = String(cursor).split(';');
  let seen = null;
  if (counts) {
    const values = counts.split(',');
    seen = Object.fromEntries(
      USAGE_FIELDS.map((field, i) => [field, values[i] ? Number(values[i]) : null])
    );
  }
  return { offset: Number(offset), reply: reply || null, seen };
}

// ── discovery ───────────────────────────────────────────────────────────────

async function* discoverTranscripts(ctx) {
  const projectsDir = paths.projectsDir(ctx.env, ctx.home);

  let entries;
  try {
    entries = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(projectsDir, entry.name);

    let files;
    try {
      files = await fsp.readdir(dirPath);
    } catch {
      continue;
    }

    // Read once per directory, not once per session — and not once per pass.
    const originalPath = await rememberOriginalPath(ctx, paths.sessionsIndexFile(dirPath));

    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, name);

      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        continue;
      }

      const folder = originalPath
        ? { path: originalPath, exact: true }
        : await remember(ctx, `claude:folder:${filePath}`, stampOf(stat), () =>
            folderFromTranscript(filePath, entry.name)
          );

      yield {
        sessionId: name.slice(0, -'.jsonl'.length),
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
}

/**
 * Sessions that exist only in history.jsonl: the transcript was deleted, but the
 * user's own prompts survive and stay searchable.
 */
async function* discoverHistoryOnly(ctx) {
  const historyFile = paths.historyFile(ctx.env, ctx.home);
  if (!fs.existsSync(historyFile)) return;

  let stat;
  try {
    stat = await fsp.stat(historyFile);
  } catch {
    return;
  }

  const known = await transcriptSessionIds(ctx);
  const bySession = new Map();

  for await (const record of readRecords(historyFile)) {
    const row = record.value;
    if (!row || typeof row !== 'object') continue;
    const sessionId = typeof row.sessionId === 'string' ? row.sessionId : '';
    const project = typeof row.project === 'string' ? row.project : '';
    if (!sessionId || !project || known.has(sessionId)) continue;

    if (!bySession.has(sessionId)) bySession.set(sessionId, { project, prompts: [] });
    bySession.get(sessionId).prompts.push(row);
  }

  for (const [sessionId, entry] of bySession) {
    yield {
      sessionId,
      key: `${historyFile}#${sessionId}`,
      // The whole file is re-scanned when it changes; per-session state is not
      // worth tracking for a file this small.
      fingerprint: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
      folderPath: entry.project,
      folderExact: true,
      // No transcript remains for this folder: the UI greys it out.
      folderOnDisk: false,
      bytes: 0,
      source: HISTORY_KEY,
      prompts: entry.prompts,
    };
  }
}

/** Session ids that have a transcript on disk, so history does not shadow them. */
async function transcriptSessionIds(ctx) {
  const ids = new Set();
  const projectsDir = paths.projectsDir(ctx.env, ctx.home);

  let entries;
  try {
    entries = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return ids;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      for (const name of await fsp.readdir(path.join(projectsDir, entry.name))) {
        if (name.endsWith('.jsonl')) ids.add(name.slice(0, -'.jsonl'.length));
      }
    } catch {
      /* unreadable directory: treat as having no transcripts */
    }
  }
  return ids;
}

// ── reading ─────────────────────────────────────────────────────────────────

function* readHistorySession(descriptor) {
  // Synthetic and fully re-derived on every pass, so there is no cursor to keep.
  for (let i = 0; i < descriptor.prompts.length; i += 1) {
    const prompt = descriptor.prompts[i];
    const text = typeof prompt.display === 'string' ? prompt.display : '';
    const pasted = pastedParts(prompt.pastedContents);
    yield {
      item: {
        kind: 'message',
        role: 'user',
        uuid: `history:${descriptor.sessionId}:${i}`,
        parentUuid: null,
        sessionId: descriptor.sessionId,
        timestamp: isoFromMillis(prompt.timestamp),
        cwd: descriptor.folderPath,
        gitBranch: '',
        version: '',
        model: '',
        text,
        thinking: '',
        parts: text ? [{ type: 'text', text }, ...pasted] : pasted,
        isMeta: false,
        isSidechain: false,
        command: null,
      },
      cursor: null,
    };
  }
}

/**
 * What was pasted into the prompt alongside what was typed.
 *
 * `display` holds only the typed part; anything pasted sits in
 * `pastedContents`, keyed by paste id. Seven prompts of 510 measured carry one,
 * 1498 characters in all — terminal output and error messages, which for a
 * purged session is the only surviving trace of what was being discussed.
 * It is kept as its own collapsible part rather than glued onto the prompt,
 * where 972 characters of stack trace would bury the question.
 */
function pastedParts(pastedContents) {
  const values =
    pastedContents && typeof pastedContents === 'object' ? Object.values(pastedContents) : [];

  const parts = [];
  for (const entry of values) {
    const content = entry && typeof entry === 'object' ? entry.content : entry;
    if (typeof content !== 'string' || !content.trim()) continue;
    parts.push({
      type: 'pasted',
      lines: typeof (entry || {}).lineCount === 'number' ? entry.lineCount : 0,
      preview: content.length > PASTE_PREVIEW_LIMIT
        ? `${content.slice(0, PASTE_PREVIEW_LIMIT)}\u2026`
        : content,
    });
  }
  return parts;
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function rememberOriginalPath(ctx, indexPath) {
  let stat;
  try {
    stat = await fsp.stat(indexPath);
  } catch {
    return null; // no sessions-index.json: the transcripts say where they ran
  }
  return remember(ctx, `claude:index:${indexPath}`, stampOf(stat), () => readOriginalPath(indexPath));
}

/** `originalPath` from sessions-index.json — the only exact source. */
async function readOriginalPath(indexPath) {
  try {
    const parsed = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
    const value = parsed && parsed.originalPath;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

/** Fall back to a message's `cwd`, then to the lossy directory-name hint. */
async function folderFromTranscript(filePath, dirName) {
  try {
    for await (const record of readRecords(filePath)) {
      const cwd = record.value && record.value.cwd;
      if (typeof cwd === 'string' && cwd) return { path: cwd, exact: true };
    }
  } catch {
    /* unreadable: fall through */
  }
  return { path: paths.decodeHint(dirName), exact: false };
}

function isoFromMillis(millis) {
  if (typeof millis !== 'number' || !Number.isFinite(millis)) return '';
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

module.exports = adapter;
