'use strict';

/**
 * GitHub Copilot CLI adapter.
 *
 * Layout:
 *   ~/.copilot/session-state/<uuid>/events.jsonl    the event log
 *   ~/.copilot/session-state/<uuid>/workspace.yaml  cwd, git_root, branch, name
 *
 * Folder attribution is the easiest of any agent here: `session.start` carries
 * `data.context.cwd` verbatim, and `workspace.yaml` repeats it. Both were
 * cross-checked on all 17 sessions that have a log and never disagreed.
 *
 * Two measured facts shape this file:
 *  - 6 of 23 session directories have NO events.jsonl. They are still surfaced,
 *    using workspace.yaml alone, rather than vanishing.
 *  - `session-store.db` is LOSSY: `turns.assistant_response` keeps only the last
 *    assistant message of a turn. It is never read.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { readRecords } = require('../jsonl');
const { extractCopilotRecord } = require('./copilot-extract');
const { usageOf } = require('./contract');
const { remember, stampOf } = require('../memo');

const ID = 'copilot-cli';

function root(ctx = {}) {
  const override = ctx.env && ctx.env.COPILOT_HOME;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(ctx.home || require('os').homedir(), '.copilot');
}

const stateDir = (ctx) => path.join(root(ctx), 'session-state');

const adapter = {
  id: ID,
  label: 'Copilot CLI',
  envKeys: ['COPILOT_HOME'],
  // Its only count is a running total per session, written at each shutdown:
  // shown under one reply, it would read as that reply's cost (contract.js).
  usagePerSession: true,
  root,

  detect(ctx = {}) {
    try {
      return fs.statSync(stateDir(ctx)).isDirectory();
    } catch {
      return false;
    }
  },

  async *discover(ctx = {}) {
    const base = stateDir(ctx);

    let entries;
    try {
      entries = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const dir = path.join(base, entry.name);
      const logFile = path.join(dir, 'events.jsonl');
      const workspace = await rememberWorkspace(ctx, path.join(dir, 'workspace.yaml'));

      let stat = null;
      try {
        stat = await fsp.stat(logFile);
      } catch {
        // 6 of 23 directories have no log; workspace.yaml alone still tells us
        // the session existed and where it ran.
      }

      const header = stat
        ? await remember(ctx, `copilot:header:${logFile}`, stampOf(stat), () => readHeader(logFile))
        : {};
      const cwd = header.cwd || workspace.cwd;

      yield {
        sessionId: header.sessionId || workspace.id || entry.name,
        key: dir,
        fingerprint: stat ? `${stat.size}:${Math.floor(stat.mtimeMs)}` : 'no-log',
        folderPath: cwd || null,
        folderExact: Boolean(cwd),
        folderOnDisk: Boolean(cwd),
        title: firstLine(workspace.name),
        bytes: stat ? stat.size : 0,
        // adapter-private
        logFile: stat ? logFile : null,
        gitBranch: header.gitBranch || workspace.branch || '',
      };
    }
  },

  canResume(descriptor, cursor) {
    if (!descriptor.logFile) return false;
    const { offset } = parseCursor(cursor);
    return Number.isFinite(offset) && offset <= (descriptor.bytes ?? 0);
  },

  async *read(descriptor, { cursor = null } = {}) {
    if (!descriptor.logFile) return; // nothing but workspace.yaml for this one

    const resumed = parseCursor(cursor);
    const start = cursor == null ? 0 : resumed.offset || 0;
    // The model in use, for a reply that does not name its own (see
    // copilot-extract.js, session.model_change). Carried in the cursor so a
    // pass resuming mid-file still knows it.
    let model = resumed.model;
    // The last running total seen: a shutdown only adds what grew since.
    let total = resumed.total;
    let last = cursor;

    for await (const record of readRecords(descriptor.logFile, { start })) {
      const complete = record.endOffset > record.offset;
      const extracted = extractCopilotRecord(record.value);

      if (extracted.kind === 'usage') {
        if (!complete) continue; // re-read whole next time, counted once
        const grown = difference(extracted.total, total);
        total = extracted.total;
        last = makeCursor(record.endOffset, model, total);
        yield grown
          ? { item: { kind: 'usage', usage: usageOf(grown) }, cursor: last }
          : {
              item: { kind: 'ignored', reason: 'known-noise', detail: 'repeated shutdown' },
              cursor: last,
            };
        continue;
      }

      if (extracted.kind === 'meta' && extracted.model) model = extracted.model;
      const next = complete ? makeCursor(record.endOffset, model, total) : last;
      last = next;

      const item = withModel(extracted, model);
      if (item.kind === 'meta') continue; // resolved during discovery

      // Tool activity arrives as standalone events rather than blocks inside a
      // message, so each is promoted to a message carrying only that part.
      if (item.kind === 'ignored' && item.part) {
        const tool = toolMessage(item.part, str(record.value && record.value.timestamp));
        yield { item: withModel(tool, model), cursor: next };
        continue;
      }

      if (item.kind === 'message') {
        yield { item: { ...item, gitBranch: descriptor.gitBranch }, cursor: next };
        continue;
      }

      yield { item, cursor: next };
    }
  },
};

// ── workspace.yaml ──────────────────────────────────────────────────────────

/**
 * Read the handful of scalar keys we need.
 *
 * Deliberately not a YAML parser: this file is a flat `key: value` list written
 * by one producer, and adding a dependency to read four strings would be worse
 * than a six-line reader. Anything nested is ignored rather than guessed at.
 */
async function rememberWorkspace(ctx, file) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return readWorkspace(file); // absent: whatever the reader makes of that
  }
  return remember(ctx, `copilot:workspace:${file}`, stampOf(stat), () => readWorkspace(file));
}

async function readWorkspace(file) {
  const out = { id: '', cwd: '', gitRoot: '', branch: '', name: '' };

  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return out;
  }

  const keys = { id: 'id', cwd: 'cwd', git_root: 'gitRoot', branch: 'branch', name: 'name' };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = /^([a-z_]+):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const field = keys[match[1]];
    if (!field || out[field]) continue;
    const value = match[2].trim();
    // A long value is written as a block: `name: |-`, then the text on the
    // indented lines that follow. Read as a flat pair, the title was "|-" —
    // 7 of 18 conversations on a real machine.
    out[field] = BLOCK.test(value) ? blockAfter(lines, i) : unquote(value);
  }
  return out;
}

/** `|`, `|-`, `|+`, `>`, `>-`… with an optional indentation digit. */
const BLOCK = /^[|>][0-9]?[-+]?[0-9]?$/;

/** The indented lines under a block key, dedented. A literal block keeps its lines. */
function blockAfter(lines, i) {
  const body = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() && !/^\s/.test(lines[j])) break;
    body.push(lines[j]);
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
  return body.map((l) => l.slice(Math.min(indent, l.length))).join('\n');
}

/**
 * A quoted scalar's text. YAML doubles an apostrophe inside single quotes, so
 * `'l''audit'` is "l'audit" — shown doubled until this unescaped it.
 */
function unquote(value) {
  if (value.length >= 2 && /^'.*'$/s.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (value.length >= 2 && /^".*"$/s.test(value)) {
    return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return value;
}

// ── event log ───────────────────────────────────────────────────────────────

/** `session.start` is the first record; stop as soon as it is found. */
async function readHeader(file) {
  const out = { cwd: '', gitBranch: '', sessionId: '' };
  let seen = 0;

  try {
    for await (const record of readRecords(file)) {
      if (++seen > 50) break;
      const item = extractCopilotRecord(record.value);
      if (item.kind !== 'meta') continue;
      out.cwd = item.cwd;
      out.gitBranch = item.gitBranch;
      out.sessionId = item.sessionId;
      break;
    }
  } catch {
    /* unreadable: the caller falls back to workspace.yaml */
  }
  return out;
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

/** An assistant turn that does not name its model gets the one in use. */
function withModel(item, model) {
  if (item.kind !== 'message' || item.role !== 'assistant' || item.model || !model) return item;
  return { ...item, model };
}

const TOTALS = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'];

/**
 * What a running total added since the previous one; null when nothing grew
 * (a shutdown repeated, 2 of 23 measured). A total that fell back would be a
 * counter starting over — never seen here — and then counts whole.
 */
function difference(current, previous) {
  if (!previous || TOTALS.some((k) => current[k] < previous[k])) {
    return TOTALS.some((k) => current[k] > 0) ? current : null;
  }
  const grown = Object.fromEntries(TOTALS.map((k) => [k, current[k] - previous[k]]));
  return TOTALS.some((k) => grown[k] > 0) ? grown : null;
}

/**
 * "offset", "offset;model" or "offset;model;in,read,write,out,reasoning". A
 * cursor written before a part existed simply lacks it.
 */
function makeCursor(offset, model, total = null) {
  const counts = total ? TOTALS.map((k) => Number(total[k]) || 0).join(',') : '';
  if (!counts) return model ? `${offset};${model}` : String(offset);
  return `${offset};${model || ''};${counts}`;
}

function parseCursor(cursor) {
  if (cursor == null) return { offset: 0, model: '', total: null };
  const [offset, model = '', counts = ''] = String(cursor).split(';');
  if (!counts) return { offset: Number(offset), model, total: null };
  const values = counts.split(',').map(Number);
  return {
    offset: Number(offset),
    model,
    total: Object.fromEntries(TOTALS.map((k, i) => [k, values[i] || 0])),
  };
}

/** workspace.yaml `name` is the first prompt truncated to 500 chars, not a title. */
function firstLine(value) {
  // A prompt that opens on a Markdown heading gives "# ANALYSE…": the marks
  // are layout, not words.
  const text = str(value).split('\n')[0].replace(/^#{1,6}\s+/, '').trim();
  if (!text) return '';
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

const str = (v) => (typeof v === 'string' ? v : '');

module.exports = adapter;
