'use strict';

/**
 * Les statistiques : qui a parlé, ce que ça a coûté, quand, avec qui.
 *
 * Le calcul (src/core/statistics.js) reçoit les règles de l'écran — speakerOf,
 * hasContent, modelName — au lieu de les réécrire : ces tests les lui passent
 * telles quelles, depuis format.js, pour que les chiffres créditent la parole
 * exactement comme l'affichage.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { summarize } = require('../src/core/statistics');
const { Index } = require('../src/core/db');
const { usageOf } = require('../src/core/agents/contract');

let F;
test.before(async () => {
  F = await import('../src/renderer/format.js');
});

let counter = 0;
/** Une ligne comme db.statisticsRows la rend ; seuls les champs donnés changent. */
function row(extra = {}) {
  counter++;
  return {
    sessionId: 'claude:s1',
    agentId: 'claude',
    folderPath: '/p',
    role: 'assistant',
    model: '',
    hasText: 1,
    hasThinking: 0,
    parts: null,
    isNotice: 0,
    isSidechain: 0,
    command: null,
    at: '2026-09-10T12:00:00.000Z',
    tokInput: null,
    tokOutput: null,
    tokCacheRead: null,
    tokCacheWrite: null,
    ...extra,
  };
}

const tool = (type) => JSON.stringify([{ type, id: `t${counter}` }]);

// ── qui a parlé ───────────────────────────────────────────────────────────

test('chaque message est rangé avec les règles de l’écran', () => {
  const s = summarize(
    [
      row({ role: 'user' }), // tapé par la personne
      row({ role: 'assistant' }), // une réponse
      row({ role: 'user', hasText: 0, parts: tool('tool_result') }), // la sortie d'un outil
      row({ role: 'user', isNotice: 1, command: '{"name":"away-summary"}' }), // un avis
      row({ role: 'assistant', hasText: 0, parts: '[]' }), // une enveloppe vide
    ],
    F
  );
  assert.deepEqual(s.speakers, { you: 1, assistant: 1, tools: 1, notices: 1, empty: 1, masked: 0 });
  assert.equal(s.records, 5, 'le pied compte tout ; la ventilation dit ce que c’est');
});

test('un raisonnement masqué ne montre rien, mais il est nommé à part', () => {
  // 6 093 des 6 561 enregistrements sans rien à afficher, sur un vrai index.
  const s = summarize(
    [
      row({
        role: 'assistant',
        hasText: 0,
        parts: JSON.stringify([{ type: 'other', name: 'masked-thinking' }]),
      }),
      row({ role: 'assistant', hasText: 0, parts: '[]' }),
    ],
    F
  );
  assert.equal(s.speakers.empty, 2);
  assert.equal(s.speakers.masked, 1, 'seul le vrai raisonnement masqué est compté comme tel');
});

test('un raisonnement seul est une réponse, pas une enveloppe vide', () => {
  // Mon premier comptage oubliait la colonne thinking : 560 réponses passaient pour vides.
  const s = summarize([row({ role: 'assistant', hasText: 0, hasThinking: 1, parts: '[]' })], F);
  assert.equal(s.speakers.assistant, 1);
  assert.equal(s.speakers.empty, 0);
});

test('un appel d’outil sans prose est la réponse de l’assistant, pas une sortie d’outil', () => {
  const s = summarize([row({ role: 'assistant', hasText: 0, parts: tool('tool_use') })], F);
  assert.equal(s.speakers.assistant, 1);
});

test('la consigne d’un sous-agent n’est jamais mise dans la bouche de la personne', () => {
  const s = summarize([row({ role: 'user', isSidechain: 1 })], F);
  assert.equal(s.speakers.you, 0);
  assert.equal(s.speakers.tools, 1);
});

// ── les jetons ────────────────────────────────────────────────────────────

test('trois nombres, jamais un total : le cache relu reste à part', () => {
  const s = summarize(
    [
      row({ tokInput: 2, tokOutput: 100, tokCacheRead: 5000, tokCacheWrite: 700 }),
      row({ tokInput: 3, tokOutput: 50, tokCacheRead: 6000, tokCacheWrite: 0 }),
    ],
    F
  );
  assert.deepEqual(s.tokens, { sent: 705, received: 150, cacheRead: 11000, measuredSessions: 1 });
});

test('la couverture est dite : un assistant sans compte vaut null, pas zéro', () => {
  const s = summarize(
    [
      row({ tokOutput: 10 }),
      row({ sessionId: 'gemini:g1', agentId: 'gemini' }),
      row({ sessionId: 'gemini:g2', agentId: 'gemini' }),
    ],
    F
  );
  assert.equal(s.sessions, 3);
  assert.equal(s.tokens.measuredSessions, 1, '1 conversation mesurée sur 3');
  const gemini = s.agents.find((a) => a.agentId === 'gemini');
  assert.equal(gemini.received, null, 'Gemini n’a rien mesuré : ni 0, ni rien d’inventé');
  assert.equal(gemini.measuredSessions, 0);
});

// ── dans le temps ─────────────────────────────────────────────────────────

test('chaque mois, du premier au dernier, les mois vides compris', () => {
  const s = summarize(
    [
      row({ role: 'user', at: '2026-01-15T12:00:00.000Z' }),
      row({ at: '2026-04-15T12:00:00.000Z', tokOutput: 40 }),
    ],
    F
  );
  assert.deepEqual(
    s.months.map((m) => m.month),
    ['2026-01', '2026-02', '2026-03', '2026-04'],
    'deux mois éloignés ne sont pas voisins sur un axe du temps'
  );
  assert.deepEqual(s.months[0], { month: '2026-01', you: 1, replies: 0, received: 0 });
  assert.deepEqual(s.months[3], { month: '2026-04', you: 0, replies: 1, received: 40 });
});

test('un message sans date est compté à part, jamais placé au hasard', () => {
  const s = summarize([row({ at: null }), row({ at: 'pas une date' })], F);
  assert.equal(s.undated, 2);
  assert.deepEqual(s.months, []);
});

// ── par modèle, par dossier ───────────────────────────────────────────────

test('les modèles : les réponses avec du texte, sous leur propre nom', () => {
  const s = summarize(
    [
      row({ model: 'copilot/claude-sonnet-5' }),
      row({ model: 'claude-sonnet-5' }),
      row({ model: 'gpt-5' }),
      row({ model: 'gpt-5', hasText: 0, parts: tool('tool_use') }), // un appel d'outil seul
      row({ model: '<synthetic>' }),
      row({ role: 'user', model: 'kimi-k3' }),
    ],
    F
  );
  assert.deepEqual(s.models, [
    { model: 'claude-sonnet-5', replies: 2 },
    { model: 'gpt-5', replies: 1 },
  ]);
});

test('les dossiers les plus actifs se mesurent en échanges, pas en machinerie', () => {
  const s = summarize(
    [
      row({ folderPath: '/calme', role: 'user' }),
      row({ folderPath: '/calme' }),
      ...Array.from({ length: 5 }, () =>
        row({ folderPath: '/outils', role: 'user', hasText: 0, parts: tool('tool_result') })
      ),
      row({ folderPath: '/outils' }),
    ],
    F
  );
  assert.deepEqual(s.activeFolders, [
    { path: '/calme', messages: 2 },
    { path: '/outils', messages: 1 },
  ]);
});

test('rien à compter, rien d’inventé', () => {
  const s = summarize([], F);
  assert.equal(s.records, 0);
  assert.deepEqual(s.months, []);
  assert.deepEqual(s.agents, []);
  assert.deepEqual(s.tokens, { sent: 0, received: 0, cacheRead: 0, measuredSessions: 0 });
});

// ── la requête ────────────────────────────────────────────────────────────

test('la requête filtre par période et par assistant, comme la barre latérale', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.upsertAgent('claude', 'Claude Code', '/root');
  index.upsertAgent('codex', 'Codex', '/root');
  const folder = index.folderId('/home/ada/p');
  index.upsertSession({ id: 'claude:a', agent_id: 'claude', folder_id: folder });
  index.upsertSession({ id: 'codex:b', agent_id: 'codex', folder_id: folder });
  index.addMessages('claude:a', [
    {
      role: 'user',
      uuid: 'u1',
      text: 'ancienne',
      parts: [],
      timestamp: '2026-01-01T10:00:00.000Z',
    },
    {
      role: 'assistant',
      uuid: 'a1',
      text: 'récente',
      parts: [],
      timestamp: '2026-09-01T10:00:00.000Z',
      usage: usageOf({ output: 9 }),
    },
  ]);
  index.addMessages('codex:b', [
    { role: 'user', uuid: 'u2', text: 'codex', parts: [], timestamp: '2026-09-02T10:00:00.000Z' },
  ]);

  const all = [...index.statisticsRows()];
  assert.equal(all.length, 3);
  assert.equal(all.find((r) => r.role === 'assistant').tokOutput, 9);
  assert.equal(
    all.find((r) => r.role === 'assistant').parts,
    null,
    'les parts ne sortent que sans prose'
  );

  assert.equal(
    [...index.statisticsRows({ since: '2026-08-01T00:00:00.000Z' })].length,
    2,
    'la période'
  );
  assert.deepEqual(
    [...index.statisticsRows({ hidden: ['codex'] })].map((r) => r.agentId),
    ['claude', 'claude'],
    'les assistants masqués'
  );

  // Un curseur ouvert refuse toute écriture à la connexion — celles d'une passe
  // d'indexation comprises. Trouvé le 26 septembre 2026 : les statistiques en
  // gardaient un ouvert le temps d'un await. Il ne survit plus à l'appel, même
  // lâché en route, même quand celui qui lit lève une exception.
  const first = index.statisticsRows({}, (rows) => {
    for (const row of rows) return row.agentId;
    return null;
  });
  assert.equal(first, 'claude', 'ce que la fonction fait des lignes est rendu');
  index.addMessages('codex:b', [
    { role: 'assistant', uuid: 'a9', text: 'écrit après', parts: [], timestamp: '2026-09-03T10:00:00.000Z' },
  ]);
  assert.throws(
    () =>
      index.statisticsRows({}, () => {
        throw new Error('lecture ratée');
      }),
    /lecture ratée/
  );
  index.addMessages('codex:b', [
    { role: 'assistant', uuid: 'a10', text: 'et encore', parts: [], timestamp: '2026-09-03T11:00:00.000Z' },
  ]);
  assert.equal([...index.statisticsRows()].length, 5, 'les deux écritures ont eu lieu');
});
