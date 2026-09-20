'use strict';

/**
 * Opens a terminal running one command, in one directory.
 *
 * This is the only place Ariane starts a process, and it is deliberately narrow.
 * Everything else in the app is read-only, so the rules here are strict:
 *
 *  - `spawn` with an ARGUMENT VECTOR and `shell: false`. Never a command string.
 *    A folder may legitimately be called `; rm -rf ~`; passed as `cwd` it is
 *    inert, passed into a shell string it is not.
 *  - The terminal emulator comes from a fixed list. Nothing the user's data can
 *    influence chooses which binary runs.
 *  - The command itself comes from `core/resume.js`, which refuses any session
 *    id that is not plainly an id.
 *  - The child is detached and its streams ignored, so a terminal outliving the
 *    app does not keep a pipe open.
 *
 * When no terminal is found the caller is told, and the UI offers the command
 * to copy instead. Failing to open a window is an inconvenience; guessing at a
 * shell invocation would be a vulnerability.
 *
 * Everything that can be checked is checked BEFORE a window opens: the
 * command, and the interpreter a script names on its first line. A terminal
 * that opens and shuts in the same instant tells the person nothing; a
 * sentence saying what is missing, and where to state it (settings.js), does.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Terminals, in preference order, with how each takes a command.
 *
 * `x-terminal-emulator` is the Debian/Ubuntu alternative and comes first: it is
 * whatever the user actually chose.
 */
const LINUX_TERMINALS = [
  { bin: 'gnome-terminal', wrap: (argv, cwd) => [`--working-directory=${cwd}`, '--', ...argv] },
  { bin: 'konsole', wrap: (argv, cwd) => ['--workdir', cwd, '-e', ...argv] },
  { bin: 'xfce4-terminal', wrap: (argv, cwd) => [`--working-directory=${cwd}`, '-x', ...argv] },
  { bin: 'kitty', wrap: (argv, cwd) => ['--directory', cwd, ...argv] },
  { bin: 'alacritty', wrap: (argv, cwd) => ['--working-directory', cwd, '-e', ...argv] },
  { bin: 'wezterm', wrap: (argv, cwd) => ['start', '--cwd', cwd, '--', ...argv] },
  { bin: 'tilix', wrap: (argv, cwd) => ['-w', cwd, '-e', ...argv] },
  { bin: 'terminator', wrap: (argv, cwd) => ['--working-directory', cwd, '-x', ...argv] },
  { bin: 'foot', wrap: (argv, cwd) => ['--working-directory', cwd, ...argv] },
  // A wrapper around whichever terminal the user chose: its flags are unknown,
  // so it gets the directory the only way that always works.
  { bin: 'x-terminal-emulator', wrap: (argv) => ['-e', ...argv] },
  { bin: 'xterm', wrap: (argv) => ['-e', ...argv] },
];

/** The path module of the platform in question, so the pure helpers can be tested for all three. */
const pathFor = (platform) => (platform === 'win32' ? path.win32 : path.posix);

/**
 * What makes a file runnable on Windows: its extension, in the order Windows
 * itself tries them. There is no execute bit there — and npm installs each CLI
 * as `codex.cmd`, beside a `codex` shell script Windows cannot run. PATHEXT is
 * not read: it usually lists .js and .vbs too, which are not programs to hand
 * a terminal.
 */
const WINDOWS_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd'];

/** Directories searched after PATH. PATH is consulted, but not trusted blindly. */
function systemDirs(platform = process.platform) {
  return platform === 'win32' ? [] : ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'];
}

/**
 * Where per-user tooling installs its binaries.
 *
 * This matters more than it looks. An app started from the desktop menu does
 * NOT inherit the PATH of a login shell, so anything installed by a version
 * manager is invisible to it. On the machine this was written for, `claude`
 * lived in ~/.local/bin and worked, while `codex`, `copilot`, `qwen` and
 * `gemini` all lived under ~/.nvm/versions/node/<version>/bin and failed with
 * "Failed to execve: No such file or directory" — the terminal opened, then
 * died before showing anything.
 *
 * Resolving to an absolute path before spawning is the fix. Guessing at a login
 * shell to ask it for a PATH would mean invoking a shell, which this file
 * exists to avoid.
 *
 * The list is a guess, and always will be: settings.js lets the person state
 * what it misses.
 */
function userToolDirs(platform = process.platform, env = process.env) {
  const p = pathFor(platform);
  const home = os.homedir();
  const dirs = [p.join(home, '.local', 'bin'), p.join(home, 'bin')];
  const each = (base, inside) => {
    let entries;
    try {
      entries = fs.readdirSync(base);
    } catch {
      return;
    }
    // Newest first, by version and not by spelling: v22 comes before v9.
    entries.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const entry of entries) dirs.push(p.join(base, entry, ...inside));
  };

  if (platform === 'win32') {
    const appData = env.APPDATA || p.join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
    dirs.push(
      p.join(appData, 'npm'), // npm install -g
      p.join(localAppData, 'Volta', 'bin'),
      p.join(home, 'scoop', 'shims'),
      p.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs')
    );
    each(p.join(appData, 'nvm'), []); // nvm-windows: the tools sit beside node.exe
  } else {
    each(p.join(home, '.nvm', 'versions', 'node'), ['bin']);
    for (const fnm of [
      p.join(home, '.fnm', 'node-versions'),
      p.join(home, '.local', 'share', 'fnm', 'node-versions'),
      p.join(home, 'Library', 'Application Support', 'fnm', 'node-versions'), // macOS
    ]) {
      each(fnm, ['installation', 'bin']);
    }
    dirs.push(
      p.join(home, '.asdf', 'shims'),
      p.join(home, '.local', 'share', 'mise', 'shims'),
      p.join(home, '.npm-global', 'bin')
    );
  }
  dirs.push(
    p.join(home, '.volta', 'bin'),
    p.join(home, '.bun', 'bin'),
    p.join(home, '.deno', 'bin'),
    p.join(home, '.cargo', 'bin')
  );
  return dirs;
}

/**
 * The files a name may stand for: itself, or on Windows itself with each
 * runnable extension — `codex` is found as `codex.cmd`.
 */
function candidatesFor(file, platform = process.platform) {
  if (platform !== 'win32') return [file];
  if (WINDOWS_EXTENSIONS.includes(pathFor(platform).extname(file).toLowerCase())) return [file];
  return WINDOWS_EXTENSIONS.map((extension) => file + extension);
}

/** A file that can be run. A directory is executable too, in the X_OK sense: not here. */
function isExecutableFile(file, platform = process.platform) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (platform === 'win32') return WINDOWS_EXTENSIONS.includes(path.extname(file).toLowerCase());
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const firstExecutable = (file, platform) =>
  candidatesFor(file, platform).find((candidate) => isExecutableFile(candidate, platform)) || null;

function findExecutable(name, platform = process.platform) {
  // A path given by the caller is used as-is.
  if (name.includes('/') || name.includes(path.sep)) return firstExecutable(name, platform);

  const fromPath = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of [...fromPath, ...systemDirs(platform), ...userToolDirs(platform)]) {
    const found = firstExecutable(path.join(dir, name), platform);
    if (found) return found;
  }
  return null;
}

/**
 * A path as a person writes it in the settings, made usable: `~` for their
 * home everywhere, `%APPDATA%` and the like on Windows, separators normalised.
 */
function expandUserPath(value, platform = process.platform, env = process.env) {
  const p = pathFor(platform);
  let out = String(value).trim();
  if (out === '~' || out.startsWith('~/') || (platform === 'win32' && out.startsWith('~\\'))) {
    out = p.join(os.homedir(), out.slice(1));
  }
  if (platform === 'win32') {
    // Environment names are case-insensitive there; an unknown one stays as written.
    out = out.replace(/%([^%]+)%/g, (whole, name) => {
      const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
      return key ? env[key] : whole;
    });
  }
  return out ? p.normalize(out) : out;
}

/**
 * Which file runs for `name`: the one the person chose in the settings, or the
 * one detection finds. A choice is followed exactly — when it is wrong, the
 * person is told, rather than quietly handed whatever detection finds instead.
 *
 * @param {string} name     The CLI's command name, from core/resume.js.
 * @param {string|null} [chosen] The settings' `command`, if any.
 * @returns {{ok: true, executable: string, chosen: boolean}
 *          | {ok: false, reason: string, detail: string}}
 */
function resolveCommand(name, chosen = null) {
  if (chosen) {
    const file = expandUserPath(chosen);
    if (!path.isAbsolute(file)) return { ok: false, reason: 'setting-not-absolute', detail: chosen };
    const executable = firstExecutable(file, process.platform);
    if (!executable) return { ok: false, reason: 'setting-unusable', detail: file };
    return { ok: true, executable, chosen: true };
  }
  const found = findExecutable(name);
  return found
    ? { ok: true, executable: found, chosen: false }
    : { ok: false, reason: 'command-not-found', detail: name };
}

/**
 * The interpreter a script names on its first line: `{name}` when `env` is to
 * find it on PATH, `{path}` when the line gives it outright, null for a binary
 * or a file that cannot be read.
 */
function interpreterOf(file) {
  let head;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(256);
      head = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  if (!head.startsWith('#!')) return null;

  const words = head.slice(2).split('\n')[0].trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (path.basename(words[0]) !== 'env') return { path: words[0] };
  // `#!/usr/bin/env -S node --flag`: skip env's own options and VAR=value.
  const name = words.slice(1).find((word) => !word.startsWith('-') && !word.includes('='));
  return name ? { name } : null;
}

const onPath = (name, searchPath) =>
  searchPath.split(path.delimiter).filter(Boolean).some((dir) => isExecutableFile(path.join(dir, name)));

/**
 * The environment `executable` will run in — once its interpreter is known to
 * be reachable from it.
 *
 * The second real failure: `codex` found, but it begins `#!/usr/bin/env node`
 * and `node` is on no PATH a desktop session has. The tool's own directory
 * comes first (see environmentFor), which is where a version manager keeps the
 * runtime; failing that, the interpreter is searched for like any command, and
 * its directory follows.
 *
 * @returns {{ok: true, env: object} | {ok: false, reason: 'interpreter-not-found', detail: string}}
 */
function launchEnvironment(executable) {
  const env = environmentFor(executable);
  if (process.platform === 'win32') return { ok: true, env }; // no shebang lines there

  const interpreter = interpreterOf(executable);
  if (!interpreter) return { ok: true, env };
  if (interpreter.path) {
    return isExecutableFile(interpreter.path)
      ? { ok: true, env }
      : { ok: false, reason: 'interpreter-not-found', detail: interpreter.path };
  }
  if (onPath(interpreter.name, env.PATH)) return { ok: true, env };

  const found = findExecutable(interpreter.name);
  if (!found) return { ok: false, reason: 'interpreter-not-found', detail: interpreter.name };
  return { ok: true, env: environmentFor(executable, [path.dirname(found)]) };
}

/** The terminal this machine will use, or null. */
function findTerminal() {
  if (process.platform === 'darwin') {
    return { bin: '/usr/bin/open', wrap: (argv, cwd) => ['-a', 'Terminal', cwd || argv[0]] };
  }
  if (process.platform === 'win32') {
    const wt = findExecutable('wt.exe');
    if (wt) return { bin: wt, wrap: (argv) => ['-d', '.', ...argv] };
    return { bin: 'cmd.exe', wrap: (argv) => ['/c', 'start', '', ...argv] };
  }

  for (const terminal of LINUX_TERMINALS) {
    const bin = findExecutable(terminal.bin);
    if (bin) return { ...terminal, bin };
  }
  return null;
}

/**
 * The environment the command runs in, with its own directory on PATH.
 *
 * Resolving the binary is not enough when the binary is a SCRIPT. Four of the
 * five CLIs here begin with `#!/usr/bin/env node`, so launching them runs
 * `env`, which searches PATH for `node` — and a desktop session's PATH has no
 * nvm in it. The window opened and shut instantly on
 * "/usr/bin/env: 'node': No such file or directory", too fast to read.
 *
 * Putting the executable's own directory first fixes it, because a version
 * manager keeps the runtime beside the tools it installed. `claude` never hit
 * this: it is a self-contained ELF binary with no interpreter to find.
 */
function environmentFor(executable, extraDirs = [], platform = process.platform, base = process.env) {
  const p = pathFor(platform);
  const env = { ...base };
  // Windows spells it `Path`, and names are case-insensitive there: writing
  // `PATH` beside it would leave two, and which one wins is not ours to guess.
  const key =
    platform === 'win32' ? Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'Path' : 'PATH';
  const first = [...new Set([p.dirname(executable), ...extraDirs])];
  const parts = (env[key] || '').split(p.delimiter).filter(Boolean);
  // Moved to the FRONT, not merely included: a machine with two runtimes
  // installed would otherwise run the tool against whichever node came first.
  env[key] = [...first, ...parts.filter((part) => !first.includes(part))].join(p.delimiter);
  return env;
}

/**
 * Whether `name` — or the path the person chose for it — would run, without
 * running anything: what the settings window shows beside each assistant.
 * Never carries the environment: this goes to the renderer.
 *
 * @returns {{ok: true, executable: string, chosen: boolean}
 *          | {ok: false, reason: string, detail: string, executable?: string}}
 */
function checkCommand(name, chosen = null) {
  const resolved = resolveCommand(name, chosen);
  if (!resolved.ok) return resolved;
  const environment = launchEnvironment(resolved.executable);
  if (environment.ok) return resolved;
  return { ok: false, reason: environment.reason, detail: environment.detail, executable: resolved.executable };
}

/**
 * Launch the plan's command in a terminal, in the plan's directory.
 *
 * Checked in the order that tells the person the most: the folder, then what
 * would run, then its interpreter — and only then which terminal. Without a
 * terminal the UI copies the command for them to paste; that is still useful,
 * whereas a command that cannot run is not, whichever window it runs in.
 *
 * @param {{command: string, args: string[], cwd: string}} plan From core/resume.js.
 * @param {{command?: string|null, spawn?: Function, findTerminal?: Function}} [options]
 *   command: the path the person chose in the settings. spawn and findTerminal
 *   are for tests, which must never open a real window.
 * @returns {{ok: true, terminal: string, executable: string}
 *          | {ok: false, reason: string, detail?: string, executable?: string}}
 */
function openInTerminal(plan, options = {}) {
  const { command: chosen = null, spawn: launch = spawn, findTerminal: locate = findTerminal } = options;
  if (!plan || typeof plan.command !== 'string' || !Array.isArray(plan.args)) {
    return { ok: false, reason: 'invalid-plan' };
  }

  // The directory must exist: a CLI started in a deleted folder fails in a way
  // the user cannot see, since the terminal closes immediately.
  try {
    if (!fs.statSync(plan.cwd).isDirectory()) return { ok: false, reason: 'folder-missing' };
  } catch {
    return { ok: false, reason: 'folder-missing' };
  }

  // Resolve to an absolute path: the terminal is spawned without a shell and
  // does not inherit a login PATH, so a bare name installed by a version
  // manager would fail with "Failed to execve".
  const resolved = resolveCommand(plan.command, chosen);
  if (!resolved.ok) return resolved;

  const environment = launchEnvironment(resolved.executable);
  if (!environment.ok) return { ...environment, executable: resolved.executable };

  const terminal = locate();
  if (!terminal) return { ok: false, reason: 'no-terminal' };

  const argv = terminal.wrap([resolved.executable, ...plan.args], plan.cwd);

  try {
    const child = launch(terminal.bin, argv, {
      cwd: plan.cwd,
      env: environment.env,
      detached: true,
      stdio: 'ignore',
      shell: false, // the whole point: no shell, ever
    });
    // A failure to start arrives as an event; unheard, it would take the whole
    // main process down with it.
    child.on('error', () => {});
    child.unref();
    return { ok: true, terminal: path.basename(terminal.bin), executable: resolved.executable };
  } catch (error) {
    return { ok: false, reason: 'spawn-failed', detail: error.message };
  }
}

module.exports = {
  openInTerminal,
  findTerminal,
  findExecutable,
  resolveCommand,
  checkCommand,
  interpreterOf,
  launchEnvironment,
  environmentFor,
  expandUserPath,
  candidatesFor,
  userToolDirs,
  isExecutableFile,
  LINUX_TERMINALS,
};
