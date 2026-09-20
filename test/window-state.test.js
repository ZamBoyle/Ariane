'use strict';

/**
 * Where the window was, and how big — and the one rule that matters: a saved
 * position is only followed while the screen it was saved on still exists.
 *
 * Unplug a second monitor, undock a laptop, change a resolution, and a
 * faithfully restored `x: 2400` opens the window where nobody can reach it,
 * with no visible way to bring it back. So these tests spend most of their
 * time on screens that went away.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WindowState, boundsFrom, onScreen, FILE_NAME } = require('../src/main/window-state');

const DEFAULTS = { width: 1280, height: 860, minWidth: 780, minHeight: 520 };
/** One 1920×1080 screen, as Electron reports a work area. */
const LAPTOP = [{ x: 0, y: 0, width: 1920, height: 1040 }];
/** The same, plus a second screen to its right. */
const TWO = [...LAPTOP, { x: 1920, y: 0, width: 1920, height: 1040 }];

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-window-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, state: new WindowState(dir) };
}

test.describe('what to open with', () => {
  test('nothing saved: the size this app was written for', () => {
    const bounds = boundsFrom(null, DEFAULTS, LAPTOP);
    assert.deepEqual(bounds, { width: 1280, height: 860, maximized: false });
    assert.equal('x' in bounds, false, 'et centrée, donc sans position');
  });

  test('a size and a position that still fit are followed exactly', () => {
    assert.deepEqual(
      boundsFrom({ width: 1000, height: 700, x: 120, y: 90 }, DEFAULTS, LAPTOP),
      { width: 1000, height: 700, x: 120, y: 90, maximized: false }
    );
  });

  test('a window smaller than the app allows is brought back to the minimum', () => {
    const bounds = boundsFrom({ width: 200, height: 100 }, DEFAULTS, LAPTOP);
    assert.equal(bounds.width, 780);
    assert.equal(bounds.height, 520);
  });

  test('a window larger than any screen is brought back to the largest', () => {
    const bounds = boundsFrom({ width: 9000, height: 9000 }, DEFAULTS, LAPTOP);
    assert.equal(bounds.width, 1920);
    assert.equal(bounds.height, 1040);
  });

  test('maximised is remembered as a state, not as a size', () => {
    assert.equal(boundsFrom({ width: 1000, height: 700, maximized: true }, DEFAULTS, LAPTOP).maximized, true);
    assert.equal(boundsFrom({ width: 1000, height: 700 }, DEFAULTS, LAPTOP).maximized, false);
  });

  test('nonsense in the file is ignored rather than followed', () => {
    for (const saved of [
      { width: 'grand', height: 'haut' },
      { width: -100, height: 700 },
      { width: NaN, height: NaN },
      { x: 10, y: 10 }, // une position sans taille ne dit rien
      [],
      'bonjour',
    ]) {
      const bounds = boundsFrom(saved, DEFAULTS, LAPTOP);
      assert.equal(bounds.width, 1280, JSON.stringify(saved));
      assert.equal(bounds.height, 860, JSON.stringify(saved));
    }
  });
});

test.describe('the screen that went away', () => {
  test('a position on a second screen is kept while that screen is there', () => {
    const bounds = boundsFrom({ width: 1000, height: 700, x: 2400, y: 100 }, DEFAULTS, TWO);
    assert.equal(bounds.x, 2400);
  });

  test('the same position, that screen unplugged: the size stays, the place goes', () => {
    const bounds = boundsFrom({ width: 1000, height: 700, x: 2400, y: 100 }, DEFAULTS, LAPTOP);
    assert.equal(bounds.width, 1000, 'la taille, elle, veut dire la même chose partout');
    assert.equal(bounds.height, 700);
    assert.equal('x' in bounds, false, 'et la fenêtre repart au centre');
  });

  test('a window barely off the edge is refused rather than half shown', () => {
    // 40 px visibles : trop peu pour l'attraper à la souris.
    assert.equal('x' in boundsFrom({ width: 1000, height: 700, x: 1880, y: 100 }, DEFAULTS, LAPTOP), false);
    // 200 px visibles : on peut la saisir, on la garde.
    assert.equal(boundsFrom({ width: 1000, height: 700, x: 1720, y: 100 }, DEFAULTS, LAPTOP).x, 1720);
  });

  test('a window above the screen is refused: its bar would be out of reach', () => {
    assert.equal('x' in boundsFrom({ width: 1000, height: 700, x: 100, y: -690 }, DEFAULTS, LAPTOP), false);
  });

  test('without any screen to check against, no position is followed', () => {
    assert.equal('x' in boundsFrom({ width: 1000, height: 700, x: 100, y: 100 }, DEFAULTS, []), false);
  });

  test('onScreen answers on overlap, not on containment', () => {
    assert.equal(onScreen({ x: -100, y: 0, width: 1000, height: 700 }, LAPTOP), true, 'à cheval : visible');
    assert.equal(onScreen({ x: 5000, y: 0, width: 1000, height: 700 }, LAPTOP), false);
  });
});

test.describe('the file itself', () => {
  test('is written where the app keeps its own things, and read back', (t) => {
    const { dir, state } = setup(t);
    assert.equal(state.read(), null, 'aucun fichier : rien à dire');

    assert.deepEqual(state.save({ width: 1100, height: 720, x: 40, y: 20, maximized: false }), { ok: true });
    assert.ok(fs.existsSync(path.join(dir, FILE_NAME)));
    assert.deepEqual(state.read(), { width: 1100, height: 720, x: 40, y: 20, maximized: false });

    assert.deepEqual(state.bounds(DEFAULTS, LAPTOP), {
      width: 1100,
      height: 720,
      x: 40,
      y: 20,
      maximized: false,
    });
  });

  test('a size that is not one is not written at all', (t) => {
    const { dir, state } = setup(t);
    assert.deepEqual(state.save({ width: 0, height: 0 }), { ok: false });
    assert.equal(fs.existsSync(path.join(dir, FILE_NAME)), false);
  });

  test('an unreadable file opens the app rather than stopping it', (t) => {
    const { dir, state } = setup(t);
    fs.writeFileSync(path.join(dir, FILE_NAME), '{ "width": ');
    assert.equal(state.read(), null);
    assert.equal(state.bounds(DEFAULTS, LAPTOP).width, 1280);
  });

  test('a directory that cannot be written is not an error anyone should see', (t) => {
    const { dir, state } = setup(t);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, 'ceci est un fichier, pas un dossier');
    const result = state.save({ width: 1000, height: 700, x: 0, y: 0, maximized: false });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    fs.rmSync(dir, { force: true });
  });
});
