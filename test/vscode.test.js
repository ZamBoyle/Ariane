'use strict';

/**
 * VS Code chat adapter tests.
 *
 * The delta log is the reason this file is long. It is the only format in the
 * project where a wrong reading INVENTS data rather than losing it: treating a
 * `kind:2` append as applying to `requests` rather than to the path it names
 * inflated a three-request session to 134 phantom requests during the
 * reconnaissance. The first suite below exists to make that impossible.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../src/core/agents/vscode');
const { applyDeltas, extractRequest, readResponse, folderFromUri, epoch } =
  require('../src/core/agents/vscode-extract');
const { createFixture, vsc, resetCounters } = require('./helpers/fixture');

const collect = async (iterable) => {
  const out = [];
  for await (const value of iterable) out.push(value);
  return out;
};

function setup() {
  resetCounters();
  const fx = createFixture();
  return { fx, ctx: { env: fx.env }, teardown: () => fx.cleanup() };
}

const messages = async (d) =>
  (await collect(adapter.read(d))).map((c) => c.item).filter((i) => i.kind === 'message');

// ── the delta log ───────────────────────────────────────────────────────────

test.describe('delta log replay', () => {
  test('kind 0 establishes the session', () => {
    const s = applyDeltas([{ kind: 0, v: vsc.session([vsc.request('a', [])]) }]);
    assert.equal(s.requests.length, 1);
  });

  test('kind 1 sets the value at the named path', () => {
    const s = applyDeltas([
      { kind: 0, v: vsc.session([vsc.request('a', [])]) },
      { kind: 1, k: ['requests', 0, 'response'], v: [vsc.bareText('la reponse')] },
    ]);
    assert.equal(s.requests[0].response[0].value, 'la reponse');
  });

  test('kind 2 appends at the named path only', () => {
    const s = applyDeltas([
      { kind: 0, v: vsc.session([vsc.request('a', [vsc.bareText('un')])]) },
      { kind: 2, k: ['requests', 0, 'response'], v: [vsc.bareText('deux')] },
    ]);
    assert.equal(s.requests.length, 1, 'appending to a response must not add a request');
    assert.equal(s.requests[0].response.length, 2);
  });

  // The exact mistake that produced 134 phantom requests from three.
  test('an append deep in a request never multiplies the request list', () => {
    const lines = [{ kind: 0, v: vsc.session([vsc.request('a', []), vsc.request('b', []), vsc.request('c', [])]) }];
    for (let i = 0; i < 40; i += 1) {
      lines.push({ kind: 2, k: ['requests', i % 3, 'response'], v: [vsc.bareText(`part ${i}`)] });
    }
    const s = applyDeltas(lines);
    assert.equal(s.requests.length, 3, 'still three requests, never 43');
  });

  test('appending to requests itself does add requests', () => {
    const s = applyDeltas([
      { kind: 0, v: vsc.session([vsc.request('a', [])]) },
      { kind: 2, k: ['requests'], v: [vsc.request('b', [])] },
    ]);
    assert.equal(s.requests.length, 2);
  });

  test('a path into a branch the snapshot never had is ignored, not invented', () => {
    const s = applyDeltas([
      { kind: 0, v: vsc.session([]) },
      { kind: 1, k: ['nowhere', 'deep', 'leaf'], v: 'x' },
    ]);
    assert.equal(s.nowhere, undefined);
  });

  test('mutations before any snapshot are ignored', () => {
    assert.equal(applyDeltas([{ kind: 1, k: ['a'], v: 1 }]), null);
  });

  test('tolerates garbage lines', () => {
    const s = applyDeltas([
      null, 42, 'str',
      { kind: 0, v: vsc.session([vsc.request('a', [])]) },
      { kind: 2 }, { kind: 1, k: [] },
    ]);
    assert.equal(s.requests.length, 1);
  });
});

// ── one exchange ────────────────────────────────────────────────────────────

test.describe('request extraction', () => {
  const dates = { creationDate: 1756000000000, lastMessageDate: 1756000600000 };

  // There is no role field: one request object IS one exchange.
  test('splits a request into the person and the model', () => {
    const items = extractRequest(vsc.request('ma question', [vsc.markdown('ma reponse')]), dates);
    assert.deepEqual(items.map((i) => i.role), ['user', 'assistant']);
    assert.equal(items[0].text, 'ma question');
    assert.equal(items[1].text, 'ma reponse');
    assert.equal(items[1].model, 'gpt-4o');
  });

  test('reads all three prose shapes', () => {
    const out = readResponse([vsc.bareText('brut '), vsc.markdown('markdown '), { value: 'aussi brut' }]);
    assert.equal(out.text, 'brut markdown aussi brut');
  });

  // The editor streams a response in pieces; joining them with a newline, or
  // trimming each one, would tear words apart.
  test('streamed fragments concatenate into one continuous text', () => {
    const out = readResponse('Voici la reponse complete'.split(' ').map((w, i, a) =>
      vsc.markdown(i < a.length - 1 ? w + ' ' : w)));
    assert.equal(out.text, 'Voici la reponse complete');
    assert.equal(out.parts.filter((p) => p.type === 'text').length, 1, 'one part, not four');
  });

  test('keeps reasoning out of the indexed text', () => {
    const out = readResponse([vsc.markdown('reponse'), vsc.thinking('raisonnement')]);
    assert.equal(out.text, 'reponse');
    assert.equal(out.thinking, 'raisonnement');
  });

  test('turns tool invocations into previews, never text', () => {
    const out = readResponse([vsc.toolCall('read_file', 'Lecture de a.js')]);
    assert.equal(out.text, '');
    assert.equal(out.parts[0].type, 'tool_use');
    assert.equal(out.parts[0].name, 'read_file');
    assert.ok(out.parts[0].preview.includes('a.js'));
  });

  test('drops UI plumbing entirely', () => {
    const out = readResponse([
      vsc.noise('inlineReference'), vsc.noise('textEditGroup'),
      vsc.noise('codeblockUri'), vsc.noise('undoStop'), vsc.markdown('utile'),
    ]);
    assert.equal(out.text, 'utile');
    assert.equal(out.parts.filter((p) => p.type === 'other').length, 0);
  });

  // 36 of 61 measured requests store -1 rather than a time.
  test('falls back to the session dates when a timestamp is -1', () => {
    const items = extractRequest(vsc.requestWithoutTime('q', [vsc.markdown('r')]), dates);
    assert.equal(items[0].timestamp, new Date(dates.creationDate).toISOString());
    assert.ok(items[1].timestamp, 'the answer is dated too');
  });

  test('epoch rejects the -1 that means unknown', () => {
    assert.equal(epoch(-1), '');
    assert.equal(epoch(0), '');
    assert.equal(epoch(null), '');
    assert.equal(epoch(1756000000000), new Date(1756000000000).toISOString());
  });

  test('a request with no answer still yields the question', () => {
    const items = extractRequest(vsc.request('seule', []), dates);
    assert.deepEqual(items.map((i) => i.role), ['user']);
  });

  test('tolerates garbage', () => {
    for (const bad of [null, undefined, 42, 'str']) {
      assert.deepEqual(extractRequest(bad, dates), []);
    }
  });
});

// ── folder attribution ──────────────────────────────────────────────────────

test.describe('folderFromUri', () => {
  test('decodes a file URI verbatim, percent-escapes included', () => {
    assert.equal(folderFromUri('file:///home/zam/mon%20projet'), '/home/zam/mon projet');
    assert.equal(folderFromUri('file:///home/zam/Math%C3%A9matiques'), '/home/zam/Mathématiques');
  });

  test('survives a malformed escape rather than throwing', () => {
    assert.equal(folderFromUri('file:///home/%zz'), '/home/%zz');
  });

  test('returns null for nothing', () => {
    assert.equal(folderFromUri(''), null);
    assert.equal(folderFromUri(null), null);
  });
});

// ── the adapter ─────────────────────────────────────────────────────────────

test.describe('adapter', () => {
  test('detects its storage directory', (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    assert.equal(adapter.detect(ctx), false);
    fx.vscode().workspace('hash1', '/home/zam/projet');
    assert.equal(adapter.detect(ctx), true);
  });

  test('takes the folder from workspace.json, never from the hash', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode()
      .workspace('c0a9dbe1', '/home/zam/Documents/Mathématiques')
      .snapshot('c0a9dbe1', 's1', vsc.session([vsc.request('q', [vsc.markdown('r')])]));

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/Documents/Mathématiques');
    assert.equal(d.folderExact, true);
  });

  test('a multi-root workspace attributes to the workspace file directory', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode()
      .multiRoot('hash2', '/home/zam/projets/tout.code-workspace')
      .snapshot('hash2', 's2', vsc.session([vsc.request('q', [])]));

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, '/home/zam/projets');
  });

  test('reads a snapshot session', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode()
      .workspace('h3', '/p')
      .snapshot('h3', 's3', vsc.session([
        vsc.request('premiere', [vsc.markdown('reponse une')]),
        vsc.request('seconde', [vsc.markdown('reponse deux')]),
      ], { customTitle: 'Mon titre' }));

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.title, 'Mon titre');
    assert.deepEqual((await messages(d)).map((m) => m.text),
      ['premiere', 'reponse une', 'seconde', 'reponse deux']);
  });

  test('reads a delta-log session', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode().workspace('h4', '/p').deltaLog('h4', 's4', [
      { kind: 0, v: vsc.session([vsc.request('question', [])], { customTitle: 'Log' }) },
      { kind: 2, k: ['requests', 0, 'response'], v: [vsc.markdown('reponse ')] },
      { kind: 2, k: ['requests', 0, 'response'], v: [vsc.markdown('en morceaux')] },
    ]);

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.delta, true);
    assert.equal(d.title, 'Log', 'the title comes from line 0 alone');
    assert.deepEqual((await messages(d)).map((m) => m.text), ['question', 'reponse en morceaux']);
  });

  // The previous generation, still present in 75 of 188 real workspaces.
  test('reads the legacy SQLite blob as well as the files', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode()
      .workspace('h5', '/p')
      .legacyStore('h5', [
        { sessionId: 'ancienne', requests: [vsc.request('vieux prompt', [vsc.markdown('vieille reponse')])] },
      ])
      .snapshot('h5', 'recente', vsc.session([vsc.request('nouveau', [vsc.markdown('neuf')])]));

    const found = await collect(adapter.discover(ctx));
    assert.equal(found.length, 2, 'both generations are surfaced');

    const legacy = found.find((d) => d.sessionId === 'ancienne');
    assert.equal(legacy.legacy, true);
    assert.deepEqual((await messages(legacy)).map((m) => m.text), ['vieux prompt', 'vieille reponse']);
  });

  test('a session present in both generations is surfaced once', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode()
      .workspace('h6', '/p')
      .legacyStore('h6', [{ sessionId: 'partagee', requests: [vsc.request('a', [])] }])
      .snapshot('h6', 'partagee', vsc.session([vsc.request('a', [])]));

    assert.equal((await collect(adapter.discover(ctx))).length, 1);
  });

  // The blob is a snapshot VS Code stopped updating; the file is still being
  // written to. One session of 188 workspaces measured exists in both.
  test('and it is the living file that is kept, not the frozen blob', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode()
      .workspace('h9', '/p')
      .legacyStore('h9', [{ sessionId: 'partagee', requests: [vsc.request('ancienne question', [])] }])
      .snapshot('h9', 'partagee', vsc.session([
        vsc.request('ancienne question', []),
        vsc.request('la suite, écrite après le gel du blob', []),
      ]));

    const [descriptor] = await collect(adapter.discover(ctx));
    assert.ok(!descriptor.legacy, 'the file wins');
    const texts = (await messages(descriptor)).map((m) => m.text);
    assert.ok(
      texts.some((t2) => t2.includes('la suite')),
      `the newer turns must survive: ${texts.join(' | ')}`
    );
  });

  test('a legacy session with no requests is not surfaced', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode().workspace('h7', '/p').legacyStore('h7', [{ sessionId: 'vide', requests: [] }]);
    assert.deepEqual(await collect(adapter.discover(ctx)), []);
  });

  test('the legacy blob is found even with no chatSessions directory', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode()
      .workspace('h8', '/p')
      .legacyStore('h8', [{ sessionId: 'seule', requests: [vsc.request('q', [])] }]);

    assert.equal((await collect(adapter.discover(ctx))).length, 1);
  });

  // 166 MB of serialised tool output holding 2.5 KB of conversation.
  test('an oversized document is refused and SAYS it was refused', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const tree = fx.vscode().workspace('h9', '/p');
    tree.raw('h9', 'enorme.json', '{"requests":[]}');

    const [d] = await collect(adapter.discover(ctx));
    d.tooLarge = true;
    d.bytes = 166 * 1024 * 1024;

    const chunks = await collect(adapter.read(d));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].item.kind, 'ignored');
    assert.match(chunks[0].item.reason, /^oversized:\d+MB$/, 'the reason must be countable');
  });

  test('never resumes: a delta log replays onto a snapshot held in memory', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode().workspace('ha', '/p').snapshot('ha', 'sa', vsc.session([vsc.request('q', [])]));
    const [d] = await collect(adapter.discover(ctx));
    assert.equal(adapter.canResume(d, '0'), false);
  });

  test('survives a corrupt document', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    fx.vscode().workspace('hb', '/p').raw('hb', 'casse.json', '{ pas du json');
    const [d] = await collect(adapter.discover(ctx));
    assert.deepEqual(await messages(d), []);
  });

  test('a workspace with no workspace.json admits it does not know the folder', async (t) => {
    const { fx, ctx, teardown } = setup();
    t.after(teardown);

    const tree = fx.vscode();
    tree.snapshot('hc', 'sc', vsc.session([vsc.request('q', [])]));

    const [d] = await collect(adapter.discover(ctx));
    assert.equal(d.folderPath, null);
    assert.equal(d.folderExact, false);
  });

  test('yields nothing rather than throwing on a missing directory', async () => {
    const ctx = { env: { VSCODE_CONFIG_DIR: '/nope/does/not/exist' } };
    assert.equal(adapter.detect(ctx), false);
    assert.deepEqual(await collect(adapter.discover(ctx)), []);
  });
});

// The k path comes from a file this app does not write.
test.describe('a delta path cannot reach the prototype chain', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    test(`a path through ${key} is refused`, () => {
      applyDeltas([
        { kind: 0, v: vsc.session([]) },
        { kind: 1, k: [key, 'pollue'], v: 'oui' },
        { kind: 2, k: [key, 'liste'], v: ['oui'] },
      ]);
      assert.equal({}.pollue, undefined, 'Object.prototype must be untouched');
      assert.equal({}.liste, undefined);
    });
  }

  test('an ordinary path still works', () => {
    const s = applyDeltas([
      { kind: 0, v: vsc.session([vsc.request('a', [])]) },
      { kind: 1, k: ['requests', 0, 'response'], v: [vsc.bareText('ok')] },
    ]);
    assert.equal(s.requests[0].response[0].value, 'ok');
  });
});

test.describe('a turn that produced no answer', () => {
  // Four of 53 measured requests failed. Only the prompt was stored, so the
  // transcript showed a question the assistant appeared to have ignored.
  test('says why the request failed instead of showing nothing', () => {
    const items = extractRequest(
      vsc.request('ma question', [], {
        result: { errorDetails: { code: 'failed', message: 'Désolé, ce message est trop long.' } },
      }),
      {}
    );

    assert.deepEqual(items.map((i) => i.role), ['user', 'assistant']);
    assert.equal(items[1].text, 'Désolé, ce message est trop long.');
    assert.equal(items[1].isNotice, true, 'nobody said it: it is the tool reporting');
    assert.equal(items[1].command.name, 'failure', 'a code, named in the reader’s language');
  });

  test('a cancelled request says so, by a code rather than a sentence', () => {
    const items = extractRequest(vsc.request('q', [], { isCanceled: true }), {});
    assert.equal(items.at(-1).command.name, 'cancelled');
    assert.equal(items.at(-1).text, '', 'no words stored: the renderer names it');
  });

  test('a failure alongside a partial answer keeps both', () => {
    const items = extractRequest(
      vsc.request('q', [vsc.markdown('début de réponse')], {
        result: { errorDetails: { message: 'interrompu', responseIsIncomplete: true } },
      }),
      {}
    );
    assert.deepEqual(items.map((i) => i.text), ['q', 'début de réponse', 'interrompu']);
  });

  test('a normal turn gains nothing', () => {
    const items = extractRequest(vsc.request('q', [vsc.markdown('r')]), {});
    assert.equal(items.length, 2);
    assert.equal(items[1].isNotice, false);
  });
});
