'use strict';

/**
 * The demo corpus is only worth anything if the real adapters read it, and it
 * is only safe if nothing ELSE is read alongside it. This indexes it exactly
 * as the app would, then checks both.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const {
  buildDemoCorpus,
  ensureDemoCorpus,
  CONVERSATIONS,
  SHOWCASE,
  DEMO_HOME,
} = require('../scripts/demo-corpus');

async function indexDemo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-demo-test-'));
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const { env } = buildDemoCorpus(root);
  const report = await new Indexer(index, { env }).run();
  return { index, report, env };
}

test('every demo conversation is found, with no error and no format drift', async (t) => {
  const { index, report } = await indexDemo(t);

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.unknownKinds, {}, 'a demo that drifts from the real formats teaches nothing');
  assert.equal(index.stats().sessions, CONVERSATIONS.length);

  const expected = new Set(CONVERSATIONS.map((c) => c.agent));
  const indexed = new Set(index.agents().filter((a) => a.sessionCount > 0).map((a) => a.id));
  assert.deepEqual([...indexed].sort(), [...expected].sort(), 'every agent in the corpus is represented');

  for (const folder of index.folders()) {
    for (const session of index.sessions(folder.id)) {
      assert.ok(session.messageCount > 0, `${session.id} indexed empty`);
    }
  }
});

// The reason the demo exists: a screenshot must never show a real history.
test('nothing outside the demo home reaches the index', async (t) => {
  const { index, env } = await indexDemo(t);

  for (const folder of index.folders()) {
    assert.ok(folder.path.startsWith(`${DEMO_HOME}/`), `leaked in from outside the demo: ${folder.path}`);
    assert.equal(folder.pathExact, 1, `${folder.path} should come from an exact source`);
  }
  for (const [key, value] of Object.entries(env)) {
    assert.ok(!value.startsWith(os.homedir()) || value.includes('ariane-demo-test-'), `${key} points home`);
  }
});

test('the showcase conversation shows what the app is for', async (t) => {
  const { index } = await indexDemo(t);

  const [session] = index
    .folders()
    .flatMap((f) => index.sessions(f.id))
    .filter((s) => s.title === SHOWCASE.title);
  assert.ok(session, 'the showcase is indexed under its title');

  const messages = index.messages(session.id);
  const parts = messages.flatMap((m) => m.parts);
  assert.ok(parts.some((p) => p.type === 'tool_result' && p.isError), 'a failing tool result');
  assert.ok(parts.some((p) => p.type === 'thinking'), 'some reasoning');
  assert.ok(messages.some((m) => m.text.includes('```')), 'a code block');
  assert.equal(
    messages.filter((m) => m.role === 'user' && m.text).length,
    SHOWCASE.turns.filter((turn) => turn.user).length,
    'exactly the prompts the person typed'
  );
});

// La capture des statistiques du README n'a de sens que si la démo compte ses
// jetons, sur plusieurs mois, avec les limites de Codex — comme un vrai corpus.
test('la démo compte ce qu’elle a coûté, sur plusieurs mois, limites comprises', async (t) => {
  const { index } = await indexDemo(t);
  const sessions = index.folders().flatMap((f) => index.sessions(f.id));

  for (const agent of ['claude', 'codex', 'gemini', 'copilot-cli']) {
    const own = sessions.filter((s) => s.agentId === agent);
    assert.ok(own.length > 0 && own.every((s) => s.tokOutput > 0), `${agent} : chaque conversation mesurée`);
  }
  const sum = (key) => sessions.reduce((n, s) => n + (s[key] || 0), 0);
  assert.ok(sum('tokCacheRead') > 3 * (sum('tokInput') + sum('tokCacheWrite')), 'le cache relu écrase le reste, comme en vrai');

  const months = new Set(sessions.map((s) => s.lastAt.slice(0, 7)));
  assert.ok(months.size >= 4, `au moins quatre mois pour le graphique : ${[...months]}`);

  const limits = index.quotas({});
  assert.ok(limits.some((q) => q.minutes === 10080), 'la semaine de Codex');
  assert.ok(limits.some((q) => q.minutes === 300 && q.reached), 'une limite de 5 heures atteinte');
});

test.describe('the kept demo', () => {
  const scratch = (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ariane-kept-demo-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'Ariane-demo');
  };
  const anyTranscript = (root) => {
    const projects = path.join(root, 'claude', 'projects');
    const dir = path.join(projects, fs.readdirSync(projects)[0]);
    return path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.jsonl')));
  };

  test('is built once, then reopened as it is', (t) => {
    const root = scratch(t);
    assert.equal(ensureDemoCorpus(root).created, true);

    const file = anyTranscript(root);
    const before = fs.statSync(file).mtimeMs;
    const again = ensureDemoCorpus(root);
    assert.equal(again.created, false, 'a second launch must not rebuild it');
    assert.equal(fs.statSync(file).mtimeMs, before, 'nor rewrite a single file');
    assert.equal(again.env.CLAUDE_CONFIG_DIR, path.join(root, 'claude'));
  });

  test('--reset rebuilds it from nothing', (t) => {
    const root = scratch(t);
    ensureDemoCorpus(root);
    fs.writeFileSync(path.join(root, 'user-data-stale'), 'x');

    assert.equal(ensureDemoCorpus(root, { reset: true }).created, true);
    assert.ok(!fs.existsSync(path.join(root, 'user-data-stale')), 'nothing old survives');
  });

  // A wrong path handed to --reset must never wipe something real.
  test('--reset refuses a directory it did not create', (t) => {
    const root = scratch(t);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'precieux.txt'), 'à garder');

    assert.throws(() => ensureDemoCorpus(root, { reset: true }), /pas un corpus de démo/);
    assert.equal(fs.readFileSync(path.join(root, 'precieux.txt'), 'utf8'), 'à garder');
  });
});
