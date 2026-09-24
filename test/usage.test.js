'use strict';

/**
 * Ce que coûte un tour, et ce que l'application refuse d'inventer.
 *
 * Quatre assistants sur sept enregistrent des jetons, chacun avec ses mots ;
 * le dictionnaire et la définition de chaque champ vivent dans
 * `src/core/agents/contract.js`. Ce fichier garde la règle qui décide de tout
 * le reste : une absence n'est pas un zéro.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { usageOf, USAGE_FIELDS } = require('../src/core/agents/contract');
const { extractRecord } = require('../src/core/extract');
const { Index } = require('../src/core/db');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-usage-'));
  return path.join(dir, 'index.sqlite3');
}

/** Un index prêt à recevoir une session, comme l'indexeur le ferait. */
function indexWithSession(t) {
  const index = new Index(tmpDb());
  t.after(() => index.close());
  index.upsertAgent('claude', 'Claude Code', '/root');
  index.upsertSession({
    id: 'claude:s1',
    agent_id: 'claude',
    folder_id: index.folderId('/home/ada/projets/tardis'),
  });
  return index;
}

// ── le contrat ────────────────────────────────────────────────────────────

test('un agent qui n a rien mesuré ne rend pas un objet de nulls', () => {
  assert.equal(usageOf({}), null, "rien d'enregistré doit valoir null, pas cinq null");
  assert.equal(usageOf(null), null, 'une absence de source vaut null');
  assert.equal(usageOf({ input: 'beaucoup' }), null, 'un texte n est pas une mesure');
  assert.equal(usageOf({ input: -3 }), null, 'un compte négatif n est pas une mesure');
});

test('un zéro mesuré reste un zéro, jamais une absence', () => {
  const usage = usageOf({ input: 0 });
  assert.notEqual(usage, null, 'zéro est une mesure : elle doit survivre');
  assert.equal(usage.input, 0, 'le zéro mesuré est conservé tel quel');
  assert.equal(usage.output, null, "ce que l'agent n a pas dit reste null");
});

test('les cinq champs canoniques, et pas un de plus', () => {
  const usage = usageOf({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 5 });
  assert.deepEqual(Object.keys(usage), USAGE_FIELDS, 'la forme est celle du contrat');
});

// ── l'adaptateur Claude ───────────────────────────────────────────────────

test('Claude : usage traduit dans les mots du contrat', () => {
  const item = extractRecord({
    type: 'assistant',
    uuid: 'u1',
    sessionId: 's1',
    timestamp: '2026-09-21T20:00:00.000Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'bonjour' }],
      usage: {
        input_tokens: 2,
        output_tokens: 3421,
        cache_read_input_tokens: 24641,
        cache_creation_input_tokens: 36019,
        output_tokens_details: { thinking_tokens: 2741 },
      },
    },
  });

  assert.deepEqual(
    item.usage,
    { input: 2, output: 3421, cacheRead: 24641, cacheWrite: 36019, reasoning: 2741 },
    'les cinq champs viennent des cinq bons endroits'
  );
  assert.equal(item.model, 'claude-opus-5', 'le modèle voyage avec le coût');
});

test('Claude : un tour sans usage ne fabrique rien', () => {
  const item = extractRecord({
    type: 'assistant',
    uuid: 'u2',
    sessionId: 's1',
    timestamp: '2026-09-21T20:00:00.000Z',
    message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'ok' }] },
  });
  assert.equal(item.usage, null, 'aucun usage enregistré, aucun usage inventé');
});

test('un message de la personne ne porte jamais de coût', () => {
  const item = extractRecord({
    type: 'user',
    uuid: 'u3',
    sessionId: 's1',
    timestamp: '2026-09-21T20:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'et voilà' }] },
  });
  assert.equal(item.usage, null, "ce que la personne a tapé n'a pas coûté de jetons");
});

// ── l'aller-retour par l'index ────────────────────────────────────────────

test('un usage stocké revient identique', (t) => {
  const index = indexWithSession(t);
  const usage = { input: 2, output: 3421, cacheRead: 24641, cacheWrite: 36019, reasoning: 2741 };

  index.addMessages('claude:s1', [
    { role: 'assistant', uuid: 'a', text: 'avec', parts: [], model: 'claude-opus-5', usage },
  ]);

  const [message] = index.messages('claude:s1');
  assert.deepEqual(message.usage, usage, 'les cinq comptes traversent la base sans bouger');
});

test('un message sans usage revient avec null, pas avec des zéros', (t) => {
  const index = indexWithSession(t);
  index.addMessages('claude:s1', [{ role: 'user', uuid: 'b', text: 'sans', parts: [] }]);

  const [message] = index.messages('claude:s1');
  assert.equal(message.usage, null, 'une absence en base doit rester une absence à la lecture');
});

test('un zéro mesuré survit à la base', (t) => {
  const index = indexWithSession(t);
  index.addMessages('claude:s1', [
    { role: 'assistant', uuid: 'c', text: 'gratuit', parts: [], usage: usageOf({ output: 0 }) },
  ]);

  const [message] = index.messages('claude:s1');
  assert.notEqual(message.usage, null, 'un zéro mesuré n est pas une absence');
  assert.equal(message.usage.output, 0, 'le zéro est relu comme un zéro');
  assert.equal(message.usage.input, null, 'et le reste, jamais mesuré, reste null');
});

// ── ce qu'une conversation a coûté, sous son nom ──────────────────────────

test('la liste d’un dossier additionne les jetons de chaque conversation', (t) => {
  const index = indexWithSession(t);
  index.addMessages('claude:s1', [
    { role: 'user', uuid: 'q', text: 'question', parts: [] },
    {
      role: 'assistant',
      uuid: 'r1',
      text: 'un',
      parts: [],
      usage: usageOf({ input: 2, output: 100, cacheRead: 5000, cacheWrite: 700 }),
    },
    {
      role: 'assistant',
      uuid: 'r2',
      text: 'deux',
      parts: [],
      usage: usageOf({ input: 3, output: 50, cacheRead: 6000, cacheWrite: 0 }),
    },
  ]);

  const [session] = index.sessions(index.folderId('/home/ada/projets/tardis'));
  assert.equal(session.tokInput, 5, 'la question de la personne ne compte pas, les deux tours oui');
  assert.equal(session.tokOutput, 150);
  assert.equal(session.tokCacheRead, 11000);
  assert.equal(session.tokCacheWrite, 700, 'un zéro mesuré s’additionne comme un zéro');
});

test('une conversation que son agent n’a pas mesurée revient avec des null', (t) => {
  const index = indexWithSession(t);
  index.addMessages('claude:s1', [
    { role: 'assistant', uuid: 'x', text: 'sans compte', parts: [] },
  ]);

  const [session] = index.sessions(index.folderId('/home/ada/projets/tardis'));
  for (const field of ['tokInput', 'tokOutput', 'tokCacheRead', 'tokCacheWrite']) {
    assert.equal(session[field], null, `${field} : rien de mesuré ne devient pas zéro`);
  }
});

test('les sommes ne débordent pas d’un dossier ni d’une conversation à l’autre', (t) => {
  const index = indexWithSession(t);
  index.upsertAgent('codex', 'Codex', '/root');
  const tardis = index.folderId('/home/ada/projets/tardis');
  index.upsertSession({ id: 'codex:s2', agent_id: 'codex', folder_id: tardis });
  index.upsertSession({
    id: 'claude:ailleurs',
    agent_id: 'claude',
    folder_id: index.folderId('/ailleurs'),
  });
  index.addMessages('claude:s1', [
    { role: 'assistant', uuid: 'a', text: 'ici', parts: [], usage: usageOf({ output: 10 }) },
  ]);
  index.addMessages('claude:ailleurs', [
    { role: 'assistant', uuid: 'b', text: 'là-bas', parts: [], usage: usageOf({ output: 999 }) },
  ]);

  const byId = Object.fromEntries(index.sessions(tardis).map((s) => [s.id, s]));
  assert.equal(byId['claude:s1'].tokOutput, 10, 'seuls ses propres messages');
  assert.equal(
    byId['codex:s2'].tokOutput,
    null,
    'une conversation sans message mesuré reste à null'
  );

  // Les assistants masqués passent par une autre requête : elle doit porter les mêmes sommes.
  const visible = index.sessions(tardis, ['codex']);
  assert.deepEqual(
    visible.map((s) => [s.id, s.tokOutput]),
    [['claude:s1', 10]],
    'masquer un assistant retire ses lignes sans perdre les jetons des autres'
  );
});

// ── une réponse de Claude, plusieurs lignes, un seul compte ───────────────
//
// Claude Code écrit une réponse en plusieurs lignes — sa réflexion, son texte,
// chaque appel d'outil — et CHAQUE ligne répète l'usage de la réponse. Ariane
// 0.3.3 les additionnait toutes : 2,26 fois trop en moyenne sur un vrai corpus.

const { Indexer } = require('../src/core/indexer');
const { Archive, withoutRepeatedUsage } = require('../src/core/archive');
const claudeAdapter = require('../src/core/agents/claude');
const { createFixture, records, resetCounters } = require('./helpers/fixture');

/** Une ligne d'une réponse de l'API : même id et même usage pour toutes ses lignes. */
function replyLine(id, usage, block) {
  return records.assistantText('', {
    message: { role: 'assistant', model: 'claude-opus-5', id, usage, content: [block] },
  });
}
const usageA = {
  input_tokens: 6,
  output_tokens: 219,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 31705,
};
const usageB = {
  input_tokens: 1,
  output_tokens: 203,
  cache_read_input_tokens: 31705,
  cache_creation_input_tokens: 240,
};

function claudeSetup(t) {
  resetCounters();
  const fx = createFixture();
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    fx.cleanup();
  });
  const run = () => new Indexer(index, { env: fx.env, adapters: [claudeAdapter] }).run();
  const totals = () => index.sessions(index.folders()[0].id)[0];
  return { fx, index, run, totals };
}

test('Claude : une réponse en trois lignes ne compte qu’une fois', async (t) => {
  const { fx, run, totals } = claudeSetup(t);
  fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' }).session('s1', [
    records.userText('question'),
    replyLine('msg_A', usageA, { type: 'thinking', thinking: 'je réfléchis' }),
    replyLine('msg_A', usageA, { type: 'text', text: 'voici' }),
    replyLine('msg_A', usageA, { type: 'tool_use', id: 't1', name: 'Read', input: {} }),
    replyLine('msg_B', usageB, { type: 'text', text: 'fini' }),
  ]);

  await run();
  const s = totals();
  assert.equal(s.tokOutput, 219 + 203, 'deux réponses, pas quatre lignes');
  assert.equal(s.tokCacheWrite, 31705 + 240);
  assert.equal(s.tokCacheRead, 31705);
});

test('Claude : une lecture reprise entre deux lignes d’une réponse ne la recompte pas', async (t) => {
  const { fx, run, totals } = claudeSetup(t);
  const project = fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' });
  project.session('s1', [
    records.userText('question'),
    replyLine('msg_A', usageA, { type: 'thinking', thinking: 'je réfléchis' }),
  ]);
  await run();

  // La suite de la même réponse arrive après le passage.
  project.append('s1', [replyLine('msg_A', usageA, { type: 'text', text: 'voici' })]);
  await run();

  assert.equal(totals().tokOutput, 219, 'le curseur savait quelle réponse venait d’être comptée');
});

test('archive v1 : une ligne qui répète exactement le compte précédent le perd', () => {
  const row = (role, n) => ({
    role,
    tok_input: n && 1,
    tok_output: n,
    tok_cache_read: n && 5000,
    tok_cache_write: n && 7,
    tok_reasoning: null,
  });
  const out = withoutRepeatedUsage([
    row('assistant', 10),
    row('assistant', 10),
    row('user', null),
    row('assistant', 10),
    row('assistant', 20),
  ]);
  assert.deepEqual(
    out.map((m) => m.tok_output),
    [10, null, null, null, 20],
    'la réponse garde son compte une fois ; une ligne de la personne entre deux ne rompt pas la répétition'
  );
  assert.equal(out[1].tok_input, null, 'les cinq comptes partent ensemble');
});

test('archive v1 : lue, elle est migrée — pour Claude seulement', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-archive-v1-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const archive = new Archive(dir);
  const rows = [
    {
      seq: 0,
      role: 'assistant',
      tok_input: 1,
      tok_output: 10,
      tok_cache_read: 99,
      tok_cache_write: 2,
      tok_reasoning: null,
    },
    {
      seq: 1,
      role: 'assistant',
      tok_input: 1,
      tok_output: 10,
      tok_cache_read: 99,
      tok_cache_write: 2,
      tok_reasoning: null,
    },
  ];
  for (const id of ['claude:ancienne', 'codex:ancienne']) {
    archive.write(id, { id }, rows);
    const file = archive.fileFor(id);
    // Réécrite comme la version 1 l'écrivait.
    const [header, ...body] = fs.readFileSync(file, 'utf8').trim().split('\n');
    fs.writeFileSync(
      file,
      [JSON.stringify({ ...JSON.parse(header), version: 1 }), ...body].join('\n') + '\n'
    );
  }
  assert.deepEqual(
    archive.read(archive.fileFor('claude:ancienne')).messages.map((m) => m.tok_output),
    [10, null]
  );
  assert.deepEqual(
    archive.read(archive.fileFor('codex:ancienne')).messages.map((m) => m.tok_output),
    [10, 10],
    'Codex n’a jamais stocké de comptes avant la correction : rien à défaire'
  );
});

test('la reconstruction de l’index ne sauve pas dans l’archive un compte gonflé', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-rebuild-'));
  // La base d'abord, le dossier ensuite, dans un seul crochet : les `after`
  // s'exécutent dans l'ordre où ils sont enregistrés, et Windows refuse de
  // supprimer un dossier dont la base est encore ouverte.
  let index = null;
  t.after(() => {
    if (index) index.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const archive = new Archive(path.join(dir, 'archive'));
  const file = path.join(dir, 'index.sqlite3');

  const old = new Index(file, { archive });
  old.upsertAgent('claude', 'Claude Code', '/root');
  old.upsertSession({
    id: 'claude:disparue',
    agent_id: 'claude',
    folder_id: old.folderId('/p'),
    file_path: '/nulle/part.jsonl',
  });
  const usage = usageOf({ input: 1, output: 219, cacheRead: 5000, cacheWrite: 7 });
  old.addMessages('claude:disparue', [
    { role: 'assistant', uuid: 'l1', text: '', parts: [], usage },
    { role: 'assistant', uuid: 'l2', text: 'voici', parts: [], usage },
  ]);
  old.db.pragma('user_version = 10'); // un index écrit par la 0.3.3
  old.close();

  index = new Index(file, { archive });
  const saved = archive.read(archive.fileFor('claude:disparue')).messages;
  assert.deepEqual(
    saved.map((m) => m.tok_output),
    [219, null],
    'sauvée une fois, pas deux'
  );
});

// ── les modèles d'une conversation, dans la liste d'un dossier ────────────

test('la liste d’un dossier compte les réponses de chaque modèle', (t) => {
  const index = indexWithSession(t);
  index.addMessages('claude:s1', [
    { role: 'user', uuid: 'q', text: 'question', parts: [], model: '' },
    { role: 'assistant', uuid: 'r1', text: 'un', parts: [], model: 'claude-opus-5' },
    { role: 'assistant', uuid: 'r2', text: 'deux', parts: [], model: 'claude-opus-5' },
    { role: 'assistant', uuid: 'r3', text: 'trois', parts: [], model: 'claude-opus-5-5' },
    // Un appel d'outil seul n'est pas une réponse : l'en-tête ne le compte pas non plus.
    {
      role: 'assistant',
      uuid: 'r4',
      text: '',
      parts: [{ type: 'tool_use', id: 't' }],
      model: 'claude-opus-5-5',
    },
  ]);

  const [session] = index.sessions(index.folderId('/home/ada/projets/tardis'));
  const counts = Object.fromEntries(session.models.map((m) => [m.model, m.replies]));
  assert.deepEqual(counts, { 'claude-opus-5': 2, 'claude-opus-5-5': 1 });
});

test('une conversation sans modèle connu revient avec une liste vide, et la liste filtrée aussi', (t) => {
  const index = indexWithSession(t);
  index.addMessages('claude:s1', [
    { role: 'assistant', uuid: 'r', text: 'sans modèle', parts: [], model: '' },
  ]);
  const folder = index.folderId('/home/ada/projets/tardis');
  assert.deepEqual(index.sessions(folder)[0].models, []);
  assert.deepEqual(
    index.sessions(folder, ['codex'])[0].models,
    [],
    'la requête des assistants masqués porte les mêmes colonnes'
  );
});
