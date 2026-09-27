'use strict';

/**
 * Ce qu'un appel a renvoyé : la part de son prompt qu'un appel précédent avait
 * déjà envoyée, et que le cache ne tenait plus (contract.js, « What was sent
 * again »). Mesuré le 26 septembre 2026 sur une conversation Claude de cinq
 * jours : 14 934 947 jetons envoyés, dont 9 714 414 renvoyés après une pause
 * ou un changement de modèle — lus naïvement, dix-huit compactages ; il y en
 * avait cinq.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { withResent } = require('../src/core/agents/contract');
const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const { Archive } = require('../src/core/archive');
const claudeAdapter = require('../src/core/agents/claude');
const codexAdapter = require('../src/core/agents/codex');
const geminiAdapter = require('../src/core/agents/gemini');
const { createFixture, records, cdx, gem, resetCounters } = require('./helpers/fixture');

const collect = async (iterable) => {
  const out = [];
  for await (const value of iterable) out.push(value);
  return out;
};

// ── la règle ──────────────────────────────────────────────────────────────

test('le premier appel n’a rien renvoyé : rien ne l’a précédé', () => {
  const { usage, previous } = withResent({ input: 6, cacheWrite: 31705, cacheRead: 0 }, null);
  assert.equal(usage.resent, 0, 'rien avant lui, rien de renvoyé');
  assert.equal(previous, 31711, 'le prompt suivant se compare à celui-ci, entier');
});

test('un cache encore là : tout l’ancien prompt est relu, rien n’est renvoyé', () => {
  const { usage } = withResent({ input: 1, cacheWrite: 240, cacheRead: 31711 }, 31711);
  assert.equal(usage.resent, 0, 'seul le nouveau est envoyé');
});

test('un cache perdu : l’ancien prompt est renvoyé, et seulement lui', () => {
  const { usage } = withResent({ input: 2, cacheWrite: 32100, cacheRead: 0 }, 31952);
  assert.equal(usage.resent, 31952, 'l’ancien prompt entier, pas les 150 jetons nouveaux');
});

test('un cache perdu en partie : seule la part qui n’a pas été relue', () => {
  const { usage } = withResent({ input: 2, cacheWrite: 20000, cacheRead: 12000 }, 31952);
  assert.equal(usage.resent, 19952, 'l’ancien prompt moins ce que le cache a encore servi');
});

test('jamais plus que ce que l’appel a envoyé', () => {
  const { usage } = withResent({ input: 0, cacheWrite: 800, cacheRead: 0 }, 31952);
  assert.equal(usage.resent, 800, 'un appel ne renvoie pas plus qu’il n’envoie');
});

test('un appel qui n’a rien envoyé ne change pas le prompt de référence', () => {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, resent: null };
  const { usage, previous } = withResent(zero, 31711);
  assert.equal(previous, 31711, 'une ligne du harnais à zéro n’est pas un appel');
  assert.equal(usage.resent, null, 'et elle ne prétend rien avoir mesuré');
  assert.deepEqual(withResent(null, 5), { usage: null, previous: 5 });
});

// ── Claude ────────────────────────────────────────────────────────────────

/** Une ligne de réponse de l'API, comme Claude Code l'écrit. */
function reply(id, usage, extra = {}) {
  return records.assistantText('ok', {
    ...extra,
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      id,
      usage,
      content: [{ type: 'text', text: 'ok' }],
    },
  });
}
const apiUsage = (input, write, read, output = 10) => ({
  input_tokens: input,
  cache_creation_input_tokens: write,
  cache_read_input_tokens: read,
  output_tokens: output,
});
// Un premier appel, un appel dont le cache tenait, puis un appel après une pause.
const first = () => reply('msg_A', apiUsage(6, 31705, 0));
const warm = () => reply('msg_B', apiUsage(1, 240, 31711));
const afterPause = () => reply('msg_C', apiUsage(2, 32100, 0));
const boundary = () => ({
  type: 'system',
  subtype: 'compact_boundary',
  content: 'Conversation compacted',
  uuid: `b-${Math.random()}`,
  timestamp: '2026-09-23T21:05:48.136Z',
  cwd: '/home/zam/demo',
});

function claudeSetup(t) {
  resetCounters();
  const fx = createFixture();
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    fx.cleanup();
  });
  const run = () => new Indexer(index, { env: fx.env, adapters: [claudeAdapter] }).run();
  const sums = () => index.sessionTokens(index.sessions(index.folders()[0].id)[0].id);
  const project = fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' });
  return { index, run, sums, project };
}

test('Claude : après une pause, le contexte renvoyé est compté à part', async (t) => {
  const { run, sums, project } = claudeSetup(t);
  project.session('s1', [records.userText('q'), first(), warm(), afterPause()]);
  await run();
  const s = sums();
  assert.equal(s.tokResent, 31952, 'le prompt de msg_B entier, renvoyé par msg_C');
  assert.equal(
    s.tokInput + s.tokCacheWrite,
    6 + 31705 + 1 + 240 + 2 + 32100,
    'les envoyés restent entiers'
  );
});

test('Claude : un compactage remplace le contexte, rien n’y est renvoyé', async (t) => {
  const { run, sums, project } = claudeSetup(t);
  project.session('s1', [
    records.userText('q'),
    first(),
    boundary(),
    reply('msg_D', apiUsage(2, 5000, 0)),
  ]);
  await run();
  assert.equal(sums().tokResent, 0, 'le résumé est neuf : ce n’est pas l’ancien contexte');
  assert.equal(sums().compactions, 1, 'et le compactage est compté');
});

test('Claude : une lecture reprise entre deux appels sait ce que le précédent avait envoyé', async (t) => {
  const { run, sums, project } = claudeSetup(t);
  project.session('s1', [records.userText('q'), first(), warm()]);
  await run();
  project.append('s1', [afterPause()]);
  await run();
  assert.equal(sums().tokResent, 31952, 'le curseur portait le prompt du dernier appel');
});

test('Claude : une ligne à zéro écrite par le harnais ne remet pas le compte à zéro', async (t) => {
  const { run, sums, project } = claudeSetup(t);
  project.session('s1', [
    records.userText('q'),
    first(),
    reply('msg_Z', apiUsage(0, 0, 0, 0)),
    reply('msg_E', apiUsage(2, 32000, 0)),
  ]);
  await run();
  assert.equal(sums().tokResent, 31711, 'comparé au dernier vrai appel, pas à la ligne vide');
});

test('Claude : les appels d’un sous-agent mêlés à la transcription ne sont pas comparés aux siens', async (t) => {
  const { index, run, sums, project } = claudeSetup(t);
  project.session('s1', [
    records.userText('q'),
    first(),
    reply('msg_S', apiUsage(1, 500, 0), { isSidechain: true }),
    reply('msg_E', apiUsage(2, 32000, 0)),
  ]);
  await run();
  assert.equal(sums().tokResent, 31711, 'msg_E se compare à msg_A, pas au sous-agent');
  const [session] = index.sessions(index.folders()[0].id);
  const side = index.messages(session.id).find((m) => m.isSidechain && m.usage);
  assert.equal(side.usage.resent, null, 'un autre contexte : rien de mesuré, pas zéro');
});

// ── Codex ─────────────────────────────────────────────────────────────────

/** Les comptes de Codex : son input COMPREND ce que le cache a servi. */
const counts = (input, cached, output) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: 0,
  total_tokens: input + output,
});
const T1 = counts(1000, 0, 10);
const T2 = counts(2100, 1000, 20);
const T3 = counts(3300, 1000, 30);
const resentOf = (chunks) =>
  chunks
    .map((c) => c.item)
    .filter((i) => i.kind === 'usage')
    .map((i) => i.usage.resent);

function codexSetup(t) {
  resetCounters();
  const fx = createFixture();
  t.after(() => fx.cleanup());
  return { fx, ctx: { env: fx.env } };
}

test('Codex : un cache perdu renvoie le prompt précédent', async (t) => {
  const { fx, ctx } = codexSetup(t);
  fx.codex().session('11111111-2222-4333-8444-555555555555', [
    cdx.meta('/p'),
    cdx.message('assistant', 'r1'),
    cdx.tokenCount(T1),
    cdx.message('assistant', 'r2'),
    cdx.tokenCount(T2, counts(1100, 1000, 10)),
    cdx.message('assistant', 'r3'),
    cdx.tokenCount(T3, counts(1200, 0, 10)),
  ]);
  const [d] = await collect(codexAdapter.discover(ctx));
  assert.deepEqual(
    resentOf(await collect(codexAdapter.read(d, { cursor: null }))),
    [0, 0, 1100],
    'le troisième appel renvoie les 1 100 jetons du deuxième'
  );
});

test('Codex : un compactage remplace le contexte, rien n’y est renvoyé', async (t) => {
  const { fx, ctx } = codexSetup(t);
  fx.codex().session('11111111-2222-4333-8444-666666666666', [
    cdx.meta('/p'),
    cdx.message('assistant', 'r1'),
    cdx.tokenCount(T1),
    cdx.compacted([]),
    cdx.message('assistant', 'r2'),
    cdx.tokenCount(counts(1300, 0, 20), counts(300, 0, 10)),
  ]);
  const [d] = await collect(codexAdapter.discover(ctx));
  assert.deepEqual(resentOf(await collect(codexAdapter.read(d, { cursor: null }))), [0, 0]);
});

test('Codex : une lecture reprise sait ce que le dernier appel avait envoyé', async (t) => {
  const { fx, ctx } = codexSetup(t);
  const id = '11111111-2222-4333-8444-777777777777';
  const tree = fx.codex();
  tree.session(id, [
    cdx.meta('/p'),
    cdx.message('assistant', 'r1'),
    cdx.tokenCount(T1),
    cdx.message('assistant', 'r2'),
    cdx.tokenCount(T2, counts(1100, 1000, 10)),
  ]);
  const [d1] = await collect(codexAdapter.discover(ctx));
  const cursor = (await collect(codexAdapter.read(d1, { cursor: null }))).at(-1).cursor;

  tree.append(id, [cdx.message('assistant', 'r3'), cdx.tokenCount(T3, counts(1200, 0, 10))]);
  const [d2] = await collect(codexAdapter.discover(ctx));
  assert.equal(codexAdapter.canResume(d2, cursor), true);
  assert.deepEqual(
    resentOf(await collect(codexAdapter.read(d2, { cursor }))),
    [1100],
    'le curseur portait le prompt du deuxième appel'
  );
});

// ── Gemini ────────────────────────────────────────────────────────────────

test('Gemini : chaque réponse est comparée à celle d’avant', async (t) => {
  resetCounters();
  const fx = createFixture();
  t.after(() => fx.cleanup());
  const tokens = (input, cached) => ({ input, cached, output: 10, thoughts: 0, tool: 0 });
  fx.gemini()
    .projectRoot('p', '/p')
    .log('p', 'cccc3333', [
      gem.set([
        gem.user('q'),
        gem.model('r1', { tokens: tokens(1000, 0) }),
        gem.model('r2', { tokens: tokens(1100, 1000) }),
        gem.model('r3', { tokens: tokens(1200, 0) }),
      ]),
    ]);
  const [d] = await collect(geminiAdapter.discover({ env: fx.env }));
  const items = (await collect(geminiAdapter.read(d))).map((c) => c.item);
  assert.deepEqual(
    items.filter((i) => i.usage).map((i) => i.usage.resent),
    [0, 0, 1100]
  );
});

// ── l'archive ─────────────────────────────────────────────────────────────

test('une conversation sauvée dans l’archive garde ce qu’elle avait renvoyé', async (t) => {
  resetCounters();
  const fx = createFixture();
  const archive = new Archive(path.join(fx.root, 'ariane-archive'));
  const id = '11111111-2222-4333-8444-888888888888';
  const opened = [];
  t.after(() => {
    for (const index of opened) index.close();
    fx.cleanup();
  });
  const open = () => {
    const index = new Index(':memory:', { archive });
    opened.push(index);
    return index;
  };
  const pass = (index) => new Indexer(index, { env: fx.env, archive }).run();

  fx.codex().session(id, [
    cdx.meta('/q', id),
    cdx.message('user', 'bonjour'),
    cdx.message('assistant', 'r1'),
    cdx.tokenCount(T1),
    cdx.message('assistant', 'r2'),
    cdx.tokenCount(counts(2200, 0, 20), counts(1200, 0, 10)),
  ]);
  const before = open();
  await pass(before);
  assert.equal(before.sessionTokens(`codex:${id}`).tokResent, 1000);

  // Le fichier disparaît : la passe suivante le sauve, puis l'index est reconstruit.
  const rollout = fs
    .readdirSync(fx.env.CODEX_HOME, { recursive: true })
    .map((name) => path.join(fx.env.CODEX_HOME, name))
    .find((file) => file.includes(id));
  fs.rmSync(rollout);
  await pass(before);
  const rebuilt = open();
  await pass(rebuilt);
  assert.equal(rebuilt.session(`codex:${id}`).source, 'archive');
  assert.equal(
    rebuilt.sessionTokens(`codex:${id}`).tokResent,
    1000,
    'la colonne voyage avec la conversation, sinon l’écran ne saurait plus la partager'
  );
});

// ── combien de fois compactée ─────────────────────────────────────────────

test('Codex : un compactage est gardé comme avis, et compté comme celui de Claude', async (t) => {
  resetCounters();
  const fx = createFixture();
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    fx.cleanup();
  });
  const id = '11111111-2222-4333-8444-999999999999';
  fx.codex().session(id, [
    cdx.meta('/p', id),
    cdx.message('user', 'bonjour'),
    cdx.message('assistant', 'r1'),
    cdx.compacted([{ role: 'user', content: 'ancien texte rejoué' }]),
    cdx.message('assistant', 'r2'),
  ]);
  await new Indexer(index, { env: fx.env, adapters: [codexAdapter] }).run();
  const messages = index.messages(`codex:${id}`);
  const notice = messages.find((m) => m.isNotice);
  assert.deepEqual(notice && notice.command, { name: 'compact-boundary', args: '' });
  assert.ok(
    !messages.some((m) => m.text.includes('ancien texte rejoué')),
    'ce que le compactage rejoue n’est toujours pas lu'
  );
  assert.equal(index.sessionTokens(`codex:${id}`).compactions, 1);
  assert.equal(codexAdapter.writesCompactions, true);
  assert.equal(claudeAdapter.writesCompactions, true);
  assert.ok(
    !geminiAdapter.writesCompactions,
    'Gemini n’écrit aucun compactage qu’Ariane connaisse'
  );
});

// ── ce qui est revenu ─────────────────────────────────────────────────────

test('le raisonnement se somme, et une réponse qui ne l’a pas compté est signalée', async (t) => {
  const { run, sums, project } = claudeSetup(t);
  const thinking = (id, output, reasoning) =>
    reply(id, {
      ...apiUsage(1, 100, 0, output),
      output_tokens_details: { thinking_tokens: reasoning },
    });
  project.session('s1', [
    records.userText('q'),
    thinking('msg_A', 300, 200),
    thinking('msg_B', 50, 0),
    // Une ligne du harnais à zéro : rien reçu, donc rien de raisonné non plus.
    reply('msg_Z', apiUsage(0, 0, 0, 0)),
  ]);
  await run();
  assert.equal(sums().tokReasoning, 200);
  assert.equal(sums().reasoningMissing, 0, 'chaque réponse l’a compté, zéro compris');

  // Avant août 2026, Claude n'écrivait aucun compte de raisonnement.
  project.append('s1', [reply('msg_C', apiUsage(1, 100, 400, 80))]);
  await run();
  assert.equal(
    sums().reasoningMissing,
    1,
    'une réponse muette sur son raisonnement : on ne partage pas'
  );
});
