'use strict';

/**
 * A stand-in for the real preload, used only by the rendering tests.
 *
 * It exposes the same `window.api` surface backed by fixed data, so the real
 * renderer can be driven end to end — folders, sessions, messages, search —
 * with no database, no Electron main process and no filesystem.
 *
 * The fixture deliberately contains the shapes that have caused real bugs:
 * a tool result recorded under the "user" role, a harness notice, and an empty
 * shell message. Those are the rows the assertions care about.
 */

const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * The language, from the real files: French unless the page was loaded with
 * `?lang=en`, or `?lang=pseudo` — English with every sentence marked ⟦…⟧, so
 * that one which bypassed the language files shows up bare.
 */
const LOCALES = path.join(__dirname, '..', '..', 'src', 'locales');
const readLocale = (code) => fs.readFileSync(path.join(LOCALES, `${code}.ftl`), 'utf8');
/** A language chosen in the settings window outlives the reload it causes, as the real file does. */
const chosenLanguage = () => {
  try {
    return globalThis.sessionStorage.getItem('mock.language');
  } catch {
    return null;
  }
};
const WANTED =
  chosenLanguage() || new URLSearchParams(globalThis.location ? globalThis.location.search : '').get('lang') || 'fr';
const PSEUDO = WANTED === 'pseudo';
const LANGUAGE = PSEUDO ? 'en' : WANTED;
const languageSaves = [];

/** The stars and the notes, as marks.js would keep them: id -> {favorite, note}. */
const MARKS = {};
const marked = (session) => ({
  ...session,
  // Comme session:get : l'identifiant tel que l'assistant le connaît (resume.js, bareId).
  localId: session.id.slice(session.id.indexOf(':') + 1),
  favorite: Boolean(MARKS[session.id] && MARKS[session.id].favorite),
  note: (MARKS[session.id] && MARKS[session.id].note) || '',
  messages: (MARKS[session.id] && MARKS[session.id].messages) || [],
});

/**
 * Comme db.sessionSpan dans session:get : quand ses propres messages ont
 * commencé et fini. Ici, rien n'est recopié : ce sont les dates de la session.
 */
const spanOf = (session) => ({ startedAt: session.firstAt, endedAt: session.lastAt });

/**
 * The two Codex sessions stand for one conversation a compaction cut in two:
 * the app must say so rather than show two strangers.
 */
const CHAIN = [
  { id: 'codex:c1', title: 'Session Codex A' },
  { id: 'codex:c2', title: 'Session Codex B' },
];
const chainOf = (id) => (CHAIN.some((part) => part.id === id) ? CHAIN.slice() : []);

/**
 * Un sous-agent lancé par la partie A : jamais dans la liste de gauche, on le
 * rejoint depuis sa conversation mère, et il y ramène.
 */
const SUBAGENT = {
  id: 'codex:sub1', agentId: 'codex', title: 'Huygens', gitBranch: 'main',
  messageCount: 2, firstAt: '2026-09-17T21:05:00.000Z', lastAt: '2026-09-17T21:06:00.000Z',
  source: 'transcript', parentId: 'codex:c1',
};

/** What marks.js does in the main process: find the starred rows again. */
const resolveStarred = (id, messages) => {
  const marks = (MARKS[id] && MARKS[id].messages) || [];
  return messages
    .filter((m) => marks.some((mark) => (mark.uuid && mark.uuid === m.uuid) || mark.seq === m.seq))
    .map((m) => m.id);
};

const FOLDERS = [
  {
    id: 1,
    path: '/home/zam/projet',
    dirName: '-home-zam-projet',
    existsOnDisk: 1,
    sessionCount: 3,
    agentCount: 2,
    agentIds: 'claude,codex',
    pathExact: 1,
    messageCount: 6,
    lastAt: '2026-09-17T23:06:00.000Z',
  },
  // A folder whose first expansion FAILS. It exists so the retry path can be
  // driven: a transient error must not be cached as "this folder is empty".
  {
    id: 2,
    path: '/home/zam/fragile',
    dirName: '-home-zam-fragile',
    existsOnDisk: 1,
    sessionCount: 1,
    agentCount: 1,
    agentIds: 'claude',
    // Its path was reconstructed from the directory name, never confirmed.
    pathExact: 0,
    sessionCount: 2,
    messageCount: 1,
    lastAt: '2026-09-17T19:00:00.000Z',
  },
];

const FRAGILE_SESSIONS = [
  {
    id: 'claude:f1', agentId: 'claude', title: 'Session fragile', gitBranch: 'main',
    firstPrompt: 'apres une erreur', messageCount: 1,
    firstAt: '2026-09-17T19:00:00.000Z', lastAt: '2026-09-17T19:00:00.000Z', source: 'transcript',
  },
  // No title at all: the header must call it by its first words, as the sidebar does.
  {
    id: 'claude:f3', agentId: 'claude', title: null, gitBranch: 'main',
    firstPrompt: 'une question sans titre', messageCount: 2,
    firstAt: '2026-09-15T19:00:00.000Z', lastAt: '2026-09-15T19:00:00.000Z', source: 'transcript',
  },
  // Its file is gone: Ariane holds the only copy, so it alone can be forgotten.
  {
    id: 'claude:f2', agentId: 'claude', title: 'Conversation sauvée', gitBranch: 'main',
    firstPrompt: 'ancienne', messageCount: 2,
    firstAt: '2026-09-16T19:00:00.000Z', lastAt: '2026-09-16T19:00:00.000Z', source: 'archive',
  },
];

/** Every id the renderer asked to forget, in order. */
const forgotten = [];
/** What the renderer asked to export, and which messages to copy. */
const exportCalls = [];
const copyCalls = [];
/** The filters each search was sent with. */
const searchCalls = [];
/** Each period the statistics were asked for, in order. */
const statisticsCalls = [];

/**
 * What stats:get answers, shaped like src/core/statistics.js returns it, with
 * figures from a real index. Codex measured nothing here, so the view must say
 * so; ten models, so the tail folds into one row.
 */
/**
 * The usage limits, shaped like Index.quotas answers them (oldest first within
 * an assistant and a limit), dated from now so that the latest week has not
 * ended yet and the five-hour window has. Six weeks of Codex, its credits
 * running out past 100 %, a second Codex limit, and Claude's three refusals.
 */
function QUOTAS() {
  const DAY = 86400;
  const now = Math.floor(Date.now() / 1000);
  const iso = (s) => new Date(s * 1000).toISOString();
  const weeks = [37, 64, 100, 18, 95, 42].map((used, i) => {
    const end = now + 3 * DAY - (5 - i) * 7 * DAY;
    return {
      agentId: 'codex', limit: 'codex', minutes: 10080, resetsAt: end, used, reached: used >= 100,
      at: iso(end - 5 * DAY), lastAt: iso(end - 4 * DAY), plan: 'plus',
      credits: { has: true, unlimited: false, balance: 123.26519 },
    };
  });
  const claude = [18, 10, 9].map((daysAgo) => ({
    agentId: 'claude', limit: 'claude', minutes: 300, resetsAt: now - daysAgo * DAY + 3600, used: null,
    reached: true, at: iso(now - daysAgo * DAY), lastAt: iso(now - daysAgo * DAY), plan: null, credits: null,
  }));
  return [
    ...claude,
    { agentId: 'codex', limit: 'codex', minutes: 300, resetsAt: now - 30 * DAY, used: 33, reached: false,
      at: iso(now - 30 * DAY - 3600), lastAt: iso(now - 30 * DAY - 1800), plan: 'plus', credits: null },
    ...weeks,
    { agentId: 'codex', limit: 'premium', minutes: 10080, resetsAt: now + 2 * DAY, used: 12, reached: false,
      at: iso(now - 7200), lastAt: iso(now - 3600), plan: 'plus', credits: null },
  ];
}

const STATISTICS = {
  records: 49411,
  sessions: 363,
  folders: 52,
  speakers: { you: 2789, assistant: 23339, tools: 16156, notices: 626, empty: 6501, masked: 6093 },
  tokens: { sent: 116105691, received: 16329338, cacheRead: 4777562277, measuredSessions: 37 },
  agents: [
    { agentId: 'claude', sessions: 73, you: 1647, replies: 14388, measuredSessions: 37,
      sent: 116105691, received: 16329338, cacheRead: 4777562277 },
    { agentId: 'codex', sessions: 290, you: 1142, replies: 8951, measuredSessions: 0,
      sent: null, received: null, cacheRead: null },
  ],
  models: [
    { model: 'claude-opus-5', replies: 3530 }, { model: 'gpt-6-astra', replies: 756 },
    { model: 'claude-opus-4-7', replies: 338 }, { model: 'gpt-5.6-sol', replies: 260 },
    { model: 'gpt-5.5', replies: 241 }, { model: 'claude-opus-4-8', replies: 230 },
    { model: 'gpt-5.3-codex', replies: 140 }, { model: 'claude-opus-5-5', replies: 112 },
    { model: 'kimi-k3', replies: 64 }, { model: 'grok-4.6', replies: 1 },
  ],
  months: [
    { month: '2026-05', you: 120, replies: 1233, received: 530663 },
    { month: '2026-06', you: 150, replies: 1799, received: 497030 },
    { month: '2026-07', you: 0, replies: 0, received: 0 },
    { month: '2026-08', you: 556, replies: 5237, received: 3495583 },
    { month: '2026-09', you: 1128, replies: 12769, received: 9838119 },
  ],
  undated: 3,
  activeFolders: [
    { path: '/home/zam/repos/claudechatbrowser', messages: 5672 },
    { path: '/home/zam/Documents/santé-debate', messages: 5556 },
    { path: '/home/zam/Programmation/c64/Arena64', messages: 4769 },
  ],
  quotas: QUOTAS(),
};
/** What "Reprendre" answers, when made to fail. */
let resumeReply = null;

/**
 * The settings window's world: Claude found here, Codex used but not found,
 * the three others neither — so they wait under « Ajouter ».
 */
const notFound = (name) => ({ ok: false, reason: 'command-not-found', detail: name });
const SETTINGS = {
  file: '/home/zam/.config/Ariane/settings.json',
  unreadable: null,
  language: {
    setting: 'auto',
    current: LANGUAGE,
    system: 'fr',
    available: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }],
  },
  theme: 'auto',
  textSize: 100,
  textSizes: [90, 100, 110, 120, 130],
  agents: [
    { id: 'claude', name: 'claude', label: 'Claude Code', command: '', detected: '/home/zam/.local/bin/claude',
      sessions: 3, check: { ok: true, executable: '/home/zam/.local/bin/claude', chosen: false } },
    { id: 'codex', name: 'codex', label: 'Codex', command: '', detected: null, sessions: 2, check: notFound('codex') },
    { id: 'copilot-cli', name: 'copilot', label: 'Copilot CLI', command: '', detected: null, sessions: 0, check: notFound('copilot') },
    { id: 'qwen', name: 'qwen', label: 'Qwen Code', command: '', detected: null, sessions: 0, check: notFound('qwen') },
    { id: 'gemini', name: 'gemini', label: 'Gemini CLI', command: '', detected: null, sessions: 0, check: notFound('gemini') },
  ],
};
const settingsSaves = [];
const themeSaves = [];
const textSizeSaves = [];
// « Vérifier maintenant » : d'abord à jour, puis une version qui attend.
const updateNowAnswers = [
  { current: '0.5.1', update: false, reason: 'up-to-date' },
  { current: '0.5.1', update: true, version: '9.9.9', url: 'https://exemple.invalide/releases/tag/v9.9.9' },
];
let settingsFileOpened = 0;
const copyOf = (value) => JSON.parse(JSON.stringify(value));

/**
 * A conversation long enough that painting it all at once would freeze the
 * window: 2 000 rows. Message 7 — near the START, so at the very END of the
 * newest-first display — is what a search finds.
 */
const BIG_ID = 'claude:big';
const BIG = Array.from({ length: 2000 }, (_, i) => ({
  id: 100000 + i, seq: i, role: i % 2 ? 'assistant' : 'user',
  ts: new Date(Date.UTC(2026, 8, 1) + i * 60000).toISOString(),
  text: i === 7 ? 'le message profond, tout au début' : `message numéro ${i}`,
  thinking: '', parts: [], isMeta: false, isNotice: false, isSidechain: false, command: null,
}));
const BIG_SESSIONS = [{
  id: BIG_ID, agentId: 'claude', title: 'Très longue conversation', gitBranch: 'main',
  firstPrompt: 'message numéro 0', messageCount: BIG.length,
  firstAt: BIG[0].ts, lastAt: BIG[BIG.length - 1].ts, source: 'transcript',
}];
FOLDERS.push({
  id: 3, path: '/home/zam/grosse', dirName: '-home-zam-grosse', existsOnDisk: 1,
  sessionCount: 1, agentCount: 1, agentIds: 'claude', pathExact: 1,
  messageCount: BIG.length, lastAt: '2026-08-31T00:00:00.000Z',
});

/** Flipped to false by the first call, so only that one call fails. */
let fragileWillFail = true;

/** Set by the test to make two overlapping loads resolve out of order. */
let slowClaudeSession = false;

/**
 * What the next pass will find on disk, and what the last pass was asked. Lets
 * the suite make a conversation appear "while the app is open".
 */
const pending = { session: null, message: null };
let lastRefresh = null;

const AGENTS = [
  { id: 'claude', label: 'Claude Code', root: '/fixture/.claude', sessionCount: 1, messageCount: 6, lastAt: '2026-09-17T23:06:00.000Z' },
  { id: 'codex', label: 'Codex', root: '/fixture/.codex', sessionCount: 2, messageCount: 9, lastAt: '2026-09-17T22:00:00.000Z' },
];

/** What the person hid, which outlives a reload in the real app. */
let hiddenAgents = [];

const SESSIONS = [
  {
    id: 'claude:s1',
    agentId: 'claude',
    title: 'Session de test',
    gitBranch: 'master',
    firstPrompt: 'Que fait ce code',
    messageCount: 6,
    firstAt: '2026-09-17T23:00:00.000Z',
    lastAt: '2026-09-17T23:06:00.000Z',
    source: 'transcript',
    // Les sommes de db.sessions, aux médianes d'un vrai corpus : l'entrée
    // fraîche est minuscule, le cache relu écrase tout.
    tokInput: 170,
    tokOutput: 78235,
    tokCacheRead: 5933004,
    tokCacheWrite: 166489,
    models: [{ model: 'claude-opus-5', replies: 1 }],
  },
  // Codex n'enregistre pas encore ses jetons dans Ariane : null, pas zéro.
  // Deux sessions Codex dans le MÊME dossier, et plus anciennes que celle de
  // Claude : la liste doit les entremêler par date, la plus récente en tête.
  {
    id: 'codex:c1', agentId: 'codex', title: 'Session Codex A', gitBranch: 'main',
    firstPrompt: 'refactor', messageCount: 5,
    // Two models, as db.sessions counts them; no usage — Codex rows without tokens.
    models: [{ model: 'gpt-6-astra', replies: 3 }, { model: 'openai/gpt-5.2-codex', replies: 1 }],
    firstAt: '2026-09-17T21:00:00.000Z', lastAt: '2026-09-17T22:00:00.000Z', source: 'transcript',
  },
  {
    id: 'codex:c2', agentId: 'codex', title: 'Session Codex B', gitBranch: 'main',
    firstPrompt: 'tests', messageCount: 4,
    firstAt: '2026-09-17T20:00:00.000Z', lastAt: '2026-09-17T21:00:00.000Z', source: 'transcript',
  },
];

const MESSAGES = [
  // 1. A genuine question from the person.
  {
    id: 1, seq: 0, role: 'user', ts: '2026-09-17T23:00:00.000Z',
    text: 'Que fait ce code ?', thinking: '', parts: [],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
  },
  // 2. The assistant calls a tool.
  {
    id: 2, seq: 1, role: 'assistant', ts: '2026-09-17T23:01:00.000Z', model: 'claude-opus-5',
    text: 'Je regarde.', thinking: 'raisonnement interne',
    parts: [
      { type: 'text', text: 'Je regarde.' },
      { type: 'thinking', text: 'raisonnement interne' },
      { type: 'tool_use', id: 't1', name: 'Bash', preview: '{"command":"git status"}' },
    ],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
    // Ce que cette réponse a coûté : 503 envoyés, 120 reçus, 24 000 relus.
    usage: { input: 3, output: 120, cacheRead: 24000, cacheWrite: 500, reasoning: null },
  },
  // 3. THE BUG: the tool answers, and the format records it under role "user".
  {
    id: 3, seq: 2, role: 'user', ts: '2026-09-17T23:02:00.000Z',
    text: '', thinking: '',
    parts: [{ type: 'tool_result', id: 't1', isError: false, preview: 'fatal: aucun commit' }],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
  },
  // 4. A harness notice, also recorded under "user".
  {
    id: 4, seq: 3, role: 'user', ts: '2026-09-17T23:03:00.000Z',
    text: '[Request interrupted by user]', thinking: '', parts: [],
    isMeta: false, isNotice: true, isSidechain: false, command: null,
  },
  // 5. An empty shell: a redacted thinking block and nothing else. Like Claude's
  //    masked reasoning, it carries its reply's count, which must reach the
  //    strip of tool calls that follows.
  {
    id: 5, seq: 4, role: 'assistant', ts: '2026-09-17T23:04:00.000Z',
    text: '', thinking: '', parts: [],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
    usage: { input: 2, output: 40, cacheRead: 24500, cacheWrite: 0, reasoning: null },
  },
  // 6a-6d. A run of tool machinery: four turns that must collapse into ONE strip.
  {
    id: 10, seq: 10, role: 'assistant', ts: '2026-09-17T23:05:10.000Z',
    text: '', thinking: '',
    parts: [{ type: 'tool_use', id: 't2', name: 'Bash', preview: '{"command":"ls"}' }],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
    usage: { input: 1, output: 20, cacheRead: 25000, cacheWrite: 100, reasoning: null },
  },
  {
    id: 11, seq: 11, role: 'user', ts: '2026-09-17T23:05:11.000Z',
    text: '', thinking: '',
    parts: [{ type: 'tool_result', id: 't2', isError: false, preview: 'a.js' }],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
  },
  {
    id: 12, seq: 12, role: 'assistant', ts: '2026-09-17T23:05:12.000Z',
    text: '', thinking: '',
    parts: [{ type: 'tool_use', id: 't3', name: 'Read', preview: '{"file":"a.js"}' }],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
    usage: { input: 1, output: 30, cacheRead: 25100, cacheWrite: 0, reasoning: null },
  },
  {
    id: 13, seq: 13, role: 'user', ts: '2026-09-17T23:05:13.000Z',
    text: '', thinking: '',
    parts: [{ type: 'tool_result', id: 't3', isError: true, preview: 'ENOENT' }],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
  },
  // 6. A second real message, carrying markup that must never become live HTML.
  {
    id: 6, seq: 5, role: 'user', ts: '2026-09-17T23:05:00.000Z',
    text: 'Et <script>alert(1)</script> ceci, avec `du code`',
    thinking: '', parts: [],
    isMeta: false, isNotice: false, isSidechain: false, command: null,
  },
];

const SEARCH_HITS = [
  {
    id: 6, sessionId: 'claude:s1', role: 'user', ts: '2026-09-17T23:05:00.000Z', seq: 5,
    title: 'Session de test', source: 'transcript', agentId: 'claude',
    folderPath: '/home/zam/projet', folderId: 1,
    snippet: `avant ${String.fromCharCode(1)}terme${String.fromCharCode(2)} apres`,
    rank: -1,
  },
];

/** Combien de fois la page de la version a été demandée. */
let releaseOpens = 0;

contextBridge.exposeInMainWorld('api', {
  locale: async () => ({
    language: LANGUAGE,
    direction: 'ltr',
    setting: 'auto',
    system: 'fr',
    pseudo: PSEUDO,
    sources: [
      { language: LANGUAGE, source: readLocale(LANGUAGE) },
      ...(LANGUAGE === 'en' ? [] : [{ language: 'en', source: readLocale('en') }]),
    ],
    languages: SETTINGS.language.available,
  }),
  status: async () => ({
    dataDir: '/fixture/.claude',
    available: true,
    lastIndexedAt: '2026-09-17T23:10:00.000Z',
    stats: { agents: 1, folders: 1, sessions: 1, messages: MESSAGES.length },
    agents: AGENTS.map((a) => ({ id: a.id, label: a.label, sessions: a.sessionCount })),
    hiddenAgents: [...hiddenAgents],
  }),

  hideAgents: async (ids) => {
    hiddenAgents = [...new Set(ids)];
    return {
      hiddenAgents: [...hiddenAgents],
      agents: AGENTS.map((a) => ({ id: a.id, label: a.label, sessions: a.sessionCount })),
      // Comme la vraie : les comptes décrivent ce qui reste visible.
      stats: {
        agents: AGENTS.length - hiddenAgents.length,
        folders: FOLDERS.filter((f) =>
          String(f.agentIds).split(',').some((id) => !hiddenAgents.includes(id))
        ).length,
        sessions: SESSIONS.filter((x) => !hiddenAgents.includes(x.agentId)).length,
        messages: MESSAGES.length,
      },
      saved: true,
      error: null,
    };
  },
  refresh: async (options = {}) => {
    lastRefresh = { quiet: options.quiet === true };
    let indexed = 0;
    if (pending.session) {
      SESSIONS.unshift(pending.session);
      FOLDERS[0].sessionCount += 1;
      pending.session = null;
      indexed += 1;
    }
    if (pending.big) {
      BIG.push(pending.big);
      BIG_SESSIONS[0].messageCount = BIG.length;
      pending.big = null;
      indexed += 1;
    }
    if (pending.message) {
      MESSAGES.push(pending.message);
      SESSIONS.find((x) => x.id === 'claude:s1').messageCount += 1;
      pending.message = null;
      indexed += 1;
    }
    return {
      scanned: 1, indexed, skipped: 0, messages: MESSAGES.length, orphans: 0,
      agents: [], errors: [], unknownKinds: {},
      stats: { agents: 1, folders: 1, sessions: SESSIONS.length, messages: MESSAGES.length },
    };
  },
  agents: async () => AGENTS,
  // The real one filters in SQL; here it is enough that hiding changes what
  // comes back, which is what the screen is checked against.
  folders: async () =>
    FOLDERS.filter((f) => String(f.agentIds).split(',').some((id) => !hiddenAgents.includes(id))),
  sessions: async (folderId) => {
    if (folderId === 3) return BIG_SESSIONS.map(marked);
    if (folderId !== 2) return SESSIONS.filter((x) => !hiddenAgents.includes(x.agentId)).map(marked);
    if (fragileWillFail) {
      fragileWillFail = false;
      throw new Error('lecture impossible');
    }
    return FRAGILE_SESSIONS.map(marked);
  },
  favorites: async () =>
    [...SESSIONS, ...FRAGILE_SESSIONS, ...BIG_SESSIONS]
      .filter((s) => MARKS[s.id] && (MARKS[s.id].favorite || MARKS[s.id].messages.length))
      .map((s) => ({ ...marked(s), folderPath: '/home/zam/projet' })),
  markSession: async (id, change = {}) => {
    const previous = MARKS[id] || { favorite: false, note: '', messages: [] };
    const mark = {
      favorite: change.favorite === undefined ? previous.favorite : change.favorite === true,
      note: change.note === undefined ? previous.note : String(change.note).trim(),
      messages: previous.messages,
    };
    if (!mark.favorite && !mark.note && mark.messages.length === 0) delete MARKS[id];
    else MARKS[id] = mark;
    return { favorite: mark.favorite, note: mark.note };
  },
  markMessage: async (id, messageId, favorite) => {
    const messages = id === BIG_ID ? BIG : MESSAGES;
    const message = messages.find((m) => m.id === messageId);
    const previous = MARKS[id] || { favorite: false, note: '', messages: [] };
    const kept = previous.messages.filter((m) => m.seq !== message.seq);
    const mark = {
      ...previous,
      messages: favorite
        ? [...kept, { uuid: message.uuid || '', seq: message.seq, role: message.role, at: message.ts,
            preview: String(message.text).replace(/\s+/g, ' ').trim().slice(0, 160) }]
        : kept,
    };
    if (!mark.favorite && !mark.note && mark.messages.length === 0) delete MARKS[id];
    else MARKS[id] = mark;
    return resolveStarred(id, messages);
  },
  session: async (id) => {
    if (id === SUBAGENT.id) {
      const messages = [
        { id: 95, seq: 0, role: 'user', ts: '2026-09-17T21:05:00.000Z', text: 'consigne du parent',
          thinking: '', parts: [], isMeta: false, isNotice: false, isSidechain: true, command: null },
        { id: 96, seq: 1, role: 'assistant', ts: '2026-09-17T21:06:00.000Z', model: 'gpt-5',
          text: 'rapport du sous-agent', thinking: '', parts: [],
          isMeta: false, isNotice: false, isSidechain: true, command: null,
          usage: { input: 5, output: 60, cacheRead: 900, cacheWrite: 0, reasoning: null } },
      ];
      return {
        session: marked({ ...SUBAGENT, ...spanOf(SUBAGENT), folderPath: '/home/zam/projet', folderId: 1 }),
        chain: [],
        copied: null,
        parent: { id: 'codex:c1', title: 'Session Codex A', firstPrompt: '' },
        subagents: [],
        usageByReply: true,
        messages,
        favoriteMessages: [],
      };
    }
    if (id === BIG_ID) {
      return {
        usageByReply: true,
        session: marked({ ...BIG_SESSIONS[0], ...spanOf(BIG_SESSIONS[0]), folderPath: '/home/zam/grosse', folderId: 3 }),
        messages: BIG.slice(),
        favoriteMessages: resolveStarred(id, BIG),
      };
    }
    const found = [...SESSIONS, ...FRAGILE_SESSIONS].find((s) => s.id === id);
    if (!found) return null;
    // The Claude session answers slowly, so a second click can overtake it.
    if (id === 'claude:s1' && slowClaudeSession) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    // Only the Claude session carries the full message fixture; the Codex ones
    // exist so the sidebar has two agents to separate.
    const messages = id === 'claude:s1' ? MESSAGES : [
      { id: 90, seq: 0, role: 'user', ts: '2026-09-17T21:00:00.000Z',
        text: 'prompt codex', thinking: '', parts: [],
        isMeta: false, isNotice: false, isSidechain: false, command: null },
      // Two models in one conversation: each takes over with a label.
      { id: 92, seq: 1, role: 'assistant', ts: '2026-09-17T21:00:10.000Z', model: 'gpt-5.2-codex',
        text: 'premier jet codex', thinking: '', parts: [],
        isMeta: false, isNotice: false, isSidechain: false, command: null },
      // The answer whose label must read "Codex", not "Claude".
      { id: 91, seq: 2, role: 'assistant', ts: '2026-09-17T21:00:30.000Z', model: 'gpt-6-astra',
        text: 'reponse codex', thinking: '', parts: [],
        isMeta: false, isNotice: false, isSidechain: false, command: null,
        usage: { input: 700, output: 90, cacheRead: 2000, cacheWrite: null, reasoning: null } },
    ];
    return {
      session: marked({ ...found, ...spanOf(found), folderPath: '/home/zam/projet', folderId: 1 }),
      chain: chainOf(id),
      // La partie B a commencé par recopier douze messages de la partie A :
      // l'en-tête doit le dire, et y mener.
      copied: id === 'codex:c2'
        ? { count: 12, from: { id: 'codex:c1', title: 'Session Codex A', firstPrompt: '' } }
        : null,
      parent: null,
      // La partie B fait comme Copilot : un total par session, rien par réponse.
      usageByReply: id !== 'codex:c2',
      subagents: id === 'codex:c1'
        ? [{ id: SUBAGENT.id, title: SUBAGENT.title, firstPrompt: '', messageCount: 2,
          firstAt: SUBAGENT.firstAt, tokOutput: 1234 }]
        : [],
      messages,
      favoriteMessages: resolveStarred(id, messages),
    };
  },
  statistics: async (period) => {
    statisticsCalls.push(period ?? null);
    return JSON.parse(JSON.stringify(STATISTICS));
  },
  search: async (query, options = {}) => {
    searchCalls.push({ query, period: options.period ?? null, agentId: options.agentId ?? null });
    if (!query || !query.trim()) return [];
    // The fixture's hits are all older than a week: the empty case, worded.
    if (options.period === '7d') return [];
    if (query.includes('profond')) {
      return [{
        id: 100007, sessionId: BIG_ID, role: 'user', ts: BIG[7].ts, seq: 7,
        title: 'Très longue conversation', source: 'transcript', agentId: 'claude',
        folderPath: '/home/zam/grosse', folderId: 3,
        snippet: `le message ${String.fromCharCode(1)}profond${String.fromCharCode(2)}`, rank: -1,
      }];
    }
    // Honour the agent filter so the scope dropdown can be asserted on.
    if (options.agentId) return SEARCH_HITS.filter((h) => h.agentId === options.agentId);
    return SEARCH_HITS;
  },
  openFolder: async () => true,
  exportSession: async (id, format, options = {}) => {
    exportCalls.push({ id, format, newestFirst: options.newestFirst === true });
    return { saved: true, path: `/home/zam/Documents/export.${format}` };
  },
  copyMessage: async (id) => {
    copyCalls.push(id);
    return true;
  },
  forget: async (id) => {
    forgotten.push(id);
    const at = FRAGILE_SESSIONS.findIndex((x) => x.id === id);
    if (at >= 0) FRAGILE_SESSIONS.splice(at, 1);
    FOLDERS[1].sessionCount = FRAGILE_SESSIONS.length;
    return true;
  },
  resumeInfo: async (id) =>
    id.startsWith('codex:')
      ? { ok: true, display: 'codex resume c1', exact: true, note: null }
      : { ok: true, display: 'claude --resume s1', exact: true, note: null },
  resume: async () => resumeReply || { ok: true, terminal: 'gnome-terminal', display: 'claude --resume s1' },
  settings: async () => copyOf(SETTINGS),

  /**
   * Ce que le processus principal aurait décidé, piloté par l'URL comme la
   * langue l'est : `?update=0.9.9` annonce cette version, rien annonce qu'il
   * n'y a rien. Le vrai réglage se lit dans le processus principal, donc il
   * n'a aucune raison d'exister ici.
   */
  checkUpdate: async () => {
    const asked = new URLSearchParams(
      globalThis.location ? globalThis.location.search : ''
    ).get('update');
    return asked
      ? { update: true, version: asked, url: `https://exemple.invalide/releases/tag/v${asked}` }
      : { update: false, reason: 'up-to-date' };
  },

  /**
   * Comptée plutôt qu'ouverte : aucun test n'envoie personne sur le web.
   *
   * Le compte repasse par le pont pour être lu. Le préchargement et la page
   * n'ont pas le même `globalThis` — c'est tout le travail de contextBridge —
   * donc un compteur posé ici serait invisible depuis le scénario.
   */
  openRelease: async () => {
    releaseOpens += 1;
    return { opened: true };
  },
  releaseOpens: async () => releaseOpens,
  checkUpdateNow: async () => updateNowAnswers.shift() || { update: false, reason: 'unreachable' },
  checkCommand: async (id, command) => {
    const agent = SETTINGS.agents.find((a) => a.id === id);
    if (!command.trim()) return agent.check;
    if (!command.startsWith('/')) return { ok: false, reason: 'setting-not-absolute', detail: command };
    if (command.includes('absent')) return { ok: false, reason: 'setting-unusable', detail: command };
    return { ok: true, executable: command.trim(), chosen: true };
  },
  saveSettings: async (commands, language, theme, updateCheck, textSize) => {
    if (SETTINGS.unreadable) throw new Error('Réglages illisibles, rien n’a été écrit');
    if (textSize !== undefined) {
      textSizeSaves.push(textSize);
      SETTINGS.textSize = textSize;
    }
    if (theme !== undefined) {
      themeSaves.push(theme);
      SETTINGS.theme = theme;
      // The real one goes through nativeTheme; here the page shows it itself,
      // which is enough to see that the choice travelled.
      document.documentElement.dataset.theme = theme;
    }
    if (language !== undefined) {
      languageSaves.push(language);
      try {
        globalThis.sessionStorage.setItem('mock.language', language === 'auto' ? 'fr' : language);
      } catch {
        /* the check that needs it will say so */
      }
    }
    settingsSaves.push(copyOf(commands));
    for (const [id, command] of Object.entries(commands)) {
      SETTINGS.agents.find((a) => a.id === id).command = command;
    }
    return copyOf(SETTINGS);
  },
  browseCommand: async () => '/home/zam/.nvm/versions/node/v22.12.0/bin/codex',
  openSettingsFile: async () => {
    settingsFileOpened += 1;
    return { path: SETTINGS.file, opened: true, unreadable: SETTINGS.unreadable };
  },
  copy: async () => true,
  onIndexProgress: () => () => {},
});

// Test-only: lets the rendering suite create the overlap it needs.
contextBridge.exposeInMainWorld('mock', {
  slowClaudeSession(value) {
    slowClaudeSession = Boolean(value);
  },
  /** A new conversation in the first folder, found by the next pass. */
  addSession() {
    pending.session = {
      id: 'claude:s9', agentId: 'claude', title: 'Session arrivée pendant la lecture',
      gitBranch: 'main', firstPrompt: 'nouvelle', messageCount: 1,
      firstAt: '2026-09-18T10:00:00.000Z', lastAt: '2026-09-18T10:00:00.000Z', source: 'transcript',
    };
  },
  /** A new message in the Claude conversation, found by the next pass. */
  addMessageToOpen(text = 'message arrivé en direct', id = 99) {
    pending.message = {
      id, seq: id, role: 'assistant', ts: '2026-09-18T10:01:00.000Z',
      text, thinking: '', parts: [],
      isMeta: false, isNotice: false, isSidechain: false, command: null,
    };
  },
  lastRefresh: () => lastRefresh,
  /** A new message at the end of the long conversation, found by the next pass. */
  addBigMessage() {
    pending.big = {
      id: 102000, seq: 2000, role: 'assistant', ts: '2026-09-02T12:00:00.000Z',
      text: 'arrivé au bout de 2000 messages', thinking: '', parts: [],
      isMeta: false, isNotice: false, isSidechain: false, command: null,
    };
  },
  forgotten: () => forgotten.slice(),
  exportCalls: () => exportCalls.slice(),
  searchCalls: () => searchCalls.slice(),
  statisticsCalls: () => statisticsCalls.slice(),
  settingsSaves: () => copyOf(settingsSaves),
  settingsFileOpened: () => settingsFileOpened,
  languageSaves: () => languageSaves.slice(),
  themeSaves: () => themeSaves.slice(),
  textSizeSaves: () => textSizeSaves.slice(),
  hiddenAgents: () => [...hiddenAgents],
  marks: () => JSON.parse(JSON.stringify(MARKS)),
  settingsUnreadable(message) {
    SETTINGS.unreadable = message;
  },
  failResume(reply) {
    resumeReply = reply;
  },
  copyCalls: () => copyCalls.slice(),
});
