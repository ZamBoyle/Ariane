'use strict';

/**
 * Rendering tests, run under Electron (`npm run test:render`).
 *
 * These drive the REAL renderer against a mocked `window.api` (see
 * mock-preload.js). That matters: the attribution bug this file guards against
 * lived in app.js, not in the pure helper it calls, so a unit test of
 * `speakerOf()` passed while the UI still credited the user with the output of
 * `git status`. Only a test that actually renders can catch that class of bug.
 */

const path = require('path');
const { app, BrowserWindow } = require('electron');

const INDEX = path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html');
const PRELOAD = path.join(__dirname, 'mock-preload.js');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

/** Drive the app the way a person would, then describe the resulting DOM. */
const SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tree = document.getElementById('tree');

  // Wait for the initial load to paint the folder list.
  for (let i = 0; i < 60 && !tree.querySelector('.folder-btn'); i++) await sleep(50);
  const folderButton = tree.querySelector('.folder-btn');
  if (!folderButton) return { error: 'no folder rendered' };

  folderButton.click();
  for (let i = 0; i < 60 && !tree.querySelector('.session-btn'); i++) await sleep(50);
  // Pick the session by name: the first button belongs to whichever agent is
  // busiest, which is not what these assertions are about.
  const sessionButton = [...tree.querySelectorAll('.session-btn')]
    .find((b) => b.textContent.includes('Session de test'));
  if (!sessionButton) return { error: 'the Claude session was not rendered' };

  // Looked up now, not before the click: renderTree replaces the whole tree, so
  // a node captured earlier is detached and answers nothing.
  const firstFolder = tree.querySelector('.folder');

  // What the sidebar shows once a folder holding two agents is open: ONE list,
  // newest first, each row carrying its own mark.
  const sessionRows = [...firstFolder.querySelectorAll('.sessions .session-btn')].map((b) => {
    const dot = b.querySelector('.agent-dot');
    const tokens = b.querySelector('.session-cost');
    const model = b.querySelector('.session-model');
    return {
      agent: dot ? dot.dataset.agent : '',
      title: b.textContent,
      tokens: tokens ? tokens.textContent : null,
      tokensTitle: tokens ? tokens.title : null,
      model: model ? model.textContent : null,
      modelTitle: model ? model.title : null,
      line: b.querySelector('.session-tokens') ? b.querySelector('.session-tokens').textContent : null,
    };
  });
  const sessionLists = firstFolder.querySelectorAll('.sessions').length;
  // Celles du dossier seulement : depuis que chaque conversation porte la
  // sienne, un querySelectorAll large ramasserait les deux.
  const folderDots = [...firstFolder.querySelectorAll('.agent-marks .agent-dot')].map((d) => d.dataset.agent);

  sessionButton.click();
  const transcript = document.getElementById('transcript');
  for (let i = 0; i < 60 && !transcript.querySelector('.msg'); i++) await sleep(50);

  const rows = [...transcript.querySelectorAll('.msg')];
  // Every row must sit in the SAME centred column; a stray margin-left breaks it.
  const lefts = rows.map((el) => Math.round(el.getBoundingClientRect().left));
  const toolRuns = [...transcript.querySelectorAll('.msg-toolrun')].map((el) => ({
    summary: el.querySelector('summary').textContent,
    inner: el.querySelectorAll('.tool-run-body > details.fold').length,
    speaker: el.querySelector('.who') ? el.querySelector('.who').textContent : null,
  }));

  const messages = rows.map((el) => ({
    id: el.dataset.messageId,
    speaker: el.querySelector('.who') ? el.querySelector('.who').textContent : null,
    unattributed: el.classList.contains('msg-unattributed'),
    notice: el.classList.contains('msg-notice'),
    folds: [...el.querySelectorAll('details.fold > summary')].map((s) => s.textContent.trim()),
    html: el.querySelector('.msg-body') ? el.querySelector('.msg-body').innerHTML : '',
  }));

  // Search: type into the composer and let the debounce fire.
  const search = document.getElementById('search');
  search.value = 'terme';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(400);
  const resultsPanel = document.getElementById('results');

  // Capture the unscoped results BEFORE narrowing, or the assertions below
  // would describe the filtered list instead.
  const searchMarks = resultsPanel.querySelectorAll('mark').length;
  const searchGroups = [...resultsPanel.querySelectorAll('.results-group')].map((g) => g.textContent);
  const searchVisible = !resultsPanel.hidden;

  // The button must name the command it will run: it starts a process.
  const resumeButton = document.getElementById('resume');
  const resumeState = {
    hidden: resumeButton.hidden,
    label: resumeButton.textContent,
    title: resumeButton.title,
    copyHidden: document.getElementById('copy-cmd').hidden,
  };

  const claudeChrome = {
    title: document.getElementById('convo-title').textContent,
    meta: document.getElementById('convo-meta').textContent,
    modelLabels: transcript.querySelectorAll('.msg-model').length,
  };

  // Open a session belonging to ANOTHER agent and read back who it credits.
  const codexButton = [...tree.querySelectorAll('.session-btn')]
    .find((b) => b.textContent.includes('Session Codex A'));
  let otherAgent = { error: 'no codex session rendered' };
  if (codexButton) {
    codexButton.click();
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      const who = transcript.querySelector('.msg-assistant .who');
      if (who) {
        otherAgent = {
          speaker: who.textContent,
          meta: document.getElementById('convo-meta').textContent,
          title: document.getElementById('convo-title').textContent,
          modelLabels: [...transcript.querySelectorAll('.msg-model')].map((m) => m.textContent),
        };
        break;
      }
    }
  }

  // Home: the pane comes back and the conversation is forgotten.
  document.getElementById('home').click();
  await sleep(200);
  const afterHome = {
    welcome: Boolean(transcript.querySelector('.welcome')),
    messages: transcript.querySelectorAll('.msg').length,
    headerHidden: document.getElementById('convo-head').hidden,
    scopeHasSession: [...document.getElementById('scope').options].some((o) => o.value === 'session'),
  };

  // And a conversation can be opened again afterwards.
  sessionButton.click();
  for (let i = 0; i < 60 && !transcript.querySelector('.msg'); i++) await sleep(50);
  const reopened = transcript.querySelectorAll('.msg').length;

  // A folder whose listing fails once, then succeeds. Caching the failure as an
  // empty list would leave it looking empty until the app was restarted.
  const fragileButton = [...tree.querySelectorAll('.folder-btn')]
    .find((b) => b.title.includes('fragile'));
  const afterFailure = {
    found: Boolean(fragileButton),
    expanded: null,
    sessions: null,
    // A path nobody could confirm must say so rather than read as a record.
    approx: fragileButton ? fragileButton.closest('.folder').classList.contains('approx') : null,
    approxTitle: fragileButton ? fragileButton.title : '',
    exactApprox: firstFolder.classList.contains('approx'),
  };
  if (fragileButton) {
    fragileButton.click();
    await sleep(300);
    // The failed expansion collapses the folder rather than showing it empty.
    afterFailure.expanded =
      tree.querySelector('.folder-btn[title*="fragile"]').getAttribute('aria-expanded');

    tree.querySelector('.folder-btn[title*="fragile"]').click();
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      const row = tree.querySelector('.folder-btn[title*="fragile"]').closest('.folder');
      if (row.querySelector('.session-btn')) break;
    }
    afterFailure.sessions = [
      ...tree.querySelector('.folder-btn[title*="fragile"]').closest('.folder')
        .querySelectorAll('.session-btn'),
    ].map((b) => b.textContent);
  }

  // A conversation with no title: the header names it as the sidebar does.
  const untitledButton = [...tree.querySelectorAll('.session-btn')]
    .find((b) => b.textContent.includes('une question sans titre'));
  let untitled = { found: Boolean(untitledButton) };
  if (untitledButton) {
    untitledButton.click();
    for (let i = 0; i < 60; i++) {
      await sleep(50);
      if (document.getElementById('convo-title').textContent.includes('sans titre')) break;
    }
    untitled = {
      found: true,
      title: document.getElementById('convo-title').textContent,
      metaText: document.getElementById('convo-meta').textContent,
      metaTitle: document.getElementById('convo-meta').title,
    };
  }

  // Two conversations asked for in quick succession. The first answers slowly,
  // so without a guard its messages land under the second one's title.
  window.mock.slowClaudeSession(true);
  sessionButton.click();
  await sleep(50);
  const codexAgain = [...tree.querySelectorAll('.session-btn')]
    .find((b) => b.textContent.includes('Session Codex A'));
  codexAgain.click();
  await sleep(700);
  window.mock.slowClaudeSession(false);
  const afterRace = {
    title: document.getElementById('convo-title').textContent,
    speaker: transcript.querySelector('.msg-assistant .who')
      ? transcript.querySelector('.msg-assistant .who').textContent : null,
    texts: [...transcript.querySelectorAll('.msg-body')].map((b) => b.textContent).join(' | '),
  };

  const scope = document.getElementById('scope');
  const scopeOptions = [...scope.options].map((o) => ({ value: o.value, label: o.textContent }));

  // Narrow the scope to one agent and confirm the filter reaches the API.
  scope.value = 'agent:codex';
  scope.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(400);
  const scopedHits = document.getElementById('results').querySelectorAll('.result').length;

  // Searching by date: the period reaches the API, and an empty answer says why.
  const periodSelect = document.getElementById('period');
  const periodOptions = [...periodSelect.options].map((o) => o.value);
  const periodDefault = periodSelect.value;
  const searchBefore = search.value;
  search.value = 'terme';
  scope.value = 'all';
  scope.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300);
  const resultWhen = document.querySelector('#results .result-when');
  const periodResult = { text: resultWhen ? resultWhen.textContent : '', title: resultWhen ? resultWhen.title : '' };
  periodSelect.value = '7d';
  periodSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300);
  const periodEmpty = document.querySelector('#results .results-empty')?.textContent || '';
  const periodSent = window.mock.searchCalls().at(-1);
  periodSelect.value = 'all';
  periodSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300);
  const periodCleared = window.mock.searchCalls().at(-1);
  // Leave the search as the checks further down expect it.
  search.value = searchBefore;
  scope.value = 'agent:codex';
  scope.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300);

  // A pass nobody asked for: returning to the window, with a new conversation
  // on disk. The reader's place must survive it.
  const claudeAgain = [...tree.querySelectorAll('.session-btn')]
    .find((b) => b.textContent.includes('Session de test'));
  claudeAgain.click();
  for (let i = 0; i < 60 && !transcript.querySelector('.msg'); i++) await sleep(50);
  await sleep(200);
  transcript.querySelector('.msg').dataset.probe = 'avant';
  const toastBefore = document.getElementById('toast').textContent;

  window.mock.addSession();
  window.dispatchEvent(new Event('focus'));
  await sleep(700);

  const firstFolderRow = () => tree.querySelector('.folder');
  const afterAuto = {
    newListed: [...tree.querySelectorAll('.session-btn')]
      .some((b) => b.textContent.includes('Session arrivée pendant la lecture')),
    folderOpen: firstFolderRow().querySelector('.folder-btn').getAttribute('aria-expanded'),
    loading: firstFolderRow().textContent.includes('Chargement'),
    transcriptKept: Boolean(transcript.querySelector('[data-probe="avant"]')),
    quiet: window.mock.lastRefresh() && window.mock.lastRefresh().quiet,
    toast: document.getElementById('toast').textContent === toastBefore ? '' :
      document.getElementById('toast').textContent,
  };

  // Then a message arrives in the conversation being read, and the reader
  // refreshes by hand. Before, that left every open folder on "Chargement…".
  window.mock.addMessageToOpen();
  document.getElementById('refresh').click();
  await sleep(700);
  const afterManual = {
    liveShown: transcript.textContent.includes('message arrivé en direct'),
    folderOpen: firstFolderRow().querySelector('.folder-btn').getAttribute('aria-expanded'),
    loading: firstFolderRow().textContent.includes('Chargement'),
    listed: firstFolderRow().querySelectorAll('.session-btn').length,
  };

  // The reading order: by default the latest message at the top; each
  // conversation can be flipped to its first message, on its own.
  const order = document.getElementById('order');
  const rowIds = () => [...transcript.querySelectorAll('.msg')].map((m) => m.dataset.messageId);
  // Each strip of tool calls, by the message it starts with: flipping moves
  // the strips around, so "the first one on screen" is not the same strip.
  const stripInside = () => Object.fromEntries(
    [...transcript.querySelectorAll('.msg-toolrun')].map((strip) => [
      strip.dataset.messageId,
      [...strip.querySelectorAll('.tool-run-body > details.fold > summary')].map((x) => x.textContent.trim()),
    ]).sort(([a], [b]) => a.localeCompare(b)));
  const glyphOf = (button) => (button.querySelector('svg.icon') ? button.querySelector('svg.icon').dataset.icon : '');
  const byDefault = { ids: rowIds(), strip: stripInside(), label: order.textContent,
    pressed: order.getAttribute('aria-pressed'), glyph: glyphOf(order) };

  order.click();
  await sleep(150);
  const flipped = { ids: rowIds(), strip: stripInside(), label: order.textContent,
    pressed: order.getAttribute('aria-pressed'), top: transcript.scrollTop, glyph: glyphOf(order) };

  // The order belongs to the conversation: another one opens in the default
  // order — its latest message at the top — whatever was chosen here.
  [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes('Session Codex A')).click();
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    if (transcript.textContent.includes('reponse codex')) break;
  }
  const bodies = [...transcript.querySelectorAll('.msg-body')].map((b) => b.textContent);
  const otherConversation = {
    first: bodies[0] || '', last: bodies[bodies.length - 1] || '', label: order.textContent,
  };

  // Back on the Claude conversation: still flipped, because IT was.
  [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes('Session de test')).click();
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    if (transcript.querySelector('.msg') && order.textContent === 'Plus ancien en haut') break;
  }
  await sleep(200);
  const backOnFirst = { label: order.textContent, firstId: rowIds()[0] };

  // Flipped back to the default: a message arriving now belongs at the TOP.
  order.click();
  await sleep(150);
  const restored = { label: order.textContent, firstId: rowIds()[0] };
  window.mock.addMessageToOpen('le plus récent, en haut', 100);
  document.getElementById('refresh').click();
  await sleep(700);
  const liveOnTop = (transcript.querySelector('.msg .msg-body') || {}).textContent || '';

  // A saved conversation: its file is gone, and Ariane holds the only copy.
  const forget = document.getElementById('forget');
  const fragileRow = () => tree.querySelector('.folder-btn[title*="fragile"]').closest('.folder');
  const savedButton = () => [...fragileRow().querySelectorAll('.session-btn')]
    .find((b) => b.textContent.includes('Conversation sauvée'));
  const onLive = { forgetHidden: forget.hidden };

  savedButton().click();
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    if (document.getElementById('convo-title').textContent === 'Conversation sauvée') break;
  }
  await sleep(150);
  const onSaved = {
    badge: (savedButton().querySelector('.badge-saved') || {}).textContent || '',
    meta: document.getElementById('convo-meta').textContent,
    forgetHidden: forget.hidden,
  };

  forget.click();
  await sleep(100);
  const afterOneClick = {
    label: forget.textContent,
    calls: window.mock.forgotten().length,
    glyph: forget.querySelector('svg.icon') ? forget.querySelector('svg.icon').dataset.icon : '',
  };

  forget.click();
  await sleep(600);
  const afterTwoClicks = {
    calls: window.mock.forgotten(),
    stillListed: Boolean(savedButton()),
    welcome: Boolean(transcript.querySelector('.welcome')),
  };

  // A conversation of 2 000 rows. What the reader sees first is counted at the
  // very moment rows first appear — a MutationObserver callback runs before
  // any idle slice can — so nothing here depends on how fast the machine is.
  const firstBatch = () => new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      resolve({
        rows: transcript.querySelectorAll('.msg').length,
        deepHit: Boolean(transcript.querySelector('[data-message-id="100007"]')),
      });
    });
    observer.observe(transcript, { childList: true });
  });
  const rowsNow = () => transcript.querySelectorAll('.msg').length;

  const bigFolder = [...tree.querySelectorAll('.folder-btn')].find((b) => b.title.startsWith('/home/zam/grosse'));
  bigFolder.click();
  let bigButton = null;
  for (let i = 0; i < 60 && !bigButton; i++) {
    await sleep(50);
    bigButton = [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes('Très longue'));
  }
  let pending = firstBatch();
  bigButton.click();
  const opened = await pending;
  for (let i = 0; i < 200 && rowsNow() < 2000; i++) await sleep(50);
  const allRows = rowsNow();

  // The reader goes home while slices are still coming: none may land there.
  pending = firstBatch();
  bigButton.click();
  await pending;
  document.getElementById('home').click();
  await sleep(600);
  const homeDuringSlices = { rows: rowsNow(), welcome: Boolean(transcript.querySelector('.welcome')) };

  // A search hit at the far end of the display: painted up to, then shown.
  const scopeSelect = document.getElementById('scope');
  scopeSelect.value = 'all';
  scopeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  search.value = 'profond';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(400);
  pending = firstBatch();
  document.getElementById('results').querySelector('.result').click();
  const fromSearch = await pending;
  await sleep(900); // the smooth scroll
  const hitRow = transcript.querySelector('[data-message-id="100007"]');
  const pane = transcript.getBoundingClientRect();
  const box = hitRow ? hitRow.getBoundingClientRect() : null;
  const deep = {
    atFirstPaint: fromSearch.deepHit,
    highlighted: Boolean(hitRow && hitRow.classList.contains('is-hit')),
    inView: Boolean(box && box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1),
  };

  // A message arriving: its row is added, the 2 000 others are left alone.
  for (let i = 0; i < 200 && rowsNow() < 2000; i++) await sleep(50);
  transcript.querySelectorAll('.msg')[50].dataset.probe = 'long';
  window.mock.addBigMessage();
  document.getElementById('refresh').click();
  await sleep(700);
  const extended = {
    rows: rowsNow(),
    untouched: Boolean(transcript.querySelector('[data-probe="long"]')),
    top: (transcript.querySelector('.msg .msg-body') || {}).textContent || '',
  };

  // Finding in the open conversation (Ctrl+F). The long conversation is still
  // on screen from the step above; it is opened afresh, and the test waits for
  // that paint — opening a conversation closes the find bar, as it should.
  const findBar = document.getElementById('find');
  const findInput = document.getElementById('find-input');
  const findCount = () => document.getElementById('find-count').textContent;
  const hitId = () => (transcript.querySelector('.msg.is-hit') || { dataset: {} }).dataset.messageId;
  const press = (key, extra = {}) =>
    findInput.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
  const typeFind = async (text) => {
    findInput.value = text;
    findInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(350);
  };

  pending = firstBatch();
  bigButton.click();
  await pending;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  await sleep(50);
  const opens = { visible: !findBar.hidden, focused: document.activeElement === findInput };

  await typeFind('numero');
  const accents = {
    count: findCount(),
    mark: (transcript.querySelector('mark.find-hit') || {}).textContent || '',
    first: hitId(),
  };

  press('Enter', { shiftKey: true }); // previous from the first: the far end
  await sleep(100);
  const farRow = transcript.querySelector('.msg.is-hit');
  const farBox = farRow ? farRow.getBoundingClientRect() : null;
  const paneBox = transcript.getBoundingClientRect();
  const wrapped = {
    count: findCount(),
    id: hitId(),
    inView: Boolean(farBox && farBox.top >= paneBox.top - 1 && farBox.bottom <= paneBox.bottom + 1),
  };

  await typeFind('profond');
  const retyped = { count: findCount(), id: hitId() };

  press('Escape');
  await sleep(50);
  const escaped = {
    hidden: findBar.hidden,
    stillOpen: !document.getElementById('convo-head').hidden && !transcript.querySelector('.welcome'),
    marksLeft: transcript.querySelectorAll('mark.find-hit').length,
  };

  // A word INSIDE markup the message quotes — "alert" in <script>alert(1)…
  // Searching "script" would prove nothing: the marks would split the tag
  // name, and even markup-built marks could never re-form it.
  [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes('Session de test')).click();
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    if (document.getElementById('convo-title').textContent === 'Session de test') break;
  }
  await sleep(150);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  await typeFind('alert');
  const inert = {
    marks: [...transcript.querySelectorAll('mark.find-hit')].map((m) => m.textContent),
    liveScripts: transcript.querySelectorAll('script').length,
  };

  // The outline: one tick per message of the person's. On the small Claude
  // conversation, open now, the tool result and the harness notice recorded
  // under "user" must get none.
  const outline = document.getElementById('outline');
  const ticks = () => [...outline.querySelectorAll('.outline-tick')]
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
  const topRowId = () => {
    const paneTop = transcript.getBoundingClientRect().top + 4;
    const row = [...transcript.querySelectorAll('.msg')].find((m) => m.getBoundingClientRect().bottom > paneTop);
    return row ? row.dataset.messageId : null;
  };
  const altKey = (key) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true }));
  const smallTicks = ticks().map((t) => t.dataset.messageId).sort();

  pending = firstBatch();
  bigButton.click();
  await pending;
  const bigTicks = ticks();
  const onBig = { count: bigTicks.length, top: bigTicks[0] && bigTicks[0].dataset.messageId };
  // Measured while the outline is on screen: it shares the transcript's cell.
  const widths = {
    outlineShown: !outline.hidden,
    transcript: transcript.getBoundingClientRect().width,
    main: document.querySelector('.main').getBoundingClientRect().width,
  };

  bigTicks[bigTicks.length - 1].click(); // the oldest of the person's: the far end
  await sleep(100);
  // The oldest message is the LAST row: it cannot be scrolled to the top, so
  // what counts is that it is painted, on screen, and marked.
  const farTickRow = transcript.querySelector('[data-message-id="100000"]');
  const farBoxT = farTickRow ? farTickRow.getBoundingClientRect() : null;
  const paneT = transcript.getBoundingClientRect();
  const viaTick = {
    painted: Boolean(farTickRow),
    inView: Boolean(farBoxT && farBoxT.top >= paneT.top - 1 && farBoxT.bottom <= paneT.bottom + 1),
    target: Boolean(farTickRow && farTickRow.classList.contains('is-target')),
  };

  // At the very end, rows cannot reach the top of the pane: Alt+↑ must step
  // from the message just reached, not from whatever row the top shows.
  altKey('ArrowUp');
  await sleep(50);
  const nearEnd = (transcript.querySelector('.msg.is-target') || { dataset: {} }).dataset.messageId;

  transcript.scrollTop = 0;
  await sleep(50);
  altKey('ArrowDown');
  await sleep(50);
  const firstDown = topRowId();
  altKey('ArrowDown');
  await sleep(50);
  altKey('ArrowUp');
  await sleep(50);
  const viaKeys = { firstDown, backUp: topRowId() };

  document.getElementById('home').click();
  await sleep(100);
  const outlineOnHome = outline.hidden;

  // Exporting and copying. The welcome pane is showing: open a conversation.
  [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes('Session de test')).click();
  for (let i = 0; i < 60; i++) {
    await sleep(50);
    if (document.getElementById('convo-title').textContent === 'Session de test') break;
  }
  await sleep(150);
  const exportButton = document.getElementById('export');
  const exportMenu = document.getElementById('export-menu');
  const speaks = (button) => ({
    id: button.id || button.dataset.format || button.className,
    glyph: button.querySelector('svg.icon') ? button.querySelector('svg.icon').dataset.icon : '',
    name: button.getAttribute('aria-label') || button.textContent.trim(),
  });
  const buttons = [
    ...['favorite', 'note-toggle', 'order', 'export', 'resume', 'copy-cmd', 'open-folder', 'refresh', 'settings', 'find-prev', 'find-next', 'find-close']
      .map((id) => document.getElementById(id)),
    ...exportMenu.querySelectorAll('.menu-item'),
  ].map(speaks);
  const icons = {
    buttons,
    allHidden: [...document.querySelectorAll('svg.icon')].every((svg) => svg.getAttribute('aria-hidden') === 'true'),
    glyphs: document.querySelectorAll('.find-glyph, .composer-glyph').length,
  };

  exportButton.click();
  const menuOpen = {
    visible: !exportMenu.hidden,
    expanded: exportButton.getAttribute('aria-expanded'),
    items: [...exportMenu.querySelectorAll('.menu-item')].map((b) => b.textContent),
  };
  exportMenu.querySelector('[data-format="md"]').click();
  await sleep(150);
  const afterMd = { closed: exportMenu.hidden, toast: document.getElementById('toast').textContent };
  exportButton.click();
  exportMenu.querySelector('[data-format="pdf"]').click();
  await sleep(150);
  exportButton.click();
  document.body.click();
  const closesOutside = exportMenu.hidden;

  // Flipped to its first message, the conversation exports that way.
  document.getElementById('order').click();
  exportButton.click();
  exportMenu.querySelector('[data-format="md"]').click();
  await sleep(150);
  document.getElementById('order').click();

  const copyButton = transcript.querySelector('.msg-copy');
  const copyId = copyButton ? Number(copyButton.dataset.messageId) : null;
  if (copyButton) copyButton.click();
  await sleep(100);
  const copied = {
    id: copyId,
    calls: window.mock.copyCalls(),
    label: copyButton ? copyButton.getAttribute('aria-label') : '',
    glyph: copyButton && copyButton.querySelector('svg') ? copyButton.querySelector('svg').dataset.icon : '',
    onToolRuns: transcript.querySelectorAll('.msg-toolrun .msg-copy').length,
  };

  // A conversation a compaction cut in two: the app says which part this is,
  // and goes from one to the other.
  const partBar = document.getElementById('part');
  const openByName = async (name) => {
    [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes(name)).click();
    for (let i = 0; i < 60 && !transcript.querySelector('.msg'); i++) await sleep(50);
    await sleep(200);
  };
  await openByName('Session Codex A');
  const chainCheck = {
    first: { hidden: partBar.hidden, label: document.getElementById('part-label').textContent,
      previous: document.getElementById('part-previous').disabled,
      next: document.getElementById('part-next').disabled },
  };
  document.getElementById('part-next').click();
  for (let i = 0; i < 60 && document.getElementById('convo-title').textContent !== 'Session Codex B'; i++) await sleep(50);
  await sleep(250);
  chainCheck.second = { title: document.getElementById('convo-title').textContent,
    label: document.getElementById('part-label').textContent,
    previous: document.getElementById('part-previous').disabled,
    next: document.getElementById('part-next').disabled };

  // Ce qu'une reprise a recopié d'une autre : dit, et on y va.
  const originBar = document.getElementById('origin');
  const copiedCheck = {
    shown: !originBar.hidden,
    text: document.getElementById('origin-text').textContent,
    button: document.getElementById('origin-open').textContent,
  };
  document.getElementById('origin-open').click();
  for (let i = 0; i < 60 && document.getElementById('convo-title').textContent !== 'Session Codex A'; i++) await sleep(50);
  await sleep(200);
  copiedCheck.openedTitle = document.getElementById('convo-title').textContent;
  copiedCheck.hiddenOnOriginal = originBar.hidden;

  await openByName('Session de test');
  chainCheck.alone = partBar.hidden;
  copiedCheck.hiddenElsewhere = originBar.hidden;

  // The person's own marks: a star, and a note (marks.js). Neither can be
  // rebuilt from anything, so both are followed all the way to storage.
  const star = document.getElementById('favorite');
  const noteBar = document.getElementById('note');
  const noteInput = document.getElementById('note-input');
  const favButton = document.getElementById('favorites');
  const marksCheck = { hiddenAtFirst: favButton.hidden, before: star.getAttribute('aria-pressed') };

  star.click();
  await sleep(250);
  marksCheck.starred = {
    pressed: star.getAttribute('aria-pressed'),
    filled: Boolean(star.querySelector('svg[data-filled="true"]')),
    label: star.getAttribute('aria-label'),
    inTree: [...tree.querySelectorAll('.session-btn')]
      .some((b) => b.textContent.includes('Session de test') && b.querySelector('.session-star')),
    stored: window.mock.marks(),
    favVisible: !favButton.hidden,
    favRow: favButton.textContent,
    favStar: Boolean(favButton.querySelector('svg')),
  };

  document.getElementById('note-toggle').click();
  await sleep(120);
  marksCheck.noteOpen = !noteBar.hidden && document.activeElement === noteInput;
  noteInput.value = 'le calcul de <ponder()> est ici';
  noteInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(900);
  marksCheck.noted = {
    stored: window.mock.marks(),
    status: document.getElementById('note-status').textContent,
  };

  favButton.click();
  await sleep(250);
  const favRow = tree.querySelector('.favorite-row');
  marksCheck.favView = {
    pressed: favButton.getAttribute('aria-pressed'),
    rows: tree.querySelectorAll('.favorite-row').length,
    title: favRow ? favRow.querySelector('.session-title').textContent : '',
    sub: favRow ? favRow.querySelector('.session-sub').textContent : '',
    starred: Boolean(favRow && favRow.querySelector('.session-star')),
    folders: tree.querySelectorAll('.folder').length,
  };
  favButton.click();
  await sleep(250);
  marksCheck.backToFolders = tree.querySelectorAll('.folder').length > 0;

  // A star on ONE message: often the thing someone came back for.
  const starOf = (mid) => transcript.querySelector('.msg[data-message-id="' + mid + '"] .msg-star');
  const firstMessage = [...transcript.querySelectorAll('.msg[data-message-id]')].find((r) => r.querySelector('.msg-star'));
  const messageId = firstMessage.dataset.messageId;
  firstMessage.querySelector('.msg-star').click();
  await sleep(250);
  marksCheck.message = {
    pressed: starOf(messageId).getAttribute('aria-pressed'),
    filled: Boolean(starOf(messageId).querySelector('svg[data-filled="true"]')),
    stored: window.mock.marks(),
    starredTicks: document.querySelectorAll('.outline-tick.starred').length,
  };

  favButton.click();
  await sleep(250);
  const messageRow = tree.querySelector('.favorite-message');
  marksCheck.messageRow = messageRow ? messageRow.textContent : '';
  // A starred conversation and a starred message are different things: the
  // sections say which is which, and a message carries no star of its own.
  marksCheck.sections = [...tree.querySelectorAll('.results-group')].map((g) => g.textContent);
  marksCheck.messageHasStar = Boolean(messageRow && messageRow.querySelector('.session-star'));
  marksCheck.messageQuoted = messageRow ? messageRow.querySelector('.session-title').textContent : '';
  marksCheck.countAfterMessage = document.getElementById('favorites').textContent;
  if (messageRow) messageRow.click();
  for (let i = 0; i < 60 && !transcript.querySelector('.msg'); i++) await sleep(50);
  await sleep(400);
  marksCheck.jumped = {
    hit: (transcript.querySelector('.msg.is-hit') || {}).dataset
      ? transcript.querySelector('.msg.is-hit').dataset.messageId
      : '',
    wanted: messageId,
  };
  favButton.click();
  await sleep(200);

  // Closed, reopened: a mark that does not survive that is not a mark.
  document.getElementById('home').click();
  await sleep(200);
  [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes('Session de test')).click();
  for (let i = 0; i < 60 && !transcript.querySelector('.msg'); i++) await sleep(50);
  await sleep(250);
  marksCheck.reopened = {
    pressed: star.getAttribute('aria-pressed'),
    note: noteInput.value,
    noteShown: !noteBar.hidden,
  };

  // Where a CLI lives: the gear opens a window listing the assistants that
  // matter here, each path checked as it is typed, the others offered under
  // « Ajouter », and the JSON file one click away.
  const dialog = document.getElementById('settings-dialog');
  const rowsShown = () => [...dialog.querySelectorAll('.settings-row')].filter((r) => !r.hidden).map((r) => r.dataset.agent);
  const statusOf = (id) => dialog.querySelector('[data-agent="' + id + '"] .settings-check');
  const openSettings = async () => {
    document.getElementById('settings').click();
    for (let i = 0; i < 40 && !dialog.open; i++) await sleep(25);
    await sleep(50);
  };
  const titleBefore = document.getElementById('convo-title').textContent;
  // Nothing left open behind: Échap there would otherwise have something else to close.
  const searchField = document.getElementById('search');
  searchField.focus();
  searchField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const resultsClosedBefore = document.getElementById('results').hidden;

  await openSettings();
  const settingsCheck = {
    modal: dialog.open && dialog.matches(':modal'),
    shown: rowsShown(),
    focused: document.activeElement ? document.activeElement.id : '',
    claudeStatus: statusOf('claude').textContent,
    codexStatus: statusOf('codex').textContent,
    detected: dialog.querySelector('[data-agent="claude"] .settings-detected').textContent,
  };
  const codexInput = dialog.querySelector('#settings-command-codex');
  codexInput.value = '/opt/absent/codex';
  codexInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(400);
  settingsCheck.bad = { text: statusOf('codex').textContent, cls: statusOf('codex').className };
  dialog.querySelector('[data-agent="codex"] .settings-browse').click();
  await sleep(150);
  settingsCheck.browsed = { value: codexInput.value, text: statusOf('codex').textContent };

  dialog.querySelector('.settings-add-btn').click();
  await sleep(50);
  settingsCheck.addMenu = [...dialog.querySelectorAll('.settings-add-menu .menu-item')].map((b) => b.textContent);
  dialog.querySelector('.settings-add-menu .menu-item').click();
  await sleep(50);
  settingsCheck.afterAdd = rowsShown();
  settingsCheck.focusAfterAdd = document.activeElement ? document.activeElement.id : '';

  // Nothing behind a modal window may react to a key: not "back to the welcome
  // page", not Ctrl+K pulling the cursor out to the search.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  await sleep(50);
  settingsCheck.behind = {
    resultsClosedBefore,
    title: document.getElementById('convo-title').textContent === titleBefore,
    welcome: Boolean(document.querySelector('#transcript .welcome')),
    focusInside: dialog.contains(document.activeElement),
  };

  // Annuler: nothing saved, and the added row is not kept.
  dialog.querySelector('.settings-cancel').click();
  await sleep(50);
  settingsCheck.cancelled = { closed: !dialog.open, saves: window.mock.settingsSaves().length };

  // Enregistrer: exactly what was typed, for the assistants listed.
  await openSettings();
  settingsCheck.reopened = rowsShown();
  dialog.querySelector('[data-agent="codex"] .settings-browse').click();
  await sleep(150);
  dialog.querySelector('.settings-save').click();
  await sleep(150);
  settingsCheck.saved = { closed: !dialog.open, saves: window.mock.settingsSaves(), toast: document.getElementById('toast').textContent };

  // The JSON file: what was typed is saved first, so the file shows it.
  await openSettings();
  settingsCheck.keptPath = dialog.querySelector('#settings-command-codex').value;
  const claudeInput = dialog.querySelector('#settings-command-claude');
  claudeInput.value = '/usr/local/bin/claude';
  claudeInput.dispatchEvent(new Event('input', { bubbles: true }));
  dialog.querySelector('.settings-json').click();
  await sleep(150);
  settingsCheck.json = { closed: !dialog.open, opened: window.mock.settingsFileOpened(), saves: window.mock.settingsSaves().length };

  // Le thème : trois choix, celui en vigueur sélectionné, et le choix part.
  await openSettings();
  const themeSelect = dialog.querySelector('#settings-theme');
  settingsCheck.theme = {
    options: [...themeSelect.options].map((o) => o.value + '=' + o.textContent),
    value: themeSelect.value,
    label: dialog.querySelector('label[for="settings-theme"]').textContent,
  };
  themeSelect.value = 'dark';
  dialog.querySelector('.settings-save').click();
  await sleep(150);
  settingsCheck.themeSaved = { closed: !dialog.open, saved: window.mock.themeSaves() };
  // La page reste claire pour la suite de la campagne.
  document.documentElement.dataset.theme = 'auto';

  // A file that cannot be read: said, and nothing offered that would write it.
  window.mock.settingsUnreadable('Unexpected token } in JSON at position 42');
  await openSettings();
  const banner = dialog.querySelector('.settings-banner');
  settingsCheck.unreadable = {
    banner: banner.hidden ? '' : banner.textContent,
    inputsLocked: [...dialog.querySelectorAll('.settings-input')].every((i) => i.disabled),
    saveLocked: dialog.querySelector('.settings-save').disabled,
    jsonOpen: !dialog.querySelector('.settings-json').disabled,
  };
  dialog.querySelector('.settings-cancel').click();
  window.mock.settingsUnreadable(null);
  await sleep(50);

  // A conversation that cannot be reopened offers the window, open on its assistant.
  window.mock.failResume({
    ok: false, agentId: 'copilot-cli', reason: 'command-not-found', detail: 'copilot', command: 'copilot',
    display: 'copilot --resume=s1', settingsProblem: null,
  });
  document.getElementById('resume').click();
  await sleep(150);
  const toastEl = document.getElementById('toast');
  const toastAction = toastEl.querySelector('.toast-action');
  settingsCheck.failText = toastEl.textContent;
  settingsCheck.action = toastAction ? toastAction.textContent : '';
  if (toastAction) toastAction.click();
  for (let i = 0; i < 40 && !dialog.open; i++) await sleep(25);
  await sleep(50);
  settingsCheck.fromFailure = {
    open: dialog.open,
    shown: rowsShown(),
    focused: document.activeElement ? document.activeElement.id : '',
  };
  dialog.querySelector('.settings-cancel').click();
  window.mock.failResume(null);

  // ── Le filtre par assistant, sous le champ de filtre ──────────────────
  const agentFilter = document.getElementById('agent-filter');
  const chips = () => [...agentFilter.querySelectorAll('.agent-toggle')];
  const foldersShown = () => [...tree.querySelectorAll('.folder-btn')].length;
  const showAll = () => agentFilter.querySelector('.agent-show-all');

  const agentFilterCheck = { start: {}, hidden: {}, restored: {} };
  agentFilterCheck.start = {
    shown: !agentFilter.hidden,
    ids: chips().map((b) => b.dataset.agent),
    // Ce que l'utilisateur a demandé : le nom complet au survol.
    titles: chips().map((b) => b.title),
    pressed: chips().map((b) => b.getAttribute('aria-pressed')),
    showAll: Boolean(showAll()),
    folders: foldersShown(),
    stats: document.getElementById('stats').textContent,
  };

  chips().find((b) => b.dataset.agent === 'codex').click();
  await sleep(200);
  agentFilterCheck.hidden = {
    pressed: chips().map((b) => b.dataset.agent + '=' + b.getAttribute('aria-pressed')),
    stillListed: chips().map((b) => b.dataset.agent),
    showAll: showAll() ? showAll().textContent : '',
    saved: window.mock.hiddenAgents(),
    stats: document.getElementById('stats').textContent,
    folders: foldersShown(),
  };

  showAll().click();
  await sleep(200);
  agentFilterCheck.restored = {
    pressed: chips().map((b) => b.getAttribute('aria-pressed')),
    showAll: Boolean(showAll()),
    saved: window.mock.hiddenAgents(),
  };

  let highlightCheck = { error: null };
  try {
    // ── Le mot cherché, surligné dans la conversation ────────────────────
    // « profond » n'est que dans le message 7 ; « numero » est dans les 2 000,
    // sans accent dans la requête et avec dans le texte. Une seule recherche
    // éprouve donc : le surlignage, les accents, et les tranches peintes après.
    search.value = 'profond numero';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);
    const deepResult = document.querySelector('#results .result');
    if (!deepResult) {
      return { error: 'aucun résultat pour « profond numero » : ' + document.getElementById('results').textContent };
    }
    deepResult.click();
    await sleep(500);

    const marksNow = () => [...transcript.querySelectorAll('mark.search-hit')];
    const rowsNow = () => [...transcript.querySelectorAll('.msg')];
    const paintedAtFirst = rowsNow().length;
    highlightCheck = {
      marked: marksNow().length,
      words: [...new Set(marksNow().map((m) => m.textContent))].sort().join(','),
      ring: Boolean(transcript.querySelector('.msg.is-hit')),
      nested: transcript.querySelectorAll('mark mark').length,
    };

    // La ligne 1 500 d'une conversation de 2 000 n'a pas pu être peinte par la
    // première tranche — elle en fait 120. Si elle porte la marque, c'est que
    // le crochet de peinture a fait son travail longtemps après l'ouverture.
    for (let i = 0; i < 200 && rowsNow().length < 2000; i++) await sleep(50);
    const far = rowsNow().slice(1400, 1440);
    highlightCheck.paintedAfter = {
      rows: rowsNow().length,
      firstSlice: paintedAtFirst,
      marked: far.filter((row) => row.querySelector('mark.search-hit')).length,
      total: far.length,
    };

    // Vider la recherche éteint le surlignage qu'elle avait causé.
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);
    highlightCheck.afterClearing = marksNow().length;

  } catch (error) {
    highlightCheck = { error: String((error && error.message) || error) };
  }

  return {
    highlightCheck,
    agentFilterCheck,
    exportCheck: { menuOpen, afterMd, calls: window.mock.exportCalls(), closesOutside, copied, icons },
    chainCheck,
    copiedCheck,
    marksCheck,
    settingsCheck,
    outlineCheck: { smallTicks, onBig, widths, viaTick, nearEnd, viaKeys, outlineOnHome },
    findCheck: { opens, accents, wrapped, retyped, escaped, inert },
    bigCheck: { opened, allRows, homeDuringSlices, deep, extended },
    forgetCheck: { onLive, onSaved, afterOneClick, afterTwoClicks },
    orderCheck: { byDefault, flipped, otherConversation, backOnFirst, restored, liveOnTop },
    afterAuto,
    afterManual,
    messages,
    sessionRows,
    sessionLists,
    folderDots,
    otherAgent,
    resumeState,
    afterHome,
    afterFailure,
    afterRace,
    reopened,
    scopeOptions,
    scopedHits,
    periodOptions,
    periodDefault,
    periodResult,
    periodEmpty,
    periodSent,
    periodCleared,
    lefts,
    distinctLefts: [...new Set(lefts)].length,
    toolRuns,
    title: claudeChrome.title,
    meta: claudeChrome.meta,
    claudeModelLabels: claudeChrome.modelLabels,
    untitled,
    stats: document.getElementById('stats').textContent,
    searchVisible,
    searchMarks,
    searchGroups,
    liveScripts: transcript.querySelectorAll('script').length,
    horizontalOverflow: transcript.scrollWidth > transcript.clientWidth + 1,
  };
})()`;

/**
 * Walk the app through every screen it has, and collect what it shows: the
 * text of every element, and every tooltip, accessible name and placeholder.
 * Run in the pseudo-language, where each sentence from a language file reads
 * ⟦…⟧, whatever comes back bare was written into the code — in no language
 * file, and so in the one language its author happened to speak.
 *
 * It looks for words. A date written in digits alone by the code itself
 * (`toLocaleString('fr-FR')` gives "18/09/2026 01:05:00") has none, and would
 * pass: dates go through l10n.date/dateTime/ago, which a review has to check.
 */
const SCREENS_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tree = document.getElementById('tree');
  const seen = new Map();
  // What the person's data puts on screen: theirs, in whatever language.
  const DATA = [
    '.msg-body', '.folder-name', '.folder-parent', '.session-title', '.result-snippet',
    '.result-title strong', '.results-group', '#convo-title', '.agent-chip', '.agent-dot',
    '.fold pre', '.fold-tag', 'code', 'pre', '.outline-tick', 'title', '.msg-model', '.session-model',
    '.stats-model', '.stats-folder', '.stats-parent',
  ].join(', ');
  // Names, not sentences: the app's, the assistants', the languages' own.
  const NAMES = new Set(['Ariane', 'Claude Code', 'Codex', 'Copilot CLI', 'Qwen Code', 'Gemini CLI',
    'VS Code Chat', 'Claude', 'Copilot', 'Gemini', 'Qwen', 'VS Code', 'English', 'Français']);
  const bare = (text) => /[A-Za-zÀ-ÿ]{2,}/.test(text) && !text.includes('⟦') && !NAMES.has(text.trim())
    && !text.trim().startsWith('/');
  const scan = (where) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.data.trim();
      if (text && !node.parentElement.closest(DATA) && bare(text)) seen.set(text, where);
    }
    for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
      if (el.closest(DATA)) continue;
      for (const name of ['title', 'aria-label', 'placeholder']) {
        const value = el.getAttribute(name);
        if (value && bare(value)) seen.set(name + '=' + value, where);
      }
    }
  };

  for (let i = 0; i < 60 && !tree.querySelector('.folder-btn'); i++) await sleep(50);
  await sleep(200);
  scan('accueil');

  tree.querySelector('.folder-btn').click();
  for (let i = 0; i < 60 && !tree.querySelector('.session-btn'); i++) await sleep(50);
  [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes('Session de test')).click();
  const transcript = document.getElementById('transcript');
  for (let i = 0; i < 60 && !transcript.querySelector('.msg'); i++) await sleep(50);
  await sleep(300);
  for (const d of transcript.querySelectorAll('details')) d.open = true;
  scan('conversation');

  document.getElementById('export').click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
  const find = document.getElementById('find-input');
  find.value = 'rien-de-tel';
  find.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  scan('recherche dans la conversation, export');

  const search = document.getElementById('search');
  search.value = 'terme';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(400);
  scan('résultats');
  document.getElementById('period').value = '7d';
  document.getElementById('period').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300);
  scan('aucun résultat');

  document.getElementById('copy-cmd').click();
  await sleep(150);
  scan('message');

  document.getElementById('stats-open').click();
  for (let i = 0; i < 60 && !document.querySelector('.stats-view:not(.is-loading) .stats-block'); i++) await sleep(50);
  document.querySelector('.stats-table-view').open = true;
  document.querySelector('.stats-hit').dispatchEvent(new Event('focus'));
  await sleep(100);
  scan('statistiques');

  document.getElementById('settings').click();
  const dialog = document.getElementById('settings-dialog');
  for (let i = 0; i < 40 && !dialog.open; i++) await sleep(25);
  await sleep(100);
  dialog.querySelector('.settings-add-btn').click();
  await sleep(50);
  scan('réglages');

  return {
    bare: [...seen.entries()].map(([text, where]) => where + ' : ' + text),
    lang: document.documentElement.lang,
    settingsTitle: dialog.querySelector('#settings-title').textContent,
  };
})()`;

/** The statistics view, driven the way a person would: button, toggle, hover, period, footer. */
const STATS_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tree = document.getElementById('tree');
  const transcript = document.getElementById('transcript');
  const ready = async () => {
    for (let i = 0; i < 60 && !transcript.querySelector('.stats-view:not(.is-loading) .stats-block'); i++) await sleep(50);
  };
  for (let i = 0; i < 60 && !tree.querySelector('.folder-btn'); i++) await sleep(50);

  document.getElementById('stats-open').click();
  await ready();
  const view = transcript.querySelector('.stats-view');
  const tiles = [...view.querySelectorAll('.stat-tile')].map((t) => ({
    label: t.querySelector('.stat-label').textContent,
    value: t.querySelector('.stat-value').textContent,
    title: t.querySelector('.stat-value').title,
    labelTitle: t.querySelector('.stat-label').title,
  }));
  const notes = [...view.querySelectorAll('.stats-note')].map((n) => n.textContent);
  const hits = [...view.querySelectorAll('.stats-hit')];
  const bars = [...view.querySelectorAll('.stats-bar-mark')].map((b) => b.getAttribute('d'));
  const direct = [...view.querySelectorAll('.stats-direct')].map((d) => d.textContent);
  const pressed = [...view.querySelectorAll('.stats-seg')].map((b) => b.getAttribute('aria-pressed'));

  hits[4].dispatchEvent(new Event('pointerenter'));
  const tip = view.querySelector('.stats-tip');
  const tipShown = { hidden: tip.hidden, text: tip.textContent, hot: view.querySelectorAll('.stats-bar-mark.is-hot').length };
  hits[4].dispatchEvent(new Event('pointerleave'));
  const tipAfter = tip.hidden;

  view.querySelectorAll('.stats-seg')[2].click();
  await sleep(50);
  const afterToggle = {
    labels: [...view.querySelectorAll('.stats-hit')].map((h) => h.getAttribute('aria-label')),
    direct: [...view.querySelectorAll('.stats-direct')].map((d) => d.textContent),
    tableRows: view.querySelectorAll('.stats-table-view tbody tr').length,
  };

  const agentRows = [...view.querySelectorAll('.stats-grid .stats-table')[0].querySelectorAll('tbody tr')]
    .map((r) => [...r.cells].map((c) => c.textContent.trim()));
  const modelRows = [...view.querySelectorAll('.stats-grid .stats-table')[1].querySelectorAll('tbody tr')]
    .map((r) => r.cells[0].textContent);
  const restTitle = (view.querySelector('.stats-rest td') || {}).title || '';
  const overflow = { scroll: transcript.scrollWidth, client: transcript.clientWidth };

  // The period of the search bar scopes the statistics too.
  document.getElementById('period').value = '30d';
  document.getElementById('period').dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(100);
  await ready();
  // Read now: the footer, further down, reopens the view with the same period.
  const callsAfterPeriod = window.mock.statisticsCalls();

  // Opening a conversation leaves the statistics; the footer brings them back.
  tree.querySelector('.folder-btn').click();
  for (let i = 0; i < 60 && !tree.querySelector('.session-btn'); i++) await sleep(50);
  tree.querySelector('.session-btn').click();
  for (let i = 0; i < 60 && transcript.querySelector('.stats-view'); i++) await sleep(50);
  const leftForConversation = !transcript.querySelector('.stats-view') && !document.getElementById('convo-head').hidden;
  const footer = document.getElementById('stats');
  const footerTitle = footer.title;
  footer.click();
  await ready();
  const backFromFooter = Boolean(transcript.querySelector('.stats-view'));

  return {
    tiles, notes, hitCount: hits.length, bars, direct, pressed, tipShown, tipAfter, afterToggle,
    agentRows, modelRows, restTitle, overflow, leftForConversation, footerTitle, backFromFooter,
    calls: callsAfterPeriod,
    title: view.querySelector('.stats-title').textContent,
  };
})()`;

/** The start page and a few labels, in English: the language a missing translation falls back to. */
const ENGLISH_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tree = document.getElementById('tree');
  for (let i = 0; i < 60 && !tree.querySelector('.folder-btn'); i++) await sleep(50);
  await sleep(200);
  return {
    lang: document.documentElement.lang,
    welcome: document.querySelector('.welcome h2').textContent,
    stats: document.getElementById('stats').textContent,
    search: document.getElementById('search').placeholder,
    period: [...document.getElementById('period').options].map((o) => o.textContent).join(' | '),
  };
})()`;

/**
 * Choosing another language in the settings: saved, then the window is
 * written again in it — and the conversation that was open is open again.
 */
async function languageChange() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false, partition: 'render-test-switch' },
  });
  await win.loadFile(INDEX);
  const before = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tree = document.getElementById('tree');
    for (let i = 0; i < 60 && !tree.querySelector('.folder-btn'); i++) await sleep(50);
    tree.querySelector('.folder-btn').click();
    for (let i = 0; i < 60 && !tree.querySelector('.session-btn'); i++) await sleep(50);
    [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes('Session de test')).click();
    for (let i = 0; i < 60 && !document.querySelector('#transcript .msg'); i++) await sleep(50);
    document.getElementById('settings').click();
    const dialog = document.getElementById('settings-dialog');
    for (let i = 0; i < 40 && !dialog.open; i++) await sleep(25);
    await sleep(50);
    const select = document.getElementById('settings-language');
    const options = [...select.options].map((o) => o.textContent);
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { options, title: document.getElementById('convo-title').textContent };
  })()`);
  const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.webContents.executeJavaScript(`document.querySelector('#settings-dialog .settings-save').click(); true`);
  await reloaded;
  const after = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && !document.querySelector('#transcript .msg'); i++) await sleep(50);
    await sleep(200);
    return {
      lang: document.documentElement.lang,
      title: document.getElementById('convo-title').textContent,
      you: (document.querySelector('.msg-user .who') || {}).textContent || '',
      order: document.getElementById('order').textContent,
    };
  })()`);
  win.destroy();
  return { before, after };
}

/**
 * Une fenêtre à qui le faux pont annonce `version`, ou rien du tout.
 * Le vrai réglage vit dans le processus principal : ici on n'éprouve que ce
 * que la fenêtre fait d'une réponse.
 */
async function updateWindow(version, script) {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: `render-update-${version || 'aucune'}`,
    },
  });
  const query = version ? { lang: 'fr', update: version } : { lang: 'fr' };
  await win.loadFile(INDEX, { query });
  const result = await win.webContents.executeJavaScript(script);
  win.destroy();
  return result;
}

async function languageWindow(lang, script) {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      partition: `render-test-${lang}`,
    },
  });
  await win.loadFile(INDEX, { query: { lang } });
  const result = await win.webContents.executeJavaScript(script);
  win.destroy();
  return result;
}

async function run() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the mock preload needs require('electron')
      // In-memory storage: a preference one run leaves behind (the reading
      // order, say) must not change what the next run sees.
      partition: 'render-test',
    },
  });

  await win.loadFile(INDEX);
  const r = await win.webContents.executeJavaScript(SCRIPT);

  // Each conversation keeps its order while the app runs — and only then: on
  // the next launch every conversation opens in the default order again. A
  // reload stands in for the relaunch; the in-memory partition keeps storage
  // across it, so a stored order WOULD survive and be caught.
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('order').click();
    await new Promise((r) => setTimeout(r, 100));
    // What an earlier build left behind: ONE order for every conversation.
    localStorage.setItem('ariane.newestFirst', 'true');
  })()`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const afterRelaunch = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tree = document.getElementById('tree');
    const order = document.getElementById('order');
    for (let i = 0; i < 60 && !tree.querySelector('.folder-btn'); i++) await sleep(50);
    tree.querySelector('.folder-btn').click();
    for (let i = 0; i < 60 && !tree.querySelector('.session-btn'); i++) await sleep(50);

    const open = async (title) => {
      [...tree.querySelectorAll('.session-btn')].find((b) => b.textContent.includes(title)).click();
      await sleep(400);
      return { label: order.textContent, pressed: order.getAttribute('aria-pressed') };
    };
    const flipped = await open('Session de test');
    const other = await open('Session Codex A');
    return { flipped, other, legacy: localStorage.getItem('ariane.newestFirst') };
  })()`);
  win.destroy();

  // A real PDF, printed the way the app prints one: a window nobody sees, with
  // JavaScript off, from a page written to a private directory and removed.
  const { printHtmlToPdf } = require('../../src/main/export');
  const layoutModule = await import(
    require('url').pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'export-document.js')).href
  );
  const pdfMessages = Array.from({ length: 400 }, (_, i) => ({
    id: i, seq: i, role: i % 2 ? 'assistant' : 'user', ts: new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString(),
    text: i === 3 ? 'Voici <script>alert(1)</script> et du `code`' : `Message ${i} : ${'une phrase ordinaire. '.repeat(12)}`,
    thinking: '', parts: [], isMeta: false, isNotice: false, isSidechain: false, command: null,
  }));
  const pdfL10n = await require('../helpers/l10n').localizer('fr');
  const pdfLayout = layoutModule.layoutConversation({
    session: { agentId: 'claude', title: 'Export de test', messageCount: 400, folderPath: '/home/ada/p' },
    messages: pdfMessages,
    l10n: pdfL10n,
  });
  const pdfDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'ariane-pdf-'));
  const pdfFile = path.join(pdfDir, 'sortie.pdf');
  const started = Date.now();
  await printHtmlToPdf(layoutModule.toHtml(pdfLayout, { l10n: pdfL10n }), pdfFile, pdfLayout.title, {
    BrowserWindow,
    workDir: path.join(pdfDir, 'pages'),
  });
  const pdfBytes = require('fs').readFileSync(pdfFile);
  const pages = (pdfBytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  const leftovers = require('fs').readdirSync(path.join(pdfDir, 'pages')).length;
  require('fs').rmSync(pdfDir, { recursive: true, force: true });
  check('a real PDF is printed, over many pages',
    pdfBytes.subarray(0, 5).toString() === '%PDF-' && pages > 5,
    `${pages} pages, ${Math.round(pdfBytes.length / 1024)} Ko, ${Date.now() - started} ms`);
  check('and the page it was printed from is gone', leftovers === 0, `${leftovers} fichier(s) restant(s)`);

  // -- every sentence comes from a language file ------------------------------
  const pseudo = await languageWindow('pseudo', SCREENS_SCRIPT);
  check('every sentence on every screen comes from a language file',
    pseudo.bare.length === 0 && pseudo.settingsTitle === '⟦Settings⟧',
    pseudo.bare.length ? pseudo.bare.slice(0, 12).join(' ‖ ') : `${pseudo.settingsTitle}`);
  // -- les statistiques ---------------------------------------------------
  const sv = await languageWindow('fr', STATS_SCRIPT);
  const tile = (label) => sv.tiles.find((x) => x.label === label) || {};
  check('le bouton ouvre les statistiques dans le panneau de lecture', sv.title === 'Statistiques', sv.title);
  check('qui a écrit : vos messages et les réponses, avec leur part',
    tile('Tapés par vous').value === '2\u202f789' && tile('Réponses des assistants').value === '23\u202f339',
    JSON.stringify(sv.tiles.slice(0, 2)));
  check('les jetons en K, M et G, le nombre exact au survol, le sens au survol du libellé',
    tile('↓ Reçus').value === '16,3M' && tile('↓ Reçus').title === '16\u202f329\u202f338\u00a0jetons'
      && tile('Relus depuis le cache').value === '4,8G' && tile('↑ Envoyés').labelTitle.startsWith('Nouveaux dans les invites'),
    JSON.stringify(sv.tiles.slice(4)));
  check('la couverture est dite, et qui ne mesure rien est nommé',
    sv.notes.some((n) => n === 'Mesurés dans 37 conversations sur 363.')
      && sv.notes.some((n) => n.startsWith('Codex n’enregistre pas')),
    sv.notes.join(' | '));
  check('ce qui ne montre rien est expliqué : surtout le raisonnement masqué de Claude',
    sv.notes.includes('La barre latérale compte 49\u202f411 enregistrements : 6\u202f501 ne contiennent rien à afficher.')
      && sv.notes.includes('Parmi eux, 6\u202f093 sont des raisonnements que Claude ne garde plus que chiffrés : il n’en reste qu’une signature.'),
    sv.notes.join(' | '));
  check('une colonne par mois, le mois vide compris, sans barre pour lui',
    sv.hitCount === 5 && sv.bars[2] === '' && sv.bars.filter(Boolean).length === 4,
    `${sv.hitCount} colonnes, barres : ${sv.bars.map((b) => (b ? 'x' : '·')).join('')}`);
  check('une seule mesure à la fois, et seul le maximum porte son nombre',
    JSON.stringify(sv.pressed) === '["true","false","false"]' && JSON.stringify(sv.direct) === '["1\u202f128"]',
    `${sv.pressed} / ${sv.direct}`);
  check('au survol, la valeur exacte et le mois en toutes lettres ; elle repart ensuite',
    !sv.tipShown.hidden && sv.tipShown.text.includes('1\u202f128') && sv.tipShown.text.includes('septembre 2026')
      && sv.tipShown.hot === 1 && sv.tipAfter === true,
    JSON.stringify(sv.tipShown));
  check('changer de mesure redessine le graphique et son tableau',
    sv.afterToggle.labels[4] === 'septembre 2026 : 9,8M' && JSON.stringify(sv.afterToggle.direct) === '["9,8M"]'
      && sv.afterToggle.tableRows === 5,
    JSON.stringify(sv.afterToggle));
  check('par assistant : ce qui n’est pas mesuré s’écrit « — », pas « 0 »',
    sv.agentRows.length === 2 && sv.agentRows[1][sv.agentRows[1].length - 1] === '—',
    JSON.stringify(sv.agentRows));
  check('au-delà de huit modèles, le reste tient en une ligne, nommé au survol',
    sv.modelRows.length === 9 && sv.modelRows[8] === '2 autres modèles' && sv.restTitle === 'kimi-k3 et grok-4.6',
    `${sv.modelRows.join(', ')} / ${sv.restTitle}`);
  check('la vue ne déborde pas de côté', sv.overflow.scroll <= sv.overflow.client, JSON.stringify(sv.overflow));
  check('la période de la barre de recherche s’applique aussi aux statistiques',
    JSON.stringify(sv.calls) === '[null,"30d"]', JSON.stringify(sv.calls));
  check('ouvrir une conversation quitte les statistiques ; le pied de la barre les rouvre',
    sv.leftForConversation && sv.backFromFooter && sv.footerTitle === 'Afficher les statistiques',
    JSON.stringify({ left: sv.leftForConversation, back: sv.backFromFooter, title: sv.footerTitle }));

  const english = await languageWindow('en', ENGLISH_SCRIPT);
  check('the app speaks English when asked, down to its numbers',
    english.lang === 'en' && english.welcome === 'Your past conversations'
      && english.stats === '1 folder · 1 conversation · 10 messages'
      && english.search === 'Search your conversations…'
      && english.period === 'All dates | Last 7 days | Last 30 days | This year',
    JSON.stringify(english));

  const change = await languageChange();
  check('the settings offer the system\'s language, then every language by its own name',
    change.before.options.join(' | ') === 'Automatique — Français | English | Français',
    change.before.options.join(' | '));
  check('a new language rewrites the window, and reopens the conversation that was open',
    change.after.lang === 'en' && change.after.title === change.before.title
      && change.after.you === 'You' && change.after.order === 'Newest at the top',
    JSON.stringify(change));

  check('after a relaunch, even the flipped conversation opens latest-first again',
    afterRelaunch.flipped.label === 'Plus récent en haut' && afterRelaunch.flipped.pressed === 'true',
    `${afterRelaunch.flipped.label} / aria-pressed=${afterRelaunch.flipped.pressed}`);
  check('and so does every other one, whatever an older build stored',
    afterRelaunch.other.label === 'Plus récent en haut' && afterRelaunch.legacy === null,
    `${afterRelaunch.other.label}, ancienne clé=${afterRelaunch.legacy}`);

  if (r.error) {
    check('the app renders at all', false, r.error);
    return report();
  }

  const byId = Object.fromEntries(r.messages.map((m) => [m.id, m]));

  // -- attribution: the reason this file exists ----------------------------
  check('a real question is credited to the person', byId['1'] && byId['1'].speaker === 'Vous',
    byId['1'] ? String(byId['1'].speaker) : 'absent');
  check('an assistant answer is credited to Claude', byId['2'] && byId['2'].speaker === 'Claude',
    byId['2'] ? String(byId['2'].speaker) : 'absent');
  // Tool output now lands inside a grouped strip rather than a standalone row,
  // so the guarantee is stated on whatever row ends up carrying it.
  check('no row ever credits the person with tool output',
    r.messages.every((m) => m.speaker !== 'Vous' || m.id === '1' || m.id === '6'),
    r.messages.map((m) => `${m.id}:${m.speaker}`).join(' '));
  check('a grouped tool strip names no speaker at all',
    r.toolRuns.length > 0 && r.toolRuns.every((t) => t.speaker === null),
    r.toolRuns.map((t) => String(t.speaker)).join(' '));
  check('a harness notice is credited to nobody and marked',
    byId['4'] && byId['4'].speaker === null && byId['4'].notice);

  // -- filtering -----------------------------------------------------------
  check('an empty shell message is not rendered', !byId['5'], 'message 5 should be absent');
  // 2 prose turns from the person, 1 from Claude, 1 notice, 2 tool strips.
  check('exactly the meaningful rows are shown', r.messages.length === 6,
    `${r.messages.length} rendered`);
  check('the person speaks exactly twice',
    r.messages.filter((m) => m.speaker === 'Vous').length === 2,
    r.messages.map((m) => String(m.speaker)).join(' '));

  // -- collapsing ----------------------------------------------------------
  check('reasoning and tool calls are rendered collapsed',
    byId['2'] && byId['2'].folds.length === 2, byId['2'] ? byId['2'].folds.join(' | ') : '');

  // -- escaping ------------------------------------------------------------
  check('injected markup never becomes live DOM', r.liveScripts === 0, `${r.liveScripts} script tags`);
  check('injected markup is shown escaped',
    byId['6'] && byId['6'].html.includes('&lt;script&gt;'), byId['6'] ? byId['6'].html.slice(0, 60) : '');
  check('inline code still renders', byId['6'] && byId['6'].html.includes('<code>'));

  // -- chrome --------------------------------------------------------------
  check('the conversation header names the session', r.title === 'Session de test', r.title);
  check('the header shows the real folder path', r.meta.includes('/home/zam/projet'), r.meta);

  // -- quel modèle a répondu ---------------------------------------------
  check('l’en-tête nomme le modèle qui a répondu', r.meta.includes('claude-opus-5'), r.meta);
  check('un seul modèle du début à la fin : aucune réponse n’a d’étiquette', r.claudeModelLabels === 0,
    `${r.claudeModelLabels} étiquette(s)`);
  check('deux modèles : l’en-tête les nomme tous deux, dans l’ordre où ils ont répondu',
    r.otherAgent.meta && r.otherAgent.meta.includes('gpt-5.2-codex et gpt-6-astra'), r.otherAgent.meta);
  check('et chaque réponse où un modèle prend la main porte son nom',
    JSON.stringify([...(r.otherAgent.modelLabels || [])].sort()) === JSON.stringify(['gpt-5.2-codex', 'gpt-6-astra']),
    JSON.stringify(r.otherAgent.modelLabels));
  check('the footer reports the index size', r.stats.includes('conversation'), r.stats);

  // -- search --------------------------------------------------------------
  check('typing opens the results panel', r.searchVisible);
  check('matches are highlighted', r.searchMarks === 1, `${r.searchMarks} marks`);
  check('results are grouped by folder',
    r.searchGroups.length === 1 && r.searchGroups[0].includes('/home/zam/projet'),
    r.searchGroups.join(' | '));

  // -- grouping ------------------------------------------------------------
  // Four consecutive tool turns must become ONE strip, not four rows.
  const run = r.toolRuns.find((t) => /appels/.test(t.summary));
  check('consecutive tool turns collapse into one strip',
    Boolean(run), r.toolRuns.map((t) => t.summary).join(' || '));
  check('the strip counts the calls and names the tools',
    run && /2 appels/.test(run.summary) && /Bash/.test(run.summary) && /Read/.test(run.summary),
    run ? run.summary : '');
  check('the strip reports the failing call',
    run && /erreur/.test(run.summary), run ? run.summary : '');
  check('the strip still holds every call and result',
    run && run.inner === 4, run ? `${run.inner} blocs` : '');
  check('a lone result is not announced as a call',
    r.toolRuns.every((t) => /appels?/.test(t.summary) || /résultat/.test(t.summary)),
    r.toolRuns.map((t) => t.summary).join(' || '));

  // -- coming back to the welcome pane --------------------------------------
  check('the brand brings the welcome pane back', r.afterHome.welcome);
  check('the conversation is cleared from the pane', r.afterHome.messages === 0,
    `${r.afterHome.messages} rows left`);
  check('its header is hidden', r.afterHome.headerHidden === true);
  check('the scope no longer offers a conversation that is not open',
    r.afterHome.scopeHasSession === false);
  check('a conversation can be opened again afterwards', r.reopened > 0, `${r.reopened} rows`);

  // -- reopening the conversation in its own CLI ---------------------------
  check('the conversation offers to be reopened', r.resumeState.hidden === false,
    `hidden=${r.resumeState.hidden}`);
  check('the button names the command it will run',
    r.resumeState.title.includes('claude --resume'), r.resumeState.title);
  check('the command can also be copied', r.resumeState.copyHidden === false);

  // -- the assistant is named after the agent that actually spoke ----------
  check('a conversation from another agent is not labelled Claude',
    r.otherAgent.speaker && r.otherAgent.speaker !== 'Claude',
    `speaker=${r.otherAgent.speaker || r.otherAgent.error}`);
  check('it is labelled with that agent name',
    r.otherAgent.speaker === 'Codex', `speaker=${r.otherAgent.speaker}`);
  check('its header names the agent too',
    r.otherAgent.meta && r.otherAgent.meta.startsWith('Codex'), r.otherAgent.meta);

  // -- agents: one list, newest first, whoever wrote it ---------------------
  // The fixture is built for this: the Claude session is the most recent
  // (23:06) and the two Codex ones older (22:00, 21:00). Grouped by agent and
  // ordered by size, Codex came first and the newest was buried under two.
  check('une seule liste, pas une par assistant',
    r.sessionLists === 1, `${r.sessionLists} liste(s)`);
  check('la conversation la plus récente est en tête, quel que soit son assistant',
    r.sessionRows[0] && r.sessionRows[0].agent === 'claude',
    r.sessionRows.map((s) => s.agent).join(' > '));
  check('les assistants sont entremêlés dans la même liste',
    new Set(r.sessionRows.map((s) => s.agent)).size === 2 && r.sessionRows.length === 3,
    `${r.sessionRows.length} lignes : ${r.sessionRows.map((s) => s.agent).join(', ')}`);
  // -- ce que chaque conversation a coûté ---------------------------------
  const claudeRow = r.sessionRows.find((s) => s.agent === 'claude');
  // -- le modèle, dans la barre latérale ---------------------------------
  const codexRowA = r.sessionRows.find((s) => s.title.includes('Session Codex A'));
  check('sous une conversation, son modèle précède ce qu’elle a coûté',
    claudeRow && claudeRow.model === 'claude-opus-5' && claudeRow.line === 'claude-opus-5 · ↑ 167K · ↓ 78,2K · cache 5,9M',
    claudeRow && claudeRow.line);
  check('plusieurs modèles : celui qui a le plus répondu, les autres comptés, tous au survol',
    codexRowA && codexRowA.model === 'gpt-6-astra +1' && codexRowA.modelTitle === 'gpt-6-astra et gpt-5.2-codex',
    codexRowA && `${codexRowA.model} / ${codexRowA.modelTitle}`);
  check('sans jetons, le modèle seul, sans séparateur orphelin',
    codexRowA && codexRowA.line === 'gpt-6-astra +1', codexRowA && JSON.stringify(codexRowA.line));
  check('une conversation sans modèle ni jetons n’a pas de dernière ligne',
    r.sessionRows.some((s) => s.agent === 'codex' && s.line === null),
    r.sessionRows.map((s) => `${s.agent}:${s.line}`).join(' | '));
  check('sans titre, l’en-tête la nomme par ses premiers mots, comme la barre latérale',
    r.untitled.found && r.untitled.title === 'une question sans titre', JSON.stringify(r.untitled));
  check('la ligne sous le titre se lit en entier au survol',
    r.untitled.found && r.untitled.metaTitle === r.untitled.metaText, JSON.stringify(r.untitled));

  check('une conversation mesurée montre ses jetons sous son résumé, en K et M',
    claudeRow && claudeRow.tokens === '↑ 167K · ↓ 78,2K · cache 5,9M',
    claudeRow && claudeRow.tokens);
  check('le cache relu est à part : jamais additionné aux envoyés',
    claudeRow && !/6(,|\.)\d?M/.test(claudeRow.tokens.split('·')[0]),
    claudeRow && claudeRow.tokens);
  check('au survol, les chiffres exacts',
    claudeRow && /166\u202f659/.test(claudeRow.tokensTitle) && /5\u202f933\u202f004/.test(claudeRow.tokensTitle),
    claudeRow && JSON.stringify(claudeRow.tokensTitle));
  check('une conversation que son agent n’a pas mesurée ne montre rien, pas zéro',
    r.sessionRows.filter((s) => s.agent === 'codex').every((s) => s.tokens === null),
    r.sessionRows.map((s) => `${s.agent}:${s.tokens}`).join(' | '));
  check('chaque ligne porte sa marque d\'assistant',
    r.sessionRows.every((s) => s.agent),
    r.sessionRows.map((s) => s.agent || '(aucune)').join(' '));
  check('the folder row marks which agents worked there',
    r.folderDots.length === 2, r.folderDots.join(','));

  // -- scope dropdown ------------------------------------------------------
  check('the scope list offers every agent',
    r.scopeOptions.some((o) => o.value === 'agent:claude')
      && r.scopeOptions.some((o) => o.value === 'agent:codex'),
    r.scopeOptions.map((o) => o.value).join(' '));
  check('the scope list offers the open folder and conversation',
    r.scopeOptions.some((o) => o.value === 'folder') && r.scopeOptions.some((o) => o.value === 'session'),
    r.scopeOptions.map((o) => o.value).join(' '));
  check('narrowing to one agent filters the results',
    r.scopedHits === 0, `${r.scopedHits} hits for agent:codex (fixture has claude only)`);

  // -- searching by date -----------------------------------------------------
  check('the period list offers every period, all dates first',
    r.periodOptions.join(' ') === 'all 7d 30d year' && r.periodDefault === 'all',
    `${r.periodOptions.join(' ')} / ${r.periodDefault}`);
  check('each result says when it was written',
    r.periodResult.text.length > 0 && r.periodResult.title.includes('2026'),
    JSON.stringify(r.periodResult));
  check('the chosen period reaches the search',
    r.periodSent && r.periodSent.period === '7d' && r.periodSent.query === 'terme',
    JSON.stringify(r.periodSent));
  check('nothing within the period says so',
    r.periodEmpty === 'Aucun résultat sur les 7 derniers jours.', r.periodEmpty);
  check('back to all dates, no period is sent',
    r.periodCleared && r.periodCleared.period === null, JSON.stringify(r.periodCleared));

  // -- two conversations opened at once --------------------------------------
  check('the slower of two loads does not win the transcript',
    r.afterRace.title.includes('Codex') && r.afterRace.texts.includes('reponse codex')
      && !r.afterRace.texts.includes('Que fait ce code'),
    `${r.afterRace.title} :: ${r.afterRace.texts.slice(0, 80)}`);
  check('and the attribution follows the conversation actually shown',
    r.afterRace.speaker === 'Codex', String(r.afterRace.speaker));

  // -- keeping itself up to date -------------------------------------------
  check('a background pass finds a new conversation on its own',
    r.afterAuto.newListed);
  check('and the folder being read stays open and loaded',
    r.afterAuto.folderOpen === 'true' && !r.afterAuto.loading,
    `aria-expanded=${r.afterAuto.folderOpen}, chargement=${r.afterAuto.loading}`);
  check('the open conversation is not repainted when nothing in it changed',
    r.afterAuto.transcriptKept);
  check('a background pass asks to be quiet, and shows no toast',
    r.afterAuto.quiet === true && r.afterAuto.toast === '',
    `quiet=${r.afterAuto.quiet} toast=${r.afterAuto.toast}`);
  check('a message added to the open conversation appears in it',
    r.afterManual.liveShown);
  check('a manual refresh no longer leaves open folders on "Chargement…"',
    r.afterManual.folderOpen === 'true' && !r.afterManual.loading && r.afterManual.listed > 0,
    `aria-expanded=${r.afterManual.folderOpen}, chargement=${r.afterManual.loading}, ${r.afterManual.listed} sessions`);

  // -- reading order ---------------------------------------------------------
  const o = r.orderCheck;
  check('a conversation opens with its latest message at the top',
    o.byDefault.label === 'Plus récent en haut' && o.byDefault.pressed === 'true',
    `${o.byDefault.label} / aria-pressed=${o.byDefault.pressed}`);
  check('flipping it puts the first message at the top, and the rest in reverse',
    o.flipped.ids.join(',') === [...o.byDefault.ids].reverse().join(',') && o.flipped.ids.length > 2,
    `${o.byDefault.ids.join(',')} → ${o.flipped.ids.join(',')}`);
  check('it says so, and starts reading from the new top',
    o.flipped.label === 'Plus ancien en haut' && o.flipped.pressed === 'false' && o.flipped.top === 0,
    `${o.flipped.label} / aria-pressed=${o.flipped.pressed} / scrollTop=${o.flipped.top}`);
  check('inside a strip of tool calls, each call still precedes its result',
    JSON.stringify(o.flipped.strip) === JSON.stringify(o.byDefault.strip)
      && Object.values(o.byDefault.strip).some((folds) => folds.length > 1),
    Object.values(o.flipped.strip).map((f) => f.join(' | ')).join(' ‖ '));
  check('flipping one conversation leaves the others in the default order',
    o.otherConversation.first.includes('reponse codex') && o.otherConversation.last.includes('prompt codex')
      && o.otherConversation.label === 'Plus récent en haut',
    `${o.otherConversation.label} : ${o.otherConversation.first} … ${o.otherConversation.last}`);
  check('and a flipped conversation is still flipped when one comes back to it',
    o.backOnFirst.label === 'Plus ancien en haut' && o.backOnFirst.firstId === o.flipped.ids[0],
    `${o.backOnFirst.label}, premier=${o.backOnFirst.firstId}`);
  check('flipping back restores the latest message at the top',
    o.restored.label === 'Plus récent en haut' && o.restored.firstId === o.byDefault.ids[0],
    `${o.restored.label}, premier=${o.restored.firstId}`);
  check('in the default order, a message arriving in the open conversation appears at the top',
    o.liveOnTop.includes('le plus récent, en haut'), o.liveOnTop.slice(0, 60));

  // -- a very long conversation ---------------------------------------------
  const b = r.bigCheck;
  check('a long conversation opens on a first slice, not all at once',
    b.opened.rows > 0 && b.opened.rows <= 200, `${b.opened.rows} lignes au premier affichage, sur 2000`);
  check('and the rest follows, to the last row',
    b.allRows === 2000, `${b.allRows} lignes`);
  check('going home stops the slices still to come',
    b.homeDuringSlices.rows === 0 && b.homeDuringSlices.welcome,
    `${b.homeDuringSlices.rows} lignes après l'accueil`);
  check('a search hit at the far end is painted before it is scrolled to',
    b.deep.atFirstPaint && b.deep.highlighted && b.deep.inView,
    `peint=${b.deep.atFirstPaint} surligné=${b.deep.highlighted} visible=${b.deep.inView}`);
  check('a message arriving adds its row and repaints nothing else',
    b.extended.rows === 2001 && b.extended.untouched && b.extended.top.includes('arrivé au bout'),
    `${b.extended.rows} lignes, repère ${b.extended.untouched ? 'intact' : 'perdu'}`);

  // -- exporting and copying -------------------------------------------------
  const ex = r.exportCheck;
  check('Exporter opens a menu offering Markdown and PDF',
    ex.menuOpen.visible && ex.menuOpen.expanded === 'true'
      && ex.menuOpen.items.join('|') === 'Markdown (.md)|PDF (.pdf)',
    ex.menuOpen.items.join(' | '));
  check('each choice asks for this conversation, in that format, and says where it went',
    JSON.stringify(ex.calls.slice(0, 2)) === JSON.stringify([
      { id: 'claude:s1', format: 'md', newestFirst: true },
      { id: 'claude:s1', format: 'pdf', newestFirst: true },
    ]) && ex.afterMd.closed && ex.afterMd.toast.includes('/home/zam/Documents/export.md'),
    `${JSON.stringify(ex.calls)} · ${ex.afterMd.toast}`);
  check('an export follows the order the conversation is shown in',
    ex.calls[2] && ex.calls[2].newestFirst === false, JSON.stringify(ex.calls[2]));
  check('a click elsewhere closes the menu', ex.closesOutside === true);
  check('Copier sends the message’s id — never its text — and says it is done',
    ex.copied.id !== null && ex.copied.calls.join(',') === String(ex.copied.id)
      && ex.copied.label === 'Message copié' && ex.copied.glyph === 'check',
    `id=${ex.copied.id} appels=${ex.copied.calls.join(',')} « ${ex.copied.label} » icône=${ex.copied.glyph}`);
  check('a strip of tool calls offers nothing to copy', ex.copied.onToolRuns === 0);

  // -- icons that speak --------------------------------------------------------
  const silent = ex.icons.buttons.filter((b) => !b.glyph || !b.name);
  check('every button carries an icon, and a name a screen reader can say',
    silent.length === 0 && ex.icons.buttons.length === 14,
    silent.length ? `sans icône ou sans nom : ${silent.map((b) => b.id).join(', ')}` : `${ex.icons.buttons.length} boutons`);
  check('each icon fits its action',
    ex.icons.buttons.map((b) => b.glyph).join(',') ===
      'star,note,sortNewest,download,terminal,copy,folderOpen,refresh,settings,chevronUp,chevronDown,close,fileText,printer',
    ex.icons.buttons.map((b) => `${b.id}=${b.glyph}`).join(' '));
  check('icons are decoration: every one is hidden from screen readers', ex.icons.allHidden);

  // -- a conversation a compaction cut in two --------------------------------
  const ch = r.chainCheck;
  check('a split conversation says which part is on screen',
    ch.first.hidden === false && ch.first.label === 'Partie 1 sur 2'
      && ch.first.previous === true && ch.first.next === false,
    JSON.stringify(ch.first));
  check('and goes to the next part, which says the same of itself',
    ch.second.title === 'Session Codex B' && ch.second.label === 'Partie 2 sur 2'
      && ch.second.previous === false && ch.second.next === true,
    JSON.stringify(ch.second));
  check('a conversation nobody compacted says nothing about parts', ch.alone === true);

  // -- what a resumed conversation copied from another ----------------------
  const cp = r.copiedCheck;
  check('a resumed conversation says how much it copied, and from where',
    cp.shown && cp.text.includes('12 messages') && cp.text.includes('« Session Codex A »')
      && cp.button === "Ouvrir l'original",
    JSON.stringify(cp));
  check('and its button opens the conversation the copies came from',
    cp.openedTitle === 'Session Codex A' && cp.hiddenOnOriginal === true, JSON.stringify(cp));
  check('a conversation that copied nothing shows no such line', cp.hiddenElsewhere === true);

  // -- the person's own marks: a star and a note ------------------------------
  const mk = r.marksCheck;
  const id = 'claude:s1';
  check('starring a conversation marks it in its header and in the list',
    mk.before === 'false' && mk.starred.pressed === 'true' && mk.starred.filled && mk.starred.inTree
      && mk.starred.stored[id] && mk.starred.stored[id].favorite === true,
    JSON.stringify(mk.starred));
  check('the star says which way it goes, for a screen reader too',
    mk.starred.label.includes('favori'), mk.starred.label);
  check('a note is written as it is typed, and says so',
    mk.noteOpen && mk.noted.stored[id].note === 'le calcul de <ponder()> est ici'
      && mk.noted.status === 'Note enregistrée',
    JSON.stringify(mk.noted));
  check('the starred view shows the marked conversations, and their notes, as text',
    mk.favView.pressed === 'true' && mk.favView.rows === 1 && mk.favView.folders === 0
      && mk.favView.starred && mk.favView.sub.includes('<ponder()>'),
    JSON.stringify(mk.favView));
  check('and steps aside again', mk.backToFolders);
  check('a single message can be starred, and the outline shows it',
    mk.message.pressed === 'true' && mk.message.filled && mk.message.starredTicks >= 1
      && mk.message.stored[id].messages.length === 1
      && mk.message.stored[id].messages[0].preview.length > 0,
    JSON.stringify(mk.message.stored[id] && mk.message.stored[id].messages));
  check('a starred message is stored by what will find it again, not by a row id',
    mk.message.stored[id].messages[0].seq !== undefined
      && 'uuid' in mk.message.stored[id].messages[0],
    JSON.stringify(mk.message.stored[id].messages[0]));
  check('the starred list shows the message itself, and goes back to it',
    mk.messageRow.length > 0 && mk.jumped.hit === mk.jumped.wanted,
    `« ${mk.messageRow.slice(0, 60)} » → ${mk.jumped.hit} (voulu ${mk.jumped.wanted})`);
  check('the count stands for everything marked, conversations and messages',
    mk.countAfterMessage.includes('2'), mk.countAfterMessage);
  check('a starred conversation and a starred message are told apart',
    mk.sections.join(' | ') === 'Conversations | Messages'
      && mk.messageHasStar === false && mk.messageQuoted.startsWith('«'),
    `${mk.sections.join(' | ')} · étoile=${mk.messageHasStar} · ${mk.messageQuoted.slice(0, 40)}`);

  check('a star and a note are still there when the conversation is reopened',
    mk.reopened.pressed === 'true' && mk.reopened.noteShown
      && mk.reopened.note === 'le calcul de <ponder()> est ici',
    JSON.stringify(mk.reopened));
  check('the starred view stays out of the way until something is starred',
    mk.hiddenAtFirst === true && mk.starred.favVisible === true);
  check('and then says how many, beside its star',
    mk.starred.favRow.includes('Favoris') && mk.starred.favRow.includes('1') && mk.starred.favStar,
    `« ${mk.starred.favRow} » étoile=${mk.starred.favStar}`);

  // -- where a CLI lives: the settings window ---------------------------------
  // ── Le mot cherché, surligné dans la conversation ──────────────────────
  const hl = r.highlightCheck;
  check('the highlight scenario ran at all', !hl.error, hl.error || '');
  check('the searched words are highlighted in the conversation, not only in the snippet',
    hl.marked > 50 && hl.ring, JSON.stringify({ marked: hl.marked, ring: hl.ring }));
  check('a word typed without its accents still marks the accented one',
    hl.words === 'numéro,profond', hl.words);
  check('marks are never nested, however many terms overlap',
    hl.nested === 0, `${hl.nested} imbrication(s)`);
  // Les lignes 1 400 à 1 440 d'une conversation de deux mille : la première
  // tranche en peint 120, elles viennent donc forcément d'une tranche
  // ultérieure. Qu'elles portent toutes la marque, c'est le crochet qui marche.
  check('rows painted long after the conversation opened are highlighted too',
    hl.paintedAfter.rows >= 2000 && hl.paintedAfter.total === 40
      && hl.paintedAfter.marked === hl.paintedAfter.total,
    JSON.stringify(hl.paintedAfter));
  check('clearing the search clears the highlight it caused',
    hl.afterClearing === 0, `${hl.afterClearing} marque(s) restante(s)`);

  // ── Le filtre par assistant ─────────────────────────────────────────────
  const af = r.agentFilterCheck;
  check('the sidebar offers one chip per assistant, named on hover',
    af.start.shown && af.start.ids.join(',') === 'claude,codex'
      && af.start.titles.join(' / ') === 'Claude Code / Codex'
      && af.start.pressed.join(',') === 'true,true' && !af.start.showAll,
    JSON.stringify(af.start));
  check('unchecking an assistant hides it everywhere, and keeps its chip',
    af.hidden.pressed.join(' ') === 'claude=true codex=false'
      && af.hidden.stillListed.join(',') === 'claude,codex'
      && af.hidden.saved.join(',') === 'codex',
    JSON.stringify(af.hidden));
  // Le français met une espace insécable entre le nombre et le nom : on
  // compare des espaces normalisées, pas des octets.
  const footerSays = (text) => String(text).replace(/\s/g, ' ');
  check('the footer agrees with the sidebar rather than with the index',
    footerSays(af.hidden.stats).startsWith(`${af.hidden.folders} dossier`)
      && af.hidden.stats !== af.start.stats,
    `avant : ${af.start.stats} | après : ${af.hidden.stats} | ${af.hidden.folders} dossiers affichés`);
  check('« tout afficher » appears as soon as something is hidden, and brings it back',
    af.hidden.showAll === 'Tout afficher' && af.restored.pressed.join(',') === 'true,true'
      && af.restored.saved.length === 0 && !af.restored.showAll,
    JSON.stringify(af.restored));

  const st = r.settingsCheck;
  check('the gear opens a modal window', st.modal);
  check('it lists the assistants found here or used, and only those',
    st.shown.join(' ') === 'claude codex', st.shown.join(' '));
  check('the cursor lands in the first path',
    st.focused === 'settings-command-claude', st.focused);
  check('each assistant says what was found, and whether it would run',
    st.detected.includes('/home/zam/.local/bin/claude') && st.claudeStatus.includes('Ariane utilisera')
      && st.codexStatus.includes('Introuvable'),
    `${st.claudeStatus} | ${st.codexStatus}`);
  check('a typed path that cannot run is said beside it',
    st.bad.text.includes("/opt/absent/codex n'est pas un programme") && st.bad.cls.includes('bad'),
    JSON.stringify(st.bad));
  check('« Parcourir » fills the path, and it is checked',
    st.browsed.value.endsWith('/bin/codex') && st.browsed.text.includes('Utilisé tel quel'),
    JSON.stringify(st.browsed));
  check('« Ajouter » offers the other assistants Ariane knows',
    st.addMenu.join(',') === 'Copilot CLI,Qwen Code,Gemini CLI', st.addMenu.join(','));
  check('an added assistant gets its row, and the cursor',
    st.afterAdd.includes('copilot-cli') && st.focusAfterAdd === 'settings-command-copilot-cli',
    `${st.afterAdd.join(' ')} / ${st.focusAfterAdd}`);
  check('nothing behind the window reacts to its keys',
    st.behind.resultsClosedBefore && st.behind.title && !st.behind.welcome && st.behind.focusInside,
    JSON.stringify(st.behind));
  check('« Annuler » saves nothing',
    st.cancelled.closed && st.cancelled.saves === 0 && st.reopened.join(' ') === 'claude codex',
    JSON.stringify(st.cancelled));
  check('« Enregistrer » saves exactly what was typed, for the assistants listed',
    st.saved.closed && st.saved.saves.length === 1
      && JSON.stringify(st.saved.saves[0]) === JSON.stringify({ claude: '', codex: '/home/zam/.nvm/versions/node/v22.12.0/bin/codex' })
      && st.saved.toast === 'Réglages enregistrés.',
    JSON.stringify(st.saved));
  check('a saved path is there when the window reopens',
    st.keptPath.endsWith('/bin/codex'), st.keptPath);
  check('the JSON file is one click away, and shows what was typed',
    st.json.closed && st.json.opened === 1 && st.json.saves === 2, JSON.stringify(st.json));
  check('the theme offers the system\'s and the two that override it, named in the language',
    st.theme.options.join(' ') === 'auto=Système light=Clair dark=Sombre' && st.theme.value === 'auto'
      && st.theme.label === 'Thème',
    `${st.theme.label} : ${st.theme.options.join(' ')} (${st.theme.value})`);
  check('choosing a theme saves it, without reloading the window',
    st.themeSaved.closed && st.themeSaved.saved.join(',') === 'dark',
    JSON.stringify(st.themeSaved));
  check('an unreadable file is said, and nothing offered would write it',
    st.unreadable.banner.includes('illisible') && st.unreadable.inputsLocked && st.unreadable.saveLocked
      && st.unreadable.jsonOpen,
    JSON.stringify(st.unreadable));
  check('a CLI that cannot be found is named, and its command copied',
    st.failText.includes('Ariane ne trouve pas « copilot »') && st.failText.includes('Commande copiée'),
    st.failText);
  check('the message opens the window on that assistant, listed even if it was not',
    st.action === 'Ouvrir les réglages' && st.fromFailure.open && st.fromFailure.shown.includes('copilot-cli')
      && st.fromFailure.focused === 'settings-command-copilot-cli',
    JSON.stringify(st.fromFailure));
  check('a magnifier sits before both search fields', ex.icons.glyphs === 2);
  check('flipping the order swaps its icon, and keeps it',
    r.orderCheck.byDefault.glyph === 'sortNewest' && r.orderCheck.flipped.glyph === 'sortOldest',
    `${r.orderCheck.byDefault.glyph} → ${r.orderCheck.flipped.glyph}`);
  check('arming "Oublier" changes its words, not its icon',
    r.forgetCheck.afterOneClick.glyph === 'trash', r.forgetCheck.afterOneClick.glyph);

  // -- the outline -----------------------------------------------------------
  const ol = r.outlineCheck;
  check('the outline marks the person’s messages, and nothing recorded under their name',
    ol.smallTicks.join(',') === '1,6', `traits : ${ol.smallTicks.join(',')}`);
  check('one tick per message of theirs, the newest at the top',
    ol.onBig.count === 1000 && ol.onBig.top === '101998', `${ol.onBig.count} traits, en haut ${ol.onBig.top}`);
  check('a tick at the far end takes the reader there, painted first',
    ol.viaTick.painted && ol.viaTick.inView && ol.viaTick.target,
    `peint=${ol.viaTick.painted} visible=${ol.viaTick.inView} repéré=${ol.viaTick.target}`);
  check('at the very end, Alt+↑ steps from the message just reached',
    ol.nearEnd === '100002', `atteint ${ol.nearEnd}`);
  check('Alt+↓ and Alt+↑ step through the person’s own messages',
    ol.viaKeys.firstDown === '101998' && ol.viaKeys.backUp === '101998',
    `↓ ${ol.viaKeys.firstDown}, ↓↑ ${ol.viaKeys.backUp}`);
  check('the outline leaves with the conversation', ol.outlineOnHome === true);

  // -- finding in the open conversation -------------------------------------
  const fd = r.findCheck;
  check('Ctrl+F opens a find bar on the open conversation',
    fd.opens.visible && fd.opens.focused, `visible=${fd.opens.visible} focus=${fd.opens.focused}`);
  check('it ignores accents, counts messages from the top, and marks the word as written',
    fd.accents.count === '1 / 1999' && fd.accents.mark === 'numéro' && fd.accents.first === '101999',
    `${fd.accents.count}, marque « ${fd.accents.mark} », premier=${fd.accents.first}`);
  check('previous from the first wraps to the far end, painted and shown',
    fd.wrapped.count === '1999 / 1999' && fd.wrapped.id === '100000' && fd.wrapped.inView,
    `${fd.wrapped.count}, ligne ${fd.wrapped.id}, visible=${fd.wrapped.inView}`);
  check('a new search goes to its own first hit',
    fd.retyped.count === '1 / 1' && fd.retyped.id === '100007', `${fd.retyped.count}, ligne ${fd.retyped.id}`);
  check('Échap closes the bar, clears its marks, and stays in the conversation',
    fd.escaped.hidden && fd.escaped.stillOpen && fd.escaped.marksLeft === 0,
    `fermée=${fd.escaped.hidden} conversation=${fd.escaped.stillOpen} marques=${fd.escaped.marksLeft}`);
  check('a word found inside quoted markup is marked as text, never made live',
    fd.inert.marks.includes('alert') && fd.inert.liveScripts === 0,
    `${fd.inert.marks.join(',')} / ${fd.inert.liveScripts} script(s)`);

  // -- a saved conversation, and forgetting it -----------------------------
  const f = r.forgetCheck;
  check('a saved conversation says so in the list', f.onSaved.badge === 'sauvée', f.onSaved.badge);
  check('and in its header, which alone offers to forget it',
    f.onSaved.meta.includes('sauvée par Ariane') && f.onSaved.forgetHidden === false
      && f.onLive.forgetHidden === true,
    `bouton : sauvée=${!f.onSaved.forgetHidden}, vivante=${!f.onLive.forgetHidden}`);
  check('the first click only asks',
    f.afterOneClick.label === 'Oublier définitivement ?' && f.afterOneClick.calls === 0,
    `${f.afterOneClick.label}, ${f.afterOneClick.calls} appel(s)`);
  check('the second forgets it, and it leaves the list',
    f.afterTwoClicks.calls.join(',') === 'claude:f2' && !f.afterTwoClicks.stillListed && f.afterTwoClicks.welcome,
    `oubliées=${f.afterTwoClicks.calls.join(',')}, encore listée=${f.afterTwoClicks.stillListed}`);

  // -- an approximate path --------------------------------------------------
  check('a reconstructed folder path is marked as a guess',
    r.afterFailure.approx === true && r.afterFailure.approxTitle.includes('approximatif'),
    r.afterFailure.approxTitle.replace(/\n/g, ' / '));
  check('a confirmed path carries no such mark', r.afterFailure.exactApprox === false);

  // -- a listing that fails once -------------------------------------------
  check('a failed folder listing collapses instead of looking empty',
    r.afterFailure.found && r.afterFailure.expanded === 'false',
    `aria-expanded=${r.afterFailure.expanded}`);
  check('and the next click retries instead of serving a cached failure',
    (r.afterFailure.sessions || []).some((t) => t.includes('Session fragile')),
    (r.afterFailure.sessions || []).join(' | ') || 'aucune session');

  // -- layout --------------------------------------------------------------
  check('the transcript does not scroll sideways', !r.horizontalOverflow);
  const w = r.outlineCheck.widths;
  check('the outline sits beside the transcript without narrowing it',
    w.outlineShown && Math.abs(w.transcript - w.main) < 2,
    `transcription ${Math.round(w.transcript)} px sur ${Math.round(w.main)} px, plan affiché=${w.outlineShown}`);
  check('every row sits in one centred column',
    r.distinctLefts === 1, `${r.distinctLefts} alignements: ${[...new Set(r.lefts)].join(', ')}`);

  // -- une version plus récente : un bouton qui attend, rien qui s'efface ---
  const WAIT_UPDATE = `(async () => {
    const button = document.getElementById('update');
    for (let i = 0; i < 80 && button.hidden; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const gear = document.getElementById('settings');
    const seen = {
      hidden: button.hidden,
      title: button.title,
      label: button.getAttribute('aria-label') || '',
      icon: button.dataset.iconOnly || '',
      besideGear: button.nextElementSibling === gear,
      toast: document.getElementById('toast').hidden,
    };
    if (!button.hidden) button.click();
    await new Promise((r) => setTimeout(r, 80));
    return { ...seen, opened: await window.api.releaseOpens() };
  })()`;

  const annonce = await updateWindow('0.9.9', WAIT_UPDATE);
  check('une version plus récente fait apparaître un bouton, à côté de l\'engrenage',
    !annonce.hidden && annonce.besideGear,
    `caché=${annonce.hidden} voisin de l'engrenage=${annonce.besideGear} icône=${annonce.icon}`);
  check('son infobulle porte le numéro, et son nom dit quoi en faire',
    annonce.title.includes('0.9.9') && annonce.label.includes('0.9.9') && annonce.label.length > annonce.title.length,
    `${JSON.stringify(annonce.title)} · ${JSON.stringify(annonce.label)}`);
  check('rien ne s\'affiche par-dessus la barre de recherche',
    annonce.toast, `toast caché=${annonce.toast}`);
  check('un clic ouvre la page, et rien d\'autre ne part',
    annonce.opened === 1, `ouvertures : ${annonce.opened}`);

  const silence = await updateWindow(null, WAIT_UPDATE);
  check('à jour, le bouton n\'apparaît jamais',
    silence.hidden && silence.opened === 0, `caché=${silence.hidden} ouvertures=${silence.opened}`);

  return report();
}

/** Set once the results are out: quitting before that is a failure. */
let reported = false;

function report() {
  reported = true;
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(`\n# render checks ${results.length} | pass ${results.length - failed.length} | fail ${failed.length}`);
  return failed.length === 0 ? 0 : 1;
}

// The suite closes its windows before it is done — the PDF check opens and
// destroys one of its own after the main window is gone — and Electron quits
// by default once none is left: with exit code 0 and not one line printed.
// The suite decides when it ends, through app.exit below.
app.on('window-all-closed', () => {});

// And should anything else end the run early, it fails — loudly. A suite that
// stops with exit code 0 and nothing checked is the worst result it can give.
app.on('will-quit', (event) => {
  if (reported) return;
  event.preventDefault();
  console.error('FAIL la suite s\'est arrêtée avant de rendre ses résultats');
  app.exit(1);
});

app.whenReady()
  .then(run)
  .then((code) => app.exit(code))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
