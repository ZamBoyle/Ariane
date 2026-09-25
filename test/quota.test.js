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
  claudeDesktopQuota,
  claudeWeekAnchor,
  addReadings,
  WINDOW_SLACK,
} = require('../src/core/quota');
const paths = require('../src/core/paths');
const Database = require('better-sqlite3');
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

// ── l'historique de Claude Desktop ──────────────────────────────────────────

const TUESDAY = Date.parse('2026-09-29T03:59:59.863Z') / 1000; // la fin de semaine du cache
const ORG = '8cb13986-3579-4c77-a57e-beb7cd3b05eb';
const sample = (iso, fh, sd, org = ORG) => ({ t: Date.parse(iso), org, u: { fh, sd } });

test('Claude Desktop : chaque relevé va à la semaine que la frontière du cache découpe', () => {
  const history = {
    version: 2,
    samples: [
      sample('2026-09-21T22:49:00Z', 40, 73),
      sample('2026-09-22T16:34:00Z', 5, 4), // la semaine a été remise à zéro mardi à 03:59
      sample('2026-09-25T15:34:00Z', 25, 27),
      sample('2026-09-25T15:49:00Z', 26, 27),
    ],
  };
  const weeks = claudeDesktopQuota(history, { weekEnd: TUESDAY, org: ORG });
  assert.deepEqual(
    weeks.map((w) => [new Date(w.resetsAt * 1000).toISOString().slice(0, 10), w.used, w.minutes]),
    [
      ['2026-09-22', 73, WEEK],
      ['2026-09-29', 27, WEEK],
    ],
    'deux semaines, chacune à son plus haut ; la fenêtre de 5 h n’est pas devinée'
  );
  assert.equal(weeks[1].at, '2026-09-25T15:34:00.000Z', 'le plus haut, vu la première fois');
  assert.equal(weeks[1].lastAt, '2026-09-25T15:49:00.000Z');
});

test('Claude Desktop : sans frontière connue, sans bonne version, rien n’est deviné', () => {
  const history = { version: 2, samples: [sample('2026-09-25T15:34:00Z', 25, 27)] };
  assert.deepEqual(claudeDesktopQuota(history, { weekEnd: null }), []);
  assert.deepEqual(claudeDesktopQuota({ ...history, version: 3 }, { weekEnd: TUESDAY }), []);
  assert.deepEqual(claudeDesktopQuota(null, { weekEnd: TUESDAY }), []);
});

test('Claude Desktop : seulement le compte dans lequel Claude Code est connecté', () => {
  const history = {
    version: 2,
    samples: [
      sample('2026-09-25T15:34:00Z', 25, 27),
      sample('2026-09-25T15:40:00Z', 90, 88, 'autre-org'),
    ],
  };
  assert.deepEqual(
    claudeDesktopQuota(history, { weekEnd: TUESDAY, org: ORG }).map((w) => w.used),
    [27]
  );
  assert.deepEqual(
    claudeWeekAnchor({
      oauthAccount: { organizationUuid: ORG },
      cachedUsageUtilization: {
        utilization: {
          seven_day: { utilization: 11, resets_at: '2026-09-29T03:59:59.863632+00:00' },
        },
      },
    }),
    { weekEnd: TUESDAY, org: ORG }
  );
});

test('le dossier de Claude Desktop, sur chacun des trois systèmes', () => {
  const home = '/home/ada';
  assert.equal(paths.desktopDir({}, home, 'linux'), path.join(home, '.config', 'Claude'));
  assert.equal(
    paths.desktopDir({ XDG_CONFIG_HOME: '/x' }, home, 'linux'),
    path.join('/x', 'Claude')
  );
  assert.equal(
    paths.desktopDir({}, home, 'darwin'),
    path.join(home, 'Library', 'Application Support', 'Claude')
  );
  assert.equal(
    paths.desktopDir({ APPDATA: '/roaming' }, home, 'win32'),
    path.join('/roaming', 'Claude')
  );
  assert.equal(
    paths.desktopDir({ CLAUDE_DESKTOP_DIR: '/ailleurs' }, home, 'linux'),
    path.resolve('/ailleurs')
  );
});

test('Claude : les semaines de Claude Desktop, placées par la frontière du cache', async (t) => {
  const { fx, index } = setup(t);
  const desktop = path.join(fx.root, 'claude-desktop');
  fs.mkdirSync(desktop);
  fs.writeFileSync(
    path.join(desktop, 'plan-usage-history.json'),
    JSON.stringify({
      version: 2,
      samples: [sample('2026-09-21T22:49:00Z', 40, 73), sample('2026-09-25T15:34:00Z', 25, 27)],
    })
  );
  fs.writeFileSync(
    path.join(fx.root, '.claude.json'),
    JSON.stringify({
      oauthAccount: { organizationUuid: ORG },
      cachedUsageUtilization: {
        fetchedAtMs: Date.parse('2026-09-23T08:06:49.945Z'),
        utilization: {
          seven_day: { utilization: 11, resets_at: '2026-09-29T03:59:59.863632+00:00' },
        },
      },
    })
  );
  const indexer = new Indexer(index, {
    env: { ...fx.env, CLAUDE_DESKTOP_DIR: desktop },
    adapters: [claudeAdapter],
  });
  await indexer.run();
  assert.deepEqual(
    index.quotas().map((w) => [new Date(w.resetsAt * 1000).toISOString().slice(0, 10), w.used]),
    [
      ['2026-09-22', 73],
      ['2026-09-29', 27],
    ],
    'la semaine en cours prend le relevé du jour (27), pas celui du cache (11)'
  );
});

// ── ce qu'une reconstruction de l'index garde ───────────────────────────────

test('une reconstruction garde les fenêtres que les fichiers n’ont plus, et laisse les fichiers gagner', async (t) => {
  resetCounters();
  const fx = createFixture();
  // Un seul `after` : les bases d'abord, le dossier ensuite (Windows refuse
  // d'effacer un fichier ouvert).
  const opened = [];
  t.after(() => {
    for (const i of opened) {
      try {
        i.close();
      } catch {
        /* déjà fermée */
      }
    }
    fx.cleanup();
  });
  const open = (file) => {
    const i = new Index(file);
    opened.push(i);
    return i;
  };
  const file = path.join(fx.root, 'index.sqlite3');
  const id = '66666666-6666-4666-8666-666666666666';
  fx.codex().session(id, [cdx.meta('/home/zam/demo', id), counted('2026-09-13T12:24:00.000Z', 64)]);

  const before = open(file);
  await new Indexer(before, { env: fx.env, adapters: [codexAdapter] }).run();
  // Deux fenêtres qu'aucun fichier ne redonnera — un mois de Claude Desktop
  // est tout ce qu'il garde — et une que le fichier contredit.
  before.recordQuotas('claude', null, [
    { ...reading(73, '2026-08-20T22:49:00Z'), limit: 'claude', resetsAt: END - 4 * 7 * 86400 },
  ]);
  before.db.prepare('UPDATE quota_windows SET used = 99 WHERE agent_id = ?').run('codex');
  before.recordQuotas('codex', null, [
    reading(12, '2026-08-01T00:00:00Z', { resetsAt: END - 8 * 7 * 86400 }),
  ]);
  before.close();

  const raw = new Database(file);
  raw.pragma('user_version = 18');
  raw.close();

  const after = open(file);
  assert.equal(after.quotas().length, 0, 'les tables sont reconstruites');

  await new Indexer(after, { env: fx.env, adapters: [codexAdapter] }).run();
  const codexWindows = after.quotas().filter((w) => w.agentId === 'codex');
  assert.deepEqual(
    codexWindows.map((w) => w.used),
    [12, 64],
    'la semaine du 1er août revient ; celle que le fichier redonne dit 64, pas le 99 d’avant'
  );
  assert.equal(
    after.quotas().filter((w) => w.agentId === 'claude').length,
    0,
    'Claude attend une passe qui lit Claude'
  );

  await new Indexer(after, { env: fx.env, adapters: [claudeAdapter] }).run();
  assert.deepEqual(
    after
      .quotas()
      .filter((w) => w.agentId === 'claude')
      .map((w) => w.used),
    [73]
  );
  assert.equal(after.meta('quotaWindowsCarried'), null, 'plus rien n’attend');
});

// ── ce qu'a coûté une conversation, pour son en-tête ────────────────────────

test('l’en-tête reçoit les sommes de la barre latérale : copies à part, sous-agents à part, rien n’est zéro', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.upsertAgent('claude', 'Claude Code', '/root');
  const folder = index.folderId('/p');
  const said = (uuid, usage) => ({
    role: 'assistant',
    uuid,
    timestamp: '2026-09-25T10:00:00Z',
    text: uuid,
    parts: [],
    usage,
  });
  index.upsertSession({ id: 'claude:a', agent_id: 'claude', folder_id: folder });
  index.addMessages('claude:a', [
    said('r1', { input: 10, output: 100, cacheRead: 1000, cacheWrite: 50, reasoning: null }),
    said('r2', { input: 5, output: 20, cacheRead: 2000, cacheWrite: 0, reasoning: null }),
  ]);
  index.db.prepare("UPDATE messages SET is_copy = 1 WHERE uuid = 'r2'").run();
  index.upsertSession({
    id: 'claude:sub',
    agent_id: 'claude',
    folder_id: folder,
    parent_id: 'claude:a',
  });
  index.addMessages('claude:sub', [
    said('s1', { input: 1, output: 7, cacheRead: 9, cacheWrite: 3, reasoning: null }),
  ]);
  index.upsertSession({ id: 'claude:rien', agent_id: 'claude', folder_id: folder });
  index.addMessages('claude:rien', [said('x', null)]);

  const a = index.sessionTokens('claude:a');
  assert.deepEqual(
    [a.tokInput, a.tokOutput, a.tokCacheRead, a.tokCacheWrite],
    [10, 100, 1000, 50],
    'la réponse recopiée compte là d’où elle vient'
  );
  assert.deepEqual([a.subagents, a.subOutput], [1, 7], 'les sous-agents, à part');
  const rien = index.sessionTokens('claude:rien');
  assert.equal(rien.tokOutput, null, 'rien mesuré, pas zéro');
  assert.equal(rien.subagents, 0);
});
