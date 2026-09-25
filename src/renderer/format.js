/**
 * Pure formatting helpers shared by the UI.
 *
 * No DOM, no side effects, so every rule here is unit-testable — including the
 * security-critical one: transcripts contain arbitrary text (shell commands,
 * HTML, code that people pasted), and none of it may ever reach the DOM as
 * markup. The order is always the same: escape first, decorate second.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape every character that could open a tag or close an attribute. */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Sentinels used by SQLite's snippet(); see db.js. */
export const HL_OPEN = String.fromCharCode(1);
export const HL_CLOSE = String.fromCharCode(2);

/**
 * Turn an FTS snippet into safe highlighted HTML.
 * The sentinels are swapped for <mark> only AFTER escaping, so a message
 * containing a literal "<mark>" stays inert text.
 */
export function renderSnippet(snippet) {
  return escapeHtml(snippet).split(HL_OPEN).join('<mark>').split(HL_CLOSE).join('</mark>');
}

/**
 * The Markdown the assistants actually write: fenced code, headings, lists
 * (nested, and numbered from wherever they start), blockquotes, GFM tables and
 * rules; inline code, bold, italic, strikethrough and links. Anything else
 * renders as plain text.
 *
 * Written here rather than taken from a library, on a measure: on a corpus of
 * 9 379 messages (23 September 2026), tables appeared in 483, links in 226,
 * nested lists in 205, rules in 183, strikethrough in 31 — task lists,
 * level-5 headings and `_underscore_` emphasis in none. marked or markdown-it
 * would bring the whole of GFM, but they emit raw HTML, which makes a sanitiser
 * mandatory: two dependencies inside the sandbox, standing in for the one rule
 * that keeps it safe. Should the list of gaps start growing again — maths,
 * footnotes, HTML inside Markdown — that trade becomes the right one, and it
 * stays contained: this function has two callers.
 *
 * Fenced blocks are extracted before anything else, so `**` inside code is
 * never mistaken for emphasis.
 */
export function renderMarkdown(text) {
  if (!text) return '';

  const blocks = [];
  const withPlaceholders = String(text).replace(
    /```([\w+-]*)\n?([\s\S]*?)```/g,
    (_match, lang, code) => {
      const index = blocks.length;
      blocks.push(
        `<pre class="code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>` +
          `<code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
      );
      return `\u0000BLOCK${index}\u0000`;
    }
  );

  const html = withPlaceholders
    .split(/\n{2,}/)
    .map((paragraph) => renderParagraph(paragraph))
    .filter(Boolean)
    .join('');

  return html.replace(/\u0000BLOCK(\d+)\u0000/g, (_m, i) => blocks[Number(i)] || '');
}

function renderParagraph(raw) {
  // Dedented rather than trimmed: trimming only the first line would make
  // the second item of an indented list look nested under the first.
  const lines = dedent(raw.split('\n'));
  if (!lines.length) return '';
  const chunk = lines.join('\n');
  if (/^\u0000BLOCK\d+\u0000$/.test(chunk)) return chunk;

  if (lines.every((l) => /^\s*>/.test(l))) {
    return `<blockquote>${inline(lines.map((l) => l.replace(/^\s*>\s?/, '')).join('\n'))}</blockquote>`;
  }

  return renderLines(lines);
}

/** Drop blank lines at both ends, and the indentation every line shares. */
function dedent(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  const kept = lines.slice(start, end);
  const shared = Math.min(...kept.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
  return kept.map((l) => l.slice(shared).trimEnd());
}

/** A heading, on a line of its own: "# " to "#### ". */
const HEADING = /^(#{1,4})\s+(.*)$/;
/** A thematic break: three or more of the same mark, alone on its line. */
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})$/;
/** A bullet item: "- ", "* " or "+ " opening a line. */
const BULLET = /^(\s*)[-*+]\s+/;
/** An ordered item: "1. " or "1) ". Nine digits at most, as in CommonMark. */
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+/;
/**
 * Only an item numbered 1 may interrupt prose, as in CommonMark: a sentence
 * that happens to wrap onto "2004. Cette année-là…" must stay a sentence.
 */
const ORDERED_START = /^\s*1[.)]\s+/;

/**
 * Prose, lists, tables, headings and rules, in the order they come.
 *
 * A list may follow a line of prose directly, with no blank line between —
 * which is how Claude writes nearly every list: "Deux options :\n- a\n- b".
 * Requiring the blank line left 1017 of 7629 real messages showing raw dashes
 * — 613 from the assistant, and 404 typed by the person. Compared before and
 * after on that corpus: every one of them gained a list, and no word changed.
 * An indented line right after an item that is not itself an item is that
 * item wrapping. A table and a heading may follow prose the same way.
 */
function renderLines(lines) {
  // A diff pasted without a fence would otherwise become bullets, and the
  // markers that say which line was removed and which added would be eaten.
  if (looksLikeDiff(lines)) return `<p>${inline(lines.join('\n'))}</p>`;

  const out = [];
  let run = null;

  const close = () => {
    if (!run) return;
    out.push(run.kind === 'p' ? `<p>${inline(run.lines.join('\n'))}</p>` : renderList(run.items));
    run = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      if (run && run.kind === 'p') run.lines.push(line);
      continue;
    }

    const table = tableAt(lines, i);
    if (table) {
      close();
      out.push(table.html);
      i = table.end - 1;
      continue;
    }

    if (RULE.test(line)) {
      close();
      out.push('<hr>');
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      close();
      const level = heading[1].length + 1; // h1 is reserved for the app chrome
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const item = listItem(line, run);
    if (item) {
      if (!run || run.kind !== 'list') {
        close();
        run = { kind: 'list', items: [] };
      }
      run.items.push(item);
      continue;
    }

    if (run && run.kind === 'list' && /^\s+\S/.test(line)) {
      run.items[run.items.length - 1].text += `\n${line.trim()}`;
      continue;
    }

    if (!run || run.kind !== 'p') {
      close();
      run = { kind: 'p', lines: [] };
    }
    run.lines.push(line);
  }

  close();
  return out.join('');
}

/** A tab counts as four columns, as in CommonMark. */
function indentOf(line) {
  return /^\s*/.exec(line)[0].replace(/\t/g, '    ').length;
}

/**
 * The line as a list item, or null.
 *
 * A bullet always opens an item. A number does only where it cannot be a
 * sentence: at 1, at the start of a block, nested under an item, or where the
 * last item at its own depth was numbered too — "2." after the bullets nested
 * under "1." continues the steps.
 */
function listItem(line, run) {
  const bullet = BULLET.exec(line);
  if (bullet) {
    return { kind: 'ul', indent: indentOf(line), text: line.slice(bullet[0].length) };
  }
  const ordered = ORDERED.exec(line);
  if (!ordered) return null;
  const indent = indentOf(line);
  const items = run && run.kind === 'list' ? run.items : [];
  const last = items[items.length - 1];
  const sibling = items.findLast((it) => it.indent <= indent + 1);
  const accepted =
    !run ||
    ORDERED_START.test(line) ||
    (last && indent > last.indent) ||
    (sibling && sibling.kind === 'ol' && indent >= sibling.indent - 1);
  if (!accepted) return null;
  return {
    kind: 'ol',
    indent,
    number: Number(ordered[2]),
    text: line.slice(ordered[0].length),
  };
}

/**
 * Items become nested lists by their indentation. Two columns deeper than
 * the list above opens a list inside its last item; one column either way is
 * the same list, written unevenly. A numbered list keeps its first number,
 * so "3." after a blank line does not start again at 1.
 */
function renderList(items) {
  let html = '';
  const open = [];
  const openTag = (item) =>
    item.kind === 'ol' && item.number !== 1 ? `<ol start="${item.number}">` : `<${item.kind}>`;

  for (const item of items) {
    while (open.length && item.indent < open[open.length - 1].indent - 1) {
      html += `</li></${open.pop().kind}>`;
    }
    const top = open[open.length - 1];
    if (!top || item.indent >= top.indent + 2) {
      html += openTag(item);
      open.push({ kind: item.kind, indent: item.indent });
    } else if (top.kind !== item.kind) {
      html += `</li></${top.kind}>${openTag(item)}`;
      top.kind = item.kind;
    } else {
      html += '</li>';
    }
    html += `<li>${inline(item.text)}`;
  }
  while (open.length) html += `</li></${open.pop().kind}>`;
  return html;
}

/**
 * A GFM table starting at line i, or null: a row holding a pipe, then a
 * delimiter row with as many cells. It runs until a line with no pipe — GFM
 * would take such a line as one more row, but prose written straight under a
 * table is prose.
 *
 * A row shorter than the header is padded, as GFM does. A longer one keeps its
 * extra cells, where GFM drops them: a viewer of conversations must not drop
 * words. Measured: one table in 483 had such a row, and lost "12 ✓" with it.
 * The table sits in its own box, which scrolls: a wide table must not push
 * the conversation sideways.
 */
function tableAt(lines, i) {
  if (i + 1 >= lines.length || !lines[i].includes('|')) return null;
  const head = cellsOf(lines[i]);
  const align = alignmentsOf(lines[i + 1]);
  if (!align || align.length !== head.length) return null;

  let end = i + 2;
  const rows = [];
  while (end < lines.length && lines[end].includes('|')) {
    rows.push(cellsOf(lines[end]));
    end++;
  }

  const cell = (tag, text, how) =>
    `<${tag}${how ? ` class="align-${how}"` : ''}>${inline(text)}</${tag}>`;
  const headRow = head.map((text, k) => cell('th', text, align[k])).join('');
  const body = rows
    .map((row) => {
      const width = Math.max(row.length, head.length);
      const cells = Array.from({ length: width }, (_, k) => cell('td', row[k] ?? '', align[k]));
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  return {
    end,
    html:
      `<div class="table-wrap"><table><thead><tr>${headRow}</tr></thead>` +
      `${body ? `<tbody>${body}</tbody>` : ''}</table></div>`,
  };
}

/** The cells of a table row. "\|" is a pipe inside a cell, not a border. */
function cellsOf(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** A delimiter row's alignments ('center', 'right' or null), or null if it is not one. */
function alignmentsOf(line) {
  if (!line.includes('|')) return null;
  const cells = cellsOf(line);
  if (!cells.every((c) => /^:?-+:?$/.test(c))) return null;
  return cells.map((c) => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : null));
}

/**
 * Both a removed and an added line, or a hunk header: a unified diff, not a
 * list. Defensive — no such block exists in the corpus this was measured on —
 * but a diff whose markers vanished would misreport what was changed.
 */
function looksLikeDiff(lines) {
  if (lines.some((l) => l.startsWith('@@ '))) return true;
  return lines.some((l) => /^-(?!-)/.test(l)) && lines.some((l) => /^\+(?!\+)/.test(l));
}

/**
 * Stands in for markup already built, so that no later rule reaches into it:
 * a `*` in a url is not emphasis, and a url inside code is not a link.
 */
const KEPT = /\u0003(\d+)\u0003/g;

/** A link: [label](url). One level of parentheses inside the url, for Wikipedia. */
const LINK = /\[([^\]\n]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g;

/**
 * A url written bare. It must follow a space, an opening bracket, a quote or
 * an emphasis mark — never a letter — and stops at the escaped form of any
 * character that could close an attribute.
 */
const BARE_URL =
  /(^|[\s(*_~]|&lt;|&quot;|&#39;)(https?:\/\/(?:(?!&(?:lt|gt|quot|#39);)[^\s\u0003])+)/g;

/**
 * Only the web is a link. Anything else — a path in the project, `file:`,
 * `javascript:` — keeps its label and loses its target. The window's own
 * guard (main.js, setWindowOpenHandler) checks the same thing again in the
 * main process: a link opens in the browser, never in Ariane.
 */
const WEB = /^https?:\/\//i;

const anchor = (url, label) =>
  `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;

/** Inline rules, applied to already-escaped text. */
function inline(raw) {
  const kept = [];
  const keep = (html) => `\u0003${kept.push(html) - 1}\u0003`;
  const restore = (s) => s.replace(KEPT, (_m, i) => restore(kept[Number(i)] ?? ''));

  const text = emphasis(
    escapeHtml(raw)
      .replace(/\u0003/g, '')
      .replace(/`([^`\n]+)`/g, (_m, code) => keep(`<code>${code}</code>`))
      .replace(LINK, (_m, label, url) =>
        WEB.test(url) ? keep(anchor(url, emphasis(label))) : label
      )
      .replace(BARE_URL, (_m, before, found) => {
        const { url, tail } = splitTrailing(found);
        return `${before}${keep(anchor(url, url))}${tail}`;
      })
  ).replace(/\n/g, '<br>');

  return restore(text);
}

function emphasis(s) {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
}

/**
 * The punctuation that ends a sentence is not part of the url it follows, nor
 * is a closing bracket the url never opened. An entity's own semicolon stays.
 */
function splitTrailing(found) {
  let url = found;
  let tail = '';
  for (;;) {
    const last = url.slice(-1);
    const unopened = last === ')' && url.split('(').length < url.split(')').length;
    const entity = last === ';' && /&#?\w+;$/.test(url);
    if (unopened || (/[.,:;!?*_~]/.test(last) && !entity)) {
      tail = last + tail;
      url = url.slice(0, -1);
    } else {
      return { url, tail };
    }
  }
}

// -- display helpers ---------------------------------------------------------

/**
 * A model's name as the screen shows it: the last segment of a routed id
 * ("copilot/claude-sonnet-4.5" → "claude-sonnet-4.5"), and nothing for the
 * placeholders an agent writes on turns no model produced ("<synthetic>").
 */
export function modelName(raw) {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || /^<.*>$/.test(id)) return '';
  return id.split('/').pop();
}

/**
 * A conversation's models for the sidebar, the one that answered most first.
 *
 * `session.models` is what db.sessions counted: `[{model, replies}]`. Routes
 * are stripped and placeholders dropped (modelName), and two routes to one
 * model count as one. Ties go to the name, so the order never flickers.
 *
 * @returns {string[]} Names, most replies first; empty when none is known.
 */
export function sessionModels(session) {
  const counts = new Map();
  for (const entry of Array.isArray(session && session.models) ? session.models : []) {
    const name = modelName(entry && entry.model);
    const replies = Number(entry && entry.replies) || 0;
    if (name && replies > 0) counts.set(name, (counts.get(name) || 0) + replies);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

/**
 * The models that answered in a conversation, in the order they first did,
 * and the replies where one takes over from another.
 *
 * A reply is marked only when its model differs from the previous reply's:
 * the same name on two hundred replies in a row says nothing. When one model
 * answered all along, no reply is marked at all — the header names it. When
 * several did, the first reply is marked too, so every stretch is labelled.
 * Only replies with prose count; a tool call alone is not shown as a reply.
 *
 * @param {Array<{id: number, role: string, model?: string, text?: string}>} messages In order.
 * @returns {{models: string[], changes: Map<number, string>}}
 */
export function modelMarks(messages) {
  const models = [];
  const changes = new Map();
  let previous = null;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || message.role !== 'assistant' || !(message.text || '').trim()) continue;
    const name = modelName(message.model);
    if (!name) continue;
    if (!models.includes(name)) models.push(name);
    if (name !== previous) changes.set(message.id, name);
    previous = name;
  }
  if (models.length < 2) changes.clear();
  return { models, changes };
}

/**
 * What a conversation cost, as three figures that each mean one thing — or
 * null when its assistant recorded nothing at all.
 *
 *   sent       input + cacheWrite: what was new in the prompts. Fresh input
 *              alone is a few hundred tokens for a whole conversation
 *              (median 170) because Claude sends nearly everything new through
 *              the cache; its writes are the real material (median 166 K).
 *   received   output, reasoning included (median 78 K).
 *   cacheRead  the context read back at every call — kept apart on purpose.
 *              It is 97.8 % of the total (median 5.9 M, up to 1.01 G); folded
 *              into "sent", it would claim a billion were sent. That is the
 *              mistake ccusage avoids with separate columns, and the one a
 *              "1 billion tokens, 97 % cache" post was written about.
 *
 * A figure the agent did not record stays null (contract.js).
 */
export function sessionTokens(session) {
  if (!session) return null;
  const measured = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const input = measured(session.tokInput);
  const output = measured(session.tokOutput);
  const cacheRead = measured(session.tokCacheRead);
  const cacheWrite = measured(session.tokCacheWrite);
  if ([input, output, cacheRead, cacheWrite].every((v) => v === null)) return null;

  const sent = input === null && cacheWrite === null ? null : (input ?? 0) + (cacheWrite ?? 0);
  return { sent, received: output, cacheRead, input, cacheWrite };
}

/**
 * What a conversation's subagents cost, in the same three figures, apart from
 * its own: they are opened from it, never listed. Null when it launched none.
 */
export function subagentTokens(session) {
  if (!session || !session.subagents) return null;
  const usage = sessionTokens({
    tokInput: session.subInput,
    tokOutput: session.subOutput,
    tokCacheRead: session.subCacheRead,
    tokCacheWrite: session.subCacheWrite,
  });
  return {
    count: session.subagents,
    ...(usage || { sent: null, received: null, cacheRead: null }),
  };
}

/** Split a path into its last segment and its parent, for a two-line label. */
export function folderLabel(fullPath) {
  const value = String(fullPath || '');
  const parts = value.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return { name: value || '/', parent: '' };
  return {
    name: parts[parts.length - 1],
    parent: parts.slice(0, -1).join('/') || '/',
  };
}

/**
 * Text folded for searching: no case, no accents — the same leniency as the
 * index's own search (unicode61, remove_diacritics), so "numero" finds
 * "numéro" in the open conversation just as it does across all of them.
 */
export function foldForSearch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/**
 * Where `needle` occurs in `text`, ignoring case and accents, as [start, end)
 * ranges of the ORIGINAL text — so a match can be marked without changing a
 * single character of what is shown. Folding can change a string's length
 * ("é" → "e"), hence the map from folded positions back to original ones.
 *
 * @returns {Array<[number, number]>}
 */
export function findRanges(text, needle) {
  const wanted = foldForSearch(needle);
  if (!wanted || !text) return [];

  let folded = '';
  const origin = []; // folded index -> original index
  for (let i = 0; i < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(i));
    // Unit by unit, not code point by code point: indexOf counts UTF-16 units,
    // and an emoji is two of them. Counting it as one shifted every later
    // match by one, and would have cut the marked word in the wrong place.
    const piece = foldForSearch(char);
    for (let k = 0; k < piece.length; k++) {
      folded += piece[k];
      origin.push(i);
    }
    i += char.length;
  }

  const ranges = [];
  for (let at = folded.indexOf(wanted); at !== -1; at = folded.indexOf(wanted, at + wanted.length)) {
    const last = origin[at + wanted.length - 1];
    ranges.push([origin[at], last + String.fromCodePoint(text.codePointAt(last)).length]);
  }
  return ranges;
}

/** First meaningful line of a prompt, for a list preview. */
export function preview(text, max = 120) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
}

/**
 * Does a message carry anything worth rendering?
 *
 * Roughly a fifth of recorded messages are empty shells: an assistant turn whose
 * only block was a redacted `thinking` entry (signature present, prose empty).
 * They hold no information, so the reader skips them rather than printing a row
 * of "(empty message)" placeholders.
 */
export function hasContent(message) {
  if (!message) return false;
  if (message.text && message.text.trim()) return true;
  // A notice Ariane names itself says something by its name alone: "request cancelled".
  if (message.isNotice && noticeCode(message.command)) return true;
  if (message.thinking && message.thinking.trim()) return true;
  return (Array.isArray(message.parts) ? message.parts : []).some(isDrawn);
}

/**
 * Does this part put anything on screen? It must answer exactly what
 * `appendPart` in the renderer does, or a row appears with nothing inside it.
 *
 * Counting parts rather than drawn parts left six empty bubbles on a corpus of
 * 38 222 messages: four Claude `fallback` blocks (the record of a mid-request
 * model switch, carrying no prose) and two VS Code turns holding only UI
 * metadata. A `thinking` part draws from `message.thinking`, tested above.
 */
function isDrawn(part) {
  if (!part) return false;
  if (part.type === 'tool_use' || part.type === 'tool_result') return true;
  if (part.type === 'attachment' || part.type === 'pasted') return true;
  if (part.type === 'text') return Boolean(String(part.text || '').trim());
  return false;
}

/**
 * Is this "user" turn actually the tool answering, rather than the person?
 *
 * Claude Code records a tool result as a record of type "user", because the API
 * carries tool results inside a user-role message. Rendering that under the
 * person's name makes them appear to have typed the output of `git status`.
 * Measured on a real corpus: 5983 such blocks, every one mislabelled.
 *
 * The turn is the tool's when it carries no prose of its own and every part is
 * a tool result or an attachment.
 */
export function isToolResultTurn(message) {
  if (!message || message.role !== 'user') return false;
  if (message.text && message.text.trim()) return false;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  if (parts.length === 0) return false;
  return parts.every((p) => p.type === 'tool_result' || p.type === 'attachment');
}

/**
 * Who to credit a message to: the person, the assistant, or nobody — null is
 * how tool output and harness notices avoid being put in someone's mouth.
 *
 * A role, not a name: the caller names it, in the reader's language, and with
 * the conversation's own assistant — a Codex conversation labelled "Claude" is
 * the same class of error as crediting the person with `git status`. Comparing
 * roles also keeps working in every language, where comparing a name against
 * "Vous" did not.
 *
 * @param {object} message
 * @returns {'you'|'assistant'|null}
 */
export function speakerOf(message) {
  if (!message) return null;
  if (message.isNotice) return null;
  if (isToolResultTurn(message)) return null;

  // A sidechain is a subagent's own exchange, embedded in the transcript. Its
  // "user" turn is the briefing the assistant wrote to that subagent, not
  // anything the person typed. The flag is extracted and stored; until now the
  // renderer never read it, so such a turn would carry the person's name.
  if (message.isSidechain && message.role === 'user') return null;

  return message.role === 'user' ? 'you' : 'assistant';
}

/**
 * The notices Ariane names itself, as the codes the index stores. Indexes
 * written before the app spoke more than French stored the French words
 * instead; they are recognised here, so an existing index needs no rebuild.
 * Anything else — a slash command such as `/model` — is the tool's own word
 * and is shown as it was written.
 */
const NOTICE_CODES = new Set(['away-summary', 'compact-boundary', 'failure', 'cancelled']);
const LEGACY_NOTICE_NAMES = {
  'Résumé de session': 'away-summary',
  'Conversation compactée': 'compact-boundary',
  'Échec': 'failure',
};

/** @returns {string|null} A notice code to translate, or null to show the name as stored. */
export function noticeCode(command) {
  const name = command && typeof command.name === 'string' ? command.name : '';
  if (NOTICE_CODES.has(name)) return name;
  return Object.hasOwn(LEGACY_NOTICE_NAMES, name) ? LEGACY_NOTICE_NAMES[name] : null;
}

/** What a command tag reads: Ariane's own notices in the reader's language, anything else as stored. */
export function commandLabel(command, { t }) {
  const code = noticeCode(command);
  if (code) return t(`notice-${code}`);
  return command && command.name ? command.name : '';
}

/** What a notice is called: Ariane's own name for it, the tool's, or who it came from. */
export function noticeLabel(message, l10n) {
  const named = commandLabel(message.command, l10n);
  if (named) return named;
  return message.isSidechain ? l10n.t('notice-subagent') : l10n.t('notice-generic');
}

/**
 * Is this turn nothing but tool machinery — a call, a result, an attachment?
 *
 * Such turns carry no words from either party. Shown one per row they drown the
 * conversation: a single exchange can be twenty consecutive bubbles saying only
 * "Outil Bash" / "Résultat". They are grouped instead (see groupMessages).
 */
export function isToolOnlyTurn(message) {
  if (!message) return false;
  if (message.text && message.text.trim()) return false;
  if (message.thinking && message.thinking.trim()) return false;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  if (parts.length === 0) return false;
  return parts.every(
    (p) => p.type === 'tool_use' || p.type === 'tool_result' || p.type === 'attachment'
  );
}

/**
 * Collapse a transcript into what is worth showing as rows.
 *
 * Runs of consecutive tool-only turns become ONE entry, so the reader sees the
 * prose with a single compact strip standing in for the machinery. Empty shells
 * are dropped on the way through.
 *
 * @returns {Array<{type:'message', message:object} | {type:'toolRun', messages:object[]}>}
 */
export function groupMessages(messages) {
  const out = [];
  let run = null;
  // What each group cost (`usage`), for a reader who wants to see it. A reply's
  // count often sits on a line nothing shows: Claude's masked reasoning holds
  // it in 10 095 of 19 699 counted lines (25 September 2026). It is carried to
  // the next thing the reply shows — its prose, or its strip of tool calls,
  // which adds up every call in it — and never lands on the person's words:
  // a count still carried when they speak again goes back to the reply before.
  let carried = null;
  let lastReply = null;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!hasContent(message)) {
      carried = sumUsage(carried, message.usage);
      continue;
    }

    let group;
    if (isToolOnlyTurn(message)) {
      if (!run) {
        run = { type: 'toolRun', messages: [], usage: null };
        out.push(run);
      }
      run.messages.push(message);
      group = run;
    } else {
      run = null;
      group = { type: 'message', message, usage: null };
      out.push(group);
    }

    if (group.type === 'toolRun' || message.role === 'assistant') {
      group.usage = sumUsage(sumUsage(group.usage, carried), message.usage);
      carried = null;
      lastReply = group;
    } else if (speakerOf(message) === 'you' && carried && lastReply) {
      lastReply.usage = sumUsage(lastReply.usage, carried);
      carried = null;
    }
  }
  if (carried && lastReply) lastReply.usage = sumUsage(lastReply.usage, carried);
  return out;
}

const USAGE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];

/** Two counts added field by field; a field neither measured stays null. */
export function sumUsage(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return a;
  const total = {};
  for (const key of USAGE_KEYS) {
    total[key] = a[key] == null && b[key] == null ? null : (a[key] ?? 0) + (b[key] ?? 0);
  }
  return total;
}

/**
 * Describe a tool run for its collapsed header.
 *
 * A run does not always contain calls: when the call sat on a message that also
 * had prose, only its result is left to group. Announcing "1 tool call" there
 * would be a small lie, so `kind` says what the heading should count: calls,
 * else results, else attachments. The words are the caller's, in its language.
 *
 * @returns {{calls: number, results: number, errors: number, attachments: number,
 *            kind: 'calls'|'results'|'attachments', count: number, label: string}}
 */
export function describeToolRun(messages) {
  const names = new Map();
  let calls = 0;
  let results = 0;
  let errors = 0;
  let attachments = 0;

  for (const message of Array.isArray(messages) ? messages : []) {
    for (const part of message.parts || []) {
      if (part.type === 'tool_use') {
        calls += 1;
        const name = part.name || '?';
        names.set(name, (names.get(name) || 0) + 1);
      } else if (part.type === 'tool_result') {
        results += 1;
        if (part.isError) errors += 1;
      } else if (part.type === 'attachment') {
        attachments += 1;
      }
    }
  }

  const label = [...names.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, n]) => (n > 1 ? `${name}\u00a0\u00d7${n}` : name))
    .join(', ');

  const kind = calls > 0 ? 'calls' : results > 0 ? 'results' : 'attachments';
  const count = { calls, results, attachments }[kind];
  return { calls, results, errors, attachments, kind, count, label };
}

/**
 * Visual identity for an agent.
 *
 * Colours are stated as CSS custom-property names rather than literals so the
 * palette stays in the stylesheet, where light and dark themes are defined
 * together. An unknown agent gets a neutral identity rather than no identity:
 * a new adapter must be visible before anyone writes its theme.
 */
const AGENT_THEMES = {
  claude: { label: 'Claude', initial: 'C' },
  codex: { label: 'Codex', initial: 'X' },
  gemini: { label: 'Gemini', initial: 'G' },
  qwen: { label: 'Qwen', initial: 'Q' },
  'copilot-cli': { label: 'Copilot', initial: 'P' },
  antigravity: { label: 'Antigravity', initial: 'A' },
  vscode: { label: 'VS Code', initial: 'V' },
};

export function agentTheme(agentId, fallbackLabel = '') {
  const known = AGENT_THEMES[agentId];
  if (known) return { id: agentId, ...known };
  const label = fallbackLabel || agentId || 'Agent';
  return { id: agentId || 'unknown', label, initial: label.slice(0, 1).toUpperCase() };
}
