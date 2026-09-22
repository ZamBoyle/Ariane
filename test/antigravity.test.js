'use strict';

/**
 * Antigravity CLI (`agy`) adapter.
 *
 * Two things are being guarded here, and only one of them is about `agy`.
 *
 * The first is invariant 1: of the 250 records measured on a real corpus, only
 * 15 were typed by the person. The rest is the model's prose, tool output and
 * harness notices, and every one of them arrives in the same file. A test that
 * only checked "the text came through" would pass while the app credited
 * someone with the output of a shell command.
 *
 * The second is the folder. `agy` does not record the directory it ran in, so
 * the adapter derives it — and a derivation that is allowed to guess is worse
 * than no folder at all. The rule it must obey: one candidate or nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adapter = require('../src/core/agents/antigravity');
const registry = require('../src/core/agents');
const { resumeCommand } = require('../src/core/resume');
const { createFixture, agy, resetCounters } = require('./helpers/fixture');

function setup(t) {
  resetCounters();
  const fx = createFixture();
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  return { fx, ctx: { env: fx.env } };
}

/** Everything discover() yields, in a shape a test can read at a glance. */
async function discovered(ctx) {
  const out = [];
  for await (const descriptor of adapter.discover(ctx)) out.push(descriptor);
  return out.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

async function readAll(descriptor, ctx, cursor = null) {
  const items = [];
  for await (const chunk of adapter.read(descriptor, { cursor, ctx })) items.push(chunk);
  return items;
}

const messages = (chunks) => chunks.map((c) => c.item).filter((i) => i.kind === 'message');

test.describe('finding the conversations', () => {
  test('one per log, and a brain directory without one is not a conversation', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity()
      .session('c1', [agy.user('bonjour')])
      .session('c2', [agy.user('salut')])
      .empty('c3');

    const found = await discovered(ctx);
    assert.deepEqual(
      found.map((d) => d.sessionId),
      ['c1', 'c2']
    );
    assert.ok(found[0].key.endsWith(path.join('c1', '.system_generated', 'logs', 'transcript.jsonl')));
    assert.match(found[0].fingerprint, /^\d+:\d+$/);
  });

  test('nothing on this machine is not an error', async (t) => {
    const { ctx } = setup(t);
    assert.equal(adapter.detect(ctx), false);
    assert.deepEqual(await discovered(ctx), []);
  });

  test('the title is the first line the person wrote, without its heading marks', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity().session('c1', [agy.user('# BRIEFING — Vesuvius\n\nle reste du texte')]);

    const [found] = await discovered(ctx);
    assert.equal(found.title, 'BRIEFING — Vesuvius');
  });
});

test.describe('the folder agy never writes down', () => {
  test('a workspace it did record is exact, accents included', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity().session('c1', [agy.user('bonjour')]).summary('c1', '/home/ada/Documents/Mathématiques');

    const [found] = await discovered(ctx);
    assert.equal(found.folderPath, '/home/ada/Documents/Mathématiques');
    assert.equal(found.folderExact, true);
  });

  test('a derived folder is marked as the approximation it is', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity()
      .session('c1', [agy.user('Lis debate/00-BRIEF.md et réponds')])
      .store('c1', ['/home/ada/projets/santé/debate/00-BRIEF.md']);

    const [found] = await discovered(ctx);
    assert.equal(found.folderPath, '/home/ada/projets/santé');
    assert.equal(found.folderExact, false, 'dérivé, donc jamais présenté comme un fait');
  });

  test('what agy recorded wins over what can be derived', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity()
      .session('c1', [agy.user('Lis debate/00-BRIEF.md')])
      .store('c1', ['/home/ada/ailleurs/debate/00-BRIEF.md'])
      .summary('c1', '/home/ada/le-vrai');

    const [found] = await discovered(ctx);
    assert.equal(found.folderPath, '/home/ada/le-vrai');
    assert.equal(found.folderExact, true);
  });

  test('two candidates mean ignorance, not a coin toss', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity()
      .session('c1', [agy.user('Lis debate/00-BRIEF.md')])
      .store('c1', ['/home/ada/un/debate/00-BRIEF.md', '/home/ada/deux/debate/00-BRIEF.md']);

    const [found] = await discovered(ctx);
    assert.equal(found.folderPath, null);
    assert.equal(found.folderExact, false);
  });

  test('a conversation that names no file gets no folder', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity()
      .session('c1', [agy.user('Que penses-tu de ce projet ?')])
      .store('c1', ['/home/ada/projets/santé/debate/00-BRIEF.md']);

    const [found] = await discovered(ctx);
    assert.equal(found.folderPath, null);
  });

  test("agy's own kitchen is not a working directory", async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity()
      .session('c1', [agy.user('Lis skills/SKILL.md')])
      .store('c1', ['/home/ada/.gemini/antigravity-cli/skills/SKILL.md']);

    const [found] = await discovered(ctx);
    assert.equal(found.folderPath, null);
  });

  test('a directory too shallow to mean anything is refused', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity().session('c1', [agy.user('Lis a/b.md')]).store('c1', ['/home/a/b.md']);

    const [found] = await discovered(ctx);
    assert.equal(found.folderPath, null);
  });

  test('no store at all: the conversation is simply unplaced', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity().session('c1', [agy.user('Lis debate/00-BRIEF.md')]);

    const [found] = await discovered(ctx);
    assert.equal(found.folderPath, null);
  });
});

test.describe('who said what', () => {
  test('the request is unwrapped, and what the harness added goes', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity().session('c1', [agy.user('Explique-moi ce code')]);

    const [found] = await discovered(ctx);
    const [first] = messages(await readAll(found, ctx));
    assert.equal(first.role, 'user');
    assert.equal(first.text, 'Explique-moi ce code');
    assert.equal(/USER_REQUEST|ADDITIONAL_METADATA|local time/.test(first.text), false);
  });

  test('a setting the harness announces is never indexed as the person’s words', () => {
    const raw = {
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: '2026-09-05T00:00:00Z',
      content:
        '<USER_REQUEST>\nrelis ma fonction\n</USER_REQUEST>\n' +
        '<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.8 Flash.\n</USER_SETTINGS_CHANGE>',
    };
    const item = adapter.extractAntigravityRecord(raw);
    assert.equal(item.text, 'relis ma fonction');
    assert.equal(item.text.includes('Model Selection'), false);
  });

  test('markup the person actually typed survives: the strip list is an allowlist', () => {
    const raw = {
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: '2026-09-05T00:00:00Z',
      content: '<USER_REQUEST>\npourquoi <b>ceci</b> casse-t-il mon <html> ?\n</USER_REQUEST>',
    };
    assert.equal(
      adapter.extractAntigravityRecord(raw).text,
      'pourquoi <b>ceci</b> casse-t-il mon <html> ?'
    );
  });

  test('tool output is credited to nobody', async () => {
    const item = adapter.extractAntigravityRecord(agy.tool('Created At: …\nThe command exited with 0'));
    assert.equal(item.kind, 'message');
    assert.equal(item.role, 'user');
    assert.equal(item.text, '');
    assert.deepEqual(
      item.parts.map((p) => p.type),
      ['tool_result']
    );

    // Through the very function the screen uses, not a copy of its rules.
    const format = await import('../src/renderer/format.js');
    assert.equal(format.speakerOf(item), null, 'personne ne doit se voir attribuer la sortie d’un outil');
    assert.equal(format.speakerOf(adapter.extractAntigravityRecord(agy.user('moi'))), 'you');
    assert.equal(format.speakerOf(adapter.extractAntigravityRecord(agy.model('lui'))), 'assistant');
  });

  test('a long tool output is kept as a preview, not whole', () => {
    const item = adapter.extractAntigravityRecord(agy.tool('x'.repeat(9000)));
    assert.equal(item.parts[0].preview.length, 2000);
  });

  test('the model’s reasoning keeps its own place', () => {
    const item = adapter.extractAntigravityRecord(agy.model('voici ma réponse', 'je réfléchis'));
    assert.equal(item.role, 'assistant');
    assert.equal(item.text, 'voici ma réponse');
    assert.equal(item.thinking, 'je réfléchis');
    assert.deepEqual(
      item.parts.map((p) => p.type),
      ['thinking', 'text']
    );
  });

  test('an empty reply is kept rather than dropped: the counts stay honest', () => {
    const item = adapter.extractAntigravityRecord(agy.model(''));
    assert.equal(item.kind, 'message');
    assert.equal(item.text, '');
    assert.deepEqual(item.parts, []);
  });

  test('the harness speaking about the session becomes a notice, by code', () => {
    const checkpoint = adapter.extractAntigravityRecord(
      agy.system('CHECKPOINT', '{{ CHECKPOINT 0 }} The earlier parts … were truncated')
    );
    assert.equal(checkpoint.isNotice, true);
    assert.deepEqual(checkpoint.command, { name: 'compact-boundary', args: '' });

    const failure = adapter.extractAntigravityRecord(agy.system('ERROR_MESSAGE', 'Error: the stream was interrupted.'));
    assert.deepEqual(failure.command, { name: 'failure', args: '' });

    // Ariane has no name of its own for this one; the reader is shown "Notice".
    const system = adapter.extractAntigravityRecord(agy.system('SYSTEM_MESSAGE', 'The following is a …'));
    assert.equal(system.isNotice, true);
    assert.equal(system.command, null);
  });

  test('anything unrecognised is counted, never dropped in silence', () => {
    for (const [raw, reason] of [
      [{ source: 'MODEL', type: 'FUTURE_THING', content: 'x' }, 'model:FUTURE_THING'],
      [{ source: 'ALIEN', type: 'USER_INPUT', content: 'x' }, 'source:ALIEN'],
      [{ source: 'SYSTEM', type: 'FUTURE_NOTICE', content: 'x' }, 'system:FUTURE_NOTICE'],
      [42, 'not-an-object'],
    ]) {
      const item = adapter.extractAntigravityRecord(raw);
      assert.equal(item.kind, 'ignored');
      assert.equal(item.reason, reason);
    }
  });
});

test.describe('reading it again tomorrow', () => {
  test('a cursor resumes where the last pass stopped', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity().session('c1', [agy.user('un'), agy.model('deux'), agy.model('trois')]);

    const [found] = await discovered(ctx);
    const all = await readAll(found, ctx);
    assert.equal(messages(all).length, 3);

    const afterFirst = all[0].cursor;
    const rest = messages(await readAll(found, ctx, afterFirst));
    assert.deepEqual(
      rest.map((m) => m.text),
      ['deux', 'trois']
    );
  });

  test('a cursor past the end of the file is refused', async (t) => {
    const { fx, ctx } = setup(t);
    fx.antigravity().session('c1', [agy.user('un')]);
    const [found] = await discovered(ctx);

    assert.equal(adapter.canResume(found, '0'), true);
    assert.equal(adapter.canResume(found, String(found.bytes)), true);
    assert.equal(adapter.canResume(found, String(found.bytes + 1)), false, 'le fichier a été réécrit plus court');
    assert.equal(adapter.canResume(found, 'nawak'), false);
  });
});

test.describe('the rest of the app', () => {
  test('the adapter is registered, and says which variables move it', () => {
    const known = registry.byId('antigravity');
    assert.ok(known, 'antigravity doit être enregistré');
    assert.equal(known.label, 'Antigravity CLI');
    assert.deepEqual(known.envKeys, ['ANTIGRAVITY_CLI_DIR', 'GEMINI_CONFIG_DIR']);
    assert.ok(registry.allEnvKeys().includes('ANTIGRAVITY_CLI_DIR'));
  });

  test('it lives inside ~/.gemini without being Gemini', (t) => {
    const { ctx } = setup(t);
    const gemini = registry.byId('gemini');
    assert.notEqual(adapter.root(ctx), gemini.root(ctx));
    // `path.join` des deux côtés : l'attendu doit être construit comme le
    // code le construit, sinon il n'est vrai que là où le séparateur est `/`.
    assert.equal(
      adapter.root({ env: {}, home: '/home/ada' }),
      path.join('/home/ada', '.gemini', 'antigravity-cli')
    );
    assert.equal(
      adapter.root({ env: { GEMINI_CONFIG_DIR: '/ailleurs' }, home: '/home/ada' }),
      path.join('/ailleurs', 'antigravity-cli')
    );
    assert.equal(adapter.root({ env: { ANTIGRAVITY_CLI_DIR: '/precis' } }), '/precis');
  });

  test('« Reprendre » reopens a conversation by its id', () => {
    const plan = resumeCommand('antigravity', 'antigravity:c1', '/home/ada/projet');
    assert.equal(plan.ok, true);
    assert.equal(plan.command, 'agy');
    assert.deepEqual(plan.args, ['--conversation', 'c1']);
    assert.equal(plan.cwd, '/home/ada/projet');

    // Nowhere to start: nothing is launched.
    assert.equal(resumeCommand('antigravity', 'antigravity:c1', '').ok, false);
  });
});
