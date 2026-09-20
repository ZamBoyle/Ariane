'use strict';

/**
 * OpenAI Codex CLI adapter.
 *
 * Layout, two generations living side by side:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl   current (145 files, 410 MB)
 *   ~/.codex/sessions/rollout-YYYY-MM-DD-<uuid>.json          legacy  (78 files, 6 MB)
 *
 * The working directory comes from `session_meta.payload.cwd`, stored verbatim
 * with no encoding — so unlike Claude Code there is nothing lossy to undo.
 *
 * ONE HONEST LIMITATION, measured: the 78 legacy .json files have a session
 * object of exactly {timestamp, id, instructions} and contain no cwd anywhere
 * (checked all 78, plus a regex over every message). Their 439 messages cannot
 * be attributed to a folder. They are surfaced under a clearly-labelled
 * "unknown folder" rather than silently dropped or wrongly attributed.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { readRecords } = require('../jsonl');
const { remember, stampOf } = require('../memo');
const { extractCodexRecord } = require('./codex-extract');

const ID = 'codex';

/** Where sessions whose folder is genuinely unrecoverable are grouped. */
const UNKNOWN_FOLDER = '(dossier inconnu)';

/** Header records are cheap; stop hunting for a cwd after this many lines. */
const CWD_SCAN_LIMIT = 400;

function root(ctx = {}) {
  const override = ctx.env && ctx.env.CODEX_HOME;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(ctx.home || require('os').homedir(), '.codex');
}

const sessionsDir = (ctx) => path.join(root(ctx), 'sessions');

const adapter = {
  id: ID,
  label: 'Codex',
  envKeys: ['CODEX_HOME'],
  root,

  detect(ctx = {}) {
    try {
      return fs.statSync(sessionsDir(ctx)).isDirectory();
    } catch {
      return false;
    }
  },

  async *discover(ctx = {}) {
    for await (const file of walk(sessionsDir(ctx))) {
      const modern = file.endsWith('.jsonl');
      if (!modern && !file.endsWith('.json')) continue;

      let stat;
      try {
        stat = await fsp.stat(file);
      } catch {
        continue;
      }

      // A legacy file is parsed whole to read its header; a current one is
      // streamed up to its cwd. Either way, only once per version of the file.
      const header = await remember(ctx, `codex:header:${file}`, stampOf(stat), () =>
        modern ? readHeader(file) : readLegacyHeader(file)
      );

      yield {
        sessionId: header.sessionId || sessionIdFromName(file),
        key: file,
        fingerprint: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
        folderPath: header.cwd || UNKNOWN_FOLDER,
        folderExact: Boolean(header.cwd),
        // The rollout file is right there; it is the FOLDER that is unknown.
        // Marking it absent made the UI tell the reader its transcripts had been
        // purged, which is the opposite of the truth.
        folderOnDisk: true,
        bytes: stat.size,
        // adapter-private
        filePath: file,
        legacy: !modern,
        startedAt: header.timestamp || timestampFromName(file),
      };
    }
  },

  /** A byte offset past the end means the file was rewritten; start over. */
  canResume(descriptor, cursor) {
    if (descriptor.legacy) return false; // single JSON document, never partial
    const offset = Number(cursor);
    return Number.isFinite(offset) && offset <= (descriptor.bytes ?? 0);
  },

  async *read(descriptor, { cursor = null } = {}) {
    if (descriptor.legacy) {
      yield* readLegacy(descriptor);
      return;
    }

    const start = cursor == null ? 0 : Number(cursor) || 0;
    let last = cursor;

    for await (const record of readRecords(descriptor.filePath, { start })) {
      const next = record.endOffset > record.offset ? String(record.endOffset) : last;
      last = next;

      const item = extractCodexRecord(record.value);
      if (item.kind === 'meta') continue; // cwd was resolved during discovery

      // A tool call arrives as its own record here, not as a block inside a
      // message, so it is promoted to a message carrying only that part.
      if (item.kind === 'ignored' && item.part) {
        yield {
          item: toolMessage(item.part, str(record.value && record.value.timestamp)),
          cursor: next,
        };
        continue;
      }

      yield {
        item: item.kind === 'message' ? withFallbackTime(item, descriptor) : item,
        cursor: next,
      };
    }
  },
};

// ── legacy .json ────────────────────────────────────────────────────────────

/**
 * The 2025-04 generation: one JSON document of {session, items}. Small enough
 * (6 MB across 78 files) to parse whole.
 */
async function* readLegacy(descriptor) {
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(descriptor.filePath, 'utf8'));
  } catch {
    return;
  }

  const stamp = str(parsed && parsed.session && parsed.session.timestamp) || descriptor.startedAt;

  for (const entry of Array.isArray(parsed && parsed.items) ? parsed.items : []) {
    const item = extractCodexRecord(entry);
    if (item.kind !== 'message') continue;
    // No per-item time exists in this generation; the session's stamp is all there is.
    yield { item: { ...item, timestamp: item.timestamp || stamp }, cursor: null };
  }
}

// ── headers ─────────────────────────────────────────────────────────────────

/**
 * Resolve cwd and session id from the first records. Three sources, in the
 * order the reconnaissance found them reliable.
 */
async function readHeader(file) {
  const out = { cwd: '', sessionId: '', timestamp: '' };
  let seen = 0;

  try {
    for await (const record of readRecords(file)) {
      const value = record.value;
      if (++seen > CWD_SCAN_LIMIT) break;

      const item = extractCodexRecord(value);
      if (item.kind === 'meta') {
        if (!out.cwd && item.cwd) out.cwd = item.cwd;
        if (!out.sessionId && item.sessionId) out.sessionId = item.sessionId;
        if (!out.timestamp && item.timestamp) out.timestamp = item.timestamp;
        if (out.cwd && out.sessionId) break;
        continue;
      }

      // Oldest generation: no session_meta at all, but the harness injected an
      // <environment_context> block carrying <cwd> into the first user message.
      if (!out.cwd && item.kind === 'message') {
        const found = /<cwd>([^<]*)<\/cwd>/.exec(item.text || textOfParts(item));
        if (found && found[1].trim()) out.cwd = found[1].trim();
      }
    }
  } catch {
    /* unreadable: caller falls back to the file name */
  }
  return out;
}

async function readLegacyHeader(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    const session = (parsed && parsed.session) || {};
    return { cwd: '', sessionId: str(session.id), timestamp: str(session.timestamp) };
  } catch {
    return { cwd: '', sessionId: '', timestamp: '' };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Depth-first walk; yields file paths. Missing directories yield nothing. */
async function* walk(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** rollout-<ISO>-<uuid>.jsonl -> the uuid. */
function sessionIdFromName(file) {
  const base = path.basename(file).replace(/\.jsonl?$/, '');
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(base);
  return uuid ? uuid[1] : base;
}

/** The oldest files carry no per-message timestamp; the name is date-stamped. */
function timestampFromName(file) {
  const found = /rollout-(\d{4})-?(\d{2})-?(\d{2})T?(\d{2})?-?(\d{2})?-?(\d{2})?/.exec(path.basename(file));
  if (!found) return '';
  const [, y, m, d, hh = '00', mm = '00', ss = '00'] = found;
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`;
  return Number.isNaN(Date.parse(iso)) ? '' : iso;
}

function withFallbackTime(item, descriptor) {
  return item.timestamp ? item : { ...item, timestamp: descriptor.startedAt || '' };
}

function toolMessage(part, timestamp) {
  return {
    kind: 'message',
    role: part.type === 'tool_result' ? 'user' : 'assistant',
    // Prefixed by kind: a call and its result share one correlation id, and the
    // unique (session_id, uuid) index would otherwise discard whichever arrived
    // second — always the result, the half that holds the output. Measured
    // before this line existed: 6172 rows lost for Codex, 435 for Copilot, and
    // not one tool result stored for either.
    uuid: part.id ? `${part.type}:${part.id}` : '',
    parentUuid: null,
    timestamp,
    cwd: '',
    gitBranch: '',
    version: '',
    model: '',
    text: '',
    thinking: '',
    parts: [part],
    isMeta: false,
    isNotice: false,
    isSidechain: false,
    command: null,
  };
}

function textOfParts(item) {
  return (item.parts || [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = adapter;
module.exports.UNKNOWN_FOLDER = UNKNOWN_FOLDER;
