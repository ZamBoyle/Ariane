'use strict';

/**
 * Builds the command that reopens a conversation in its own CLI.
 *
 * Pure: it returns an ARGUMENT VECTOR and never a shell string. That is the
 * whole security posture of this file. Session ids and folder paths come from
 * agents' own files, so they are not ours to trust — a folder named
 * `; rm -rf ~` is a perfectly legal directory name, and building a command line
 * by concatenation would hand it to a shell. An argv array is passed to the
 * process untouched, so there is nothing to escape and nothing to get wrong.
 *
 * Verified against each CLI's own `--help` on 2026-09-18:
 *
 *   claude   claude --resume <id>
 *   codex    codex resume <SESSION_ID>
 *   copilot  copilot --resume=<id>
 *   qwen     qwen --resume <id>
 *   gemini   gemini --resume <index|latest>   -- an INDEX, not an id
 *   vscode   not exposed: `code chat` starts a new session, it cannot reopen one
 */

const path = require('path');

/** Session ids we will put on a command line. Anything else is refused. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * How each agent reopens a session.
 *
 * `byId` is the honest part: false means the CLI can resume, but not the
 * session the reader is looking at. Offering a button that opens *some other*
 * conversation would be worse than offering none.
 */
const AGENTS = {
  claude: { command: 'claude', args: (id) => ['--resume', id], byId: true },
  codex: { command: 'codex', args: (id) => ['resume', id], byId: true },
  'copilot-cli': { command: 'copilot', args: (id) => [`--resume=${id}`], byId: true },
  qwen: { command: 'qwen', args: (id) => ['--resume', id], byId: true },
  gemini: {
    command: 'gemini',
    args: () => ['--resume', 'latest'],
    byId: false,
    // A code, not a sentence: the renderer says it in the reader's language.
    note: 'latest-only',
  },
  // `agy --help`: « --conversation  Resume a previous conversation by ID ».
  antigravity: { command: 'agy', args: (id) => ['--conversation', id], byId: true },
  vscode: {
    byId: false,
    unsupported: true,
    note: 'unsupported',
  },
};

/**
 * @param {string} agentId
 * @param {string} sessionId  Namespaced (`claude:abc`) or bare.
 * @param {string} folderPath Where the CLI should start.
 * @returns {{ok: true, command: string, args: string[], cwd: string, display: string}
 *          | {ok: false, reason: string, note?: string}}
 */
function resumeCommand(agentId, sessionId, folderPath) {
  const agent = AGENTS[agentId];
  if (!agent) return { ok: false, reason: 'unknown-agent' };
  if (agent.unsupported) return { ok: false, reason: 'unsupported', note: agent.note };

  const id = bareId(sessionId);
  if (agent.byId && !SAFE_ID.test(id)) return { ok: false, reason: 'unsafe-session-id' };

  const cwd = typeof folderPath === 'string' ? folderPath.trim() : '';
  // Absolute by this system's rules: `C:\Users\…` is as good as `/home/…`.
  if (!cwd || !path.isAbsolute(cwd)) return { ok: false, reason: 'no-folder' };

  const args = agent.args(id);
  return {
    ok: true,
    command: agent.command,
    args,
    cwd,
    // For display and for the clipboard: quoted for a human to paste, never
    // used to launch anything.
    display: [agent.command, ...args].map(quoteForDisplay).join(' '),
    note: agent.note,
    exact: agent.byId,
  };
}

/** `claude:64ffbe9a-…` -> `64ffbe9a-…`. The agent prefix is ours, not the CLI's. */
function bareId(sessionId) {
  const value = typeof sessionId === 'string' ? sessionId : '';
  const colon = value.indexOf(':');
  return colon === -1 ? value : value.slice(colon + 1);
}

/** Single-quote for a shell, for text a person will read or paste. */
function quoteForDisplay(value) {
  return /^[A-Za-z0-9._:=/-]+$/.test(value) ? value : `'${value.split("'").join(`'\\''`)}'`;
}

/** Can this agent reopen the exact session the reader is looking at? */
function canResume(agentId) {
  const agent = AGENTS[agentId];
  return Boolean(agent && agent.byId);
}

module.exports = { resumeCommand, canResume, bareId, quoteForDisplay, AGENTS, SAFE_ID };
