'use strict';

/**
 * Ce que coûte une indexation, et les deux réglages qui l'ont divisée par deux.
 *
 * Mesuré le 25 septembre 2026 sur 74 802 lignes : lire et interpréter les
 * fichiers prend 2,6 s de la passe de Claude ; l'essentiel partait dans les
 * pauses du journal de SQLite (recopié dans la base tous les 4 Mo, une centaine
 * de fois par reconstruction) et dans l'index plein texte tenu ligne à ligne.
 * Une reconstruction complète : 30 s avant, 14 s après.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const claudeAdapter = require('../src/core/agents/claude');
const { createFixture, records, resetCounters } = require('./helpers/fixture');

/** Un vrai fichier : le journal n'existe pas pour une base en mémoire. */
function setup(t) {
  resetCounters();
  const fx = createFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-cost-'));
  const file = path.join(dir, 'index.sqlite3');
  const opened = [];
  const open = () => {
    const index = new Index(file);
    opened.push(index);
    return index;
  };
  t.after(() => {
    for (const index of opened) if (index.db.open) index.close();
    fx.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const run = (index) => new Indexer(index, { env: fx.env, adapters: [claudeAdapter] }).run();
  const project = fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' });
  return { file, open, run, project };
}

const triggers = (index) =>
  index.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
    .all()
    .map((r) => r.name);

/** Compte les appels d'une méthode, sans rien changer à ce qu'elle fait. */
function spy(index, name) {
  const calls = { n: 0 };
  const original = index[name].bind(index);
  index[name] = (...args) => {
    calls.n += 1;
    return original(...args);
  };
  return calls;
}

test('le journal n’est recopié dans la base que tous les 64 Mo, pas tous les 4', (t) => {
  const { open } = setup(t);
  const index = open();
  assert.equal(index.db.pragma('wal_autocheckpoint', { simple: true }), 16384);
});

test('une passe qui a écrit laisse un journal vide derrière elle', async (t) => {
  const { file, open, run, project } = setup(t);
  project.session('s1', [records.userText('une question'), records.assistantText('une réponse')]);
  const index = open();
  await run(index);
  assert.equal(
    fs.statSync(`${file}-wal`).size,
    0,
    'sans quoi un journal autorisé à 64 Mo resterait sur le disque entre deux passes'
  );
});

test('une première passe remplit l’index de recherche d’un coup, à la fin', async (t) => {
  const { open, run, project } = setup(t);
  project.session('s1', [records.userText('des sprites matériels')]);
  const index = open();
  const suspended = spy(index, 'suspendSearchIndex');

  await run(index);
  assert.equal(suspended.n, 1, 'un index vide se remplit sans tenir la recherche ligne à ligne');
  assert.equal(
    index.search('sprites').length,
    1,
    'et la recherche trouve tout, une fois la passe finie'
  );
  assert.deepEqual(triggers(index), ['messages_ad', 'messages_ai', 'messages_au']);
  assert.equal(index.meta('searchIndexPending'), '0');
});

test('une passe suivante ne suspend rien, et ce qu’elle ajoute se trouve aussitôt', async (t) => {
  const { open, run, project } = setup(t);
  project.session('s1', [records.userText('premier message')]);
  const index = open();
  await run(index);

  const suspended = spy(index, 'suspendSearchIndex');
  project.append('s1', [records.userText('des lutins ajoutés ensuite')]);
  await run(index);
  assert.equal(suspended.n, 0, 'un index déjà rempli garde ses déclencheurs');
  assert.equal(index.search('lutins').length, 1);
});

test('une reconstruction coupée en route est rattrapée à l’ouverture suivante', (t) => {
  const { open } = setup(t);
  const index = open();
  index.upsertAgent('claude', 'Claude Code', '/root');
  index.upsertSession({ id: 'claude:s1', agent_id: 'claude', folder_id: index.folderId('/p') });
  index.suspendSearchIndex();
  index.addMessages('claude:s1', [
    { role: 'user', uuid: 'u1', text: 'écrit pendant la coupure', parts: [] },
  ]);
  index.close(); // l'application est quittée avant la fin de la passe

  const reopened = open();
  assert.equal(
    reopened.search('coupure').length,
    1,
    'rien de ce qui a été écrit n’échappe à la recherche'
  );
  assert.deepEqual(triggers(reopened), ['messages_ad', 'messages_ai', 'messages_au']);
  assert.equal(reopened.meta('searchIndexPending'), '0');
});

test('une passe qui échoue remet quand même la recherche en état', async (t) => {
  const { open, run, project } = setup(t);
  project.session('s1', [records.userText('avant la panne')]);
  const index = open();
  // markCopies et l'archive rattrapent désormais leurs pannes (indexer.js) ;
  // celle-ci vient après elles, et remonte toujours.
  index.restoreCarriedQuotas = () => {
    throw new Error('panne simulée');
  };
  await assert.rejects(run(index), /panne simulée/);
  assert.deepEqual(triggers(index), ['messages_ad', 'messages_ai', 'messages_au']);
  assert.equal(index.search('panne').length, 1);
});
