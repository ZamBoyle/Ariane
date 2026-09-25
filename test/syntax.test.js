'use strict';

/**
 * La coloration syntaxique passe par highlight.js, qui écrit du HTML. Or
 * l'invariant 2 veut qu'innerHTML ne reçoive que ce qu'Ariane a échappé
 * elle-même : sa sortie est donc relue, jeton par jeton, et refusée si elle
 * contient autre chose que des span à classe hljs- autour du code exact.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

let S;
let F;
test.before(async () => {
  S = await import('../src/renderer/syntax.js');
  F = await import('../src/renderer/format.js');
});

/** Ce que la relecture accepte, vérifié ici une seconde fois, indépendamment. */
const onlySpans = (html) =>
  html
    .replace(/<span class="(?:hljs-[a-z][a-z_-]*(?: [a-z]+_+)*|language-[a-z0-9]+)">|<\/span>/g, '')
    .search(/[<>]/) === -1;
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

const LANGUAGES = [
  'bash',
  'sh',
  'shell',
  'js',
  'javascript',
  'ts',
  'sql',
  'cpp',
  'c',
  'json',
  'python',
  'py',
  'css',
  'powershell',
  'diff',
  'yaml',
  'html',
  'xml',
  'markdown',
  'dockerfile',
  'kotlin',
  'toml',
  'ini',
  'cfg',
  'rust',
  'swift',
  'php',
];

const HOSTILE = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  '\'; </span><span class="x" onclick="alert(1)">',
  '&lt;déjà échappé&gt; &amp; &#39;',
  '`${`<b>`}` /* </code></pre> */ -- # <!-- -->',
];

test('chaque langage mesuré est colorié, et ses alias aussi', () => {
  for (const language of LANGUAGES) {
    assert.ok(S.knowsLanguage(language), `${language} devrait être connu`);
  }
  assert.match(S.colourCode('for f in *; do echo "$f"; done', 'bash'), /hljs-keyword">for</);
  assert.match(S.colourCode('const x = 1;', 'js'), /hljs-keyword">const</);
  assert.match(S.colourCode('SELECT 1', 'sql'), /hljs-keyword">SELECT</);
  assert.match(S.colourCode('+ajout\n-retrait', 'diff'), /hljs-addition/);
  assert.match(
    S.colourCode('RUN apt-get update && echo "ok"', 'dockerfile'),
    /<span class="language-bash">/,
    'un Dockerfile passe la main à bash pour ses RUN : mesuré, 2 blocs sur 2 refusés sans cela'
  );
});

test('un langage inconnu, ou pas de langage, laisse le code tel quel : rien n’est deviné', () => {
  for (const language of [
    'asm',
    'text',
    'mcfunction',
    '',
    undefined,
    null,
    'constructor',
    '__proto__',
  ]) {
    assert.equal(S.colourCode('mov a, 1', language), null, String(language));
  }
  assert.equal(S.colourCode('', 'bash'), null, 'rien à colorier');
  assert.equal(S.colourCode(null, 'bash'), null);
});

test('du code piégé, dans chaque langage : des span hljs- autour du code exact, rien d’autre', () => {
  for (const language of LANGUAGES) {
    for (const payload of HOSTILE) {
      const code = `x = ${payload}\n${payload}`;
      const html = S.colourCode(code, language);
      if (html === null) continue; // refusé : l'appelant échappe lui-même
      assert.ok(onlySpans(html), `${language} : ${html}`);
      assert.equal(textOf(html), code, `${language} : le texte relu est le code donné`);
    }
  }
});

test('la relecture refuse tout ce que la bibliothèque n’écrit pas', () => {
  const code = 'a < b';
  assert.ok(S.readsBackAs('<span class="hljs-keyword">a</span> &lt; b', code));
  const forged = [
    '<span class="hljs-keyword" onclick="x">a</span> &lt; b',
    '<span class="evil">a</span> &lt; b',
    '<span class="language-bash x">a</span> &lt; b',
    '<span class=hljs-keyword>a</span> &lt; b',
    '<img src=x>a &lt; b',
    '<span class="hljs-keyword">a &lt; b',
    'a</span> &lt; b',
    'a < b',
    'a &lt; c',
    'a &#60; b',
    '<span class="hljs-keyword">a</span> &lt; b<script></script>',
  ];
  for (const html of forged) assert.equal(S.readsBackAs(html, code), false, html);
});

test('le rendu Markdown colore un bloc qui nomme son langage, et escape le reste lui-même', () => {
  const colour = S.colourCode;
  const html = F.renderMarkdown('```JS\nconst a = "<b>";\n```', { colour });
  assert.match(
    html,
    /^<pre class="code" data-lang="JS"><code><span class="hljs-keyword">const<\/span>/
  );
  assert.ok(html.includes('&lt;b&gt;'));
  assert.equal(
    F.renderMarkdown('```asm\nlda #$01\n```', { colour }),
    '<pre class="code" data-lang="asm"><code>lda #$01</code></pre>',
    'un langage sans grammaire reste du texte'
  );
  assert.equal(
    F.renderMarkdown('```\nfor f in *; do :; done\n```', { colour }),
    '<pre class="code"><code>for f in *; do :; done</code></pre>',
    'un bloc sans étiquette n’est pas deviné'
  );
  assert.equal(
    F.renderMarkdown('```bash\nls\n```'),
    '<pre class="code" data-lang="bash"><code>ls</code></pre>',
    'sans coloriste — les exports — rien ne change'
  );
  assert.equal(
    F.renderMarkdown('```js\nx\n```', { colour: () => '<img src=x onerror=alert(1)>' }).includes(
      '<img'
    ),
    true,
    'le rendu fait confiance au coloriste qu’on lui passe : c’est syntax.js qui relit'
  );
});

// Comme Claude Desktop : la commande elle-même, quelle qu'elle soit, et
// seulement là où un shell la lirait comme une commande (signalé le
// 25 septembre 2026 : sed, git et npm restaient en blanc, et le « test » de
// « npm test » s'allumait).
test.describe('une commande shell', () => {
  const commands = (code) =>
    [...S.colourCode(code, 'bash').matchAll(/<span class="hljs-built_in">([^<]*)<\/span>/g)].map(
      (m) => m[1]
    );

  test('le premier mot de chaque commande, où qu’elle commence', () => {
    assert.deepEqual(commands('sed -n 370,660p scripts/demo-corpus.js'), ['sed']);
    assert.deepEqual(commands('cat a.js; sed -n 1,60p b.js'), ['cat', 'sed']);
    assert.deepEqual(commands('git status && npm test | tail -n 3'), ['git', 'npm', 'tail']);
    assert.deepEqual(commands('a || b\nc'), ['a', 'b', 'c']);
    assert.deepEqual(commands('echo $(git rev-parse HEAD) `date`'), ['echo', 'git', 'date']);
    assert.deepEqual(commands('cd /tmp && ./run.sh ~/x'), ['cd', './run.sh']);
  });

  test('après ce qui lance la suivante : sudo, xargs, if, then, do, et des NOM=valeur', () => {
    assert.deepEqual(commands('sudo apt-get install -y git'), ['sudo', 'apt-get']);
    assert.deepEqual(commands('find . -name "*.js" | xargs grep -l TODO'), [
      'find',
      'xargs',
      'grep',
    ]);
    assert.deepEqual(commands('if grep -q x f; then make all; else echo non; fi'), [
      'grep',
      'make',
      'echo',
    ]);
    assert.deepEqual(commands('for f in *.md; do wc -l "$f"; done'), ['wc']);
    assert.deepEqual(commands('FOO=bar BAZ="a b" node x.js'), ['node']);
  });

  test('jamais un argument, un mot-clé, une affectation, une ligne continuée ou le corps d’un heredoc', () => {
    assert.deepEqual(commands('npm test'), ['npm'], 'le « test » de npm test est un argument');
    assert.deepEqual(commands('x=1; echo $x'), ['echo']);
    assert.deepEqual(
      commands('ls \\\n  --all \\\n  src/'),
      ['ls'],
      'une ligne qui continue la précédente'
    );
    assert.deepEqual(
      commands("python3 - <<'EOF'\nimport json\nprint(json)\nEOF\necho fini"),
      ['python3', 'echo'],
      'le heredoc est du texte'
    );
    assert.match(
      S.colourCode("cat <<'EOF'\nsed x\nEOF", 'bash'),
      /<span class="hljs-string">&lt;&lt;&#x27;EOF&#x27;\nsed x\nEOF<\/span>/
    );
    assert.deepEqual(commands('ifconfig eth0'), ['ifconfig'], 'if n’est un mot-clé qu’entier');
  });
});
