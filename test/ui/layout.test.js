'use strict';

/**
 * Layout regression tests, run under Electron (`npm run test:ui`).
 *
 * These cannot live in the `node --test` suite: they assert on *computed* CSS
 * and real scroll geometry, which needs a rendering engine. They exist because
 * flex and grid items default to `min-height: auto` — "never shrink below my
 * content" — so a pane with `overflow-y: auto` silently stops scrolling and
 * overflows the window instead. Nothing in the JS tests can catch that.
 *
 * The window gets the render suite's stand-in for `window.api`
 * (mock-preload.js): the page holds no text of its own — every label comes from
 * a language file once the app has started — so measuring a page that never
 * started would measure empty buttons. Rows are then injected directly.
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const WINDOW = { width: 900, height: 480 }; // deliberately short: forces overflow
const INDEX = path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html');
const PRELOAD = path.join(__dirname, 'mock-preload.js');

const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
}

/** Runs in the renderer; returns plain measurements. */
const MEASURE = `(() => {
  const tree = document.getElementById('tree');
  const transcript = document.getElementById('transcript');

  // No conversation is open here, so the conversation header is hidden — and a
  // hidden element is not a grid item at all. This is the state the app starts
  // in and the one the home button returns to, so it is worth measuring.
  const results = document.getElementById('results');
  results.hidden = false;
  results.replaceChildren();
  for (let g = 0; g < 8; g++) {
    const head = document.createElement('div');
    head.className = 'results-group';
    head.textContent = '/un/dossier · Claude Code';
    results.append(head);
    for (let i = 0; i < 13; i++) {
      const row = document.createElement('button');
      row.className = 'result';
      row.type = 'button';
      row.textContent = 'un extrait de resultat, quelque part autour de quatre-vingts caracteres';
      results.append(row);
    }
  }

  const box = (sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
  };
  const composerBox = box('.composer');
  const resultsBox = box('#results');
  results.hidden = true;


  // Far more folders than a 480px window can show.
  tree.replaceChildren();
  for (let i = 0; i < 120; i++) {
    const row = document.createElement('div');
    row.className = 'folder';
    row.style.height = '44px';
    row.textContent = 'dossier ' + i;
    tree.append(row);
  }

  const para = document.createElement('p');
  para.style.height = '4000px';
  para.textContent = 'contenu long';
  // Un tableau bien plus large que la conversation, dans la structure exacte
  // d'un message : il doit défiler dans sa boîte, jamais élargir la page.
  const wide = document.createElement('article');
  wide.className = 'msg msg-assistant';
  const wideBody = document.createElement('div');
  wideBody.className = 'msg-body';
  const heads = Array.from({ length: 14 }, (_, i) => '<th>colonne_' + i + '_plutot_longue</th>').join('');
  wideBody.innerHTML = '<div class="table-wrap"><table><thead><tr>' + heads + '</tr></thead></table></div>';
  wide.append(wideBody);
  transcript.replaceChildren(wide, para);
  const tableWrap = wideBody.querySelector('.table-wrap');
  const wideTable = {
    wrapScroll: tableWrap.scrollWidth,
    wrapClient: tableWrap.clientWidth,
    wrapOverflowX: getComputedStyle(tableWrap).overflowX,
    bodyScroll: wideBody.scrollWidth,
    bodyClient: wideBody.clientWidth,
    transcriptScroll: transcript.scrollWidth,
    transcriptClient: transcript.clientWidth,
  };

  const measure = (el) => {
    const style = getComputedStyle(el);
    el.scrollTop = 99999;
    const reached = el.scrollTop;
    el.scrollTop = 0;
    return {
      overflowY: style.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      maxScrollTop: reached,
      bottom: Math.round(el.getBoundingClientRect().bottom),
    };
  };

  const scope = document.getElementById('scope');
  const scopeStyle = getComputedStyle(scope);
  const optionStyle = scope.options.length ? getComputedStyle(scope.options[0]) : null;

  return {
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    scopeColor: scopeStyle.color,
    optionBackground: optionStyle ? optionStyle.backgroundColor : '',
    optionColor: optionStyle ? optionStyle.color : '',
    viewportHeight: window.innerHeight,
    tree: measure(tree),
    transcript: measure(transcript),
    wideTable,
    composerBox,
    resultsBox,
    sidebarHeight: Math.round(document.querySelector('.sidebar').getBoundingClientRect().height),
    statsBottom: Math.round(document.querySelector('.sidebar-foot').getBoundingClientRect().bottom),
  };
})()`;

/**
 * Resize, then WAIT FOR THE PAGE TO AGREE. `setContentSize` is a request to the
 * window manager: a fixed pause after it measures whatever width happened to be
 * in place, and a hidden window under X11 can take well over 200 ms to grow —
 * shrinking is granted at once, growing is not. Poll until the page reports the
 * width asked for, and say so plainly if it never does.
 */
async function resizeTo(win, width, height) {
  win.setContentSize(width, height);
  const seen = await win.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      if (Math.abs(innerWidth - ${width}) <= 4) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // One more frame: the width is in, the layout that follows from it is not.
    await new Promise((r) => requestAnimationFrame(() => r()));
    return innerWidth;
  })()`);
  if (Math.abs(seen - width) > 4) {
    throw new Error(`la fenêtre est restée à ${seen} px au lieu de ${width} px`);
  }
}

async function run() {
  const win = new BrowserWindow({
    ...WINDOW,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the stand-in preload reads the language files
      partition: 'layout-test',
    },
  });

  await win.loadFile(INDEX);
  // Started: its words are on the page, and the folder list has been drawn.
  await win.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 80 && !document.querySelector('.folder-btn'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  })()`);
  const m = await win.webContents.executeJavaScript(MEASURE);

  // The conversation header with all six actions shown: at this narrow width
  // their labels must step aside, and nothing may overflow.
  const HEADER = `(() => {
    document.getElementById('convo-head').hidden = false;
    document.getElementById('convo-title').textContent = 'La réponse à la grande question';
    for (const id of ['resume', 'copy-cmd', 'open-folder', 'forget']) document.getElementById(id).hidden = false;
    const convoId = document.getElementById('convo-id');
    convoId.hidden = false;
    convoId.textContent = 'c9e63dac-5513-42fa-9e27-04175df3fdc5';
    const head = document.getElementById('convo-head');
    const labels = [...head.querySelectorAll('.convo-actions .ghost-btn .label')];
    return {
      overflow: head.scrollWidth > head.clientWidth + 1,
      labelsShown: labels.filter((l) => getComputedStyle(l).display !== 'none').length,
      labels: labels.length,
      title: Math.round(document.querySelector('.convo-titles').getBoundingClientRect().width),
      window: innerWidth,
      head: Math.round(head.getBoundingClientRect().width),
      idWhole: convoId.scrollWidth <= convoId.clientWidth + 1,
      // Its own row, across the header — not a column the buttons can narrow.
      idAcross: Math.abs(convoId.getBoundingClientRect().width - (head.clientWidth
        - parseFloat(getComputedStyle(head).paddingLeft) - parseFloat(getComputedStyle(head).paddingRight))) < 2,
    };
  })()`;
  // The facts under the title, with a folder name far too long for the window,
  // built as the app builds them: groups wrap whole, and one still too long on
  // a line of its own ends in "…" — it never runs out of the header. That last
  // part failed on macOS and Windows only, whose fonts are wider (d4b2b62).
  const META = `(() => {
    document.getElementById('convo-head').hidden = false;
    const meta = document.getElementById('convo-meta');
    const group = (cls, text) => {
      const g = document.createElement('span');
      g.className = 'meta-group ' + cls;
      const t = document.createElement('span');
      t.textContent = text;
      g.append(t);
      return g;
    };
    const row = document.createElement('span');
    row.className = 'meta-row';
    row.append(group('meta-who', 'Claude claude-opus-5, claude-opus-5-5 et gpt-6-astra'), ' ',
      group('meta-where', 'un-dossier-au-nom-vraiment-très-long-pour-une-fenêtre-étroite'.repeat(3)), ' ',
      group('meta-when', '25 sept. 2026, 18:29'), ' ', group('meta-size', '7 484 messages'));
    const cost = document.createElement('span');
    cost.className = 'meta-row meta-cost-row';
    cost.textContent = '↑ 11,1M envoyés · ↓ 2,2M reçus · 1,1G relus depuis le cache';
    meta.replaceChildren(row, cost);
    const groups = [...meta.querySelectorAll('.meta-group')];
    const box = (el) => el.getBoundingClientRect();
    const others = groups.filter((g) => !g.classList.contains('meta-where'));
    return {
      inside: groups.every((g) => box(g).right <= box(meta).right + 1) && meta.scrollWidth <= meta.clientWidth + 1,
      othersWhole: others.every((g) => g.scrollWidth <= g.clientWidth + 1),
      wrapped: new Set(groups.map((g) => Math.round(box(g).top))).size > 1,
      costWhole: cost.scrollWidth <= cost.clientWidth + 1,
    };
  })()`;
  // The search bar with both lists at their widest real labels.
  const COMPOSER = `(() => {
    const fill = (id, labels) => {
      const select = document.getElementById(id);
      select.replaceChildren(...labels.map((label) => {
        const option = document.createElement('option');
        option.textContent = label;
        return option;
      }));
      select.selectedIndex = labels.length - 1;
    };
    fill('scope', ['Partout', 'Dossier : claudechatbrowser']);
    fill('period', ['Toutes les dates', '30 derniers jours']);
    const top = (el) => Math.round(el.getBoundingClientRect().top);
    return {
      field: Math.round(document.getElementById('search').getBoundingClientRect().width),
      oneLine: top(document.getElementById('scope')) === top(document.getElementById('period'))
        && Math.abs(top(document.getElementById('search')) - top(document.getElementById('scope'))) < 8,
    };
  })()`;

  /**
   * The same header in another language. German writes "Fortsetzen (letzte)"
   * where French writes "Reprendre (dernière)", and a label that overflows
   * pushes the conversation's title off its own header.
   */
  async function headerIn(lang) {
    const other = new BrowserWindow({
      width: 1400,
      height: 800,
      show: false,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        partition: `layout-${lang}`,
      },
    });
    await other.loadFile(INDEX, { query: { lang } });
    await other.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 80 && !document.querySelector('.folder-btn'); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
    })()`);
    // La taille demandée au constructeur n'est pas une taille obtenue : sous
    // macOS une fenêtre `show: false` n'a pas encore la sienne au moment où la
    // page répond, et les trois en-têtes traduits se mesuraient alors à la
    // largeur d'une fenêtre étroite — 0 libellé sur 6, alors que le même
    // en-tête en français en affichait 6 sur 6 deux lignes plus bas. `resizeTo`
    // attend que `innerWidth` y soit vraiment, et lève s'il n'y arrive pas.
    await resizeTo(other, 1400, 800);
    const wide = await other.webContents.executeJavaScript(HEADER);
    await resizeTo(other, 900, 480);
    const tight = await other.webContents.executeJavaScript(HEADER);
    other.destroy();
    return { wide, tight };
  }

  const narrow = await win.webContents.executeJavaScript(HEADER);
  const narrowMeta = await win.webContents.executeJavaScript(META);
  const narrowComposer = await win.webContents.executeJavaScript(COMPOSER);
  await resizeTo(win, 780, 480); // the window's minimum width (main.js)
  const narrowest = await win.webContents.executeJavaScript(COMPOSER);

  // The settings window, five assistants long, in the smallest window allowed:
  // it must fit, keep its buttons in view, and scroll its list instead.
  const SETTINGS = `(() => {
    const dialog = document.getElementById('settings-dialog');
    const rows = dialog.querySelector('.settings-rows');
    rows.replaceChildren();
    for (let i = 0; i < 5; i++) {
      const row = document.createElement('section');
      row.className = 'settings-row';
      row.innerHTML = '<div class="settings-row-head"><span class="agent-chip">Codex</span></div>'
        + '<p class="settings-detected">Trouvé : /home/ada/.nvm/versions/node/v22.12.0/bin/codex</p>'
        + '<label class="settings-label">Chemin imposé</label>'
        + '<div class="settings-field"><input class="settings-input"><button class="ghost-btn">Parcourir…</button></div>'
        + '<p class="settings-check">Ariane utilisera : /home/ada/.nvm/versions/node/v22.12.0/bin/codex</p>';
      rows.append(row);
    }
    dialog.showModal();
    const box = dialog.getBoundingClientRect();
    const save = dialog.querySelector('.settings-save').getBoundingClientRect();
    rows.scrollTop = 99999;
    const scrolled = rows.scrollTop;
    dialog.close();
    return {
      top: Math.round(box.top), bottom: Math.round(box.bottom), height: innerHeight,
      saveVisible: save.bottom <= innerHeight && save.top >= 0, scrolled,
    };
  })()`;
  const settingsBox = await win.webContents.executeJavaScript(SETTINGS);
  await resizeTo(win, 1400, 800);
  const wide = await win.webContents.executeJavaScript(HEADER);
  const others = {};
  for (const lang of ['de', 'ja', 'nl']) others[lang] = await headerIn(lang);
  const wideComposer = await win.webContents.executeJavaScript(COMPOSER);

  // The window is painted before the page exists — main.js therefore carries
  // the two backgrounds itself, and they have to be the stylesheet's own. Read
  // here from the real engine, one palette then the other.
  const palette = await win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const was = root.dataset.theme;
    const bg = () => getComputedStyle(root).getPropertyValue('--bg').trim().toLowerCase();
    root.dataset.theme = 'light';
    const light = bg();
    root.dataset.theme = 'dark';
    const dark = bg();
    root.dataset.theme = was;
    return { light, dark };
  })()`);
  // Every tone text is written in, on every surface it sits on, both themes.
  const tones = await win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const was = root.dataset.theme;
    const read = () => Object.fromEntries(['--text', '--text-soft', '--text-faint', '--accent', '--user',
      '--bg', '--bg-sidebar', '--bg-panel'].map((k) => [k, getComputedStyle(root).getPropertyValue(k).trim()]));
    root.dataset.theme = 'light';
    const light = read();
    root.dataset.theme = 'dark';
    const dark = read();
    root.dataset.theme = was;
    return { light, dark };
  })()`);
  const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8');
  const declared = /const BACKGROUND = \{ dark: '(#[0-9a-fA-F]{6})', light: '(#[0-9a-fA-F]{6})' \};/.exec(mainSource);

  // -- the settings window, in the smallest window -----------------------------
  check('the settings window fits a small window, buttons in view, its list scrolling',
    settingsBox.top >= 0 && settingsBox.bottom <= settingsBox.height && settingsBox.saveVisible
      && settingsBox.scrolled > 0,
    JSON.stringify(settingsBox));

  // -- the search bar: room to type, whatever the width ---------------------
  check('beside the scope and the period, a narrow window still leaves room to type',
    narrowComposer.field >= 200 && narrowest.field >= 200,
    `900px: ${narrowComposer.field}px, 780px: ${narrowest.field}px`);
  check('a wide window keeps the search bar on one line',
    wideComposer.oneLine && wideComposer.field >= 300, JSON.stringify(wideComposer));

  // -- the conversation header: icons, and labels when there is room -------
  check('the facts under the title wrap by whole groups and never run out of the header',
    narrowMeta.inside && narrowMeta.othersWhole && narrowMeta.wrapped && narrowMeta.costWhole,
    JSON.stringify(narrowMeta));

  check('a narrow header keeps its actions on one line, icons alone',
    !narrow.overflow && narrow.labels > 0 && narrow.labelsShown === 0 && narrow.title > 100,
    `débordement=${narrow.overflow}, libellés affichés ${narrow.labelsShown}/${narrow.labels}, titre ${narrow.title} px`);
  for (const [lang, header] of Object.entries(others)) {
    check(`a header in ${lang} holds its labels, and steps aside when narrow`,
      !header.wide.overflow && header.wide.labelsShown === header.wide.labels && header.wide.title > 200
        && !header.tight.overflow && header.tight.labelsShown === 0 && header.tight.title > 100,
      `large: débordement=${header.wide.overflow} libellés=${header.wide.labelsShown}/${header.wide.labels} titre=${header.wide.title}px`
        + ` · étroit: débordement=${header.tight.overflow} libellés=${header.tight.labelsShown} titre=${header.tight.title}px`);
  }

  // Wide, the labelled buttons leave the title column narrowest: 260 px in the
  // real app, where the id was cut before it got a row of its own.
  check('the conversation id at the top stays whole, narrow header or wide',
    narrow.idWhole && wide.idWhole && narrow.idAcross && wide.idAcross,
    JSON.stringify({ narrow: [narrow.idWhole, narrow.idAcross], wide: [wide.idWhole, wide.idAcross] }));
  // Choice A, 25 September 2026: the labels stay, the facts under the title
  // take three lines — C, icons alone, put too much on one.
  check('a wide header shows each label beside its icon',
    !wide.overflow && wide.labelsShown === wide.labels,
    `libellés affichés ${wide.labelsShown}/${wide.labels}, fenêtre ${wide.window}px, en-tête ${wide.head}px`);

  // -- the search bar, with no conversation open ---------------------------
  // `grid-template-rows: auto 1fr auto` assumed three items. With the header
  // hidden only two remained, so `1fr` fell to the COMPOSER: the search bar
  // climbed to the top of the window and the results, anchored to its height,
  // flew off the top of the screen.
  check(
    'the search bar stays at the bottom when no conversation is open',
    m.composerBox.bottom <= m.viewportHeight + 1 && m.composerBox.top > m.viewportHeight / 2,
    `composer ${m.composerBox.top}..${m.composerBox.bottom} of ${m.viewportHeight}`
  );
  check(
    'the search bar takes the height of its content, not the whole window',
    m.composerBox.height < 160,
    `${m.composerBox.height}px`
  );
  check(
    'a full result list never runs off the top of the screen',
    m.resultsBox.top >= 0,
    `results top ${m.resultsBox.top}`
  );
  check(
    'the results sit just above the search bar',
    Math.abs(m.resultsBox.bottom - m.composerBox.top) < 20,
    `results bottom ${m.resultsBox.bottom} vs composer top ${m.composerBox.top}`
  );

  // -- the sidebar list ----------------------------------------------------
  check('tree declares overflow-y: auto', m.tree.overflowY === 'auto', m.tree.overflowY);
  check(
    'tree is bounded by the window, not by its content',
    m.tree.clientHeight < m.tree.scrollHeight,
    `client ${m.tree.clientHeight} < scroll ${m.tree.scrollHeight}`
  );
  check(
    'tree actually scrolls',
    m.tree.maxScrollTop > 0,
    `maxScrollTop ${m.tree.maxScrollTop}`
  );
  // A rounded rect against an integer viewport: Electron 44 lays the sidebar
  // half a pixel lower than 33 did, which reads as 485 against 484. Same
  // tolerance as the two neighbouring checks; the overflow guarded against
  // here is measured in thousands of pixels, not in one.
  check(
    'sidebar does not exceed the viewport',
    m.sidebarHeight <= m.viewportHeight + 1,
    `sidebar ${m.sidebarHeight} <= viewport ${m.viewportHeight}`
  );
  check(
    'the stats footer stays visible at the bottom',
    m.statsBottom <= m.viewportHeight + 1,
    `footer bottom ${m.statsBottom} <= ${m.viewportHeight}`
  );

  // -- native widgets ------------------------------------------------------
  // The <select> popup is drawn by the OS; color-scheme is what makes it follow
  // the theme instead of appearing as white-on-white.
  check('the document declares a colour scheme',
    /light|dark/.test(m.colorScheme), m.colorScheme);
  check('scope options carry an explicit background',
    m.optionBackground !== '' && m.optionBackground !== 'rgba(0, 0, 0, 0)', m.optionBackground);
  check('scope options carry an explicit colour', m.optionColor !== '', m.optionColor);
  // Translucency here is composited by the OS against its own highlight, which
  // is what turned the selected option pink on a hover.
  check('scope option colours are fully opaque',
    !/rgba\([^)]*,\s*0?\.\d+\s*\)/.test(m.optionBackground)
      && !/rgba\([^)]*,\s*0?\.\d+\s*\)/.test(m.optionColor),
    `${m.optionBackground} / ${m.optionColor}`);

  // -- the reading pane ----------------------------------------------------
  check('transcript declares overflow-y: auto', m.transcript.overflowY === 'auto', m.transcript.overflowY);
  check(
    'transcript is bounded by its grid row',
    m.transcript.clientHeight < m.transcript.scrollHeight,
    `client ${m.transcript.clientHeight} < scroll ${m.transcript.scrollHeight}`
  );
  check('transcript actually scrolls', m.transcript.maxScrollTop > 0, `maxScrollTop ${m.transcript.maxScrollTop}`);

  // -- un tableau large défile dans sa boîte ---------------------------------
  const t = m.wideTable;
  check('a wide table scrolls inside its own box',
    t.wrapOverflowX === 'auto' && t.wrapScroll > t.wrapClient,
    `overflow-x ${t.wrapOverflowX}, ${t.wrapScroll} dans ${t.wrapClient}`);
  check('and neither the message nor the conversation grows sideways',
    t.bodyScroll <= t.bodyClient && t.transcriptScroll <= t.transcriptClient,
    `message ${t.bodyScroll}/${t.bodyClient}, conversation ${t.transcriptScroll}/${t.transcriptClient}`);

  // -- the window's own background, which no stylesheet can fix -------------
  check('main.js states its two backgrounds where this test can read them',
    Boolean(declared), 'const BACKGROUND = { dark: ..., light: ... } sur une ligne');
  // WCAG 2 contrast: small text needs 4.5:1. "Les textes sont sombres" was
  // measured, not felt — the faint tone read 2.7:1 in light, 3.4:1 in dark.
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const [theme, t] of Object.entries(tones)) {
    const weak = [];
    for (const tone of ['--text', '--text-soft', '--text-faint', '--accent', '--user']) {
      for (const surface of ['--bg', '--bg-sidebar', '--bg-panel']) {
        const r = contrast(t[tone], t[surface]);
        if (!(r >= 4.5)) weak.push(`${tone} sur ${surface} ${r.toFixed(2)}`);
      }
    }
    const [text, soft, faint] = ['--text', '--text-soft', '--text-faint'].map((k) => contrast(t[k], t['--bg']));
    check(`every text tone reads at 4.5:1 or more on every surface, ${theme}`,
      weak.length === 0 && text > soft && soft > faint,
      weak.length ? weak.join(', ') : `texte ${text.toFixed(1)} > doux ${soft.toFixed(1)} > pâle ${faint.toFixed(1)}`);
  }

  check('the window background is the stylesheet\'s, in both themes',
    declared && declared[1].toLowerCase() === palette.dark && declared[2].toLowerCase() === palette.light,
    declared ? `main.js ${declared[2]}/${declared[1]} vs css ${palette.light}/${palette.dark}` : 'non déclaré');

  win.destroy();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(`\n# layout checks ${results.length} | pass ${results.length - failed.length} | fail ${failed.length}`);
  return failed.length === 0 ? 0 : 1;
}

app.whenReady()
  .then(run)
  .then((code) => app.exit(code))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
