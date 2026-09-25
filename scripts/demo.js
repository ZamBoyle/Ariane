'use strict';

/**
 * Launch Ariane on the demo corpus — the real app, not a mock.
 *
 *   npm run demo                explore it; corpus and database are kept
 *   npm run demo -- --reset     rebuild them from nothing, with fresh dates
 *   npm run demo:capture        regenerate the README's screenshots in docs/, then quit
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
const { app, BrowserWindow, nativeTheme } = require('electron');

const { buildDemoCorpus, ensureDemoCorpus, SHOWCASE, DEMO_HOME } = require('./demo-corpus');

/** The screenshot's size: wide enough for the sidebar and a readable column. */
const CAPTURE_SIZE = { width: 1400, height: 880 };

/**
 * The README's screenshots, in the order they are taken: what each shows, and
 * in which theme — both appear, since both are designed. `step` names a
 * renderer script below; the first also checks that only the demo is on screen.
 */
const SHOTS = [
  { file: 'ariane.png', theme: 'dark', step: 'conversation' },
  { file: 'code.png', theme: 'light', step: 'tools' },
  { file: 'recherche.png', theme: 'dark', step: 'search' },
  { file: 'statistiques.png', theme: 'light', step: 'statistics' },
  { file: 'mois.png', theme: 'dark', step: 'months' },
];

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
  fs.mkdirSync(captureTo, { recursive: true });

  const steps = {
    conversation: drive(`${DEMO_HOME}/${SHOWCASE.folder}`, SHOWCASE.title, DEMO_HOME),
    tools: OPEN_TOOLS,
    statistics: OPEN_STATISTICS,
    months: MONTHS,
    search: SEARCH,
  };
  for (const shot of SHOTS) {
    nativeTheme.themeSource = shot.theme;
    const result = await win.webContents.executeJavaScript(steps[shot.step]);
    if (result.error) throw new Error(`capture refusée (${shot.file}) : ${result.error}`);
    const image = await win.webContents.capturePage();
    const file = path.join(captureTo, shot.file);
    fs.writeFileSync(file, image.toPNG());
    const { width, height } = image.getSize();
    console.log(
      `${file} — ${width}×${height}, ${shot.theme}${result.folders ? `, ${result.folders} dossiers, tous sous ${DEMO_HOME}` : ''}`
    );
  }
  app.quit();
}

/** Wait in the page for a condition, then let the paint settle. */
const WAIT = `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test) => {
      for (let i = 0; i < 300; i++) {
        const value = test();
        if (value) return value;
        await sleep(50);
      }
      return null;
    };`;

/**
 * The showcase's first strip of tool calls, unfolded: the command coloured,
 * its description on the folded line, and the error it returned.
 */
const OPEN_TOOLS = `(async () => {${WAIT}
    const transcript = document.getElementById('transcript');
    const strip = await until(() => [...transcript.querySelectorAll('.msg-toolrun > details')]
      .find((d) => d.querySelector('.fold-tag.error')));
    if (!strip) return { error: 'no strip of tool calls with an error' };
    strip.open = true;
    for (const fold of strip.querySelectorAll('.tool-run-body > details.fold')) fold.open = true;
    strip.closest('.msg').scrollIntoView({ block: 'center' });
    if (document.activeElement) document.activeElement.blur();
    await sleep(400);
    return {};
  })()`;

/** The statistics view, once it has counted. */
const OPEN_STATISTICS = `(async () => {${WAIT}
    if (window.__closeSearch) window.__closeSearch();
    await until(() => document.getElementById('results').hidden);
    document.getElementById('stats-open').click();
    const ready = await until(() => document.querySelector('#transcript .stats-view:not(.is-loading)'));
    if (!ready) return { error: 'the statistics never appeared' };
    document.getElementById('transcript').scrollTop = 0;
    if (document.activeElement) document.activeElement.blur();
    await sleep(500);
    return {};
  })()`;

/**
 * Further down the same view: month by month, then by assistant and by model.
 * Not the settings window, which would show where this machine keeps its CLIs.
 */
const MONTHS = `(async () => {${WAIT}
    const blocks = [...document.querySelectorAll('#transcript .stats-view .stats-block')];
    const months = blocks.find((b) => /mois|month/i.test(b.querySelector('h3').textContent));
    if (!months) return { error: 'no month-by-month block' };
    months.scrollIntoView({ block: 'start' });
    document.getElementById('transcript').scrollTop -= 16;
    await sleep(500);
    return {};
  })()`;

/** A search across every conversation, its words highlighted in the results. */
const SEARCH = `(async () => {${WAIT}
    const search = document.getElementById('search');
    search.focus();
    search.value = 'test';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const results = await until(() => {
      const panel = document.getElementById('results');
      return !panel.hidden && panel.querySelector('mark') && panel;
    });
    if (!results) return { error: 'no search results' };
    await sleep(500);
    // Closed again, so the statistics that follow are not covered.
    const closing = { error: null };
    closing.next = () => {
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.blur();
    };
    window.__closeSearch = closing.next;
    return {};
  })()`;

/**
 * The app's window — not the first one open: the splash screen opens before it,
 * and a capture of the splash has no folders to find.
 */
async function firstWindow() {
  for (let i = 0; i < 200; i++) {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/index.html')
    );
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
