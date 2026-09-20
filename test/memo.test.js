'use strict';

/**
 * The memo lets a background pass skip work on files that did not change.
 * The only thing worse than a slow pass is a wrong one, so most of this file
 * is about the other direction: a file that DID change is always read again.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Memo, remember, stampOf } = require('../src/core/memo');
const codex = require('../src/core/agents/codex');
const vscode = require('../src/core/agents/vscode');
const claude = require('../src/core/agents/claude');
const { createFixture, records, cdx, vsc, resetCounters } = require('./helpers/fixture');

const collect = async (iterable) => {
  const out = [];
  for await (const value of iterable) out.push(value);
  return out;
};

function setup(t) {
  resetCounters();
  const fx = createFixture();
  t.after(() => fx.cleanup());
  const memo = new Memo();
  return { fx, memo, ctx: { env: fx.env, memo } };
}

/** Push a file's mtime forward, as a later write would. */
function touchLater(file, seconds = 5) {
  const later = new Date(Date.now() + seconds * 1000);
  fs.utimesSync(file, later, later);
}

const onlyFile = (dir, suffix) => {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(suffix)) found.push(full);
    }
  };
  walk(dir);
  assert.equal(found.length, 1, `expected one ${suffix} file`);
  return found[0];
};

test.describe('the memo itself', () => {
  test('computes once per stamp', async () => {
    const memo = new Memo();
    let calls = 0;
    const compute = () => ++calls;

    assert.equal(await memo.get('k', '10:1', compute), 1);
    assert.equal(await memo.get('k', '10:1', compute), 1, 'same stamp: remembered');
    assert.equal(await memo.get('k', '11:2', compute), 2, 'new stamp: recomputed');
    assert.deepEqual({ hits: memo.hits, misses: memo.misses }, { hits: 1, misses: 2 });
  });

  test('a failure is not remembered, so the next pass tries again', async () => {
    const memo = new Memo();
    await assert.rejects(memo.get('k', 's', () => Promise.reject(new Error('illisible'))));
    assert.equal(await memo.get('k', 's', () => 'lu'), 'lu');
  });

  test('without a memo, every call computes', async () => {
    let calls = 0;
    await remember({}, 'k', 's', () => ++calls);
    await remember({}, 'k', 's', () => ++calls);
    assert.equal(calls, 2);
  });

  test('the stamp is the indexer’s own change test: size and mtime', () => {
    assert.equal(stampOf({ size: 42, mtimeMs: 1000.9 }), '42:1000');
  });
});

test.describe('a changed file is always read again', () => {
  test('codex: a rollout moved to another folder', async (t) => {
    const { fx, ctx } = setup(t);
    const id = '22222222-2222-4222-8222-222222222222';
    fx.codex().session(id, [cdx.meta('/avant'), cdx.message('user', 'a')]);
    assert.equal((await collect(codex.discover(ctx)))[0].folderPath, '/avant');

    fx.codex().session(id, [cdx.meta('/apres/ailleurs'), cdx.message('user', 'a')]);
    assert.equal((await collect(codex.discover(ctx)))[0].folderPath, '/apres/ailleurs');
  });

  // The stamp carries the mtime so that a rewrite of the SAME size still counts.
  test('codex: a rewrite of the same size, a moment later', async (t) => {
    const { fx, ctx } = setup(t);
    const id = '33333333-3333-4333-8333-333333333333';
    fx.codex().session(id, [cdx.meta('/aaaa'), cdx.message('user', 'a')]);
    await collect(codex.discover(ctx));

    const file = onlyFile(fx.env.CODEX_HOME, '.jsonl');
    const size = fs.statSync(file).size;
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('/aaaa', '/bbbb'));
    assert.equal(fs.statSync(file).size, size, 'the fixture must keep the size');
    touchLater(file);

    assert.equal((await collect(codex.discover(ctx)))[0].folderPath, '/bbbb');
  });

  test('vscode: a conversation renamed in the editor', async (t) => {
    const { fx, ctx } = setup(t);
    const tree = fx.vscode().workspace('h1', '/p');
    tree.snapshot('h1', 's1', vsc.session([vsc.request('q', [])], { customTitle: 'Avant' }));
    assert.equal((await collect(vscode.discover(ctx)))[0].title, 'Avant');

    tree.snapshot('h1', 's1', vsc.session([vsc.request('q', [])], { customTitle: 'Après le renommage' }));
    touchLater(onlyFile(fx.env.VSCODE_CONFIG_DIR, 's1.json'));
    assert.equal((await collect(vscode.discover(ctx)))[0].title, 'Après le renommage');
  });

  test('claude: a transcript that learns its working directory later', async (t) => {
    const { fx, ctx } = setup(t);
    // No sessions-index.json: the folder comes from the transcript itself.
    const project = fx.project('-home-zam-x');
    project.session('s1', [records.userText('a', { cwd: undefined })]);
    const [before] = await collect(claude.discover(ctx));
    assert.equal(before.folderExact, false, 'only the lossy hint so far');

    project.append('s1', [records.userText('b', { cwd: '/home/zam/x-reel' })]);
    touchLater(path.join(project.dirPath, 's1.jsonl'));
    const [after] = await collect(claude.discover(ctx));
    assert.equal(after.folderPath, '/home/zam/x-reel');
    assert.equal(after.folderExact, true);
  });
});
