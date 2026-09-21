'use strict';

/**
 * VS Code chat adapter — the Copilot Chat panel inside the editor, not the CLI.
 *
 * Also serves the forks that kept the same layout (Cursor, VSCodium), since the
 * only thing that differs between them is the name of the config directory.
 *
 * Layout, one directory per workspace ever opened:
 *   <config>/User/workspaceStorage/<hash>/workspace.json      the real path
 *   <config>/User/workspaceStorage/<hash>/chatSessions/*.json  full snapshot
 *   <config>/User/workspaceStorage/<hash>/chatSessions/*.jsonl delta log
 *
 * Folder attribution is exact: `workspace.json` holds the path verbatim as a
 * `file://` URI. The directory hash is never decoded.
 *
 * Three measured facts shape this file:
 *  - 16 of 188 workspaces are multi-root: `workspace` points at a
 *    `.code-workspace` file instead of `folder` naming a directory.
 *  - 28 of 172 single-folder paths point at directories that no longer exist.
 *    The attribution is still exact; the target is simply gone.
 *  - One session file measured 166 MB and yielded 2.5 KB of prose, its bulk
 *    being serialised tool results. Parsing a document that size would freeze
 *    the app, so anything past MAX_SESSION_BYTES is skipped and SAID to be
 *    skipped rather than silently dropped.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const Database = require('better-sqlite3');

const { readRecords } = require('../jsonl');
const { applyDeltas, extractRequest, folderFromUri, epoch } = require('./vscode-extract');
const { remember, stampOf } = require('../memo');

const ID = 'vscode';

/**
 * A session document past this size is skipped. These are single JSON
 * documents that cannot be streamed, and the one oversized file measured held
 * 2.5 KB of conversation inside 166 MB of serialised tool output.
 */
const MAX_SESSION_BYTES = 96 * 1024 * 1024;

/**
 * The previous generation kept every chat of a workspace in one blob inside the
 * workspace's SQLite store, under this key. It still exists in 75 of 188
 * workspaces measured, holding 129 KB of prose - comparable to everything the
 * chatSessions/ files hold, and richer per byte. Older installs may have
 * nothing else, so it is read too.
 *
 * `state.vscdb.backup` is deliberately never opened: it is a second copy and
 * reading it would double-count every session.
 */
const LEGACY_KEY = 'interactive.sessions';

/**
 * Editors that keep this exact layout. The first one found wins; a machine with
 * several is unusual and the extra roots simply yield nothing.
 */
const EDITORS = [
  { dir: 'Code', label: 'VS Code' },
  { dir: 'Code - OSS', label: 'VSCodium' },
  { dir: 'VSCodium', label: 'VSCodium' },
  { dir: 'Cursor', label: 'Cursor' },
];

/** Per-platform home of an editor's configuration directory. */
function configHomes(ctx = {}) {
  const home = ctx.home || os.homedir();
  const override = ctx.env && ctx.env.VSCODE_CONFIG_DIR;
  if (override && override.trim()) return [path.resolve(override.trim())];

  if (process.platform === 'darwin') {
    return EDITORS.map((e) => path.join(home, 'Library', 'Application Support', e.dir));
  }
  if (process.platform === 'win32') {
    const appData = (ctx.env && ctx.env.APPDATA) || path.join(home, 'AppData', 'Roaming');
    return EDITORS.map((e) => path.join(appData, e.dir));
  }
  const xdg = (ctx.env && ctx.env.XDG_CONFIG_HOME) || path.join(home, '.config');
  return EDITORS.map((e) => path.join(xdg, e.dir));
}

const storageDirs = (ctx) => configHomes(ctx).map((c) => path.join(c, 'User', 'workspaceStorage'));

const adapter = {
  id: ID,
  label: 'VS Code Chat',
  envKeys: ['VSCODE_CONFIG_DIR'],

  root(ctx = {}) {
    for (const dir of storageDirs(ctx)) {
      if (exists(dir)) return dir;
    }
    return storageDirs(ctx)[0];
  },

  detect(ctx = {}) {
    return storageDirs(ctx).some(exists);
  },

  async *discover(ctx = {}) {
    const seen = new Set();

    for (const base of storageDirs(ctx)) {
      let workspaces;
      try {
        workspaces = await fsp.readdir(base, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const workspace of workspaces) {
        if (!workspace.isDirectory()) continue;

        const dir = path.join(base, workspace.name);
        const folder = await rememberWorkspaceFolder(ctx, path.join(dir, 'workspace.json'));
        const chatsDir = path.join(dir, 'chatSessions');

        let files = [];
        try {
          files = await fsp.readdir(chatsDir);
        } catch {
          // No chatSessions/ directory, but the legacy blob may still be there.
          yield* discoverLegacy(ctx, dir, folder, seen);
          continue;
        }

        // The files are claimed BEFORE the legacy blob is read. The blob is a
        // snapshot VS Code stopped updating; the file is the living copy. One
        // session of 188 workspaces exists in both, and yielding the blob first
        // handed the reader the frozen one.
        const live = [];
        for (const name of files) {
          const delta = name.endsWith('.jsonl');
          if (!delta && !name.endsWith('.json')) continue;

          const filePath = path.join(chatsDir, name);
          let stat;
          try {
            stat = await fsp.stat(filePath);
          } catch {
            continue;
          }

          const sessionId = name.replace(/\.jsonl?$/, '');
          // The same session can exist as both a snapshot and a delta log.
          if (seen.has(sessionId)) continue;
          seen.add(sessionId);

          live.push({ name, delta, filePath, stat, sessionId });
        }

        yield* discoverLegacy(ctx, dir, folder, seen);

        for (const { delta, filePath, stat, sessionId } of live) {
          // A snapshot is parsed WHOLE to find its title and dates: never twice
          // for the same version of the file.
          const head = await remember(ctx, `vscode:head:${filePath}`, stampOf(stat), () =>
            readHead(filePath, delta, stat.size)
          );

          yield {
            sessionId,
            key: filePath,
            fingerprint: `${stat.size}:${Math.floor(stat.mtimeMs)}`,
            folderPath: folder,
            folderExact: Boolean(folder),
            folderOnDisk: Boolean(folder),
            title: head.title,
            bytes: stat.size,
            // adapter-private
            filePath,
            delta,
            tooLarge: stat.size > MAX_SESSION_BYTES,
            creationDate: head.creationDate,
            lastMessageDate: head.lastMessageDate,
          };
        }
      }
    }
  },

  /**
   * Never resume. A delta log replays onto a snapshot held in memory, so a
   * partial read would apply mutations to a state we no longer have.
   */
  canResume() {
    return false;
  },

  async *read(descriptor) {
    if (descriptor.legacy) {
      const dates = {
        creationDate: descriptor.creationDate,
        lastMessageDate: descriptor.lastMessageDate,
      };
      for (const request of descriptor.requests || []) {
        for (const item of extractRequest(request, dates)) {
          yield { item: { ...item, cwd: descriptor.folderPath || '' }, cursor: null };
        }
      }
      return;
    }

    if (descriptor.tooLarge) {
      // Counted as drift rather than dropped in silence, so the reason surfaces.
      yield {
        item: { kind: 'ignored', reason: `oversized:${Math.round(descriptor.bytes / 1e6)}MB` },
        cursor: null,
      };
      return;
    }

    const session = descriptor.delta
      ? await replayDeltaLog(descriptor.filePath)
      : await readSnapshot(descriptor.filePath);

    if (!session) return;

    const dates = {
      creationDate: session.creationDate,
      lastMessageDate: session.lastMessageDate,
    };

    for (const request of Array.isArray(session.requests) ? session.requests : []) {
      for (const item of extractRequest(request, dates)) {
        yield { item: { ...item, cwd: descriptor.folderPath || '' }, cursor: null };
      }
    }
  },
};

// ── the legacy SQLite blob ──────────────────────────────────────────────────

/**
 * Read `interactive.sessions` out of a workspace's state.vscdb.
 *
 * Opened read-only: VS Code may be running and holding the file. A failure here
 * is never fatal - the workspace simply contributes whatever its files hold.
 */
async function* discoverLegacy(ctx, dir, folder, seen) {
  // Opening a SQLite store per workspace — 188 of them — was most of what an
  // idle pass cost. The store's own size and mtime say whether it can change.
  const sessions = await remember(ctx, `vscode:legacy:${dir}`, legacyFingerprint(dir), () =>
    readLegacyBlob(path.join(dir, 'state.vscdb'))
  );

  for (const session of sessions) {
    const sessionId = str(session.sessionId) || str(session.id);
    if (!sessionId || seen.has(sessionId)) continue;
    const requests = Array.isArray(session.requests) ? session.requests : [];
    if (requests.length === 0) continue;
    seen.add(sessionId);

    yield {
      sessionId,
      key: `${dir}#${LEGACY_KEY}#${sessionId}`,
      // The whole blob is re-read when the store changes; the store's own size
      // and mtime are a good enough signal for a few hundred kilobytes.
      fingerprint: legacyFingerprint(dir),
      folderPath: folder,
      folderExact: Boolean(folder),
      folderOnDisk: Boolean(folder),
      title: str(session.customTitle) || str(session.title),
      bytes: 0,
      // adapter-private
      legacy: true,
      requests,
      creationDate: num(session.creationDate),
      lastMessageDate: num(session.lastMessageDate),
    };
  }
}

function readLegacyBlob(dbFile) {
  let db;
  try {
    db = new Database(dbFile, { readonly: true, fileMustExist: true });
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(LEGACY_KEY);
    if (!row || row.value == null) return [];

    // Values are stored as BLOBs holding JSON text.
    const text = Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.sessions)) return parsed.sessions;
    return [];
  } catch {
    return [];
  } finally {
    try {
      if (db) db.close();
    } catch {
      /* already gone */
    }
  }
}

function legacyFingerprint(dir) {
  try {
    const stat = fs.statSync(path.join(dir, 'state.vscdb'));
    return `db:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return 'db:absent';
  }
}

// ── reading ─────────────────────────────────────────────────────────────────

async function replayDeltaLog(file) {
  const records = [];
  try {
    for await (const record of readRecords(file)) records.push(record.value);
  } catch {
    return null;
  }
  return applyDeltas(records);
}

async function readSnapshot(file) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Title and dates without parsing the whole document.
 *
 * For a delta log the snapshot is line 0, so one line is enough. For a full
 * snapshot there is no way around reading it, which is exactly why oversized
 * files are refused here too.
 */
async function readHead(file, delta, size) {
  const empty = { title: '', creationDate: 0, lastMessageDate: 0 };

  try {
    if (delta) {
      for await (const record of readRecords(file)) {
        const value = record.value;
        if (value && value.kind === 0 && value.v) return describe(value.v);
        break; // the snapshot is line 0 or the log is unusable
      }
      return empty;
    }

    if (size > MAX_SESSION_BYTES) return empty;
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    return describe(parsed);
  } catch {
    return empty;
  }
}

function describe(session) {
  return {
    title: str(session && session.customTitle),
    creationDate: num(session && session.creationDate),
    lastMessageDate: num(session && session.lastMessageDate),
  };
}

// ── folder attribution ──────────────────────────────────────────────────────

/**
 * `workspace.json` names either a single folder or a multi-root workspace file.
 * A multi-root entry points at a `.code-workspace`, whose own folder list is
 * often relative or empty, so the workspace file's own directory is the honest
 * answer rather than a guess at which of its roots was meant.
 */
async function rememberWorkspaceFolder(ctx, file) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return null;
  }
  return remember(ctx, `vscode:workspace:${file}`, stampOf(stat), () => readWorkspaceFolder(file));
}

async function readWorkspaceFolder(file) {
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const single = folderFromUri(parsed.folder);
  if (single) return single;

  const multi = folderFromUri(parsed.workspace);
  if (multi) return path.dirname(multi);

  return null;
}

function exists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

module.exports = adapter;
module.exports.MAX_SESSION_BYTES = MAX_SESSION_BYTES;
module.exports.epoch = epoch;
