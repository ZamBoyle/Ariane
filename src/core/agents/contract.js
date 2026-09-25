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
 * @property {string} [continuesFrom]  The agent-local id of the conversation this
 *                                 one continues — a fork, a resume — when the
 *                                 file names it (Codex's forked_from_id).
 * @property {string} [parentId]   For a subagent's conversation: the agent-local
 *                                 id of the conversation that launched it. It is
 *                                 not listed by itself but opened from there, and
 *                                 none of its turns is the person's.
 * @property {number} [bytes]      Size on disk, for progress reporting.
 *
 * @typedef {object} Item
 * One normalised record. `kind` decides how the indexer treats it:
 *   'message'  a conversation turn, shaped like extract.js output
 *   'title'    {title} — a human-readable session title
 *   'summary'  {slug}  — a short session slug
 *   'continuation' {continuedIn} — this conversation goes on in another,
 *              named by its agent-local id (Claude's `continued-in`, written
 *              into the old transcript when it is resumed).
 *   'usage'    {usage} — what the reply just stored cost, for an agent that
 *              writes it in a record of its own (Codex). The indexer adds it to
 *              the session's last assistant message, which may have been stored
 *              in an earlier pass. Yielding the same usage twice counts it
 *              twice: telling a new reply from a repeat is the adapter's job.
 *   'ignored'  {reason} — counted, so format drift is visible rather than silent
 * Any item, whatever its kind, may also carry `quota`: the windows of the
 * agent's usage limits as the record read them (src/core/quota.js). Codex
 * writes them beside its token counts, Claude on the request they refused. The
 * indexer keeps each window's highest reading; a reading is never summed.
 * @property {'message'|'title'|'summary'|'continuation'|'usage'|'ignored'} kind
 * @property {import('../quota').QuotaWindow[]} [quota]
 *
 * @typedef {object} Chunk
 * @property {Item} item
 * @property {string|null} cursor  Resume point AFTER this item. A line whose
 *                                 newline is not written yet is not read at
 *                                 all (readRecords' `unfinished: false`): the
 *                                 next pass reads it whole. Yielding it with the
 *                                 previous cursor stored it now and again later.
 *
 * @typedef {object} Adapter
 * An adapter may also offer `quotas(ctx)`: the windows of its usage limits it
 * keeps OUTSIDE any conversation (Claude's cached reading in ~/.claude.json),
 * as QuotaWindow[] — memoised on the file's stamp, since it runs every pass.
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
 * @property {boolean} [usagePerSession]
 *           True when the agent writes what a SESSION cost, not what each reply
 *           did (Copilot: a running total at each shutdown). The totals stand;
 *           a count shown beside a single message would not, so none is.
 * @property {boolean} [globalIds]
 *           True when a message's `uuid` names that message wherever it appears,
 *           across all of this agent's conversations — so the same uuid in two
 *           conversations means one COPIED it from the other (a resume, a
 *           fork), and the later copy is set aside (Index.markCopies).
 *
 *           Declare it only once measured. Claude's uuids and Codex's API ids
 *           are global: every shared one carried the same text (1 844 and
 *           4 708 rows, 25 September 2026). Copilot and Gemini number tool
 *           calls per session — `bash_5` in two sessions is two different calls
 *           — and declaring it there would hide real messages.
 */

/**
 * ── Token usage ───────────────────────────────────────────────────────────
 *
 * Four agents record what a turn cost, and all four use different words for the
 * same five ideas. The dictionary is written down here — but a mapping of NAMES
 * is not enough on its own, which the `input` row shows:
 *
 * | canonical    | Claude Code                             | Codex                       | Gemini                 | Copilot CLI (`tokenDetails`) |
 * |--------------|-----------------------------------------|-----------------------------|------------------------|------------------------------|
 * | `input`      | `input_tokens`                          | `input_tokens` MINUS cached | `input` MINUS `cached` | `input`                      |
 * | `output`     | `output_tokens`                         | `output_tokens`             | `output` PLUS thoughts | `output`                     |
 * | `cacheRead`  | `cache_read_input_tokens`               | `cached_input_tokens`       | `cached`               | `cache_read`                 |
 * | `cacheWrite` | `cache_creation_input_tokens`           | `cache_write_input_tokens`  | —                      | `cache_write`                |
 * | `reasoning`  | `output_tokens_details.thinking_tokens` | `reasoning_output_tokens`   | `thoughts`             | `modelMetrics…reasoningTokens` |
 *
 * Claude's `input_tokens` EXCLUDES what was served from cache — measured on a
 * real turn, 2 fresh against 24 641 read. Codex's INCLUDES it: 2 692, of which
 * 1 920 cached. Summing the two columns as though the name meant one thing
 * yields a number with no meaning. So the contract states what each field MEANS
 * and the adapter subtracts where it must:
 *
 *   input       prompt tokens billed fresh — never counting cache reads
 *   output      tokens generated, reasoning included
 *   cacheRead   prompt tokens served from cache
 *   cacheWrite  prompt tokens written to cache for later turns
 *   reasoning   the part of `output` spent thinking
 *
 * Gemini and Copilot need the same care, measured on 24 September 2026:
 *   - Gemini's `input` INCLUDES `cached` (total = input + output + thoughts +
 *     tool, 11 of 11), and `thoughts` sits BESIDE `output` — so output takes
 *     the thoughts in, to mean what the contract says.
 *   - Copilot writes no count per reply: only a RUNNING total per session, at
 *     each `session.shutdown`. `tokenDetails` splits it as the contract does;
 *     `modelMetrics.usage.inputTokens` is the same input WITH both cache counts
 *     (19 of 19). The reader counts what each shutdown added, never the total,
 *     and credits it to the last reply before it — the nearest honest place.
 *
 * Where the numbers live is the adapter's business, not the dictionary's:
 * `message.usage` for Claude, `tokens` at the record root for Gemini, and for
 * Codex `payload.info.last_token_usage` — the per-turn one. Never sum Codex's
 * `total_token_usage`, which is cumulative. But do not sum every
 * `last_token_usage` either: Codex repeats the event, and 35 files in 125 came
 * out too high that way. The total is what tells a repeat apart (codex.js).
 *
 * **Absence is not zero.** An agent that recorded nothing yields `null`, and a
 * field it does not keep stays `null`. A 0 would claim the agent did the thing
 * and measured none of it, which is invariant 1 in another costume.
 *
 * Three agents record no usage at all, and two of them are worth naming:
 *
 *   Antigravity  keeps the model — `"model": "gemini-3.7-flash-high"` — but only
 *                inside the protobuf store, never in transcript.jsonl, and no
 *                token count anywhere. Its log's "token" strings are a Python
 *                venv it happened to index. The cause is commercial, not
 *                technical: agy is billed as a flat-rate subscription, so no
 *                per-token figure is surfaced to the client at all. Tools that
 *                display one ESTIMATE it, by counting turns per model inside
 *                the gen_metadata BLOBs. Ariane does not: an estimate wearing a
 *                measurement's clothes is the number this app exists not to
 *                show. `usage` stays null, and the screen says "not recorded".
 *   VS Code      records `max_output_tokens`, `max_prompt_tokens`,
 *                `max_context_window_tokens` and `token_prices`. These are what
 *                the model CAN do and what it COSTS per token — never what a
 *                turn consumed. Reading them as usage yields numbers that look
 *                right and mean nothing. Do not.
 *
 * @typedef {object} Usage
 * @property {number|null} input
 * @property {number|null} output
 * @property {number|null} cacheRead
 * @property {number|null} cacheWrite
 * @property {number|null} reasoning
 */

/** The canonical fields, in the order the dictionary above lists them. */
const USAGE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];

/**
 * Build the canonical usage from what an adapter managed to read.
 *
 * @param {Record<string, unknown>} counts  Canonical names to numbers. Anything
 *   absent, negative or not a finite number is treated as not recorded.
 * @returns {Usage|null}  Null when nothing at all was recorded, so a message
 *   the agent never measured stays distinguishable from one measured at zero.
 */
function usageOf(counts) {
  if (!counts || typeof counts !== 'object') return null;

  const usage = { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null };
  let recorded = false;
  for (const field of USAGE_FIELDS) {
    const value = counts[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    usage[field] = Math.trunc(value);
    recorded = true;
  }
  return recorded ? usage : null;
}

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

/**
 * Where a conversation whose agent recorded no folder is filed. A key, not a
 * word: the screen says it in the reader's language (format.js, folderLabel).
 * It was « (dossier inconnu) » for Codex and « (inconnu) » for the others —
 * two folders, in French in every language (26 September 2026). format.js
 * holds the same value; a test keeps the two equal.
 */
const UNKNOWN_FOLDER = '(?)';

module.exports = { assertAdapter, globalSessionId, usageOf, REQUIRED, USAGE_FIELDS, UNKNOWN_FOLDER };
