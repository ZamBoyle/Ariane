-- Schema for the conversation index.
--
-- Design notes:
--  * `folders.path` is the REAL path, taken from a message's `cwd` or from
--    sessions-index.json's `originalPath` - never decoded from the directory
--    name, which is a lossy encoding (see paths.decodeHint).
--  * Only `messages.text` is mirrored into FTS. Thinking, tool previews and
--    attachment metadata are stored for rendering but deliberately excluded
--    from search, which is what keeps the index ~1% of the raw transcripts.
--  * `folders` is deliberately SHARED across agents. The whole point of the app
--    is to show every conversation about a directory, whoever it was with, so
--    a folder row is keyed on the path alone and sessions from different agents
--    hang off the same row.
--  * `sources` drives incremental indexing through two opaque strings supplied
--    by the adapter: `fingerprint` (has it changed?) and `cursor` (where to
--    resume). Neither is ever parsed here - see agents/contract.js.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Shared by every agent: one row per real directory, whoever worked in it.
CREATE TABLE IF NOT EXISTS folders (
  id            INTEGER PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,
  dir_name      TEXT,
  exists_on_disk INTEGER NOT NULL DEFAULT 1,
  -- 0 when every session that led here gave an APPROXIMATE path (a decoded
  -- directory name, or none at all). One exact sighting settles it for good:
  -- the flag only ever climbs, never falls back to a guess.
  path_exact    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS agents (
  id      TEXT PRIMARY KEY,
  label   TEXT NOT NULL,
  root    TEXT,
  seen_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  -- "<agentId>:<sessionId>": ids are only unique within an agent.
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  folder_id     INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  title         TEXT,
  slug          TEXT,
  git_branch    TEXT,
  first_prompt  TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  first_at      TEXT,
  last_at       TEXT,
  -- 'transcript': full conversation on disk.
  -- 'history'   : transcript purged; only prompts survive in history.jsonl.
  source        TEXT NOT NULL DEFAULT 'transcript',
  file_path     TEXT,
  -- Claude Code compacts a conversation by opening a NEW transcript. The
  -- boundary record names the last message of the previous one, and that uuid
  -- is the only thread back to it (see indexer.#chain).
  continues_uuid TEXT
);

CREATE INDEX IF NOT EXISTS sessions_folder ON sessions(folder_id, last_at DESC);
CREATE INDEX IF NOT EXISTS sessions_last   ON sessions(last_at DESC);
CREATE INDEX IF NOT EXISTS sessions_agent  ON sessions(agent_id, last_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  uuid         TEXT,
  parent_uuid  TEXT,
  role         TEXT NOT NULL,
  ts           TEXT,
  model        TEXT,
  text         TEXT NOT NULL DEFAULT '',
  thinking     TEXT NOT NULL DEFAULT '',
  parts        TEXT NOT NULL DEFAULT '[]',
  is_meta      INTEGER NOT NULL DEFAULT 0,
  -- Harness-injected or tool-authored: shown as a notice, never as the user.
  is_notice    INTEGER NOT NULL DEFAULT 0,
  is_sidechain INTEGER NOT NULL DEFAULT 0,
  command      TEXT
);

CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS messages_uuid ON messages(session_id, uuid)
  WHERE uuid IS NOT NULL AND uuid <> '';
-- Looked up by uuid alone when stitching a compacted conversation back together.
CREATE INDEX IF NOT EXISTS messages_by_uuid ON messages(uuid) WHERE uuid <> '';
CREATE INDEX IF NOT EXISTS sessions_continues ON sessions(continues_uuid)
  WHERE continues_uuid IS NOT NULL;

-- External-content FTS: the index stores terms, the rows stay in `messages`.
-- remove_diacritics 2 makes "mathematiques" match "Mathématiques".
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='id',
  tokenize="unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TABLE IF NOT EXISTS sources (
  key         TEXT PRIMARY KEY,   -- adapter-supplied storage key
  agent_id    TEXT NOT NULL,
  session_id  TEXT,
  fingerprint TEXT NOT NULL,      -- opaque; equality-compared only
  cursor      TEXT,               -- opaque; handed back to the adapter
  indexed_at  TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
