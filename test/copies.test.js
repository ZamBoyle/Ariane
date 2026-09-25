'use strict';

/**
 * Une conversation reprise, ou dupliquée, commence par recopier l'historique
 * d'une autre. Mesuré le 25 septembre 2026 : Claude Code recopie 922 messages
 * (mêmes uuid, mêmes heures) dans la session qui en reprend une autre ; Codex
 * recopie 973 messages dans une reprise d'une seconde, et ses anciens
 * instantanés répétaient une même réponse dans 60 fichiers. Laissées telles
 * quelles, ces copies se lisent deux fois, se trouvent deux fois, et leurs
 * jetons se comptent deux fois.
 *
 * La règle : un message qu'une conversation PLUS ANCIENNE du même assistant
 * contient déjà est une copie — montré, compté et cherché là d'où il vient,
 * et nulle part ailleurs. Seulement pour les assistants dont les identifiants
 * valent partout (Claude, Codex) : Copilot et Gemini numérotent leurs appels
 * d'outils par session.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const registry = require('../src/core/agents');
const claudeAdapter = require('../src/core/agents/claude');
const codexAdapter = require('../src/core/agents/codex');
const { usageOf } = require('../src/core/agents/contract');
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

const texts = (index, id) =>
  index
    .messages(id)
    .map((m) => m.text)
    .filter(Boolean);
const listed = (index) =>
  index.folders().flatMap((f) => index.sessions(f.id).map((s) => [s.id, s.messageCount]));

// ── Claude : une session reprise recopie celle qu'elle reprend ──────────────

/** Une réponse avec son compte, comme l'API l'écrit. */
const reply = (text, output) =>
  records.assistantText(text, {
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      id: `msg_${text}`,
      usage: {
        input_tokens: 1,
        output_tokens: output,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      content: [{ type: 'text', text }],
    },
  });

test('Claude : une conversation reprise ne répète pas ce qu’elle a recopié', async (t) => {
  const { fx, index, run } = setup(t, [claudeAdapter]);
  const question = records.userText('la question recopiée');
  const answer = reply('réponse-recopiée', 100);
  fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' })
    .session('A', [question, answer])
    // Mêmes lignes, même uuid, même heure : seule la session change.
    .session('B', [question, answer, records.userText('la suite'), reply('réponse-neuve', 7)]);

  const report = await run();
  assert.equal(report.copies, 2, 'deux messages recopiés, repérés en fin de passe');

  assert.deepEqual(texts(index, 'claude:A'), ['la question recopiée', 'réponse-recopiée']);
  assert.deepEqual(
    texts(index, 'claude:B'),
    ['la suite', 'réponse-neuve'],
    'la reprise ne montre que ce qu’elle a ajouté'
  );
  assert.deepEqual(
    listed(index).sort(),
    [
      ['claude:A', 2],
      ['claude:B', 2],
    ],
    'chaque conversation compte ses propres messages'
  );

  const sums = index.sessions(index.folders()[0].id).reduce((n, s) => n + s.tokOutput, 0);
  assert.equal(sums, 107, 'les jetons de la réponse recopiée ne comptent qu’une fois');
  assert.equal(index.stats().messages, 4, 'le pied de page ne compte pas deux fois');
  assert.equal(
    index.search('recopiée').length,
    2,
    'la recherche trouve la question et la réponse une fois chacune, pas deux'
  );
  assert.ok(index.search('recopiée').every((hit) => hit.sessionId === 'claude:A'));

  const copied = index.copiedFrom('claude:B');
  assert.equal(copied.count, 2);
  assert.equal(copied.from.id, 'claude:A', 'la reprise sait d’où viennent ses copies');
  assert.equal(index.copiedFrom('claude:A'), null, 'l’original n’a rien recopié');
});

test('l’ordre de lecture ne décide pas de l’original', async (t) => {
  const { fx, index, run } = setup(t, [claudeAdapter]);
  const question = records.userText('première question');
  const answer = reply('première-réponse', 10);
  const project = fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' });

  // La reprise est lue d'abord : rien ne dit encore qu'elle a recopié quoi que ce soit.
  project.session('B', [question, answer, records.userText('reprise')]);
  await run();
  assert.equal(texts(index, 'claude:B').length, 3, 'sans l’original, tout est à elle');

  project.session('A', [question, answer]);
  await run();
  assert.deepEqual(
    texts(index, 'claude:B'),
    ['reprise'],
    'l’original arrivé, les copies lui reviennent'
  );
  assert.equal(texts(index, 'claude:A').length, 2);
});

test('une passe où rien n’a changé ne refait pas le tri', async (t) => {
  const { fx, index, run } = setup(t, [claudeAdapter]);
  fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' }).session('A', [
    records.userText('q'),
    reply('r', 1),
  ]);
  await run();

  let calls = 0;
  const markCopies = index.markCopies.bind(index);
  index.markCopies = (...args) => {
    calls += 1;
    return markCopies(...args);
  };
  await run();
  assert.equal(calls, 0, 'une passe à vide doit rester gratuite');
});

// ── Codex : une reprise dupliquée ───────────────────────────────────────────

test('Codex : une reprise qui n’a rien ajouté n’est plus listée, et revient dès qu’elle ajoute', async (t) => {
  const { fx, index, run } = setup(t, [codexAdapter]);
  const q = cdx.message('user', 'question d’origine');
  const r = cdx.message('assistant', 'réponse d’origine');
  const tree = fx.codex();
  tree.session('11111111-1111-4111-8111-111111111111', [
    cdx.meta('/home/zam/demo', '11111111-1111-4111-8111-111111111111'),
    q,
    r,
  ]);
  // Codex recopie l'historique en réécrivant l'heure : celle de la reprise.
  const later = (record) => ({ ...record, timestamp: '2026-06-23T10:00:00.000Z' });
  const forkId = '22222222-2222-4222-8222-222222222222';
  tree.session(forkId, [
    { ...cdx.meta('/home/zam/demo', forkId), timestamp: '2026-06-23T10:00:00.000Z' },
    later(q),
    later(r),
  ]);

  await run();
  assert.deepEqual(
    listed(index).map(([id]) => id),
    ['codex:11111111-1111-4111-8111-111111111111'],
    'une reprise faite uniquement de copies n’a rien à montrer'
  );
  assert.equal(index.stats().sessions, 1, 'et le pied de page ne la compte pas');
  // Un assistant masqué passe par d'autres requêtes : elles doivent dire la même chose.
  assert.equal(index.stats(['claude']).sessions, 1, 'pas plus quand un autre assistant est masqué');
  assert.equal(index.stats(['claude']).messages, 2);
  assert.equal(index.folders(['claude'])[0].sessionCount, 1);

  tree.append(forkId, [
    { ...cdx.message('user', 'enfin du neuf'), timestamp: '2026-06-23T10:05:00.000Z' },
  ]);
  await run();
  const fork = listed(index).find(([id]) => id === `codex:${forkId}`);
  assert.deepEqual(fork, [`codex:${forkId}`, 1], 'elle réapparaît avec son seul message à elle');
});

// ── Ce que la règle ne doit pas toucher ─────────────────────────────────────

/** Deux conversations d'un même assistant, qui partagent un identifiant. */
function twoSessions(t, agent) {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.upsertAgent(agent, agent, '/root');
  const folder = index.folderId('/home/ada/projets/tardis');
  for (const [id, at] of [
    ['A', '2026-09-01T10:00:00.000Z'],
    ['B', '2026-09-02T10:00:00.000Z'],
  ]) {
    index.upsertSession({ id: `${agent}:${id}`, agent_id: agent, folder_id: folder });
    index.addMessages(`${agent}:${id}`, [
      { role: 'assistant', uuid: 'partagé', text: `appel de ${id}`, parts: [], timestamp: at },
      { role: 'user', uuid: `propre-${id}`, text: `question de ${id}`, parts: [], timestamp: at },
    ]);
    index.finalizeSession(`${agent}:${id}`);
  }
  return index;
}

test('seuls Claude et Codex déclarent des identifiants valables partout', () => {
  const declared = registry
    .all()
    .filter((a) => a.globalIds)
    .map((a) => a.id)
    .sort();
  assert.deepEqual(
    declared,
    ['claude', 'codex'],
    'mesuré : Copilot et Gemini numérotent leurs appels par session, bash_5 ici n’est pas bash_5 là'
  );
});

test('Copilot : un même numéro d’appel dans deux conversations, ce sont deux appels', (t) => {
  const index = twoSessions(t, 'copilot-cli');
  assert.equal(index.markCopies(), 0);
  assert.equal(index.messages('copilot-cli:B').length, 2, 'rien n’est retiré à la seconde');
});

test('oublier l’original rend ses copies à la conversation qui les avait reprises', (t) => {
  const index = twoSessions(t, 'claude');
  assert.equal(index.markCopies(), 1);
  assert.deepEqual(texts(index, 'claude:B'), ['question de B']);

  index.forgetSession('claude:A');
  assert.deepEqual(
    texts(index, 'claude:B'),
    ['appel de B', 'question de B'],
    'elle en est désormais la seule trace'
  );
});

test('le premier prompt d’une reprise est le sien, pas celui qu’elle a recopié', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.upsertAgent('claude', 'Claude Code', '/root');
  const folder = index.folderId('/home/ada/projets/tardis');
  const add = (id, at, messages) => {
    index.upsertSession({ id, agent_id: 'claude', folder_id: folder });
    index.addMessages(
      id,
      messages.map(([uuid, text]) => ({ role: 'user', uuid, text, parts: [], timestamp: at }))
    );
    index.finalizeSession(id);
  };
  add('claude:A', '2026-09-01T10:00:00.000Z', [['q1', 'la question d’origine']]);
  add('claude:B', '2026-09-02T10:00:00.000Z', [
    ['q1', 'la question d’origine'],
    ['q2', 'la question de la reprise'],
  ]);
  assert.equal(index.session('claude:B').firstPrompt, 'la question d’origine', 'avant le tri');

  index.markCopies();
  assert.equal(index.session('claude:B').firstPrompt, 'la question de la reprise');
});

// Une reprise recopie avec les mêmes heures : les deux conversations commencent
// au même instant, et c'était la fin qui départageait. L'original qui continue
// après la reprise (deux terminaux ouverts) devenait « la copie » ; à égalité
// parfaite, l'identifiant décidait. Le fichier dit qui reprend qui : c'est lui
// qui décide désormais (26 septembre 2026).
test('ce que le fichier déclare décide de l’original, pas les dates', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.upsertAgent('claude', 'Claude Code', '/root');
  const folder = index.folderId('/home/ada/projets/tardis');
  const at = (minute) => `2026-09-19T18:${String(minute).padStart(2, '0')}:00.000Z`;
  const add = (id, messages) => {
    index.upsertSession({ id, agent_id: 'claude', folder_id: folder });
    index.addMessages(id, messages.map(([uuid, minute]) => ({ role: 'user', uuid, text: uuid, parts: [], timestamp: at(minute) })));
    index.finalizeSession(id);
  };
  const flags = (id) => index.messages(id).length;

  add('claude:zz-original', [['u1', 1], ['u2', 2], ['u3', 3]]);
  add('claude:aa-reprise', [['u1', 1], ['u2', 2], ['u3', 3], ['u4', 10]]);
  // Claude écrit « continued-in » dans l'ancienne transcription.
  index.setContinuedIn('claude:zz-original', 'claude:aa-reprise');
  index.markCopies();
  assert.equal(flags('claude:zz-original'), 3, 'l’original garde ses trois messages');
  assert.equal(flags('claude:aa-reprise'), 1, 'la reprise ne montre que le sien');

  // L'original continue après la reprise : sa fin passe après celle de la reprise.
  const since = index.lastMessageId();
  index.addMessages('claude:zz-original', [{ role: 'user', uuid: 'u5', text: 'u5', parts: [], timestamp: at(20) }]);
  index.finalizeSession('claude:zz-original');
  index.markCopies({ since });
  assert.equal(flags('claude:zz-original'), 4, 'une passe qui ne relit que le neuf ne renverse rien');
  assert.equal(flags('claude:aa-reprise'), 1);
  assert.equal(index.stats().messages, 5, 'rien n’est compté deux fois');
  index.markCopies();
  assert.equal(flags('claude:zz-original'), 4, 'ni une passe complète');
  assert.equal(index.copiedFrom('claude:zz-original'), null);
});

test('une reprise commence à son premier message, pas à celui qu’elle a recopié', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.upsertAgent('claude', 'Claude Code', '/root');
  const folder = index.folderId('/home/ada/projets/tardis');
  const add = (id, messages) => {
    index.upsertSession({ id, agent_id: 'claude', folder_id: folder });
    index.addMessages(
      id,
      messages.map(([uuid, timestamp]) => ({
        role: 'user',
        uuid,
        text: uuid,
        parts: [],
        timestamp,
      }))
    );
    index.finalizeSession(id);
  };
  add('claude:A', [['q1', '2026-09-19T18:57:59.502Z']]);
  // La reprise recopie q1 avec son heure, puis écrit les siens 41 minutes plus tard.
  add('claude:B', [
    ['q1', '2026-09-19T18:57:59.502Z'],
    ['q2', '2026-09-19T19:39:48.767Z'],
    ['q3', '2026-09-19T20:05:00.000Z'],
  ]);
  index.addMessages('claude:B', [
    { role: 'assistant', uuid: 'sans-heure', text: 'x', parts: [], timestamp: '' },
  ]);
  index.markCopies();

  assert.equal(
    index.session('claude:B').firstAt,
    '2026-09-19T18:57:59.502Z',
    'la session, elle, compte ses copies'
  );
  assert.deepEqual(
    index.sessionSpan('claude:B'),
    { startedAt: '2026-09-19T19:39:48.767Z', endedAt: '2026-09-19T20:05:00.000Z' },
    'l’en-tête dit quand ses propres messages ont été écrits'
  );
  assert.deepEqual(
    index.sessionSpan('claude:A'),
    { startedAt: '2026-09-19T18:57:59.502Z', endedAt: '2026-09-19T18:57:59.502Z' },
    'un seul message : un seul instant'
  );
});

test('la chaîne d’une conversation compactée ne passe jamais par une copie', (t) => {
  const index = twoSessions(t, 'claude');
  // A a été compactée sur place : sa frontière nomme un de SES messages, que B a recopié.
  index.setContinues('claude:A', 'partagé');
  index.markCopies();
  assert.deepEqual(
    index.chain('claude:A').map((part) => part.id),
    ['claude:A'],
    'sans quoi la reprise passerait pour la partie précédente de son propre original'
  );
});

test('un usage recopié n’est compté qu’une fois dans les statistiques', (t) => {
  const index = twoSessions(t, 'codex');
  for (const id of ['codex:A', 'codex:B']) {
    index.addUsage(id, usageOf({ output: 10 }));
  }
  index.markCopies();
  const rows = [...index.statisticsRows()];
  assert.equal(rows.length, 3, 'le message recopié ne sort qu’une fois');
  assert.equal(
    rows.reduce((n, r) => n + (r.tokOutput || 0), 0),
    10,
    'et ses jetons avec lui'
  );
});

test('ce qu’une passe écrit a toujours un identifiant plus haut, même après un effacement', (t) => {
  const index = twoSessions(t, 'claude');
  const since = index.lastMessageId();
  // Une conversation réécrite est effacée puis relue : ses lignes du haut disparaissent.
  index.resetSession('claude:B', null);
  index.addMessages('claude:B', [{ role: 'user', uuid: 'neuf', text: 'relu', parts: [] }]);
  const [row] = index.db.prepare("SELECT id FROM messages WHERE uuid = 'neuf'").all();
  assert.ok(row.id > since, 'sans quoi la recherche des copies de cette passe ne la verrait pas');
});

// ── par son index, ou 31 secondes ───────────────────────────────────────────

// L'index des uuid est partiel (`WHERE uuid <> ''`) : SQLite ne s'en sert que
// si la requête le redit. Sans cela, il parcourait chaque conversation de
// l'agent et tous ses messages, une fois par copie — 31 s pour ouvrir une
// conversation qui commençait par 922 messages recopiés (25 septembre 2026),
// 5 ms avec l'index. markCopies l'avait déjà payé ; copiedFrom l'a payé à
// son tour, faute d'un test qui lise le plan.
test('chaque recherche d’une copie passe par l’index des uuid', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  // parentOf aussi : sans l'index, chaque ouverture lisait toute la table (46 ms).
  for (const name of ['copiedFrom', 'markCopies', 'markNewCopies', 'parentOf']) {
    const statement = index.s[name];
    // Nommés (@agents, @since) ou positionnels (?) : de quoi préparer le plan.
    const params = statement.source.includes('@')
      ? [{ agents: '["claude"]', since: 0, id: 'x' }]
      : Array.from({ length: (statement.source.match(/\?/g) || []).length }, () => 'x');
    const plan = index.db
      .prepare(`EXPLAIN QUERY PLAN ${statement.source}`)
      .all(...params)
      .map((row) => row.detail)
      .join(' | ');
    assert.match(plan, /messages_by_uuid/, `${name} : ${plan}`);
  }
});
