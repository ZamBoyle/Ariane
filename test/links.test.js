'use strict';

/**
 * Un lien dans une conversation s'ouvre dans le navigateur, jamais dans Ariane.
 *
 * Deux gardes, et ce fichier tient le second. Le premier est dans format.js :
 * seul un lien http(s) reçoit une adresse, et il porte target="_blank". Le
 * second est dans le processus principal : un clic sur ce lien demande une
 * nouvelle fenêtre, que setWindowOpenHandler REFUSE toujours, après avoir
 * confié l'adresse au navigateur si — et seulement si — elle est http(s).
 * Un renderer compromis qui fabriquerait un lien `file:` s'arrête là.
 *
 * main.js ne se charge pas hors d'Electron : comme test/icon.test.js, on lit
 * sa source. Chaque vérification a été vue échouer en retirant ce qu'elle garde.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

/** Le corps du gestionnaire de nouvelles fenêtres, jusqu'à la fin de son appel. */
function openHandler() {
  const start = MAIN.indexOf('setWindowOpenHandler(');
  assert.ok(
    start !== -1,
    'main.js doit déclarer setWindowOpenHandler : sans lui, un lien ouvrirait une fenêtre Electron'
  );
  return MAIN.slice(start, MAIN.indexOf('});', start));
}

test('une nouvelle fenêtre est toujours refusée', () => {
  assert.match(
    openHandler(),
    /return \{ action: 'deny' \}/,
    'Ariane n’ouvre jamais de page dans une fenêtre à elle'
  );
});

test('seul http(s) est confié au navigateur, et le protocole est vérifié ici, pas dans la fenêtre', () => {
  const body = openHandler();
  assert.match(
    body,
    /\/\^https\?:\$\/\.test\(safeProtocol\(url\)\)/,
    'le protocole doit être http: ou https:, exactement'
  );
  assert.match(body, /shell\.openExternal\(url\)/, 'une adresse acceptée part dans le navigateur');
  assert.ok(
    body.indexOf('safeProtocol') < body.indexOf('shell.openExternal'),
    'la vérification précède l’ouverture'
  );
});

test('un protocole illisible ne passe pas', () => {
  // safeProtocol rend '' quand URL() refuse l'adresse : '' n'est pas http(s).
  const fn = /function safeProtocol\(url\) \{[\s\S]*?\n\}/.exec(MAIN);
  assert.ok(fn, 'safeProtocol doit exister');
  assert.match(
    fn[0],
    /catch \{\s*return '';/,
    'une adresse que URL() refuse ne doit rien rendre d’ouvrable'
  );
});

test('la fenêtre ne navigue jamais hors de l’application', () => {
  const start = MAIN.indexOf("on('will-navigate'");
  assert.ok(start !== -1, 'main.js doit surveiller will-navigate');
  const body = MAIN.slice(start, MAIN.indexOf('});', start));
  assert.match(
    body,
    /event\.preventDefault\(\)/,
    'un clic sans target=_blank ne doit pas remplacer Ariane par la page'
  );
});

// Sans navigateur qui réponde, openExternal rejette : non rattrapé, c'était la
// boîte « A JavaScript error occurred » d'Electron pour un simple clic.
test('un navigateur qui ne s’ouvre pas ne fait pas une erreur de l’application', () => {
  assert.match(openHandler(), /shell\.openExternal\(url\)\.catch\(/);
});

// Une base illisible au lancement : sans ce catch, le processus gardait le
// verrou d'instance unique sans jamais ouvrir de fenêtre, et chaque nouveau
// lancement s'y heurtait.
test('un démarrage raté ne garde pas le verrou sans fenêtre', () => {
  const start = MAIN.search(/app\s*\.whenReady\(\)/);
  assert.ok(start !== -1, 'main.js démarre par app.whenReady()');
  const chain = MAIN.slice(start, MAIN.indexOf("app.on('window-all-closed'", start));
  assert.match(chain, /\.catch\(/, 'le démarrage rattrape son échec');
  assert.match(chain, /app\.exit\(1\)/, 'et rend le verrou');
});
