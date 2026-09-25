'use strict';

/**
 * Locates Claude Code's data directory across Windows, macOS and Linux.
 *
 * Claude Code stores everything under a single config directory, overridable
 * with CLAUDE_CONFIG_DIR. On every platform it defaults to `~/.claude` — it is
 * not an XDG/AppData-style layout, so there is no per-OS branching to do here.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

/** Directory holding `projects/`, `history.jsonl`, `settings.json`. */
function configDir(env = process.env, home = os.homedir()) {
  const override = env.CLAUDE_CONFIG_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(home, '.claude');
}

/**
 * Claude Code's global state file: `~/.claude.json`, BESIDE the directory, not
 * in it — or inside CLAUDE_CONFIG_DIR when that is set. Among much else, it
 * caches the last reading of the usage limits Claude Code fetched
 * (`cachedUsageUtilization`, quota.js). Read, never written.
 */
function globalStateFile(env = process.env, home = os.homedir()) {
  const override = env.CLAUDE_CONFIG_DIR;
  if (override && override.trim()) return path.join(path.resolve(override.trim()), '.claude.json');
  return path.join(home, '.claude.json');
}

/** Directory holding one sub-directory per project, each with session transcripts. */
function projectsDir(env, home) {
  return path.join(configDir(env, home), 'projects');
}

/** Global prompt log: one JSON object per prompt, carrying its originating folder. */
function historyFile(env, home) {
  return path.join(configDir(env, home), 'history.jsonl');
}

/**
 * Per-project session index written by Claude Code. Its `originalPath` field is
 * the only trustworthy source for a project's real path — see decodeHint().
 */
function sessionsIndexFile(projectDirPath) {
  return path.join(projectDirPath, 'sessions-index.json');
}

/**
 * Best-effort reconstruction of a real path from an encoded directory name.
 *
 * Claude Code encodes a project path by replacing every character outside
 * [A-Za-z0-9] with '-', which is LOSSY and NOT reversible:
 *
 *   /home/zam/Documents/Mathématiques  ->  -home-zam-Documents-Math-matiques
 *   .../Projects/Donkey-Pong-Claude    ->  ...-Projects-Donkey-Pong-Claude
 *
 * Accents are destroyed and legitimate hyphens become indistinguishable from
 * separators. This function therefore returns a *display hint only*. The real
 * path must always be read from `cwd` inside a transcript, or from
 * `originalPath` in sessions-index.json.
 *
 * @returns {string} A human-readable approximation, never a usable filesystem path.
 */
function decodeHint(encodedName) {
  if (typeof encodedName !== 'string' || encodedName === '') return '';
  const body = encodedName.startsWith('-') ? encodedName.slice(1) : encodedName;
  if (body === '') return path.sep;
  // Windows-style encodings begin with a drive letter, e.g. "C--Users-zam".
  const drive = /^([A-Za-z])--(.*)$/.exec(body);
  if (drive) return `${drive[1]}:\\${drive[2].split('-').join('\\')}`;
  return `/${body.split('-').join('/')}`;
}

/** True when the Claude Code data directory exists and is readable. */
function isAvailable(env, home) {
  try {
    return fs.statSync(projectsDir(env, home)).isDirectory();
  } catch {
    return false;
  }
}

/** Where this app keeps its own index database. */
function defaultDatabasePath(userDataDir) {
  return path.join(userDataDir, 'index.sqlite3');
}

module.exports = {
  configDir,
  projectsDir,
  historyFile,
  globalStateFile,
  sessionsIndexFile,
  decodeHint,
  isAvailable,
  defaultDatabasePath,
};
