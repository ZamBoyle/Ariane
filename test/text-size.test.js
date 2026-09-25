'use strict';

/**
 * La taille du texte, les touches qui la changent, et le menu autour.
 *
 * Mesuré le 25 septembre 2026 sur l'application lancée, par son vrai chemin
 * d'entrée : le menu par défaut d'Electron, caché et en anglais, agrandissait
 * avec Ctrl+Maj+= et réduisait avec Ctrl+- — mais Ctrl+= et le pavé numérique
 * ne faisaient rien, et ce menu offrait les outils de développement et le
 * rechargement forcé dans chaque paquet publié.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TEXT_SIZES,
  nearestSize,
  stepSize,
  keyAction,
  menuTemplate,
} = require('../src/main/text-size');

/** Une touche telle que `before-input-event` la décrit. */
const press = (key, code, mods = {}) => ({
  type: 'keyDown',
  key,
  code,
  control: false,
  meta: false,
  shift: false,
  alt: false,
  ...mods,
});
const ctrl = { control: true };

test('cinq tailles, de 90 à 130 %', () => {
  assert.deepEqual(TEXT_SIZES, [90, 100, 110, 120, 130]);
});

test('un ancien zoom se range sur la taille la plus proche', () => {
  assert.equal(nearestSize(120.00000001), 120, 'le 1,2 de Chromium, arrondi à sa manière');
  assert.equal(nearestSize(109.5), 110);
  assert.equal(nearestSize(250), 130, 'jamais au-delà de ce qui est offert');
  assert.equal(nearestSize(Number.NaN), 100);
});

test('un pas à la fois, sans jamais dépasser les bornes', () => {
  assert.equal(stepSize(100, 1), 110);
  assert.equal(stepSize(100, -1), 90);
  assert.equal(stepSize(130, 1), 130);
  assert.equal(stepSize(90, -1), 90);
  assert.equal(stepSize(120, 0), 100, 'Ctrl+0 revient à la taille d’origine');
});

test('les touches qu’on essaie d’abord agrandissent — celles qui ne faisaient rien comprises', () => {
  for (const [label, input] of [
    ['Ctrl+= (sans Maj)', press('=', 'Equal', ctrl)],
    ['Ctrl+Maj+=, qui donne « + »', press('+', 'Equal', { ...ctrl, shift: true })],
    ['le + du pavé numérique', press('+', 'NumpadAdd', ctrl)],
  ]) {
    assert.equal(keyAction(input, { platform: 'linux' }), 'text-bigger', label);
  }
  assert.equal(keyAction(press('-', 'Minus', ctrl), { platform: 'win32' }), 'text-smaller');
  assert.equal(
    keyAction(press('-', 'NumpadSubtract', ctrl), { platform: 'linux' }),
    'text-smaller'
  );
  assert.equal(
    keyAction(press('à', 'Digit0', ctrl), { platform: 'linux' }),
    'text-reset',
    'en AZERTY, Ctrl+0 arrive comme Ctrl+à'
  );
});

test('sous macOS c’est Cmd, et Ctrl n’y change rien', () => {
  assert.equal(
    keyAction(press('=', 'Equal', { meta: true }), { platform: 'darwin' }),
    'text-bigger'
  );
  assert.equal(keyAction(press('=', 'Equal', ctrl), { platform: 'darwin' }), null);
});

test('ni Alt, ni une touche relâchée, ni une lettre seule ne déclenchent rien', () => {
  assert.equal(keyAction(press('=', 'Equal', { ...ctrl, alt: true }), { platform: 'linux' }), null);
  assert.equal(
    keyAction({ ...press('=', 'Equal', ctrl), type: 'keyUp' }, { platform: 'linux' }),
    null
  );
  assert.equal(
    keyAction(press('q', 'KeyQ'), { platform: 'linux' }),
    null,
    'un q tapé dans la recherche'
  );
  assert.equal(keyAction(null), null);
});

test('sans menu, Linux et Windows gardent quitter, fermer et le plein écran', () => {
  assert.equal(keyAction(press('q', 'KeyQ', ctrl), { platform: 'linux' }), 'quit');
  assert.equal(keyAction(press('w', 'KeyW', ctrl), { platform: 'win32' }), 'close');
  assert.equal(keyAction(press('F11', 'F11'), { platform: 'linux' }), 'fullscreen');
  assert.equal(
    keyAction(press('q', 'KeyQ', { meta: true }), { platform: 'darwin' }),
    null,
    'sous macOS, le menu de l’application s’en charge'
  );
});

test('les outils de développement n’existent que hors d’un paquet publié', () => {
  const devtools = press('I', 'KeyI', { ...ctrl, shift: true });
  assert.equal(keyAction(devtools, { platform: 'linux', packaged: false }), 'devtools');
  assert.equal(keyAction(press('F12', 'F12'), { platform: 'linux', packaged: false }), 'devtools');
  assert.equal(keyAction(devtools, { platform: 'linux', packaged: true }), null);
  assert.equal(keyAction(press('F12', 'F12'), { platform: 'win32', packaged: true }), null);
});

test('le menu : aucun sous Linux et Windows, le strict nécessaire sous macOS', () => {
  assert.equal(menuTemplate({ platform: 'linux' }), null);
  assert.equal(menuTemplate({ platform: 'win32' }), null);

  const mac = menuTemplate({ platform: 'darwin', packaged: true });
  assert.deepEqual(
    mac.map((item) => item.role),
    ['appMenu', 'editMenu', 'windowMenu'],
    'l’édition, sans laquelle copier-coller ne marche pas sous macOS ; pas de menu Affichage, dont le zoom contournerait le réglage'
  );
  const flat = JSON.stringify(menuTemplate({ platform: 'darwin', packaged: true }));
  assert.ok(!/reload|DevTools|zoom/i.test(flat.replace('windowMenu', '')), flat);
  assert.match(
    JSON.stringify(menuTemplate({ platform: 'darwin', packaged: false })),
    /toggleDevTools/
  );
});
