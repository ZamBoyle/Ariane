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
 * A deliberately small Markdown subset: fenced code, inline code, bold, italic,
 * headings, lists, blockquotes. Anything else renders as plain text.
 *
 * Fenced blocks are extracted before inline rules run, so `**` inside code is
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
  const chunk = raw.trim();
  if (!chunk) return '';
  if (/^\u0000BLOCK\d+\u0000$/.test(chunk)) return chunk;

  const heading = /^(#{1,4})\s+(.*)$/.exec(chunk);
  if (heading) {
    const level = heading[1].length + 1; // h1 is reserved for the app chrome
    return `<h${level}>${inline(heading[2])}</h${level}>`;
  }

  const lines = chunk.split('\n');

  if (lines.every((l) => /^\s*>/.test(l))) {
    return `<blockquote>${inline(lines.map((l) => l.replace(/^\s*>\s?/, '')).join('\n'))}</blockquote>`;
  }

  return renderLines(lines);
}

/** A bullet item: "- ", "* " or "+ " opening a line. */
const BULLET = /^\s*[-*+]\s+/;
/** An ordered item: "1. " or "1) ". */
const ORDERED = /^\s*\d+[.)]\s+/;
/**
 * Only an item numbered 1 may interrupt prose, as in CommonMark: a sentence
 * that happens to wrap onto "2004. Cette année-là…" must stay a sentence.
 */
const ORDERED_START = /^\s*1[.)]\s+/;

/**
 * Prose and lists, in the order they come.
 *
 * A list may follow a line of prose directly, with no blank line between —
 * which is how Claude writes nearly every list: "Deux options :\n- a\n- b".
 * Requiring the blank line left 1017 of 7629 real messages showing raw dashes
 * — 613 from the assistant, and 404 typed by the person. Compared before and
 * after on that corpus: every one of them gained a list, and no word changed.
 * An indented line right after an item is that item wrapping.
 */
function renderLines(lines) {
  // A diff pasted without a fence would otherwise become bullets, and the
  // markers that say which line was removed and which added would be eaten.
  if (looksLikeDiff(lines)) return `<p>${inline(lines.join('\n'))}</p>`;

  const out = [];
  let run = null;

  const close = () => {
    if (!run) return;
    out.push(
      run.kind === 'p'
        ? `<p>${inline(run.lines.join('\n'))}</p>`
        : `<${run.kind}>${run.lines.map((item) => `<li>${inline(item)}</li>`).join('')}</${run.kind}>`
    );
    run = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      if (run && run.kind === 'p') run.lines.push(line);
      continue;
    }

    const kind = BULLET.test(line)
      ? 'ul'
      : ORDERED.test(line) && (!run || run.kind === 'ol' || ORDERED_START.test(line))
        ? 'ol'
        : null;

    if (kind) {
      if (!run || run.kind !== kind) {
        close();
        run = { kind, lines: [] };
      }
      run.lines.push(line.replace(kind === 'ul' ? BULLET : ORDERED, ''));
      continue;
    }

    if (run && run.kind !== 'p' && /^\s+\S/.test(line)) {
      run.lines[run.lines.length - 1] += `\n${line.trim()}`;
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

/**
 * Both a removed and an added line, or a hunk header: a unified diff, not a
 * list. Defensive — no such block exists in the corpus this was measured on —
 * but a diff whose markers vanished would misreport what was changed.
 */
function looksLikeDiff(lines) {
  if (lines.some((l) => l.startsWith('@@ '))) return true;
  return lines.some((l) => /^-(?!-)/.test(l)) && lines.some((l) => /^\+(?!\+)/.test(l));
}

/** Inline rules, applied to already-escaped text. */
function inline(raw) {
  return escapeHtml(raw)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
}

// -- display helpers ---------------------------------------------------------

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

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!hasContent(message)) continue;

    if (isToolOnlyTurn(message)) {
      if (!run) {
        run = { type: 'toolRun', messages: [] };
        out.push(run);
      }
      run.messages.push(message);
    } else {
      run = null;
      out.push({ type: 'message', message });
    }
  }
  return out;
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

/**
 * Split a folder's sessions by agent, so Claude and Codex conversations are
 * never interleaved in one undifferentiated list.
 *
 * @returns {Array<{agentId: string, sessions: object[]}>} Busiest agent first.
 */
export function groupSessionsByAgent(sessions) {
  const byAgent = new Map();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const id = session.agentId || 'unknown';
    if (!byAgent.has(id)) byAgent.set(id, []);
    byAgent.get(id).push(session);
  }
  return [...byAgent.entries()]
    .map(([agentId, group]) => ({ agentId, sessions: group }))
    .sort((a, b) => b.sessions.length - a.sessions.length || a.agentId.localeCompare(b.agentId));
}
