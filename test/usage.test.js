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
