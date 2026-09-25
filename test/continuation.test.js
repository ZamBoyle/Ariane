'use strict';

/**
 * Une conversation reprise, ou dupliquée, se poursuit dans un autre fichier,
 * et les assistants l'écrivent — chacun de son côté. Claude Code inscrit dans
 * l'ANCIENNE transcription le nom de la nouvelle (`continued-in`) ; Codex
 * inscrit dans la NOUVELLE le nom de l'ancienne (`forked_from_id`). Mesuré le
 * 25 septembre 2026 : un lien chez Claude, `64ffbe9a` → `d4c518b6`, et chez
 * Codex une duplication faite par la personne parmi huit en-têtes qui portent
 * ce champ — les sept autres sont des sous-agents, dont c'est le parent.
 *
 * Ariane les lit pour relier les deux parties, dans les deux sens, avec la
 * même chaîne que les conversations compactées : « Partie 1 sur 2 ».
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const { extractRecord } = require('../src/core/extract');
const claudeAdapter = require('../src/core/agents/claude');
const codexAdapter = require('../src/core/agents/codex');
const { createFixture, records, cdx, resetCounters } = require('./helpers/fixture');

function setup(t, adapters) {
  resetCounters();
  const fx = createFixture();
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    fx.cleanup();
  });
  const run = () => new Indexer(index, { env: fx.env, adapters }).run();
  return { fx, index, run };
}

const parts = (index, id) => index.chain(id).map((part) => part.id);

test('l’enregistrement continued-in devient un lien, et rien d’autre', () => {
  assert.deepEqual(
    extractRecord({ type: 'continued-in', sessionId: 'A', continuedInSessionId: 'B' }),
    { kind: 'continuation', continuedIn: 'B' }
  );
  assert.equal(extractRecord({ type: 'continued-in', sessionId: 'A' }).kind, 'ignored');
});

test('Claude : une conversation reprise et celle qu’elle reprend sont deux parties d’une même chaîne', async (t) => {
  const { fx, index, run } = setup(t, [claudeAdapter]);
  const question = records.userText('la question d’avant la reprise');
  fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' })
    .session('A', [
      question,
      records.assistantText('la réponse'),
      { type: 'continued-in', timestamp: '2026-09-19T21:26:52.789Z', continuedInSessionId: 'B' },
    ])
    .session('B', [question, records.userText('la suite, après la reprise')]);

  const report = await run();
  assert.deepEqual(report.unknownKinds, {}, 'le lien n’est plus un format inconnu');
  assert.deepEqual(
    parts(index, 'claude:A'),
    ['claude:A', 'claude:B'],
    'l’original sait où il continue'
  );
  assert.deepEqual(
    parts(index, 'claude:B'),
    ['claude:A', 'claude:B'],
    'et la reprise d’où elle vient'
  );
});

test('Codex : une duplication nomme son original, un sous-agent non', async (t) => {
  const { fx, index, run } = setup(t, [codexAdapter]);
  const original = '01a07317-6caf-7353-9eb6-71311aac10dc';
  const fork = '01a07c27-8294-7162-a67e-f8cf1fe49f75';
  const child = '019f0b22-f599-76b3-9dc6-00e763ff425e';
  const header = (id, extra) => ({
    timestamp: '2026-09-07T13:55:59.619Z',
    type: 'session_meta',
    payload: { id, cwd: '/home/zam/demo', ...extra },
  });
  const tree = fx.codex();
  tree.session(original, [header(original, {}), cdx.message('user', 'la conversation d’origine')]);
  tree.session(fork, [
    header(fork, { forked_from_id: original, thread_source: 'user' }),
    cdx.message('user', 'ce que la duplication ajoute'),
  ]);
  tree.session(child, [
    header(child, {
      forked_from_id: original,
      parent_thread_id: original,
      thread_source: 'subagent',
    }),
    cdx.message('user', 'consigne d’un sous-agent'),
  ]);

  await run();
  assert.deepEqual(parts(index, `codex:${fork}`), [`codex:${original}`, `codex:${fork}`]);
  assert.deepEqual(
    parts(index, `codex:${original}`),
    [`codex:${original}`, `codex:${fork}`],
    'le sous-agent, qui porte aussi forked_from_id, n’est pas une partie : il a son parent'
  );
  assert.deepEqual(parts(index, `codex:${child}`), [`codex:${child}`]);
});

test('une duplication faite uniquement de copies n’est pas une partie', async (t) => {
  const { fx, index, run } = setup(t, [codexAdapter]);
  const original = '11111111-1111-4111-8111-111111111111';
  const fork = '22222222-2222-4222-8222-222222222222';
  const said = cdx.message('user', 'la seule question');
  const tree = fx.codex();
  tree.session(original, [cdx.meta('/home/zam/demo', original), said]);
  const forkHeader = cdx.meta('/home/zam/demo', fork);
  tree.session(fork, [
    {
      ...forkHeader,
      timestamp: '2026-06-23T10:00:00.000Z',
      payload: { ...forkHeader.payload, forked_from_id: original },
    },
    { ...said, timestamp: '2026-06-23T10:00:00.000Z' },
  ]);

  await run();
  assert.deepEqual(
    parts(index, `codex:${original}`),
    [`codex:${original}`],
    'rien à y lire que l’original ne montre déjà'
  );
});

// ── ce que la base garde du lien ────────────────────────────────────────────

function twoSessions(t) {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.upsertAgent('claude', 'Claude Code', '/root');
  const folder = index.folderId('/home/ada/projets/tardis');
  for (const id of ['claude:A', 'claude:B']) {
    index.upsertSession({ id, agent_id: 'claude', folder_id: folder });
    index.addMessages(id, [{ role: 'user', uuid: `u-${id}`, text: id, parts: [] }]);
    index.finalizeSession(id);
  }
  return index;
}

test('un fichier relu depuis le début reprend le lien qu’il déclarait', (t) => {
  const index = twoSessions(t);
  index.setContinuedIn('claude:A', 'claude:B');
  assert.deepEqual(parts(index, 'claude:A'), ['claude:A', 'claude:B']);

  index.resetSession('claude:A', null);
  assert.deepEqual(
    parts(index, 'claude:B'),
    ['claude:B'],
    'réécrit, le fichier ne dit peut-être plus rien : le lien ne lui survit pas'
  );
});

test('une conversation sauvée par Ariane garde ses liens', (t) => {
  const index = twoSessions(t);
  const row = {
    seq: 0,
    uuid: 'u-C',
    parent_uuid: null,
    role: 'user',
    ts: '',
    model: '',
    text: 'C',
    thinking: '',
    parts: '[]',
    is_meta: 0,
    is_notice: 0,
    is_sidechain: 0,
    command: null,
  };
  index.restoreArchived(
    'claude:C',
    { agent_id: 'claude', folder_path: '/home/ada/projets/tardis', continues_from: 'claude:B' },
    [row],
    'Claude Code'
  );
  index.restoreArchived(
    'claude:Z',
    { agent_id: 'claude', folder_path: '/home/ada/projets/tardis', continued_in: 'claude:A' },
    [{ ...row, uuid: 'u-Z', text: 'Z' }],
    'Claude Code'
  );
  assert.deepEqual(parts(index, 'claude:B'), ['claude:B', 'claude:C']);
  assert.deepEqual(parts(index, 'claude:A'), ['claude:Z', 'claude:A']);
});

test('ce qui part à l’archive emporte les deux liens', (t) => {
  const index = twoSessions(t);
  index.setContinuedIn('claude:A', 'claude:B');
  index.upsertSession({
    id: 'claude:B',
    agent_id: 'claude',
    folder_id: index.folderId('/home/ada/projets/tardis'),
    continues_from: 'claude:A',
  });
  assert.equal(index.archiveRows('claude:A').session.continued_in, 'claude:B');
  assert.equal(
    index.archiveRows('claude:B').session.continues_from,
    'claude:A',
    'une conversation sauvée seule ne doit pas perdre sa place dans la chaîne'
  );
});
