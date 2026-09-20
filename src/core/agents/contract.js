'use strict';

/**
 * The adapter contract.
 *
 * Ariane indexes conversation history from several coding agents, each of which
 * invented its own storage. This file defines the only surface the rest of the
 * app knows about; everything agent-specific lives behind it, in one module per
 * agent under `src/core/agents/`.
 *
 * The contract is built around three questions, because those are the three
 * things every agent answers differently:
 *
 *   1. Where are the sessions?        -> discover()
 *   2. Which folder did each run in?  -> descriptor.folderPath
 *   3. What is a message?             -> read()
 *
 * ── Incrementality ────────────────────────────────────────────────────────
 * Two opaque strings carry all resume state, so an adapter backed by SQLite is
 * no harder to support than one backed by append-only JSONL:
 *
 *   fingerprint  changes whenever the session's stored bytes changed.
 *                Compared for equality only — never parsed by the caller.
 *                JSONL adapters use "size:mtime"; a DB adapter might use
 *                "maxRowId:count".
 *
 *   cursor       where to resume reading. Produced by read(), handed back on
 *                the next pass, and meaningful only to the adapter that made
 *                it. A JSONL adapter stores a byte offset; a DB adapter stores
 *                a row id. `null` means "start from the beginning".
 *
 * An adapter that cannot resume simply ignores `cursor` and always yields
 * everything; the indexer detects the full re-read and replaces the session's
 * messages. Correctness never depends on resumability, only speed does.
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 *
 * @typedef {object} Context
 * @property {NodeJS.ProcessEnv} env  Environment, so tests can redirect roots.
 * @property {string} [home]          Overrides os.homedir(), for tests.
 * @property {import('../memo').Memo} [memo]  Survives from one pass to the next.
 *   Discovery should route any per-file reading through `remember()` (memo.js),
 *   stamped with the file's size and mtime, so that a pass over unchanged files
 *   costs a `stat` each and nothing more. Absent in most tests: recompute then.
 *
 * @typedef {object} SessionDescriptor
 * @property {string} sessionId    Stable within the agent. Namespaced by the indexer.
 * @property {string} key          Unique storage key; the state row is keyed on it.
 *                                 A file path, or `${dbFile}#${rowId}`.
 * @property {string} fingerprint  See above.
 * @property {string|null} folderPath  The REAL working directory, absolute and
 *                                 verbatim. Null only when genuinely unknown —
 *                                 never a guess, and never a lossy decoding of
 *                                 a directory name (see paths.decodeHint).
 * @property {boolean} [folderExact]   False when folderPath is an approximation.
 * @property {boolean} [folderOnDisk]  False when the folder has no real transcript
 *                                 (e.g. rebuilt from a prompt log after a purge).
 * @property {string} [title]      Human-readable title, when known upfront.
 * @property {number} [bytes]      Size on disk, for progress reporting.
 *
 * @typedef {object} Item
 * One normalised record. `kind` decides how the indexer treats it:
 *   'message'  a conversation turn, shaped like extract.js output
 *   'title'    {title} — a human-readable session title
 *   'summary'  {slug}  — a short session slug
 *   'ignored'  {reason} — counted, so format drift is visible rather than silent
 * @property {'message'|'title'|'summary'|'ignored'} kind
 *
 * @typedef {object} Chunk
 * @property {Item} item
 * @property {string|null} cursor  Resume point AFTER this item. An adapter that
 *                                 cannot guarantee the item is durably complete
 *                                 (a half-written trailing line) yields the
 *                                 PREVIOUS cursor, so the item is re-read later.
 *
 * @typedef {object} Adapter
 * @property {string} id      Stable slug, stored in the database. Never rename.
 * @property {string} label   Display name.
 * @property {string[]} [envKeys]
 *           Environment variables that relocate this agent's data directory.
 *           Declared so tests can blank EVERY agent root at once: a suite that
 *           redirects only some of them silently reads the developer's real
 *           history, which is how three tests started passing against 722 MB of
 *           genuine data. See test/helpers/fixture.js.
 * @property {(ctx: Context) => string} root
 *           The agent's data directory. Shown to the user when nothing is found.
 * @property {(ctx: Context) => boolean} detect
 *           Cheap existence check. Must not throw.
 * @property {(ctx: Context) => AsyncIterable<SessionDescriptor>} discover
 *           Enumerates sessions. Must not throw on a missing or unreadable
 *           directory — yield nothing instead.
 * @property {(d: SessionDescriptor, opts: {cursor: string|null, ctx: Context})
 *            => AsyncIterable<Chunk>} read
 *           Streams one session. Must stream, not buffer: transcripts reach
 *           tens of megabytes.
 * @property {(d: SessionDescriptor, cursor: string, ctx: Context) => boolean} [canResume]
 *           Optional. Answers "is this stored cursor still valid?".
 *
 *           Required because `fingerprint` is opaque: the indexer can see THAT a
 *           session changed but not HOW, so it cannot tell a file that grew from
 *           one that was rewritten shorter. Resuming at a stale offset would
 *           silently read nothing and leave deleted messages in the index.
 *           Returning false makes the indexer drop the session and re-read it.
 *           Omitted means "always resumable".
 */

/** Every field an adapter must provide, checked at registration time. */
const REQUIRED = ['id', 'label', 'root', 'detect', 'discover', 'read'];

/**
 * Validate an adapter at registration rather than at first use, so a typo fails
 * loudly on startup instead of silently indexing nothing.
 *
 * @param {Adapter} adapter
 * @returns {Adapter}
 */
function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('adapter must be an object');
  }
  for (const field of REQUIRED) {
    if (adapter[field] == null) {
      throw new TypeError(`adapter "${adapter.id || '?'}" is missing "${field}"`);
    }
  }
  if (typeof adapter.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(adapter.id)) {
    throw new TypeError(`adapter id "${adapter.id}" must be a lowercase slug`);
  }
  for (const field of ['root', 'detect', 'discover', 'read']) {
    if (typeof adapter[field] !== 'function') {
      throw new TypeError(`adapter "${adapter.id}".${field} must be a function`);
    }
  }
  return adapter;
}

/**
 * Session ids are only unique within an agent, so the index namespaces them.
 * Kept here because both the indexer and the IPC layer must agree on the shape.
 */
function globalSessionId(agentId, sessionId) {
  return `${agentId}:${sessionId}`;
}

module.exports = { assertAdapter, globalSessionId, REQUIRED };
