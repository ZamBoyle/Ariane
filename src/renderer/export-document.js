/**
 * A conversation laid out for export — as Markdown, or as a page to print to
 * PDF — by the very rules the screen uses, and in the reader's language.
 *
 * Pure, and loaded by the MAIN process as well as by the tests: an export is
 * built from the index, never from what the renderer hands over (invariant 3),
 * and it must credit speakers exactly as the transcript does (invariant 1). An
 * export putting the output of `git status` in the person's mouth would be the
 * project's worst defect, written to a file they may send to someone else.
 *
 * Nothing internal leaves: no session id, no path of a transcript or of the
 * index — only the conversation, its folder and its dates.
 *
 * Every word Ariane adds comes from `l10n` (l10n.js): the same localiser as
 * the screen's, so an export reads in the language the app is shown in.
 */

import {
  agentTheme,
  describeToolRun,
  escapeHtml,
  groupMessages,
  noticeLabel,
  renderMarkdown,
  speakerOf,
} from './format.js';

/** Reasoning is kept whole in Markdown, folded; on paper only its opening is. */
const PRINTED_REASONING = 600;

/**
 * The shape every format is drawn from.
 *
 * @param {{session: object, messages: object[], newestFirst?: boolean, l10n: object}} conversation
 *   As the index returns them, and in the order the screen shows them: an
 *   export is what the reader sees. Reversed by rows, as on screen — inside a
 *   strip of tool calls, each call still comes before its result.
 */
export function layoutConversation({ session, messages, newestFirst = false, l10n }) {
  const { t } = l10n;
  const assistant = agentTheme(session.agentId).label;
  const rows = [];

  for (const group of groupMessages(messages)) {
    if (group.type === 'toolRun') {
      rows.push({
        kind: 'tools',
        when: group.messages[0] ? group.messages[0].ts || '' : '',
        summary: toolSummary(describeToolRun(group.messages), l10n),
      });
      continue;
    }

    const message = group.message;
    const speaker = speakerOf(message);
    const row = {
      kind: speaker ? 'message' : 'notice',
      side: message.role === 'user' ? 'user' : 'assistant',
      when: message.ts || '',
      text: message.text || '',
      thinking: message.thinking || '',
    };
    if (speaker) row.speaker = speaker === 'you' ? t('speaker-you') : assistant;
    else row.label = noticeLabel(message, l10n);

    // What the screen draws beside the prose: tool calls, results, attachments.
    const parts = describeToolRun([message]);
    if (parts.calls || parts.results || parts.attachments) row.tools = toolSummary(parts, l10n);
    const pasted = (message.parts || []).filter((p) => p.type === 'pasted' && p.preview);
    if (pasted.length) row.pasted = pasted.map((p) => p.preview);

    rows.push(row);
  }

  if (newestFirst) rows.reverse();

  return {
    title: oneLine(session.title) || t('session-untitled'),
    newestFirst: Boolean(newestFirst),
    assistant,
    folder: session.folderPath || '',
    branch: session.gitBranch || '',
    firstAt: session.firstAt || '',
    lastAt: session.lastAt || '',
    count: typeof session.messageCount === 'number' ? session.messageCount : messages.length,
    saved: session.source === 'archive',
    rows,
  };
}

/** "2 tool calls: Bash, Read — 1 error" */
function toolSummary(d, { t }) {
  const heading = t(`tool-run-${d.kind}`, { n: d.count });
  const summary = d.label ? t('tool-summary-named', { summary: heading, names: d.label }) : heading;
  return d.errors ? t('tool-summary-errors', { summary, errors: t('tool-errors', { n: d.errors }) }) : summary;
}

function period(layout, { t, dateTime }) {
  const from = dateTime(layout.firstAt);
  const to = dateTime(layout.lastAt);
  if (from && to && from !== to) return t('export-period', { from, to });
  return from || to;
}

const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/** Said in the header: read newest first, every answer comes before its question. */
const messagesLine = (layout, { t }) =>
  t('export-messages', {
    count: layout.count,
    order: t(layout.newestFirst ? 'export-order-newest' : 'export-order-oldest'),
  });

/** A fence no backtick run inside `content` can close. */
function fence(content, lang = '') {
  const longest = Math.max(2, ...(String(content).match(/`+/g) || ['']).map((run) => run.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${content}\n${ticks}`;
}

function inlineCode(text) {
  const ticks = String(text).includes('`') ? '``' : '`';
  return `${ticks}${ticks.length > 1 ? ' ' : ''}${text}${ticks.length > 1 ? ' ' : ''}${ticks}`;
}

// ── Markdown ────────────────────────────────────────────────────────────────

/**
 * Readable as plain text, and tidy in any Markdown viewer. The prose is kept
 * exactly as written; only what Ariane adds — headings, labels, the folds for
 * reasoning — is Markdown of its own.
 */
export function toMarkdown(layout, { exportedAt = '', l10n }) {
  const { t, dateTime } = l10n;
  const field = (id, value) => `- ${t('export-field', { label: `**${t(id)}**`, value })}`;
  const out = [`# ${layout.title}`, ''];
  out.push(field('export-field-assistant', layout.assistant));
  if (layout.folder) out.push(field('export-field-folder', inlineCode(layout.folder)));
  if (layout.branch) out.push(field('export-field-branch', layout.branch));
  const when = period(layout, l10n);
  if (when) out.push(field('export-field-period', when));
  out.push(field('export-field-messages', messagesLine(layout, l10n)));
  if (layout.saved) out.push(`- *${t('export-saved')}*`);
  out.push('', '---', '');

  for (const row of layout.rows) {
    const at = dateTime(row.when);
    if (row.kind === 'tools') {
      out.push(`> *${row.summary}*`, '');
      continue;
    }
    if (row.kind === 'notice') {
      out.push(`> **${row.label}**${at ? ` · ${at}` : ''}`);
      if (row.text) out.push('>', ...row.text.split('\n').map((line) => (line ? `> ${line}` : '>')));
      out.push('');
      continue;
    }
    out.push(`**${row.speaker}**${at ? ` · ${at}` : ''}`, '');
    if (row.text) out.push(row.text, '');
    if (row.tools) out.push(`> *${row.tools}*`, '');
    for (const pasted of row.pasted || []) {
      out.push('<details>', `<summary>${t('part-pasted')}</summary>`, '', fence(pasted), '', '</details>', '');
    }
    if (row.thinking) {
      out.push('<details>', `<summary>${t('part-thinking')}</summary>`, '', row.thinking, '', '</details>', '');
    }
  }

  const footer = exportedAt ? t('export-footer-at', { date: dateTime(exportedAt) }) : t('export-footer');
  out.push('---', '', `*${footer}*`, '');
  return out.join('\n');
}

// ── A page to print ─────────────────────────────────────────────────────────

/**
 * A standalone page for printToPDF: the app's own palette, on paper. It runs
 * no script and loads nothing — its CSP forbids both, and the window that
 * prints it has JavaScript switched off — because every word in it comes
 * from conversations, which hold whatever anyone ever pasted.
 *
 * Every string goes through escapeHtml — translations included — and prose
 * through renderMarkdown, which escapes before it decorates (invariant 2).
 */
export function toHtml(layout, { exportedAt = '', l10n }) {
  const { t, dateTime } = l10n;
  const meta = [
    [t('export-field-assistant'), escapeHtml(layout.assistant)],
    layout.folder && [t('export-field-folder'), `<code>${escapeHtml(layout.folder)}</code>`],
    layout.branch && [t('export-field-branch'), escapeHtml(layout.branch)],
    period(layout, l10n) && [t('export-field-period'), escapeHtml(period(layout, l10n))],
    [t('export-field-messages'), escapeHtml(messagesLine(layout, l10n))],
  ].filter(Boolean);

  const rows = layout.rows.map((row) => {
    const at = dateTime(row.when);
    const when = at ? `<span class="when">${escapeHtml(at)}</span>` : '';
    if (row.kind === 'tools') return `<p class="tools">${escapeHtml(row.summary)}</p>`;
    if (row.kind === 'notice') {
      return (
        `<section class="notice"><div class="who">${escapeHtml(row.label)}${when}</div>` +
        `<div class="body">${renderMarkdown(row.text)}</div></section>`
      );
    }
    const thinking = row.thinking
      ? `<div class="thinking"><span>${escapeHtml(t('part-thinking'))}</span>${escapeHtml(
          row.thinking.length > PRINTED_REASONING ? `${row.thinking.slice(0, PRINTED_REASONING)}…` : row.thinking
        )}</div>`
      : '';
    const pastedLabel = escapeHtml(t('part-pasted'));
    const pasted = (row.pasted || [])
      .map((text) => `<div class="pasted"><span>${pastedLabel}</span><pre>${escapeHtml(text)}</pre></div>`)
      .join('');
    const tools = row.tools ? `<p class="tools">${escapeHtml(row.tools)}</p>` : '';
    return (
      `<section class="msg ${row.side}"><div class="who">${escapeHtml(row.speaker)}${when}</div>` +
      `<div class="body">${renderMarkdown(row.text)}</div>${pasted}${tools}${thinking}</section>`
    );
  });

  const footer = exportedAt ? t('export-footer-at', { date: dateTime(exportedAt) }) : t('export-footer');
  return `<!doctype html>
<html lang="${escapeHtml(l10n.language)}" dir="${l10n.direction === 'rtl' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(layout.title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<header class="doc-head">
<h1>${escapeHtml(layout.title)}</h1>
<dl>${meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join('')}</dl>
${layout.saved ? `<p class="saved">${escapeHtml(t('export-saved'))}</p>` : ''}
</header>
<main>
${rows.join('\n')}
</main>
<footer class="doc-foot">${escapeHtml(footer)}</footer>
</body>
</html>
`;
}

/** The app's light palette, set for paper: no background tints wasted on ink. */
const PRINT_CSS = `
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
html { color: #1f1e1b; background: #fff; }
body { margin: 0; font: 10.5pt/1.55 "Inter", "Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif; }
.doc-head { margin-bottom: 18pt; padding-bottom: 10pt; border-bottom: 2px solid #c2603c; }
h1 { margin: 0 0 8pt; font-size: 18pt; line-height: 1.25; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2pt 12pt; margin: 0; font-size: 9pt; }
dt { color: #97938b; }
dd { margin: 0; color: #6b6862; }
.saved { margin: 8pt 0 0; font-size: 9pt; color: #c2603c; }
section { margin: 0 0 11pt; padding: 7pt 10pt; border-left: 3px solid #d8d4cc; border-radius: 2px; }
section.user { border-left-color: #4a6fa5; background: #f5f7fb; }
section.assistant { border-left-color: #c2603c; }
section.notice { border-left-color: #d8d4cc; font-size: 9pt; color: #6b6862; }
.who { margin-bottom: 3pt; font-size: 9pt; font-weight: 600; break-after: avoid; }
section.user .who { color: #4a6fa5; }
section.assistant .who { color: #c2603c; }
.when { margin-left: 8pt; font-weight: 400; color: #97938b; }
.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
.body p { margin: 0 0 6pt; }
.body h2, .body h3, .body h4, .body h5 { margin: 8pt 0 4pt; font-size: 11pt; }
.body ul, .body ol { margin: 0 0 6pt; padding-left: 16pt; }
.body blockquote { margin: 0 0 6pt; padding-left: 8pt; border-left: 2px solid #d8d4cc; color: #6b6862; }
code { font: 9pt/1.4 "JetBrains Mono", "DejaVu Sans Mono", Consolas, monospace; background: #f4f2ec; padding: 0 2pt; border-radius: 2px; }
pre { margin: 0 0 6pt; padding: 6pt 8pt; background: #f4f2ec; border-radius: 3px; white-space: pre-wrap; overflow-wrap: anywhere; font: 8.5pt/1.45 "JetBrains Mono", "DejaVu Sans Mono", Consolas, monospace; }
pre code { padding: 0; background: none; }
.tools { margin: 3pt 0 9pt; font-size: 8.5pt; font-style: italic; color: #97938b; }
section .tools { margin: 5pt 0 0; }
.thinking, .pasted { margin-top: 6pt; padding: 5pt 8pt; border-radius: 3px; background: #faf9f5; font-size: 8.5pt; color: #6b6862; white-space: pre-wrap; }
.thinking span, .pasted span { display: block; margin-bottom: 2pt; font-weight: 600; color: #97938b; }
.pasted pre { margin: 0; background: none; padding: 0; }
.doc-foot { margin-top: 16pt; padding-top: 6pt; border-top: 1px solid #e6e2da; font-size: 8pt; color: #97938b; }
`;
