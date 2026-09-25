'use strict';

/**
 * Data access layer over SQLite + FTS5.
 *
 * Every statement is prepared once and parameterised; no SQL is ever built by
 * string concatenation from user input. Search terms go through query.js, which
 * turns free-form text into a valid FTS5 MATCH expression.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { toMatchQuery } = require('./query');
const { USAGE_FIELDS } = require('./agents/contract');
const { withoutRepeatedUsage, withoutEchoedPrompts, flattenPrompt, echoOf } = require('./archive');
const { WINDOW_SLACK, keeper } = require('./quota');

/**
 * Bumped for a schema change OR a change in what the adapters extract.
 *
 * The index is derived data, and a file whose size and mtime are unchanged is
 * skipped outright — so new extraction rules would never reach the sessions
 * already stored. Raising this version drops the index and rebuilds it, which
 * takes about ten seconds.
 *
 * 19: usage limits read (Codex's windows and credits, Claude's refused requests)
 * 18: the person's words once: a delivered queued message, a cut last-prompt
 * 17: a resumed or forked conversation linked to the one it continues
 * 16: subagents read, each attached to the conversation that launched it
 * 15: messages copied from another conversation flagged; a Claude line counts what it adds
 * 14: Gemini's and Copilot's tokens
 * 13: Antigravity's tool calls; queued harness notices; masked reasoning named
 * 12: which model answered; Copilot titles read from block values
 * 11: a Claude reply counted once, not per line; Codex's tokens
 * 10: what each turn cost, when the agent recorded it
 * 9: a compacted conversation remembers the transcript it continues
 * 8: folder paths flagged exact or approximate; away summaries kept
 * 7: queued prompts written as content blocks recovered
 * 6: Codex and Copilot tool results no longer collide on one uuid
 * 5: last-prompt and human queued commands recovered
 * 4: sessions holding no readable message are no longer listed
 * 3: queued messages recovered (the person's mid-turn words)
 * 2: multi-agent schema
 * 1: initial
 */
const SCHEMA_VERSION = 19;
/** The five token columns of one message, from the contract's shape. */
function usageColumns(usage) {
  const u = usage || {};
  return {
    tok_input: u.input ?? null,
    tok_output: u.output ?? null,
    tok_cache_read: u.cacheRead ?? null,
    tok_cache_write: u.cacheWrite ?? null,
    tok_reasoning: u.reasoning ?? null,
  };
}

/**
 * And back again. Null when every column is null: a turn the agent never
 * measured must not come back looking like one measured at zero.
 */
function usageFromRow(row) {
  const usage = {
    input: row.tok_input,
    output: row.tok_output,
    cacheRead: row.tok_cache_read,
    cacheWrite: row.tok_cache_write,
    reasoning: row.tok_reasoning,
  };
  return USAGE_FIELDS.some((field) => usage[field] != null) ? usage : null;
}

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

/**
 * What the archive keeps of a session, and of its messages. Shared by the
 * pass that saves a vanished conversation and by the migration that saves
 * everything unproven before dropping the tables — one description, so the
 * two can never disagree about what a saved conversation contains.
 */
const ARCHIVE_SESSION_COLUMNS = [
  'id',
  'agent_id',
  'title',
  'slug',
  'git_branch',
  'first_prompt',
  'first_at',
  'last_at',
  'source',
  'file_path',
  'parent_id',
  'continued_in',
  'continues_from',
];
const ARCHIVE_SESSION_SQL = archiveSessionSelect(ARCHIVE_SESSION_COLUMNS);

function archiveSessionSelect(columns) {
  return `
  SELECT ${columns.map((name) => `s.${name}`).join(', ')},
         f.path AS folder_path, f.path_exact AS folder_exact
  FROM sessions s JOIN folders f ON f.id = s.folder_id`;
}

/** The same, restricted to what an older index has — see archiveMessagesSql. */
function archiveSessionSql(db) {
  const present = new Set(
    db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .map((c) => c.name)
  );
  return archiveSessionSelect(ARCHIVE_SESSION_COLUMNS.filter((name) => present.has(name)));
}
const ARCHIVE_MESSAGE_COLUMNS = [
  'seq',
  'uuid',
  'parent_uuid',
  'role',
  'ts',
  'model',
  'tok_input',
  'tok_output',
  'tok_cache_read',
  'tok_cache_write',
  'tok_reasoning',
  'text',
  'thinking',
  'parts',
  'is_meta',
  'is_notice',
  'is_sidechain',
  'command',
];
const ARCHIVE_MESSAGES_SQL = `
  SELECT ${ARCHIVE_MESSAGE_COLUMNS.join(', ')}
  FROM messages WHERE session_id = ? ORDER BY seq`;

/**
 * The same SELECT, restricted to the columns this database actually has.
 *
 * **The migration reads an index written by an OLDER schema**, so it must never
 * name a column of today's: one that does not exist aborts the whole save — the
 * save that exists precisely to run BEFORE the tables are dropped. Measured the
 * hard way when v10 added five token columns: "index v9 could not be read for
 * the archive (no such column: tok_input)". It degraded to keeping a copy of
 * the file, which is luck, not design.
 */
function archiveMessagesSql(db) {
  const present = new Set(
    db
      .prepare('PRAGMA table_info(messages)')
      .all()
      .map((c) => c.name)
  );
  const columns = ARCHIVE_MESSAGE_COLUMNS.filter((name) => present.has(name));
  return `SELECT ${columns.join(', ')} FROM messages WHERE session_id = ? ORDER BY seq`;
}

/**
 * What an archived message may be missing, and what to put there.
 *
 * The archive format is migrated, never dropped, so a file written before a
 * column existed comes back without it — and a named parameter the statement
 * expects but the row does not carry is a throw, not a null. Every nullable
 * column added after a message could be archived belongs here.
 */
const ARCHIVED_MESSAGE_DEFAULTS = {
  tok_input: null,
  tok_output: null,
  tok_cache_read: null,
  tok_cache_write: null,
  tok_reasoning: null,
};

/**
 * Snippet delimiters. Deliberately NOT HTML: the renderer escapes the text and
 * only then swaps these sentinels for markup, so a message containing a script
 * tag can never reach the DOM as markup.
 */
const HL_OPEN = String.fromCharCode(1);
const HL_CLOSE = String.fromCharCode(2);
const ELLIPSIS = '…';

/**
 * When a message was written, for searching by date. Some of the person's own
 * prompts carry no time at all: Claude Code's `last-prompt` pointer has none,
 * and measured on a real corpus 83 prompts in 21 sessions exist only there.
 * Dropping them from every dated search would lose the person's words, so they
 * take the time of the message written just before them — the same place the
 * transcript shows them — and failing that, the session's start.
 */
/**
 * Is message `m` of session `s` a copy — does an EARLIER conversation of the
 * same agent hold it? Earlier by first line, then last, then id: the dates
 * count every line, copies included, so flagging never reorders anything. The
 * lookup goes by uuid (`INDEXED BY`, and `o.uuid <> ''` so the partial index
 * applies): written plainly, SQLite walked every session of the agent for
 * every message — 272 s on the real corpus.
 */
const IS_COPY_NOW = `EXISTS (
  SELECT 1 FROM messages o INDEXED BY messages_by_uuid
  JOIN sessions so ON so.id = o.session_id
  WHERE o.uuid = m.uuid AND o.uuid <> '' AND o.session_id <> m.session_id
    AND so.agent_id = s.agent_id
    AND (COALESCE(so.first_at, ''), COALESCE(so.last_at, ''), so.id)
      < (COALESCE(s.first_at, ''), COALESCE(s.last_at, ''), s.id))`;

/**
 * A conversation is listed unless every message it holds is a copy: a fork
 * nobody went on with has nothing to show that its original does not already
 * show (Index.markCopies). Written so the usual case stops at the first row.
 */
const OWN_MESSAGES = `(EXISTS (SELECT 1 FROM messages own
    WHERE own.session_id = s.id AND own.is_copy = 0)
  OR NOT EXISTS (SELECT 1 FROM messages held WHERE held.session_id = s.id))`;

/**
 * What the sidebar lists, and so what every count beside it counts: not a
 * subagent — it is opened from the conversation that launched it — and not a
 * conversation made of copies alone.
 */
const LISTED = `s.parent_id IS NULL AND ${OWN_MESSAGES}`;

const MESSAGE_TIME_SQL = `COALESCE(
  NULLIF(m.ts, ''),
  (SELECT p.ts FROM messages p
    WHERE p.session_id = m.session_id AND p.seq < m.seq AND p.ts <> ''
    ORDER BY p.seq DESC LIMIT 1),
  s.first_at)`;

class Index {
  /** Statements whose SQL depends on how many agents are hidden, by shape. */
  #built = new Map();

  /**
   * @param {string} dbPath Path to the SQLite file, or ':memory:'.
   * @param {{archive?: import('./archive').Archive}} [options] Where conversations
   *   that exist nowhere else are saved before a migration drops the tables.
   */
  constructor(dbPath, { archive = null } = {}) {
    this.path = dbPath;
    this.archive = archive;
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    // SQLite copies its journal into the database, and waits for the disk,
    // every 1 000 pages by default — about 4 MB. A rebuild writes each page some
    // four times (475 MB through the journal for a 117 MB index), so that was a
    // hundred pauses: half of a 30-second pass. Every 16 384 pages (64 MB) it
    // took 16 s, the journal peaking at 68 MB; and it is emptied after each
    // pass that wrote anything (settle). Never checkpointing at all saved 2 s
    // more for a 475 MB journal: not worth it.
    this.db.pragma(`wal_autocheckpoint = ${CHECKPOINT_PAGES}`);
    this.db.pragma('foreign_keys = ON');
    const carried = this.#migrate();
    // Recreates the full-text triggers too, should a rebuild have been cut
    // short while they were off (suspendSearchIndex).
    this.db.exec(SCHEMA_SQL);
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    this.#prepare();
    if (carried.length) this.setMeta(QUOTA_CARRY, JSON.stringify(carried));
    if (this.meta(SEARCH_PENDING) === '1') this.resumeSearchIndex();
  }

  /**
   * The index is derived data, never a source of truth: everything in it can be
   * rebuilt from the agents' own files in a few seconds. So an older schema is
   * dropped rather than patched column by column, which keeps schema.sql the one
   * and only description of the shape.
   */
  #migrate() {
    const current = this.db.pragma('user_version', { simple: true });
    if (current === SCHEMA_VERSION || current === 0) return [];

    const tables = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'"
      )
      .all()
      .map((r) => r.name);
    if (tables.length === 0) return [];

    // Rebuilt from the agents' files — except what they no longer have. That
    // goes to the archive BEFORE a single table is dropped.
    if (this.archive) this.#saveBeforeRebuild(current);
    // And so do the usage limits a source no longer keeps: Claude Desktop's
    // history holds a month. They wait for the first pass (restoreCarriedQuotas).
    const carried = this.#quotasToCarry(tables);

    this.db.exec('PRAGMA foreign_keys = OFF');
    for (const name of tables) this.db.exec(`DROP TABLE IF EXISTS "${name}"`);
    this.db.exec('PRAGMA foreign_keys = ON');
    return carried;
  }

  /** The windows an older index holds, in quota.js's shape; none if it has no such table. */
  #quotasToCarry(tables) {
    if (!tables.includes('quota_windows')) return [];
    try {
      return this.db
        .prepare(
          `SELECT agent_id AS agent, limit_id AS "limit", minutes, resets_at AS resetsAt, used,
                  reached, seen_at AS at, last_at AS lastAt, plan, credits, session_id AS session
           FROM quota_windows`
        )
        .all()
        .map((w) => ({ ...w, reached: Boolean(w.reached), credits: safeParse(w.credits, null) }));
    } catch {
      return []; // a layout this code cannot read: rebuilt from the files alone
    }
  }

  /**
   * Save every conversation not PROVEN to exist elsewhere: no source path on
   * record, or a path that no longer resolves. Some of these are alive and
   * well — a Copilot session keeps no path here — and the first pass after the
   * rebuild throws those copies away again. A few needless copies, once per
   * schema change, is the price of never losing the others.
   */
  #saveBeforeRebuild(fromVersion) {
    try {
      const messagesOf = this.db.prepare(archiveMessagesSql(this.db));
      for (const session of this.db.prepare(archiveSessionSql(this.db)).all()) {
        const file = session.file_path ? session.file_path.split('#')[0] : '';
        const proven = session.source !== 'archive' && file && fs.existsSync(file);
        if (proven || this.archive.has(session.id)) continue;
        const rows = messagesOf.all(session.id);
        // An index built before 0.3.4 holds a Claude reply's usage on each of
        // its lines (archive.js, withoutRepeatedUsage). Saved as it is, the
        // inflated count would be kept in a format nothing migrates any more.
        // And one built before 25 September 2026 may hold the person's words twice.
        const claude = session.agent_id === 'claude';
        let messages = fromVersion < 11 && claude ? withoutRepeatedUsage(rows) : rows;
        if (fromVersion < 18 && claude) messages = withoutEchoedPrompts(messages);
        if (messages.length) this.archive.write(session.id, session, messages);
      }
    } catch (error) {
      // An index laid out in a way this code cannot read. Keep the whole file
      // rather than guess: nothing is lost, it is just not in the archive.
      if (this.path === ':memory:') throw error;
      const backup = `${this.path}.avant-v${SCHEMA_VERSION}`;
      this.db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      console.error(
        `Ariane: index v${fromVersion} could not be read for the archive (${error.message}). ` +
          `A full copy is kept in ${backup}.`
      );
    }
  }

  #prepare() {
    const db = this.db;
    this.s = {
      upsertAgent: db.prepare(
        'INSERT INTO agents (id, label, root, seen_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET label = excluded.label, root = excluded.root, ' +
          'seen_at = excluded.seen_at'
      ),
      listAgents: db.prepare(`
        SELECT a.id, a.label, a.root, a.seen_at AS seenAt,
               COUNT(s.id) AS sessionCount,
               COALESCE(SUM(s.message_count), 0) AS messageCount,
               MAX(s.last_at) AS lastAt
        FROM agents a LEFT JOIN sessions s ON s.agent_id = a.id AND ${LISTED}
        GROUP BY a.id ORDER BY lastAt IS NULL, lastAt DESC, a.label
      `),
      folderByPath: db.prepare('SELECT id FROM folders WHERE path = ?'),
      insertFolder: db.prepare(
        'INSERT INTO folders (path, dir_name, exists_on_disk, path_exact) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(path) DO UPDATE SET dir_name = COALESCE(excluded.dir_name, dir_name), ' +
          'exists_on_disk = MAX(folders.exists_on_disk, excluded.exists_on_disk), ' +
          // MAX, not excluded: one exact source is enough to settle the path,
          // and a later guess must not undo it.
          'path_exact = MAX(folders.path_exact, excluded.path_exact)'
      ),
      upsertSession: db.prepare(`
        INSERT INTO sessions (id, agent_id, folder_id, title, slug, git_branch, first_prompt,
                              message_count, first_at, last_at, source, file_path, parent_id,
                              continues_from)
        VALUES (@id, @agent_id, @folder_id, @title, @slug, @git_branch, @first_prompt,
                @message_count, @first_at, @last_at, @source, @file_path, @parent_id,
                @continues_from)
        ON CONFLICT(id) DO UPDATE SET
          agent_id      = excluded.agent_id,
          folder_id     = excluded.folder_id,
          title         = COALESCE(excluded.title, sessions.title),
          slug          = COALESCE(excluded.slug, sessions.slug),
          git_branch    = COALESCE(excluded.git_branch, sessions.git_branch),
          first_prompt  = COALESCE(sessions.first_prompt, excluded.first_prompt),
          message_count = excluded.message_count,
          source        = excluded.source,
          file_path     = COALESCE(excluded.file_path, sessions.file_path),
          parent_id     = COALESCE(excluded.parent_id, sessions.parent_id),
          continues_from = COALESCE(excluded.continues_from, sessions.continues_from)
      `),
      insertMessage: db.prepare(`
        INSERT INTO messages (session_id, seq, uuid, parent_uuid, role, ts, model,
                              tok_input, tok_output, tok_cache_read, tok_cache_write,
                              tok_reasoning,
                              text, thinking, parts, is_meta, is_notice, is_sidechain, command)
        VALUES (@session_id, @seq, @uuid, @parent_uuid, @role, @ts, @model,
                @tok_input, @tok_output, @tok_cache_read, @tok_cache_write,
                @tok_reasoning,
                @text, @thinking, @parts, @is_meta, @is_notice, @is_sidechain, @command)
        ON CONFLICT(session_id, uuid) WHERE uuid IS NOT NULL AND uuid <> ''
        DO NOTHING
      `),
      maxSeq: db.prepare('SELECT COALESCE(MAX(seq), -1) AS n FROM messages WHERE session_id = ?'),
      // A field the agent did not record stays as it was: adding nothing to a
      // null must not make it a zero.
      addUsage: db.prepare(`
        UPDATE messages SET
          tok_input = CASE WHEN @input IS NULL THEN tok_input ELSE COALESCE(tok_input, 0) + @input END,
          tok_output = CASE WHEN @output IS NULL THEN tok_output ELSE COALESCE(tok_output, 0) + @output END,
          tok_cache_read = CASE WHEN @cacheRead IS NULL THEN tok_cache_read
                           ELSE COALESCE(tok_cache_read, 0) + @cacheRead END,
          tok_cache_write = CASE WHEN @cacheWrite IS NULL THEN tok_cache_write
                            ELSE COALESCE(tok_cache_write, 0) + @cacheWrite END,
          tok_reasoning = CASE WHEN @reasoning IS NULL THEN tok_reasoning
                          ELSE COALESCE(tok_reasoning, 0) + @reasoning END
        WHERE id = (SELECT id FROM messages WHERE session_id = @session AND role = 'assistant'
                    ORDER BY seq DESC LIMIT 1)
      `),

      /**
       * Recomputes the denormalised session columns from its messages. Called
       * once after a batch rather than per row, so an import stays O(1) writes
       * per session instead of O(n).
       */
      touchSession: db.prepare(`
        UPDATE sessions SET
          -- A copy is another conversation's message: not counted here. The
          -- dates keep every line — they order the conversations when copies
          -- are sorted out, and must not move because of it (markCopies).
          message_count = (SELECT COUNT(*) FROM messages
                            WHERE session_id = sessions.id AND is_copy = 0),
          first_at = (SELECT MIN(ts) FROM messages WHERE session_id = sessions.id AND ts <> ''),
          last_at  = (SELECT MAX(ts) FROM messages WHERE session_id = sessions.id AND ts <> ''),
          first_prompt = COALESCE(first_prompt,
            (SELECT text FROM messages WHERE session_id = sessions.id
              AND role = 'user' AND text <> '' AND is_meta = 0 AND is_notice = 0
              AND is_copy = 0
              ORDER BY seq LIMIT 1))
        WHERE id = ?
      `),
      countMessages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?'),
      hasText: db.prepare(
        'SELECT 1 FROM messages WHERE session_id = ? AND role = ? AND text = ? LIMIT 1'
      ),
      textsContaining: db.prepare(
        "SELECT text FROM messages WHERE session_id = ? AND role = ? AND text <> '' AND instr(text, ?) > 0"
      ),
      quotaNear: db.prepare(`
        SELECT id, limit_id AS "limit", minutes, resets_at AS resetsAt, used, reached,
               seen_at AS at, last_at AS lastAt, plan, credits, session_id AS session
        FROM quota_windows
        WHERE agent_id = ? AND limit_id = ? AND minutes = ? AND resets_at BETWEEN ? AND ?
        ORDER BY abs(resets_at - ?) LIMIT 1`),
      quotaInsert: db.prepare(`
        INSERT INTO quota_windows
          (agent_id, limit_id, minutes, resets_at, used, reached, seen_at, last_at, plan, credits,
           session_id)
        VALUES (@agent, @limit, @minutes, @resetsAt, @used, @reached, @at, @lastAt, @plan, @credits,
                @session)`),
      quotaUpdate: db.prepare(`
        UPDATE quota_windows
        SET used = @used, reached = @reached, seen_at = @at, last_at = @lastAt, plan = @plan,
            credits = @credits, session_id = @session
        WHERE id = @id`),
      quotaForget: db.prepare('UPDATE quota_windows SET session_id = NULL WHERE session_id = ?'),
      dropMeta: db.prepare('DELETE FROM meta WHERE key = ?'),
      dropQueuedCopy: db.prepare(`
        DELETE FROM messages WHERE id = (
          SELECT id FROM messages
          WHERE session_id = ? AND role = 'user' AND uuid IS NULL AND ts <> ''
            AND is_notice = 0 AND text = ?
          ORDER BY seq DESC LIMIT 1)`),
      dropSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
      messageText: db.prepare('SELECT text FROM messages WHERE id = ?'),
      archiveSession: db.prepare(`${ARCHIVE_SESSION_SQL} WHERE s.id = ?`),
      archiveMessages: db.prepare(ARCHIVE_MESSAGES_SQL),
      sessionsBrief: db.prepare('SELECT id, agent_id AS agentId, source FROM sessions'),
      markArchived: db.prepare("UPDATE sessions SET source = 'archive' WHERE id = ?"),
      clearSourcesOf: db.prepare('DELETE FROM sources WHERE session_id = ?'),
      insertAgentIfAbsent: db.prepare(
        'INSERT INTO agents (id, label, root, seen_at) VALUES (?, ?, NULL, NULL) ON CONFLICT(id) DO NOTHING'
      ),
      setTitle: db.prepare('UPDATE sessions SET title = ? WHERE id = ?'),
      setSlug: db.prepare('UPDATE sessions SET slug = ? WHERE id = ?'),
      setContinues: db.prepare('UPDATE sessions SET continues_uuid = ? WHERE id = ?'),
      setContinuedIn: db.prepare('UPDATE sessions SET continued_in = ? WHERE id = ?'),
      // The transcript this one continues: the session holding that message.
      // Three threads lead back: a compaction boundary naming a message of the
      // earlier transcript — never through a copy, or a resumed session that
      // copied it would pass for the transcript it came from and turn the
      // chain round —, a fork naming its origin, and a resume named by it.
      parentOf: db.prepare(`
        SELECT id FROM (
          SELECT m.session_id AS id FROM sessions s
          JOIN messages m ON m.uuid = s.continues_uuid AND m.is_copy = 0
          WHERE s.id = @id AND m.session_id <> s.id
          UNION ALL
          SELECT p.id FROM sessions me JOIN sessions p ON p.id = me.continues_from
          WHERE me.id = @id
          UNION ALL
          SELECT p.id FROM sessions p WHERE p.continued_in = @id AND p.id <> @id
        ) LIMIT 1
      `),
      // And the same three, forward.
      childOf: db.prepare(`
        SELECT id FROM (
          SELECT s.id FROM sessions s
          JOIN messages m ON m.uuid = s.continues_uuid AND m.is_copy = 0
          WHERE m.session_id = @id AND s.id <> @id
          UNION ALL
          SELECT c.id FROM sessions me JOIN sessions c ON c.id = me.continued_in
          WHERE me.id = @id
          UNION ALL
          SELECT c.id FROM sessions c WHERE c.continues_from = @id AND c.id <> @id
        ) LIMIT 1
      `),
      // Every row whose flag can change: a uuid held twice, or a flag already
      // set. IS_COPY_NOW says what a copy is. 72 ms on the real corpus.
      markCopies: db.prepare(`
        UPDATE messages SET is_copy = 1 - is_copy
        WHERE id IN (
          SELECT m.id FROM messages m JOIN sessions s ON s.id = m.session_id
          WHERE s.agent_id IN (SELECT value FROM json_each(@agents))
            AND m.uuid <> ''
            AND (m.is_copy = 1 OR m.uuid IN (
              SELECT uuid FROM messages WHERE uuid <> '' GROUP BY uuid HAVING COUNT(*) > 1))
            AND m.is_copy <> ${IS_COPY_NOW}
        )
        RETURNING session_id AS sessionId
      `),
      // The same, looking only at what a pass wrote: the uuids of rows newer
      // than `since`, wherever else they are held — and every flag already
      // set, in case the message it copied is gone. A conversation being
      // written is re-read at every pass; this keeps that pass near-free.
      markNewCopies: db.prepare(`
        UPDATE messages SET is_copy = 1 - is_copy
        WHERE id IN (
          SELECT m.id FROM messages m JOIN sessions s ON s.id = m.session_id
          WHERE s.agent_id IN (SELECT value FROM json_each(@agents))
            AND m.uuid <> ''
            AND (m.is_copy = 1 OR m.uuid IN (
              SELECT uuid FROM messages WHERE id > @since AND uuid <> ''))
            AND m.is_copy <> ${IS_COPY_NOW}
        )
        RETURNING session_id AS sessionId
      `),
      lastMessageId: db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages'),
      // Where a conversation's copies come from: the one holding most of them.
      copiedFrom: db.prepare(`
        SELECT o.session_id AS id, COUNT(*) AS n
        FROM messages m
        JOIN sessions s ON s.id = m.session_id
        JOIN messages o ON o.uuid = m.uuid AND o.session_id <> m.session_id AND o.is_copy = 0
        JOIN sessions so ON so.id = o.session_id AND so.agent_id = s.agent_id
        WHERE m.session_id = ? AND m.is_copy = 1
        GROUP BY o.session_id ORDER BY n DESC, o.session_id LIMIT 1
      `),
      // The subagents a conversation launched, in the order they started.
      subagents: db.prepare(`
        SELECT s.id, s.agent_id AS agentId, s.title, s.first_prompt AS firstPrompt,
               s.message_count AS messageCount, s.first_at AS firstAt, s.last_at AS lastAt,
               u.tokOutput
        FROM sessions s
        LEFT JOIN (
          SELECT session_id, SUM(tok_output) AS tokOutput FROM messages
          WHERE is_copy = 0 AND session_id IN (SELECT id FROM sessions WHERE parent_id = ?)
          GROUP BY session_id
        ) u ON u.session_id = s.id
        WHERE s.parent_id = ?
        ORDER BY s.first_at IS NULL, s.first_at, s.id
      `),
      countCopies: db.prepare(
        'SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND is_copy = 1'
      ),
      // A part made of copies alone — a fork nobody went on with — has nothing
      // to read that the part before it does not show.
      chainPart: db.prepare(`
        SELECT id, title, first_at AS firstAt, last_at AS lastAt, message_count AS messageCount
        FROM sessions s WHERE id = ? AND ${OWN_MESSAGES}
      `),

      getSource: db.prepare('SELECT * FROM sources WHERE key = ?'),
      setSource: db.prepare(`
        INSERT INTO sources (key, agent_id, session_id, fingerprint, cursor, indexed_at)
        VALUES (@key, @agent_id, @session_id, @fingerprint, @cursor, @indexed_at)
        ON CONFLICT(key) DO UPDATE SET agent_id = excluded.agent_id,
          session_id = excluded.session_id, fingerprint = excluded.fingerprint,
          cursor = excluded.cursor, indexed_at = excluded.indexed_at
      `),
      clearSource: db.prepare('DELETE FROM sources WHERE key = ?'),
      clearFirstPrompt: db.prepare('UPDATE sessions SET first_prompt = NULL WHERE id = ?'),
      deleteMessages: db.prepare('DELETE FROM messages WHERE session_id = ?'),

      listFolders: db.prepare(`
        SELECT f.id, f.path, f.dir_name AS dirName, f.exists_on_disk AS existsOnDisk,
               f.path_exact AS pathExact,
               COUNT(s.id) AS sessionCount,
               COUNT(DISTINCT s.agent_id) AS agentCount,
               GROUP_CONCAT(DISTINCT s.agent_id) AS agentIds,
               COALESCE(SUM(s.message_count), 0) AS messageCount,
               MAX(s.last_at) AS lastAt
        FROM folders f LEFT JOIN sessions s ON s.folder_id = f.id AND ${LISTED}
        GROUP BY f.id HAVING sessionCount > 0
        ORDER BY lastAt IS NULL, lastAt DESC, f.path
      `),
      listSessions: db.prepare(sessionsOfFolderSql('')),
      getSession: db.prepare(`
        SELECT s.id, s.agent_id AS agentId, s.title, s.slug, s.git_branch AS gitBranch,
               s.first_prompt AS firstPrompt,
               s.message_count AS messageCount, s.first_at AS firstAt, s.last_at AS lastAt,
               s.source, s.file_path AS filePath, f.path AS folderPath, f.id AS folderId,
               s.parent_id AS parentId
        FROM sessions s JOIN folders f ON f.id = s.folder_id WHERE s.id = ?
      `),
      // One conversation's cost, as the sidebar sums it (sessionsOfFolderSql):
      // its own messages, copies left where they came from, subagents apart.
      tokenSums: db.prepare(`
        SELECT SUM(tok_input) AS tokInput, SUM(tok_output) AS tokOutput,
               SUM(tok_cache_read) AS tokCacheRead, SUM(tok_cache_write) AS tokCacheWrite
        FROM messages WHERE session_id = ? AND is_copy = 0
      `),
      subagentSums: db.prepare(`
        SELECT COUNT(DISTINCT sp.id) AS subagents,
               SUM(m.tok_input) AS subInput, SUM(m.tok_output) AS subOutput,
               SUM(m.tok_cache_read) AS subCacheRead, SUM(m.tok_cache_write) AS subCacheWrite
        FROM sessions sp LEFT JOIN messages m ON m.session_id = sp.id AND m.is_copy = 0
        WHERE sp.parent_id = ?
      `),
      getMessages: db.prepare(`
        SELECT id, seq, uuid, parent_uuid AS parentUuid, role, ts, model,
               tok_input, tok_output, tok_cache_read, tok_cache_write, tok_reasoning,
               text, thinking,
               parts, is_meta AS isMeta, is_notice AS isNotice,
               is_sidechain AS isSidechain, command
        FROM messages WHERE session_id = ? AND is_copy = 0 ORDER BY seq
      `),
      stats: db.prepare(`
        -- Counts what the reader is actually shown. A folder whose sessions
        -- were all dropped as empty still has a row, but it is not listed, so
        -- counting rows here would make the footer contradict the sidebar.
        -- A conversation holding nothing but copies is not listed either.
        SELECT (SELECT COUNT(*) FROM agents WHERE EXISTS
                 (SELECT 1 FROM sessions s WHERE s.agent_id = agents.id
                    AND ${LISTED})) AS agents,
               (SELECT COUNT(*) FROM folders WHERE EXISTS
                 (SELECT 1 FROM sessions s WHERE s.folder_id = folders.id
                    AND ${LISTED})) AS folders,
               (SELECT COUNT(*) FROM sessions s WHERE ${LISTED}) AS sessions,
               (SELECT COUNT(*) FROM messages m JOIN sessions s ON s.id = m.session_id
                  WHERE m.is_copy = 0 AND s.parent_id IS NULL) AS messages
      `),
      getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
      setMeta: db.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ),
    };

    this.tx = {
      messages: this.db.transaction((rows) => {
        for (const row of rows) this.s.insertMessage.run(row);
      }),
    };
  }

  // -- writing ---------------------------------------------------------------

  upsertAgent(id, label, root) {
    this.s.upsertAgent.run(id, label, root || null, new Date().toISOString());
  }

  agents() {
    return this.s.listAgents.all();
  }

  /**
   * @param {boolean} exact False when the path is an approximation the adapter
   *   could not confirm — a decoded directory name rather than a recorded cwd.
   */
  folderId(realPath, dirName = null, existsOnDisk = true, exact = true) {
    this.s.insertFolder.run(realPath, dirName, existsOnDisk ? 1 : 0, exact ? 1 : 0);
    return this.s.folderByPath.get(realPath).id;
  }

  upsertSession(row) {
    this.s.upsertSession.run({
      title: null,
      slug: null,
      git_branch: null,
      first_prompt: null,
      message_count: 0,
      first_at: null,
      last_at: null,
      source: 'transcript',
      file_path: null,
      parent_id: null,
      continues_from: null,
      ...row,
    });
  }

  /**
   * @param {string} sessionId
   * @param {object[]} messages Normalised records from extract.js.
   * @param {number} [startSeq] Defaults to continuing after the stored maximum.
   */
  /**
   * Add what a reply cost to the session's last assistant message, for an
   * agent that records it apart from the reply (contract.js, kind 'usage').
   * @returns {boolean} False when the session has no assistant message yet.
   */
  addUsage(sessionId, usage) {
    if (!usage) return false;
    const { changes } = this.s.addUsage.run({
      session: sessionId,
      input: usage.input ?? null,
      output: usage.output ?? null,
      cacheRead: usage.cacheRead ?? null,
      cacheWrite: usage.cacheWrite ?? null,
      reasoning: usage.reasoning ?? null,
    });
    return changes > 0;
  }

  addMessages(sessionId, messages, startSeq) {
    if (messages.length === 0) return 0;
    let seq = startSeq ?? this.s.maxSeq.get(sessionId).n + 1;
    const rows = messages.map((m) => ({
      session_id: sessionId,
      seq: seq++,
      uuid: m.uuid || null,
      parent_uuid: m.parentUuid || null,
      role: m.role,
      ts: m.timestamp || '',
      model: m.model || '',
      ...usageColumns(m.usage),
      text: m.text || '',
      thinking: m.thinking || '',
      parts: JSON.stringify(m.parts || []),
      is_meta: m.isMeta ? 1 : 0,
      is_notice: m.isNotice ? 1 : 0,
      is_sidechain: m.isSidechain ? 1 : 0,
      command: m.command ? JSON.stringify(m.command) : null,
    }));
    this.tx.messages(rows);
    return rows.length;
  }

  /**
   * Does this session already hold that exact turn?
   *
   * Used for records that repeat a message stored elsewhere — Claude Code's
   * `last-prompt` points at a prompt that usually already has its own record,
   * but sometimes does not. Asking lets the rare survivor through without
   * showing the common case twice.
   */
  hasMessageText(sessionId, role, text) {
    if (this.s.hasText.get(sessionId, role, text)) return true;
    // Claude Code writes that pointer in its own shape (archive.js, echoOf).
    // Measured on 25 September 2026: 90 of 101 pointers left in an index
    // repeated a message that way, and showed as the newest one, undated. The
    // rare survivor still gets through — a text the session holds in no shape.
    const { stem, matches } = echoOf(text);
    const word = stem.split(' ')[0];
    if (!word) return false;
    return this.s.textsContaining
      .all(sessionId, role, word)
      .some(({ text: held }) => matches(flattenPrompt(held)));
  }

  /**
   * Keep what one conversation read of its agent's limits: each window merged
   * with the one already stored, if any (quota.js keeper) — so a pass that
   * reads a file again, or a fork that copies old readings, changes nothing.
   * One transaction per conversation, never one write per reading.
   *
   * @param {string} agentId
   * @param {string} sessionId
   * @param {import('./quota').QuotaWindow[]} windows
   */
  recordQuotas(agentId, sessionId, windows) {
    if (!windows.length) return;
    const row = (w) => ({
      agent: agentId,
      limit: w.limit,
      minutes: w.minutes,
      resetsAt: w.resetsAt,
      used: w.used,
      reached: w.reached ? 1 : 0,
      at: w.at,
      lastAt: w.lastAt,
      plan: w.plan,
      credits: w.credits ? JSON.stringify(w.credits) : null,
      session: w.session,
    });
    this.db.transaction(() => {
      for (const w of windows) {
        const reading = { ...w, session: sessionId };
        const held = this.s.quotaNear.get(
          agentId,
          w.limit,
          w.minutes,
          w.resetsAt - WINDOW_SLACK,
          w.resetsAt + WINDOW_SLACK,
          w.resetsAt
        );
        if (!held) {
          this.s.quotaInsert.run(row(reading));
          continue;
        }
        const stored = {
          ...held,
          reached: Boolean(held.reached),
          credits: safeParse(held.credits, null),
        };
        const kept = keeper(stored, reading);
        const changed = ['used', 'at', 'lastAt', 'reached'].some((k) => kept[k] !== stored[k]);
        if (changed) {
          this.s.quotaUpdate.run({ ...row(kept), id: held.id });
        }
      }
    })();
  }

  /**
   * After a rebuild, once the pass has read these agents' files again: put back
   * the windows it did NOT read again — Claude Desktop keeps a month, and what
   * is older exists only here. A window the files still hold was just written
   * from them and is left alone: what they say wins over what an older build
   * computed. The other agents' windows wait for a pass that reads theirs.
   *
   * @param {string[]} agentIds  The agents whose discovery ran to the end.
   * @returns {number} Windows put back.
   */
  restoreCarriedQuotas(agentIds) {
    const raw = this.meta(QUOTA_CARRY);
    if (!raw) return 0;
    const carried = safeParse(raw, []);
    const done = new Set(agentIds);
    let restored = 0;
    this.db.transaction(() => {
      for (const w of carried.filter((x) => done.has(x.agent))) {
        const held = this.s.quotaNear.get(
          w.agent,
          w.limit,
          w.minutes,
          w.resetsAt - WINDOW_SLACK,
          w.resetsAt + WINDOW_SLACK,
          w.resetsAt
        );
        if (held) continue;
        this.s.quotaInsert.run({
          ...w,
          reached: w.reached ? 1 : 0,
          credits: w.credits ? JSON.stringify(w.credits) : null,
        });
        restored += 1;
      }
      const waiting = carried.filter((x) => !done.has(x.agent));
      if (waiting.length) this.setMeta(QUOTA_CARRY, JSON.stringify(waiting));
      else this.s.dropMeta.run(QUOTA_CARRY);
    })();
    return restored;
  }

  /**
   * Every window read, for the assistants shown and a period — the statistics
   * view's quota block. Oldest first.
   */
  quotas({ hidden = [], since = null } = {}) {
    const hiding = hidingOn('agent_id', hidden);
    const sql = `
      SELECT agent_id AS agentId, limit_id AS "limit", minutes, resets_at AS resetsAt, used,
             reached, seen_at AS at, last_at AS lastAt, plan, credits
      FROM quota_windows
      WHERE 1 = 1${hiding.where}${since != null ? ' AND last_at >= ?' : ''}
      ORDER BY agent_id, limit_id, minutes, resets_at`;
    const params = since != null ? [...hiding.params, since] : hiding.params;
    return this.#dynamic(`quotas:${hiding.params.length}:${since != null}`, sql)
      .all(...params)
      .map((w) => ({ ...w, reached: Boolean(w.reached), credits: safeParse(w.credits, null) }));
  }

  /**
   * A queued message was delivered as a line of its own (agents/claude.js):
   * the queued copy of that text, the latest one, is no longer needed.
   */
  dropQueuedCopy(sessionId, text) {
    return this.s.dropQueuedCopy.run(sessionId, text).changes > 0;
  }

  finalizeSession(sessionId) {
    this.s.touchSession.run(sessionId);
  }

  /**
   * Forget a session that turned out to hold no readable message.
   *
   * These are not conversations: a chat panel opened and closed, or a record
   * whose content we cannot read. Measured on a real machine, 50 of 64 VS Code
   * sessions were in this state, and 14 folders contained nothing else — all of
   * it cluttering the sidebar with rows that open onto nothing.
   *
   * The `sources` row is deliberately kept, so an unchanged file is still
   * skipped on the next pass. If the session later gains messages its
   * fingerprint changes, it is re-read, and it comes back.
   *
   * @returns {boolean} true when the session was dropped.
   */
  dropIfEmpty(sessionId) {
    if (this.s.countMessages.get(sessionId).n > 0) return false;
    this.s.dropSession.run(sessionId);
    return true;
  }

  setTitle(sessionId, title) {
    this.s.setTitle.run(title, sessionId);
  }

  setSlug(sessionId, slug) {
    this.s.setSlug.run(slug, sessionId);
  }

  /**
   * This transcript continues another: remember the message it was cut after.
   * Claude Code compacts by opening a new file, and that uuid is the only
   * thread back (see `chain`).
   */
  setContinues(sessionId, messageUuid) {
    this.s.setContinues.run(messageUuid, sessionId);
  }

  /** This conversation goes on in another: a resume, named in the old file. */
  setContinuedIn(sessionId, nextSessionId) {
    this.s.setContinuedIn.run(nextSessionId, sessionId);
  }

  /**
   * Every part of one conversation, in order, when a compaction split it.
   *
   * Walks back to the first part and forward to the last, so any part answers
   * with the whole chain. A part whose transcript was purged simply breaks the
   * walk there: the chain is what can be shown, never a guess.
   *
   * @returns {Array<{id, title, firstAt, lastAt, messageCount}>} One entry when
   *   the conversation was never compacted.
   */
  chain(sessionId) {
    const seen = new Set([sessionId]);
    const before = [];
    for (let id = sessionId; ; ) {
      const parent = this.s.parentOf.get({ id });
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      before.unshift(parent.id);
      id = parent.id;
    }
    const after = [];
    for (let id = sessionId; ; ) {
      const child = this.s.childOf.get({ id });
      if (!child || seen.has(child.id)) break;
      seen.add(child.id);
      after.push(child.id);
      id = child.id;
    }
    return [...before, sessionId, ...after].map((id) => this.s.chainPart.get(id)).filter(Boolean);
  }

  /** Adapter-supplied incremental state for one storage key. */
  sourceState(key) {
    return this.s.getSource.get(key) || null;
  }

  saveSourceState(state) {
    this.s.setSource.run({
      session_id: null,
      cursor: null,
      indexed_at: new Date().toISOString(),
      ...state,
    });
  }

  /** Drop a session's messages so a rewritten source can be re-read from zero. */
  resetSession(sessionId, key) {
    this.s.deleteMessages.run(sessionId);
    // first_prompt is derived with COALESCE, so leaving it would keep labelling
    // a replaced conversation with a prompt it no longer contains.
    this.s.clearFirstPrompt.run(sessionId);
    // The file declared it; read again from the start, it will say it again —
    // or no longer, and then the link must not outlive it.
    this.s.setContinuedIn.run(null, sessionId);
    if (key) this.s.clearSource.run(key);
  }

  meta(key) {
    const row = this.s.getMeta.get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.s.setMeta.run(key, String(value));
  }

  // -- reading ---------------------------------------------------------------

  /**
   * The folders, with what each holds.
   *
   * @param {string[]} [hidden] Agents the person chose not to see. The filter
   *   belongs HERE, not in the renderer: `sessionCount` and `messageCount` are
   *   computed by this query, and a count taken over rows the screen does not
   *   show would contradict the screen. A folder left with nothing falls out
   *   on its own, through the HAVING it already had.
   */
  folders(hidden = []) {
    const hiding = hidingOn('s.agent_id', hidden);
    if (!hiding.where) return this.s.listFolders.all();
    return this.#dynamic(
      `folders:${hiding.params.length}`,
      `SELECT f.id, f.path, f.dir_name AS dirName, f.exists_on_disk AS existsOnDisk,
              f.path_exact AS pathExact,
              COUNT(s.id) AS sessionCount,
              COUNT(DISTINCT s.agent_id) AS agentCount,
              GROUP_CONCAT(DISTINCT s.agent_id) AS agentIds,
              COALESCE(SUM(s.message_count), 0) AS messageCount,
              MAX(s.last_at) AS lastAt
       FROM folders f
       LEFT JOIN sessions s ON s.folder_id = f.id AND ${LISTED}${hiding.where}
       GROUP BY f.id HAVING sessionCount > 0
       ORDER BY lastAt IS NULL, lastAt DESC, f.path`
    ).all(...hiding.params);
  }

  /** @param {string[]} [hidden] Agents the person chose not to see. */
  sessions(folderId, hidden = []) {
    const hiding = hidingOn('s.agent_id', hidden);
    const rows = hiding.where
      ? this.#dynamic(`sessions:${hiding.params.length}`, sessionsOfFolderSql(hiding.where)).all(
          folderId,
          folderId,
          folderId,
          folderId,
          ...hiding.params
        )
      : this.s.listSessions.all(folderId, folderId, folderId, folderId);
    return rows.map(withModels);
  }

  /**
   * A statement built for a shape this class cannot prepare once: the number of
   * hidden agents changes. Kept by shape, so a person toggling a chip does not
   * re-prepare the same SQL on every click.
   */
  #dynamic(key, sql) {
    let statement = this.#built.get(key);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.#built.set(key, statement);
    }
    return statement;
  }

  session(id) {
    return this.s.getSession.get(id) || null;
  }

  /**
   * What one conversation cost, in the sidebar's own fields — the header shows
   * the same line. Sums over nothing are null: an agent that measured nothing
   * did not spend nothing.
   */
  sessionTokens(sessionId) {
    return { ...this.s.tokenSums.get(sessionId), ...this.s.subagentSums.get(sessionId) };
  }

  messages(sessionId) {
    return this.s.getMessages
      .all(sessionId)
      .map(({ tok_input, tok_output, tok_cache_read, tok_cache_write, tok_reasoning, ...m }) => ({
        ...m,
        usage: usageFromRow({
          tok_input,
          tok_output,
          tok_cache_read,
          tok_cache_write,
          tok_reasoning,
        }),
        isMeta: Boolean(m.isMeta),
        isNotice: Boolean(m.isNotice),
        isSidechain: Boolean(m.isSidechain),
        parts: safeParse(m.parts, []),
        command: safeParse(m.command, null),
      }));
  }

  /**
   * @param {string[]} [hidden] Agents the person chose not to see: the footer
   *   must describe the sidebar, not the database.
   */
  stats(hidden = []) {
    const hiding = hidingOn('s.agent_id', hidden);
    if (hiding.where) {
      const list = hiding.params.map(() => '?').join(',');
      const row = this.#dynamic(
        `stats:${hiding.params.length}`,
        `SELECT (SELECT COUNT(DISTINCT s.agent_id) FROM sessions s
                   WHERE ${LISTED} AND s.agent_id NOT IN (${list})) AS agents,
                (SELECT COUNT(*) FROM folders WHERE EXISTS
                  (SELECT 1 FROM sessions s WHERE s.folder_id = folders.id
                     AND ${LISTED} AND s.agent_id NOT IN (${list}))) AS folders,
                (SELECT COUNT(*) FROM sessions s
                   WHERE ${LISTED} AND s.agent_id NOT IN (${list})) AS sessions,
                (SELECT COUNT(*) FROM messages m JOIN sessions s ON s.id = m.session_id
                   WHERE m.is_copy = 0 AND s.parent_id IS NULL
                     AND s.agent_id NOT IN (${list})) AS messages`
      ).get(...hiding.params, ...hiding.params, ...hiding.params, ...hiding.params);
      return row;
    }
    return this.#unfilteredStats();
  }

  #unfilteredStats() {
    return this.s.stats.get();
  }

  /**
   * Every message, with what the statistics need and nothing more — for
   * statistics.js, which applies the screen's own rules to them.
   *
   * The prose itself never leaves SQLite: only whether there is any. The parts
   * come out only when there is none, which is the one case the rules read
   * them; the command only on notices. Filtered like everything else the
   * sidebar describes: the hidden assistants, and a period.
   *
   * @param {{hidden?: string[], since?: string|null}} [opts]
   * @returns {IterableIterator<object>} Streamed, not a 49 000-row array.
   */
  statisticsRows({ hidden = [], since = null } = {}) {
    const hiding = hidingOn('s.agent_id', hidden);
    const sql = `
      SELECT m.session_id AS sessionId, s.agent_id AS agentId, f.path AS folderPath,
             m.role, m.model,
             (trim(m.text) <> '') AS hasText,
             (trim(COALESCE(m.thinking, '')) <> '') AS hasThinking,
             CASE WHEN trim(m.text) = '' THEN m.parts END AS parts,
             m.is_notice AS isNotice, m.is_sidechain AS isSidechain,
             CASE WHEN m.is_notice THEN m.command END AS command,
             ${MESSAGE_TIME_SQL} AS at,
             m.tok_input AS tokInput, m.tok_output AS tokOutput,
             m.tok_cache_read AS tokCacheRead, m.tok_cache_write AS tokCacheWrite,
             (s.parent_id IS NOT NULL) AS isSubagent
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      JOIN folders f ON f.id = s.folder_id
      WHERE m.is_copy = 0${hiding.where}${since != null ? ` AND ${MESSAGE_TIME_SQL} >= ?` : ''}`;
    const params = since != null ? [...hiding.params, since] : hiding.params;
    const statement = this.#dynamic(`statistics:${hiding.params.length}:${since != null}`, sql);
    return statement.iterate(...params);
  }

  /**
   * Full-text search over message prose.
   *
   * @param {string} input Raw user input from the search box.
   * @param {{folderId?: number|null, sessionId?: string|null, agentId?: string|null,
   *          since?: string|null, limit?: number}} [opts]
   *   since: an ISO instant (see period.js); only messages written from then on.
   * @returns {object[]} Ranked rows, best first, each with a sentinel-marked snippet.
   *   `ts` is the message's time as the date filter reads it, never empty.
   */
  search(input, opts = {}) {
    const {
      folderId = null,
      sessionId = null,
      agentId = null,
      since = null,
      limit = 100,
      hidden = [],
    } = opts;
    // Hiding an agent on the left while its hits keep arriving below would be
    // two answers to the same question.
    const hiddenIds = cleanIds(hidden);
    const hiddenKeys = hiddenIds.map((_, i) => `@hidden${i}`);
    const match = toMatchQuery(input);
    if (!match) return [];

    const sql = `
      SELECT m.id, m.session_id AS sessionId, m.role, ${MESSAGE_TIME_SQL} AS ts, m.seq,
             s.title, s.source, s.agent_id AS agentId,
             f.path AS folderPath, f.id AS folderId,
             snippet(messages_fts, 0, @open, @close, @ellipsis, 14) AS snippet,
             bm25(messages_fts) AS rank
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      JOIN sessions s ON s.id = m.session_id
      JOIN folders  f ON f.id = s.folder_id
      WHERE messages_fts MATCH @match
        AND m.text <> ''
        AND m.is_notice = 0
        AND m.is_copy = 0
        ${folderId != null ? 'AND f.id = @folderId' : ''}
        ${sessionId != null ? 'AND m.session_id = @sessionId' : ''}
        ${agentId != null ? 'AND s.agent_id = @agentId' : ''}
        ${hiddenKeys.length ? `AND s.agent_id NOT IN (${hiddenKeys.join(',')})` : ''}
        ${since != null ? `AND ${MESSAGE_TIME_SQL} >= @since` : ''}
      ORDER BY rank
      LIMIT @limit`;

    try {
      return this.db.prepare(sql).all({
        open: HL_OPEN,
        close: HL_CLOSE,
        ellipsis: ELLIPSIS,
        match,
        folderId,
        sessionId,
        agentId,
        since,
        limit,
        ...Object.fromEntries(hiddenIds.map((id, i) => [`hidden${i}`, id])),
      });
    } catch (error) {
      // A malformed MATCH should degrade to "no results", never crash the UI.
      if (/fts5|syntax error|malformed MATCH/i.test(error.message)) return [];
      throw error;
    }
  }

  /** One message's prose, by its row id; null when there is no such message. */
  messageText(messageId) {
    const row = this.s.messageText.get(messageId);
    return row ? row.text : null;
  }

  // -- the archive -----------------------------------------------------------

  /** Every session, briefly: enough to tell which vanished in a pass. */
  sessionsBrief() {
    return this.s.sessionsBrief.all();
  }

  /** What the archive keeps of a session; null if the index has no such session. */
  archiveRows(sessionId) {
    const session = this.s.archiveSession.get(sessionId);
    return session ? { session, messages: this.s.archiveMessages.all(sessionId) } : null;
  }

  /**
   * The session now lives only in the archive. Its source rows go too, so that
   * if its file ever comes back it is read again in full, not skipped as known.
   */
  markArchived(sessionId) {
    this.db.transaction(() => {
      this.s.markArchived.run(sessionId);
      this.s.clearSourcesOf.run(sessionId);
    })();
  }

  /** Put back a conversation that exists nowhere but in the archive. */
  restoreArchived(sessionId, session, messages, agentLabel) {
    this.db.transaction(() => {
      // A poorer copy may be there already: the prompts history.jsonl kept.
      this.resetSession(sessionId, null);
      // Its agent may be gone from this machine altogether; the row is only a label.
      this.s.insertAgentIfAbsent.run(session.agent_id, agentLabel || session.agent_id);
      const folderId = this.folderId(
        session.folder_path || '(inconnu)',
        null,
        true,
        session.folder_exact !== 0
      );
      this.upsertSession({
        id: sessionId,
        agent_id: session.agent_id,
        folder_id: folderId,
        title: session.title,
        slug: session.slug,
        git_branch: session.git_branch,
        first_prompt: session.first_prompt,
        source: 'archive',
        file_path: session.file_path,
        // Absent from archives written before subagents were read.
        parent_id: session.parent_id || null,
        continues_from: session.continues_from || null,
      });
      if (session.continued_in) this.s.setContinuedIn.run(session.continued_in, sessionId);
      for (const row of messages) {
        this.s.insertMessage.run({ ...ARCHIVED_MESSAGE_DEFAULTS, ...row, session_id: sessionId });
      }
      this.s.touchSession.run(sessionId);
    })();
  }

  /**
   * Forget a saved conversation, for good. It was likely forgotten because of
   * what it contained, so "deleted" is not enough: SQLite leaves deleted rows
   * readable in free pages, FTS keeps terms until its segments merge, and WAL
   * mode keeps old pages in the main file until a checkpoint. All three are
   * dealt with here, and a test reads the file's bytes afterwards to prove it.
   */
  /**
   * An empty index is about to be filled whole — the first pass, or the one
   * after a schema change. The full-text triggers are set aside and the index
   * built once at the end (resumeSearchIndex): 0.3 s, where keeping it row by
   * row cost 4 s of Claude's 17. The flag is written first, so a pass cut short
   * is caught up the next time the index is opened.
   */
  suspendSearchIndex() {
    this.setMeta(SEARCH_PENDING, '1');
    this.db.exec(
      'DROP TRIGGER IF EXISTS messages_ai; DROP TRIGGER IF EXISTS messages_ad; ' +
        'DROP TRIGGER IF EXISTS messages_au;'
    );
  }

  /** Build the full-text index from the rows, and let the triggers keep it again. */
  resumeSearchIndex() {
    this.db.transaction(() => {
      this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
      this.db.exec(SEARCH_TRIGGERS_SQL);
      this.setMeta(SEARCH_PENDING, '0');
    })();
  }

  /** Empty the journal into the database, and the journal file with it. */
  settle() {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  forgetSession(sessionId) {
    this.db.pragma('secure_delete = ON');
    try {
      this.db.transaction(() => {
        this.s.deleteMessages.run(sessionId); // the FTS entries go with them, by trigger
        this.s.clearSourcesOf.run(sessionId);
        this.s.dropSession.run(sessionId);
        // A limit's reading holds no words; only its link to the conversation goes.
        this.s.quotaForget.run(sessionId);
      })();
      this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES('optimize')");
    } finally {
      this.db.pragma('secure_delete = OFF');
    }
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    // What a later conversation had copied from this one is its own again.
    this.markCopies();
  }

  /**
   * Flag every message an earlier conversation of the same agent already holds,
   * and unflag those it no longer does. A resumed or forked session begins by
   * copying another's history — Claude Code after a resume (922 messages, same
   * uuid, same time), Codex on a fork (973) and in each of its old snapshots
   * (60 files repeating one reply). Left alone, the reader sees them twice,
   * search finds them twice and their tokens are counted twice.
   *
   * Only for agents whose message ids are unique across all their
   * conversations (`globalIds` in the contract): Copilot and Gemini number
   * their tool calls per session, and `bash_5` in two sessions is two calls.
   *
   * @param {{agents?: string[], since?: number|null}} [opts] `agents` defaults
   *   to the adapters that declare it. With `since` — a message id taken
   *   before a pass — only what the pass wrote is looked at (lastMessageId).
   * @returns {number} Messages whose flag changed.
   */
  markCopies({ agents = copyAgentIds(), since = null } = {}) {
    if (!agents.length) return 0;
    const changed = this.db.transaction(() => {
      const params = { agents: JSON.stringify(agents) };
      const rows =
        since == null
          ? this.s.markCopies.all(params)
          : this.s.markNewCopies.all({ ...params, since });
      for (const id of new Set(rows.map((r) => r.sessionId))) {
        this.s.clearFirstPrompt.run(id);
        this.s.touchSession.run(id);
      }
      return rows.length;
    })();
    return changed;
  }

  /** The newest message's id: what a pass wrote is everything above it. */
  lastMessageId() {
    return this.s.lastMessageId.get().id;
  }

  /**
   * How many of a conversation's messages are copies, and the conversation
   * holding most of them — so the reader can be sent there.
   *
   * @returns {{count: number, from: object|null}|null} null without copies.
   */
  /** The subagents a conversation launched, oldest first; [] for most. */
  subagents(sessionId) {
    return this.s.subagents.all(sessionId, sessionId);
  }

  copiedFrom(sessionId) {
    const { n } = this.s.countCopies.get(sessionId);
    if (!n) return null;
    const origin = this.s.copiedFrom.get(sessionId);
    return { count: n, from: origin ? this.session(origin.id) : null };
  }

  close() {
    this.db.close();
  }
}

/** Pages between two automatic checkpoints: 64 MB of 4 KB pages (see the constructor). */
const CHECKPOINT_PAGES = 16384;

/** Set while the full-text index waits to be rebuilt (suspendSearchIndex). */
const SEARCH_PENDING = 'searchIndexPending';

/** The usage-limit windows a rebuild carries over, until a pass puts them back. */
const QUOTA_CARRY = 'quotaWindowsCarried';

/** The three full-text triggers, as schema.sql states them — the one description. */
const SEARCH_TRIGGERS_SQL = SCHEMA_SQL.match(/CREATE TRIGGER IF NOT EXISTS[\s\S]*?END;/g).join(
  '\n'
);

/** The agents whose message ids mean the same message wherever they appear. */
function copyAgentIds() {
  // Required late: the registry loads every adapter, which the index itself
  // never needs.
  return require('./agents')
    .all()
    .filter((adapter) => adapter.globalIds)
    .map((adapter) => adapter.id);
}

function safeParse(value, fallback) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * The agent ids a caller asked to hide, kept only if they could be one: the
 * renderer is not trusted, and these end up in SQL.
 */
function cleanIds(hidden) {
  if (!Array.isArray(hidden)) return [];
  return [
    ...new Set(hidden.filter((id) => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id))),
  ];
}

/**
 * A folder's conversations, newest first, each with what its turns cost.
 *
 * The token sums are the four the contract defines, added across the
 * conversation's messages. SUM over nothing but NULLs is NULL, which is the
 * point: a conversation whose assistant recorded no usage comes back with
 * nulls, never with zeros (contract.js, "Absence is not zero"). Only the
 * folder's own messages are summed — measured at 52 ms for all 362
 * conversations at once, so one folder costs a fraction of that.
 *
 * With them, the models that answered and how many replies each gave — the
 * same replies the header counts: an assistant's, with prose. The sidebar
 * shows the one that answered most (format.js, sessionModels).
 *
 * And what its subagents cost, kept apart (`sub*`): they are opened from it and
 * never listed, and their transcripts do not always keep the final count.
 *
 * Takes the folder id FOUR times: for the sums, the models, the subagents and
 * the rows.
 */
function sessionsOfFolderSql(hidingWhere) {
  return `
    SELECT s.id, s.agent_id AS agentId, s.title, s.slug, s.git_branch AS gitBranch,
           s.first_prompt AS firstPrompt, s.message_count AS messageCount,
           s.first_at AS firstAt, s.last_at AS lastAt, s.source, s.file_path AS filePath,
           u.tokInput, u.tokOutput, u.tokCacheRead, u.tokCacheWrite, md.models,
           sa.subagents, sa.subInput, sa.subOutput, sa.subCacheRead, sa.subCacheWrite
    FROM sessions s
    LEFT JOIN (
      SELECT session_id,
             SUM(tok_input) AS tokInput, SUM(tok_output) AS tokOutput,
             SUM(tok_cache_read) AS tokCacheRead, SUM(tok_cache_write) AS tokCacheWrite
      FROM messages
      WHERE session_id IN (SELECT id FROM sessions WHERE folder_id = ?) AND is_copy = 0
      GROUP BY session_id
    ) u ON u.session_id = s.id
    LEFT JOIN (
      SELECT session_id, json_group_array(json_object('model', model, 'replies', n)) AS models
      FROM (
        SELECT session_id, model, COUNT(*) AS n
        FROM messages
        WHERE session_id IN (SELECT id FROM sessions WHERE folder_id = ?)
          AND role = 'assistant' AND model <> '' AND trim(text) <> '' AND is_copy = 0
        GROUP BY session_id, model
      )
      GROUP BY session_id
    ) md ON md.session_id = s.id
    -- What its subagents cost, apart: they are opened from it, never listed.
    -- By parent, not by folder — a subagent may have worked somewhere else.
    LEFT JOIN (
      SELECT sp.parent_id, COUNT(DISTINCT sp.id) AS subagents,
             SUM(m.tok_input) AS subInput, SUM(m.tok_output) AS subOutput,
             SUM(m.tok_cache_read) AS subCacheRead, SUM(m.tok_cache_write) AS subCacheWrite
      FROM sessions sp LEFT JOIN messages m ON m.session_id = sp.id AND m.is_copy = 0
      WHERE sp.parent_id IN (SELECT id FROM sessions WHERE folder_id = ?)
      GROUP BY sp.parent_id
    ) sa ON sa.parent_id = s.id
    WHERE s.folder_id = ? AND ${LISTED}${hidingWhere}
    ORDER BY s.last_at IS NULL, s.last_at DESC, s.id`;
}

/** A session row with its models decoded: SQLite hands them over as JSON text. */
function withModels(row) {
  let models = [];
  try {
    models = row.models ? JSON.parse(row.models) : [];
  } catch {
    models = [];
  }
  return { ...row, models: Array.isArray(models) ? models : [] };
}

/** `AND <column> NOT IN (?,?)`, or nothing at all when nothing is hidden. */
function hidingOn(column, hidden) {
  const params = cleanIds(hidden);
  if (!params.length) return { where: '', params };
  return { where: ` AND ${column} NOT IN (${params.map(() => '?').join(',')})`, params };
}

module.exports = { Index, SCHEMA_VERSION, HL_OPEN, HL_CLOSE };
