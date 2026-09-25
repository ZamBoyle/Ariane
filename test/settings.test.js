'use strict';

/**
 * The settings file: the one file in Ariane that a person writes.
 *
 * Everything here protects their writing. Ariane records what it detected
 * beside it, and must never lose a word of theirs doing so — not a key it does
 * not know, not a file it cannot parse.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Settings, CLI_AGENTS } = require('../src/main/settings');

/** The help main.js writes, in some language: here, lines that say which example they got. */
const HELP = (example, platform) => [`aide (${platform})`, `exemple : ${example}`];

function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Settings(dir, { help: HELP, ...options });
}

const write = (settings, value) =>
  fs.writeFileSync(settings.file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const readBack = (settings) => JSON.parse(fs.readFileSync(settings.file, 'utf8'));

test.describe('recording what was detected', () => {
  test('creates the file as a record: every CLI, found or not, and nothing chosen', (t) => {
    const settings = setup(t, { platform: 'linux' });
    const result = settings.record({ claude: '/home/ada/.local/bin/claude', codex: null });

    assert.deepEqual(result, { ok: true, written: true });
    const data = readBack(settings);
    assert.deepEqual(Object.keys(data.agents), CLI_AGENTS.map(([id]) => id));
    assert.deepEqual(data.agents.claude, { command: '', detected: '/home/ada/.local/bin/claude' });
    assert.deepEqual(data.agents.codex, { command: '', detected: null });
    assert.equal(data.language, 'auto', 'the language, stated rather than implied');
    assert.equal(data.theme, 'auto', 'and the theme, likewise');
    assert.deepEqual(data._aide, ['aide (linux)', 'exemple : /home/vous/.nvm/versions/node/v22.12.0/bin/codex']);
  });

  test('without words to write, the file carries no help rather than hardcoded ones', (t) => {
    const settings = setup(t, { help: null });
    settings.record({});
    assert.equal('_aide' in readBack(settings), false);
  });

  // The design: a detected path copied into `command` would pin it, and the
  // next nvm upgrade would break what detection would have followed.
  test('never writes the person’s field, and keeps whatever they put there', (t) => {
    const settings = setup(t);
    write(settings, { agents: { codex: { command: '/opt/outils/codex', detected: '/ancien/codex' } } });

    settings.record({ codex: '/home/ada/.nvm/versions/node/v22.12.0/bin/codex' });
    const { codex } = readBack(settings).agents;
    assert.equal(codex.command, '/opt/outils/codex');
    assert.equal(codex.detected, '/home/ada/.nvm/versions/node/v22.12.0/bin/codex');
  });

  test('keeps the keys it does not know, at every level', (t) => {
    const settings = setup(t);
    write(settings, {
      theme: 'sombre',
      agents: {
        claude: { command: '', note: 'installé par le script officiel' },
        'un-futur-agent': { command: '/usr/bin/futur' },
      },
    });

    settings.record({ claude: '/usr/bin/claude' });
    const data = readBack(settings);
    assert.equal(data.theme, 'sombre');
    assert.equal(data.agents.claude.note, 'installé par le script officiel');
    assert.deepEqual(data.agents['un-futur-agent'], { command: '/usr/bin/futur' });
  });

  // A typo away from valid, the file holds whatever the person meant to write.
  test('never overwrites a file it cannot read', (t) => {
    const settings = setup(t);
    const broken = '{ "agents": { "codex": { "command": "/opt/codex", } }';
    write(settings, broken);

    const result = settings.record({ codex: '/usr/bin/codex' });
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(settings.file, 'utf8'), broken, 'byte for byte as they left it');
  });

  test('writes nothing when nothing changed', (t) => {
    const settings = setup(t);
    settings.record({ claude: '/usr/bin/claude' });
    const before = fs.statSync(settings.file).mtimeMs;
    assert.deepEqual(settings.record({ claude: '/usr/bin/claude' }), { ok: true, written: false });
    assert.equal(fs.statSync(settings.file).mtimeMs, before);
  });

  test('writes through a temporary file, readable by its owner alone', (t) => {
    const settings = setup(t);
    settings.record({});
    assert.deepEqual(fs.readdirSync(path.dirname(settings.file)), ['settings.json'], 'no partial file left');
    if (process.platform !== 'win32') assert.equal(fs.statSync(settings.file).mode & 0o777, 0o600);
  });

  test('the example in the help is one this system would use', (t) => {
    const help = (platform) => {
      const settings = setup(t, { platform });
      settings.record({});
      return readBack(settings)._aide.join('\n');
    };
    assert.match(help('win32'), /C:\/Users\/vous\/AppData\/Roaming\/npm\/codex\.cmd/);
    assert.match(help('darwin'), /\/Users\/vous\//);
    assert.match(help('linux'), /\/home\/vous\//);
  });

  test('keeps the language the person chose, and reads it back', (t) => {
    const settings = setup(t);
    assert.equal(settings.language(), 'auto', 'no file: automatic');
    write(settings, { language: 'fr' });
    settings.record({});
    assert.equal(readBack(settings).language, 'fr');
    assert.equal(settings.language(), 'fr');
    write(settings, { language: '../../etc' });
    assert.equal(settings.language(), 'auto', 'a value that is not a language tag is not followed');
  });

  test('the splash screen is shown until the person says otherwise', (t) => {
    const settings = setup(t);
    assert.equal(settings.splash(), true, 'no file: shown');
    settings.record({});
    assert.equal(readBack(settings).splash, true, 'stated in the file, rather than implied');

    settings.showSplash(false, {});
    assert.equal(settings.splash(), false);
    assert.equal(readBack(settings).splash, false);

    // A record must never bring it back: it is the person's answer.
    settings.record({});
    assert.equal(settings.splash(), false);

    settings.showSplash(true, {});
    assert.equal(settings.splash(), true);
    assert.throws(() => settings.showSplash('non', {}), TypeError);
  });

  test('keeps the theme the person chose, and reads it back', (t) => {
    const settings = setup(t);
    assert.equal(settings.theme(), 'auto', 'no file: the system decides');
    write(settings, { theme: 'dark' });
    settings.record({});
    assert.equal(readBack(settings).theme, 'dark', 'a record never rewrites a choice');
    assert.equal(settings.theme(), 'dark');

    // Whatever they typed stays in their file — it is theirs — but a theme
    // Ariane cannot paint is not followed.
    write(settings, { theme: 'solarized' });
    assert.equal(settings.theme(), 'auto');
    settings.record({});
    assert.equal(readBack(settings).theme, 'solarized', 'kept as written');
  });
});

test.describe('reading the person’s choice', () => {
  test('no file, no entry, or an empty entry: Ariane searches', (t) => {
    const settings = setup(t);
    assert.deepEqual(settings.commandFor('codex'), { command: null });
    write(settings, { agents: { claude: { command: '/usr/bin/claude' } } });
    assert.deepEqual(settings.commandFor('codex'), { command: null });
    write(settings, { agents: { codex: { command: '   ' } } });
    assert.deepEqual(settings.commandFor('codex'), { command: null });
  });

  test('a path: that one', (t) => {
    const settings = setup(t);
    write(settings, { agents: { codex: { command: ' /opt/outils/codex ' } } });
    assert.deepEqual(settings.commandFor('codex'), { command: '/opt/outils/codex' });
  });

  test('what it detected is never read as a choice', (t) => {
    const settings = setup(t);
    write(settings, { agents: { codex: { command: '', detected: '/ancien/codex' } } });
    assert.deepEqual(settings.commandFor('codex'), { command: null });
  });

  test('a file that cannot be followed says why, and leaves detection to it', (t) => {
    const settings = setup(t);
    write(settings, '{ pas du json');
    const broken = settings.commandFor('codex');
    assert.equal(broken.command, null);
    assert.equal(typeof broken.problem, 'string');

    write(settings, { agents: { codex: { command: 42 } } });
    assert.match(settings.commandFor('codex').problem, /texte/);

    write(settings, '[]');
    assert.equal(typeof settings.commandFor('codex').problem, 'string', 'an array is not a settings object');
  });

  test('an agent name is looked up as data, never through the prototype', (t) => {
    const settings = setup(t);
    write(settings, { agents: {} });
    for (const name of ['__proto__', 'constructor', 'toString']) {
      assert.deepEqual(settings.commandFor(name), { command: null }, name);
    }
  });
});

test.describe('the size of the text', () => {
  test('absent until chosen — an earlier zoom is then taken up, not undone', (t) => {
    const settings = setup(t);
    settings.record({});
    assert.equal(settings.textSize(), null);
    assert.equal(
      'textSize' in readBack(settings),
      false,
      'nothing written for a choice nobody made'
    );
  });

  test('chosen, it is kept through every later write', (t) => {
    const settings = setup(t);
    settings.setTextSize(120, {});
    settings.record({ claude: '/usr/bin/claude' });
    assert.equal(settings.textSize(), 120);
    assert.equal(readBack(settings).textSize, 120);
  });

  test('only the offered sizes are followed; another value is kept, not obeyed', (t) => {
    const settings = setup(t);
    assert.throws(() => settings.setTextSize(150, {}), /textSize/);
    assert.throws(() => settings.save({ textSize: '120' }, {}), /textSize/);
    write(settings, { textSize: 150 });
    settings.record({});
    assert.equal(settings.textSize(), null);
    assert.equal(readBack(settings).textSize, 150, 'the person’s value, left where they wrote it');
  });

  test('the settings window saves it like the rest', (t) => {
    const settings = setup(t);
    settings.save({ textSize: 110 }, {});
    assert.equal(settings.textSize(), 110);
  });
});

test.describe('saving from the settings window', () => {
  test('writes exactly what was typed, trimmed, for the assistants named', (t) => {
    const settings = setup(t);
    write(settings, { agents: { qwen: { command: '/opt/qwen', note: 'à moi' } }, theme: 'sombre' });

    const result = settings.save({ commands: { codex: '  ~/outils/codex  ', claude: '' } }, { claude: '/usr/bin/claude' });
    assert.deepEqual(result, { ok: true, written: true });
    const data = readBack(settings);
    assert.equal(data.agents.codex.command, '~/outils/codex', 'kept as typed: ~ is read at launch');
    assert.equal(data.agents.claude.command, '');
    assert.equal(data.agents.claude.detected, '/usr/bin/claude');
    assert.deepEqual(data.agents.qwen, { command: '/opt/qwen', detected: null, note: 'à moi' });
    assert.equal(data.theme, 'sombre');
  });

  test('refuses an assistant without a CLI, or a path that is not text', (t) => {
    const settings = setup(t);
    assert.throws(() => settings.save({ commands: { vscode: '/usr/bin/code' } }, {}), TypeError);
    assert.throws(() => settings.save({ commands: JSON.parse('{"__proto__": "/x"}') }, {}), TypeError);
    assert.throws(() => settings.save({ commands: { codex: 42 } }, {}), TypeError);
    assert.throws(() => settings.save({ language: 'fr; rm -rf' }, {}), TypeError);
    assert.throws(() => settings.save({ language: 7 }, {}), TypeError);
    assert.throws(() => settings.save({ theme: 'solarized' }, {}), TypeError);
    assert.throws(() => settings.save({ theme: 'Dark' }, {}), TypeError);
    assert.throws(() => settings.save({ theme: 7 }, {}), TypeError);
    assert.equal(fs.existsSync(settings.file), false, 'nothing written');
  });

  test('never overwrites a file it cannot read', (t) => {
    const settings = setup(t);
    write(settings, '{ "agents": ');
    assert.equal(settings.save({ commands: { codex: '/x' } }, {}).ok, false);
    assert.equal(fs.readFileSync(settings.file, 'utf8'), '{ "agents": ');
  });
});

test('the language is saved as chosen, beside everything else', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings = new Settings(dir);
  fs.writeFileSync(settings.file, JSON.stringify({ agents: { codex: { command: '/opt/codex' } } }));
  settings.save({ language: 'pt-BR' }, {});
  const data = JSON.parse(fs.readFileSync(settings.file, 'utf8'));
  assert.equal(data.language, 'pt-BR');
  assert.equal(data.agents.codex.command, '/opt/codex');

  // One choice at a time: saving a theme leaves the language alone, and back.
  settings.save({ theme: 'light' }, {});
  const after = JSON.parse(fs.readFileSync(settings.file, 'utf8'));
  assert.equal(after.theme, 'light');
  assert.equal(after.language, 'pt-BR');
  assert.equal(after.agents.codex.command, '/opt/codex');
});
