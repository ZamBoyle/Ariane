'use strict';

/**
 * Les limites d'utilisation, telles que les assistants les écrivent — lues,
 * jamais demandées à un serveur.
 *
 * Mesuré le 25 septembre 2026 : Codex écrit un relevé à chaque `token_count`
 * (7 133) ; Claude ne l'écrit que sur une requête refusée (75 erreurs 429), et
 * garde son dernier relevé dans `~/.claude.json`. Quatre pièges décident de la
 * forme : la fin d'une fenêtre bouge d'une seconde ou deux entre deux relevés ;
 * les fenêtres ont changé en juillet (cinq heures et une semaine, puis la
 * semaine seule) ; une duplication recopie de vieux relevés sous sa propre
 * date ; et passé 100 %, les crédits baissent relevé après relevé.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const {
  codexQuota,
  claudeQuota,
  claudeCachedQuota,
  addReadings,
  WINDOW_SLACK,
} = require('../src/core/quota');
const claudeAdapter = require('../src/core/agents/claude');
const codexAdapter = require('../src/core/agents/codex');
const { createFixture, records, cdx, resetCounters } = require('./helpers/fixture');

const WEEK = 10080;
const END = 1789839040; // la fin d'une semaine réelle, en secondes

/** Un objet `rate_limits` de Codex, tel qu'il est écrit. */
const limits = (primary, secondary = null, extra = {}) => ({
  limit_id: 'codex',
  limit_name: null,
  primary,
  secondary,
  credits: { has_credits: false, unlimited: false, balance: '0' },
  plan_type: 'plus',
  rate_limit_reached_type: null,
  ...extra,
});
const win = (minutes, used, resets) => ({
  window_minutes: minutes,
  used_percent: used,
  resets_at: resets,
});

// ── ce qu'un relevé dit ─────────────────────────────────────────────────────

test('Codex : une fenêtre se reconnaît à sa durée, pas à la case où elle est écrite', () => {
  // Juillet 2026 : la semaine passe de `secondary` à `primary`.
  const before = codexQuota(
    limits(win(300, 12, 1000), win(WEEK, 40, 2000)),
    '2026-07-01T10:00:00Z'
  );
  const after = codexQuota(limits(win(WEEK, 41, 2000)), '2026-07-20T10:00:00Z');
  assert.deepEqual(
    before.map((w) => [w.minutes, w.used]),
    [
      [300, 12],
      [WEEK, 40],
    ]
  );
  assert.deepEqual(
    after.map((w) => [w.minutes, w.used]),
    [[WEEK, 41]]
  );
});

test('Codex : les crédits sont écrits en texte, la limite sans nom est celle de Codex', () => {
  const [w] = codexQuota(
    limits(win(WEEK, 100, END), null, {
      limit_id: null,
      credits: { has_credits: true, unlimited: false, balance: '123.2651900000' },
    }),
    '2026-09-14T21:15:43Z'
  );
  assert.equal(w.limit, 'codex');
  assert.deepEqual(w.credits, { has: true, unlimited: false, balance: 123.26519 });
  assert.equal(w.reached, true, '100 %, c’est atteint');
});

test('Codex : une fenêtre sans fin (octobre 2025) ne peut pas être reconnue, et n’est pas gardée', () => {
  assert.deepEqual(
    codexQuota(limits(win(299, 0, null), win(10079, 17, null)), '2025-10-06T21:43:33Z'),
    []
  );
  assert.deepEqual(codexQuota(null, '2026-09-01T00:00:00Z'), []);
});

test('Claude : une requête refusée nomme sa fenêtre et sa fin, pas de pourcentage', () => {
  const refused = {
    status: 'rejected',
    resetsAt: 1789746000,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
  };
  assert.deepEqual(
    claudeQuota(refused, '2026-09-18T13:15:00Z').map((w) => [w.minutes, w.used, w.reached]),
    [[300, null, true]]
  );
  assert.deepEqual(
    claudeQuota({ ...refused, rateLimitType: 'tangelo' }, '2026-09-18T13:15:00Z'),
    [],
    'un nom de code n’apprend rien au lecteur'
  );
});

test('Claude : le dernier relevé mis en cache, avec l’heure où il a été pris', () => {
  const cache = {
    fetchedAtMs: Date.parse('2026-09-23T08:06:49.945Z'),
    utilization: {
      five_hour: { utilization: 16, resets_at: '2026-09-23T09:39:59.863606+00:00' },
      seven_day: { utilization: 11, resets_at: '2026-09-29T03:59:59.863632+00:00' },
      seven_day_opus: null,
      nimbus_quill: { utilization: 0, resets_at: null },
    },
  };
  assert.deepEqual(
    claudeCachedQuota(cache).map((w) => [w.limit, w.minutes, w.used, w.at]),
    [
      ['claude', 300, 16, '2026-09-23T08:06:49.945Z'],
      ['claude', WEEK, 11, '2026-09-23T08:06:49.945Z'],
    ]
  );
  assert.deepEqual(claudeCachedQuota(undefined), []);
});

// ── ce qu'une fenêtre garde ─────────────────────────────────────────────────

const reading = (used, at, extra = {}) => ({
  limit: 'codex',
  minutes: WEEK,
  resetsAt: END,
  used,
  reached: used >= 100,
  at,
  lastAt: at,
  plan: 'plus',
  credits: null,
  ...extra,
});

test('la fin qui bouge d’une seconde est la même fenêtre ; plus loin, c’en est une autre', () => {
  const windows = addReadings(
    [],
    [
      reading(10, '2026-09-10T00:00:00Z'),
      reading(12, '2026-09-10T01:00:00Z', { resetsAt: END + 1 }),
      reading(3, '2026-09-18T00:00:00Z', { resetsAt: END + WINDOW_SLACK + 3600 }),
    ]
  );
  assert.equal(windows.length, 2);
  assert.equal(windows[0].used, 12);
});

test('une fenêtre garde son plus haut relevé, daté de la première fois qu’il a été vu', () => {
  const [w] = addReadings(
    [],
    [
      reading(95, '2026-09-05T21:42:00Z'),
      // Une duplication recopie un vieux relevé sous sa propre date.
      reading(0, '2026-09-07T13:55:00Z'),
      reading(95, '2026-09-07T13:55:01Z'),
    ]
  );
  assert.equal(w.used, 95, 'la copie ne fait pas redescendre la fenêtre');
  assert.equal(w.at, '2026-09-05T21:42:00Z', 'ni ne la rajeunit');
});

test('passé 100 %, les crédits sont ceux du dernier relevé', () => {
  const credit = (balance) => ({ has: true, unlimited: false, balance });
  const [w] = addReadings(
    [],
    [
      reading(100, '2026-09-13T12:24:00Z', { credits: credit(260.2) }),
      reading(100, '2026-09-14T21:15:43Z', { credits: credit(123.27) }),
      reading(64, '2026-09-15T00:00:00Z', { credits: credit(500) }),
    ]
  );
  assert.equal(
    w.credits.balance,
    123.27,
    'pas le premier à 100 %, ni un relevé plus bas venu d’ailleurs'
  );
  assert.equal(w.at, '2026-09-13T12:24:00Z');
  assert.equal(w.lastAt, '2026-09-14T21:15:43Z');
});

// ── de bout en bout ─────────────────────────────────────────────────────────

function setup(t) {
  resetCounters();
  const fx = createFixture();
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    fx.cleanup();
  });
  const run = (adapters) => new Indexer(index, { env: fx.env, adapters }).run();
  return { fx, index, run };
}

/** Un `token_count` qui porte ses limites, avec ou sans compte de jetons. */
const counted = (at, used, { info = true, total = used, end = END } = {}) => ({
  timestamp: at,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: info
      ? {
          total_token_usage: { input_tokens: total, output_tokens: 1 },
          last_token_usage: { input_tokens: total, output_tokens: 1 },
        }
      : null,
    rate_limits: limits(win(WEEK, used, end)),
  },
});

test('Codex : des milliers de relevés deviennent une fenêtre, et une passe de plus ne change rien', async (t) => {
  const { fx, index, run } = setup(t);
  const id = '55555555-5555-4555-8555-555555555555';
  const earlier = END - 7 * 86400;
  fx.codex().session(id, [
    cdx.meta('/home/zam/demo', id),
    // Sans compte de jetons, et seul à lire la semaine d'avant.
    counted('2026-09-06T10:00:00.000Z', 90, { info: false, end: earlier }),
    cdx.message('user', 'encore'),
    counted('2026-09-13T12:24:00.000Z', 64, { total: 500 }),
    // Le même compte répété : il n'est pas recompté, ses limites sont lues.
    counted('2026-09-13T12:30:00.000Z', 100, { total: 500 }),
  ]);

  await run([codexAdapter]);
  const first = index.quotas();
  assert.deepEqual(
    first.map((w) => [w.agentId, w.limit, w.minutes, w.used, w.at]),
    [
      ['codex', 'codex', WEEK, 90, '2026-09-06T10:00:00.000Z'],
      ['codex', 'codex', WEEK, 100, '2026-09-13T12:30:00.000Z'],
    ]
  );

  // Tout relire depuis le début : les mêmes relevés, fondus dans les mêmes fenêtres.
  index.db.exec('DELETE FROM sources');
  await run([codexAdapter]);
  assert.deepEqual(index.quotas(), first);
});

test('Claude : les requêtes refusées et le relevé en cache se retrouvent dans la même fenêtre', async (t) => {
  const { fx, index, run } = setup(t);
  const refused = records.assistantText('You’ve hit your limit · resets 3pm', {
    isApiErrorMessage: true,
    apiErrorStatus: 429,
    timestamp: '2026-09-23T08:00:00.000Z',
    quotaLimits: { status: 'rejected', resetsAt: 1790156400, rateLimitType: 'five_hour' },
  });
  fx.project('-p', { originalPath: '/p' }).session('s1', [
    records.userText('la question'),
    refused,
  ]);
  fs.writeFileSync(
    path.join(fx.root, '.claude.json'),
    JSON.stringify({
      numStartups: 3,
      cachedUsageUtilization: {
        fetchedAtMs: Date.parse('2026-09-23T08:06:49.945Z'),
        utilization: {
          five_hour: { utilization: 16, resets_at: '2026-09-23T09:40:00+00:00' },
          seven_day: { utilization: 11, resets_at: '2026-09-29T04:00:00+00:00' },
        },
      },
    })
  );

  await run([claudeAdapter]);
  const windows = index.quotas().map((w) => [w.minutes, w.used, w.reached]);
  assert.deepEqual(
    windows,
    [
      [300, 16, true],
      [WEEK, 11, false],
    ],
    'le pourcentage du cache, et « atteinte » de la requête refusée'
  );
});

test('le masquage d’un assistant et la période s’appliquent aux limites aussi', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.recordQuotas('codex', 'codex:a', [reading(40, '2026-09-01T00:00:00Z')]);
  index.recordQuotas('claude', 'claude:b', [
    { ...reading(16, '2026-09-23T08:06:49Z'), limit: 'claude', minutes: 300, resetsAt: END },
  ]);
  assert.equal(index.quotas().length, 2);
  assert.deepEqual(
    index.quotas({ hidden: ['codex'] }).map((w) => w.agentId),
    ['claude']
  );
  assert.deepEqual(
    index.quotas({ since: '2026-09-20T00:00:00.000Z' }).map((w) => w.agentId),
    ['claude']
  );
});

test('oublier une conversation garde le relevé, qui ne contient aucun mot', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.upsertAgent('codex', 'Codex', '/root');
  index.upsertSession({ id: 'codex:a', agent_id: 'codex', folder_id: index.folderId('/p') });
  index.recordQuotas('codex', 'codex:a', [reading(40, '2026-09-01T00:00:00Z')]);
  index.forgetSession('codex:a');
  assert.equal(index.quotas().length, 1);
  assert.equal(
    index.db.prepare('SELECT session_id FROM quota_windows').get().session_id,
    null,
    'seul le lien vers la conversation part'
  );
});
