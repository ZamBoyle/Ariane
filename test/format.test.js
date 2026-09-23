'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/** format.js is an ES module; load it once for the whole file. */
let F;
test.before(async () => {
  F = await import('../src/renderer/format.js');
});

test.describe('escaping is the security boundary', () => {
  test('neutralises every tag-opening character', () => {
    assert.equal(F.escapeHtml('<script>alert(1)</script>'),
      '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(F.escapeHtml(`a"b'c&d`), 'a&quot;b&#39;c&amp;d');
  });

  test('handles null and undefined', () => {
    assert.equal(F.escapeHtml(null), '');
    assert.equal(F.escapeHtml(undefined), '');
  });

  /**
   * The property that actually matters: no tag outside this allowlist may
   * appear in the output. Escaped text may still *contain* strings like
   * "onerror=" — inert, because the surrounding "<" became "&lt;".
   */
  const ALLOWED_TAGS = new Set([
    'p', 'br', 'code', 'pre', 'strong', 'em', 'ul', 'ol', 'li',
    'blockquote', 'mark', 'h2', 'h3', 'h4', 'h5',
  ]);

  const tagsIn = (html) =>
    [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());

  test('markdown output never introduces a tag outside the allowlist', () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<script>fetch("//evil")</script>',
      '"><svg onload=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '`<b>code</b>`',
      '**<i>bold</i>**',
      '# <script>h</script>',
      '- <script>li</script>',
      '> <script>quote</script>',
      '<a href="javascript:alert(1)">x</a>',
    ];
    for (const payload of payloads) {
      const html = F.renderMarkdown(payload);
      for (const tag of tagsIn(html)) {
        assert.ok(ALLOWED_TAGS.has(tag), `payload ${payload} produced <${tag}>`);
      }
      // The injected "<" must have been escaped, not merely dropped.
      assert.ok(html.includes('&lt;'), `payload ${payload} lost its escaped bracket`);
    }
  });

  test('event-handler text survives only as inert escaped content', () => {
    const html = F.renderMarkdown('<img src=x onerror=alert(1)>');
    assert.equal(html, '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    assert.deepEqual(tagsIn(html), ['p', 'p']);
  });

  test('code fences do not let markup escape', () => {
    const html = F.renderMarkdown('```js\n<script>alert(1)</script>\n```');
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!/<script/i.test(html));
  });

  test('a language tag cannot break out of the attribute', () => {
    const html = F.renderMarkdown('```js" onload="alert(1)\ncode\n```');
    assert.ok(!/onload="alert/.test(html));
  });
});

test.describe('renderSnippet', () => {
  test('turns sentinels into marks', () => {
    const input = `avant ${F.HL_OPEN}terme${F.HL_CLOSE} apres`;
    assert.equal(F.renderSnippet(input), 'avant <mark>terme</mark> apres');
  });

  test('a literal mark tag in the text stays inert', () => {
    assert.equal(F.renderSnippet('<mark>faux</mark>'), '&lt;mark&gt;faux&lt;/mark&gt;');
  });

  test('escapes around the highlight', () => {
    const input = `${F.HL_OPEN}<b>${F.HL_CLOSE}`;
    assert.equal(F.renderSnippet(input), '<mark>&lt;b&gt;</mark>');
  });
});

test.describe('markdown subset', () => {
  test('renders paragraphs', () => {
    assert.equal(F.renderMarkdown('un\n\ndeux'), '<p>un</p><p>deux</p>');
  });

  test('renders headings below h1', () => {
    assert.equal(F.renderMarkdown('## Titre'), '<h3>Titre</h3>');
    assert.equal(F.renderMarkdown('# Titre'), '<h2>Titre</h2>');
  });

  test('renders bullet and ordered lists', () => {
    assert.equal(F.renderMarkdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
    assert.equal(F.renderMarkdown('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  });

  test('renders inline code, bold and italic', () => {
    assert.equal(F.renderMarkdown('`x`'), '<p><code>x</code></p>');
    assert.equal(F.renderMarkdown('**gras**'), '<p><strong>gras</strong></p>');
    assert.equal(F.renderMarkdown('du *italique*'), '<p>du <em>italique</em></p>');
  });

  test('keeps emphasis markers inside code fences literal', () => {
    const html = F.renderMarkdown('```\na ** b\n```');
    assert.ok(html.includes('a ** b'));
    assert.ok(!html.includes('<strong>'));
  });

  test('preserves the code language as a data attribute', () => {
    assert.ok(F.renderMarkdown('```python\nx\n```').includes('data-lang="python"'));
  });

  test('converts single newlines to breaks inside a paragraph', () => {
    assert.equal(F.renderMarkdown('a\nb'), '<p>a<br>b</p>');
  });

  test('renders blockquotes', () => {
    assert.equal(F.renderMarkdown('> cite'), '<blockquote>cite</blockquote>');
  });

  test('empty input yields empty output', () => {
    assert.equal(F.renderMarkdown(''), '');
    assert.equal(F.renderMarkdown(null), '');
  });

  test('mixes prose and code in order', () => {
    const html = F.renderMarkdown('avant\n\n```\ncode\n```\n\napres');
    assert.equal(html, '<p>avant</p><pre class="code"><code>code</code></pre><p>apres</p>');
  });
});

test.describe('a list written the way Claude writes it', () => {
  // 1017 of 7629 real messages put the list straight under the line that
  // introduces it, and showed raw dashes.
  test('a list may follow a line of prose with no blank line between', () => {
    assert.equal(
      F.renderMarkdown('Deux options :\n- a\n- b'),
      '<p>Deux options :</p><ul><li>a</li><li>b</li></ul>'
    );
  });

  test('and prose may follow a list the same way', () => {
    assert.equal(F.renderMarkdown('- a\n- b\nsuite'), '<ul><li>a</li><li>b</li></ul><p>suite</p>');
  });

  test('an ordered list interrupts prose only from 1', () => {
    assert.equal(
      F.renderMarkdown('Étapes :\n1. a\n2. b'),
      '<p>Étapes :</p><ol><li>a</li><li>b</li></ol>'
    );
    // A sentence that happens to wrap onto a year is still a sentence.
    assert.equal(F.renderMarkdown('En\n2004. Une année'), '<p>En<br>2004. Une année</p>');
  });

  test('an indented line continues the item above it', () => {
    assert.equal(
      F.renderMarkdown('- un item\n  qui continue\n- deux'),
      '<ul><li>un item<br>qui continue</li><li>deux</li></ul>'
    );
  });

  test('a pasted diff keeps its markers instead of becoming bullets', () => {
    assert.equal(
      F.renderMarkdown('voici :\n-  a = 1;\n+  a = 2;'),
      '<p>voici :<br>-  a = 1;<br>+  a = 2;</p>'
    );
    assert.ok(!F.renderMarkdown('@@ -1 +1 @@\n- a\n  b').includes('<ul>'));
  });

  test('an item after prose is escaped like everything else', () => {
    const html = F.renderMarkdown('Attention :\n- <script>alert(1)</script>');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('<li>&lt;script&gt;alert(1)&lt;/script&gt;</li>'));
  });
});

test.describe('display helpers', () => {
  test('folderLabel splits POSIX and Windows paths', () => {
    assert.deepEqual(F.folderLabel('/home/zam/Documents/Mathématiques'),
      { name: 'Mathématiques', parent: 'home/zam/Documents' });
    assert.deepEqual(F.folderLabel('C:\\Users\\zam\\repos'),
      { name: 'repos', parent: 'C:/Users/zam' });
  });

  test('folderLabel survives a root or empty path', () => {
    assert.deepEqual(F.folderLabel('/'), { name: '/', parent: '' });
    assert.deepEqual(F.folderLabel(''), { name: '/', parent: '' });
  });

  test('preview collapses whitespace and truncates', () => {
    assert.equal(F.preview('  a   b \n c '), 'a b c');
    assert.equal(F.preview('x'.repeat(200)).length, 120);
    assert.ok(F.preview('x'.repeat(200)).endsWith('\u2026'));
  });
});

test.describe('hasContent', () => {
  test('keeps a message with prose', () => {
    assert.equal(F.hasContent({ text: 'salut', parts: [] }), true);
  });

  test('keeps a message that only has reasoning', () => {
    assert.equal(F.hasContent({ text: '', thinking: 'raisonnement', parts: [] }), true);
  });

  test('keeps a message that only has a tool call', () => {
    assert.equal(F.hasContent({ text: '', parts: [{ type: 'tool_use' }] }), true);
  });

  test('drops an empty shell, which is ~19% of recorded messages', () => {
    assert.equal(F.hasContent({ text: '', thinking: '', parts: [] }), false);
    assert.equal(F.hasContent({ text: '   ', thinking: '  ', parts: [] }), false);
  });

  test('drops malformed input', () => {
    assert.equal(F.hasContent(null), false);
    assert.equal(F.hasContent({}), false);
    assert.equal(F.hasContent({ text: '', parts: 'pas-un-tableau' }), false);
  });
});

test.describe('attribution: never put words in the user\'s mouth', () => {
  const toolTurn = {
    role: 'user', text: '',
    parts: [{ type: 'tool_result', id: 't1', preview: 'fatal: no commits yet' }],
  };

  test('a tool result recorded as "user" is not credited to the user', () => {
    assert.equal(F.isToolResultTurn(toolTurn), true);
    assert.equal(F.speakerOf(toolTurn), null);
  });

  test('a real user message keeps its author', () => {
    assert.equal(F.speakerOf({ role: 'user', text: 'salut', parts: [] }), 'you');
  });

  // A role, not a name: the caller names it in the reader's language and after
  // the conversation's own agent (tested where it is drawn: the render suite,
  // and the export, which labels a Codex conversation "Codex").
  test('the assistant\'s turn is the assistant\'s', () => {
    assert.equal(F.speakerOf({ role: 'assistant', text: 'bonjour', parts: [] }), 'assistant');
  });

  test('a user turn that also carries prose stays the user\'s', () => {
    const mixed = { role: 'user', text: 'et corrige ceci', parts: [{ type: 'tool_result' }] };
    assert.equal(F.isToolResultTurn(mixed), false);
    assert.equal(F.speakerOf(mixed), 'you');
  });

  test('attachments alone are also the tool answering', () => {
    assert.equal(F.isToolResultTurn({ role: 'user', text: '', parts: [{ type: 'attachment' }] }), true);
  });

  test('an assistant tool call stays the assistant\'s', () => {
    const call = { role: 'assistant', text: '', parts: [{ type: 'tool_use', name: 'Bash' }] };
    assert.equal(F.isToolResultTurn(call), false);
    assert.equal(F.speakerOf(call), 'assistant');
  });

  test('a harness notice is credited to nobody, whatever the agent', () => {
    const notice = { role: 'user', text: '[Request interrupted by user]', isNotice: true };
    assert.equal(F.speakerOf(notice), null);
  });

  test('tool output is credited to nobody, whatever the agent', () => {
    assert.equal(F.speakerOf(toolTurn), null);
  });

  test('malformed input never claims an author', () => {
    assert.equal(F.speakerOf(null), null);
    assert.equal(F.isToolResultTurn({ role: 'user', text: '', parts: 'nope' }), false);
  });
});

test.describe('grouping tool machinery', () => {
  const call = (id, name) => ({
    id, role: 'assistant', text: '', thinking: '',
    parts: [{ type: 'tool_use', id: `t${id}`, name, preview: 'x' }],
  });
  const result = (id, isError = false) => ({
    id, role: 'user', text: '', thinking: '',
    parts: [{ type: 'tool_result', id: `t${id}`, isError, preview: 'y' }],
  });
  const prose = (id, role, text) => ({ id, role, text, thinking: '', parts: [] });

  test('recognises a tool-only turn', () => {
    assert.equal(F.isToolOnlyTurn(call(1, 'Bash')), true);
    assert.equal(F.isToolOnlyTurn(result(2)), true);
    assert.equal(F.isToolOnlyTurn(prose(3, 'user', 'salut')), false);
  });

  test('a turn with prose alongside a tool call is not tool-only', () => {
    const mixed = { role: 'assistant', text: 'Je regarde.', parts: [{ type: 'tool_use', name: 'Bash' }] };
    assert.equal(F.isToolOnlyTurn(mixed), false);
  });

  test('a turn carrying reasoning is not tool-only', () => {
    const thinking = { role: 'assistant', text: '', thinking: 'hmm', parts: [{ type: 'tool_use' }] };
    assert.equal(F.isToolOnlyTurn(thinking), false);
  });

  test('a run of consecutive tool turns becomes one group', () => {
    const groups = F.groupMessages([
      prose(1, 'user', 'fais le'),
      call(2, 'Bash'), result(3), call(4, 'Bash'), result(5), call(6, 'Read'), result(7),
      prose(8, 'assistant', 'voila'),
    ]);
    assert.deepEqual(groups.map((g) => g.type), ['message', 'toolRun', 'message']);
    assert.equal(groups[1].messages.length, 6);
  });

  test('prose between runs splits them', () => {
    const groups = F.groupMessages([
      call(1, 'Bash'), result(2),
      prose(3, 'assistant', 'un mot'),
      call(4, 'Bash'), result(5),
    ]);
    assert.deepEqual(groups.map((g) => g.type), ['toolRun', 'message', 'toolRun']);
  });

  test('empty shells are dropped while grouping', () => {
    const groups = F.groupMessages([
      { id: 1, role: 'assistant', text: '', thinking: '', parts: [] },
      prose(2, 'user', 'salut'),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].message.id, 2);
  });

  test('handles empty and malformed input', () => {
    assert.deepEqual(F.groupMessages([]), []);
    assert.deepEqual(F.groupMessages(null), []);
  });

  test('describeToolRun counts calls, results, names and errors', () => {
    const d = F.describeToolRun([call(1, 'Bash'), result(2), call(3, 'Bash'), result(4, true), call(5, 'Read')]);
    assert.equal(d.calls, 3);
    assert.equal(d.results, 2);
    assert.equal(d.errors, 1);
    assert.equal(d.label, 'Bash\u00a0\u00d72, Read');
    assert.deepEqual([d.kind, d.count], ['calls', 3]);
  });

  // The call sometimes sits on a message that also had prose, leaving only its
  // result to group. Calling that "1 tool call" would be a small lie.
  test('a run of results alone is not announced as calls', () => {
    const d = F.describeToolRun([result(1), result(2)]);
    assert.equal(d.calls, 0);
    assert.deepEqual([d.kind, d.count], ['results', 2]);
    assert.equal(d.label, '', 'no tool name is knowable here');
  });

  test('attachments alone are described as such', () => {
    const d = F.describeToolRun([{ parts: [{ type: 'attachment', kind: 'image' }] }]);
    assert.deepEqual([d.kind, d.count], ['attachments', 1]);
  });

  test('describeToolRun degrades gracefully, with no word of any language', () => {
    assert.equal(F.describeToolRun(null).calls, 0);
    assert.equal(F.describeToolRun([{ parts: [{ type: 'tool_use' }] }]).label, '?');
  });
});

test.describe('agent identity and separation', () => {
  test('known agents have a stable label and initial', () => {
    assert.deepEqual(F.agentTheme('claude'), { id: 'claude', label: 'Claude', initial: 'C' });
    assert.equal(F.agentTheme('codex').label, 'Codex');
  });

  test('an unknown agent still gets an identity', () => {
    const t = F.agentTheme('nouveau-truc');
    assert.equal(t.id, 'nouveau-truc');
    assert.equal(t.label, 'nouveau-truc');
    assert.equal(t.initial, 'N');
  });

  test('a label can be supplied for an unknown agent', () => {
    assert.equal(F.agentTheme('x', 'Mon Agent').label, 'Mon Agent');
    assert.equal(F.agentTheme('x', 'Mon Agent').initial, 'M');
  });

  test('missing input never yields a blank identity', () => {
    assert.equal(F.agentTheme(null).label, 'Agent');
    assert.equal(F.agentTheme(undefined).initial, 'A');
  });
});

test.describe('search never crashes on what can be typed', () => {
  // A control byte reaches SQLite as a premature end of string and raises
  // "unterminated string" out of prepare(), past db.search's MATCH guard.
  test('a control byte degrades to no results instead of throwing', () => {
    const { Index } = require('../src/core/db');
    const index = new Index(':memory:');
    const ctl = (code) => String.fromCharCode(code);
    try {
      for (const bad of [`a${ctl(0)}b`, ctl(1), `x${ctl(31)}y`, ctl(127)]) {
        assert.deepEqual(index.search(bad), [], JSON.stringify(bad));
      }
      assert.deepEqual(index.search(`ok${ctl(0)}`), [], 'even with real text beside it');
    } finally {
      index.close();
    }
  });
});

test.describe('a subagent turn is not the person speaking', () => {
  // A sidechain is a subagent's own exchange, embedded in the transcript. Its
  // "user" turn is the briefing the assistant wrote, not anything typed.
  test('a sidechain user turn is credited to nobody', () => {
    const briefing = { role: 'user', text: 'Analyse ce fichier', parts: [], isSidechain: true };
    assert.equal(F.speakerOf(briefing), null);
  });

  test('the subagent answer keeps the agent name', () => {
    const answer = { role: 'assistant', text: 'voici', parts: [], isSidechain: true };
    assert.equal(F.speakerOf(answer), 'assistant');
  });

  test('an ordinary turn is unaffected', () => {
    assert.equal(F.speakerOf({ role: 'user', text: 'salut', parts: [] }), 'you');
  });
});

test.describe('a row must have something in it', () => {
  // Four Claude `fallback` blocks (a mid-request model switch) and two VS Code
  // metadata turns rendered as empty bubbles: they passed because they had
  // parts, not because any of those parts draw anything.
  test('a turn whose only parts are unknown is not a row', () => {
    assert.equal(F.hasContent({ text: '', thinking: '', parts: [{ type: 'other', name: 'fallback' }] }), false);
  });

  test('a thinking part with no reasoning behind it is not a row', () => {
    assert.equal(F.hasContent({ text: '', thinking: '', parts: [{ type: 'thinking' }] }), false);
  });

  test('a tool call, a result or an attachment is a row', () => {
    for (const type of ['tool_use', 'tool_result', 'attachment']) {
      assert.equal(F.hasContent({ text: '', thinking: '', parts: [{ type }] }), true, type);
    }
  });

  test('prose and reasoning are still rows', () => {
    assert.equal(F.hasContent({ text: 'salut', parts: [] }), true);
    assert.equal(F.hasContent({ text: '', thinking: 'reflexion', parts: [] }), true);
    assert.equal(F.hasContent({ text: '', thinking: '', parts: [{ type: 'text', text: 'dit' }] }), true);
  });

  test('an empty shell is still not a row', () => {
    assert.equal(F.hasContent({ text: '', thinking: '', parts: [] }), false);
    assert.equal(F.hasContent(null), false);
  });
});

test.describe('finding a word in the open conversation', () => {
  test('ignores case and accents, as the index does', () => {
    assert.equal(F.foldForSearch('Élève à l’ÉCOLE'), 'eleve a l’ecole');
  });

  // Ranges point into the ORIGINAL text: marking a match must not turn
  // "numéro" into "numero" on screen.
  test('returns ranges of the original text, accents included', () => {
    const text = 'Le numéro 7 et le NUMERO 8';
    const ranges = F.findRanges(text, 'numero');
    assert.deepEqual(ranges.map(([a, b]) => text.slice(a, b)), ['numéro', 'NUMERO']);
  });

  test('finds every occurrence, without overlapping', () => {
    assert.deepEqual(F.findRanges('aaaa', 'aa'), [[0, 2], [2, 4]]);
  });

  test('an accented needle finds the plain word too', () => {
    const text = 'un resume, un résumé';
    assert.deepEqual(F.findRanges(text, 'résumé').map(([a, b]) => text.slice(a, b)), ['resume', 'résumé']);
  });

  test('characters outside the basic plane keep their place', () => {
    const text = '🎉 café 🎉 CAFE';
    assert.deepEqual(F.findRanges(text, 'cafe').map(([a, b]) => text.slice(a, b)), ['café', 'CAFE']);
  });

  test('nothing to find, nothing found', () => {
    assert.deepEqual(F.findRanges('texte', ''), []);
    assert.deepEqual(F.findRanges('texte', '   '.trim()), []);
    assert.deepEqual(F.findRanges('', 'x'), []);
    assert.deepEqual(F.findRanges('texte', 'absent'), []);
  });
});
