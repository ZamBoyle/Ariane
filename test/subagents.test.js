'use strict';

/**
 * Les sous-agents : chacun écrit sa propre transcription, que la conversation
 * mère ne contient pas. Mesuré le 25 septembre 2026 : 381 transcriptions sous
 * 6 conversations de Claude — 23 sous-agents et 358 agents de workflow —,
 * 122 Mo et 4,4 M jetons reçus, près de 40 % de ce que les conversations
 * principales ont reçu. Codex en écrit aussi, 7, un fichier chacun.
 *
 * Trois règles, chacune tenue ici : un sous-agent est rattaché à la
 * conversation qui l'a lancé et ne figure pas dans la liste ; sa consigne est
 * écrite par l'assistant parent, jamais par la personne ; son compte de jetons
 * est gardé à part, et c'est un minimum.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const { summarize } = require('../src/core/statistics');
const claudeAdapter = require('../src/core/agents/claude');
const codexAdapter = require('../src/core/agents/codex');
const { createFixture, records, cdx, resetCounters } = require('./helpers/fixture');

function setup(t, adapters) {
  resetCounters();
  const fx = createFixture();
  const index = new Index(':memory:');
  t.after(() => {
    index.close();
    fx.cleanup();
  });
  const run = () => new Indexer(index, { env: fx.env, adapters }).run();
  return { fx, index, run };
}

const listed = (index) => index.folders().flatMap((f) => index.sessions(f.id).map((s) => s.id));

/** Un sous-agent de Claude : `<session>/subagents/[…/]agent-<id>.jsonl`, et son .meta.json. */
function subagent(project, parent, agentId, lines, meta = {}, under = []) {
  const dir = path.join(project.dirPath, parent, 'subagents', ...under);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agent-${agentId}.jsonl`);
  fs.writeFileSync(
    file,
    lines
      .map((r) => JSON.stringify({ sessionId: parent, agentId, isSidechain: true, ...r }))
      .join('\n') + '\n'
  );
  fs.writeFileSync(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
  return file;
}

/** Une ligne de réponse avec son compte tel qu'il était quand elle a été écrite. */
const snapshot = (id, output, text) =>
  records.assistantText(text, {
    message: {
      role: 'assistant',
      model: 'claude-opus-5',
      id,
      usage: {
        input_tokens: 3,
        output_tokens: output,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 50,
      },
      content: [{ type: 'text', text }],
    },
  });

// ── Claude ──────────────────────────────────────────────────────────────────

test('Claude : un sous-agent est lu et rattaché à sa conversation, sans entrer dans la liste', async (t) => {
  const { fx, index, run } = setup(t, [claudeAdapter]);
  const project = fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' });
  project.session('s1', [
    records.userText('lance deux agents'),
    records.assistantText('c’est parti'),
  ]);
  subagent(
    project,
    's1',
    'a1',
    [
      records.userText('consigne écrite par Claude'),
      snapshot('msg_A', 8, 'je lis'),
      snapshot('msg_A', 177, 'rapport'),
    ],
    { agentType: 'general-purpose', description: 'Auditer la documentation' }
  );
  subagent(
    project,
    's1',
    'w1',
    [records.userText('recon'), snapshot('msg_W', 40, 'fait')],
    { agentType: 'workflow-subagent', description: 'recon:codex', workflowPhase: 'Reconnaissance' },
    ['workflows', 'wf_1']
  );

  const report = await run();
  assert.deepEqual(report.errors, []);
  assert.deepEqual(listed(index), ['claude:s1'], 'la liste ne montre que la conversation');
  assert.equal(index.stats().sessions, 1, 'le pied de page non plus');
  assert.equal(index.stats().messages, 2, 'ni leurs messages');
  assert.equal(index.agents().find((a) => a.id === 'claude').sessionCount, 1);

  assert.deepEqual(
    index.subagents('claude:s1').map((s) => [s.id, s.title]),
    [
      ['claude:agent-a1', 'Auditer la documentation'],
      ['claude:agent-w1', 'recon:codex'],
    ],
    'on les retrouve depuis la conversation qui les a lancés, dans l’ordre où ils ont commencé'
  );
  assert.equal(index.session('claude:agent-w1').parentId, 'claude:s1', 'même ceux d’un workflow');

  const [briefing] = index.messages('claude:agent-a1');
  assert.equal(briefing.role, 'user');
  assert.equal(briefing.isSidechain, true, 'la consigne vient de Claude : personne n’est crédité');

  const [row] = index.sessions(index.folders()[0].id);
  assert.equal(row.subagents, 2);
  assert.equal(row.subOutput, 177 + 40, 'le dernier compte de chaque réponse, pas le premier');
  assert.equal(row.tokOutput, null, 'et rien n’est mêlé aux jetons de la conversation elle-même');
});

test('Claude : une session qui n’a rien lancé n’a pas de sous-agents', async (t) => {
  const { fx, index, run } = setup(t, [claudeAdapter]);
  fx.project('-home-zam-demo', { originalPath: '/home/zam/demo' }).session('s1', [
    records.userText('seul'),
  ]);
  await run();
  assert.deepEqual(index.subagents('claude:s1'), []);
  const [row] = index.sessions(index.folders()[0].id);
  assert.equal(row.subagents, null);
});

// ── Codex ───────────────────────────────────────────────────────────────────

test('Codex : un sous-agent nomme son parent dans son en-tête, et sa consigne n’est à personne', async (t) => {
  const { fx, index, run } = setup(t, [codexAdapter]);
  const parent = '019f0b22-b72b-74d2-946e-bb924bec6698';
  const child = '019f0b22-f599-76b3-9dc6-00e763ff425e';
  const tree = fx.codex();
  tree.session(parent, [
    cdx.meta('/home/zam/arena', parent),
    cdx.message('user', 'lance un débat'),
  ]);
  tree.session(child, [
    {
      timestamp: '2026-06-28T00:11:08.000Z',
      type: 'session_meta',
      payload: {
        id: child,
        parent_thread_id: parent,
        thread_source: 'subagent',
        agent_nickname: 'Huygens',
        cwd: '/home/zam/arena',
      },
    },
    cdx.message('user', 'Débat technique à 4 IA. Lis le brief.'),
    cdx.message('assistant', 'Lu.'),
  ]);

  await run();
  assert.deepEqual(listed(index), [`codex:${parent}`]);
  const sub = index.session(`codex:${child}`);
  assert.equal(sub.parentId, `codex:${parent}`);
  assert.equal(sub.title, 'Huygens', 'le nom que le parent lui a donné');
  assert.ok(
    index.messages(`codex:${child}`).every((m) => m.isSidechain),
    'Codex ne marque rien : toute la session l’est, la consigne comprise'
  );
  // Trouvée par la recherche, la consigne le dit aussi : sans ce drapeau, la
  // liste des résultats la signait « Vous » (26 septembre 2026).
  const [hit] = index.search('brief');
  assert.equal(hit.sessionId, `codex:${child}`);
  assert.equal(hit.isSidechain, 1);
});

// ── Ce qui se compte à part ─────────────────────────────────────────────────

test('les statistiques décrivent la barre latérale, et comptent les sous-agents à part', () => {
  const rules = {
    speakerOf: (m) => (m.role === 'user' ? (m.isSidechain ? null : 'you') : 'assistant'),
    hasContent: () => true,
    modelName: (m) => m || '',
  };
  const row = (sessionId, role, extra = {}) => ({
    sessionId,
    agentId: 'claude',
    folderPath: '/p',
    role,
    model: 'claude-opus-5',
    hasText: 1,
    hasThinking: 0,
    parts: null,
    isNotice: 0,
    isSidechain: 0,
    command: null,
    at: '2026-09-25T10:00:00.000Z',
    tokInput: null,
    tokOutput: null,
    tokCacheRead: null,
    tokCacheWrite: null,
    isSubagent: 0,
    ...extra,
  });
  const data = summarize(
    [
      row('claude:s1', 'user'),
      row('claude:s1', 'assistant', {
        tokInput: 1,
        tokOutput: 10,
        tokCacheRead: 100,
        tokCacheWrite: 5,
      }),
      row('claude:agent-a1', 'user', { isSidechain: 1, isSubagent: 1 }),
      row('claude:agent-a1', 'assistant', {
        isSubagent: 1,
        tokInput: 2,
        tokOutput: 177,
        tokCacheRead: 1000,
        tokCacheWrite: 50,
      }),
    ],
    rules
  );
  assert.equal(
    data.records,
    2,
    'les messages des sous-agents ne sont pas dans les chiffres du haut'
  );
  assert.equal(data.sessions, 1);
  assert.equal(data.speakers.assistant, 1);
  assert.equal(data.tokens.received, 10);
  assert.deepEqual(data.subagents, { count: 1, sent: 52, received: 177, cacheRead: 1000 });
});

test('un sous-agent sauvé par Ariane puis restauré garde sa conversation mère', (t) => {
  const index = new Index(':memory:');
  t.after(() => index.close());
  index.restoreArchived(
    'claude:agent-a1',
    {
      agent_id: 'claude',
      title: 'Auditer la documentation',
      folder_path: '/home/zam/demo',
      parent_id: 'claude:s1',
    },
    [
      {
        seq: 0,
        uuid: 'u1',
        parent_uuid: null,
        role: 'user',
        ts: '2026-09-25T10:00:00.000Z',
        model: '',
        text: 'consigne',
        thinking: '',
        parts: '[]',
        is_meta: 0,
        is_notice: 0,
        is_sidechain: 1,
        command: null,
      },
    ],
    'Claude Code'
  );
  assert.equal(index.session('claude:agent-a1').parentId, 'claude:s1');
  assert.deepEqual(listed(index), [], 'restauré, il ne rentre pas pour autant dans la liste');
});

test('le résumé d’une ligne met les jetons des sous-agents dans les mêmes trois chiffres', async () => {
  const { subagentTokens } = await import('../src/renderer/format.js');
  assert.equal(subagentTokens({ subagents: null }), null);
  assert.deepEqual(
    subagentTokens({
      subagents: 3,
      subInput: 2,
      subOutput: 177,
      subCacheRead: 1000,
      subCacheWrite: 50,
    }),
    { count: 3, sent: 52, received: 177, cacheRead: 1000, input: 2, cacheWrite: 50 }
  );
  assert.deepEqual(
    subagentTokens({
      subagents: 1,
      subInput: null,
      subOutput: null,
      subCacheRead: null,
      subCacheWrite: null,
    }),
    { count: 1, sent: null, received: null, cacheRead: null },
    'un sous-agent qui n’a rien mesuré ne devient pas un zéro'
  );
});
