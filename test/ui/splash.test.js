'use strict';

/**
 * L'écran d'accueil, sous Electron (`npm run test:splash`).
 *
 * Il ne peut pas être vérifié depuis la suite unitaire : c'est une page, une
 * image de fond et une case à cocher. Et il ne peut pas l'être non plus en
 * lançant l'application, parce qu'il se ferme en une seconde et demie — sous
 * un serveur X sans gestionnaire de fenêtres, il passe même derrière la
 * fenêtre principale.
 *
 * Ce qui est gardé ici : l'image se charge, les phrases viennent du pont et non
 * du code, la case écrit le choix au clic, et les TROIS sorties ferment la
 * fenêtre — le bouton, Échap, un clic sur l'image. C'est le point qui a
 * manqué : une première version se fermait seule au bout d'1,7 seconde, et la
 * case était impossible à cocher.
 */

const path = require('path');
const { app, BrowserWindow } = require('electron');

const PAGE = path.join(__dirname, '..', '..', 'src', 'renderer', 'splash.html');
const PRELOAD = path.join(__dirname, 'splash-preload.js');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

function windowFor(preload = PRELOAD) {
  return new BrowserWindow({
    width: 760,
    height: 470,
    show: false,
    frame: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `splash-${Math.random()}`,
    },
  });
}

async function run() {
  // Les deux fenêtres sont ouvertes d'abord : détruire la première avant de
  // charger la seconde faisait échouer son chargement (ERR_FAILED).
  const win = windowFor();
  const mute = windowFor(path.join(__dirname, 'splash-preload-mute.js'));
  await Promise.all([win.loadFile(PAGE), mute.loadFile(PAGE)]);

  const state = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 60 && !document.getElementById('hide-label').textContent; i++) await sleep(50);

    const art = document.querySelector('.art');
    const box = document.getElementById('hide');
    const label = document.getElementById('hide-label');

    const shown = {
      label: label.textContent,
      dismiss: document.getElementById('dismiss').textContent,
      imageWidth: art.naturalWidth,
      imageHeight: art.naturalHeight,
      covers: getComputedStyle(art).objectFit,
      boxVisible: !document.querySelector('.hide').hidden,
    };

    box.click();
    await sleep(60);
    const afterTick = { checked: box.checked, calls: window.probe.calls() };

    box.click();
    await sleep(60);
    const afterUntick = { checked: box.checked, calls: window.probe.calls() };

    // Les trois sorties, chacune comptée.
    const ways = [];
    document.getElementById('dismiss').click();
    await sleep(40);
    ways.push(window.probe.closes());
    document.getElementById('art').click();
    await sleep(40);
    ways.push(window.probe.closes());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(40);
    ways.push(window.probe.closes());

    // Rien de la page ne doit atteindre l'application.
    const reach = { api: typeof window.api, require: typeof window.require, process: typeof window.process };
    const exposed = Object.keys(window.splash).sort();

    return { shown, afterTick, afterUntick, ways, reach, exposed };
  })()`);

  check('the banner is really loaded, and covers the window',
    state.shown.imageWidth > 1000 && state.shown.imageHeight > 500 && state.shown.covers === 'cover',
    `${state.shown.imageWidth}×${state.shown.imageHeight}, object-fit: ${state.shown.covers}`);
  check('both sentences come from the bridge, never from the page',
    state.shown.label === 'Ne plus afficher cet écran au démarrage' && state.shown.dismiss === 'Continuer',
    `${state.shown.label} | ${state.shown.dismiss}`);
  check('three ways out, and each one of them asks to close',
    state.ways.join(',') === '1,2,3',
    `bouton, image, Échap : ${state.ways.join(' puis ')}`);
  check('ticking the box asks to stop showing it',
    state.afterTick.checked && state.afterTick.calls.length === 1 && state.afterTick.calls[0] === false,
    JSON.stringify(state.afterTick));
  check('unticking it asks for the opposite, rather than saving nothing',
    !state.afterUntick.checked && state.afterUntick.calls.join(',') === 'false,true',
    JSON.stringify(state.afterUntick));
  check('the window reaches nothing but its own three functions',
    state.exposed.join(',') === 'close,keep,words' && state.reach.api === 'undefined'
      && state.reach.require === 'undefined' && state.reach.process === 'undefined',
    `${state.exposed.join(',')} | ${JSON.stringify(state.reach)}`);

  const image = await win.webContents.capturePage();
  const file = path.join(require('os').tmpdir(), 'ariane-splash.png');
  require('fs').writeFileSync(file, image.toPNG());
  console.log(`# capture : ${file}`);
  win.destroy();

  // Un pont muet : la case disparaît plutôt que de rester sans mot.
  const silent = await mute.webContents.executeJavaScript(`(async () => {
    await new Promise((r) => setTimeout(r, 300));
    return { hidden: document.querySelector('.bar').hidden, label: document.getElementById('hide-label').textContent };
  })()`);
  check('a bridge that does not answer hides the bar rather than showing it mute',
    silent.hidden === true && silent.label === '', JSON.stringify(silent));
  mute.destroy();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  console.log(`\n# splash checks ${results.length} | pass ${results.length - failed.length} | fail ${failed.length}`);
  return failed.length === 0 ? 0 : 1;
}

app
  .whenReady()
  .then(run)
  .then((code) => app.exit(code))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
