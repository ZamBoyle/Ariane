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
const { withoutRepeatedUsage } = require('./archive');

/**
 * Bumped for a schema change OR a change in what the adapters extract.
 *
 * The index is derived data, and a file whose size and mtime are unchanged is
 * skipped outright — so new extraction rules would never reach the sessions
 * already stored. Raising this version drops the index and rebuilds it, which
 * takes about ten seconds.
 *
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
const SCHEMA_VERSION = 14;
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
const ARCHIVE_SESSION_SQL = `
  SELECT s.id, s.agent_id, s.title, s.slug, s.git_branch, s.first_prompt,
         s.first_at, s.last_at, s.source, s.file_path,
         f.path AS folder_path, f.path_exact AS folder_exact
  FROM sessions s JOIN folders f ON f.id = s.folder_id`;
const ARCHIVE_MESSAGE_COLUMNS = [
  'seq', 'uuid', 'parent_uuid', 'role', 'ts', 'model',
  'tok_input', 'tok_output', 'tok_cache_read', 'tok_cache_write', 'tok_reasoning',
  'text', 'thinking', 'parts', 'is_meta', 'is_notice', 'is_sidechain', 'command',
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
  const present = new Set(db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name));
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
    this.db.pragma('foreign_keys = ON');
    this.#migrate();
    this.db.exec(SCHEMA_SQL);
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    this.#prepare();
  }

  /**
   * The index is derived data, never a source of truth: everything in it can be
   * rebuilt from the agents' own files in a few seconds. So an older schema is
   * dropped rather than patched column by column, which keeps schema.sql the one
   * and only description of the shape.
   */
  #migrate() {
    const current = this.db.pragma('user_version', { simple: true });
    if (current === SCHEMA_VERSION || current === 0) return;

    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    if (tables.length === 0) return;

    // Rebuilt from the agents' files — except what they no longer have. That
    // goes to the archive BEFORE a single table is dropped.
    if (this.archive) this.#saveBeforeRebuild(current);

    this.db.exec('PRAGMA foreign_keys = OFF');
    for (const name of tables) this.db.exec(`DROP TABLE IF EXISTS "${name}"`);
    this.db.exec('PRAGMA foreign_keys = ON');
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
      for (const session of this.db.prepare(ARCHIVE_SESSION_SQL).all()) {
        const file = session.file_path ? session.file_path.split('#')[0] : '';
        const proven = session.source !== 'archive' && file && fs.existsSync(file);
        if (proven || this.archive.has(session.id)) continue;
        const rows = messagesOf.all(session.id);
        // An index built before 0.3.4 holds a Claude reply's usage on each of
        // its lines (archive.js, withoutRepeatedUsage). Saved as it is, the
        // inflated count would be kept in a format nothing migrates any more.
        const messages =
          fromVersion < 11 && session.agent_id === 'claude' ? withoutRepeatedUsage(rows) : rows;
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
        FROM agents a LEFT JOIN sessions s ON s.agent_id = a.id
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
                              message_count, first_at, last_at, source, file_path)
        VALUES (@id, @agent_id, @folder_id, @title, @slug, @git_branch, @first_prompt,
                @message_count, @first_at, @last_at, @source, @file_path)
        ON CONFLICT(id) DO UPDATE SET
          agent_id      = excluded.agent_id,
          folder_id     = excluded.folder_id,
          title         = COALESCE(excluded.title, sessions.title),
          slug          = COALESCE(excluded.slug, sessions.slug),
          git_branch    = COALESCE(excluded.git_branch, sessions.git_branch),
          first_prompt  = COALESCE(sessions.first_prompt, excluded.first_prompt),
          message_count = excluded.message_count,
          source        = excluded.source,
          file_path     = COALESCE(excluded.file_path, sessions.file_path)
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
          message_count = (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id),
          first_at = (SELECT MIN(ts) FROM messages WHERE session_id = sessions.id AND ts <> ''),
          last_at  = (SELECT MAX(ts) FROM messages WHERE session_id = sessions.id AND ts <> ''),
          first_prompt = COALESCE(first_prompt,
            (SELECT text FROM messages WHERE session_id = sessions.id
              AND role = 'user' AND text <> '' AND is_meta = 0 AND is_notice = 0
              ORDER BY seq LIMIT 1))
        WHERE id = ?
      `),
      countMessages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?'),
      hasText: db.prepare(
        'SELECT 1 FROM messages WHERE session_id = ? AND role = ? AND text = ? LIMIT 1'
      ),
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
      // The transcript this one continues: the session holding that message.
      parentOf: db.prepare(`
        SELECT m.session_id AS id FROM sessions s
        JOIN messages m ON m.uuid = s.continues_uuid
        WHERE s.id = ? AND m.session_id <> s.id LIMIT 1
      `),
      // And the one continuing it: whoever points at a message of this session.
      childOf: db.prepare(`
        SELECT s.id FROM sessions s
        JOIN messages m ON m.uuid = s.continues_uuid
        WHERE m.session_id = ? AND s.id <> ? LIMIT 1
      `),
      chainPart: db.prepare(`
        SELECT id, title, first_at AS firstAt, last_at AS lastAt, message_count AS messageCount
        FROM sessions WHERE id = ?
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
        FROM folders f LEFT JOIN sessions s ON s.folder_id = f.id
        GROUP BY f.id HAVING sessionCount > 0
        ORDER BY lastAt IS NULL, lastAt DESC, f.path
      `),
      listSessions: db.prepare(sessionsOfFolderSql('')),
      getSession: db.prepare(`
        SELECT s.id, s.agent_id AS agentId, s.title, s.slug, s.git_branch AS gitBranch,
               s.first_prompt AS firstPrompt,
               s.message_count AS messageCount, s.first_at AS firstAt, s.last_at AS lastAt,
               s.source, s.file_path AS filePath, f.path AS folderPath, f.id AS folderId
        FROM sessions s JOIN folders f ON f.id = s.folder_id WHERE s.id = ?
      `),
      getMessages: db.prepare(`
        SELECT id, seq, uuid, parent_uuid AS parentUuid, role, ts, model,
               tok_input, tok_output, tok_cache_read, tok_cache_write, tok_reasoning,
               text, thinking,
               parts, is_meta AS isMeta, is_notice AS isNotice,
               is_sidechain AS isSidechain, command
        FROM messages WHERE session_id = ? ORDER BY seq
      `),
      stats: db.prepare(`
        -- Counts what the reader is actually shown. A folder whose sessions
        -- were all dropped as empty still has a row, but it is not listed, so
        -- counting rows here would make the footer contradict the sidebar.
        SELECT (SELECT COUNT(*) FROM agents WHERE EXISTS
                 (SELECT 1 FROM sessions s WHERE s.agent_id = agents.id)) AS agents,
               (SELECT COUNT(*) FROM folders WHERE EXISTS
                 (SELECT 1 FROM sessions s WHERE s.folder_id = folders.id)) AS folders,
               (SELECT COUNT(*) FROM sessions) AS sessions,
               (SELECT COUNT(*) FROM messages) AS messages
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
    return Boolean(this.s.hasText.get(sessionId, role, text));
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
      const parent = this.s.parentOf.get(id);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      before.unshift(parent.id);
      id = parent.id;
    }
    const after = [];
    for (let id = sessionId; ; ) {
      const child = this.s.childOf.get(id, id);
      if (!child || seen.has(child.id)) break;
      seen.add(child.id);
      after.push(child.id);
      id = child.id;
    }
    return [...before, sessionId, ...after]
      .map((id) => this.s.chainPart.get(id))
      .filter(Boolean);
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
       FROM folders f LEFT JOIN sessions s ON s.folder_id = f.id${hiding.where}
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
          ...hiding.params
        )
      : this.s.listSessions.all(folderId, folderId, folderId);
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

  messages(sessionId) {
    return this.s.getMessages.all(sessionId).map(({ tok_input, tok_output, tok_cache_read,
                                                     tok_cache_write, tok_reasoning, ...m }) => ({
      ...m,
      usage: usageFromRow({ tok_input, tok_output, tok_cache_read, tok_cache_write, tok_reasoning }),
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
        `SELECT (SELECT COUNT(DISTINCT s.agent_id) FROM sessions s WHERE s.agent_id NOT IN (${list})) AS agents,
                (SELECT COUNT(*) FROM folders WHERE EXISTS
                  (SELECT 1 FROM sessions s WHERE s.folder_id = folders.id
                     AND s.agent_id NOT IN (${list}))) AS folders,
                (SELECT COUNT(*) FROM sessions s WHERE s.agent_id NOT IN (${list})) AS sessions,
                (SELECT COUNT(*) FROM messages m JOIN sessions s ON s.id = m.session_id
                   WHERE s.agent_id NOT IN (${list})) AS messages`
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
             m.tok_cache_read AS tokCacheRead, m.tok_cache_write AS tokCacheWrite
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      JOIN folders f ON f.id = s.folder_id
      WHERE 1 = 1${hiding.where}${since != null ? ` AND ${MESSAGE_TIME_SQL} >= ?` : ''}`;
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
    const { folderId = null, sessionId = null, agentId = null, since = null, limit = 100, hidden = [] } = opts;
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
      const folderId = this.folderId(session.folder_path || '(inconnu)', null, true, session.folder_exact !== 0);
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
      });
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
  forgetSession(sessionId) {
    this.db.pragma('secure_delete = ON');
    try {
      this.db.transaction(() => {
        this.s.deleteMessages.run(sessionId); // the FTS entries go with them, by trigger
        this.s.clearSourcesOf.run(sessionId);
        this.s.dropSession.run(sessionId);
      })();
      this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES('optimize')");
    } finally {
      this.db.pragma('secure_delete = OFF');
    }
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  close() {
    this.db.close();
  }
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
  return [...new Set(hidden.filter((id) => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id)))];
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
 * Takes the folder id THREE times: for the sums, for the models, for the rows.
 */
function sessionsOfFolderSql(hidingWhere) {
  return `
    SELECT s.id, s.agent_id AS agentId, s.title, s.slug, s.git_branch AS gitBranch,
           s.first_prompt AS firstPrompt, s.message_count AS messageCount,
           s.first_at AS firstAt, s.last_at AS lastAt, s.source, s.file_path AS filePath,
           u.tokInput, u.tokOutput, u.tokCacheRead, u.tokCacheWrite, md.models
    FROM sessions s
    LEFT JOIN (
      SELECT session_id,
             SUM(tok_input) AS tokInput, SUM(tok_output) AS tokOutput,
             SUM(tok_cache_read) AS tokCacheRead, SUM(tok_cache_write) AS tokCacheWrite
      FROM messages
      WHERE session_id IN (SELECT id FROM sessions WHERE folder_id = ?)
      GROUP BY session_id
    ) u ON u.session_id = s.id
    LEFT JOIN (
      SELECT session_id, json_group_array(json_object('model', model, 'replies', n)) AS models
      FROM (
        SELECT session_id, model, COUNT(*) AS n
        FROM messages
        WHERE session_id IN (SELECT id FROM sessions WHERE folder_id = ?)
          AND role = 'assistant' AND model <> '' AND trim(text) <> ''
        GROUP BY session_id, model
      )
      GROUP BY session_id
    ) md ON md.session_id = s.id
    WHERE s.folder_id = ?${hidingWhere}
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
