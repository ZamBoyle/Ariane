'use strict';

/**
 * Launch Ariane on the demo corpus — the real app, not a mock.
 *
 *   npm run demo                explore it; corpus and database are kept
 *   npm run demo -- --reset     rebuild them from nothing, with fresh dates
 *   npm run demo:capture        regenerate docs/ariane.png, then quit
 *
 * Every agent root points into the demo directory, and the app gets a
 * user-data directory of its own inside it. The real index is therefore never
 * opened, and a running Ariane is left alone: the single-instance lock follows
 * the user-data directory. Swapping the real database for a demo one would not
 * work — the app rebuilds its index from the agents' files on launch, and
 * would pour the real history straight back in.
 *
 * The demo lives beside the real data (~/.config/Ariane-demo on Linux) and is
 * kept between launches. The capture alone rebuilds a fresh copy each time, so
 * that the screenshot always reads "il y a 1 heure" whenever it is taken.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const { buildDemoCorpus, ensureDemoCorpus, SHOWCASE, DEMO_HOME } = require('./demo-corpus');

/** The screenshot's size: wide enough for the sidebar and a readable column. */
const CAPTURE_SIZE = { width: 1400, height: 880 };

const captureArg = process.argv.find((a) => a.startsWith('--capture='));
const captureTo = captureArg ? path.resolve(captureArg.slice('--capture='.length)) : null;

/**
 * The capture starts from a fresh corpus every time, in ONE fixed directory it
 * empties first. It is not deleted on the way out, because it cannot be:
 * Chromium flushes its profile (cache, session storage, preferences) after
 * every exit hook Node offers — will-quit, quit, even process exit — and
 * recreated user-data/ in a directory already removed, leaving one more behind
 * per capture. A fixed directory, reused, leaves at most one, in the temp dir.
 */
const CAPTURE_ROOT = path.join(os.tmpdir(), 'ariane-demo-capture');

if (captureTo) fs.rmSync(CAPTURE_ROOT, { recursive: true, force: true });
const root = captureTo ? CAPTURE_ROOT : path.join(app.getPath('appData'), 'Ariane-demo');

const { env } = captureTo
  ? buildDemoCorpus(root)
  : ensureDemoCorpus(root, { reset: process.argv.includes('--reset') });
Object.assign(process.env, env);
app.setPath('userData', path.join(root, 'user-data'));

if (!captureTo) console.log(`Démo : ${root}`);

require('../src/main/main');

if (captureTo) {
  app
    .whenReady()
    .then(capture)
    .catch((error) => {
      console.error(error.message || error);
      app.exit(1);
    });
}

async function capture() {
  const win = await firstWindow();
  win.setContentSize(CAPTURE_SIZE.width, CAPTURE_SIZE.height);

  const result = await win.webContents.executeJavaScript(
    drive(`${DEMO_HOME}/${SHOWCASE.folder}`, SHOWCASE.title, DEMO_HOME)
  );
  if (result.error) throw new Error(`capture refusée : ${result.error}`);

  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(captureTo), { recursive: true });
  fs.writeFileSync(captureTo, image.toPNG());
  const { width, height } = image.getSize();
  console.log(`${captureTo} — ${width}×${height}, ${result.folders} dossiers, tous sous ${DEMO_HOME}`);
  app.quit();
}

async function firstWindow() {
  for (let i = 0; i < 200; i++) {
    const [win] = BrowserWindow.getAllWindows();
    if (win && !win.webContents.isLoading()) return win;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no window appeared');
}

/**
 * The renderer-side script: wait for the first index to land, refuse to go on
 * if any folder lies outside the demo home, then open the showcase the way a
 * person would. No backticks in here — they would close the template.
 */
function drive(folder, title, home) {
  return `(async () => {
    const FOLDER = ${JSON.stringify(folder)};
    const TITLE = ${JSON.stringify(title)};
    const HOME = ${JSON.stringify(home)};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test) => {
      for (let i = 0; i < 300; i++) {
        const value = test();
        if (value) return value;
        await sleep(50);
      }
      return null;
    };
    const tree = document.getElementById('tree');
    const folderButtons = () => [...tree.querySelectorAll('.folder-btn')];
    const pathOf = (button) => button.title.split('\\n')[0];

    // The tree fills in once the first index is built; the demo folder is the last word.
    const target = await until(() => folderButtons().find((b) => pathOf(b) === FOLDER));
    if (!target) return { error: 'the demo folder never appeared' };

    // The whole point: not one real folder may be on screen.
    const strays = folderButtons().map(pathOf).filter((p) => !p.startsWith(HOME + '/'));
    if (strays.length) return { error: 'hors de la démo : ' + strays.join(', ') };

    target.click();
    const session = await until(() =>
      [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes(TITLE)));
    if (!session) return { error: 'the showcase conversation is not listed' };
    session.click();

    const transcript = document.getElementById('transcript');
    if (!(await until(() => transcript.querySelector('.msg')))) return { error: 'nothing rendered' };
    transcript.scrollTop = 0;
    if (document.activeElement) document.activeElement.blur();

    // The indexing toast would sit over the transcript.
    await until(() => document.getElementById('toast').hidden);
    await sleep(400);
    return { folders: folderButtons().length };
  })()`;
}
