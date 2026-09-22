/**
 * Renderer logic.
 *
 * Runs sandboxed: no Node, no network. Everything it knows comes from
 * `window.api`, the narrow bridge defined in preload.js.
 *
 * DOM rule, applied without exception: text goes in through `textContent`, and
 * `innerHTML` is only ever fed the output of format.js, which escapes first and
 * decorates second.
 */

import {
  renderMarkdown,
  renderSnippet,
  folderLabel,
  preview,
  speakerOf,
  commandLabel,
  groupMessages,
  describeToolRun,
  agentTheme,
  groupSessionsByAgent,
  findRanges,
  foldForSearch,
} from './format.js';
import { TranscriptView } from './transcript-view.js';
import { icon, setButton, setIconButton } from './icons.js';
import { SettingsDialog } from './settings-dialog.js';
import { createLocalizer } from './l10n.js';
import { localize, localizeElement } from './l10n-dom.js';

const api = window.api;

/** Debounce for the search box: long enough to stop thrashing, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 130;

/**
 * How a conversation opens: its latest message at the top. Each conversation
 * can be flipped on its own, for as long as the app runs.
 */
const NEWEST_FIRST_BY_DEFAULT = true;

/** Where a reload for a new language remembers the open conversation. */
const REOPEN_KEY = 'ariane.reopen';

/** A note is saved as it is written, once the typing pauses. */
const NOTE_SAVE_MS = 600;

/**
 * How far back a search reaches. The keys are the main process's (see
 * src/core/period.js), which computes the bound: the renderer only names it,
 * and says so when the period is why nothing matched.
 */
const PERIODS = {
  all: { label: 'period-all', none: 'results-none' },
  '7d': { label: 'period-7d', none: 'results-none-7d' },
  '30d': { label: 'period-30d', none: 'results-none-30d' },
  year: { label: 'period-year', none: 'results-none-year' },
};

/**
 * The words of the language in use (l10n.js), loaded before anything is
 * shown. Every sentence on screen goes through `t`: index.html holds none.
 */
let l10n = null;
const t = (id, args) => l10n.t(id, args);

/**
 * An earlier build stored ONE reading order for every conversation. Nothing
 * reads it any more; it is removed so that nothing stale lingers.
 */
function forgetLegacyOrder() {
  try {
    window.localStorage.removeItem('ariane.newestFirst');
  } catch {
    /* storage unavailable: then there is nothing to forget either */
  }
}

const state = {
  agents: [],
  /** Assistants with conversations, as the sidebar filter lists them. */
  agentsInIndex: [],
  /** @type {Set<string>} Assistants the person chose not to see. */
  hidden: new Set(),
  folders: [],
  /** @type {Map<number, object[]>} folderId -> sessions */
  sessionsByFolder: new Map(),
  expanded: new Set(),
  currentSessionId: null,
  currentFolderId: null,
  /** Display name of the agent whose conversation is open; never hardcoded. */
  currentAgentLabel: 'Assistant',
  /** 'all' | 'folder' | 'session' | `agent:<id>` */
  scope: 'all',
  /** A key of PERIODS: how far back the search reaches. */
  period: 'all',
  /** What the person marked on the open conversation (marks.js). */
  favorite: false,
  note: '',
  /** The starred conversations, and whether the sidebar is showing them alone. */
  favorites: [],
  favoritesOnly: false,
  /** Row ids of the starred messages in the open conversation (resolved by marks.js). */
  starred: new Set(),
  /** The parts of a conversation a compaction split in two or more. */
  chain: [],
  results: [],
  activeResult: -1,
  filter: '',
  busy: false,
  /** The resume command for the open conversation, for the copy button. */
  resumeCommand: null,
  /**
   * Bumped by every openSession call. Two clicks in quick succession both
   * await; without this the slower reply wins the DOM, and the transcript ends
   * up showing one conversation under another one's title.
   */
  openToken: 0,
  /** How many messages the open conversation had when it was painted. */
  openMessageCount: 0,
  /** When the last pass finished, so a focus right after one is not another. */
  lastPassAt: 0,
  autoBusy: false,
  /** The messages last painted, so the order can be flipped without a round trip. */
  openMessages: null,
  /** Whether the open conversation shows its latest message at the top. */
  newestFirst: NEWEST_FIRST_BY_DEFAULT,
  /**
   * The conversations flipped away from the default order, by id. The order
   * belongs to each conversation — flipping one leaves every other as it was —
   * and it lasts as long as the app does: on the next launch, every
   * conversation opens in the default order again. Deliberately never stored.
   */
  flipped: new Set(),
  /**
   * Finding in the open conversation: the messages whose text holds the
   * words, in the order they stand on screen, and which one is shown.
   */
  find: { hits: [], index: -1 },
  /**
   * The words a search was made of, kept while the conversation it led to is
   * open. They are marked wherever they appear, not only in the message the
   * result pointed at: someone who searched for a word wants to see the word.
   */
  searchTerms: [],
  /** Where the last jump through the outline landed, as a row index. */
  outlineAt: null,
  /** The conversation whose "Oublier" was clicked once, awaiting the second click. */
  forgetArmedFor: null,
  forgetTimer: null,
};

/** How often, while the window is visible, the index looks for new conversations. */
const AUTO_REFRESH_MS = 30 * 1000;
/** Returning to the window triggers a pass, unless one has just finished. */
const FOCUS_REFRESH_GAP_MS = 5 * 1000;
/** Typing in the find bar waits this long before looking. */
const FIND_DEBOUNCE_MS = 150;
/** "Oublier" waits this long for its confirming second click, then stands down. */
const FORGET_CONFIRM_MS = 5 * 1000;
/** Within this distance of the bottom, the reader is following along. */
const STICK_TO_BOTTOM_PX = 40;

const el = {
  tree: document.getElementById('tree'),
  filter: document.getElementById('filter'),
  refresh: document.getElementById('refresh'),
  settings: document.getElementById('settings'),
  settingsDialog: document.getElementById('settings-dialog'),
  favorite: document.getElementById('favorite'),
  part: document.getElementById('part'),
  partLabel: document.getElementById('part-label'),
  partPrevious: document.getElementById('part-previous'),
  partNext: document.getElementById('part-next'),
  favorites: document.getElementById('favorites'),
  noteToggle: document.getElementById('note-toggle'),
  note: document.getElementById('note'),
  noteInput: document.getElementById('note-input'),
  noteStatus: document.getElementById('note-status'),
  stats: document.getElementById('stats'),
  agentFilter: document.getElementById('agent-filter'),
  transcript: document.getElementById('transcript'),
  convoHead: document.getElementById('convo-head'),
  convoTitle: document.getElementById('convo-title'),
  convoMeta: document.getElementById('convo-meta'),
  openFolder: document.getElementById('open-folder'),
  resume: document.getElementById('resume'),
  exportButton: document.getElementById('export'),
  exportMenu: document.getElementById('export-menu'),
  order: document.getElementById('order'),
  forget: document.getElementById('forget'),
  outline: document.getElementById('outline'),
  find: document.getElementById('find'),
  findInput: document.getElementById('find-input'),
  findCount: document.getElementById('find-count'),
  findPrev: document.getElementById('find-prev'),
  findNext: document.getElementById('find-next'),
  findClose: document.getElementById('find-close'),
  copyCmd: document.getElementById('copy-cmd'),
  search: document.getElementById('search'),
  searchHint: document.getElementById('search-hint'),
  scope: document.getElementById('scope'),
  period: document.getElementById('period'),
  results: document.getElementById('results'),
  toast: document.getElementById('toast'),
  home: document.getElementById('home'),
};

/** The open conversation's rows, painted in slices; see transcript-view.js. */
const view = new TranscriptView(
  el.transcript,
  (group) => (group.type === 'toolRun' ? renderToolRun(group.messages) : renderMessage(group.message)),
  { emptyText: '', onPaint: markSearchTerms }
);

/** Where each assistant's CLI lives, and the language; see settings-dialog.js. */
let settingsDialog = null;

// ── Démarrage ────────────────────────────────────────────────────────────

init().catch((error) => toast(error.message, true));

async function init() {
  await loadLanguage();
  wireEvents();
  showWelcome();

  const status = await api.status();
  if (!status.available) {
    el.tree.replaceChildren(node('p', 'tree-empty', t('tree-no-data', { dir: status.dataDir })));
  }

  // Build the index on first launch, and also when an agent is installed (or
  // newly supported) since the last run - otherwise it stays quietly partial.
  const needsIndex =
    !status.lastIndexedAt ||
    status.stats.sessions === 0 ||
    (status.missingAgents && status.missingAgents.length > 0);

  state.agentsInIndex = status.agents || [];
  state.hidden = new Set(status.hiddenAgents || []);
  paintAgentFilter();

  if (needsIndex) {
    await refresh();
  } else {
    await loadFolders();
    setStats(status.stats);
  }

  startAutoRefresh();
  await loadFavorites();

  const reopen = takeReopen();
  if (reopen) await openSession(reopen);

  // Last, and never in the way: the conversations are on screen before anyone
  // is told about a version. Nothing is awaited by what follows it either — a
  // slow network must not hold the window.
  announceUpdate();
}

/**
 * Say that a newer Ariane exists, once, and offer the page that has it.
 *
 * Nothing is downloaded and nothing is run: none of Ariane's packages are
 * signed, so fetching and executing a binary on its own would be asking to be
 * trusted for something it cannot prove. The button opens the release page in
 * the browser, and the rest is the person's.
 *
 * The main process decides whether to ask at all — the setting is read there,
 * before any request leaves the machine. Every other answer, from a refusal to
 * a silent network, is simply a reason to say nothing.
 */
async function announceUpdate() {
  let answer;
  try {
    answer = await api.checkUpdate();
  } catch {
    return; // a bridge that did not answer is not news
  }
  // `call()` unwraps the envelope: what arrives is the decision itself.
  if (!answer || !answer.update) return;

  toast(t('update-available', { version: answer.version }), false, {
    label: t('update-open'),
    run: () => {
      api.openRelease().catch(() => {});
    },
  });
}

/**
 * The language first: the main process chose it (the setting, else the
 * system's) and sends its file with the English one to fall back on.
 */
async function loadLanguage() {
  const locale = await api.locale();
  l10n = createLocalizer({ language: locale.language, sources: locale.sources, pseudo: locale.pseudo === true });
  document.documentElement.lang = l10n.language;
  document.documentElement.dir = l10n.direction;
  localize(document, l10n);
  view.emptyText = t('convo-empty');
  settingsDialog = new SettingsDialog(el.settingsDialog, { api, toast, l10n, onLanguageChange: reloadInPlace });
}

/**
 * Write the window again in a new language. Every word on screen is in the old
 * one, and rebuilding them one by one would miss some: the page is reloaded,
 * and reopens the conversation that was open.
 */
function reloadInPlace() {
  try {
    if (state.currentSessionId) window.sessionStorage.setItem(REOPEN_KEY, state.currentSessionId);
  } catch {
    /* storage unavailable: the reload lands on the start page instead */
  }
  window.location.reload();
}

/** The conversation to reopen after a reload, if one was open. Read once. */
function takeReopen() {
  try {
    const id = window.sessionStorage.getItem(REOPEN_KEY);
    window.sessionStorage.removeItem(REOPEN_KEY);
    return id;
  } catch {
    return null;
  }
}

/** An element whose text and tooltip come from one message. */
function nodeFrom(tag, className, id, args) {
  const element = node(tag, className);
  element.dataset.l10nId = id;
  if (args) element.dataset.l10nArgs = JSON.stringify(args);
  localizeElement(element, l10n);
  return element;
}

/**
 * Every button that says what it does in the markup gets its icon here:
 * `data-icon` beside its label, `data-icon-only` alone (its name then lives in
 * aria-label). Labels that change at run time go through setButton instead.
 */
function decorate() {
  for (const button of document.querySelectorAll('[data-icon]')) {
    setButton(button, { icon: button.dataset.icon, label: button.textContent.trim() });
  }
  for (const button of document.querySelectorAll('[data-icon-only]')) {
    setIconButton(button, { icon: button.dataset.iconOnly, label: button.getAttribute('aria-label') || '' });
  }
  const findGlyph = icon('search');
  findGlyph.classList.add('find-glyph');
  el.find.prepend(findGlyph);
  const searchGlyph = icon('search');
  searchGlyph.classList.add('composer-glyph');
  el.search.before(searchGlyph);
}

function wireEvents() {
  decorate();
  el.refresh.addEventListener('click', () => refresh());
  el.settings.addEventListener('click', () => settingsDialog.open());
  el.favorite.addEventListener('click', onToggleFavorite);
  el.partPrevious.addEventListener('click', () => goToPart(-1));
  el.partNext.addEventListener('click', () => goToPart(1));
  el.favorites.addEventListener('click', onToggleFavoritesView);
  el.noteToggle.addEventListener('click', onToggleNote);
  el.noteInput.addEventListener('input', debounce(saveNote, NOTE_SAVE_MS));
  // Leaving the field writes at once: nobody should have to wait to be sure.
  el.noteInput.addEventListener('blur', () => saveNote());
  el.home.addEventListener('click', showWelcome);

  el.filter.addEventListener('input', () => {
    state.filter = el.filter.value.trim().toLowerCase();
    renderTree();
  });

  el.search.addEventListener('input', debounce(runSearch, SEARCH_DEBOUNCE_MS));
  el.search.addEventListener('keydown', onSearchKeydown);
  el.scope.addEventListener('change', onScopeChange);
  renderPeriodOptions();
  el.period.addEventListener('change', onPeriodChange);
  el.openFolder.addEventListener('click', onOpenFolder);
  el.resume.addEventListener('click', onResume);
  el.copyCmd.addEventListener('click', onCopyCommand);
  el.order.addEventListener('click', onToggleOrder);
  el.forget.addEventListener('click', onForget);
  el.exportButton.addEventListener('click', () => (el.exportMenu.hidden ? openExportMenu() : closeExportMenu()));
  el.exportMenu.addEventListener('click', (event) => {
    const item = event.target.closest('[data-format]');
    if (item) onExport(item.dataset.format);
  });
  // One listener for every row's "Copier": a long conversation has thousands.
  el.transcript.addEventListener('click', (event) => {
    const copy = event.target.closest('.msg-copy');
    if (copy) return onCopyMessage(copy);
    const star = event.target.closest('.msg-star');
    if (star) onToggleMessageStar(star);
  });
  el.findInput.addEventListener('input', debounce(() => runFind(), FIND_DEBOUNCE_MS));
  el.findInput.addEventListener('keydown', onFindKeydown);
  el.findNext.addEventListener('click', () => moveFind(1));
  el.findPrev.addEventListener('click', () => moveFind(-1));
  el.findClose.addEventListener('click', closeFind);
  // One listener for every tick: a long conversation has a thousand of them.
  el.outline.addEventListener('click', (event) => {
    const tick = event.target.closest('.outline-tick');
    if (tick) goToMessage(Number(tick.dataset.messageId));
  });
  paintOrderButton();
  forgetLegacyOrder();

  document.addEventListener('keydown', onGlobalKeydown);

  // A click anywhere else dismisses the results overlay.
  document.addEventListener('click', (event) => {
    if (!el.results.hidden && !event.target.closest('.composer')) hideResults();
    if (!el.exportMenu.hidden && !event.target.closest('.menu-wrap')) closeExportMenu();
  });

  api.onIndexProgress(onIndexProgress);
}

// ── Indexation ───────────────────────────────────────────────────────────

async function refresh() {
  if (state.busy) return;
  state.busy = true;
  el.refresh.classList.add('busy');
  el.refresh.disabled = true;

  try {
    const report = await api.refresh();
    state.lastPassAt = Date.now();
    // A pass can index an assistant that had nothing before: the row has to
    // learn about it, or it could never be hidden — nor seen to exist.
    await refreshAgentFilter();
    await loadFolders();
    await refreshOpenConversation();
    setStats(report.stats);

    const parts = [];
    if (report.indexed) parts.push(t('refresh-read', { n: report.indexed }));
    if (report.orphans) parts.push(t('refresh-orphans', { n: report.orphans }));
    if (report.saved) parts.push(t('refresh-saved', { n: report.saved }));
    if (report.restored) parts.push(t('refresh-restored', { n: report.restored }));
    if (report.errors.length) parts.push(t('refresh-errors', { n: report.errors.length }));
    toast(parts.length ? t('refresh-done', { details: l10n.list(parts) }) : t('refresh-up-to-date'));
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    el.refresh.classList.remove('busy');
    el.refresh.disabled = false;
  }
}

/**
 * Keep the index current while the app is open: a pass every 30 s while the
 * window is visible, and one on returning to it. A pass over unchanged files
 * costs about 60 ms, so neither is felt.
 */
function startAutoRefresh() {
  setInterval(() => {
    if (document.visibilityState === 'visible') autoRefresh();
  }, AUTO_REFRESH_MS);

  window.addEventListener('focus', () => {
    if (Date.now() - state.lastPassAt > FOCUS_REFRESH_GAP_MS) autoRefresh();
  });
}

/**
 * A pass nobody asked for, so it says nothing: no toast, no progress in the
 * footer, no error. When it finds something, the sidebar and the open
 * conversation are brought up to date without losing the reader's place.
 */
async function autoRefresh() {
  // A manual refresh in flight covers it; the main process would share it anyway.
  if (state.autoBusy || state.busy) return;
  state.autoBusy = true;
  try {
    const report = await api.refresh({ quiet: true });
    state.lastPassAt = Date.now();
    if (report.indexed > 0 || report.saved > 0 || report.restored > 0) {
      await loadFolders();
      await refreshOpenConversation();
    }
    setStats(report.stats);
    // Silent, except for this: a conversation just lost its only other copy.
    if (report.saved > 0) {
      toast(t('auto-saved', { n: report.saved }));
    }
  } catch {
    /* silent: the next tick tries again */
  } finally {
    state.autoBusy = false;
  }
}

function onIndexProgress(progress) {
  // The indexer emits 'scanning' with a running count and no total, since it
  // streams and cannot know how many sessions there are until it is done.
  if (progress.phase === 'scanning' && progress.done) {
    el.stats.textContent = progress.agent
      ? t('stats-indexing-agent', { agent: agentTheme(progress.agent).label, done: progress.done })
      : t('stats-indexing', { done: progress.done });
  }
}

function setStats(stats) {
  if (!stats) return;
  el.stats.textContent = t('stats', {
    folders: stats.folders,
    sessions: stats.sessions,
    messages: stats.messages,
  });
}

/**
 * Go back to the welcome pane.
 *
 * Also forgets which conversation was open, so the scope list stops offering
 * "cette conversation" for something no longer on screen.
 */
function showWelcome() {
  // Also cancels a conversation still loading, which would otherwise paint
  // itself over the welcome pane a moment after the reader asked for it.
  state.openToken++;
  state.currentSessionId = null;
  state.resumeCommand = null;
  state.openMessages = null;
  state.newestFirst = NEWEST_FIRST_BY_DEFAULT;
  disarmForget();
  closeFind();

  el.convoHead.hidden = true;
  state.chain = [];
  el.part.hidden = true;
  setNoteOpen(false);
  view.detach();
  el.outline.hidden = true;
  el.outline.replaceChildren();
  el.transcript.replaceChildren(welcomePane());
  el.transcript.scrollTop = 0;

  renderTree();
  renderScopeOptions();
}

function welcomePane() {
  const pane = node('div', 'welcome');
  pane.append(
    node('h2', '', t('welcome-title')),
    node('p', '', t('welcome-lead'))
  );

  const hints = node('p', 'kbd-hints');
  const [ctrl, alt, esc] = [t('key-ctrl'), t('key-alt'), t('key-esc')];
  const shortcuts = [
    [[ctrl, 'K'], t('welcome-key-search')],
    [[ctrl, 'F'], t('welcome-key-find')],
    [[alt, '↑↓'], t('welcome-key-own')],
    [[ctrl, 'R'], t('welcome-key-reindex')],
    [[esc], t('welcome-key-home')],
  ];
  shortcuts.forEach(([keys, label], i) => {
    if (i > 0) hints.append(document.createTextNode(' · '));
    keys.forEach((key, k) => {
      if (k > 0) hints.append(document.createTextNode('+'));
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      hints.append(kbd);
    });
    hints.append(document.createTextNode(` ${label}`));
  });

  pane.append(hints);
  return pane;
}

// ── Filtre par assistant ─────────────────────────────────────────────────

/**
 * The row of chips under the filter field: one per assistant that has
 * conversations, hidden ones included — otherwise nothing could bring one back.
 *
 * The choice is not a view state: it lives in settings.json and holds from one
 * launch to the next, which is also why a way out must stay in sight. As soon
 * as anything is hidden, "tout afficher" appears, so a conversation can never
 * be lost behind a chip somebody forgot they clicked.
 */
function paintAgentFilter() {
  const agents = state.agentsInIndex;
  // One assistant and nothing to choose between: the row would be furniture.
  el.agentFilter.hidden = agents.length < 2;
  if (el.agentFilter.hidden) {
    el.agentFilter.replaceChildren();
    return;
  }

  const children = agents.map((agent) => {
    const shown = !state.hidden.has(agent.id);
    const button = node('button', 'agent-toggle');
    button.type = 'button';
    button.dataset.agent = agent.id;
    button.setAttribute('aria-pressed', String(shown));
    // What the person asked for: the assistant's name under the pointer. A
    // proper name, so it is not a sentence to translate.
    button.title = agent.label;
    button.setAttribute('aria-label', agent.label);
    button.append(node('span', 'agent-dot', agentTheme(agent.id, agent.label).initial));
    button.addEventListener('click', () => toggleAgent(agent.id));
    return button;
  });

  if (state.hidden.size > 0) {
    const all = nodeFrom('button', 'agent-show-all', 'agents-show-all');
    all.type = 'button';
    all.addEventListener('click', () => setHiddenAgents([]));
    children.push(all);
  }
  el.agentFilter.replaceChildren(...children);
}

/** After a pass: which assistants have conversations may have changed. */
async function refreshAgentFilter() {
  try {
    const status = await api.status();
    state.agentsInIndex = status.agents || [];
    state.hidden = new Set(status.hiddenAgents || []);
    paintAgentFilter();
  } catch {
    /* the row keeps what it had: a stale chip is better than none */
  }
}

function toggleAgent(id) {
  const next = new Set(state.hidden);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  // Hiding the last one would leave an empty sidebar and no way to read it.
  if (next.size >= state.agentsInIndex.length) return;
  return setHiddenAgents([...next]);
}

async function setHiddenAgents(ids) {
  let view;
  try {
    view = await api.hideAgents(ids);
  } catch (error) {
    toast(error.message, true);
    return;
  }
  state.hidden = new Set(view.hiddenAgents);
  state.agentsInIndex = view.agents;
  paintAgentFilter();
  // The file belongs to the person; if it cannot be written, say so and keep
  // the choice for this session rather than pretending nothing happened.
  if (!view.saved) toast(t('error-settings-unreadable', { error: view.error }), true);

  await loadFolders();
  setStats(view.stats);
  if (state.results.length || el.search.value.trim()) await runSearch();
}

// ── Arborescence ─────────────────────────────────────────────────────────

async function loadFolders() {
  // Agents first: the sidebar and the scope list both label themselves from it.
  try {
    state.agents = await api.agents();
  } catch {
    state.agents = [];
  }
  state.folders = await api.folders();

  // Folders the reader had open stay open, with their lists fetched again.
  // Clearing the cache alone left each of them on "Chargement…" for good:
  // nothing reloads a list but expanding the folder.
  const known = new Set(state.folders.map((f) => f.id));
  const open = [...state.expanded].filter((id) => known.has(id));
  const lists = await Promise.all(
    open.map((id) => api.sessions(id).then((sessions) => [id, sessions], () => [id, null]))
  );

  state.sessionsByFolder.clear();
  state.expanded = new Set();
  for (const [id, sessions] of lists) {
    if (!sessions) continue; // a failed list collapses, as in toggleFolder
    state.expanded.add(id);
    state.sessionsByFolder.set(id, sessions);
  }

  const scroll = el.tree.scrollTop;
  renderTree();
  el.tree.scrollTop = scroll;
  renderScopeOptions();
}

function renderTree() {
  if (state.favoritesOnly) return renderFavorites();

  const folders = state.filter
    ? state.folders.filter((f) => f.path.toLowerCase().includes(state.filter))
    : state.folders;

  if (folders.length === 0) {
    el.tree.replaceChildren(
      node('p', 'tree-empty', t(state.filter ? 'tree-no-match' : 'tree-empty'))
    );
    return;
  }

  el.tree.replaceChildren(...folders.map(renderFolder));
}

function renderFolder(folder) {
  const { name, parent } = folderLabel(folder.path);
  const expanded = state.expanded.has(folder.id);

  const button = node('button', 'folder-btn');
  button.type = 'button';
  button.setAttribute('aria-expanded', String(expanded));
  button.title = folder.path;

  const names = node('span', 'folder-names');
  names.append(node('span', 'folder-name', name), node('span', 'folder-parent', parent));

  const marks = node('span', 'agent-marks');
  for (const id of String(folder.agentIds || '').split(',').filter(Boolean).sort()) {
    const theme = agentTheme(id, labelOfAgent(id));
    const dot = node('span', 'agent-dot', theme.initial);
    dot.dataset.agent = id;
    dot.title = theme.label;
    marks.append(dot);
  }

  button.append(
    node('span', 'chev'),
    names,
    marks,
    node('span', 'count', String(folder.sessionCount))
  );
  button.addEventListener('click', () => toggleFolder(folder.id));

  const wrapper = node('div', 'folder');
  if (!folder.existsOnDisk) {
    wrapper.classList.add('orphan');
    button.title = `${folder.path}\n${t('folder-purged-note')}`;
  }
  // A path no adapter could confirm: decoded from a directory name, which is a
  // lossy encoding. Saying so is the difference between a record and a guess.
  if (folder.pathExact === 0) {
    wrapper.classList.add('approx');
    button.title = `${button.title}\n${t('folder-approximate-note')}`;
  }
  wrapper.append(button);

  if (expanded) {
    const sessions = state.sessionsByFolder.get(folder.id);
    wrapper.append(
      sessions ? renderSessions(sessions) : node('p', 'tree-empty', t('tree-loading'))
    );
  }
  return wrapper;
}

function renderSessions(sessions) {
  const wrapper = node('div', 'sessions-wrap');
  // Two agents in one folder must read as two lists, not one mixed one.
  for (const group of groupSessionsByAgent(sessions)) {
    const theme = agentTheme(group.agentId, labelOfAgent(group.agentId));
    const head = node('div', 'agent-head');
    const chip = node('span', 'agent-chip', theme.label);
    chip.dataset.agent = group.agentId;
    head.append(chip, node('span', 'agent-count', String(group.sessions.length)));
    wrapper.append(head, sessionList(group.sessions, group.agentId));
  }
  return wrapper;
}

function sessionList(sessions, agentId) {
  const list = node('ul', 'sessions');
  list.dataset.agent = agentId;
  for (const session of sessions) {
    const button = node('button', 'session-btn');
    button.type = 'button';
    if (session.id === state.currentSessionId) button.setAttribute('aria-current', 'true');

    const title = node('span', 'session-title');
    if (session.favorite) title.append(starMark());
    title.append(session.title || preview(session.firstPrompt, 60) || t('session-untitled'));
    if (session.source === 'archive') {
      title.append(nodeFrom('span', 'badge-history badge-saved', 'session-badge-saved'));
    } else if (session.source === 'history') {
      title.append(nodeFrom('span', 'badge-history', 'session-badge-prompts'));
    }

    const sub = node('span', 'session-sub');
    sub.textContent = t('session-summary', { when: l10n.ago(session.lastAt), count: session.messageCount });

    button.append(title, sub);
    button.addEventListener('click', () => openSession(session.id));

    const item = document.createElement('li');
    item.append(button);
    list.append(item);
  }
  return list;
}

/** The star that marks a row in the list: decoration, the row says the rest. */
function starMark() {
  const mark = node('span', 'session-star');
  mark.append(icon('star', { filled: true }));
  return mark;
}

// ── Les repères : l'étoile et la note ────────────────────────────────────

/**
 * The starred conversations, in their own view: a star is what someone looks
 * for without remembering which folder it was in, and a folder's sessions are
 * only loaded when that folder is opened.
 */
async function loadFavorites() {
  try {
    state.favorites = await api.favorites();
  } catch {
    state.favorites = [];
  }
  // Built here rather than in the markup: localising an element replaces its
  // content, so a count left inside it would be wiped at every language pass.
  // Conversations AND messages: the row stands for everything marked.
  const count = state.favorites.reduce(
    (total, session) => total + (session.favorite ? 1 : 0) + (session.messages || []).length,
    0
  );
  el.favorites.replaceChildren(
    icon('star', { filled: true }),
    node('span', 'favorites-label', t('favorites-view')),
    node('span', 'favorites-count', count ? l10n.number(count) : '')
  );
  el.favorites.hidden = count === 0 && !state.favoritesOnly;
}

function onToggleFavoritesView() {
  state.favoritesOnly = !state.favoritesOnly;
  el.favorites.setAttribute('aria-pressed', String(state.favoritesOnly));
  renderTree();
}

/**
 * Two sections rather than one list: a starred conversation and a starred
 * message are different things, and one star for both made them look alike
 * (the reader said so). The heading says which is which; a message shows its
 * own words, quoted, with its conversation underneath.
 */
function renderFavorites() {
  if (state.favorites.length === 0) {
    el.tree.replaceChildren(node('p', 'tree-empty', t('favorites-empty')));
    return;
  }
  const children = [];
  const starred = state.favorites.filter((session) => session.favorite);
  if (starred.length) {
    children.push(node('div', 'results-group', t('favorites-conversations')));
    for (const session of starred) children.push(favoriteRow(session));
  }

  const messages = state.favorites.flatMap((session) =>
    (session.messages || []).map((message) => ({ session, message }))
  );
  if (messages.length) {
    children.push(node('div', 'results-group', t('favorites-messages')));
    for (const { session, message } of messages) children.push(favoriteMessageRow(session, message));
  }
  el.tree.replaceChildren(...children);
}

function favoriteRow(session) {
  const button = node('button', 'session-btn favorite-row');
  button.type = 'button';
  if (session.id === state.currentSessionId) button.setAttribute('aria-current', 'true');

  const title = node('span', 'session-title');
  title.append(starMark(), session.title || preview(session.firstPrompt, 60) || t('session-untitled'));

  const sub = node('span', 'session-sub');
  sub.textContent = session.note
    ? preview(session.note, 70)
    : t('session-summary', { when: l10n.ago(session.lastAt), count: session.messageCount });

  button.append(title, sub);
  button.addEventListener('click', () => openSession(session.id));

  const item = document.createElement('li');
  item.append(button);
  const list = node('ul', 'sessions');
  list.dataset.agent = session.agentId;
  list.append(item);
  return list;
}

/** A starred message, in the list: its own words, and the way back to it. */
function favoriteMessageRow(session, message) {
  const button = node('button', 'session-btn favorite-row favorite-message');
  button.type = 'button';

  // Quoted, and with no star: the section heading already said what it is,
  // and the quotation marks say these are the message's own words.
  const title = node('span', 'session-title');
  title.textContent = t('favorites-quote', { text: preview(message.preview || '', 70) });

  const sub = node('span', 'session-sub');
  sub.textContent = session.title || t('session-untitled');

  button.append(title, sub);
  button.addEventListener('click', () => openSession(session.id, null, { starred: message.preview }));

  const item = document.createElement('li');
  item.append(button);
  const list = node('ul', 'sessions');
  list.dataset.agent = session.agentId;
  list.append(item);
  return list;
}

/**
 * A compaction opened a new transcript: say which part this is, and offer the
 * others. The parts stay separate conversations — separate files, separate
 * dates, separate counts — and this is the thread between them.
 */
function paintChain(sessionId) {
  const at = state.chain.findIndex((part) => part.id === sessionId);
  el.part.hidden = state.chain.length < 2 || at < 0;
  if (el.part.hidden) return;

  const message = l10n.message('convo-part', { n: at + 1, total: state.chain.length });
  el.partLabel.textContent = message.value;
  if (message.attributes.title) el.part.title = message.attributes.title;
  el.partPrevious.disabled = at === 0;
  el.partNext.disabled = at === state.chain.length - 1;
}

/** One part earlier, or one later, in the same conversation. */
function goToPart(step) {
  const at = state.chain.findIndex((part) => part.id === state.currentSessionId);
  const next = state.chain[at + step];
  if (next) openSession(next.id);
}

function paintFavorite() {
  setIconButton(el.favorite, {
    icon: 'star',
    filled: state.favorite,
    label: t(state.favorite ? 'mark-favorite-on' : 'mark-favorite'),
  });
  el.favorite.setAttribute('aria-pressed', String(state.favorite));
  el.favorite.classList.toggle('on', state.favorite);
}

async function onToggleFavorite() {
  const id = state.currentSessionId;
  if (!id) return;
  let mark;
  try {
    mark = await api.markSession(id, { favorite: !state.favorite });
  } catch (error) {
    return toast(error.message, true);
  }
  state.favorite = mark.favorite;
  paintFavorite();
  markInTree(id, mark);
  await loadFavorites();
  renderTree();
}

function setNoteOpen(open) {
  el.note.hidden = !open;
  el.noteToggle.setAttribute('aria-expanded', String(open));
  el.noteToggle.classList.toggle('on', open);
}

function onToggleNote() {
  const open = el.note.hidden;
  setNoteOpen(open);
  if (open) el.noteInput.focus();
  else saveNote();
}

/** Written as it is typed: what is on screen is what is stored. */
async function saveNote() {
  const id = state.currentSessionId;
  if (!id) return;
  const note = el.noteInput.value;
  if (note === state.note) return;
  let mark;
  try {
    mark = await api.markSession(id, { note });
  } catch (error) {
    return toast(error.message, true);
  }
  state.note = mark.note;
  el.noteStatus.textContent = t('mark-note-saved');
  clearTimeout(state.noteTimer);
  state.noteTimer = setTimeout(() => {
    el.noteStatus.textContent = '';
  }, 2000);
  markInTree(id, mark);
  await loadFavorites();
  if (state.favoritesOnly) renderTree();
}

/** Keep the lists in step with the mark, without asking the index again. */
function markInTree(id, mark) {
  for (const sessions of state.sessionsByFolder.values()) {
    const session = sessions.find((s) => s.id === id);
    if (session) Object.assign(session, { favorite: mark.favorite, note: mark.note });
  }
  renderTree();
}

function labelOfAgent(agentId) {
  const found = state.agents.find((a) => a.id === agentId);
  return found ? found.label : '';
}

async function toggleFolder(folderId) {
  if (state.expanded.has(folderId)) {
    state.expanded.delete(folderId);
    renderTree();
    return;
  }

  state.expanded.add(folderId);
  renderTree();

  if (!state.sessionsByFolder.has(folderId)) {
    try {
      state.sessionsByFolder.set(folderId, await api.sessions(folderId));
    } catch (error) {
      // Not cached as empty: that would leave the folder looking empty for the
      // rest of the session, with no way to retry but a restart. Forgetting it
      // means the next click tries again.
      state.sessionsByFolder.delete(folderId);
      state.expanded.delete(folderId);
      toast(error.message, true);
    }
    renderTree();
  }
}

// ── Lecture d'une conversation ───────────────────────────────────────────

async function openSession(sessionId, highlightMessageId = null, { starred = null, terms = [] } = {}) {
  const token = ++state.openToken;
  /** Has another conversation been asked for while this one was loading? */
  const superseded = () => token !== state.openToken;

  let payload;
  try {
    payload = await api.session(sessionId);
  } catch (error) {
    return superseded() ? undefined : toast(error.message, true);
  }
  if (superseded()) return;
  if (!payload) return toast(t('convo-not-found'), true);

  const { session, messages } = payload;
  state.starred = new Set(payload.favoriteMessages || []);
  state.chain = payload.chain || [];
  state.currentSessionId = session.id;
  state.currentFolderId = session.folderId;
  disarmForget();
  closeFind();
  // Set BEFORE anything is painted: the view marks every slice it paints, the
  // first one included. A conversation opened from anywhere else clears the
  // highlight rather than carrying the last search into a conversation that has
  // nothing to do with it.
  state.searchTerms = terms;
  unmark('search-hit');
  // Its own order, not the last one used: the default, unless this very
  // conversation was flipped.
  state.newestFirst = state.flipped.has(session.id)
    ? !NEWEST_FIRST_BY_DEFAULT
    : NEWEST_FIRST_BY_DEFAULT;
  paintOrderButton();

  // Reveal it in the tree, loading the folder's sessions if needed.
  if (!state.expanded.has(session.folderId)) await toggleFolder(session.folderId);
  else renderTree();
  if (superseded()) return;

  paintHeader(session);
  el.openFolder.hidden = false;
  el.openFolder.dataset.path = session.folderPath;
  updateResumeButton(session.id);

  renderScopeOptions();
  paintTranscript(messages);

  // Asked for from the starred list: land on that very message.
  if (starred && state.starred.size) {
    const wanted = messages.find(
      (m) => state.starred.has(m.id) && preview(m.text, 160) === preview(starred, 160)
    );
    highlightMessageId = wanted ? wanted.id : [...state.starred][0];
  }

  if (highlightMessageId != null) {
    // Possibly thousands of rows down, not painted yet: rowOf paints up to it.
    const target = view.rowOf(highlightMessageId);
    if (target) {
      target.classList.add('is-hit');
      // A jump, not an animation: a hit can be 185 000 px away, and the reader
      // wants to land on it, not watch the whole conversation scroll past.
      target.scrollIntoView({ block: 'center' });
      return;
    }
  }
  el.transcript.scrollTop = 0;
}

/**
 * One strip standing in for a whole run of tool calls. Collapsed by default:
 * the machinery is available, but it no longer buries the conversation.
 */
function renderToolRun(messages) {
  const { errors, kind, count, label } = describeToolRun(messages);
  const heading = t(`tool-run-${kind}`, { n: count });

  const details = node('details', 'fold tool-run');
  // Carry the ids so a search hit inside the run can still be scrolled to.
  details.dataset.messageIds = messages.map((m) => m.id).join(' ');

  const summary = document.createElement('summary');
  summary.append(node('span', '', heading));
  if (label) summary.append(node('span', 'fold-tag', label));
  if (errors) summary.append(node('span', 'fold-tag error', t('tool-errors', { n: errors })));

  const when = messages[0] && messages[0].ts ? l10n.dateTime(messages[0].ts) : '';
  if (when) summary.append(node('span', 'when', when));

  const body = node('div', 'tool-run-body');
  for (const message of messages) {
    for (const part of message.parts || []) appendPart(body, part, message);
  }

  details.append(summary, body);
  const wrapper = node('article', 'msg msg-toolrun');
  wrapper.dataset.messageId = String(messages[0] ? messages[0].id : '');
  wrapper.append(details);
  return wrapper;
}

function renderMessage(message) {
  const wrapper = node('article', `msg msg-${message.role === 'user' ? 'user' : 'assistant'}`);
  if (message.isNotice) wrapper.classList.add('msg-notice');
  wrapper.dataset.messageId = String(message.id);

  const head = node('div', 'msg-head');
  // Null means nobody said it: tool output, or a harness notice.
  const speaker = speakerOf(message);
  if (speaker) head.append(node('span', 'who', speaker === 'you' ? t('speaker-you') : state.currentAgentLabel));
  else wrapper.classList.add('msg-unattributed');
  if (message.ts) {
    const when = node('span', 'when', l10n.dateTime(message.ts));
    when.title = message.ts;
    head.append(when);
  }
  if (message.command) {
    head.append(node('span', 'fold-tag', commandLabel(message.command, l10n)));
  }
  if (message.text && message.text.trim()) {
    head.append(messageStar(message.id), messageCopy(message.id));
  }

  const body = node('div', 'msg-body');
  if (message.text) {
    // Safe: renderMarkdown escapes before decorating (see format.js).
    body.innerHTML = renderMarkdown(message.text);
  }

  for (const part of message.parts) appendPart(body, part, message);
  wrapper.append(head, body);
  return wrapper;
}

/** The star on one message: the thing someone came back for, inside the conversation. */
function messageStar(id) {
  const on = state.starred.has(id);
  const button = node('button', `msg-star${on ? ' on' : ''}`);
  button.type = 'button';
  button.dataset.messageId = String(id);
  button.setAttribute('aria-pressed', String(on));
  setIconButton(button, { icon: 'star', filled: on, label: t(on ? 'mark-message-on' : 'mark-message') });
  return button;
}

function messageCopy(id) {
  const copy = node('button', 'msg-copy');
  copy.type = 'button';
  setIconButton(copy, { icon: 'copy', label: t('message-copy') });
  copy.dataset.messageId = String(id);
  return copy;
}

async function onToggleMessageStar(button) {
  const id = state.currentSessionId;
  const messageId = Number(button.dataset.messageId);
  if (!id || !Number.isInteger(messageId)) return;
  let starred;
  try {
    starred = await api.markMessage(id, messageId, !state.starred.has(messageId));
  } catch (error) {
    return toast(error.message, true);
  }
  state.starred = new Set(starred);
  // Only the row that changed: a conversation of six thousand stays untouched.
  const row = el.transcript.querySelector(`.msg[data-message-id="${messageId}"]`);
  const old = row && row.querySelector('.msg-star');
  if (old) old.replaceWith(messageStar(messageId));
  paintOutline();
  await loadFavorites();
  if (state.favoritesOnly) renderTree();
}

function paintHeader(session) {
  el.convoHead.hidden = false;
  el.convoTitle.textContent = session.title || t('session-untitled');

  const theme = agentTheme(session.agentId, labelOfAgent(session.agentId));
  state.currentAgentLabel = theme.label;
  const bits = [theme.label, session.folderPath];
  if (session.gitBranch) bits.push(session.gitBranch);
  if (session.lastAt) bits.push(l10n.dateTime(session.lastAt));
  bits.push(t('convo-message-count', { n: session.messageCount }));
  if (session.source === 'history') bits.push(t('convo-purged'));
  if (session.source === 'archive') bits.push(t('convo-saved'));
  el.convoMeta.textContent = bits.join(' · ');
  el.convoMeta.title = session.folderPath;

  paintChain(session.id);

  // What the person marked on it: their star, and their note (marks.js).
  state.favorite = session.favorite === true;
  state.note = typeof session.note === 'string' ? session.note : '';
  paintFavorite();
  el.noteInput.value = state.note;
  el.noteStatus.textContent = '';
  setNoteOpen(Boolean(state.note));
  // Only what Ariane alone holds can be forgotten from here.
  el.forget.hidden = session.source !== 'archive';
}

function paintTranscript(messages) {
  state.openMessageCount = messages.length;
  state.openMessages = messages;
  // Empty shells are dropped and runs of tool machinery collapse into one strip.
  // Reversal works on these rows, not on messages: inside a strip of tool
  // calls, each call still comes before its result.
  view.show(groupMessages(messages), { newestFirst: state.newestFirst });
  state.outlineAt = null;
  paintOutline();
}

/**
 * Bring the open conversation up to date after a pass — a conversation still
 * being written is exactly what someone leaves Ariane open beside.
 *
 * Nothing is repainted unless messages were added, so a reader mid-page loses
 * neither their place nor an unfolded tool run. When something was added, the
 * scroll position is kept; a reader already at the bottom stays at it.
 */
async function refreshOpenConversation() {
  const sessionId = state.currentSessionId;
  if (!sessionId) return;
  const token = state.openToken;

  let payload;
  try {
    payload = await api.session(sessionId);
  } catch {
    return;
  }
  // Another conversation, or the welcome pane, was asked for meanwhile.
  if (token !== state.openToken || !payload) return;
  state.starred = new Set(payload.favoriteMessages || []);
  // Saved since it was opened: the header says so, and offers to forget it.
  state.chain = payload.chain || [];
  paintHeader(payload.session);
  if (payload.messages.length === state.openMessageCount) return;

  const before = state.openMessages || [];
  const next = payload.messages;
  // A conversation only ever grows at its end — unless its file was
  // rewritten, and then there is no place to keep: start again at the top.
  const grew = next.length > before.length && before.every((m, i) => next[i].id === m.id);
  if (!grew) {
    paintTranscript(next);
    el.transcript.scrollTop = 0;
    return;
  }

  const pane = el.transcript;
  const scroll = pane.scrollTop;
  const height = pane.scrollHeight;
  // New messages land at the end of the reading order: the bottom normally,
  // the top when the latest is shown first. Whoever sits at that end is
  // following along and stays there; anyone else keeps their place.
  const following = state.newestFirst
    ? scroll < STICK_TO_BOTTOM_PX
    : height - scroll - pane.clientHeight < STICK_TO_BOTTOM_PX;

  // Only the new rows: repainting six thousand others every 30 s would be the
  // very freeze this view exists to avoid.
  state.openMessages = next;
  state.openMessageCount = next.length;
  view.extend(groupMessages(next));
  paintOutline();
  if (!el.find.hidden) runFind({ keep: true, quiet: true });

  if (state.newestFirst) {
    // Content grew ABOVE the reader: shift by as much, or the page jumps.
    pane.scrollTop = following ? 0 : scroll + (pane.scrollHeight - height);
  } else {
    pane.scrollTop = following ? pane.scrollHeight : scroll;
  }
}

/** Latest first, or first first — for this conversation alone, from its new top. */
function onToggleOrder() {
  const id = state.currentSessionId;
  if (!id) return;
  state.newestFirst = !state.newestFirst;
  if (state.newestFirst === NEWEST_FIRST_BY_DEFAULT) state.flipped.delete(id); // no entry needed
  else state.flipped.add(id);
  paintOrderButton();
  if (state.openMessages) {
    paintTranscript(state.openMessages);
    el.transcript.scrollTop = 0;
    // The same message stays the one being looked at, now further up or down.
    if (!el.find.hidden) runFind({ keep: true });
  }
}

/**
 * Forget a saved conversation — the copy Ariane alone holds. Irreversible, so
 * the first click only asks, and the question stands down after a few seconds.
 */
async function onForget() {
  const id = state.currentSessionId;
  if (!id) return;
  if (state.forgetArmedFor !== id) {
    state.forgetArmedFor = id;
    setButton(el.forget, { icon: 'trash', label: t('forget-confirm') });
    el.forget.classList.add('danger');
    clearTimeout(state.forgetTimer);
    state.forgetTimer = setTimeout(disarmForget, FORGET_CONFIRM_MS);
    return;
  }

  disarmForget();
  try {
    await api.forget(id);
  } catch (error) {
    return toast(error.message, true);
  }
  showWelcome();
  await loadFolders();
  try {
    setStats((await api.status()).stats);
  } catch {
    /* the footer catches up at the next pass */
  }
  toast(t('forget-done'));
}

function disarmForget() {
  clearTimeout(state.forgetTimer);
  state.forgetArmedFor = null;
  setButton(el.forget, { icon: 'trash', label: t('forget-button') });
  el.forget.classList.remove('danger');
}

// ── Exporter, copier ────────────────────────────────────────────────────

function openExportMenu() {
  el.exportMenu.hidden = false;
  el.exportButton.setAttribute('aria-expanded', 'true');
  el.exportMenu.querySelector('.menu-item').focus();
}

function closeExportMenu() {
  el.exportMenu.hidden = true;
  el.exportButton.setAttribute('aria-expanded', 'false');
}

/**
 * The main process builds the file from the index and asks where to put it;
 * this only names the conversation and the format. A PDF of a long
 * conversation takes a few seconds, and the app stays usable meanwhile.
 */
async function onExport(format) {
  closeExportMenu();
  const id = state.currentSessionId;
  if (!id) return;
  if (format === 'pdf') toast(t('export-preparing-pdf'));
  try {
    // In the order this conversation is shown in: an export is what the reader sees.
    const result = await api.exportSession(id, format, { newestFirst: state.newestFirst });
    if (result && result.saved) toast(t('export-done', { path: result.path }));
  } catch (error) {
    toast(error.message, true);
  }
}

async function onCopyMessage(button) {
  try {
    await api.copyMessage(Number(button.dataset.messageId));
  } catch (error) {
    return toast(error.message, true);
  }
  setIconButton(button, { icon: 'check', label: t('message-copied') });
  button.classList.add('done');
  setTimeout(() => {
    setIconButton(button, { icon: 'copy', label: t('message-copy') });
    button.classList.remove('done');
  }, 1500);
}

// ── Le plan de la conversation ───────────────────────────────────────────

/**
 * The person's own messages, in screen order, each with the row it stands at.
 * The attribution rule is the transcript's own: tool output and harness notices
 * recorded under "user" are not the person, and get no place in the outline.
 */
function ownRows() {
  const own = [];
  const display = view.display;
  display.forEach((group, index) => {
    if (group.type !== 'message') return;
    const mine = speakerOf(group.message) === 'you';
    const starred = state.starred.has(group.message.id);
    // The person's own messages, and whatever they starred — including an
    // answer, which is often the thing they came back for.
    if (mine || starred) own.push({ id: group.message.id, message: group.message, index, starred });
  });
  return { own, total: display.length };
}

/**
 * One tick per message of the person's, placed where it stands in the whole
 * conversation — painted rows or not — so the outline is a map of all of it.
 */
function paintOutline() {
  const { own, total } = ownRows();
  if (own.length === 0) {
    el.outline.hidden = true;
    el.outline.replaceChildren();
    return;
  }
  const ticks = own.map(({ id, message, index, starred }) => {
    const tick = node('button', `outline-tick${starred ? ' starred' : ''}`);
    tick.type = 'button';
    // Alt+↑/↓ is the keyboard way through them; a thousand tab stops is not.
    tick.tabIndex = -1;
    tick.dataset.messageId = String(id);
    tick.style.top = `${total > 1 ? (index / (total - 1)) * 100 : 0}%`;
    tick.title = message.ts
      ? `${preview(message.text, 90)}\n${l10n.dateTime(message.ts)}`
      : preview(message.text, 90);
    tick.setAttribute('aria-label', tick.title);
    return tick;
  });
  el.outline.replaceChildren(...ticks);
  el.outline.hidden = false;
}

/** Go to a message: painted first if it lies beyond the rows already shown. */
function goToMessage(id) {
  const row = view.rowOf(id);
  if (!row) return;
  row.scrollIntoView({ block: 'start' });
  for (const other of el.transcript.querySelectorAll('.msg.is-target')) other.classList.remove('is-target');
  row.classList.add('is-target');
  setTimeout(() => row.classList.remove('is-target'), 1200);
  const own = ownRows().own.find((o) => o.id === id);
  state.outlineAt = own ? own.index : null;
}

/**
 * Alt+↓ / Alt+↑: the next or previous message of the person's, from where the
 * reader is. "Where" is the last one jumped to while it is still on screen —
 * near the end, a row cannot be scrolled to the top, and measuring from the
 * top alone would land on it again and again — and otherwise the top row.
 */
function jumpToOwn(step) {
  const { own } = ownRows();
  if (own.length === 0) return;
  const last = state.outlineAt;
  const lastRow = last === null ? null : el.transcript.children[last];
  const from = lastRow && isInView(lastRow) ? last : rowIndexAtTop();
  const target = step > 0 ? own.find((o) => o.index > from) : [...own].reverse().find((o) => o.index < from);
  if (target) goToMessage(target.id);
}

function isInView(row) {
  const pane = el.transcript.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  return box.bottom > pane.top && box.top < pane.bottom;
}

/** The index of the row at the top of the pane; painted rows are a prefix, in order. */
function rowIndexAtTop() {
  const rows = el.transcript.children;
  const top = el.transcript.getBoundingClientRect().top + 4;
  let lo = 0;
  let hi = rows.length - 1;
  let found = rows.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > top) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
}

// ── Chercher dans la conversation ouverte ────────────────────────────────

function openFind() {
  el.find.hidden = false;
  el.findInput.focus();
  el.findInput.select();
  if (el.findInput.value.trim()) runFind();
}

function closeFind() {
  clearFindMarks();
  state.find = { hits: [], index: -1 };
  el.find.hidden = true;
  paintFindCount();
}

/**
 * Which messages hold the words, in screen order — "suivant" goes down the
 * screen whichever way the conversation is sorted. Only prose is searched, as
 * in the index; tool output and reasoning stay folded and out of it.
 *
 * @param {{keep?: boolean, quiet?: boolean}} [options]
 *   keep: stay on the same message if it still matches (order flipped, or a
 *   message arrived). quiet: update the count without moving the reader.
 */
function runFind({ keep = false, quiet = false } = {}) {
  const wanted = foldForSearch(el.findInput.value.trim());
  const current = keep ? state.find.hits[state.find.index] : undefined;
  clearFindMarks();

  const matching = wanted
    ? (state.openMessages || []).filter((m) => m.text && foldForSearch(m.text).includes(wanted))
    : [];
  const hits = matching.map((m) => m.id);
  if (state.newestFirst) hits.reverse();

  const kept = current === undefined ? -1 : hits.indexOf(current);
  state.find = { hits, index: kept >= 0 ? kept : hits.length ? 0 : -1 };

  if (quiet) {
    if (kept >= 0) markFindHit(false);
    paintFindCount();
    return;
  }
  showFindHit();
}

function moveFind(step) {
  const { hits, index } = state.find;
  if (hits.length === 0) return;
  state.find.index = (index + step + hits.length) % hits.length;
  showFindHit();
}

function showFindHit() {
  clearFindMarks();
  markFindHit(true);
  paintFindCount();
}

/**
 * Wrap every occurrence of `terms` inside `root` in a `<mark>` of that class.
 *
 * Marks are built from TEXT NODES only, never from markup: the prose has
 * already been escaped and decorated, and rebuilding it from a string would
 * undo invariant 2. A node already inside a mark is left alone, so running
 * this twice cannot nest marks — which happens, since the search highlight and
 * Ctrl+F can both be on at once.
 */
function markTerms(root, terms, className) {
  const wanted = (Array.isArray(terms) ? terms : [terms]).filter((term) => term && term.trim());
  if (!root || wanted.length === 0) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) =>
      // Folded tool output and reasoning are not what was searched; and never
      // mark inside a mark.
      text.parentElement.closest('details, mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);

  for (const text of texts) {
    // Every term at once, so two words overlapping the same run are both kept
    // and neither is marked twice.
    const ranges = wanted
      .flatMap((term) => findRanges(text.data, term))
      .sort((a, b) => a[0] - b[0])
      .filter(([start], i, all) => i === 0 || start >= all[i - 1][1]);
    if (ranges.length === 0) continue;

    const pieces = document.createDocumentFragment();
    let from = 0;
    for (const [start, end] of ranges) {
      pieces.append(document.createTextNode(text.data.slice(from, start)));
      pieces.append(node('mark', className, text.data.slice(start, end)));
      from = end;
    }
    pieces.append(document.createTextNode(text.data.slice(from)));
    text.replaceWith(pieces);
  }
}

/** Undo one kind of mark, leaving the other kind where it is. */
function unmark(className) {
  for (const mark of el.transcript.querySelectorAll(`mark.${className}`)) {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent));
    parent.normalize();
  }
}

/**
 * The words of the last search, marked in the rows that are on screen. Called
 * again for every slice the transcript paints afterwards — a hit 6 000 rows
 * down is painted long after the conversation opened.
 */
function markSearchTerms(rows) {
  if (state.searchTerms.length === 0) return;
  for (const row of rows) markTerms(row.querySelector('.msg-body'), state.searchTerms, 'search-hit');
}

/** The search that led here is over: its highlight goes with it. */
function clearSearchTerms() {
  if (state.searchTerms.length === 0) return;
  state.searchTerms = [];
  unmark('search-hit');
}

/**
 * Highlight the current hit: its row, and every occurrence of the words in
 * its prose. The row may be thousands down and not painted yet; rowOf paints
 * up to it. Marks are built from text nodes only — never markup.
 */
function markFindHit(scroll) {
  const id = state.find.hits[state.find.index];
  if (id === undefined) return;
  const row = view.rowOf(id);
  if (!row) return;
  row.classList.add('is-hit');

  markTerms(row.querySelector('.msg-body'), el.findInput.value.trim(), 'find-hit');
  if (scroll) row.scrollIntoView({ block: 'center' });
}

function clearFindMarks() {
  unmark('find-hit');
  for (const row of el.transcript.querySelectorAll('.msg.is-hit')) row.classList.remove('is-hit');
}

function paintFindCount() {
  const { hits, index } = state.find;
  const asked = el.findInput.value.trim();
  el.findCount.textContent = hits.length ? `${index + 1} / ${hits.length}` : asked ? t('find-none') : '';
}

function onFindKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    // A query typed but not yet looked up: look it up first.
    if (!state.find.hits.length) runFind();
    else moveFind(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    // Close the bar, stay in the conversation: not the global "back home".
    event.preventDefault();
    event.stopPropagation();
    closeFind();
    el.transcript.focus();
  }
}

function paintOrderButton() {
  setButton(el.order, {
    icon: state.newestFirst ? 'sortNewest' : 'sortOldest',
    label: t(state.newestFirst ? 'order-newest' : 'order-oldest'),
  });
  el.order.setAttribute('aria-pressed', String(state.newestFirst));
}

/** Tool calls, reasoning and attachments render collapsed: they are bulk, not conversation. */
function appendPart(body, part, message) {
  if (part.type === 'text') return;

  if (part.type === 'thinking') {
    if (message.thinking) body.append(fold(t('part-thinking'), message.thinking));
    return;
  }

  if (part.type === 'tool_use') {
    body.append(fold(t('part-tool'), part.preview, part.name));
    return;
  }

  if (part.type === 'tool_result') {
    body.append(fold(t('part-result'), part.preview, part.isError ? t('part-error') : '', part.isError));
    return;
  }

  // What the person pasted into their prompt: theirs, but bulk.
  if (part.type === 'pasted') {
    body.append(fold(t('part-pasted'), part.preview, part.lines ? t('part-pasted-lines', { n: part.lines }) : ''));
    return;
  }

  if (part.type === 'attachment') {
    const label = t(part.kind === 'image' ? 'part-image' : 'part-document');
    body.append(node('span', 'attach', `${label} · ${part.mediaType} · ${l10n.bytes(part.bytes)}`));
  }
}

function fold(label, content, tag = '', isError = false) {
  const details = node('details', 'fold');
  const summary = document.createElement('summary');
  summary.append(node('span', '', label));
  if (tag) summary.append(node('span', `fold-tag${isError ? ' error' : ''}`, tag));
  details.append(summary);

  const pre = document.createElement('pre');
  pre.textContent = content || t('part-empty');
  details.append(pre);
  return details;
}

/**
 * Show what reopening this conversation would actually do.
 *
 * The label carries the real command, because the button starts a process and
 * the reader deserves to know which one before pressing it. An agent that can
 * only resume "the latest" session says so rather than quietly opening a
 * different conversation.
 */
async function updateResumeButton(sessionId) {
  state.resumeCommand = null;
  el.resume.hidden = true;
  el.copyCmd.hidden = true;

  let info;
  try {
    info = await api.resumeInfo(sessionId);
  } catch {
    return;
  }
  // The button names the command it will RUN, so a late reply must never
  // relabel it for a conversation that is no longer open.
  if (state.currentSessionId !== sessionId) return;
  // The main process sends a code for why; it is said here, in the reader's language.
  const note = info && info.note ? t(`resume-note-${info.note}`) : '';
  if (!info || !info.ok) {
    if (note) el.resume.title = note;
    return;
  }

  state.resumeCommand = info.display;
  el.resume.hidden = false;
  el.copyCmd.hidden = false;
  setButton(el.resume, { icon: 'terminal', label: t(info.exact ? 'resume-button' : 'resume-button-latest') });
  el.resume.title = info.exact ? t('resume-opens', { command: info.display }) : `${note}\n${info.display}`.trim();
  el.resume.dataset.sessionId = sessionId;
}

/**
 * Why a conversation could not be reopened, in words. `settings: true` marks
 * the failures the person can fix by stating where the CLI lives — the ones
 * that used to open a terminal and shut it in the same instant.
 */
const RESUME_FAILURES = {
  'no-terminal': { text: () => t('resume-no-terminal') },
  'folder-missing': { text: () => t('resume-folder-missing') },
  'command-not-found': {
    settings: true,
    text: (r) => t('resume-command-not-found', { command: r.detail }),
  },
  'setting-not-absolute': {
    settings: true,
    text: (r) => t('resume-setting-not-absolute', { command: r.command, path: r.detail }),
  },
  'setting-unusable': {
    settings: true,
    text: (r) => t('resume-setting-unusable', { path: r.detail }),
  },
  'interpreter-not-found': {
    settings: true,
    text: (r) => t('resume-interpreter-not-found', { command: r.command, interpreter: r.detail }),
  },
};

/** The settings window, open on the assistant that needs a path. */
const settingsAction = (agentId = null) => ({
  label: t('open-settings-action'),
  run: () => settingsDialog.open({ focus: agentId }),
});

async function onResume() {
  const sessionId = el.resume.dataset.sessionId;
  if (!sessionId) return;

  try {
    const result = await api.resume(sessionId);
    if (result.ok) {
      if (result.settingsProblem) {
        toast(
          t('resume-opened-settings-ignored', { terminal: result.terminal, problem: result.settingsProblem }),
          true,
          settingsAction()
        );
      } else {
        toast(t('resume-opened', { terminal: result.terminal }));
      }
      return;
    }
    // Whatever went wrong, the command still works when pasted in the
    // person's own shell, whose PATH is not the desktop's.
    await api.copy(result.display);
    const failure = RESUME_FAILURES[result.reason];
    const why = failure
      ? failure.text(result)
      : t('resume-failed', { reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason });
    toast(
      t('resume-failed-copied', { reason: why }),
      true,
      failure && failure.settings ? settingsAction(result.agentId) : null
    );
  } catch (error) {
    toast(error.message, true);
  }
}



async function onCopyCommand() {
  if (!state.resumeCommand) return;
  try {
    await api.copy(state.resumeCommand);
    toast(t('command-copied'));
  } catch (error) {
    toast(error.message, true);
  }
}

async function onOpenFolder() {
  const path = el.openFolder.dataset.path;
  if (!path) return;
  try {
    await api.openFolder(path);
  } catch {
    toast(t('folder-gone'), true);
  }
}

// ── Recherche ────────────────────────────────────────────────────────────

/**
 * The search scope. A native <select> rather than a custom menu: it is
 * keyboard-navigable, screen-reader-correct and impossible to get wrong, which
 * matters more here than matching the pill styling exactly.
 */
function renderScopeOptions() {
  const previous = state.scope;
  const options = [{ value: 'all', label: t('scope-all') }];

  for (const agent of state.agents) {
    if (!agent.sessionCount) continue;
    options.push({ value: `agent:${agent.id}`, label: agent.label });
  }
  if (state.currentFolderId != null) {
    const folder = state.folders.find((f) => f.id === state.currentFolderId);
    options.push({
      value: 'folder',
      label: folder ? t('scope-folder', { name: folderLabel(folder.path).name }) : t('scope-folder-current'),
    });
  }
  if (state.currentSessionId) options.push({ value: 'session', label: t('scope-session') });

  el.scope.replaceChildren(
    ...options.map((o) => {
      const option = document.createElement('option');
      option.value = o.value;
      option.textContent = o.label;
      return option;
    })
  );

  // A scope whose target disappeared falls back to searching everything.
  const stillThere = options.some((o) => o.value === previous);
  state.scope = stillThere ? previous : 'all';
  el.scope.value = state.scope;
}

function onScopeChange() {
  state.scope = el.scope.value;
  runSearch();
  el.search.focus();
}

function renderPeriodOptions() {
  el.period.replaceChildren(
    ...Object.entries(PERIODS).map(([value, { label }]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(label);
      return option;
    })
  );
  el.period.value = state.period;
}

function onPeriodChange() {
  state.period = Object.hasOwn(PERIODS, el.period.value) ? el.period.value : 'all';
  runSearch();
  el.search.focus();
}

/** Translate the scope and the period into search filters. */
function scopeFilters() {
  const filters = state.period === 'all' ? {} : { period: state.period };
  if (state.scope === 'folder') return { ...filters, folderId: state.currentFolderId };
  if (state.scope === 'session') return { ...filters, sessionId: state.currentSessionId };
  if (state.scope.startsWith('agent:')) {
    return { ...filters, agentId: state.scope.slice('agent:'.length) };
  }
  return filters;
}

/**
 * The words to mark, from what was typed. The index searches on stems and on a
 * prefix for the last word, so a match can be longer than what is marked —
 * marking exactly what someone typed is the honest half.
 */
function termsOf(query) {
  return String(query || '')
    .split(/[\s"']+/)
    .map((word) => word.replace(/^[-+*]+|[-+*]+$/g, ''))
    .filter((word) => word.length > 1 && !/^(and|or|not)$/i.test(word));
}

async function runSearch() {
  const query = el.search.value.trim();
  if (!query) {
    clearSearchTerms();
    return hideResults();
  }

  try {
    state.results = await api.search(query, scopeFilters());
  } catch (error) {
    return toast(error.message, true);
  }
  state.activeResult = state.results.length ? 0 : -1;
  renderResults();
}

function renderResults() {
  el.results.hidden = false;
  el.searchHint.textContent = state.results.length ? t('results-count', { n: state.results.length }) : '';

  if (state.results.length === 0) {
    // Said with the period when the period is why nothing matched.
    el.results.replaceChildren(node('p', 'results-empty', t(PERIODS[state.period].none)));
    return;
  }

  // Grouped by folder, which is how the user thinks about their history.
  const children = [];
  let lastFolder = null;
  state.results.forEach((hit, i) => {
    if (hit.folderPath !== lastFolder) {
      lastFolder = hit.folderPath;
      const group = node('div', 'results-group', hit.folderPath);
      group.title = hit.folderPath;
      children.push(group);
    }
    children.push(renderResult(hit, i));
  });
  el.results.replaceChildren(...children);
}

function renderResult(hit, i) {
  const button = node('button', 'result');
  button.type = 'button';
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', String(i === state.activeResult));
  if (i === state.activeResult) button.classList.add('active');

  const title = node('div', 'result-title');
  const strong = document.createElement('strong');
  strong.textContent = hit.title || t('session-untitled');
  // The hit's own agent, never a constant: a Codex result labelled "Claude" is
  // the same error as crediting the person with the output of `git status`.
  const speaker =
    hit.role === 'user' ? t('speaker-you') : agentTheme(hit.agentId, labelOfAgent(hit.agentId)).label;
  const when = node('span', 'result-when', l10n.ago(hit.ts));
  when.title = l10n.dateTime(hit.ts);
  title.append(strong, node('span', '', speaker), when);

  const snippet = node('div', 'result-snippet');
  // Safe: renderSnippet escapes, then swaps sentinels for <mark>.
  snippet.innerHTML = renderSnippet(hit.snippet);

  button.append(title, snippet);
  button.addEventListener('click', () => {
    hideResults();
    openSession(hit.sessionId, hit.id, { terms: termsOf(el.search.value) });
  });
  return button;
}

function hideResults() {
  el.results.hidden = true;
  el.results.replaceChildren();
  el.searchHint.textContent = '';
  state.results = [];
  state.activeResult = -1;
}

function onSearchKeydown(event) {
  if (event.key === 'Escape') {
    if (el.results.hidden) el.search.value = '';
    hideResults();
    return;
  }
  if (state.results.length === 0) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    state.activeResult =
      (state.activeResult + delta + state.results.length) % state.results.length;
    renderResults();
    el.results.querySelector('.result.active')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'Enter' && state.activeResult >= 0) {
    event.preventDefault();
    const hit = state.results[state.activeResult];
    hideResults();
    openSession(hit.sessionId, hit.id);
  }
}

function onGlobalKeydown(event) {
  // A modal window handles its own keys: Échap closes it, and nothing behind
  // it may react — not the search, not "back to the welcome page".
  if (settingsDialog && settingsDialog.isOpen) return;
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    el.search.focus();
    el.search.select();
    return;
  }
  if (mod && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    refresh();
    return;
  }
  if (mod && event.key.toLowerCase() === 'f' && state.currentSessionId) {
    event.preventDefault();
    openFind();
    return;
  }
  if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && state.currentSessionId) {
    event.preventDefault();
    jumpToOwn(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Escape' && document.activeElement !== el.search) {
    // The nearer thing to dismiss goes first: the results, then the find bar,
    // and only then the conversation itself.
    if (!el.results.hidden) {
      hideResults();
      return;
    }
    if (!el.exportMenu.hidden) {
      closeExportMenu();
      el.exportButton.focus();
      return;
    }
    if (!el.find.hidden) {
      closeFind();
      return;
    }
    if (state.currentSessionId) showWelcome();
  }
}

// ── Utilitaires ──────────────────────────────────────────────────────────

/** Create an element; `text` is always set via textContent. */
function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

let toastTimer;
/**
 * A short message at the bottom of the window. `action` adds one button — for
 * a failure the person can fix from here — and leaves them time to reach it.
 */
function toast(message, isError = false, action = null) {
  el.toast.textContent = message;
  if (action) {
    const button = node('button', 'toast-action', action.label);
    button.type = 'button';
    button.addEventListener('click', () => {
      el.toast.hidden = true;
      action.run();
    });
    el.toast.append(button);
  }
  el.toast.classList.toggle('error', isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      el.toast.hidden = true;
    },
    action ? 10000 : isError ? 6000 : 3200
  );
}
