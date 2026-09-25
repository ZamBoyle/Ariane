'use strict';

/**
 * Tests for the trust boundary.
 *
 * `electron` is stubbed through require.cache before ipc.js is loaded, so the
 * handlers can be invoked directly, in-process, with no window and no Chromium.
 * The renderer is assumed hostile: every test here sends something a well-behaved
 * UI would never send.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createFixture, records, cdx, cop, resetCounters } = require('./helpers/fixture');

/** Session ids are namespaced by agent; see agents/contract.js. */
const SID = 'claude:s1';

// ── Stub electron before anything requires it ────────────────────────────

const handlers = new Map();
const openPathCalls = [];
const clipboardWrites = [];
/** What the next "save as" dialog answers: a path, or null for a cancel. */
let nextSavePath = null;
/** The languages the stubbed system prefers. */
let systemLanguages = ['fr-BE', 'en-US'];
/** What the next "open" dialog answers, and what each was asked. */
let nextOpenPath = null;
const openDialogCalls = [];

const electronStub = {
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
  },
  shell: {
    showItemInFolder: () => {},
    openPath: async (target) => {
      openPathCalls.push(target);
      return fs.existsSync(target) ? '' : `no such path: ${target}`;
    },
  },
  clipboard: { writeText: (text) => clipboardWrites.push(text) },
  dialog: {
    showSaveDialog: async () => (nextSavePath ? { canceled: false, filePath: nextSavePath } : { canceled: true }),
    showOpenDialog: async (_win, options) => {
      openDialogCalls.push(options);
      return nextOpenPath ? { canceled: false, filePaths: [nextOpenPath] } : { canceled: true, filePaths: [] };
    },
  },
  BrowserWindow: { fromWebContents: () => null },
  // Electron makes prefers-color-scheme answer what the person chose; the
  // stub only remembers what it was told, which is what the tests check.
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
  // A Belgian desktop: French first. `systemLanguages` lets a test change it.
  app: { getPath: () => os.tmpdir(), getPreferredSystemLanguages: () => systemLanguages },
};

require.cache[require.resolve('electron')] = {
  id: require.resolve('electron'),
  filename: require.resolve('electron'),
  loaded: true,
  exports: electronStub,
};

const { registerIpc, disposeIpc, asInt, asId, clamp } = require('../src/main/ipc');

// ── Harness ──────────────────────────────────────────────────────────────

/** Invoke a registered handler the way ipcMain would, and unwrap the envelope. */
async function invoke(channel, payload, sender = { isDestroyed: () => true, send() {} }) {
  const fn = handlers.get(channel);
  assert.ok(fn, `channel ${channel} is not registered`);
  return fn({ sender }, payload);
}

function setupIpc() {
  resetCounters();
  const fx = createFixture();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-userdata-'));
  // registerIpc reads process.env directly, so every agent root is redirected
  // there for the duration of the test and restored afterwards.
  const saved = {};
  for (const [key, value] of Object.entries(fx.env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }

  return {
    fx,
    userDataDir,
    start: () => registerIpc({ userDataDir }),
    teardown: () => {
      disposeIpc();
      openPathCalls.length = 0;
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fx.cleanup();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

test('registers exactly the documented channels', (t) => {
  const ctx = setupIpc();
  t.after(ctx.teardown);
  ctx.start();

  assert.deepEqual(
    [...handlers.keys()].sort(),
    ['agents:hide', 'agents:list', 'app:locale', 'app:status', 'clipboard:write', 'folders:list', 'index:refresh',
     'message:copy', 'search:run', 'session:export', 'session:forget', 'session:get',
     'session:mark', 'session:markMessage', 'session:resume', 'session:resumeInfo',
     'sessions:favorites', 'sessions:list',
     'settings:browse', 'settings:check', 'settings:get', 'settings:openFile', 'settings:save',
     'shell:openFolder', 'splash:close', 'splash:keep', 'splash:words',
     'stats:get', 'update:check', 'update:checkNow', 'update:open']
  );
});

test('every reply is wrapped in an ok/data envelope', async (t) => {
  const ctx = setupIpc();
  t.after(ctx.teardown);
  ctx.start();

  const reply = await invoke('app:status');
  assert.equal(reply.ok, true);
  assert.equal(typeof reply.data.dataDir, 'string');
  assert.equal(typeof reply.data.stats.sessions, 'number');
  assert.ok(Array.isArray(reply.data.detectedAgents));
  assert.ok(Array.isArray(reply.data.missingAgents));
});

test('a handler failure comes back tagged, never thrown across the bridge', async (t) => {
  const ctx = setupIpc();
  t.after(ctx.teardown);
  ctx.start();

  const reply = await invoke('sessions:list', { folderId: 'pas-un-entier' });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /folderId/);
});

test.describe('hostile payloads are rejected, not executed', () => {
  const cases = [
    ['sessions:list', undefined],
    ['sessions:list', null],
    ['sessions:list', {}],
    ['sessions:list', { folderId: 1.5 }],
    ['sessions:list', { folderId: [] }],
    ['session:get', { id: '' }],
    ['session:get', { id: '../../etc/passwd' }],
    ['session:get', { id: { toString: () => 'x' } }],
    ['session:get', { id: 'a'.repeat(500) }],
    ['shell:openFolder', {}],
    ['shell:openFolder', { path: 123 }],
    // Forgetting deletes: the one channel where a bad id must never get far.
    ['session:forget', undefined],
    ['session:forget', { id: '' }],
    ['session:forget', { id: '../../etc/passwd' }],
    ['session:forget', { id: { toString: () => 'claude:x' } }],
    ['session:forget', { id: 'claude:inconnue' }],
    // Exporting writes a file: nothing but a known conversation and format.
    ['session:export', { id: 'claude:x', format: 'exe' }],
    ['session:export', { id: '../../etc/passwd', format: 'md' }],
    ['session:export', { id: 'claude:x', format: { toString: () => 'md' } }],
    ['session:export', { id: 'claude:x', format: 'toString' }],
    ['message:copy', { id: 'un' }],
    ['message:copy', { id: [3] }],
    ['message:copy', { id: 999999 }],
    // The settings: the renderer writes the person's file through these.
    ['settings:save', undefined],
    ['settings:save', { commands: [] }],
    ['settings:save', { commands: 'claude' }],
    ['settings:save', { commands: { vscode: '/usr/bin/code' } }],
    ['settings:save', { commands: { inconnu: '/x' } }],
    ['settings:save', { commands: JSON.parse('{"__proto__": "/x"}') }],
    ['settings:save', { commands: { claude: 42 } }],
    ['settings:save', { commands: { claude: { toString: () => '/x' } } }],
    ['settings:save', { commands: { claude: 'x'.repeat(2000) } }],
    ['settings:save', { commands: { claude: `/usr/bin/cl${String.fromCharCode(10)}aude` } }],
    ['settings:check', { id: 'toString', command: '/x' }],
    ['settings:check', { id: 'claude', command: null }],
    ['settings:browse', { id: '../../etc' }],
    ['settings:save', { commands: {}, language: 'xx' }],
    ['settings:save', { commands: {}, language: '../../etc/passwd' }],
    ['settings:save', { commands: {}, language: { toString: () => 'en' } }],
    ['settings:save', { commands: {}, textSize: 150 }],
    ['settings:save', { commands: {}, textSize: '120' }],
    ['settings:save', { commands: {}, textSize: { valueOf: () => 120 } }],
    ['settings:save', { commands: {}, theme: 'sombre' }],
    ['settings:save', { commands: {}, theme: 'DARK' }],
    ['settings:save', { commands: {}, theme: 42 }],
    ['settings:save', { commands: {}, theme: { toString: () => 'dark' } }],
    ['agents:hide', undefined],
    ['agents:hide', { ids: 'codex' }],
    ['agents:hide', { ids: ['inconnu'] }],
    ['agents:hide', { ids: [42] }],
    ['agents:hide', { ids: [{ toString: () => 'codex' }] }],
    ['splash:keep', undefined],
    ['splash:keep', { on: 'false' }],
    ['splash:keep', { on: 0 }],
    ['splash:keep', {}],
    // A star and a note are the person's own words: the one thing here that
    // cannot be rebuilt.
    ['session:mark', undefined],
    ['session:mark', { id: '' }],
    ['session:mark', { id: '../../etc/passwd', favorite: true }],
    ['session:mark', { id: 'claude:s1', note: 42 }],
    ['session:mark', { id: 'claude:s1', note: { toString: () => 'x' } }],
    ['session:mark', { id: 'claude:s1', note: 'x'.repeat(5000) }],
  ];

  for (const [channel, payload] of cases) {
    test(`${channel} ${JSON.stringify(payload)}`, async (t) => {
      const ctx = setupIpc();
      t.after(ctx.teardown);
      ctx.start();

      const reply = await invoke(channel, payload);
      assert.equal(reply.ok, false, 'must not succeed');
      assert.equal(typeof reply.error, 'string');
    });
  }
});

test('search tolerates any input and never throws', async (t) => {
  const ctx = setupIpc();
  t.after(ctx.teardown);
  ctx.start();

  for (const payload of [
    undefined,
    {},
    { query: '' },
    { query: '   ' },
    { query: 'AND OR NOT' },
    { query: '"""' },
    { query: 'x'.repeat(5000) },
    { query: 'ok', folderId: 'nope' },
    { query: 'ok', limit: -5 },
    { query: 'ok', limit: 99999 },
    { query: 42 },
  ]) {
    const reply = await invoke('search:run', payload);
    assert.equal(reply.ok, true, JSON.stringify(payload));
    assert.ok(Array.isArray(reply.data), JSON.stringify(payload));
  }
});

// A filter the handler cannot read must not quietly become "all dates": the
// person would see results from outside the period they chose.
test('search refuses a period it does not know', async (t) => {
  const ctx = setupIpc();
  t.after(ctx.teardown);
  ctx.start();

  for (const period of ['forever', '__proto__', 'toString', {}, ['7d'], 7]) {
    const reply = await invoke('search:run', { query: 'ok', period });
    assert.equal(reply.ok, false, JSON.stringify(period));
    assert.equal(typeof reply.error, 'string');
  }
  for (const period of [undefined, null, 'all', '7d', '30d', 'year']) {
    const reply = await invoke('search:run', { query: 'ok', period });
    assert.equal(reply.ok, true, String(period));
  }
});

// The statistics take the same period, and must refuse the same nonsense.
test('the statistics refuse a period they do not know', async (t) => {
  const ctx = setupIpc();
  t.after(ctx.teardown);
  ctx.start();

  for (const period of ['forever', '__proto__', {}, 7]) {
    assert.equal((await invoke('stats:get', { period })).ok, false, JSON.stringify(period));
  }
  for (const period of [undefined, 'all', '7d', '30d', 'year']) {
    const reply = await invoke('stats:get', { period });
    assert.equal(reply.ok, true, String(period));
    assert.equal(typeof reply.data.records, 'number');
    assert.ok(Array.isArray(reply.data.quotas), 'les limites voyagent avec les chiffres');
  }
});

// ── Hiding an assistant ───────────────────────────────────────────────────
//
// The filter is applied in SQL, so that the sidebar, the footer and the search
// all answer the same question. These check that they do.

test.describe('showing and hiding assistants', () => {
  /** Two assistants, one folder each, so hiding one is visible everywhere. */
  async function twoAgents(ctx) {
    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('une question claude')]);
    ctx.fx.codex().session('11111111-1111-1111-1111-111111111111', [
      cdx.meta('/autre'),
      cdx.message('user', 'une question codex'),
    ]);
    ctx.start();
    await invoke('index:refresh', { quiet: true });
  }

  test('the splash screen says its one sentence, and remembers the answer', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();

    const words = await invoke('splash:words');
    assert.equal(words.ok, true);
    assert.ok(words.data.hide.length > 0, 'jamais un identifiant nu');
    assert.ok(words.data.dismiss.length > 0, 'le bouton non plus');

    const kept = await invoke('splash:keep', { on: false });
    assert.deepEqual(kept.data, { splash: false });
    const file = JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'settings.json'), 'utf8'));
    assert.equal(file.splash, false, 'gardé là où vivent les autres préférences');

    await invoke('splash:keep', { on: true });
    assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'settings.json'), 'utf8')).splash, true);
  });

  test('closing it is passed to whoever owns the window', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();

    // registerIpc a reçu le rappel de main.js ; sans fenêtre, il ne fait rien,
    // mais le canal doit répondre plutôt que de laisser la page en suspens.
    const closed = await invoke('splash:close');
    assert.deepEqual(closed.data, { closed: true });
  });

  test('every assistant with conversations is offered, hidden ones included', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    await twoAgents(ctx);

    const before = (await invoke('app:status')).data;
    assert.deepEqual(before.agents.map((a) => a.id).sort(), ['claude', 'codex']);
    assert.deepEqual(before.hiddenAgents, []);

    const after = (await invoke('agents:hide', { ids: ['codex'] })).data;
    assert.deepEqual(after.hiddenAgents, ['codex']);
    assert.deepEqual(
      after.agents.map((a) => a.id).sort(),
      ['claude', 'codex'],
      'un assistant masqué reste listé, sinon on ne pourrait jamais le rappeler'
    );
  });

  test('the statistics follow too: they describe what the sidebar shows', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    await twoAgents(ctx);

    const before = (await invoke('stats:get', {})).data;
    assert.equal(before.sessions, 2);
    assert.equal(before.speakers.you, 2, 'une question tapée dans chaque assistant');

    await invoke('agents:hide', { ids: ['codex'] });
    const after = (await invoke('stats:get', {})).data;
    assert.equal(after.sessions, 1);
    assert.deepEqual(after.agents.map((a) => a.agentId), ['claude'], 'l’assistant masqué ne compte plus');
  });

  test('the sidebar, the footer and the search all follow', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    await twoAgents(ctx);

    const before = (await invoke('folders:list')).data;
    assert.equal(before.length, 2);
    assert.equal((await invoke('search:run', { query: 'question' })).data.length, 2);

    await invoke('agents:hide', { ids: ['codex'] });

    const folders = (await invoke('folders:list')).data;
    assert.equal(folders.length, 1, 'un dossier qui n’a plus rien à montrer disparaît');
    assert.equal(folders[0].sessionCount, 1);

    const sessions = (await invoke('sessions:list', { folderId: folders[0].id })).data;
    assert.deepEqual(sessions.map((s) => s.agentId), ['claude']);

    const hits = (await invoke('search:run', { query: 'question' })).data;
    assert.deepEqual(hits.map((h) => h.agentId), ['claude'], 'masqué à gauche, absent des résultats');

    const stats = (await invoke('app:status')).data.stats;
    assert.equal(stats.folders, 1);
    assert.equal(stats.sessions, 1, 'le compteur décrit ce qui est à l’écran');
  });

  test('the choice is written where the other preferences live', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    await twoAgents(ctx);

    await invoke('agents:hide', { ids: ['codex'] });
    const file = JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'settings.json'), 'utf8'));
    assert.deepEqual(file.hiddenAgents, ['codex']);
    assert.ok(file.agents.codex, 'et la détection reste ce qu’elle était');

    await invoke('agents:hide', { ids: [] });
    const back = JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'settings.json'), 'utf8'));
    assert.deepEqual(back.hiddenAgents, []);
    assert.equal((await invoke('folders:list')).data.length, 2);
  });

  test('a filter written in the file is applied from the first pass', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    fs.mkdirSync(ctx.userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(ctx.userDataDir, 'settings.json'),
      JSON.stringify({ hiddenAgents: ['codex'] })
    );
    await twoAgents(ctx);

    assert.deepEqual((await invoke('app:status')).data.hiddenAgents, ['codex']);
    assert.equal((await invoke('folders:list')).data.length, 1);
  });
});

// ── The stars and the notes ────────────────────────────────────────────────

test.describe('marks', () => {
  async function indexed(ctx) {
    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('une question')]);
    ctx.start();
    await invoke('index:refresh', { quiet: true });
    const folders = await invoke('folders:list');
    return folders.data[0].id;
  }

  test('a star and a note travel with the conversation, and live in their own file', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    const folderId = await indexed(ctx);

    const before = await invoke('sessions:list', { folderId });
    assert.deepEqual(
      { favorite: before.data[0].favorite, note: before.data[0].note },
      { favorite: false, note: '' },
      'nothing marked says so, rather than saying nothing'
    );

    const marked = await invoke('session:mark', { id: SID, favorite: true, note: '  celle-ci compte  ' });
    assert.deepEqual(marked.data, { favorite: true, note: 'celle-ci compte' });

    const after = await invoke('sessions:list', { folderId });
    assert.equal(after.data[0].favorite, true);
    assert.equal(after.data[0].note, 'celle-ci compte');
    assert.equal((await invoke('session:get', { id: SID })).data.session.favorite, true);

    const file = path.join(ctx.userDataDir, 'marks.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(stored.marks[SID].favorite, true, 'in marks.json, never in the index');
  });

  test('a starred message is stored by what will find it again, not by a row id', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.userText('une question'),
      records.assistantText('la réponse qui compte'),
    ]);
    ctx.start();
    await invoke('index:refresh', { quiet: true });

    const { messages } = (await invoke('session:get', { id: SID })).data;
    const answer = messages.find((m) => m.role === 'assistant');
    const starred = await invoke('session:markMessage', { id: SID, messageId: answer.id, favorite: true });
    assert.deepEqual(starred.data, [answer.id], 'answered with the rows as they stand now');

    const stored = JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'marks.json'), 'utf8'));
    const [mark] = stored.marks[SID].messages;
    assert.equal(mark.uuid, answer.uuid, 'its own id, when the agent wrote one');
    assert.equal(mark.seq, answer.seq, 'its position');
    assert.ok(mark.preview.startsWith('la réponse'), 'and the opening of its text');
    assert.equal('id' in mark, false, 'never the row id, which the next rebuild changes');

    const reopened = await invoke('session:get', { id: SID });
    assert.deepEqual(reopened.data.favoriteMessages, [answer.id]);

    // Taking the star off leaves nothing behind.
    await invoke('session:markMessage', { id: SID, messageId: answer.id, favorite: false });
    assert.deepEqual((await invoke('session:get', { id: SID })).data.favoriteMessages, []);
  });

  test('the starred conversations are a view of their own', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    await indexed(ctx);

    assert.deepEqual((await invoke('sessions:favorites')).data, [], 'nothing starred, nothing listed');
    await invoke('session:mark', { id: SID, favorite: true });
    const starred = (await invoke('sessions:favorites')).data;
    assert.deepEqual(starred.map((s) => s.id), [SID]);
    assert.equal(starred[0].favorite, true);

    // A star on a conversation the index no longer holds stays in the file —
    // its transcript may come back — but nothing is invented for the list.
    await invoke('session:mark', { id: 'claude:partie', favorite: true });
    assert.deepEqual((await invoke('sessions:favorites')).data.map((s) => s.id), [SID]);
    const stored = JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'marks.json'), 'utf8'));
    assert.equal(stored.marks['claude:partie'].favorite, true, 'kept, in case it comes back');
  });

  test('forgetting a conversation forgets its mark too', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    const project = ctx.fx.project('-p', { originalPath: '/p' });
    project.session('s1', [records.userText('une question')]);
    ctx.start();
    await invoke('index:refresh', { quiet: true });
    await invoke('session:mark', { id: SID, favorite: true, note: 'x' });

    // Only a conversation Ariane alone holds can be forgotten: purge the file.
    fs.rmSync(path.join(project.dirPath, 's1.jsonl'), { force: true });
    await invoke('index:refresh', { quiet: true });
    const forgotten = await invoke('session:forget', { id: SID });
    assert.equal(forgotten.ok, true, forgotten.error);

    const stored = JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'marks.json'), 'utf8'));
    assert.deepEqual(stored.marks, {}, 'nothing of it is kept, the mark included');
  });

  test('an unreadable marks file is reported, and never replaced', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    await indexed(ctx);
    const file = path.join(ctx.userDataDir, 'marks.json');
    fs.writeFileSync(file, '{ "marks": { oups');

    const reply = await invoke('session:mark', { id: SID, favorite: true });
    assert.equal(reply.ok, false);
    assert.match(reply.error, /favoris/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ "marks": { oups');
  });
});

// ── The language ───────────────────────────────────────────────────────────

test.describe('the language', () => {
  test('follows the system, matched by language: fr-BE finds French', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();

    const { data } = await invoke('app:locale');
    assert.equal(data.language, 'fr');
    assert.equal(data.setting, 'auto');
    assert.equal(data.direction, 'ltr');
    assert.deepEqual(data.sources.map((s) => s.language), ['fr', 'en'], 'its file, then English to fall back on');
    const codes = data.languages.map((l) => l.code);
    assert.ok(codes.includes('en') && codes.includes('fr'));
    assert.equal(data.languages.find((l) => l.code === 'fr').name, 'Français', 'each named in itself');
  });

  test('a system whose language has no file gets English', async (t) => {
    systemLanguages = ['tlh-XX'];
    t.after(() => {
      systemLanguages = ['fr-BE', 'en-US'];
    });
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();
    assert.equal((await invoke('app:locale')).data.language, 'en');
  });

  test('a chosen language is kept, and spoken at once by this process too', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();

    await invoke('settings:save', { commands: {}, language: 'en' });
    const { data } = await invoke('app:locale');
    assert.equal(data.language, 'en');
    assert.equal(data.setting, 'en');
    const forget = await invoke('session:forget', { id: 'claude:inconnue' });
    assert.equal(forget.error, 'Conversation not found.', 'errors in the new language');
    const file = JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'settings.json'), 'utf8'));
    assert.equal(file.language, 'en');
    assert.ok(file._aide[0].startsWith('Where Ariane finds'), 'the file’s own help, rewritten in it');

    await invoke('settings:save', { commands: {}, language: 'auto' });
    assert.equal((await invoke('app:locale')).data.language, 'fr', 'back to the system’s');
  });

  // The theme never crosses into the renderer: the stylesheet paints both
  // palettes from prefers-color-scheme, and Electron makes that question
  // answer the chosen theme. So what these check is that the question is set.
  test('a chosen theme is kept, and told to Electron at once', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();

    assert.equal(electronStub.nativeTheme.themeSource, 'system', 'nothing chosen: the system decides');
    assert.equal((await invoke('settings:get')).data.theme, 'auto');

    await invoke('settings:save', { commands: {}, theme: 'dark' });
    assert.equal(electronStub.nativeTheme.themeSource, 'dark');
    assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'settings.json'), 'utf8')).theme, 'dark');
    assert.equal((await invoke('settings:get')).data.theme, 'dark');

    await invoke('settings:save', { commands: {}, theme: 'auto' });
    assert.equal(electronStub.nativeTheme.themeSource, 'system', 'back to the system’s');
  });

  test('the text size is applied at once to the window that asked, and kept', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();

    const view = (await invoke('settings:get')).data;
    assert.equal(view.textSize, 100, 'nothing chosen: the usual size');
    assert.deepEqual(view.textSizes, [90, 100, 110, 120, 130]);

    const zooms = [];
    const sender = { isDestroyed: () => false, send() {}, setZoomFactor: (f) => zooms.push(f) };
    await invoke('settings:save', { commands: {}, textSize: 120 }, sender);
    assert.deepEqual(zooms, [1.2], 'seen now, with nothing to reload');
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'settings.json'), 'utf8')).textSize,
      120
    );
    assert.equal((await invoke('settings:get')).data.textSize, 120);
  });

  test('a theme written in the file is applied when the app starts', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    fs.mkdirSync(ctx.userDataDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.userDataDir, 'settings.json'), JSON.stringify({ theme: 'light' }));
    electronStub.nativeTheme.themeSource = 'system';
    ctx.start();

    assert.equal(electronStub.nativeTheme.themeSource, 'light');
    assert.equal((await invoke('settings:get')).data.theme, 'light');
  });

  test('a theme nobody knows is not applied, and not written', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();
    await invoke('settings:save', { commands: {}, theme: 'dark' });

    const refused = await invoke('settings:save', { commands: {}, theme: 'solarized' });
    assert.equal(refused.ok, false);
    assert.equal(electronStub.nativeTheme.themeSource, 'dark', 'the one that was chosen stands');
    assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.userDataDir, 'settings.json'), 'utf8')).theme, 'dark');
  });
});

// ── Where each CLI lives: the settings file ───────────────────────────────
//
// None of these may reach a real terminal: each fails before the launch.

test.describe('the settings', () => {
  const settingsFile = (ctx) => path.join(ctx.userDataDir, 'settings.json');

  test('the window gets every assistant with a CLI: chosen, found, checked, used', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('bonjour')]);
    ctx.start();
    await invoke('index:refresh', { quiet: true });

    const reply = await invoke('settings:get');
    assert.equal(reply.ok, true);
    const { file, unreadable, agents } = reply.data;
    assert.equal(file, settingsFile(ctx));
    assert.equal(unreadable, null);
    assert.deepEqual(agents.map((a) => a.id), ['claude', 'codex', 'copilot-cli', 'qwen', 'gemini', 'antigravity']);
    const claude = agents[0];
    assert.equal(claude.label, 'Claude Code');
    assert.equal(claude.sessions, 1);
    assert.equal(claude.command, '');
    assert.equal(typeof claude.check.ok, 'boolean');
    assert.ok(!('env' in claude.check), 'never an environment across the bridge');
  });

  test('saving writes what was typed, and only that', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();
    fs.writeFileSync(settingsFile(ctx), JSON.stringify({ theme: 'sombre', agents: { qwen: { command: '/opt/qwen' } } }));

    const reply = await invoke('settings:save', { commands: { codex: ' /nulle/part/codex ' } });
    assert.equal(reply.ok, true);
    const data = JSON.parse(fs.readFileSync(settingsFile(ctx), 'utf8'));
    assert.equal(data.agents.codex.command, '/nulle/part/codex');
    assert.equal(data.agents.qwen.command, '/opt/qwen', 'an assistant not named is left alone');
    assert.equal(data.theme, 'sombre');
    const codex = reply.data.agents.find((a) => a.id === 'codex');
    // `detail` est le chemin tel que l'application le comprend, donc normalisé
    // pour le système : sous Windows, des antislashs.
    assert.deepEqual(codex.check, {
      ok: false,
      reason: 'setting-unusable',
      detail: path.normalize('/nulle/part/codex'),
    });
  });

  test('saving over an unreadable file is refused, and the file left as it was', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();
    fs.writeFileSync(settingsFile(ctx), '{ oups');

    const view = await invoke('settings:get');
    assert.equal(typeof view.data.unreadable, 'string');
    const reply = await invoke('settings:save', { commands: { codex: '/x' } });
    assert.equal(reply.ok, false);
    assert.match(reply.error, /illisibles/);
    assert.equal(fs.readFileSync(settingsFile(ctx), 'utf8'), '{ oups');
  });

  test('a path is checked without being run', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();
    // Le binaire de Node plutôt que /bin/sh : il existe sur les trois systèmes.
    const exe = process.execPath;
    const sh = (await invoke('settings:check', { id: 'claude', command: exe })).data;
    assert.deepEqual(sh, { ok: true, executable: exe, chosen: true });
    const relative = (await invoke('settings:check', { id: 'claude', command: 'bin/claude' })).data;
    assert.equal(relative.reason, 'setting-not-absolute');
  });

  test('the file picker starts where the CLI would be, and shows hidden folders', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();
    openDialogCalls.length = 0;
    nextOpenPath = '/home/ada/.nvm/versions/node/v22.12.0/bin/codex';
    t.after(() => {
      nextOpenPath = null;
    });

    const reply = await invoke('settings:browse', { id: 'codex' });
    assert.equal(reply.data, '/home/ada/.nvm/versions/node/v22.12.0/bin/codex');
    assert.ok(openDialogCalls[0].properties.includes('showHiddenFiles'), '~/.nvm is hidden');
    assert.match(openDialogCalls[0].title, /Codex/);
    nextOpenPath = null;
    assert.equal((await invoke('settings:browse', { id: 'codex' })).data, null, 'a cancel chooses nothing');
  });

  test('the file opens in the editor, recorded first', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();

    const reply = await invoke('settings:openFile');
    assert.equal(reply.ok, true);
    const file = settingsFile(ctx);
    assert.deepEqual(reply.data, { path: file, opened: true, unreadable: null });
    assert.deepEqual(openPathCalls, [file]);
    const { agents } = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(agents), ['claude', 'codex', 'copilot-cli', 'qwen', 'gemini', 'antigravity']);
    assert.ok(Object.values(agents).every((a) => a.command === ''), 'nothing chosen for the person');
  });

  test('an unreadable file is opened all the same, and left as it was', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();
    fs.writeFileSync(settingsFile(ctx), '{ oups');

    const reply = await invoke('settings:openFile');
    assert.equal(typeof reply.data.unreadable, 'string');
    assert.deepEqual(openPathCalls, [settingsFile(ctx)], 'that is where it gets fixed');
    assert.equal(fs.readFileSync(settingsFile(ctx), 'utf8'), '{ oups');
  });

  function resumable(ctx, folder = ctx.userDataDir) {
    ctx.fx.project('-p', { originalPath: folder }).session('s1', [records.userText('reprends-moi')]);
    ctx.start();
    return invoke('index:refresh', { quiet: true });
  }

  test('a stated command that cannot run is named, and nothing opens', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    await resumable(ctx);
    fs.writeFileSync(
      path.join(ctx.userDataDir, 'settings.json'),
      JSON.stringify({ agents: { claude: { command: '/nulle/part/claude' } } })
    );

    const reply = await invoke('session:resume', { id: SID });
    assert.equal(reply.ok, true);
    assert.equal(reply.data.ok, false);
    assert.equal(reply.data.reason, 'setting-unusable');
    assert.equal(reply.data.detail, path.normalize('/nulle/part/claude'));
    assert.equal(reply.data.command, 'claude');
    assert.equal(reply.data.agentId, 'claude', 'so the window opens on that assistant');
    assert.match(reply.data.display, /^claude --resume s1$/);
  });

  test('a file that cannot be followed is reported with the outcome', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    // A folder that is gone: the launch stops there, before any terminal.
    const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-parti-'));
    await resumable(ctx, gone);
    fs.rmSync(gone, { recursive: true });
    fs.writeFileSync(path.join(ctx.userDataDir, 'settings.json'), '{ oups');

    const reply = await invoke('session:resume', { id: SID });
    assert.equal(reply.data.reason, 'folder-missing');
    assert.equal(typeof reply.data.settingsProblem, 'string');
  });
});

test('shell:openFolder refuses a path that does not exist', async (t) => {
  const ctx = setupIpc();
  t.after(ctx.teardown);
  ctx.start();

  const reply = await invoke('shell:openFolder', { path: '/definitely/not/here' });
  assert.equal(reply.ok, false);
  assert.equal(openPathCalls.length, 1, 'the path still goes through shell.openPath, never a shell');
});

test.describe('end to end through the bridge', () => {
  test('index, list, read and search a real fixture', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);

    ctx.fx.project('-p', { originalPath: '/home/zam/projet' }).session('s1', [
      records.aiTitle('Conversation de test'),
      records.userText('parle-moi des sprites'),
      records.assistantText('Les sprites sont des objets matériels.'),
    ]);
    ctx.start();

    const refreshed = await invoke('index:refresh', {});
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.data.indexed, 1);

    const folders = await invoke('folders:list');
    assert.equal(folders.data.length, 1);
    assert.equal(folders.data[0].path, '/home/zam/projet');

    const sessions = await invoke('sessions:list', { folderId: folders.data[0].id });
    assert.equal(sessions.data[0].title, 'Conversation de test');

    const session = await invoke('session:get', { id: SID });
    assert.equal(session.data.messages.length, 2);
    assert.equal(session.data.session.folderPath, '/home/zam/projet');

    const hits = await invoke('search:run', { query: 'sprites' });
    assert.equal(hits.data.length, 2);
    assert.equal(hits.data[0].folderPath, '/home/zam/projet');

    const scoped = await invoke('search:run', { query: 'sprites', sessionId: SID });
    assert.equal(scoped.data.length, 2);

    const elsewhere = await invoke('search:run', { query: 'sprites', folderId: 9999 });
    assert.equal(elsewhere.data.length, 0);
  });

  test('a subagent is reached from its parent, leads back to it, and is never resumed', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);

    const project = ctx.fx.project('-p', { originalPath: '/home/zam/projet' });
    project.session('s1', [records.aiTitle('La mère'), records.userText('lance un agent')]);
    const dir = path.join(project.dirPath, 's1', 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'agent-a1.jsonl'),
      JSON.stringify({ ...records.userText('consigne'), sessionId: 's1', isSidechain: true }) + '\n'
    );
    fs.writeFileSync(
      path.join(dir, 'agent-a1.meta.json'),
      JSON.stringify({ description: 'Relire' })
    );
    ctx.start();
    await invoke('index:refresh', {});

    const parent = (await invoke('session:get', { id: SID })).data;
    assert.deepEqual(
      parent.subagents.map((s) => [s.id, s.title, s.messageCount]),
      [['claude:agent-a1', 'Relire', 1]]
    );
    assert.equal(parent.parent, null);

    const child = (await invoke('session:get', { id: 'claude:agent-a1' })).data;
    assert.deepEqual(child.parent, { id: SID, title: 'La mère', firstPrompt: 'lance un agent' });
    assert.deepEqual(child.subagents, []);
    assert.ok(!('folderPath' in child.parent), 'the header is given a name, never a path');

    const info = (await invoke('session:resumeInfo', { id: 'claude:agent-a1' })).data;
    assert.deepEqual(info, { ok: false, reason: 'subagent', note: null });
    const resumed = await invoke('session:resume', { id: 'claude:agent-a1' });
    assert.equal(resumed.ok, false, 'its CLI would refuse it: the parent is what to reopen');
  });

  test('a reply may show its cost, except where the agent counts only per session', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);

    ctx.fx
      .project('-p', { originalPath: '/home/zam/projet' })
      .session('s1', [records.userText('q')]);
    ctx.fx.copilot().session('cp1', [cop.start('/home/zam/projet'), cop.user('q')]);
    ctx.start();
    await invoke('index:refresh', {});

    assert.equal((await invoke('session:get', { id: SID })).data.usageByReply, true);
    assert.equal(
      (await invoke('session:get', { id: 'copilot-cli:sess-1' })).data.usageByReply,
      false,
      'Copilot writes a running total per session: under one reply it would read as that reply’s cost'
    );
  });

  test('searches within a period, counted from now', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);

    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.userText('des sprites anciens', { timestamp: '2020-01-01T10:00:00.000Z' }),
      records.userText('des sprites récents', { timestamp: new Date().toISOString() }),
    ]);
    ctx.start();
    await invoke('index:refresh', { quiet: true });

    const all = await invoke('search:run', { query: 'sprites' });
    const week = await invoke('search:run', { query: 'sprites', period: '7d' });
    assert.equal(all.data.length, 2);
    assert.equal(week.data.length, 1);
    assert.ok(week.data[0].snippet.includes('récents'));
  });

  // "Oublier": only what Ariane alone holds, and then for good.
  test('forgets a saved conversation, and only a saved one', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);

    const project = ctx.fx.project('-p', { originalPath: '/p' });
    project.session('s1', [records.userText('une question'), records.assistantText('une réponse')]);
    ctx.start();
    await invoke('index:refresh', { quiet: true });

    const live = await invoke('session:forget', { id: SID });
    assert.equal(live.ok, false, 'a conversation its agent still has cannot be forgotten here');
    assert.match(live.error, /sauvée/);

    fs.rmSync(path.join(project.dirPath, 's1.jsonl'));
    const saved = await invoke('index:refresh', { quiet: true });
    assert.equal(saved.data.saved, 1);
    assert.equal((await invoke('session:get', { id: SID })).data.session.source, 'archive');

    const forgotten = await invoke('session:forget', { id: SID });
    assert.equal(forgotten.ok, true);
    assert.equal((await invoke('session:get', { id: SID })).data, null);
    assert.equal(fs.existsSync(path.join(ctx.userDataDir, 'archive', 'claude', 's1.jsonl')), false);

    // And it does not come back: nothing is left to restore it from.
    await invoke('index:refresh', { quiet: true });
    assert.equal((await invoke('session:get', { id: SID })).data, null);
  });

  test('exports a conversation to the file the dialog names, and copies a message', async (t) => {
    const ctx = setupIpc();
    t.after(() => {
      nextSavePath = null;
      clipboardWrites.length = 0;
      ctx.teardown();
    });

    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.aiTitle('Conversation exportée'),
      records.userText('une question'),
      records.assistantText('une réponse, longue de ' + 'mots '.repeat(2000)),
    ]);
    ctx.start();
    await invoke('index:refresh', { quiet: true });

    nextSavePath = path.join(ctx.userDataDir, 'sortie.md');
    const exported = await invoke('session:export', { id: SID, format: 'md' });
    assert.deepEqual(exported.data, { saved: true, path: nextSavePath });
    assert.ok(fs.readFileSync(nextSavePath, 'utf8').startsWith('# Conversation exportée'));

    // In the order the screen shows it — and only a real `true` asks for that.
    nextSavePath = path.join(ctx.userDataDir, 'recent.md');
    await invoke('session:export', { id: SID, format: 'md', newestFirst: true });
    const recent = fs.readFileSync(nextSavePath, 'utf8');
    assert.ok(recent.indexOf('une réponse') < recent.indexOf('une question'), 'latest first');
    nextSavePath = path.join(ctx.userDataDir, 'chaine.md');
    await invoke('session:export', { id: SID, format: 'md', newestFirst: 'true' });
    const chained = fs.readFileSync(nextSavePath, 'utf8');
    assert.ok(chained.indexOf('une question') < chained.indexOf('une réponse'), 'a string is not true');

    nextSavePath = null;
    const cancelled = await invoke('session:export', { id: SID, format: 'md' });
    assert.deepEqual(cancelled.data, { saved: false });

    // Far past the 4 096 characters the command clipboard accepts.
    const answer = (await invoke('session:get', { id: SID })).data.messages[1];
    const copied = await invoke('message:copy', { id: answer.id });
    assert.equal(copied.ok, true);
    assert.equal(clipboardWrites.at(-1), answer.text);
    assert.ok(answer.text.length > 4096);
  });

  test('an agent present on disk but absent from the index is reported', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);

    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('a')]);
    ctx.start();

    const before = await invoke('app:status');
    assert.deepEqual(before.data.detectedAgents, ['claude']);
    assert.deepEqual(before.data.missingAgents, ['claude'], 'nothing indexed yet');

    await invoke('index:refresh', {});
    const after = await invoke('app:status');
    assert.deepEqual(after.data.missingAgents, [], 'indexed now');
  });

  test('session:get returns null for an unknown id', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);
    ctx.start();

    const reply = await invoke('session:get', { id: 'claude:inconnu' });
    assert.equal(reply.ok, true);
    assert.equal(reply.data, null);
  });

  test('concurrent refreshes share one indexing pass', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);

    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('a')]);
    ctx.start();

    const [first, second] = await Promise.all([
      invoke('index:refresh', {}),
      invoke('index:refresh', {}),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    // The second call joined the first, so the file was read exactly once.
    assert.equal(first.data.indexed + second.data.indexed, 2 * first.data.indexed);
  });

  test('progress events reach a live sender only', async (t) => {
    const ctx = setupIpc();
    t.after(ctx.teardown);

    ctx.fx.project('-p', { originalPath: '/p' }).session('s1', [records.userText('a')]);
    ctx.start();

    const seen = [];
    await invoke('index:refresh', {}, { isDestroyed: () => false, send: (_c, p) => seen.push(p.phase) });
    assert.ok(seen.includes('done'));

    // A destroyed sender must not be written to.
    let wrote = false;
    await invoke('index:refresh', {}, { isDestroyed: () => true, send: () => { wrote = true; } });
    assert.equal(wrote, false);
  });
});

test.describe('argument coercion', () => {
  test('asInt accepts integers and numeric strings only', () => {
    assert.equal(asInt(3), 3);
    assert.equal(asInt('3'), 3);
    assert.equal(asInt(null), null);
    assert.equal(asInt(undefined), null);
    assert.equal(asInt(1.5), null);
    assert.equal(asInt('abc'), null);
    assert.equal(asInt({}), null);
    assert.equal(asInt([]), null, 'objects are never coerced');
    assert.equal(asInt(['3']), null);
    assert.equal(asInt(''), null);
    assert.equal(asInt(true), null);
  });

  test('asId accepts opaque identifiers and rejects traversal', () => {
    assert.equal(asId('64ffbe9a-04de-430a-91ab-f18ff7fc5c92'), '64ffbe9a-04de-430a-91ab-f18ff7fc5c92');
    assert.equal(asId('history:abc:3'), 'history:abc:3');
    assert.equal(asId('  s1  '), 's1');
    assert.equal(asId('../../etc/passwd'), null);
    assert.equal(asId('a/b'), null);
    assert.equal(asId(''), null);
    assert.equal(asId('a'.repeat(129)), null);
    assert.equal(asId(42), null);
  });

  test('clamp bounds the result limit', () => {
    assert.equal(clamp(-5, 1, 500), 1);
    assert.equal(clamp(99999, 1, 500), 500);
    assert.equal(clamp(50, 1, 500), 50);
  });
});
