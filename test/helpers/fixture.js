'use strict';

/**
 * Builds a throwaway Claude Code data directory on disk.
 *
 * This is the test double for everything the indexer reads. It is a real
 * directory rather than a mocked `fs`, so the tests exercise the actual code
 * path — streaming, byte offsets, JSON parsing and all. `paths.js` reads
 * CLAUDE_CONFIG_DIR, which is what makes the redirection possible.
 *
 *   const fx = createFixture();
 *   fx.project('-a-b', { originalPath: '/a/b' })
 *     .session('s1', [records.userText('salut'), records.assistantText('bonjour')]);
 *   new Indexer(index, { env: fx.env }).run();
 *   fx.cleanup();
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const registry = require('../../src/core/agents');

/**
 * An environment where EVERY agent root points somewhere that does not exist.
 *
 * Any test building its own context must start from this. Redirecting only the
 * agent under test leaves the others pointing at the developer's real home —
 * which is exactly how three tests briefly ran against 722 MB of real history.
 *
 * @param {Record<string,string>} [overrides]
 */
function isolatedEnv(overrides = {}) {
  const env = {};
  for (const key of registry.allEnvKeys()) env[key] = `/nonexistent/ariane-test/${key}`;
  return { ...env, ...overrides };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-fixture-'));
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });

  const api = {
    root,
    projectsDir,
    /**
     * Every agent root is redirected from the start, even for agents this
     * fixture has not populated. Leaving one unset would let a test fall back
     * to the developer's real home directory — which on the machine this was
     * written on holds 722 MB of genuine history.
     */
    env: isolatedEnv({
      CLAUDE_CONFIG_DIR: root,
      CODEX_HOME: path.join(root, 'codex-home'),
      COPILOT_HOME: path.join(root, 'copilot-home'),
      QWEN_CONFIG_DIR: path.join(root, 'qwen-home'),
      GEMINI_CONFIG_DIR: path.join(root, 'gemini-home'),
      ANTIGRAVITY_CLI_DIR: path.join(root, 'antigravity-home'),
      VSCODE_CONFIG_DIR: path.join(root, 'vscode-home'),
    }),

    /**
     * Create a project directory.
     * @param {string} dirName Encoded directory name, e.g. '-home-zam-demo'.
     * @param {{originalPath?: string}} [options] Writes sessions-index.json when given.
     */
    project(dirName, options = {}) {
      const dirPath = path.join(projectsDir, dirName);
      fs.mkdirSync(dirPath, { recursive: true });

      if (options.originalPath) {
        fs.writeFileSync(
          path.join(dirPath, 'sessions-index.json'),
          JSON.stringify({ version: 1, entries: [], originalPath: options.originalPath })
        );
      }

      const project = {
        dirPath,
        /** Write a transcript as `<sessionId>.jsonl`. */
        session(sessionId, records) {
          const file = path.join(dirPath, `${sessionId}.jsonl`);
          fs.writeFileSync(file, serialize(records, sessionId));
          return project;
        },
        /** Append records to an existing transcript, as a live session would. */
        append(sessionId, records) {
          const file = path.join(dirPath, `${sessionId}.jsonl`);
          fs.appendFileSync(file, serialize(records, sessionId));
          return project;
        },
        /** Write raw bytes, for malformed or truncated-input tests. */
        raw(sessionId, contents) {
          fs.writeFileSync(path.join(dirPath, `${sessionId}.jsonl`), contents);
          return project;
        },
        /** Replace a transcript with shorter content, simulating a rewrite. */
        rewrite(sessionId, records) {
          const file = path.join(dirPath, `${sessionId}.jsonl`);
          fs.writeFileSync(file, serialize(records, sessionId));
          bumpMtime(file);
          return project;
        },
        file(sessionId) {
          return path.join(dirPath, `${sessionId}.jsonl`);
        },
      };
      return project;
    },

    /**
     * Build a Codex-style tree under the same root, reachable through
     * CODEX_HOME. Its sessions live in dated directories, one JSONL per run.
     */
    codex() {
      const home = api.env.CODEX_HOME;
      const sessions = path.join(home, 'sessions', '2026', '06', '21');
      fs.mkdirSync(sessions, { recursive: true });

      const builder = {
        home,
        /** A current-generation rollout: session_meta header, then records. */
        session(uuid, records) {
          const file = path.join(sessions, `rollout-2026-06-21T17-42-10-${uuid}.jsonl`);
          fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
          return builder;
        },
        append(uuid, records) {
          const file = path.join(sessions, `rollout-2026-06-21T17-42-10-${uuid}.jsonl`);
          fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
          return builder;
        },
        /** A 2025-04 legacy rollout: one JSON document, and no cwd anywhere. */
        legacy(uuid, items, session = {}) {
          const file = path.join(home, 'sessions', `rollout-2025-04-17-${uuid}.json`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(
            file,
            JSON.stringify({
              session: { timestamp: '2025-04-17T10:00:00.000Z', id: uuid, instructions: '', ...session },
              items,
            })
          );
          return builder;
        },
        file(uuid) {
          return path.join(sessions, `rollout-2026-06-21T17-42-10-${uuid}.jsonl`);
        },
      };
      return builder;
    },

    /**
     * Build a Copilot CLI tree: one directory per session, each holding an
     * events.jsonl and a workspace.yaml. Six of the real directories have no
     * log at all, which `withoutLog` reproduces.
     */
    copilot() {
      const home = api.env.COPILOT_HOME;
      const state = path.join(home, 'session-state');
      fs.mkdirSync(state, { recursive: true });

      const writeWorkspace = (dir, fields) =>
        fs.writeFileSync(
          path.join(dir, 'workspace.yaml'),
          Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n'
        );

      const builder = {
        home,
        session(uuid, events, workspace = {}) {
          const dir = path.join(state, uuid);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, 'events.jsonl'),
            events.map((e) => JSON.stringify(e)).join('\n') + '\n'
          );
          writeWorkspace(dir, { id: uuid, ...workspace });
          return builder;
        },
        append(uuid, events) {
          fs.appendFileSync(
            path.join(state, uuid, 'events.jsonl'),
            events.map((e) => JSON.stringify(e)).join('\n') + '\n'
          );
          return builder;
        },
        /** A directory with workspace.yaml but no events.jsonl. */
        withoutLog(uuid, workspace = {}) {
          const dir = path.join(state, uuid);
          fs.mkdirSync(dir, { recursive: true });
          writeWorkspace(dir, { id: uuid, ...workspace });
          return builder;
        },
        dir(uuid) {
          return path.join(state, uuid);
        },
      };
      return builder;
    },

    /**
     * Build a Qwen tree. Same encoded-project convention as Claude Code, plus
     * an extra chats/ level that Claude does not have.
     */
    qwen() {
      const home = api.env.QWEN_CONFIG_DIR;
      const base = path.join(home, 'projects');
      fs.mkdirSync(base, { recursive: true });

      const builder = {
        home,
        session(dirName, uuid, records) {
          const dir = path.join(base, dirName, 'chats');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, `${uuid}.jsonl`),
            records.map((r) => JSON.stringify(r)).join('\n') + '\n'
          );
          return builder;
        },
        /** A project directory with no chats/ level at all. */
        empty(dirName) {
          fs.mkdirSync(path.join(base, dirName), { recursive: true });
          return builder;
        },
      };
      return builder;
    },

    /**
     * Build an Antigravity CLI tree.
     *
     *   brain/<id>/.system_generated/logs/transcript.jsonl   the readable log
     *   conversations/<id>.db                                the live store
     *   conversation_summaries.db                            an index, rarely current
     *
     * The two SQLite files are real: the folder attribution is read out of
     * them, and a stub would test nothing.
     */
    antigravity() {
      const Database = require('better-sqlite3');
      const home = api.env.ANTIGRAVITY_CLI_DIR;
      const brain = path.join(home, 'brain');
      fs.mkdirSync(brain, { recursive: true });

      const builder = {
        home,
        /** One conversation, as its log. */
        session(id, records) {
          const dir = path.join(brain, id, '.system_generated', 'logs');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(
            path.join(dir, 'transcript.jsonl'),
            records.map((r) => JSON.stringify(r)).join('\n') + '\n'
          );
          return builder;
        },
        /** A brain directory with no log at all. */
        empty(id) {
          fs.mkdirSync(path.join(brain, id, '.system_generated'), { recursive: true });
          return builder;
        },
        /**
         * The conversation's own store, holding the absolute paths its tool
         * calls mentioned — the raw material the folder is derived from.
         */
        store(id, absolutePaths = []) {
          const dir = path.join(home, 'conversations');
          fs.mkdirSync(dir, { recursive: true });
          const db = new Database(path.join(dir, `${id}.db`));
          db.exec('CREATE TABLE steps (idx INTEGER, step_payload BLOB)');
          let i = 0;
          for (const value of absolutePaths) {
            // Buried in a blob, as protobuf buries them.
            const blob = Buffer.concat([Buffer.from([0x0a, 0x12, 0x00]), Buffer.from(String(value), 'utf8')]);
            db.prepare('INSERT INTO steps (idx, step_payload) VALUES (?, ?)').run(i++, blob);
          }
          db.close();
          return builder;
        },
        /** The index `agy` keeps, when it happens to hold a row for a conversation. */
        summary(id, workspace) {
          const file = path.join(home, 'conversation_summaries.db');
          const db = new Database(file);
          db.exec('CREATE TABLE IF NOT EXISTS conversation_summaries (conversation_id TEXT, workspace_uris TEXT)');
          db.prepare('INSERT INTO conversation_summaries (conversation_id, workspace_uris) VALUES (?, ?)').run(
            id,
            JSON.stringify([`file://${encodeURI(workspace)}`])
          );
          db.close();
          return builder;
        },
      };
      return builder;
    },

    /**
     * Build a Gemini CLI tree. Transcripts live under tmp/<slug>/chats/, NOT
     * under history/<slug>/ which holds only a .project_root file.
     */
    gemini() {
      const home = api.env.GEMINI_CONFIG_DIR;
      fs.mkdirSync(path.join(home, 'tmp'), { recursive: true });

      const chats = (slug) => {
        const dir = path.join(home, 'tmp', slug, 'chats');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      };

      const builder = {
        home,
        /** projects.json maps DIRECTORY -> slug and must be inverted to be useful. */
        projects(map) {
          fs.writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ projects: map }));
          return builder;
        },
        projectRoot(slug, dir) {
          const slugDir = path.join(home, 'tmp', slug);
          fs.mkdirSync(slugDir, { recursive: true });
          fs.writeFileSync(path.join(slugDir, '.project_root'), dir + '\n');
          return builder;
        },
        /** The decoy: history/<slug>/ with nothing but a .project_root. */
        decoyHistory(slug, dir) {
          const d = path.join(home, 'history', slug);
          fs.mkdirSync(d, { recursive: true });
          fs.writeFileSync(path.join(d, '.project_root'), dir + '\n');
          return builder;
        },
        /** A mutation log: header, then $set replacements and bare turns. */
        log(slug, id, lines, header = {}) {
          const file = path.join(chats(slug), `session-2026-06-27T22-10-${id}.jsonl`);
          const head = { sessionId: id, projectHash: slug, startTime: '2026-06-27T22:10:00.000Z', kind: 'chat', ...header };
          fs.writeFileSync(file, [head, ...lines].map((l) => JSON.stringify(l)).join('\n') + '\n');
          return builder;
        },
        /** The legacy snapshot: one pretty JSON document with messages[]. */
        snapshot(slug, id, messages) {
          const file = path.join(chats(slug), `session-2026-04-21T10-00-${id}.json`);
          fs.writeFileSync(file, JSON.stringify({
            sessionId: id, projectHash: slug, startTime: '2026-04-21T10:00:00.000Z',
            lastUpdated: '2026-04-21T11:00:00.000Z', kind: 'chat', messages,
          }, null, 2));
          return builder;
        },
        /** A tmp/<slug> entry with no chats/ level at all. */
        bare(slug) {
          fs.mkdirSync(path.join(home, 'tmp', slug), { recursive: true });
          return builder;
        },
      };
      return builder;
    },

    /**
     * Build a VS Code tree: one directory per workspace, each with a
     * workspace.json and optionally chatSessions/ files and a legacy SQLite
     * blob. Both generations can coexist in the same workspace, as they do in
     * real installs.
     */
    vscode() {
      const home = api.env.VSCODE_CONFIG_DIR;
      const storage = path.join(home, 'User', 'workspaceStorage');
      fs.mkdirSync(storage, { recursive: true });

      const wsDir = (hash) => {
        const dir = path.join(storage, hash);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      };
      const chatsDir = (hash) => {
        const dir = path.join(wsDir(hash), 'chatSessions');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      };

      const builder = {
        home,
        /** A single-folder workspace: the path is a file:// URI, verbatim. */
        workspace(hash, folder) {
          fs.writeFileSync(
            path.join(wsDir(hash), 'workspace.json'),
            JSON.stringify({ folder: 'file://' + encodeURI(folder) })
          );
          return builder;
        },
        /** A multi-root workspace: points at a .code-workspace file instead. */
        multiRoot(hash, workspaceFile) {
          fs.writeFileSync(
            path.join(wsDir(hash), 'workspace.json'),
            JSON.stringify({ workspace: 'file://' + encodeURI(workspaceFile) })
          );
          return builder;
        },
        /** A full snapshot document. */
        snapshot(hash, sessionId, session) {
          fs.writeFileSync(
            path.join(chatsDir(hash), sessionId + '.json'),
            JSON.stringify({ sessionId, creationDate: 1756000000000, lastMessageDate: 1756000600000, ...session })
          );
          return builder;
        },
        /** A delta log: kind 0 snapshot, then kind 1 / kind 2 mutations. */
        deltaLog(hash, sessionId, lines) {
          fs.writeFileSync(
            path.join(chatsDir(hash), sessionId + '.jsonl'),
            lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
          );
          return builder;
        },
        /** Raw bytes, for oversize and corruption cases. */
        raw(hash, name, contents) {
          fs.writeFileSync(path.join(chatsDir(hash), name), contents);
          return builder;
        },
        /** The previous generation: one blob in the workspace SQLite store. */
        legacyStore(hash, sessions) {
          const Database = require('better-sqlite3');
          const db = new Database(path.join(wsDir(hash), 'state.vscdb'));
          db.exec('CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
          db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)')
            .run('interactive.sessions', Buffer.from(JSON.stringify(sessions), 'utf8'));
          db.close();
          return builder;
        },
        dir: wsDir,
      };
      return builder;
    },

    /** Write the global history.jsonl. */
    history(rows) {
      fs.writeFileSync(
        path.join(root, 'history.jsonl'),
        rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
      );
      return api;
    },

    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };

  return api;
}

function serialize(records, sessionId) {
  return records.map((r) => JSON.stringify({ sessionId, ...r })).join('\n') + '\n';
}

/** Force a distinct mtime so change detection cannot be fooled by a fast test. */
function bumpMtime(file) {
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(file, future, future);
}

/** Record builders for the OpenAI Codex CLI rollout format. */
const cdx = {
  /** The header that carries the working directory, verbatim. */
  meta(cwd, sessionId = 'sess-1') {
    return {
      timestamp: nextTimestamp(),
      type: 'session_meta',
      payload: { cwd, session_id: sessionId, timestamp: nextTimestamp() },
    };
  },

  /** A conversation turn, in the current envelope. */
  message(role, text, extra = {}) {
    const kind = role === 'user' ? 'input_text' : 'output_text';
    return {
      timestamp: nextTimestamp(),
      ordinal: counter(),
      type: 'response_item',
      payload: { type: 'message', id: `m-${counter()}`, role, content: [{ type: kind, text }], ...extra },
    };
  },

  /** The intermediate envelope: same shape, no `ordinal`. */
  messageNoOrdinal(role, text) {
    const r = cdx.message(role, text);
    delete r.ordinal;
    return r;
  },

  /** The oldest generation: the response item IS the top-level object. */
  bare(role, text) {
    return {
      type: 'message',
      id: `m-${counter()}`,
      role,
      content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
    };
  },

  /**
   * What a reply cost: the reply's own counts and the session's running total.
   * Codex repeats this event with the total unchanged; see codex.js.
   */
  tokenCount(total, last = total) {
    return {
      timestamp: nextTimestamp(),
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } },
    };
  },

  /** The mirror stream that duplicates every turn; must never be read. */
  eventMsg(text) {
    return {
      timestamp: nextTimestamp(),
      type: 'event_msg',
      payload: { type: 'AgentMessage', message: text },
    };
  },

  /** Context compaction, which replays earlier messages. */
  compacted(messages) {
    return { timestamp: nextTimestamp(), type: 'compacted', payload: { replacement_history: messages } };
  },

  toolCall(name, args) {
    return {
      timestamp: nextTimestamp(),
      type: 'response_item',
      payload: { type: 'function_call', id: 'c1', call_id: 'c1', name, arguments: JSON.stringify(args) },
    };
  },

  toolOutput(output) {
    return {
      timestamp: nextTimestamp(),
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'c1', output },
    };
  },

  image(bytes = 4000) {
    return {
      timestamp: nextTimestamp(),
      type: 'response_item',
      payload: {
        type: 'message', id: 'i1', role: 'user',
        content: [{ type: 'input_image', image_url: `data:image/png;base64,${'A'.repeat(bytes)}` }],
      },
    };
  },

  noise() {
    return { timestamp: nextTimestamp(), type: 'token_usage_record', payload: { input: 10 } };
  },
};

/** Event builders for the GitHub Copilot CLI log format. */
const cop = {
  /** The header carrying cwd, gitRoot and branch. */
  start(cwd, extra = {}) {
    return {
      type: 'session.start',
      id: `e-${counter()}`,
      timestamp: nextTimestamp(),
      data: {
        sessionId: extra.sessionId || 'sess-1',
        selectedModel: 'gpt-5',
        context: { cwd, gitRoot: cwd, branch: 'main', headCommit: 'abc123' },
      },
    };
  },

  user(content, extra = {}) {
    return {
      type: 'user.message',
      id: `e-${counter()}`,
      timestamp: nextTimestamp(),
      // transformedContent is a wrapped variant and must never be preferred.
      data: { content, transformedContent: `<preamble/>${content}`, ...extra },
    };
  },

  assistant(content, extra = {}) {
    return {
      type: 'assistant.message',
      id: `e-${counter()}`,
      timestamp: nextTimestamp(),
      data: { messageId: `m-${counter()}`, model: 'gpt-5', content, ...extra },
    };
  },

  /** 200 of 275 real assistant records look like this: no prose, tools only. */
  assistantToolsOnly(name, args) {
    return cop.assistant('', {
      toolRequests: [{ toolCallId: 't1', name, arguments: args, type: 'function' }],
    });
  },

  toolStart(name, args) {
    return {
      type: 'tool.execution_start',
      id: `e-${counter()}`,
      timestamp: nextTimestamp(),
      data: { toolCallId: 't1', name, arguments: args },
    };
  },

  toolDone(result, error = false) {
    return {
      type: 'tool.execution_complete',
      id: `e-${counter()}`,
      timestamp: nextTimestamp(),
      data: { toolCallId: 't1', result, status: error ? 'error' : 'ok' },
    };
  },

  /** The static system prompt: 10.5% of bytes, never conversation. */
  systemPrompt(text = 'x'.repeat(2000)) {
    return {
      type: 'system.message',
      id: `e-${counter()}`,
      timestamp: nextTimestamp(),
      data: { role: 'system', content: text },
    };
  },

  noise(type = 'assistant.turn_start') {
    return { type, id: `e-${counter()}`, timestamp: nextTimestamp(), data: {} };
  },

  /**
   * What the session has cost SO FAR, written at each exit — a running total,
   * never what the last run added. Shaped as the 19 real ones that carry counts.
   */
  shutdown({ input = 0, cacheRead = 0, cacheWrite = 0, output = 0, reasoning = 0 } = {}) {
    return {
      type: 'session.shutdown',
      id: `e-${counter()}`,
      timestamp: nextTimestamp(),
      data: {
        tokenDetails: {
          input: { tokenCount: input },
          cache_read: { tokenCount: cacheRead },
          cache_write: { tokenCount: cacheWrite },
          output: { tokenCount: output },
        },
        modelMetrics: {
          'gpt-5': {
            usage: {
              inputTokens: input + cacheRead + cacheWrite,
              outputTokens: output,
              cacheReadTokens: cacheRead,
              cacheWriteTokens: cacheWrite,
              reasoningTokens: reasoning,
            },
          },
        },
      },
    };
  },
};

/** Record builders for Qwen Code, whose message body is a Google GenAI Content. */
const qwn = {
  base(type, extra = {}) {
    return {
      uuid: `q-${counter()}`,
      parentUuid: null,
      sessionId: 'qsess-1',
      timestamp: nextTimestamp(),
      cwd: '/home/zam/repos/1541Ultimate',
      version: '0.1.0',
      gitBranch: 'main',
      type,
      ...extra,
    };
  },

  /** role is "user"; parts carry plain text. */
  user(text) {
    return qwn.base('user', { message: { role: 'user', parts: [{ text }] } });
  },

  /** role is "model", NOT "assistant". */
  model(text, extraParts = []) {
    return qwn.base('assistant', {
      model: 'qwen3-coder',
      message: { role: 'model', parts: [{ text }, ...extraParts] },
    });
  },

  /** Reasoning is a FLAG on a part, which may also carry text. */
  thought(text) {
    return { thought: true, text };
  },

  functionCall(name, args) {
    return { functionCall: { id: 'fc1', name, args } };
  },

  /** tool_result is a TOP-LEVEL record type here, unlike Claude. */
  toolResult(name, response) {
    return qwn.base('tool_result', {
      message: { role: 'user', parts: [{ functionResponse: { id: 'fc1', name, response } }] },
    });
  },

  inlineImage(bytes = 4000) {
    return { inlineData: { mimeType: 'image/png', data: 'A'.repeat(bytes) } };
  },

  /** The only record type present in the single real session on this machine. */
  system(subtype = 'slash_command') {
    return qwn.base('system', { subtype, systemPayload: { command: '/help' } });
  },
};

/** Message builders for the Gemini CLI, whose content shape depends on the role. */
/**
 * Antigravity CLI records. `source` is what says who spoke — the adapter never
 * has to guess it from the shape of the text.
 */
const agy = {
  base(source, type, extra = {}) {
    return {
      step_index: counter(),
      source,
      type,
      status: 'DONE',
      created_at: nextTimestamp(),
      content: '',
      truncated_fields: [],
      ...extra,
    };
  },

  /** The person, inside the envelope the harness wraps around every prompt. */
  user(text, { metadata = 'The current local time is: 2026-09-05T02:06:33+02:00.' } = {}) {
    const wrapped =
      `<USER_REQUEST>\n${text}\n</USER_REQUEST>` +
      (metadata ? `\n<ADDITIONAL_METADATA>\n${metadata}\n</ADDITIONAL_METADATA>` : '');
    return agy.base('USER_EXPLICIT', 'USER_INPUT', { content: wrapped });
  },

  /** The assistant's own words; 9 in 10 carry nothing but a thought, or nothing. */
  model(text, thinking = '') {
    return agy.base('MODEL', 'PLANNER_RESPONSE', { content: text, ...(thinking ? { thinking } : {}) });
  },

  /** What a tool printed: said by nobody. */
  tool(output) {
    return agy.base('MODEL', 'GENERIC', { content: output });
  },

  /** The harness talking about the session: a checkpoint, an error. */
  system(type, text) {
    return agy.base('SYSTEM', type, { content: text });
  },
};

const gem = {
  /** A user turn: content is an ARRAY of {text} parts. */
  user(text, extra = {}) {
    return {
      id: `g-${counter()}`,
      timestamp: nextTimestamp(),
      type: 'user',
      content: [{ text }],
      ...extra,
    };
  },

  /** A model turn: content is a PLAIN STRING, and the type is "gemini". */
  model(text, extra = {}) {
    return {
      id: `g-${counter()}`,
      timestamp: nextTimestamp(),
      type: 'gemini',
      model: 'gemini-2.5-pro',
      content: text,
      ...extra,
    };
  },

  /** $set REPLACES the accumulated array; it never merges or appends. */
  set(messages) {
    return { $set: { messages, lastUpdated: nextTimestamp() } };
  },

  touch() {
    return { $set: { lastUpdated: nextTimestamp() } };
  },
};

/** Builders for VS Code chat, where one `request` IS one exchange. */
const vsc = {
  /** No role field exists: message is the person, response[] is the model. */
  request(prompt, responseParts, extra = {}) {
    return {
      requestId: `r-${counter()}`,
      timestamp: 1756000000000 + counter() * 1000,
      message: { text: prompt, parts: [{ text: prompt }] },
      response: responseParts,
      modelId: 'gpt-4o',
      ...extra,
    };
  },

  /** 36 of 61 real requests store -1 here; only session dates are dependable. */
  requestWithoutTime(prompt, responseParts) {
    return vsc.request(prompt, responseParts, { timestamp: -1, responseTimestamp: -1 });
  },

  /** A bare markdown part arrives with no `kind` at all. */
  bareText(value) {
    return { value };
  },

  markdown(value) {
    return { kind: 'markdownContent', content: { value } };
  },

  thinking(value) {
    return { kind: 'thinking', value };
  },

  /** The single biggest consumer of bytes in a real response array. */
  toolCall(toolId, message) {
    return { kind: 'toolInvocationSerialized', toolCallId: 't1', toolId, invocationMessage: message };
  },

  noise(kind = 'inlineReference') {
    return { kind, value: 'x'.repeat(200) };
  },

  session(requests, extra = {}) {
    return { requests, creationDate: 1756000000000, lastMessageDate: 1756000600000, ...extra };
  },
};

/** Record builders matching the shapes Claude Code actually writes. */
const records = {
  userText(text, extra = {}) {
    return {
      type: 'user',
      uuid: `u-${counter()}`,
      timestamp: nextTimestamp(),
      cwd: '/home/zam/demo',
      gitBranch: 'main',
      message: { role: 'user', content: text },
      ...extra,
    };
  },

  assistantText(text, extra = {}) {
    return {
      type: 'assistant',
      uuid: `a-${counter()}`,
      timestamp: nextTimestamp(),
      cwd: '/home/zam/demo',
      gitBranch: 'main',
      message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }] },
      ...extra,
    };
  },

  assistantTool(name, input, extra = {}) {
    return {
      type: 'assistant',
      uuid: `a-${counter()}`,
      timestamp: nextTimestamp(),
      cwd: '/home/zam/demo',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name, input }],
      },
      ...extra,
    };
  },

  aiTitle(title) {
    return { type: 'ai-title', aiTitle: title };
  },

  slug(value) {
    return { type: 'system', slug: value };
  },

  /** Plumbing records that must be ignored. */
  noise() {
    return { type: 'queue-operation', operation: 'enqueue', timestamp: nextTimestamp() };
  },

  attachment(bytes = 4000) {
    return {
      type: 'user',
      uuid: `u-${counter()}`,
      timestamp: nextTimestamp(),
      cwd: '/home/zam/demo',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(bytes) } },
        ],
      },
    };
  },
};

let n = 0;
const counter = () => ++n;

let clock = Date.UTC(2026, 0, 1, 10, 0, 0);
function nextTimestamp() {
  clock += 60000;
  return new Date(clock).toISOString();
}

/** Reset the shared counters so tests stay deterministic in isolation. */
function resetCounters() {
  n = 0;
  clock = Date.UTC(2026, 0, 1, 10, 0, 0);
}

module.exports = {
  createFixture, isolatedEnv, records, cdx, cop, qwn, gem, vsc, agy, resetCounters,
};
