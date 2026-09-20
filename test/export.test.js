'use strict';

/**
 * Exporting a conversation. The file leaves the app, and may leave the
 * machine: it must credit speakers as the screen does, hold nothing internal,
 * and never turn a quoted tag into markup.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { exportSession, fileNameFor } = require('../src/main/export');
const { localizer } = require('./helpers/l10n');

/** The document module, speaking French unless a test asks otherwise. */
let D;
let L;
let raw;
test.before(async () => {
  raw = await import('../src/renderer/export-document.js');
  L = await localizer('fr');
  D = {
    layoutConversation: (options) => raw.layoutConversation({ l10n: L, ...options }),
    toMarkdown: (layout, options = {}) => raw.toMarkdown(layout, { l10n: L, ...options }),
    toHtml: (layout, options = {}) => raw.toHtml(layout, { l10n: L, ...options }),
  };
});

const SESSION = {
  id: 'claude:secret-session-id',
  agentId: 'claude',
  title: 'Pourquoi le <b>test</b> échoue',
  gitBranch: 'main',
  messageCount: 6,
  firstAt: '2026-09-17T21:00:00.000Z',
  lastAt: '2026-09-17T21:05:00.000Z',
  source: 'transcript',
  folderPath: '/home/ada/projets/deep-thought',
  filePath: '/home/ada/.claude/projects/-home-ada/secret-session-id.jsonl',
};

const msg = (id, fields) => ({
  id, seq: id, ts: `2026-09-17T21:0${id}:00.000Z`, text: '', thinking: '', parts: [],
  isMeta: false, isNotice: false, isSidechain: false, command: null, ...fields,
});

const MESSAGES = [
  msg(1, { role: 'user', text: 'Que fait ce code ? Et <script>alert(1)</script> ?' }),
  msg(2, {
    role: 'assistant', text: 'Je regarde.', thinking: 'raisonnement interne',
    parts: [{ type: 'text', text: 'Je regarde.' }, { type: 'tool_use', id: 't1', name: 'Bash', preview: '{"command":"git status"}' }],
  }),
  // The format records a tool's output under "user": it is not the person.
  msg(3, { role: 'user', parts: [{ type: 'tool_result', id: 't1', isError: true, preview: 'fatal: aucun commit' }] }),
  msg(4, { role: 'assistant', text: 'Il manque un premier commit.' }),
  msg(5, { role: 'assistant', text: 'Ariane est fonctionnel.', isNotice: true, command: { name: 'Résumé de session', args: '' } }),
  msg(6, { role: 'user', text: 'Analyse ce fichier', isSidechain: true }),
];

test.describe('who said what', () => {
  test('the person, the assistant, the tools and the notices, as on screen', () => {
    const layout = D.layoutConversation({ session: SESSION, messages: MESSAGES });
    const summary = layout.rows.map((r) => (r.kind === 'message' ? r.speaker : r.kind === 'notice' ? `[${r.label}]` : 'outils'));
    assert.deepEqual(summary, ['Vous', 'Claude', 'outils', 'Claude', '[Résumé de session]', '[Sous-agent]']);
  });

  test('a tool’s output is never credited to the person', () => {
    const markdown = D.toMarkdown(D.layoutConversation({ session: SESSION, messages: MESSAGES }));
    const afterVous = markdown.split('**Vous**').slice(1).join('');
    assert.ok(!afterVous.split('**Claude**')[0].includes('fatal'), 'no tool output under "Vous"');
    assert.equal((markdown.match(/\*\*Vous\*\*/g) || []).length, 1, 'one message of the person’s, one label');
  });
});

test.describe('in the order the screen shows', () => {
  const who = (layout) =>
    layout.rows.map((r) => (r.kind === 'message' ? r.speaker : r.kind === 'notice' ? `[${r.label}]` : 'outils'));

  // An export is what the reader sees: the screen opens on the latest message.
  test('latest first, reversed by rows as on screen', () => {
    const layout = D.layoutConversation({ session: SESSION, messages: MESSAGES, newestFirst: true });
    assert.deepEqual(who(layout), ['[Sous-agent]', '[Résumé de session]', 'Claude', 'outils', 'Claude', 'Vous']);
  });

  test('a message and the tools it called stay one row, whichever way', () => {
    const layout = D.layoutConversation({ session: SESSION, messages: MESSAGES, newestFirst: true });
    const call = layout.rows.find((r) => r.tools && r.text === 'Je regarde.');
    assert.ok(call, 'the message keeps its own tool summary');
  });

  // Read newest first, every answer comes before its question: said in the header.
  test('the document says which way it reads', () => {
    const newest = D.toMarkdown(D.layoutConversation({ session: SESSION, messages: MESSAGES, newestFirst: true }));
    const oldest = D.toMarkdown(D.layoutConversation({ session: SESSION, messages: MESSAGES }));
    assert.ok(newest.includes('- **Messages** : 6, du plus récent au plus ancien'));
    assert.ok(oldest.includes('- **Messages** : 6, du plus ancien au plus récent'));
    assert.ok(
      D.toHtml(D.layoutConversation({ session: SESSION, messages: MESSAGES, newestFirst: true }))
        .includes('6, du plus récent au plus ancien')
    );
  });

  test('the first row of a latest-first Markdown is the latest message', () => {
    const text = D.toMarkdown(D.layoutConversation({ session: SESSION, messages: MESSAGES, newestFirst: true }));
    assert.ok(text.indexOf('Analyse ce fichier') < text.indexOf('Que fait ce code'));
  });
});

test.describe('Markdown', () => {
  const markdown = () =>
    D.toMarkdown(D.layoutConversation({ session: SESSION, messages: MESSAGES }), {
      exportedAt: '2026-09-19T10:00:00.000Z',
    });

  test('opens on the title and what the conversation is', () => {
    const text = markdown();
    assert.ok(text.startsWith('# Pourquoi le <b>test</b> échoue\n'));
    assert.ok(text.includes('- **Assistant** : Claude'));
    assert.ok(text.includes('- **Dossier** : `/home/ada/projets/deep-thought`'));
    assert.ok(text.includes('- **Branche** : main'));
    assert.ok(text.includes('- **Messages** : 6'));
  });

  test('keeps the prose as written, and folds reasoning away', () => {
    const text = markdown();
    assert.ok(text.includes('Que fait ce code ? Et <script>alert(1)</script> ?'), 'verbatim, markup included');
    assert.ok(text.includes('<details>\n<summary>Réflexion</summary>\n\nraisonnement interne'));
  });

  test('summarises tool calls instead of pouring them out', () => {
    const text = markdown();
    assert.ok(text.includes("> *1 appel d'outil : Bash*"));
    assert.match(text, /> \*1 résultat — 1\serreur\*/, 'a non-breaking space, as the language file writes it');
    assert.ok(!text.includes('git status'), 'the call’s arguments stay out');
  });

  test('a pasted block cannot be closed early by the backticks it holds', () => {
    const layout = D.layoutConversation({
      session: SESSION,
      messages: [msg(1, { role: 'user', text: 'regarde', parts: [{ type: 'pasted', preview: 'a ``` b' }] })],
    });
    const text = D.toMarkdown(layout);
    assert.ok(text.includes('````\na ``` b\n````'));
  });
});

test.describe('the page printed to PDF', () => {
  const html = () => D.toHtml(D.layoutConversation({ session: SESSION, messages: MESSAGES }));

  test('a quoted tag stays text: nothing in the page can run', () => {
    const page = html();
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.equal(/<script/i.test(page), false);
    assert.ok(page.includes('<title>Pourquoi le &lt;b&gt;test&lt;/b&gt; échoue</title>'));
  });

  test('forbids scripts and remote loads by its own policy', () => {
    assert.ok(html().includes(`content="default-src 'none'; style-src 'unsafe-inline'"`));
  });

  // Le thème est une préférence d'écran. La fenêtre cachée qui imprime hérite
  // pourtant de nativeTheme : si la page d'export interrogeait la préférence de
  // couleurs, un PDF exporté en thème sombre sortirait sur fond noir — des
  // pages entières d'encre, et un texte clair illisible sur papier.
  test('the page printed to PDF is for paper: it never asks for the screen\'s theme', () => {
    const page = html();
    assert.equal(/prefers-color-scheme/.test(page), false);
    assert.ok(page.includes('background: #fff'), 'un fond blanc, dit et non supposé');
  });

  test('marks who speaks by side, as the transcript does', () => {
    const page = html();
    assert.ok(page.includes('<section class="msg user"><div class="who">Vous'));
    assert.ok(page.includes('<section class="msg assistant"><div class="who">Claude'));
    assert.ok(page.includes('<section class="notice"><div class="who">Résumé de session'));
  });
});

test('nothing internal leaves: no session id, no transcript path', () => {
  const layout = D.layoutConversation({ session: SESSION, messages: MESSAGES });
  for (const out of [D.toMarkdown(layout), D.toHtml(layout)]) {
    assert.equal(out.includes('secret-session-id'), false);
    assert.equal(out.includes('.jsonl'), false);
  }
});

// The same conversation, for a reader whose app speaks English: every word
// Ariane adds follows, and nothing of the conversation itself changes.
test.describe('in the reader\'s language', () => {
  test('English labels, English order, English dates', async () => {
    const en = await localizer('en');
    const layout = raw.layoutConversation({ session: SESSION, messages: MESSAGES, newestFirst: true, l10n: en });
    const text = raw.toMarkdown(layout, { l10n: en, exportedAt: '2026-09-19T10:00:00.000Z' });
    assert.ok(text.includes('- **Folder**: `/home/ada/projets/deep-thought`'));
    assert.ok(text.includes('- **Messages**: 6, newest to oldest'));
    assert.ok(text.includes('**You**'), 'the person, named in English');
    assert.ok(text.includes('> **Session summary**'), 'an old French label, read as its code');
    assert.ok(text.includes('Que fait ce code ?'), 'the conversation itself untouched');
    assert.ok(/Exported from Ariane on Sep 19, 2026/.test(text), text.slice(-80));
    assert.ok(raw.toHtml(layout, { l10n: en }).startsWith('<!doctype html>\n<html lang="en" dir="ltr">'));
  });
});

test.describe('file names', () => {
  test('any title becomes a name every OS accepts', () => {
    assert.equal(fileNameFor('a/b:c*?"<>|d', 'md'), 'a b c d.md');
    assert.equal(fileNameFor('', 'pdf'), 'conversation.pdf');
    assert.equal(fileNameFor('...caché', 'md'), 'caché.md');
    assert.ok(fileNameFor('x'.repeat(300), 'md').length <= 83);
  });
});

test.describe('exporting', () => {
  const index = {
    session: (id) => (id === SESSION.id ? SESSION : null),
    messages: () => MESSAGES,
  };

  test('writes the Markdown where the person chose', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-export-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const target = path.join(dir, 'sortie.md');
    let suggested = '';

    const result = await exportSession({
      l10n: L,
      index, sessionId: SESSION.id, format: 'md',
      chooseFile: async (name) => ((suggested = name), target),
      printToPdf: async () => assert.fail('no PDF for a Markdown export'),
    });

    assert.deepEqual(result, { saved: true, path: target });
    assert.equal(suggested, 'Pourquoi le b test b échoue.md');
    assert.ok(fs.readFileSync(target, 'utf8').startsWith('# Pourquoi le'));
  });

  test('passes the screen’s order through to the file', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-export-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const target = path.join(dir, 'ordre.md');
    await exportSession({
      l10n: L,
      index, sessionId: SESSION.id, format: 'md', newestFirst: true,
      chooseFile: async () => target, printToPdf: async () => {},
    });
    const text = fs.readFileSync(target, 'utf8');
    assert.ok(text.indexOf('Il manque un premier commit') < text.indexOf('Je regarde.'));
  });

  test('hands the printable page to the PDF printer', async () => {
    let printed = null;
    const result = await exportSession({
      l10n: L,
      index, sessionId: SESSION.id, format: 'pdf',
      chooseFile: async () => '/nulle-part/sortie.pdf',
      printToPdf: async (html, file, title) => {
        printed = { html, file, title };
      },
    });
    assert.equal(result.saved, true);
    assert.equal(printed.file, '/nulle-part/sortie.pdf');
    assert.ok(printed.html.startsWith('<!doctype html>'));
    assert.equal(printed.title, 'Pourquoi le <b>test</b> échoue');
  });

  test('a cancelled dialog writes nothing', async () => {
    const result = await exportSession({
      l10n: L,
      index, sessionId: SESSION.id, format: 'md',
      chooseFile: async () => null,
      printToPdf: async () => assert.fail('nothing to print'),
    });
    assert.deepEqual(result, { saved: false });
  });

  test('refuses an unknown format or conversation', async () => {
    const base = { l10n: L, index, chooseFile: async () => '/x', printToPdf: async () => {} };
    await assert.rejects(exportSession({ ...base, sessionId: SESSION.id, format: 'exe' }), /format/);
    await assert.rejects(exportSession({ ...base, sessionId: 'claude:autre', format: 'md' }), /introuvable/);
  });
});
