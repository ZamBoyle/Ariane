'use strict';

/**
 * Tests for the one place Ariane starts a process.
 *
 * Two real failures shaped this file. An app launched from the desktop menu does
 * not inherit a login shell's PATH, so `codex` — installed by nvm under
 * ~/.nvm/versions/node/<version>/bin — could not be found and the terminal died
 * with "Failed to execve" before showing anything, while `claude` in
 * ~/.local/bin worked. And the working directory was left to inheritance rather
 * than stated, so a conversation could reopen anywhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findExecutable, LINUX_TERMINALS } = require('../src/main/terminal');

test.describe('finding a command', () => {
  test('resolves something on PATH to an absolute path', () => {
    const found = findExecutable('sh');
    assert.ok(found && path.isAbsolute(found), String(found));
    assert.doesNotThrow(() => fs.accessSync(found, fs.constants.X_OK));
  });

  test('accepts an absolute path that is executable', () => {
    assert.equal(findExecutable('/bin/sh'), '/bin/sh');
  });

  test('refuses an absolute path that is not', () => {
    assert.equal(findExecutable('/definitely/not/here'), null);
  });

  test('returns null rather than a bare name that would fail to execve', () => {
    assert.equal(findExecutable('commande-qui-nexiste-pas-xyz'), null);
  });

  // The actual bug: the binary exists, but only in a per-user directory that a
  // desktop session never has on its PATH.
  test('finds a command installed outside PATH, under a version manager', (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-home-'));
    const bin = path.join(home, '.nvm', 'versions', 'node', 'v22.12.0', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const tool = path.join(bin, 'outil-factice');
    fs.writeFileSync(tool, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(tool, 0o755);

    const realHome = os.homedir;
    os.homedir = () => home;
    t.after(() => {
      os.homedir = realHome;
      fs.rmSync(home, { recursive: true, force: true });
    });

    assert.equal(findExecutable('outil-factice'), tool);
  });
});

test.describe('the terminal command line', () => {
  const CWD = '/home/zam/repos/claudechatbrowser';
  const ARGV = ['/usr/bin/claude', '--resume', 'abc'];

  test('every terminal that can be told the directory is told it', () => {
    // The two exceptions are documented: x-terminal-emulator is a wrapper whose
    // flags are unknown, and xterm has none. Both rely on the spawn's cwd.
    const byInheritance = new Set(['x-terminal-emulator', 'xterm']);

    for (const terminal of LINUX_TERMINALS) {
      const argv = terminal.wrap(ARGV, CWD);
      if (byInheritance.has(terminal.bin)) continue;
      assert.ok(
        argv.some((a) => a === CWD || a.endsWith(`=${CWD}`)),
        `${terminal.bin} does not carry the working directory: ${argv.join(' ')}`
      );
    }
  });

  test('the command and its arguments stay separate words', () => {
    for (const terminal of LINUX_TERMINALS) {
      const argv = terminal.wrap(ARGV, CWD);
      assert.ok(argv.includes('/usr/bin/claude'), terminal.bin);
      assert.ok(argv.includes('--resume'), terminal.bin);
      assert.ok(argv.includes('abc'), terminal.bin);
      // Nothing is ever glued into one string for a shell to split.
      assert.ok(
        !argv.some((a) => a.includes('claude --resume')),
        `${terminal.bin} built a command string`
      );
    }
  });

  test('an awkward directory name stays one argument', () => {
    const awkward = "/home/zam/mon projet; rm -rf ~";
    for (const terminal of LINUX_TERMINALS) {
      for (const arg of terminal.wrap(ARGV, awkward)) {
        if (!arg.includes('rm -rf')) continue;
        assert.ok(
          arg === awkward || arg.endsWith(`=${awkward}`),
          `${terminal.bin} split or embedded the directory: ${arg}`
        );
      }
    }
  });
});


/**
 * Four of the five CLIs are scripts beginning `#!/usr/bin/env node`, so running
 * one runs `env`, which searches PATH for `node`. A desktop session has no nvm
 * on its PATH, and the window opened and shut instantly on
 * "/usr/bin/env: 'node': No such file or directory" - too fast to read.
 * `claude` never hit this: it is a self-contained ELF binary.
 */
test.describe('the environment the command runs in', () => {
  const { environmentFor } = require('../src/main/terminal');
  const NVM = '/home/zam/.nvm/versions/node/v22.12.0/bin';

  // The platform and the base environment are handed over, which is what those
  // two arguments exist for: these are POSIX rules and must be checkable from
  // anywhere. Read from the real environment instead, the three below crashed
  // on Windows rather than failed — the variable is spelled `Path` there, so
  // `env.PATH` is undefined and `undefined.split()` throws.
  const SEP = path.posix.delimiter;
  const BASE = { PATH: `/usr/bin${SEP}/bin`, HOME: '/home/zam' };
  const posix = (executable, base = BASE) => environmentFor(executable, [], 'linux', base);

  test('puts the executable own directory first', () => {
    const env = posix(`${NVM}/qwen`);
    assert.equal(
      env.PATH.split(SEP)[0],
      NVM,
      'so `env node` finds the runtime installed beside the tool'
    );
  });

  test('moves it to the front even when it is already present', () => {
    const other = '/home/zam/.nvm/versions/node/v20/bin';
    const env = posix(`${other}/qwen`, { PATH: `/usr/bin${SEP}${other}`, HOME: '/home/zam' });
    const parts = env.PATH.split(SEP);
    assert.equal(parts[0], other);
    assert.equal(parts.filter((part) => part === other).length, 1, 'listed once, not twice');
  });

  test('keeps the rest of the environment intact', () => {
    const env = posix('/usr/bin/claude');
    assert.equal(env.HOME, BASE.HOME);
    assert.ok(env.PATH.includes('/usr/bin'));
  });
});

// ── Point 7: the person states where a CLI lives, and nothing opens blind ──

const {
  resolveCommand,
  interpreterOf,
  launchEnvironment,
  openInTerminal,
  expandUserPath,
  candidatesFor,
  userToolDirs,
  isExecutableFile,
  environmentFor,
} = require('../src/main/terminal');

/** A throwaway directory, removed after the test. */
function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-term-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Write a file, executable unless told otherwise. */
function tool(dir, name, content = '#!/bin/sh\nexit 0\n', mode = 0o755) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.chmodSync(file, mode);
  return file;
}

/** Point os.homedir() at a fake home for one test. */
function fakeHome(t) {
  const home = scratch(t);
  const real = os.homedir;
  os.homedir = () => home;
  t.after(() => {
    os.homedir = real;
  });
  return home;
}

const POSIX_ONLY = { skip: process.platform === 'win32' && 'execute bits and shebang lines are POSIX' };

test.describe('the command the person chose', POSIX_ONLY, () => {
  test('is used as stated, even where detection would find another', (t) => {
    const chosen = tool(scratch(t), 'sh');
    assert.deepEqual(resolveCommand('sh', chosen), { ok: true, executable: chosen, chosen: true });
    assert.equal(resolveCommand('sh').chosen, false, 'without a choice, detection');
  });

  test('may start from the home directory', (t) => {
    const home = fakeHome(t);
    const file = tool(home, 'outils/codex');
    assert.equal(resolveCommand('codex', '~/outils/codex').executable, file);
  });

  // A wrong choice is reported, never replaced behind the person's back.
  test('when it cannot be run, says so instead of falling back to detection', (t) => {
    const dir = scratch(t);
    const plain = tool(dir, 'pas-executable', 'texte', 0o644);
    assert.deepEqual(resolveCommand('sh', plain), { ok: false, reason: 'setting-unusable', detail: plain });
    assert.equal(resolveCommand('sh', dir).reason, 'setting-unusable', 'a directory is not a program');
    assert.equal(resolveCommand('sh', path.join(dir, 'absent')).reason, 'setting-unusable');
    assert.deepEqual(resolveCommand('sh', 'bin/codex'), {
      ok: false, reason: 'setting-not-absolute', detail: 'bin/codex',
    });
  });

  test('detection that finds nothing names what it looked for', () => {
    assert.deepEqual(resolveCommand('commande-introuvable-xyz'), {
      ok: false, reason: 'command-not-found', detail: 'commande-introuvable-xyz',
    });
  });

  test('a directory named like the command is not the command', (t) => {
    const dir = scratch(t);
    fs.mkdirSync(path.join(dir, 'outil'));
    assert.equal(isExecutableFile(path.join(dir, 'outil')), false);
  });
});

test.describe('where version managers keep their tools', POSIX_ONLY, () => {
  test('the newest runtime first, by version and not by spelling', (t) => {
    const home = fakeHome(t);
    for (const v of ['v9.11.2', 'v22.12.0', 'v18.20.4']) fs.mkdirSync(path.join(home, '.nvm/versions/node', v, 'bin'), { recursive: true });
    const nvm = userToolDirs('linux').filter((d) => d.includes('.nvm'));
    assert.deepEqual(nvm.map((d) => d.split(path.sep).at(-2)), ['v22.12.0', 'v18.20.4', 'v9.11.2']);
  });

  test('fnm where macOS keeps it', (t) => {
    const home = fakeHome(t);
    fs.mkdirSync(path.join(home, 'Library/Application Support/fnm/node-versions/v22.12.0'), { recursive: true });
    assert.ok(userToolDirs('darwin').some((d) => d.endsWith(path.join('v22.12.0', 'installation', 'bin'))));
  });
});

/**
 * Windows has no execute bit and no shebang: a program is known by its
 * extension, npm installs every CLI as a .cmd, and the variable is spelled
 * `Path`. These rules are pure, so they are checked here, on any system.
 */
test.describe('Windows rules, checked from any system', () => {
  test('a bare name stands for each runnable extension, in Windows’ order', () => {
    assert.deepEqual(candidatesFor('C:/npm/codex', 'win32'), [
      'C:/npm/codex.com', 'C:/npm/codex.exe', 'C:/npm/codex.bat', 'C:/npm/codex.cmd',
    ]);
    assert.deepEqual(candidatesFor('C:/npm/codex.CMD', 'win32'), ['C:/npm/codex.CMD']);
    assert.deepEqual(candidatesFor('/usr/bin/codex', 'linux'), ['/usr/bin/codex']);
  });

  test('npm’s codex.cmd is found; the shell script beside it is not a program there', (t) => {
    const dir = scratch(t);
    tool(dir, 'codex', '#!/bin/sh\n', 0o644);
    tool(dir, 'codex.cmd', '@node codex.js %*\r\n', 0o644);
    assert.equal(isExecutableFile(path.join(dir, 'codex'), 'win32'), false);
    assert.equal(isExecutableFile(path.join(dir, 'codex.cmd'), 'win32'), true, 'no execute bit needed');
  });

  test('%APPDATA% and friends are expanded, whatever their case', () => {
    const env = { AppData: 'C:\\Users\\ada\\AppData\\Roaming' };
    assert.equal(
      expandUserPath('%APPDATA%/npm/codex.cmd', 'win32', env),
      'C:\\Users\\ada\\AppData\\Roaming\\npm\\codex.cmd'
    );
    assert.equal(expandUserPath('%INCONNUE%\\x.exe', 'win32', env), '%INCONNUE%\\x.exe', 'left as written');
    assert.equal(expandUserPath('%APPDATA%/x', 'linux', env), '%APPDATA%/x', 'only on Windows');
  });

  test('the search path keeps its Windows spelling, and only one copy of it', () => {
    const env = environmentFor('C:\\npm\\codex.cmd', [], 'win32', { Path: 'C:\\Windows;C:\\npm', OS: 'Windows_NT' });
    assert.deepEqual(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH'), ['Path']);
    assert.equal(env.Path, 'C:\\npm;C:\\Windows');
    assert.equal(env.OS, 'Windows_NT');
  });

  test('npm, scoop and Volta are searched where Windows keeps them', () => {
    const dirs = userToolDirs('win32', {
      APPDATA: 'C:\\Users\\ada\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local',
    });
    assert.ok(dirs.includes('C:\\Users\\ada\\AppData\\Roaming\\npm'));
    assert.ok(dirs.includes('C:\\Users\\ada\\AppData\\Local\\Volta\\bin'));
    assert.ok(dirs.some((d) => d.endsWith('scoop\\shims')));
  });
});

/**
 * The second real failure: `codex` found, but it begins `#!/usr/bin/env node`
 * and no PATH the desktop has contains node. Checked before any window opens.
 */
test.describe('the interpreter a script names', POSIX_ONLY, () => {
  test('is read from the first line, whatever env is told first', (t) => {
    const dir = scratch(t);
    assert.deepEqual(interpreterOf(tool(dir, 'a', '#!/usr/bin/env node\n')), { name: 'node' });
    assert.deepEqual(interpreterOf(tool(dir, 'b', '#!/usr/bin/env -S node --no-warnings\n')), { name: 'node' });
    assert.deepEqual(interpreterOf(tool(dir, 'c', '#!/usr/bin/env NODE_ENV=prod node\r\n')), { name: 'node' });
    assert.deepEqual(interpreterOf(tool(dir, 'd', '#!/bin/sh\n')), { path: '/bin/sh' });
    assert.equal(interpreterOf(tool(dir, 'e', '\u007fELF\u0002\u0001')), null, 'a binary has none');
  });

  test('missing everywhere: named, and nothing opens', (t) => {
    const script = tool(scratch(t), 'outil', '#!/usr/bin/env interpreteur-introuvable-xyz\n');
    assert.deepEqual(launchEnvironment(script), {
      ok: false, reason: 'interpreter-not-found', detail: 'interpreteur-introuvable-xyz',
    });
    const absolute = tool(scratch(t), 'outil', '#!/nulle/part/interp\n');
    assert.equal(launchEnvironment(absolute).detail, '/nulle/part/interp');
  });

  test('beside the tool, as a version manager installs it: found on the way', (t) => {
    const bin = scratch(t);
    tool(bin, 'faux-node');
    const script = tool(bin, 'outil', '#!/usr/bin/env faux-node\n');
    const env = launchEnvironment(script);
    assert.equal(env.ok, true);
    assert.equal(env.env.PATH.split(path.delimiter)[0], bin);
  });

  test('elsewhere under a version manager: found, and put on the path', (t) => {
    const home = fakeHome(t);
    const runtime = path.join(home, '.nvm/versions/node/v22.12.0/bin');
    tool(runtime, 'faux-node-2');
    const script = tool(scratch(t), 'outil', '#!/usr/bin/env faux-node-2\n');
    const env = launchEnvironment(script);
    assert.equal(env.ok, true);
    assert.deepEqual(env.env.PATH.split(path.delimiter).slice(0, 2), [path.dirname(script), runtime]);
  });
});

test.describe('opening the terminal', POSIX_ONLY, () => {
  /** Never a real window: the spawn and the terminal are stand-ins. */
  function harness() {
    const calls = [];
    const listeners = [];
    const spawnStub = (bin, argv, options) => {
      calls.push({ bin, argv, options });
      return { on: (event) => listeners.push(event), unref() {} };
    };
    const terminal = { bin: '/usr/bin/faux-terminal', wrap: (argv, cwd) => ['--dir', cwd, '--', ...argv] };
    return { calls, listeners, spawn: spawnStub, findTerminal: () => terminal };
  }

  test('runs the resolved command, in its folder, without a shell', (t) => {
    const cwd = scratch(t);
    const h = harness();
    const result = openInTerminal({ command: 'sh', args: ['--resume', 'abc'], cwd }, h);

    assert.equal(result.ok, true);
    assert.equal(result.terminal, 'faux-terminal');
    const [{ bin, argv, options }] = h.calls;
    assert.equal(bin, '/usr/bin/faux-terminal');
    assert.deepEqual(argv, ['--dir', cwd, '--', result.executable, '--resume', 'abc']);
    assert.ok(path.isAbsolute(result.executable));
    assert.equal(options.shell, false);
    assert.equal(options.cwd, cwd);
    assert.equal(options.detached, true);
    assert.equal(options.env.PATH.split(path.delimiter)[0], path.dirname(result.executable));
    assert.ok(h.listeners.includes('error'), 'a failure to start must not take the app down');
  });

  test('runs the command the person chose', (t) => {
    const chosen = tool(scratch(t), 'mon-codex');
    const h = harness();
    const result = openInTerminal({ command: 'codex', args: [], cwd: scratch(t) }, { ...h, command: chosen });
    assert.equal(result.executable, chosen);
    assert.ok(h.calls[0].argv.includes(chosen));
  });

  test('opens nothing when something is known to be missing', (t) => {
    const cwd = scratch(t);
    const missingInterpreter = tool(scratch(t), 'outil', '#!/usr/bin/env interpreteur-introuvable-xyz\n');
    const cases = [
      [{ command: 'sh', args: [], cwd: path.join(cwd, 'effacé') }, {}, 'folder-missing'],
      [{ command: 'commande-introuvable-xyz', args: [], cwd }, {}, 'command-not-found'],
      [{ command: 'codex', args: [], cwd }, { command: path.join(cwd, 'absent') }, 'setting-unusable'],
      [{ command: 'outil', args: [], cwd }, { command: missingInterpreter }, 'interpreter-not-found'],
      [{ command: 'sh', args: [], cwd }, { findTerminal: () => null }, 'no-terminal'],
      [{ command: 'sh', args: 'pas un tableau', cwd }, {}, 'invalid-plan'],
    ];
    for (const [plan, options, reason] of cases) {
      const h = harness();
      const result = openInTerminal(plan, { ...h, ...options });
      assert.equal(result.reason, reason, JSON.stringify(plan));
      assert.equal(h.calls.length, 0, `${reason}: no window`);
    }
  });

  test('a terminal that cannot start is reported, not thrown', (t) => {
    const result = openInTerminal(
      { command: 'sh', args: [], cwd: scratch(t) },
      { ...harness(), spawn: () => { throw new Error('EACCES'); } }
    );
    assert.deepEqual(result, { ok: false, reason: 'spawn-failed', detail: 'EACCES' });
  });
});
