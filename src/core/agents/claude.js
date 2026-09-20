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

const ID = 'claude';

/** Marks the synthetic sessions rebuilt from history.jsonl. */
const HISTORY_KEY = 'history';

/** Same ceiling as every other stored preview: enough to recognise, not to store. */
const PASTE_PREVIEW_LIMIT = 2000;

const adapter = {
  id: ID,
  label: 'Claude Code',
  envKeys: ['CLAUDE_CONFIG_DIR'],

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
    const offset = Number(cursor);
    return Number.isFinite(offset) && offset <= (descriptor.bytes ?? 0);
  },

  async *read(descriptor, { cursor = null, ctx = {} } = {}) {
    if (descriptor.source === HISTORY_KEY) {
      yield* readHistorySession(descriptor, ctx);
      return;
    }

    const start = cursor == null ? 0 : Number(cursor) || 0;
    let last = cursor;

    for await (const record of readRecords(descriptor.filePath, { start })) {
      const item = extractRecord(record.value);
      // A trailing line with no newline reports endOffset === offset; yielding
      // the previous cursor makes the indexer re-read it once complete.
      const next = record.endOffset > record.offset ? String(record.endOffset) : last;
      last = next;
      yield { item, cursor: next };
    }
  },
};

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
