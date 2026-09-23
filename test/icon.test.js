'use strict';

/**
 * L'icône de la fenêtre, et l'association au lanceur.
 *
 * Deux mécanismes différents, tous deux cassés en même temps, et qui se
 * reperdront si rien ne les garde :
 *
 *   `_NET_WM_ICON`    l'icône que porte la fenêtre. Electron n'en pose AUCUNE
 *                     de lui-même sous Linux. Sans elle, une barre des tâches
 *                     n'a rien à afficher et met son icône générique.
 *   `StartupWMClass`  l'association au fichier .desktop, par la classe que la
 *                     fenêtre annonce. Elle ne peint rien : elle relie.
 *
 * Mesuré le 23 septembre 2026, sur le binaire empaqueté lancé sous écran
 * virtuel : les deux vraies fenêtres annoncent `WM_CLASS = "ariane", "ariane"`.
 * Une troisième, de classe « Ariane », fait 10 px et n'est pas cartographiée —
 * c'est une fenêtre interne de Chromium, elle n'apparaît dans aucune barre.
 * C'est la minuscule qui compte.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** Les tailles que main.js réclame, lues dans sa source plutôt que devinées. */
function sizesAskedFor() {
  const found = /const ICON_SIZES = \[([^\]]+)\]/.exec(MAIN);
  assert.ok(found, 'main.js doit déclarer ICON_SIZES');
  return found[1].split(',').map((n) => Number(n.trim()));
}

// ── l'image existe, et voyage ─────────────────────────────────────────────

test('chaque taille réclamée par main.js existe et n’est pas vide', () => {
  const sizes = sizesAskedFor();
  assert.ok(
    sizes.length >= 4,
    `au moins quatre tailles, pour que 16 px ne soit pas une réduction de 512 : ${sizes}`
  );

  for (const size of sizes) {
    const file = path.join(ROOT, 'build', 'icons', `${size}x${size}.png`);
    assert.ok(fs.existsSync(file), `${size}x${size}.png doit exister : main.js la demande`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 100, `${size}x${size}.png ne doit pas être vide`);
    // Les huit premiers octets d'un PNG, faute de quoi nativeImage rendra vide.
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${size}x${size}.png doit être un vrai PNG`
    );
  }
});

test('les icônes voyagent avec l’application', () => {
  // `build/` est le répertoire de ressources d'electron-builder : il est exclu
  // du paquet. Sans extraResources, l'application empaquetée n'a aucune image
  // sous la main — constaté, /opt/Ariane n'en contenait pas une seule.
  const extra = PKG.build.extraResources;
  assert.ok(Array.isArray(extra), 'build.extraResources doit exister');
  const icons = extra.find((e) => e && e.from === 'build/icons');
  assert.ok(icons, 'build/icons doit être copié dans le paquet');
  assert.equal(icons.to, 'icons', 'et atterrir dans resources/icons, où main.js les cherche');
});

test('main.js va chercher les icônes des deux côtés de l’empaquetage', () => {
  assert.match(MAIN, /app\.isPackaged/, 'le chemin diffère selon que l’application est empaquetée');
  assert.match(MAIN, /process\.resourcesPath/, 'empaquetée, elles sont dans resources/');
  assert.match(MAIN, /'build', 'icons'/, 'en développement, elles sont dans build/icons');
});

// ── la fenêtre la porte ───────────────────────────────────────────────────

test('les deux fenêtres reçoivent une icône', () => {
  const windows = MAIN.split('new BrowserWindow({').slice(1);
  assert.equal(windows.length, 2, 'main.js ouvre deux fenêtres : l’accueil et l’application');

  for (const [i, body] of windows.entries()) {
    const options = body.slice(0, body.indexOf('}'));
    assert.match(
      options,
      /icon: ICON/,
      `la fenêtre ${i + 1} doit recevoir icon: sans quoi elle n’a pas de _NET_WM_ICON`
    );
  }
});

// ── l'association au lanceur ──────────────────────────────────────────────

test('le .desktop porte le nom que les vraies fenêtres annoncent', () => {
  // Mesuré : WM_CLASS = "ariane", "ariane". electron-builder écrit
  // StartupWMClass depuis desktopName, qui se pose à la RACINE de package.json
  // — sous build.linux, le schéma le refuse et la construction échoue.
  assert.equal(
    PKG.desktopName,
    'ariane.desktop',
    'desktopName va à la racine, pas sous build.linux'
  );
  assert.equal(PKG.build.linux.syncDesktopName, true, 'sans quoi le fichier garde un autre nom');
  assert.ok(
    !PKG.build.linux.desktopName,
    'la clé n’existe pas sous linux : elle y fait échouer la construction'
  );

  const expected = `${PKG.name}.desktop`;
  assert.equal(
    PKG.desktopName,
    expected,
    `doit suivre le nom du paquet (${PKG.name}), qui est aussi celui de l’exécutable`
  );
});
