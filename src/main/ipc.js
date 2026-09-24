'use strict';

/**
 * The entire trust boundary between the renderer and the index.
 *
 * Every handler validates its arguments before touching the database: the
 * renderer is treated as if it could send anything. Handlers return plain data
 * and never throw across the bridge — a failure comes back as
 * `{ ok: false, error }` so the UI can show it instead of dying silently.
 */

const { ipcMain, shell, clipboard, dialog, BrowserWindow, app, nativeTheme } = require('electron');

const path = require('path');

const paths = require('../core/paths');
const registry = require('../core/agents');
const { Index } = require('../core/db');
const { Indexer } = require('../core/indexer');
const { Memo } = require('../core/memo');
const { Archive } = require('../core/archive');
const { Marks, NOTE_MAX } = require('../core/marks');
const { resumeCommand } = require('../core/resume');
const { periodStart } = require('../core/period');
const { summarize } = require('../core/statistics');
const { pathToFileURL } = require('url');
const { openInTerminal, findExecutable, checkCommand } = require('./terminal');
const { Settings, CLI_AGENTS, THEMES, UPDATE_CHECKS } = require('./settings');
const { checkForUpdate } = require('./update-check');
const { Locale } = require('./locale');
const { exportSession, printHtmlToPdf, FORMATS } = require('./export');

/**
 * @type {{index: Index|null, indexing: Promise|null, userDataDir: string,
 *         memo: Memo|null, archive: Archive|null, settings: Settings|null}}
 */
const state = {
  index: null,
  indexing: null,
  userDataDir: '',
  memo: null,
  archive: null,
  marks: null,
  settings: null,
  /** Agent ids the person hid from the sidebar. */
  hidden: [],
  locale: null,
  localeReady: null,
};

/** A sentence in the app's language (locale.js). */
const t = (id, args) => state.locale.t(id, args);

const CHANNELS = [
  'app:status',
  'app:locale',
  'index:refresh',
  'agents:list',
  'agents:hide',
  'splash:words',
  'splash:keep',
  'splash:close',
  'folders:list',
  'sessions:list',
  'sessions:favorites',
  'session:get',
  'session:mark',
  'session:markMessage',
  'search:run',
  'stats:get',
  'shell:openFolder',
  'session:resumeInfo',
  'session:resume',
  'clipboard:write',
  'session:forget',
  'session:export',
  'message:copy',
  'settings:get',
  'settings:check',
  'settings:save',
  'settings:browse',
  'settings:openFile',
  'update:check',
  'update:open',
];

/** What to do when the person closes the splash screen; main.js owns the window. */
let onSplashClose = null;

function registerIpc({ userDataDir, onSplashClose: closer = null }) {
  state.userDataDir = userDataDir;
  onSplashClose = closer;
  // Beside the index, never inside it: a migration that drops the tables
  // saves what exists nowhere else into this first, and never touches it.
  state.archive = new Archive(path.join(userDataDir, 'archive'));
  // The stars and the notes: the only thing here nobody could rebuild (marks.js).
  state.marks = new Marks(userDataDir);
  state.index = new Index(paths.defaultDatabasePath(userDataDir), { archive: state.archive });
  // Kept for the app's whole life: it is what makes a pass over unchanged
  // files cost a stat each, and so what makes refreshing every 30 s free.
  state.memo = new Memo();
  // Where each CLI lives, and which language to speak, as the person states it.
  state.settings = new Settings(userDataDir, { help: settingsHelp });
  state.locale = new Locale({ systemLanguages });
  state.localeReady = state.locale.use(state.settings.language());
  applyTheme(state.settings.theme());
  // Read once and kept: every list, count and search passes through it, and it
  // changes only when the person clicks a chip.
  state.hidden = state.settings.hiddenAgents();

  /**
   * The language to show, and its words: the chosen file and the English one,
   * which the renderer builds its own localiser from.
   */
  handle('app:locale', async () => {
    const current = await state.localeReady;
    return {
      language: current.language,
      direction: current.l10n.direction,
      setting: current.setting,
      system: current.system,
      sources: current.sources,
      languages: state.locale.available(),
    };
  });

  handle('app:status', () => {
    const detected = registry.available({ env: process.env }).map((a) => a.id);
    const indexed = new Set(state.index.agents().filter((a) => a.sessionCount > 0).map((a) => a.id));
    // An agent present on disk but absent from the index means the app gained
    // an adapter since the last run. Without this the index would stay silently
    // incomplete until someone happened to press refresh.
    const missingAgents = detected.filter((id) => !indexed.has(id));

    return {
      dataDir: paths.configDir(),
      available: paths.isAvailable(),
      detectedAgents: detected,
      missingAgents,
      lastIndexedAt: state.index.meta('lastIndexedAt'),
      stats: state.index.stats(state.hidden),
      // Which assistants the sidebar may offer to hide, and which are hidden.
      // Every agent with conversations is listed, hidden ones included —
      // otherwise a hidden agent could never be brought back.
      agents: agentsInIndex(),
      hiddenAgents: state.hidden,
    };
  });

  // ── L'écran d'accueil : deux canaux, et rien de plus ────────────────────

  /** The two sentences that window shows, in the app's language. */
  handle('splash:words', async () => {
    await state.localeReady;
    return { hide: t('splash-hide'), dismiss: t('splash-continue') };
  });

  /**
   * The person closed it. The window itself cannot: it has no Node, no
   * `window.close` on a frameless window it does not own — and above all, the
   * main window waits for this to show itself.
   */
  handle('splash:close', () => {
    if (typeof onSplashClose === 'function') onSplashClose();
    return { closed: true };
  });

  /** The box on the splash screen: keep showing it at startup, or not. */
  handle('splash:keep', (_event, payload) => {
    const on = payload && payload.on;
    if (typeof on !== 'boolean') throw new TypeError('on must be true or false');
    const saved = state.settings.showSplash(on, detectAll());
    if (!saved.ok) throw new Error(t('error-settings-unreadable', { error: saved.error }));
    return { splash: on };
  });

  /**
   * Hide or show assistants in the sidebar. A view preference, so it is kept
   * where the other ones are (settings.json) and survives a reindexing.
   */
  handle('agents:hide', (_event, payload) => {
    const ids = payload && payload.ids;
    if (!Array.isArray(ids)) throw new TypeError('ids must be a list');
    const known = new Set(registry.all().map((a) => a.id));
    const clean = [...new Set(ids)].map((id) => {
      if (typeof id !== 'string' || !known.has(id)) throw new TypeError('unknown agent');
      return id;
    });

    const saved = state.settings.hideAgents(clean, detectAll());
    // A file that cannot be read is the person's to fix; the choice still
    // applies to this session rather than being silently dropped.
    state.hidden = clean;
    return {
      hiddenAgents: state.hidden,
      agents: agentsInIndex(),
      stats: state.index.stats(state.hidden),
      saved: saved.ok,
      error: saved.ok ? null : saved.error,
    };
  });

  handle("index:refresh", async (event, payload) => {
    // Concurrent refreshes would fight over the same rows; share the in-flight one.
    if (state.indexing) return state.indexing;

    // A background pass runs every 30 s; it must not flash progress in the
    // footer each time. Only `true` counts: the renderer is not trusted.
    const quiet = Boolean(payload && payload.quiet === true);
    const sender = event.sender;
    state.indexing = (async () => {
      try {
        const indexer = new Indexer(state.index, {
          memo: state.memo,
          archive: state.archive,
          onProgress: (progress) => {
            if (!quiet && !sender.isDestroyed()) sender.send('index:progress', progress);
          },
        });
        const report = await indexer.run();
        return { ...report, stats: state.index.stats(state.hidden) };
      } finally {
        state.indexing = null;
      }
    })();

    return state.indexing;
  });

  handle('agents:list', () => state.index.agents());

  handle('folders:list', () => state.index.folders(state.hidden));

  handle('sessions:list', (_event, payload) => {
    const folderId = asInt(payload && payload.folderId);
    if (folderId == null) throw new TypeError('folderId must be an integer');
    return withMarks(state.index.sessions(folderId, state.hidden));
  });

  /**
   * Every starred conversation, newest first — a view of its own, because a
   * folder's sessions are only loaded when its folder is opened, and a star is
   * exactly what someone looks for without remembering where it was.
   */
  handle('sessions:favorites', () => {
    const marks = state.marks.all();
    // Starred itself, or holding a starred message: both are things the person
    // asked to find again.
    const starred = Object.entries(marks).filter(([, mark]) => mark.favorite || mark.messages.length);
    const sessions = [];
    for (const [id] of starred) {
      const session = state.index.session(id);
      // A star on a conversation the index no longer holds is kept in the file
      // — its transcript may come back — but there is nothing to show yet.
      if (session) sessions.push({ ...session, ...marks[id] });
    }
    return sessions.sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
  });

  handle('session:get', (_event, payload) => {
    const id = asId(payload && payload.id);
    if (!id) throw new TypeError('id must be a non-empty string');
    const session = state.index.session(id);
    if (!session) return null;
    const messages = state.index.messages(id);
    // A compaction split this conversation across transcripts: the parts, in
    // order, so the reader is told which one they are looking at (core/db.js).
    const chain = state.index.chain(id);
    return {
      session: withMark(session),
      chain: chain.length > 1 ? chain.map(({ id: part, title }) => ({ id: part, title })) : [],
      // A resumed or forked session began by copying another's history: how
      // much, and from where, so the reader can be sent there (core/db.js).
      copied: copiedFrom(state.index.copiedFrom(id)),
      // A subagent's conversation names the one that launched it; any other
      // lists the subagents it launched. Neither is listed in the sidebar.
      parent: session.parentId ? briefOf(state.index.session(session.parentId)) : null,
      subagents: state.index.subagents(id).map((sub) => ({ ...briefOf(sub), ...counts(sub) })),
      messages,
      // Row ids change at every rebuild, so a starred message is resolved here,
      // against the conversation as it stands now (core/marks.js).
      favoriteMessages: state.marks.resolve(id, messages),
    };
  });

  /**
   * Star one message of a conversation. The renderer names the row; the
   * coordinates that will find it again — its own id, its position, the
   * opening of its text — are read HERE, from the index (invariant 3).
   */
  handle('session:markMessage', (_event, payload) => {
    const id = asId(payload && payload.id);
    if (!id) throw new TypeError('id must be a non-empty string');
    const messageId = asInt(payload.messageId);
    if (messageId === null) throw new TypeError('messageId must be an integer');

    const messages = state.index.messages(id);
    const message = messages.find((m) => m.id === messageId);
    if (!message) throw new Error(t('error-message-not-found'));

    const result = state.marks.setMessage(
      id,
      { uuid: message.uuid, seq: message.seq, role: message.role, at: message.ts, preview: message.text },
      payload.favorite === true
    );
    if (!result.ok) throw new Error(t('error-marks-unreadable', { error: result.error }));
    return state.marks.resolve(id, messages);
  });

  /**
   * Star a conversation, or write a note on it. Both belong to the person, so
   * they live in their own file (core/marks.js) and never in the index, which
   * is thrown away and rebuilt at every schema change.
   */
  handle('session:mark', (_event, payload) => {
    const id = asId(payload && payload.id);
    if (!id) throw new TypeError('id must be a non-empty string');
    const change = {};
    if (payload.favorite !== undefined) change.favorite = payload.favorite === true;
    if (payload.note !== undefined) change.note = asNote(payload.note);

    const result = state.marks.set(id, change);
    if (!result.ok) throw new Error(t('error-marks-unreadable', { error: result.error }));
    return result.mark;
  });

  /**
   * Forget a conversation Ariane alone still holds. Anything else lives in its
   * agent's files and would simply come back at the next pass — and Ariane
   * never writes to those — so only a saved conversation can be forgotten.
   */
  handle('session:forget', async (_event, payload) => {
    const id = asId(payload && payload.id);
    if (!id) throw new TypeError('id must be a non-empty string');
    // A pass in flight could be saving this very conversation: let it finish.
    if (state.indexing) await state.indexing.catch(() => {});

    const session = state.index.session(id);
    if (!session) throw new Error(t('convo-not-found'));
    if (session.source !== 'archive') throw new Error(t('error-forget-not-saved'));
    // Interrupted between these two lines, the conversation would come back
    // from its archive file at the next pass, and could be forgotten again.
    // It reappears; it is never kept out of sight.
    state.index.forgetSession(id);
    state.archive.remove(id);
    // Forgetting is forgetting: the star and the note go with the rest.
    state.marks.remove(id);
    return true;
  });

  /**
   * Export a conversation. The renderer names it and picks a format — nothing
   * else: the document is built here from the index, and the file is chosen in
   * a dialog this process opens.
   */
  handle('session:export', async (event, payload) => {
    const id = asId(payload && payload.id);
    if (!id) throw new TypeError('id must be a non-empty string');
    const format = payload && payload.format;
    if (!Object.prototype.hasOwnProperty.call(FORMATS, format)) throw new TypeError('format must be md or pdf');

    // The order the reader sees it in; only `true` counts, as everywhere else.
    const newestFirst = payload.newestFirst === true;

    const owner = BrowserWindow.fromWebContents(event.sender);
    const { l10n } = await state.localeReady;
    return exportSession({
      l10n,
      index: state.index,
      sessionId: id,
      format,
      newestFirst,
      chooseFile: async (suggested, kind) => {
        const { canceled, filePath } = await dialog.showSaveDialog(owner, {
          title: t('export-dialog-title'),
          defaultPath: path.join(app.getPath('documents'), suggested),
          filters: [{ name: FORMATS[kind].name, extensions: [FORMATS[kind].extension] }],
        });
        return canceled || !filePath ? null : filePath;
      },
      printToPdf: (html, file, title) =>
        printHtmlToPdf(html, file, title, {
          BrowserWindow,
          workDir: path.join(state.userDataDir, 'export'),
        }),
    });
  });

  /**
   * Copy one message's prose. The renderer sends its id, not its text: a
   * message can run to tens of thousands of characters, and the clipboard
   * channel for commands rightly caps what it accepts.
   */
  handle('message:copy', (_event, payload) => {
    const id = asInt(payload && payload.id);
    if (id === null) throw new TypeError('id must be an integer');
    const text = state.index.messageText(id);
    if (!text) throw new Error(t('error-message-not-found'));
    clipboard.writeText(text);
    return true;
  });

  handle('search:run', (_event, payload) => {
    const input = typeof (payload && payload.query) === 'string' ? payload.query : '';
    if (input.trim().length === 0) return [];
    return state.index.search(input.slice(0, 500), {
      folderId: asInt(payload.folderId),
      sessionId: asId(payload.sessionId),
      agentId: asId(payload.agentId),
      // Absent means no bound; anything else must be a known period, or this throws.
      since: periodStart(payload.period == null ? 'all' : payload.period),
      limit: clamp(asInt(payload.limit) ?? 100, 1, 500),
      hidden: state.hidden,
    });
  });

  /**
   * The statistics view: every figure, for the assistants shown and a period.
   * Who spoke is decided by the screen's own rules (statistics.js).
   */
  handle('stats:get', async (_event, payload) => {
    const since = periodStart(payload && payload.period != null ? payload.period : 'all');
    const rows = state.index.statisticsRows({ hidden: state.hidden, since });
    return summarize(rows, await screenRules());
  });

  /** What, if anything, this session can be reopened with. No side effect. */
  handle('session:resumeInfo', (_event, payload) => {
    const id = asId(payload && payload.id);
    if (!id) throw new TypeError('id must be a session id');
    const session = state.index.session(id);
    if (!session) return null;

    const plan = planFor(session);
    return plan.ok
      ? { ok: true, display: plan.display, exact: plan.exact, note: plan.note || null }
      : { ok: false, reason: plan.reason, note: plan.note || null };
  });

  /**
   * Open a terminal on that session. The command is rebuilt HERE from the
   * database rather than taken from the renderer, so the only thing the
   * renderer can influence is which session — never which process runs.
   */
  handle('session:resume', (_event, payload) => {
    const id = asId(payload && payload.id);
    if (!id) throw new TypeError('id must be a session id');
    const session = state.index.session(id);
    if (!session) throw new Error(t('convo-not-found'));

    const plan = planFor(session);
    if (!plan.ok) {
      throw new Error(plan.note ? t(`resume-note-${plan.note}`) : t('error-resume-impossible', { reason: plan.reason }));
    }

    // The command the person stated, if any. A settings file that cannot be
    // followed is reported, and detection is used meanwhile: a typo there
    // should not stop a conversation from reopening.
    const chosen = state.settings.commandFor(session.agentId);
    const settingsProblem = chosen.problem || null;

    const result = openInTerminal(plan, { command: chosen.command });
    if (!result.ok) {
      return {
        ok: false,
        agentId: session.agentId,
        reason: result.reason,
        detail: result.detail || null,
        command: plan.command,
        display: plan.display,
        settingsProblem,
      };
    }
    return { ok: true, terminal: result.terminal, display: plan.display, settingsProblem };
  });

  // ── The settings window: where each assistant's CLI lives ────────────────

  /** Everything the settings window shows, with detection run afresh. */
  handle('settings:get', async () => {
    await state.localeReady;
    return settingsView();
  });

  /** Would this path run, for this assistant? Checked, never launched. */
  handle('settings:check', (_event, payload) => {
    const [, name] = asCliAgent(payload && payload.id);
    const command = asCommand(payload.command);
    return publicCheck(checkCommand(name, command.trim() || null));
  });

  /**
   * Save what the person typed in the window. Only the assistants named, only
   * their `command`; a file that cannot be read is refused rather than
   * replaced — the window then offers to open it.
   */
  handle('settings:save', async (_event, payload) => {
    const commands = payload && payload.commands;
    if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
      throw new TypeError('commands must be an object');
    }
    const clean = {};
    for (const [id, command] of Object.entries(commands)) clean[asCliAgent(id)[0]] = asCommand(command);
    const language = payload.language === undefined ? undefined : asLanguage(payload.language);
    const theme = payload.theme === undefined ? undefined : asTheme(payload.theme);
    const updateCheck = payload.updateCheck === undefined ? undefined : asUpdateCheck(payload.updateCheck);

    await state.localeReady;
    const saved = state.settings.save({ commands: clean, language, theme, updateCheck }, detectAll());
    if (!saved.ok) throw new Error(t('error-settings-unreadable', { error: saved.error }));
    // Nothing to reload: the stylesheet paints both palettes from
    // prefers-color-scheme, and this makes that question answer differently.
    if (theme !== undefined) applyTheme(theme);
    // A new language is spoken from now on — by this process too, which
    // writes the dialogs, the errors and the exports.
    if (language !== undefined && language !== state.locale.current.setting) {
      state.localeReady = state.locale.use(language);
      await state.localeReady;
      state.settings.record(detectAll()); // the file's help, in the new language
    }
    return settingsView();
  });

  /** The system's own file picker, to point at a CLI rather than type its path. */
  handle('settings:browse', async (event, payload) => {
    const [id, name] = asCliAgent(payload && payload.id);
    const label = (registry.byId(id) || {}).label || id;
    const detected = findExecutable(name);
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: t('browse-title', { agent: label }),
      defaultPath: detected ? path.dirname(detected) : app.getPath('home'),
      // Version managers live in hidden directories: ~/.nvm, ~/.local, ~/.volta.
      properties: ['openFile', 'showHiddenFiles'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Programmes', extensions: ['exe', 'cmd', 'bat', 'com'] }]
          : [],
    });
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
  });

  /**
   * Open the file itself in the person's own editor — after recording what
   * detection finds right now, so it reads as a record of this machine. A file
   * that cannot be read is opened all the same: that is where it gets fixed.
   */
  /**
   * Is there a newer Ariane? Answers a decision, never a sentence.
   *
   * The reply always has the same shape — `{update, ...}` — because the window
   * has one question to ask and one thing to do with the answer. A network
   * that did not respond, a setting that says never, a manifest with no
   * repository: all of them are simply reasons not to show anything.
   */
  handle('update:check', async () => {
    const answer = await checkForUpdate({ settings: state.settings, version: app.getVersion() });
    return answer.ok ? answer.data : { update: false, reason: answer.error };
  });

  /**
   * Open the release page in the person's browser. Ariane downloads nothing
   * and runs nothing: what happens next is theirs.
   *
   * The url is not taken from the renderer — it is rebuilt here from the
   * manifest. A window is untrusted, and `shell.openExternal` on a string it
   * chose would hand it the machine.
   */
  handle('update:open', async () => {
    const { repositoryUrl } = require('./update-check');
    const repository = repositoryUrl();
    if (!repository) return { opened: false, reason: 'no-repository' };
    await shell.openExternal(`${repository}/releases/latest`);
    return { opened: true };
  });

  handle('settings:openFile', async () => {
    await state.localeReady;
    const recorded = state.settings.record(detectAll());
    const problem = await shell.openPath(state.settings.file);
    // No application for .json on this machine: show the file where it lies.
    if (problem) shell.showItemInFolder(state.settings.file);
    return {
      path: state.settings.file,
      opened: !problem,
      unreadable: recorded.ok ? null : recorded.error,
    };
  });

  handle('clipboard:write', (_event, payload) => {
    const text = typeof (payload && payload.text) === 'string' ? payload.text : '';
    if (!text || text.length > 4096) throw new TypeError('text must be a short string');
    clipboard.writeText(text);
    return true;
  });

  handle('shell:openFolder', async (_event, payload) => {
    const target = typeof (payload && payload.path) === 'string' ? payload.path : '';
    if (!target) throw new TypeError('path must be a non-empty string');
    // openPath refuses anything that is not an existing local path, and cannot
    // be steered into executing a command.
    const problem = await shell.openPath(target);
    if (problem) throw new Error(problem);
    return true;
  });
}

// ── The settings window's helpers ────────────────────────────────────────────

/** Where detection finds each CLI, right now: agentId -> path, or null. */
function detectAll() {
  return Object.fromEntries(CLI_AGENTS.map(([id, name]) => [id, findExecutable(name)]));
}

/** A check as the renderer may see it: never an environment, never more than this. */
function publicCheck(check) {
  return check.ok
    ? { ok: true, executable: check.executable, chosen: check.chosen }
    : { ok: false, reason: check.reason, detail: check.detail ?? null };
}

/**
 * Every assistant with a CLI, as the settings window lists it: what the person
 * chose, what detection found, whether it would run, and how many of their
 * conversations it holds — the window lists first the ones that matter here.
 */
/** Every assistant the index holds conversations for, named and counted. */
function agentsInIndex() {
  return state.index
    .agents()
    .filter((agent) => agent.sessionCount > 0)
    .map((agent) => ({
      id: agent.id,
      label: (registry.byId(agent.id) || {}).label || agent.id,
      sessions: agent.sessionCount,
    }));
}

function settingsView() {
  const detected = detectAll();
  state.settings.record(detected); // keeps the file a record; refused if unreadable
  const read = state.settings.read();
  const theirs =
    read.ok && read.data.agents && typeof read.data.agents === 'object' ? read.data.agents : {};
  const sessions = new Map(state.index.agents().map((a) => [a.id, a.sessionCount]));

  const locale = state.locale.current;
  return {
    file: state.settings.file,
    unreadable: read.ok ? null : read.error,
    language: {
      setting: locale.setting,
      current: locale.language,
      system: locale.system,
      available: state.locale.available(),
    },
    theme: state.settings.theme(),
    updateCheck: state.settings.updateCheck(),
    agents: CLI_AGENTS.map(([id, name]) => {
      const entry = Object.hasOwn(theirs, id) ? theirs[id] : null;
      const command = entry && typeof entry.command === 'string' ? entry.command : '';
      return {
        id,
        name,
        label: (registry.byId(id) || {}).label || id,
        command,
        detected: detected[id],
        sessions: sessions.get(id) || 0,
        check: publicCheck(checkCommand(name, command.trim() || null)),
      };
    }),
  };
}

/** Whether the splash screen should be shown; main.js asks before opening a window. */
function splashEnabled() {
  return state.settings ? state.settings.splash() : false;
}

/** The system's languages, most preferred first; `fr-BE` before `en-US` for a Belgian desktop. */
function systemLanguages() {
  try {
    if (typeof app.getPreferredSystemLanguages === 'function') {
      const preferred = app.getPreferredSystemLanguages();
      if (preferred && preferred.length) return preferred;
    }
    return typeof app.getLocale === 'function' ? [app.getLocale()].filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** The help at the top of settings.json, in the app's language. */
function settingsHelp(example, platform) {
  return [
    t('settings-file-intro'),
    t('settings-file-detected'),
    t('settings-file-command'),
    t('settings-file-example', { example }),
    t(platform === 'win32' ? 'settings-file-paths-windows' : 'settings-file-paths'),
    t('settings-file-language'),
    t('settings-file-theme'),
  ];
}

/** "auto", or a language that has a file; anything else is refused. */
/**
 * The theme, applied where it costs nothing. Electron can make
 * `prefers-color-scheme` answer light or dark whatever the system says, and the
 * stylesheet already paints both palettes from that one question. So the theme
 * never crosses into the renderer, nothing has to be reloaded when it changes,
 * and the window opens in the right one rather than flashing the other.
 */
function applyTheme(theme) {
  nativeTheme.themeSource = theme === 'auto' ? 'system' : theme;
}

/** One of the three themes; anything else is refused. */
function asTheme(value) {
  if (typeof value !== 'string' || !THEMES.includes(value)) throw new TypeError('unknown theme');
  return value;
}

function asLanguage(value) {
  if (value === 'auto') return value;
  const known = state.locale.available().some((l) => l.code === value);
  if (typeof value !== 'string' || !known) throw new TypeError('unknown language');
  return value;
}

/** One of the assistants that have a CLI to launch; anything else is refused. */
function asCliAgent(value) {
  const found = CLI_AGENTS.find(([id]) => id === value);
  if (!found) throw new TypeError('unknown agent');
  return found;
}

/** A note as the person typed it: text, several lines allowed, nothing more. */
function asNote(value) {
  if (typeof value !== 'string') throw new TypeError('note must be a string');
  if (value.length > NOTE_MAX) throw new TypeError('note is too long');
  return value;
}

/** Sessions, each carrying what the person marked on it. */
function withMarks(sessions) {
  const marks = state.marks.all();
  return sessions.map((session) => ({
    ...session,
    favorite: Boolean(marks[session.id] && marks[session.id].favorite),
    note: (marks[session.id] && marks[session.id].note) || '',
  }));
}

const withMark = (session) => ({ ...session, ...state.marks.of(session.id) });

/**
 * How to reopen a conversation — never a subagent's: its CLI refuses to resume
 * one (the SDK reads a sidechain as no session at all), and the conversation
 * to reopen is the one that launched it.
 */
function planFor(session) {
  if (session.parentId) return { ok: false, reason: 'subagent' };
  return resumeCommand(session.agentId, session.id, session.folderPath);
}

/** Where a conversation's copies come from, reduced to what the header names. */
function copiedFrom(copied) {
  if (!copied || !copied.from) return null;
  return { count: copied.count, from: briefOf(copied.from) };
}

/** A conversation as the header names it: never a path. */
function briefOf(session) {
  if (!session) return null;
  const { id, title, firstPrompt } = session;
  return { id, title, firstPrompt };
}

const counts = ({ messageCount, firstAt, tokOutput }) => ({ messageCount, firstAt, tokOutput });

/** A path as the person typed it: text, of a sane length, with no control characters. */
function asCommand(value) {
  if (typeof value !== 'string') throw new TypeError('command must be a string');
  if (value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError('command is not a usable path');
  }
  return value;
}

/**
 * One of the two words the setting may hold, or a refusal.
 *
 * The window is untrusted like any other: a value that is not one of the two
 * would otherwise reach settings.json and be read back on the next launch.
 */
function asUpdateCheck(value) {
  if (typeof value !== 'string' || !UPDATE_CHECKS.includes(value)) {
    throw new TypeError('updateCheck must be "never" or "startup"');
  }
  return value;
}

/** Wrap a handler so it always resolves to a tagged result. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      // Every reply may carry a sentence — an error, a dialog title — so none
      // is answered before the words are loaded: never an id in their place.
      if (state.localeReady) await state.localeReady.catch(() => {});
      return { ok: true, data: await fn(event, payload) };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });
}

function disposeIpc() {
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  if (state.index) {
    state.index.close();
    state.index = null;
  }
}

// -- argument coercion -------------------------------------------------------

function asInt(value) {
  // Only primitives are considered: Number([]) is 0 and Number(['3']) is 3,
  // so coercing objects would let a hostile payload smuggle in a valid id.
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** Session ids are opaque identifiers; reject anything that is not one. */
function asId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(trimmed) ? trimmed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

let formatModule = null;

/**
 * `speakerOf`, `hasContent` and `modelName` from the renderer's format.js — an
 * ES module shared with the main process, as exports share it: one set of
 * rules for who spoke, never two.
 */
async function screenRules() {
  if (!formatModule) {
    const file = path.join(__dirname, '..', 'renderer', 'format.js');
    formatModule = await import(pathToFileURL(file).href);
  }
  return formatModule;
}

module.exports = { registerIpc, disposeIpc, splashEnabled, CHANNELS, asInt, asId, clamp };
