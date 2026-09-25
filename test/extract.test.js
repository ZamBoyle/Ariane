'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractRecord, clean, detectCommand, base64Bytes, TOOL_PREVIEW_LIMIT } =
  require('../src/core/extract');

const msg = (role, content, extra = {}) => ({
  type: role,
  uuid: 'u1',
  sessionId: 's1',
  timestamp: '2026-01-01T00:00:00.000Z',
  cwd: '/home/zam',
  gitBranch: 'main',
  message: { content, ...(extra.message || {}) },
  ...extra,
});

test.describe('record classification', () => {
  test('extracts an ai-title', () => {
    const r = extractRecord({ type: 'ai-title', aiTitle: '  Mon titre  ', sessionId: 's1' });
    assert.equal(r.kind, 'title');
    assert.equal(r.title, 'Mon titre');
  });

  // Le titre que la personne a donné (/rename) : 23 lignes dans deux fichiers,
  // comptées comme format inconnu par la passe complète du 26 septembre 2026,
  // et la conversation gardait le titre automatique.
  test('extracts the title the person chose', () => {
    assert.deepEqual(extractRecord({ type: 'custom-title', customTitle: '  Mise à jour  ', sessionId: 's1' }), {
      kind: 'title',
      sessionId: 's1',
      title: 'Mise à jour',
    });
    assert.equal(extractRecord({ type: 'custom-title', customTitle: '', sessionId: 's1' }).kind, 'ignored');
  });

  test('ignores an empty ai-title', () => {
    assert.equal(extractRecord({ type: 'ai-title', aiTitle: '   ' }).kind, 'ignored');
  });

  test('captures the session slug from a system record', () => {
    const r = extractRecord({ type: 'system', slug: 'calm-bouncing-octopus', sessionId: 's1' });
    assert.equal(r.kind, 'summary');
    assert.equal(r.slug, 'calm-bouncing-octopus');
  });

  test('ignores known plumbing types', () => {
    for (const type of ['file-history-snapshot', 'atis-latch', 'mode']) {
      const r = extractRecord({ type });
      assert.equal(r.kind, 'ignored', type);
      assert.equal(r.reason, 'known-noise', type);
    }
  });

  test('ignores unknown types but records which one', () => {
    assert.equal(extractRecord({ type: 'brand-new-thing' }).reason, 'type:brand-new-thing');
  });

  test('tolerates garbage input', () => {
    for (const bad of [null, undefined, 42, 'str', []]) {
      assert.equal(extractRecord(bad).kind, 'ignored');
    }
  });
});

/**
 * A message typed while the assistant is working is QUEUED, and the queue
 * record is the ONLY place it is ever written — it never gets a `user` record.
 * Measured on one real session: 30 of the person's ~50 messages lived only
 * here, so discarding these records loses half of what they said.
 */
test.describe('messages typed mid-turn', () => {
  const queue = (operation, content, extra = {}) => ({
    type: 'queue-operation',
    operation,
    content,
    timestamp: '2026-09-18T09:00:00.000Z',
    sessionId: 's1',
    ...extra,
  });

  test('an enqueued message is the person speaking', () => {
    const r = extractRecord(queue('enqueue', 'partout= windows, linux, mac'));
    assert.equal(r.kind, 'message');
    assert.equal(r.role, 'user');
    assert.equal(r.text, 'partout= windows, linux, mac');
    assert.equal(r.isNotice, false, 'the person typed this');
    assert.equal(r.timestamp, '2026-09-18T09:00:00.000Z');
    assert.deepEqual(r.parts, [{ type: 'text', text: 'partout= windows, linux, mac' }]);
  });

  // `remove` repeats the text once the message has been handled.
  test('the removal record does not duplicate the message', () => {
    const r = extractRecord(queue('remove', 'partout= windows, linux, mac', { reason: 'handled' }));
    assert.equal(r.kind, 'ignored');
    assert.equal(r.detail, 'queue:remove');
  });

  test('dequeue and empty enqueues carry nothing', () => {
    assert.equal(extractRecord(queue('dequeue', undefined)).kind, 'ignored');
    assert.equal(extractRecord(queue('enqueue', '   ')).kind, 'ignored');
    assert.equal(extractRecord(queue(undefined, 'x')).kind, 'ignored');
  });

  // A background task's notice travels through the same queue: stripped to
  // nothing, it is the harness speaking. 218 were stored as empty messages
  // "from the person" before this — the ordinary path flagged the same text.
  test('a task notification in the queue is a notice, never the person', () => {
    const r = extractRecord(queue('enqueue', '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>'));
    assert.equal(r.kind, 'message');
    assert.equal(r.text, '');
    assert.equal(r.isNotice, true);
  });

  test('injected context is stripped from a queued message too', () => {
    const r = extractRecord(queue('enqueue', 'vrai texte <system-reminder>bruit</system-reminder>'));
    assert.equal(r.text, 'vrai texte');
  });

  test('a slash command typed mid-turn is still detected', () => {
    const r = extractRecord(queue('enqueue', '<command-name>/init</command-name>'));
    assert.deepEqual(r.command, { name: '/init', args: '' });
    assert.equal(r.text, '');
  });
});

/**
 * `last-prompt` points at the last prompt of a session, for `--resume`. Usually
 * it repeats a message that already has its own record — 555 of 647 measured —
 * but the remaining 92 exist NOWHERE else. Keeping it blindly would show most
 * prompts twice; dropping it loses those 92.
 */
test.describe('the last-prompt pointer', () => {
  const pointer = (lastPrompt) => ({
    type: 'last-prompt',
    lastPrompt,
    leafUuid: 'd7635c7d',
    sessionId: 's1',
  });

  test('is read as the person speaking', () => {
    const r = extractRecord(pointer('regarde si copilot est bien dans octopus'));
    assert.equal(r.kind, 'message');
    assert.equal(r.role, 'user');
    assert.equal(r.text, 'regarde si copilot est bien dans octopus');
  });

  test('asks to be checked against what the session already holds', () => {
    assert.equal(extractRecord(pointer('x')).dedupeByText, true);
  });

  test('an empty pointer carries nothing', () => {
    assert.equal(extractRecord(pointer('   ')).kind, 'ignored');
    assert.equal(extractRecord(pointer(undefined)).kind, 'ignored');
  });
});

test.describe('text extraction', () => {
  test('reads plain string content', () => {
    assert.equal(extractRecord(msg('user', 'Bonjour')).text, 'Bonjour');
  });

  test('joins multiple text blocks', () => {
    const r = extractRecord(msg('assistant', [
      { type: 'text', text: 'Un' },
      { type: 'text', text: 'Deux' },
    ]));
    assert.equal(r.text, 'Un\n\nDeux');
  });

  test('carries message metadata through', () => {
    const r = extractRecord(msg('assistant', 'hi', { message: { model: 'claude-opus-5' } }));
    assert.equal(r.role, 'assistant');
    assert.equal(r.cwd, '/home/zam');
    assert.equal(r.gitBranch, 'main');
    assert.equal(r.model, 'claude-opus-5');
    assert.equal(r.sessionId, 's1');
  });

  test('normalises missing fields to empty strings, never undefined', () => {
    const r = extractRecord({ type: 'user', message: { content: 'x' } });
    for (const k of ['uuid', 'sessionId', 'timestamp', 'cwd', 'gitBranch', 'version', 'model']) {
      assert.equal(typeof r[k], 'string', k);
    }
    assert.equal(r.parentUuid, null);
  });

  test('surfaces the boolean flags', () => {
    const r = extractRecord(msg('user', 'x', { isMeta: true, isSidechain: true, isCompactSummary: true }));
    assert.equal(r.isMeta, true);
    assert.equal(r.isSidechain, true);
    assert.equal(r.isCompactSummary, true);
  });
});

test.describe('injected context is never indexed', () => {
  test('strips system-reminder blocks', () => {
    assert.equal(clean('avant <system-reminder>TOUT LE CLAUDE.md</system-reminder> apres'),
      'avant  apres');
  });

  test('strips local command output', () => {
    assert.equal(clean('a <local-command-stdout>bruit</local-command-stdout> b'), 'a  b');
  });

  test('strips multiple and multiline blocks', () => {
    assert.equal(clean('a<system-reminder>\nx\ny\n</system-reminder>b<system-reminder>z</system-reminder>c'),
      'abc');
  });

  test('leaves ordinary angle brackets alone', () => {
    assert.equal(clean('if (a < b && c > d) return;'), 'if (a < b && c > d) return;');
  });

  // Le harnais injecte dans les messages de la personne, jamais dans les
  // réponses. Une réponse qui CITE ces balises — une conversation sur Claude
  // Code — perdait ses mots et recevait l'étiquette d'une commande : /btw et
  // /init sur deux réponses du vrai corpus (26 septembre 2026).
  test('an assistant quoting the envelopes keeps its words, and runs no command', () => {
    const said = 'Claude Code écrit `<command-name>/clear</command-name>` et une balise <init>x</init>.';
    const r = extractRecord(msg('assistant', [{ type: 'text', text: said }]));
    assert.equal(r.text, said);
    assert.equal(r.command, null);
    assert.equal(r.isNotice, false);
  });

  // Des milliers d'ouvrantes sans fermante — une pile d'appels Java, pleine de
  // <init> — coûtaient un parcours jusqu'à la fin du texte chacune.
  test('thousands of openers without a closer cost a single pass', () => {
    const text = 'at Foo.<init>(Foo.java:1)\n'.repeat(40000);
    const started = Date.now();
    assert.equal(clean(text), text.trim());
    assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
    assert.equal(clean('<init>a</init> puis <init>b'), 'puis <init>b', 'une ouvrante sans fermante reste du texte');
  });
});

test.describe('slash commands', () => {
  test('detects the command and keeps it out of the indexed text', () => {
    const r = extractRecord(msg('user',
      '<command-message>init</command-message>\n<command-name>/init</command-name>'));
    assert.deepEqual(r.command, { name: '/init', args: '' });
    assert.equal(r.text, '', 'the envelope must not leak into the index');
  });

  test('captures command arguments', () => {
    const r = extractRecord(msg('user',
      '<command-name>/review</command-name><command-args>--fix src/</command-args>'));
    assert.deepEqual(r.command, { name: '/review', args: '--fix src/' });
  });

  test('is null for an ordinary message', () => {
    assert.equal(extractRecord(msg('user', 'just text')).command, null);
    assert.equal(detectCommand(null), null);
  });
});

test.describe('thinking blocks', () => {
  test('are captured separately from indexed text', () => {
    const r = extractRecord(msg('assistant', [
      { type: 'thinking', thinking: 'raisonnement interne', signature: 'x'.repeat(5000) },
      { type: 'text', text: 'reponse' },
    ]));
    assert.equal(r.text, 'reponse', 'thinking must stay out of the searchable text');
    assert.equal(r.thinking, 'raisonnement interne');
  });

  test('drop the opaque signature blob', () => {
    const r = extractRecord(msg('assistant', [
      { type: 'thinking', thinking: 'a', signature: 'SECRET'.repeat(1000) },
    ]));
    assert.ok(!JSON.stringify(r).includes('SECRET'));
  });

  // Since April 2026 Claude Code writes no readable reasoning, only its
  // signature: 6 093 of the 6 561 records that show nothing on a real index.
  test('a masked thinking block leaves a marker to count, and nothing to show', () => {
    const r = extractRecord(msg('assistant', [{ type: 'thinking', thinking: '', signature: 'x' }]));
    assert.deepEqual(r.parts, [{ type: 'other', name: 'masked-thinking' }]);
    assert.equal(r.thinking, '', 'no reasoning is invented');
  });

  test('an empty thinking block without a signature leaves nothing', () => {
    const r = extractRecord(msg('assistant', [{ type: 'thinking', thinking: '' }]));
    assert.equal(r.parts.length, 0);
  });
});

test.describe('tool blocks', () => {
  test('keep name and a preview, in order', () => {
    const r = extractRecord(msg('assistant', [
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } },
    ]));
    assert.equal(r.text, '', 'tool input must not be indexed');
    assert.deepEqual(r.parts[0].type, 'tool_use');
    assert.equal(r.parts[0].name, 'Bash');
    assert.ok(r.parts[0].preview.includes('ls -la'));
  });

  test('tool results record their error state', () => {
    const r = extractRecord(msg('user', [
      { type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true },
    ]));
    assert.equal(r.parts[0].isError, true);
    assert.equal(r.parts[0].preview, 'boom');
  });

  test('results given as block arrays are flattened', () => {
    const r = extractRecord(msg('user', [
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ligne' }] },
    ]));
    assert.equal(r.parts[0].preview, 'ligne');
  });

  test('oversized payloads are truncated', () => {
    const r = extractRecord(msg('user', [
      { type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(50000) },
    ]));
    assert.equal(r.parts[0].preview.length, TOOL_PREVIEW_LIMIT + 1, 'limit plus ellipsis');
    assert.ok(r.parts[0].preview.endsWith('…'));
  });

  test('an unnamed tool still gets a label', () => {
    const r = extractRecord(msg('assistant', [{ type: 'tool_use', id: 't', input: {} }]));
    assert.equal(r.parts[0].name, 'tool');
  });
});

test.describe('attachments keep metadata only', () => {
  test('a base64 image is reduced to its type and size', () => {
    const r = extractRecord(msg('user', [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(4000) } },
    ]));
    assert.deepEqual(r.parts[0], {
      type: 'attachment', kind: 'image', mediaType: 'image/png', bytes: 3000,
    });
  });

  test('the payload is genuinely gone', () => {
    const data = 'QQQQ'.repeat(10000);
    const r = extractRecord(msg('user', [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
    ]));
    assert.ok(!JSON.stringify(r).includes(data.slice(0, 200)), 'base64 must not be retained');
    assert.equal(r.parts[0].kind, 'document');
  });

  test('a missing media type falls back to octet-stream', () => {
    const r = extractRecord(msg('user', [{ type: 'image', source: {} }]));
    assert.equal(r.parts[0].mediaType, 'application/octet-stream');
    assert.equal(r.parts[0].bytes, 0);
  });

  test('base64Bytes accounts for padding', () => {
    assert.equal(base64Bytes('QUJD'), 3);
    assert.equal(base64Bytes('QUJDRA=='), 4);
    assert.equal(base64Bytes('QUJDREU='), 5);
    assert.equal(base64Bytes(''), 0);
    assert.equal(base64Bytes(null), 0);
  });
});

test('unknown block types are preserved so rendering stays faithful', () => {
  const r = extractRecord(msg('assistant', [
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
  ]));
  assert.deepEqual(r.parts[0], { type: 'other', name: 'fallback' });
});

test('part order is preserved across mixed content', () => {
  const r = extractRecord(msg('assistant', [
    { type: 'thinking', thinking: 't' },
    { type: 'text', text: 'a' },
    { type: 'tool_use', id: '1', name: 'Bash', input: {} },
    { type: 'image', source: { media_type: 'image/png', data: 'AAAA' } },
  ]));
  assert.deepEqual(r.parts.map((p) => p.type), ['thinking', 'text', 'tool_use', 'attachment']);
});

test.describe('system records: the harness talking about the session', () => {
  const sys = (subtype, extra = {}) => ({
    type: 'system', subtype, sessionId: 's1', uuid: 'u1',
    timestamp: '2026-09-17T10:00:00.000Z', ...extra,
  });

  // 71 of these on a real corpus, written for the person and stored nowhere
  // else. They were discarded whole.
  test('an away summary is kept, as prose nobody is credited with', () => {
    const item = extractRecord(sys('away_summary', { content: 'Ariane est fonctionnel.' }));
    assert.equal(item.kind, 'message');
    assert.equal(item.text, 'Ariane est fonctionnel.');
    assert.equal(item.isNotice, true, 'shown, but attributed to no speaker');
    assert.equal(item.command.name, 'away-summary', 'a code: the renderer names it');
  });

  test('a compaction boundary explains the gap it leaves', () => {
    const item = extractRecord(sys('compact_boundary', { content: 'Conversation compacted' }));
    assert.equal(item.kind, 'message');
    assert.equal(item.command.name, 'compact-boundary');
  });

  test('a summary that also names the session keeps both', () => {
    const item = extractRecord(sys('away_summary', { content: 'fait', slug: 'ariane-index' }));
    assert.equal(item.kind, 'message');
    assert.equal(item.slug, 'ariane-index');
  });

  test('a slug on a telemetry record is still read', () => {
    const item = extractRecord(sys('turn_duration', { durationMs: 12, slug: 'mon-slug' }));
    assert.equal(item.kind, 'summary');
    assert.equal(item.slug, 'mon-slug');
  });

  // Naming them keeps the drift detector meaningful: the next subtype is
  // reported rather than silently lumped in with the telemetry.
  test('telemetry is set aside by name, not by silence', () => {
    for (const subtype of ['turn_duration', 'api_error', 'informational', 'bridge_status']) {
      const item = extractRecord(sys(subtype, { content: 'du texte' }));
      assert.equal(item.kind, 'ignored', subtype);
      assert.equal(item.reason, 'known-noise');
      assert.equal(item.detail, `system:${subtype}`);
    }
  });

  test('an empty summary is not an empty bubble', () => {
    assert.equal(extractRecord(sys('away_summary', { content: '   ' })).kind, 'ignored');
  });
});
