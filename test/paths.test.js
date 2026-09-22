'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const paths = require('../src/core/paths');

test('configDir defaults to ~/.claude on every platform', () => {
  assert.equal(paths.configDir({}, '/home/zam'), path.join('/home/zam', '.claude'));
});

test('configDir honours CLAUDE_CONFIG_DIR and trims it', () => {
  assert.equal(paths.configDir({ CLAUDE_CONFIG_DIR: '  /custom/dir  ' }, '/home/zam'),
    path.resolve('/custom/dir'));
});

test('configDir ignores a blank override', () => {
  assert.equal(paths.configDir({ CLAUDE_CONFIG_DIR: '   ' }, '/home/zam'),
    path.join('/home/zam', '.claude'));
});

test('derived paths hang off the config dir', () => {
  const env = { CLAUDE_CONFIG_DIR: '/c' };
  // `configDir` résout le chemin donné, ce qui sous Windows lui ajoute une
  // lettre de lecteur : l'attendu doit résoudre aussi, pas seulement joindre.
  const racine = path.resolve('/c');
  assert.equal(paths.projectsDir(env, '/h'), path.join(racine, 'projects'));
  assert.equal(paths.historyFile(env, '/h'), path.join(racine, 'history.jsonl'));
  assert.equal(paths.sessionsIndexFile('/c/projects/-a-b'),
    path.join('/c/projects/-a-b', 'sessions-index.json'));
});

test('isAvailable is false for a missing directory', () => {
  assert.equal(paths.isAvailable({ CLAUDE_CONFIG_DIR: '/nope/does/not/exist' }, '/h'), false);
});

test.describe('decodeHint', () => {
  test('rebuilds a simple POSIX path', () => {
    assert.equal(paths.decodeHint('-home-zam-repos'), '/home/zam/repos');
  });

  test('rebuilds a Windows drive path', () => {
    assert.equal(paths.decodeHint('C--Users-zam-repos'), 'C:\\Users\\zam\\repos');
  });

  test('handles degenerate input', () => {
    assert.equal(paths.decodeHint('-'), path.sep);
    assert.equal(paths.decodeHint(''), '');
    assert.equal(paths.decodeHint(null), '');
  });

  // These two cases are the reason decodeHint is a display hint and never a
  // filesystem path: the encoding is lossy in both directions.
  test('cannot restore accents (documents the lossiness)', () => {
    assert.equal(paths.decodeHint('-home-zam-Documents-Math-matiques'),
      '/home/zam/Documents/Math/matiques');
  });

  test('cannot distinguish a real hyphen from a separator', () => {
    assert.equal(paths.decodeHint('-a-Donkey-Pong-Claude'), '/a/Donkey/Pong/Claude');
  });
});
