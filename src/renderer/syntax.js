/**
 * Syntax colouring, by highlight.js (BSD-3-Clause) — its browser build,
 * shipped inside the app: nothing is fetched, nothing is evaluated.
 *
 * Only the languages the conversations name are registered. Measured on
 * 25 September 2026 over 1 073 fenced blocks: bash 152 and sh 12, js 150 and
 * javascript 6, sql 42, cpp 42, json 40, python 11, c 11, css 7, powershell 5,
 * diff 4, then yaml, markdown, dockerfile, kotlin, toml, html, rust, swift, ini
 * and php; TypeScript rides along with JavaScript. A block that names no
 * language (468 of them) is never guessed: a wrong guess paints a log as code.
 *
 * The library writes HTML, and invariant 2 says innerHTML only ever receives
 * what Ariane escaped itself. So its output is not trusted: `colourCode` reads
 * it back token by token, accepts only `<span class="hljs-…">` (or
 * `language-…`, where a grammar hands over to another), `</span>`, the
 * five entities it escapes with, and text — and only if that text, read back,
 * is the code it was given, character for character. Anything else, and the
 * caller keeps the code plain, escaped by Ariane.
 *
 * No DOM here: the unit suite imports this module under Node.
 */

import hljs from '../../node_modules/@highlightjs/cdn-assets/es/core.min.js';
import bash from '../../node_modules/@highlightjs/cdn-assets/es/languages/bash.min.js';
import c from '../../node_modules/@highlightjs/cdn-assets/es/languages/c.min.js';
import cpp from '../../node_modules/@highlightjs/cdn-assets/es/languages/cpp.min.js';
import css from '../../node_modules/@highlightjs/cdn-assets/es/languages/css.min.js';
import diff from '../../node_modules/@highlightjs/cdn-assets/es/languages/diff.min.js';
import dockerfile from '../../node_modules/@highlightjs/cdn-assets/es/languages/dockerfile.min.js';
import ini from '../../node_modules/@highlightjs/cdn-assets/es/languages/ini.min.js';
import javascript from '../../node_modules/@highlightjs/cdn-assets/es/languages/javascript.min.js';
import json from '../../node_modules/@highlightjs/cdn-assets/es/languages/json.min.js';
import kotlin from '../../node_modules/@highlightjs/cdn-assets/es/languages/kotlin.min.js';
import markdown from '../../node_modules/@highlightjs/cdn-assets/es/languages/markdown.min.js';
import php from '../../node_modules/@highlightjs/cdn-assets/es/languages/php.min.js';
import powershell from '../../node_modules/@highlightjs/cdn-assets/es/languages/powershell.min.js';
import python from '../../node_modules/@highlightjs/cdn-assets/es/languages/python.min.js';
import rust from '../../node_modules/@highlightjs/cdn-assets/es/languages/rust.min.js';
import sql from '../../node_modules/@highlightjs/cdn-assets/es/languages/sql.min.js';
import swift from '../../node_modules/@highlightjs/cdn-assets/es/languages/swift.min.js';
import typescript from '../../node_modules/@highlightjs/cdn-assets/es/languages/typescript.min.js';
import xml from '../../node_modules/@highlightjs/cdn-assets/es/languages/xml.min.js';
import yaml from '../../node_modules/@highlightjs/cdn-assets/es/languages/yaml.min.js';

/**
 * Words after which the next one is a command too: `sudo git push`,
 * `xargs rm`, `if grep -q`, `then make`.
 */
const LEADS = [
  'sudo',
  'xargs',
  'exec',
  'nohup',
  'env',
  'time',
  'command',
  'builtin',
  'nice',
  'watch',
];

/**
 * bash as Claude Desktop shows a command: the command itself in colour — the
 * first word of each simple command, whatever it is. highlight.js colours
 * only the words on its list of built-ins, and colours them anywhere: `sed`,
 * `git` and `npm` stayed plain while the `test` of `npm test` lit up (reported
 * with screenshots, 25 September 2026). So the list goes, and the position
 * decides: a line's start (not a continued one), after `;`, `&&`, `||`, `|`,
 * `(`, a backquote or `$(`, after a keyword that opens a command (`then`,
 * `do`, `if`…) or a word that runs the next (`sudo`, `xargs`…), past any
 * `NAME=value` in front. A heredoc's body is text, as a string is: its lines
 * are not commands.
 */
function shell(hljs) {
  const grammar = bash(hljs);
  // Its built-ins are coloured anywhere; the position does it instead.
  const keywords = { ...grammar.keywords };
  delete keywords.built_in;
  const reserved = keywords.keyword.join('|');
  const opens = ['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', ...LEADS].join('|');
  // A line's start — unless the line before ends in a backslash, which
  // continues it — or a separator, `$(` included through its parenthesis.
  const where = String.raw`(?:(?<!\\\n)^|[;&|({\x60]|(?:^|[\s;&|(])(?:${opens})(?=[ \t]))`;
  const assignments = String.raw`(?:[A-Za-z_]\w*=(?:"[^"\n]*"|'[^'\n]*'|[^\s;&|]*)[ \t]+)*`;
  const word = String.raw`[\w.+~/:@-]`;
  const command = {
    scope: 'built_in',
    match: new RegExp(
      String.raw`(?<=${where}[ \t]*${assignments})(?!(?:${reserved})(?!${word}))[A-Za-z_.~/]${word}*(?![\w=])`
    ),
    relevance: 0,
  };
  const heredoc = hljs.END_SAME_AS_BEGIN({
    scope: 'string',
    begin: /<<-?[ \t]*['"]?([A-Za-z_]\w*)['"]?/,
    end: /^[ \t]*([A-Za-z_]\w*)(?=[ \t]*$)/,
    relevance: 0,
  });
  // `<<<` is a here-string: one word follows, not a body running to a
  // delimiter. Taken first, so neither heredoc rule — this one or the
  // grammar's own — reads its first two `<` as theirs.
  const hereString = { match: /<<</, relevance: 0 };
  return { ...grammar, keywords, contains: [hereString, heredoc, command, ...grammar.contains] };
}

const GRAMMARS = {
  bash: shell,
  c,
  cpp,
  css,
  diff,
  dockerfile,
  ini,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  powershell,
  python,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

// Its own instance: nothing else in the page can register into it.
const engine = hljs.newInstance();
for (const [name, grammar] of Object.entries(GRAMMARS)) engine.registerLanguage(name, grammar);
// The names the conversations use that the grammars do not declare themselves.
engine.registerAliases(['shell'], { languageName: 'bash' });
engine.registerAliases(['cfg'], { languageName: 'ini' });

/** What the library may write, and nothing else: one token at a time, from where the last one ended. */
// A class is a scope (`hljs-keyword`, `hljs-title function_`), or the
// language a grammar hands a stretch to (a Dockerfile's RUN is bash).
const TOKEN =
  /<span class="(?:hljs-[a-z][a-z_-]*(?: [a-z]+_+)*|language-[a-z0-9]+)">|<\/span>|&(amp|lt|gt|quot|#x27);|[^<&]+/y;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'" };

/** Whether a fence's language, or a tool's, is one this module colours. */
export function knowsLanguage(language) {
  return typeof language === 'string' && language !== '' && Boolean(engine.getLanguage(language));
}

/**
 * `code` coloured as `language`: HTML made of the code's own text, escaped, in
 * spans whose only attribute is an `hljs-` class — or null, when the language
 * is not one of ours or the library wrote anything else.
 * @param {string} code
 * @param {string} language
 * @returns {string|null}
 */
export function colourCode(code, language) {
  if (typeof code !== 'string' || code === '' || !knowsLanguage(language)) return null;
  let html;
  try {
    html = engine.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
  return readsBackAs(html, code) ? html : null;
}

/**
 * Walk the library's output: only allowed tokens, balanced, and exactly the
 * code as text. Exported for the tests — a guard is only as good as what it
 * refuses.
 */
export function readsBackAs(html, code) {
  let text = '';
  let depth = 0;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < html.length) {
    const at = TOKEN.lastIndex;
    const token = TOKEN.exec(html);
    if (!token) return false;
    const piece = token[0];
    if (piece.startsWith('<span')) depth++;
    else if (piece === '</span>') {
      if (--depth < 0) return false;
    } else if (token[1]) text += ENTITIES[token[1]];
    else text += piece;
    if (TOKEN.lastIndex === at) return false;
  }
  return depth === 0 && text === code;
}
