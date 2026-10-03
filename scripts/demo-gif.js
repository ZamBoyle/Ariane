'use strict';

/**
 * Record the README's animation from the demo corpus — the real app, driven
 * the way a person would, a frame every ~120 ms.
 *
 *   npm run demo:gif          writes docs/ariane.gif
 *
 * The window is captured from the main process (`capturePage`), so nothing of
 * the desktop is on it; the pointer is not either, which is why a click is
 * drawn: the button lights up for a moment before it is pressed. The frames go
 * to a temp directory with the instant each was taken, and ffmpeg turns them
 * into a GIF with its own palette — a flat 1 000-px window dithers badly with
 * the default one.
 *
 * Like demo.js, it builds a fresh corpus in one fixed temp directory and never
 * touches the real index. The interface is English: the README GitHub renders.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, BrowserWindow, nativeTheme } = require('electron');

const { buildDemoCorpus, SHOWCASE, DEMO_HOME } = require('./demo-corpus');

const SIZE = { width: 1280, height: 760 };
const OUTPUT_WIDTH = 960;
const FRAME_MS = 110;
const target = path.resolve(
  (process.argv.find((a) => a.startsWith('--out=')) || '--out=docs/ariane.gif').slice(
    '--out='.length
  )
);

const ROOT = path.join(os.tmpdir(), 'ariane-demo-gif');
fs.rmSync(ROOT, { recursive: true, force: true });
const { env } = buildDemoCorpus(ROOT);
Object.assign(process.env, env);
app.setPath('userData', path.join(ROOT, 'user-data'));
// The language the person chose, not the system's: the same file the settings write.
fs.mkdirSync(path.join(ROOT, 'user-data'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'user-data', 'settings.json'),
  JSON.stringify({ language: 'en', theme: 'dark', updateCheck: 'never' })
);

require('../src/main/main');
app
  .whenReady()
  .then(record)
  .catch((error) => {
    console.error(error.message || error);
    app.exit(1);
  });

async function appWindow() {
  for (let i = 0; i < 300; i++) {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('/index.html')
    );
    if (win && !win.webContents.isLoading()) return win;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('no window appeared');
}

/** Everything the page does, as one script: it returns when the scene is over. */
const SCENE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test) => {
    for (let i = 0; i < 300; i++) { const v = test(); if (v) return v; await sleep(50); }
    return null;
  };
  const FOLDER = ${JSON.stringify(`${DEMO_HOME}/${SHOWCASE.folder}`)};
  const style = document.createElement('style');
  style.textContent = '.__press { background: var(--accent) !important; color: #fff !important; border-color: var(--accent) !important; }';
  document.head.append(style);
  const press = async (button) => {
    button.classList.add('__press');
    await sleep(260);
    button.click();
    await sleep(140);
    button.classList.remove('__press');
  };
  const tree = document.getElementById('tree');
  const pathOf = (b) => b.title.split('\\n')[0];

  // 1. The sidebar: several assistants, one list.
  const folder = [...tree.querySelectorAll('.folder-btn')].find((b) => pathOf(b) === FOLDER);
  await sleep(1200);
  await press(folder);
  await sleep(900);

  // 2. A search across every assistant, its word highlighted.
  const search = document.getElementById('search');
  search.focus();
  for (const word of ['test']) {
    for (let i = 1; i <= word.length; i++) {
      search.value = word.slice(0, i);
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(140);
    }
  }
  const results = await until(() => { const p = document.getElementById('results'); return !p.hidden && p.querySelector('mark') && p; });
  if (!results) return { error: 'no search results' };
  await sleep(1500);

  // 3. A result of the showcase: the conversation opens on the very message.
  const hit = [...results.querySelectorAll('.result')].find((r) => r.textContent.includes(${JSON.stringify(SHOWCASE.title)}));
  if (!hit) return { error: 'the showcase is not among the results' };
  await press(hit);
  await until(() => document.querySelector('#transcript .msg mark.search-hit'));
  await sleep(1500);

  // 4. The header, then the arrows: from one compaction to the next.
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  search.blur();
  await until(() => document.getElementById('results').hidden);
  const transcript = document.getElementById('transcript');
  transcript.scrollTop = 0;
  await sleep(1800);
  const step = (n) => document.querySelector('#convo-meta .compaction-step[data-step="' + n + '"]');
  if (!step(-1)) return { error: 'no compaction arrows' };
  await press(step(-1));
  await sleep(1500);
  await press(step(-1));
  await sleep(1500);
  await press(step(1));
  await sleep(1800);
  return {};
})()`;

/** Nothing is filmed before the first index has landed and its toast is gone. */
const READY = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const FOLDER = ${JSON.stringify(`${DEMO_HOME}/${SHOWCASE.folder}`)};
  for (let i = 0; i < 400; i++) {
    const found = [...document.querySelectorAll('#tree .folder-btn')].some((b) => b.title.split('\\n')[0] === FOLDER);
    if (found && document.getElementById('toast').hidden) return true;
    await sleep(50);
  }
  return false;
})()`;

async function record() {
  const win = await appWindow();
  nativeTheme.themeSource = 'dark';
  win.setContentSize(SIZE.width, SIZE.height);
  if (!(await win.webContents.executeJavaScript(READY)))
    throw new Error('the demo never finished indexing');
  await new Promise((r) => setTimeout(r, 300));

  const frames = path.join(ROOT, 'frames');
  fs.mkdirSync(frames, { recursive: true });
  const taken = [];
  let recording = true;
  const camera = (async () => {
    const t0 = Date.now();
    while (recording) {
      const started = Date.now();
      const image = await win.webContents.capturePage();
      const file = path.join(frames, `f${String(taken.length).padStart(5, '0')}.png`);
      fs.writeFileSync(file, image.toPNG());
      taken.push({ file, at: started - t0 });
      const wait = FRAME_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  })();

  const result = await win.webContents.executeJavaScript(SCENE);
  recording = false;
  await camera;
  if (result.error) throw new Error(`scene refused: ${result.error}`);

  // Real durations: a slow capture must not speed the film up.
  const list = taken
    .map((f, i) => {
      const next = i + 1 < taken.length ? taken[i + 1].at : f.at + FRAME_MS;
      return `file '${f.file}'\nduration ${((next - f.at) / 1000).toFixed(3)}`;
    })
    .join('\n');
  const concat = path.join(ROOT, 'frames.txt');
  fs.writeFileSync(concat, `${list}\nfile '${taken[taken.length - 1].file}'\n`);

  const filter = `fps=10,scale=${OUTPUT_WIDTH}:-1:flags=lanczos`;
  const palette = path.join(ROOT, 'palette.png');
  const run = (args) => {
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  };
  run([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat,
    '-vf',
    `${filter},palettegen=max_colors=128:stats_mode=diff`,
    palette,
  ]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  run([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat,
    '-i',
    palette,
    '-lavfi',
    `${filter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop',
    '0',
    target,
  ]);
  const size = fs.statSync(target).size;
  console.log(`${target} — ${taken.length} images, ${(size / 1048576).toFixed(2)} Mo`);
  app.quit();
}
