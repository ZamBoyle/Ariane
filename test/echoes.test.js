'use strict';

/**
 * Les mots de la personne, une seule fois.
 *
 * Signalé depuis Windows le 25 septembre 2026 : « mon message initial est remis
 * en dernier ». C'était l'écho `last-prompt` de Claude Code, que la conversation
 * tenait déjà, mais que la comparaison exacte ne reconnaissait pas : Claude Code
 * y aplatit les retours à la ligne et coupe à 200 caractères, avec « … ». Sans
 * date, il s'affichait comme le message le plus récent. 90 sur le corpus réel.
 *
 * En cherchant, un second écho : un message tapé pendant que Claude travaille
 * est mis en file (`enqueue`), puis, sorti de la file (`dequeue`), écrit une
 * seconde fois comme une ligne ordinaire. 219 sur 219 livraisons mesurées.
 * Ceux qu'on retire de la file (`remove`) n'existent que là : 124, gardés.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const { Archive, withoutEchoedPrompts } = require('../src/core/archive');
const claudeAdapter = require('../src/core/agents/claude');
const { createFixture, records, resetCounters } = require('./helpers/fixture');

function setup(t) {
  resetCounters();
  const fx = createFixture();
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    fx.cleanup();
  });
  const run = () => new Indexer(index, { env: fx.env, adapters: [claudeAdapter] }).run();
  const project = fx.project('-p', { originalPath: '/p' });
  return { fx, index, run, project };
}

/** Ce que la personne a dit, dans l'ordre : ni les notices, ni les résultats d'outils. */
const said = (index) =>
  index
    .messages('claude:s1')
    .filter((m) => m.role === 'user' && m.text && !m.isNotice)
    .map((m) => m.text);

let clock = 0;
const queue = (operation, content = '') => ({
  type: 'queue-operation',
  operation,
  timestamp: `2026-09-25T16:00:${String(clock++ % 60).padStart(2, '0')}.000Z`,
  sessionId: 's1',
  content,
});
const lastPrompt = (text) => ({
  type: 'last-prompt',
  lastPrompt: text,
  leafUuid: 'x',
  sessionId: 's1',
});

// ── la file d'attente ───────────────────────────────────────────────────────

test('un message mis en file puis livré s’affiche une fois, là où il a été livré', async (t) => {
  const { index, run, project } = setup(t);
  project.session('s1', [
    records.userText('la première question'),
    records.assistantText('je cherche'),
    queue('enqueue', 'et regarde aussi ceci'),
    records.assistantText('je continue'),
    queue('dequeue'),
    records.userText('et regarde aussi ceci'),
    records.assistantText('voilà'),
  ]);

  await run();
  assert.deepEqual(said(index), ['la première question', 'et regarde aussi ceci']);
  const order = index.messages('claude:s1').map((m) => m.text);
  assert.ok(
    order.indexOf('et regarde aussi ceci') > order.indexOf('je continue'),
    'à sa livraison, juste avant la réponse qui y répond'
  );
});

test('retiré de la file, un message n’existe que là : il reste', async (t) => {
  const { index, run, project } = setup(t);
  project.session('s1', [
    records.userText('la question'),
    queue('enqueue', 'ceci, glissé en cours de route'),
    queue('remove', 'ceci, glissé en cours de route'),
    records.assistantText('bien reçu'),
  ]);

  await run();
  assert.deepEqual(said(index), ['la question', 'ceci, glissé en cours de route']);
});

test('le même mot tapé deux fois reste deux fois : sans dequeue, le texte ne décide rien', async (t) => {
  const { index, run, project } = setup(t);
  project.session('s1', [
    queue('enqueue', 'oui'),
    queue('remove', 'oui'),
    records.assistantText('je continue donc'),
    records.userText('oui'),
  ]);

  await run();
  assert.deepEqual(said(index), ['oui', 'oui']);
});

test('une interruption entre le dequeue et la livraison ne la fait pas manquer', async (t) => {
  // 7 des 219 livraisons réelles : « [Request interrupted by user] » s'intercale.
  const { index, run, project } = setup(t);
  project.session('s1', [
    queue('enqueue', 'arrête et relis'),
    queue('dequeue'),
    records.userText('[Request interrupted by user]'),
    records.userText('arrête et relis'),
  ]);

  await run();
  assert.deepEqual(said(index), ['arrête et relis']);
});

test('livré à la passe suivante, la copie de la file disparaît quand même', async (t) => {
  const { index, run, project } = setup(t);
  project.session('s1', [
    records.userText('la question'),
    queue('enqueue', 'et ensuite ?'),
    queue('dequeue'),
  ]);
  await run();
  assert.deepEqual(said(index), ['la question', 'et ensuite ?'], 'pour l’instant, la file seule');

  // La passe s'est arrêtée entre le dequeue et la livraison : le curseur s'en souvient.
  project.append('s1', [records.userText('et ensuite ?'), records.assistantText('ensuite, ceci')]);
  await run();
  assert.deepEqual(said(index), ['la question', 'et ensuite ?']);
});

// ── l'écho last-prompt ──────────────────────────────────────────────────────

test('un last-prompt coupé et aplati ne double pas le message qu’il répète', async (t) => {
  const { index, run, project } = setup(t);
  const long =
    `T'as une idée pourquoi j'ai une 400 ?\n\nLe payload ${'{"moisVerification":"1"} '.repeat(12)}`.trim();
  const echo = `${long.replace(/\s+/g, ' ').slice(0, 200)}…`;
  project.session('s1', [
    records.userText(long),
    records.assistantText('ton payload est bon'),
    lastPrompt(echo),
  ]);

  await run();
  assert.deepEqual(said(index), [long], 'une fois, et pas en tête comme le plus récent');
});

test('un last-prompt aux retours à la ligne aplatis ne double rien non plus', async (t) => {
  const { index, run, project } = setup(t);
  project.session('s1', [
    records.userText('deux lignes\n\net une autre'),
    lastPrompt('deux lignes et une autre'),
  ]);

  await run();
  assert.deepEqual(said(index), ['deux lignes\n\net une autre']);
});

test('à une passe qui reprend le fichier, la base reconnaît l’écho elle aussi', async (t) => {
  // Une lecture depuis le début décide sur ce qu'elle a lu ; une passe qui
  // reprend en cours de fichier doit demander à la base (db.hasMessageText).
  const { index, run, project } = setup(t);
  const long = `Deux paragraphes.\n\n${'Une phrase qui revient. '.repeat(12)}`.trim();
  project.session('s1', [records.userText(long), records.assistantText('bien lu')]);
  await run();

  project.append('s1', [lastPrompt(`${long.replace(/\s+/g, ' ').slice(0, 200)}…`)]);
  await run();
  assert.deepEqual(said(index), [long]);
});

test('un last-prompt coupé qui ne répète rien est gardé : il n’existe que là', async (t) => {
  const { index, run, project } = setup(t);
  project.session('s1', [
    records.assistantText('une réponse'),
    lastPrompt('une question perdue, coupée…'),
  ]);

  await run();
  assert.deepEqual(said(index), ['une question perdue, coupée…']);
});

// ── l'archive, qu'on ne relit pas ───────────────────────────────────────────

const row = (seq, uuid, ts, text) => ({ seq, uuid, ts, role: 'user', text, is_notice: 0 });

test('l’archive perd ses échos, jamais un mot dit une seule fois', () => {
  const rows = [
    row(0, 'u1', '2026-09-25T16:00:00.000Z', 'bonjour\n\nle monde'),
    row(1, null, '2026-09-25T16:00:10.000Z', 'encore ceci'),
    row(2, 'u2', '2026-09-25T16:00:10.050Z', 'encore ceci'),
    row(3, null, '2026-09-25T16:00:20.000Z', 'oui'),
    row(4, 'u3', '2026-09-25T16:00:50.000Z', 'oui'),
    row(5, null, '', 'bonjour le monde'),
    row(6, null, '', 'une question perdue…'),
  ];
  assert.deepEqual(
    withoutEchoedPrompts(rows).map((r) => r.seq),
    [0, 2, 3, 4, 6],
    'la copie livrée en 50 ms part, pas celle livrée 30 s plus tard ; l’écho part, pas le rescapé'
  );
});

test('une archive d’avant la correction est nettoyée à la lecture', (t) => {
  const fx = createFixture();
  t.after(() => fx.cleanup());
  const archive = new Archive(path.join(fx.root, 'archive'));
  const file = archive.fileFor('claude:s1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = {
    format: 'ariane-archive',
    version: 2,
    id: 'claude:s1',
    savedAt: '',
    session: {},
  };
  const lines = [
    header,
    row(0, 'u1', '2026-09-25T16:00:00.000Z', 'la question'),
    row(1, null, '', 'la question'),
  ];
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);

  assert.deepEqual(
    archive.read(file).messages.map((m) => m.seq),
    [0]
  );
});

test('la migration de l’index sauve une conversation disparue sans ses échos', (t) => {
  const fx = createFixture();
  t.after(() => fx.cleanup());
  const archive = new Archive(path.join(fx.root, 'archive'));
  const file = path.join(fx.root, 'index.sqlite3');

  const before = new Index(file, { archive });
  before.upsertAgent('claude', 'Claude Code', '/root');
  const folder = before.folderId('/p');
  before.upsertSession({
    id: 'claude:s1',
    agent_id: 'claude',
    folder_id: folder,
    source: 'transcript',
    file_path: path.join(fx.root, 'disparu.jsonl'),
  });
  before.addMessages('claude:s1', [
    {
      role: 'user',
      uuid: 'u1',
      timestamp: '2026-09-25T16:00:00.000Z',
      text: 'la question',
      parts: [],
    },
    { role: 'user', uuid: '', timestamp: '', text: 'la question', parts: [] },
  ]);
  before.finalizeSession('claude:s1');
  before.close();

  const raw = new Database(file);
  raw.pragma('user_version = 17');
  raw.close();

  const migrated = new Index(file, { archive });
  t.after(() => migrated.close());
  assert.ok(archive.has('claude:s1'), 'sauvée avant que les tables tombent');
  assert.deepEqual(
    archive.read(archive.fileFor('claude:s1')).messages.map((m) => m.text),
    ['la question'],
    'et sauvée une fois, au format qu’on ne migrera plus'
  );
});
