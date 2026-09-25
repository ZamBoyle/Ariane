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
    'p', 'br', 'code', 'pre', 'strong', 'em', 'del', 'ul', 'ol', 'li',
    'blockquote', 'mark', 'h2', 'h3', 'h4', 'h5', 'hr', 'a',
    'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ]);

  /**
   * Every attribute the renderer may write, and what its value may be. A
   * tag's inside must parse as exactly these and nothing else, so no payload
   * can slip a handler in beside them.
   */
  const ALLOWED_ATTRIBUTES = {
    class: /^(code|table-wrap|align-(center|right))$/,
    'data-lang': /^[^"<>]*$/,
    start: /^\d{1,9}$/,
    href: /^https?:\/\/[^"<>\s]+$/i,
    target: /^_blank$/,
    rel: /^noopener noreferrer$/,
  };

  const attributesIn = (html) =>
    [...html.matchAll(/<[a-z][a-z0-9]*((?:\s[^>]*)?)>/g)].map((m) => m[1]);

  const assertAttributesAllowed = (html, payload) => {
    for (const inside of attributesIn(html)) {
      const rest = inside.replace(/\s([a-z-]+)="([^"]*)"/g, (_m, name, value) => {
        assert.ok(name in ALLOWED_ATTRIBUTES, `payload ${payload} produced attribute ${name}`);
        assert.match(value, ALLOWED_ATTRIBUTES[name], `payload ${payload}: ${name}="${value}"`);
        return '';
      });
      assert.equal(rest.trim(), '', `payload ${payload} left "${rest}" inside a tag`);
    }
  };

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
      '| <script>a</script> | b |\n|---|---|\n| <img src=x onerror=alert(1)> | c |',
      '[<img src=x onerror=alert(1)>](https://example.com)',
      '~~<script>del</script>~~',
      '- a\n  - <script>nested</script>',
      '<b>x</b>\n\n---\n\n<i>y</i>',
    ];
    for (const payload of payloads) {
      const html = F.renderMarkdown(payload);
      for (const tag of tagsIn(html)) {
        assert.ok(ALLOWED_TAGS.has(tag), `payload ${payload} produced <${tag}>`);
      }
      assertAttributesAllowed(html, payload);
      // The injected "<" must have been escaped, not merely dropped.
      assert.ok(html.includes('&lt;'), `payload ${payload} lost its escaped bracket`);
    }
  });

  test('a link can carry no attribute of its own making', () => {
    const payloads = [
      '[x](https://a.test/"onmouseover="alert(1))',
      "[x](https://a.test/'onmouseover='alert(1))",
      'https://a.test/"onmouseover="alert(1)',
      '[x](https://a.test/><script>alert(1)</script>)',
      '```js" onload="alert(1)\ncode\n```',
      '1. a\n2. b\n\n3" onclick="x. c',
    ];
    for (const payload of payloads) {
      const html = F.renderMarkdown(payload);
      assertAttributesAllowed(html, payload);
      assert.ok(!/<script/i.test(html), `payload ${payload} produced a script`);
    }
  });

  test('only the web becomes a link: any other scheme keeps its label and loses its target', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'vbscript:x']) {
      const html = F.renderMarkdown(`[voir](${url})`);
      assert.equal(html, '<p>voir</p>', url);
    }
    // A path in the project, as an assistant writes it: the label says enough.
    assert.equal(F.renderMarkdown('[format.js:38](src/renderer/format.js#L38)'), '<p>format.js:38</p>');
  });

  test('a control character in the text cannot stand in for built markup', () => {
    // inline() parks built markup behind \u0003n\u0003; the text's own are removed first.
    const html = F.renderMarkdown('`a` \u00030\u0003 b');
    assert.equal(html, '<p><code>a</code> 0 b</p>');
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

test.describe('GFM tables', () => {
  const wrap = (inner) => `<div class="table-wrap"><table>${inner}</table></div>`;

  test('a header, a delimiter and rows make a table', () => {
    assert.equal(
      F.renderMarkdown('| Agent | Messages |\n|---|---|\n| Claude | 4 |\n| Codex | 24 |'),
      wrap(
        '<thead><tr><th>Agent</th><th>Messages</th></tr></thead>' +
          '<tbody><tr><td>Claude</td><td>4</td></tr><tr><td>Codex</td><td>24</td></tr></tbody>'
      )
    );
  });

  test('outer pipes are optional, and a header alone is still a table', () => {
    assert.equal(
      F.renderMarkdown('a | b\n--- | ---'),
      wrap('<thead><tr><th>a</th><th>b</th></tr></thead>')
    );
  });

  test('colons in the delimiter row align the column', () => {
    const html = F.renderMarkdown('| g | c | d |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    assert.ok(html.includes('<th>g</th><th class="align-center">c</th><th class="align-right">d</th>'));
    assert.ok(html.includes('<td>1</td><td class="align-center">2</td><td class="align-right">3</td>'));
  });

  test('cells take inline markup, already escaped', () => {
    const html = F.renderMarkdown('| x |\n|---|\n| **gras** `a<b` |');
    assert.ok(html.includes('<td><strong>gras</strong> <code>a&lt;b</code></td>'));
  });

  test('an escaped pipe is a pipe inside a cell, not a border', () => {
    const html = F.renderMarkdown('| grep |\n|---|\n| `a\\|b` |');
    assert.ok(html.includes('<td><code>a|b</code></td>'), html);
  });

  test('a short row is padded, and a long one keeps its words', () => {
    // Measured: one table in 483 had a row wider than its header, and GFM would
    // have dropped "12 ✓" with the extra cell.
    const html = F.renderMarkdown('| a | b |\n|---|---|\n| 1 |\n| 2 | 3 | 12 ✓ |');
    assert.ok(html.includes('<tr><td>1</td><td></td></tr>'), html);
    assert.ok(html.includes('<tr><td>2</td><td>3</td><td>12 ✓</td></tr>'), html);
  });

  test('a table may follow a line of prose, and prose may follow it', () => {
    assert.equal(
      F.renderMarkdown('Voici :\n| a |\n|---|\n| 1 |\nEt après.'),
      '<p>Voici :</p>' + wrap('<thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody>') +
        '<p>Et après.</p>'
    );
  });

  test('pipes in prose without a delimiter row stay prose', () => {
    assert.equal(F.renderMarkdown('a | b\nc | d'), '<p>a | b<br>c | d</p>');
  });

  test('a delimiter row with a different number of cells is not a table', () => {
    assert.ok(!F.renderMarkdown('| a | b |\n|---|\n| 1 | 2 |').includes('<table>'));
  });
});

test.describe('rules, strikethrough and headings', () => {
  test('three dashes, stars or underscores alone draw a rule', () => {
    assert.equal(F.renderMarkdown('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
    assert.equal(F.renderMarkdown('***'), '<hr>');
    assert.equal(F.renderMarkdown('___'), '<hr>');
  });

  test('a rule may sit between two lines of the same block', () => {
    assert.equal(F.renderMarkdown('a\n---\nb'), '<p>a</p><hr><p>b</p>');
  });

  test('two dashes, or dashes among words, are not a rule', () => {
    assert.equal(F.renderMarkdown('--'), '<p>--</p>');
    assert.equal(F.renderMarkdown('a --- b'), '<p>a --- b</p>');
  });

  test('strikethrough', () => {
    assert.equal(F.renderMarkdown('~~faux~~ vrai'), '<p><del>faux</del> vrai</p>');
  });

  test('a heading followed directly by text is still a heading', () => {
    // 546 messages had one: the heading stayed as raw "##" when a line followed it.
    assert.equal(F.renderMarkdown('## Titre\ntexte'), '<h3>Titre</h3><p>texte</p>');
  });

  test('a hash without a space is not a heading', () => {
    assert.equal(F.renderMarkdown('#1 du classement'), '<p>#1 du classement</p>');
  });

  test('markup inside inline code stays literal', () => {
    assert.equal(F.renderMarkdown('`a **b** ~~c~~`'), '<p><code>a **b** ~~c~~</code></p>');
  });
});

test.describe('nested lists', () => {
  test('an indented item opens a list inside the one above', () => {
    assert.equal(
      F.renderMarkdown('- a\n  - b\n  - c\n- d'),
      '<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>'
    );
  });

  test('bullets under a numbered item, the way Claude writes steps', () => {
    assert.equal(
      F.renderMarkdown('1. a\n   - x\n2. b'),
      '<ol><li>a<ul><li>x</li></ul></li><li>b</li></ol>'
    );
  });

  test('three levels, and back out two at once', () => {
    assert.equal(
      F.renderMarkdown('- a\n  - b\n    - c\n- d'),
      '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>'
    );
  });

  test('one column of difference is the same list, written unevenly', () => {
    assert.equal(F.renderMarkdown('- a\n - b'), '<ul><li>a</li><li>b</li></ul>');
  });

  test('a block indented as a whole is not nested', () => {
    assert.equal(F.renderMarkdown('  - a\n  - b'), '<ul><li>a</li><li>b</li></ul>');
  });

  test('a tab counts as four columns', () => {
    assert.equal(F.renderMarkdown('- a\n\t- b'), '<ul><li>a<ul><li>b</li></ul></li></ul>');
  });

  test('a numbered list keeps its first number', () => {
    // 177 messages: a list split by a blank line started again at 1.
    assert.equal(F.renderMarkdown('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>');
    assert.equal(
      F.renderMarkdown('1. a\n\n2. b'),
      '<ol><li>a</li></ol><ol start="2"><li>b</li></ol>'
    );
  });
});

test.describe('links', () => {
  const a = (url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;

  test('a link opens in a new window, which main.js hands to the browser', () => {
    assert.equal(
      F.renderMarkdown('[Ariane](https://github.com/ZamBoyle/Ariane)'),
      `<p>${a('https://github.com/ZamBoyle/Ariane', 'Ariane')}</p>`
    );
  });

  test('a label may carry emphasis and code', () => {
    assert.equal(
      F.renderMarkdown('[**gras** et `code`](https://a.test)'),
      `<p>${a('https://a.test', '<strong>gras</strong> et <code>code</code>')}</p>`
    );
  });

  test('one level of parentheses belongs to the url', () => {
    assert.equal(
      F.renderMarkdown('[Foo](https://en.wikipedia.org/wiki/Foo_(bar))'),
      `<p>${a('https://en.wikipedia.org/wiki/Foo_(bar)', 'Foo')}</p>`
    );
  });

  test('a bare url becomes a link, without the punctuation that ends the sentence', () => {
    assert.equal(
      F.renderMarkdown('voir https://a.test/x?b=1&c=2.'),
      `<p>voir ${a('https://a.test/x?b=1&amp;c=2', 'https://a.test/x?b=1&amp;c=2')}.</p>`
    );
    assert.equal(
      F.renderMarkdown('(https://a.test/x)'),
      `<p>(${a('https://a.test/x', 'https://a.test/x')})</p>`
    );
  });

  test('a bare url in bold or quotes loses the marks around it', () => {
    assert.equal(
      F.renderMarkdown('**https://a.test**'),
      `<p><strong>${a('https://a.test', 'https://a.test')}</strong></p>`
    );
    assert.equal(
      F.renderMarkdown('"https://a.test"'),
      `<p>&quot;${a('https://a.test', 'https://a.test')}&quot;</p>`
    );
  });

  test('a url in code, or glued to a word, is not a link', () => {
    assert.equal(F.renderMarkdown('`https://a.test`'), '<p><code>https://a.test</code></p>');
    assert.ok(!F.renderMarkdown('xhttps://a.test').includes('<a '));
  });

  test('emphasis marks inside a url are not emphasis', () => {
    assert.equal(
      F.renderMarkdown('https://a.test/*x*/y'),
      `<p>${a('https://a.test/*x*/y', 'https://a.test/*x*/y')}</p>`
    );
  });
});

test.describe('which model answered', () => {
  const reply = (id, model, text = 'réponse') => ({ id, role: 'assistant', model, text });

  test('a model is shown by its own name, not its route', () => {
    assert.equal(F.modelName('copilot/claude-sonnet-4.5'), 'claude-sonnet-4.5');
    assert.equal(F.modelName('openai/OpenAI/gpt-5.6-sol'), 'gpt-5.6-sol');
    assert.equal(F.modelName('kimi-k3'), 'kimi-k3');
  });

  test('a placeholder is not a model', () => {
    assert.equal(F.modelName('<synthetic>'), '');
    assert.equal(F.modelName(''), '');
    assert.equal(F.modelName(null), '');
  });

  test('one model all along: named once, and no reply is marked', () => {
    const marks = F.modelMarks([reply(1, 'kimi-k3'), { id: 2, role: 'user', text: 'q' }, reply(3, 'kimi-k3')]);
    assert.deepEqual(marks.models, ['kimi-k3']);
    assert.equal(marks.changes.size, 0);
  });

  test('several: in the order they first answered, marked where each takes over', () => {
    const marks = F.modelMarks([reply(1, 'kimi-k3'), reply(2, 'kimi-k3'), reply(3, 'gpt-5.4'), reply(4, 'kimi-k3')]);
    assert.deepEqual(marks.models, ['kimi-k3', 'gpt-5.4']);
    assert.deepEqual([...marks.changes], [[1, 'kimi-k3'], [3, 'gpt-5.4'], [4, 'kimi-k3']]);
  });

  test('a tool call alone, a reply with no model, and a placeholder are passed over', () => {
    const marks = F.modelMarks([
      reply(1, 'gpt-5.2-codex'),
      reply(2, 'gpt-6-astra', ''), // a tool call: no prose
      reply(3, '', 'sans modèle'),
      reply(4, '<synthetic>'),
      reply(5, 'gpt-5.2-codex'),
    ]);
    assert.deepEqual(marks.models, ['gpt-5.2-codex']);
    assert.equal(marks.changes.size, 0, 'the same model on both sides of what was skipped');
  });

  test('nothing, or garbage, marks nothing', () => {
    assert.deepEqual(F.modelMarks(null).models, []);
    assert.deepEqual(F.modelMarks([null, 42]).models, []);
  });
});

test.describe('the models under a conversation, in the sidebar', () => {
  test('the one that answered most comes first', () => {
    const names = F.sessionModels({ models: [
      { model: 'gpt-5.6-sol', replies: 28 }, { model: 'gpt-6-astra', replies: 267 }, { model: 'gpt-5.6-luna', replies: 2 },
    ] });
    assert.deepEqual(names, ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna']);
  });

  test('two routes to one model are one model', () => {
    const names = F.sessionModels({ models: [
      { model: 'copilot/claude-sonnet-5', replies: 2 }, { model: 'claude-sonnet-5', replies: 2 }, { model: 'gpt-5', replies: 3 },
    ] });
    assert.deepEqual(names, ['claude-sonnet-5', 'gpt-5'], '2 + 2 beats 3');
  });

  test('a placeholder is not a model, and a tie goes to the name', () => {
    const names = F.sessionModels({ models: [
      { model: '<synthetic>', replies: 99 }, { model: 'b-model', replies: 1 }, { model: 'a-model', replies: 1 },
    ] });
    assert.deepEqual(names, ['a-model', 'b-model']);
  });

  test('nothing known, nothing shown', () => {
    assert.deepEqual(F.sessionModels({}), []);
    assert.deepEqual(F.sessionModels({ models: null }), []);
    assert.deepEqual(F.sessionModels(null), []);
    assert.deepEqual(F.sessionModels({ models: [{ model: 'x', replies: 0 }, 42] }), []);
  });
});

test.describe('what a conversation cost', () => {
  test('three figures, each meaning one thing', () => {
    // The medians of a real corpus: fresh input is almost nothing, the new
    // material goes through the cache, and re-reads dwarf everything.
    const usage = F.sessionTokens({
      tokInput: 170, tokOutput: 78235, tokCacheRead: 5933004, tokCacheWrite: 166489,
    });
    assert.equal(usage.sent, 170 + 166489, 'sent is what was new: fresh input plus cache writes');
    assert.equal(usage.received, 78235);
    assert.equal(usage.cacheRead, 5933004, 're-reads are kept apart, never folded into sent');
  });

  test('an assistant that recorded nothing yields nothing, not zeros', () => {
    assert.equal(F.sessionTokens({ tokInput: null, tokOutput: null, tokCacheRead: null, tokCacheWrite: null }), null);
    assert.equal(F.sessionTokens({}), null);
    assert.equal(F.sessionTokens(null), null);
  });

  test('a figure the agent does not keep stays null, the others still count', () => {
    // Gemini keeps no cache writes.
    const usage = F.sessionTokens({ tokInput: 100, tokOutput: 20, tokCacheRead: 5, tokCacheWrite: null });
    assert.equal(usage.sent, 100);
    assert.equal(usage.cacheWrite, null);
    const noCache = F.sessionTokens({ tokInput: 100, tokOutput: 20 });
    assert.equal(noCache.cacheRead, null, 'no cache recorded is not a cache of zero');
    assert.equal(F.sessionTokens({ tokOutput: 7 }).sent, null, 'nothing sent was measured');
  });

  test('a measured zero is a zero', () => {
    const usage = F.sessionTokens({ tokInput: 0, tokOutput: 0, tokCacheRead: 0, tokCacheWrite: 0 });
    assert.deepEqual([usage.sent, usage.received, usage.cacheRead], [0, 0, 0]);
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

  // What each group cost. Claude's masked reasoning is an empty shell that
  // carries its reply's count: 10 095 of 19 699 counted lines on a real corpus.
  const cost = (output, cacheRead = 1000) => ({
    input: 1,
    output,
    cacheRead,
    cacheWrite: 10,
    reasoning: null,
  });
  const shell = (id, usage) => ({
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    parts: [],
    usage,
  });
  const withCost = (message, usage) => ({ ...message, usage });

  test('a hidden line gives its count to the reply that shows', () => {
    const groups = F.groupMessages([
      prose(1, 'user', 'une question'),
      shell(2, cost(40)),
      withCost(prose(3, 'assistant', 'la réponse'), null),
    ]);
    assert.equal(groups[0].usage, null, 'the person’s words carry no cost');
    assert.deepEqual(groups[1].usage, cost(40));
  });

  test('a strip of tool calls adds up every call in it, and the hidden line before it', () => {
    const groups = F.groupMessages([
      shell(1, cost(5, 100)),
      withCost(call(2, 'Bash'), cost(20, 200)),
      result(3),
      withCost(call(4, 'Read'), cost(30, 300)),
      result(5),
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].usage, {
      input: 3,
      output: 55,
      cacheRead: 600,
      cacheWrite: 30,
      reasoning: null,
    });
  });

  test('a count still carried when the person speaks goes back to the reply before', () => {
    const groups = F.groupMessages([
      withCost(prose(1, 'assistant', 'une réponse'), cost(10)),
      shell(2, cost(7)),
      prose(3, 'user', 'merci'),
      prose(4, 'assistant', 'de rien'),
    ]);
    assert.equal(groups[0].usage.output, 17);
    assert.equal(groups[1].usage, null);
    assert.equal(groups[2].usage, null, 'not the next reply: it did not produce that count');
  });

  test('a notice never takes a reply’s count', () => {
    const notice = { ...prose(2, 'user', '[Request interrupted by user]'), isNotice: true };
    const groups = F.groupMessages([shell(1, cost(9)), notice, prose(3, 'assistant', 'suite')]);
    assert.equal(groups[0].usage, null);
    assert.equal(groups[1].usage.output, 9, 'it goes on to the reply that follows');
  });

  test('sumUsage keeps an unmeasured field null, and a measured zero a zero', () => {
    assert.equal(F.sumUsage(null, null), null);
    assert.deepEqual(F.sumUsage({ input: null, output: 0 }, { input: null, output: 3 }), {
      input: null,
      output: 3,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    });
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
