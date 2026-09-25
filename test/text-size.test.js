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
    ['appMenu', 'fileMenu', 'editMenu', 'windowMenu'],
    'Fichier, qui porte Cmd+W — le menu Fenêtre ne ferme rien sous macOS ; l’édition, sans laquelle copier-coller ne marche pas ; pas de menu Affichage, dont le zoom contournerait le réglage'
  );
  const flat = JSON.stringify(menuTemplate({ platform: 'darwin', packaged: true }));
  assert.ok(!/reload|DevTools|zoom/i.test(flat.replace('windowMenu', '')), flat);
  assert.match(
    JSON.stringify(menuTemplate({ platform: 'darwin', packaged: false })),
    /toggleDevTools/
  );
});

// Trouvé sous Windows le 25 septembre 2026, par bissection sur une vraie
// machine : un zoom posé sur la page encore cachée (au did-finish-load)
// empêchait `ready-to-show` de jamais venir — l'écran d'accueil, puis rien, pas
// même dans Alt+Tab. C'est le bogue #51972 d'Electron, présent depuis la 40 et
// corrigé en 44.4.4. Aucun test ne lance la vraie fenêtre sous Windows : ce
// garde-fou lit donc le code.
test('main.js n’applique la taille du texte qu’une fois la fenêtre montrée', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'main', 'main.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /on\('did-finish-load'[\s\S]{0,600}(setZoomFactor|applyTextSize)/);
  assert.match(
    source,
    /win\.once\('ready-to-show'[\s\S]{0,200}win\.show\(\)[\s\S]{0,1200}applyTextSize\(win\)/
  );
});

// Signalé depuis Windows le 25 septembre 2026 : au second lancement, Ctrl+Q ne
// fermait rien. L'écran d'accueil prend le clavier à l'ouverture et n'a pas de
// menu — Ctrl+Q n'y a jamais rien fait, sous Linux non plus (mesuré).
test('Ctrl+Q quitte aussi depuis l’écran d’accueil, qui a le clavier au lancement', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'main', 'main.js'),
    'utf8'
  );
  const start = source.indexOf('function createSplash()');
  const splash = source.slice(start, source.indexOf('\n}\n', start));
  assert.match(
    splash,
    /splash\.webContents\.on\('before-input-event'[\s\S]{0,200}keyAction\([\s\S]{0,200}'quit'[\s\S]{0,100}app\.quit\(\)/,
    'l’écran d’accueil lit les mêmes touches que l’application'
  );
  assert.doesNotMatch(splash, /text-/, 'la taille du texte ne s’applique pas à une image');
});
