/**
 * The statistics view: what the index holds, told honestly.
 *
 * The figures come from the main process (src/core/statistics.js), which
 * credits every message by the screen's own rules. This module only lays them
 * out. Every word comes from the language files, every number from l10n.js.
 *
 * Forms, chosen before colour (the dataviz method):
 *   - who wrote, and the tokens: a handful of headline numbers — a row of
 *     figures, not a chart;
 *   - month by month: columns, ONE measure at a time, chosen by a toggle — never
 *     two scales on one plot. Hover and keyboard focus show the exact value;
 *     a table view holds every value, so the tooltip never gates one;
 *   - by assistant, model and folder: tables with an inline bar, all in the
 *     same hue. Identity is carried by the name (and the assistant's mark),
 *     never by colour.
 * The columns' colour is `--chart`: the accent in the light theme, one step
 * darker in the dark theme, where the accent sits just outside the lightness
 * band the palette validator allows.
 */

const SVG = 'http://www.w3.org/2000/svg';

/** The three measures the month chart can show, one at a time. */
const MEASURES = [
  { key: 'you', label: 'stats-measure-you', compact: false },
  { key: 'replies', label: 'stats-measure-replies', compact: false },
  { key: 'received', label: 'stats-measure-received', compact: true },
];

/** How many models are listed before the rest folds into one row. */
const MODEL_ROWS = 8;
/** How many folders are listed. */
const FOLDER_ROWS = 8;

/**
 * @param {object} data   What `stats:get` answered.
 * @param {object} ctx
 * @param {(id: string, args?: object) => string} ctx.t
 * @param {object} ctx.l10n
 * @param {(agentId: string) => HTMLElement} ctx.agentMark  The assistant's dot.
 * @param {(agentId: string) => string} ctx.agentLabel
 * @param {(path: string) => {name: string, parent: string}} ctx.folderLabel
 * @param {string} ctx.period      The period's own label, already translated.
 * @param {number} ctx.hiddenCount Assistants hidden in the sidebar.
 */
export function statisticsPane(data, ctx) {
  const { t } = ctx;
  const pane = el('section', 'stats-view');
  pane.setAttribute('aria-labelledby', 'stats-title');

  const title = el('h2', 'stats-title', t('stats-title'));
  title.id = 'stats-title';
  pane.append(
    title,
    el(
      'p',
      'stats-period',
      t('stats-period', { period: ctx.period, sessions: data.sessions, folders: data.folders })
    )
  );
  if (ctx.hiddenCount > 0)
    pane.append(el('p', 'stats-note', t('stats-hidden', { count: ctx.hiddenCount })));

  if (!data.records) {
    pane.append(el('p', 'stats-empty', t('stats-empty')));
    return pane;
  }

  pane.append(whoWrote(data, ctx), tokens(data, ctx));
  if (data.quotas && data.quotas.length) pane.append(quotas(data, ctx));
  if (data.months.length) pane.append(months(data, ctx));

  const grid = el('div', 'stats-grid');
  grid.append(byAgent(data, ctx), byModel(data, ctx));
  pane.append(grid, byFolder(data, ctx));
  return pane;
}

/** Shown while the main process counts: the view's own words, nothing else. */
export function statisticsLoading(t) {
  const pane = el('section', 'stats-view is-loading');
  pane.append(
    el('h2', 'stats-title', t('stats-title')),
    el('p', 'stats-period', t('stats-loading'))
  );
  return pane;
}

// ── who wrote ───────────────────────────────────────────────────────────────

function whoWrote(data, { t, l10n }) {
  const { speakers } = data;
  const shown = speakers.you + speakers.assistant + speakers.tools + speakers.notices;
  const tile = (label, value) => {
    const box = figure(t(label), l10n.number(value));
    box.append(
      el('span', 'stat-note', t('stats-share', { share: l10n.percent(shown ? value / shown : 0) }))
    );
    return box;
  };

  const section = block(t('stats-who'));
  const row = el('div', 'stat-tiles');
  row.append(
    tile('stats-you', speakers.you),
    tile('stats-replies', speakers.assistant),
    tile('stats-tools', speakers.tools),
    tile('stats-notices', speakers.notices)
  );
  section.append(
    row,
    el(
      'p',
      'stats-note',
      t('stats-records', { records: l10n.number(data.records), empty: l10n.number(speakers.empty) })
    )
  );
  // The largest share of what shows nothing, named: Claude's masked reasoning.
  if (speakers.masked) {
    section.append(
      el('p', 'stats-note', t('stats-masked', { masked: l10n.number(speakers.masked) }))
    );
  }
  return section;
}

// ── tokens ──────────────────────────────────────────────────────────────────

function tokens(data, { t, l10n, agentLabel }) {
  const section = block(t('stats-tokens'));
  const row = el('div', 'stat-tiles');
  for (const [id, value] of [
    ['stats-sent', data.tokens.sent],
    ['stats-received', data.tokens.received],
    ['stats-cache', data.tokens.cacheRead],
  ]) {
    // The meaning on the label, the exact count on the number.
    const message = l10n.message(id);
    const box = figure(message.value, l10n.compact(value));
    if (message.attributes.title) box.querySelector('.stat-label').title = message.attributes.title;
    box.querySelector('.stat-value').title = t('stats-exact', { value: l10n.number(value) });
    row.append(box);
  }
  section.append(
    row,
    el(
      'p',
      'stats-note',
      t('stats-coverage', { measured: data.tokens.measuredSessions, total: data.sessions })
    )
  );

  // What subagents cost, apart and as a floor: not in the tiles above.
  const sub = data.subagents;
  if (sub && sub.count) {
    section.append(
      el(
        'p',
        'stats-note',
        t('stats-subagents', {
          count: sub.count,
          sent: l10n.compact(sub.sent),
          received: l10n.compact(sub.received),
          cached: l10n.compact(sub.cacheRead),
        })
      )
    );
  }

  // Say who is missing, rather than let a total pass for complete.
  const silent = data.agents
    .filter((a) => a.measuredSessions === 0)
    .map((a) => agentLabel(a.agentId));
  if (silent.length) {
    section.append(
      el(
        'p',
        'stats-note',
        t('stats-uncovered', { agents: l10n.list(silent), count: silent.length })
      )
    );
  }
  return section;
}

// ── usage limits ────────────────────────────────────────────────────────────

/** The limits named after their assistant; any other is shown by its own name. */
const OWN_LIMITS = new Set(['codex', 'claude']);

/**
 * What each assistant's limits stood at (src/core/quota.js). Forms: the latest
 * window of each length as headline figures — a reading and its date, never a
 * total — then how often a limit was reached, then the history of the longest
 * window as columns, one measure, with its table.
 */
function quotas(data, ctx) {
  const { t } = ctx;
  const section = block(t('stats-quotas'));
  const groups = new Map();
  for (const w of data.quotas) {
    const key = `${w.agentId}\u0000${w.limit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  // The most recently read first.
  const ordered = [...groups.values()].sort((a, b) =>
    newest(b).lastAt.localeCompare(newest(a).lastAt)
  );
  for (const windows of ordered) section.append(quotaGroup(windows, ctx));
  section.append(el('p', 'stats-note', t('stats-quota-note')));
  return section;
}

/** The window read last. */
const newest = (windows) => windows.reduce((a, b) => (b.lastAt > a.lastAt ? b : a));
/** A window's end, as a date l10n.js reads. */
const endOf = (w) => new Date(w.resetsAt * 1000).toISOString();
const hoursOf = (minutes) => Math.round(minutes / 60);

function quotaGroup(windows, ctx) {
  const { t, l10n, agentMark, agentLabel } = ctx;
  const now = ctx.now ?? Date.now();
  const group = el('div', 'stats-quota');
  const { agentId, limit } = windows[0];

  const title = el('h4', 'stats-quota-title');
  title.append(agentMark(agentId), el('span', '', agentLabel(agentId)));
  if (!OWN_LIMITS.has(limit))
    title.append(el('span', 'stats-quota-limit', t('stats-quota-limit', { limit })));
  group.append(title);

  // The latest window of each length still open at the latest reading, the
  // longest first (rows come oldest first). Codex's five-hour window went away
  // in July 2026: its last one is history, not a figure of today.
  const lengths = [...new Set(windows.map((w) => w.minutes))].sort((a, b) => b - a);
  const readAt = Date.parse(newest(windows).lastAt) / 1000;
  const current = lengths
    .map((minutes) => windows.filter((x) => x.minutes === minutes).at(-1))
    .filter((w) => w.resetsAt >= readAt);
  const row = el('div', 'stat-tiles');
  for (const w of current) {
    const { minutes } = w;
    const value =
      w.used != null
        ? l10n.percent(w.used / 100)
        : t(w.reached ? 'stats-quota-refused' : 'stats-not-measured');
    const box = figure(t('stats-quota-window', { minutes, hours: hoursOf(minutes) }), value);
    // A window that has ended since is dimmed: its figure is not today's.
    const ended = w.resetsAt * 1000 <= now;
    box.classList.toggle('is-past', ended);
    box.append(
      el(
        'span',
        'stat-note',
        t(ended ? 'stats-quota-reset-since' : 'stats-quota-resets', {
          date: l10n.dateTime(endOf(w)),
        })
      )
    );
    row.append(box);
  }
  group.append(row);

  // When it was read, and what that reading said of the plan and the credits.
  const last = newest(windows);
  const facts = [t('stats-quota-read', { date: l10n.dateTime(last.lastAt) })];
  if (last.plan) facts.push(t('stats-quota-plan', { plan: last.plan }));
  if (last.credits) facts.push(creditsOf(last.credits, ctx));
  group.append(el('p', 'stats-note', facts.join(' · ')));

  // How often a limit was reached — all Claude ever writes.
  for (const minutes of lengths) {
    const reached = windows.filter((w) => w.minutes === minutes && w.reached);
    if (!reached.length) continue;
    group.append(
      el(
        'p',
        'stats-note',
        t('stats-quota-reached', {
          minutes,
          hours: hoursOf(minutes),
          count: reached.length,
          date: l10n.date(reached.at(-1).at),
        })
      )
    );
  }

  // The longest window read at least twice, as columns: each its highest reading.
  const history = lengths
    .map((minutes) => windows.filter((w) => w.minutes === minutes && w.used != null))
    .find((ws) => ws.length >= 2);
  if (history) group.append(quotaHistory(history, ctx));
  return group;
}

function creditsOf(credits, { t, l10n }) {
  if (credits.unlimited) return t('stats-quota-unlimited');
  if (!credits.has || !credits.balance) return t('stats-quota-no-credits');
  return t('stats-quota-credits', {
    balance: l10n.number(Math.round(credits.balance * 100) / 100),
  });
}

function quotaHistory(windows, ctx) {
  const { t, l10n } = ctx;
  const { minutes } = windows[0];
  const caption = t('stats-quota-history', { minutes, hours: hoursOf(minutes) });
  const percent = (v) => l10n.percent(v / 100);
  const ending = (w) => t('stats-quota-ending', { date: l10n.dateTime(endOf(w)) });

  const wrap = el('div', 'stats-quota-history');
  const table = el('table', 'stats-table');
  table.append(head([t('stats-quota-col-end'), t('stats-quota-col-used')], [false, true]));
  const body = el('tbody', '');
  for (const w of windows)
    body.append(tr([l10n.dateTime(endOf(w)), percent(w.used)], [false, true]));
  table.append(body);
  const details = el('details', 'stats-table-view');
  details.append(el('summary', '', t('stats-months-table')), table);

  wrap.append(
    el('p', 'stats-quota-caption', caption),
    columnChart(windows, {
      value: (w) => w.used,
      tick: percent,
      short: (w) => l10n.day(endOf(w)),
      long: ending,
      format: percent,
      exact: percent,
      aria: caption,
      bar: (w, v) => t('stats-bar', { month: ending(w), value: percent(v) }),
      top: Math.max(100, ...windows.map((w) => w.used)),
    }),
    details
  );
  return wrap;
}

// ── month by month ──────────────────────────────────────────────────────────

function months(data, ctx) {
  const { t } = ctx;
  const section = block(t('stats-months'));

  const toggle = el('div', 'stats-toggle');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', t('stats-months'));
  const chartSlot = el('div', 'stats-chart-slot');
  const tableSlot = el('details', 'stats-table-view');

  const show = (measure) => {
    for (const button of toggle.children) {
      button.setAttribute('aria-pressed', String(button.dataset.measure === measure.key));
    }
    chartSlot.replaceChildren(monthChart(data.months, measure, ctx));
    const summary = el('summary', '', t('stats-months-table'));
    tableSlot.replaceChildren(summary, monthTable(data.months, measure, ctx));
  };

  for (const measure of MEASURES) {
    const button = el('button', 'stats-seg', t(measure.label));
    button.type = 'button';
    button.dataset.measure = measure.key;
    button.addEventListener('click', () => show(measure));
    toggle.append(button);
  }

  section.append(toggle, chartSlot, tableSlot);
  if (data.undated)
    section.append(el('p', 'stats-note', t('stats-undated', { count: data.undated })));
  show(MEASURES[0]);
  return section;
}

/** A round number just above the largest value, and the ticks up to it. Exported for the tests. */
export function scale(max) {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  // Everything drawn here is counted, whole — conversations, messages, tokens,
  // percents out of 100: a step below one only repeats a tick once rounded.
  const step = Math.max(
    1,
    [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough)
  );
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks };
}

function monthChart(rows, measure, { t, l10n }) {
  const format = (v) => (measure.compact ? l10n.compact(v) : l10n.number(v));
  return columnChart(rows, {
    value: (row) => row[measure.key] || 0,
    tick: (v) => l10n.compact(v),
    short: (row) => l10n.month(row.month),
    long: (row) => l10n.month(row.month, { long: true }),
    format,
    exact: (v) => l10n.number(v),
    aria: t('stats-chart', { measure: t(measure.label) }),
    bar: (row, v) =>
      t('stats-bar', { month: l10n.month(row.month, { long: true }), value: format(v) }),
  });
}

/**
 * Columns, one measure, one hue: the month chart, and the quota history. The
 * caller says how to read a row and how to write its numbers.
 */
function columnChart(
  rows,
  { value, tick, short, long, format, exact, aria, bar: barLabel, top: fixedTop }
) {
  const W = 720;
  const H = 210;
  const pad = { top: 26, right: 24, bottom: 24, left: 46 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const values = rows.map(value);
  const { top, ticks } = scale(fixedTop ?? Math.max(...values));
  const slot = plotW / rows.length;
  const barW = Math.max(2, Math.min(24, slot * 0.62));
  const y = (v) => pad.top + plotH - (v / top) * plotH;

  const wrap = el('figure', 'stats-figure');
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'stats-svg', role: 'group' });
  svg.setAttribute('aria-label', aria);

  // Recessive furniture: hairline gridlines, ticks in muted ink.
  for (const mark of ticks) {
    const ty = y(mark);
    svg.append(
      svgEl('line', { x1: pad.left, x2: W - pad.right, y1: ty, y2: ty, class: 'stats-grid-line' })
    );
    const label = svgEl('text', {
      x: pad.left - 6,
      y: ty + 3.5,
      class: 'stats-tick',
      'text-anchor': 'end',
    });
    label.textContent = tick(mark);
    svg.append(label);
  }

  // A month label every few columns, the latest month always among them.
  const every = Math.max(1, Math.ceil(rows.length / Math.floor(plotW / 58)));
  const maxIndex = values.indexOf(Math.max(...values));

  const tip = el('div', 'stats-tip');
  tip.hidden = true;
  const tipValue = el('strong', '');
  const tipMonth = el('span', '');
  tip.append(tipValue, tipMonth);

  rows.forEach((row, i) => {
    const value = values[i];
    const x = pad.left + i * slot + (slot - barW) / 2;
    const height = (value / top) * plotH;
    const bar = svgEl('path', {
      d: columnPath(x, pad.top + plotH, barW, height),
      class: 'stats-bar-mark',
    });
    svg.append(bar);

    if ((rows.length - 1 - i) % every === 0) {
      const label = svgEl('text', {
        x: pad.left + i * slot + slot / 2,
        y: H - 6,
        class: 'stats-tick',
        'text-anchor': 'middle',
      });
      label.textContent = short(row);
      svg.append(label);
    }

    // The extreme gets its number; the axis, tooltip and table carry the rest.
    if (i === maxIndex && value > 0) {
      const label = svgEl('text', {
        x: x + barW / 2,
        y: y(value) - 6,
        class: 'stats-direct',
        'text-anchor': 'middle',
      });
      label.textContent = format(value);
      svg.append(label);
    }

    // The hit target is the whole slot, not the painted pixels.
    const hit = svgEl('rect', {
      x: pad.left + i * slot,
      y: pad.top,
      width: slot,
      height: plotH,
      class: 'stats-hit',
    });
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('role', 'img');
    hit.setAttribute('aria-label', barLabel(row, value));
    const on = () => {
      bar.classList.add('is-hot');
      tipValue.textContent = exact(value);
      tipMonth.textContent = long(row);
      tip.hidden = false;
      const left = ((pad.left + i * slot + slot / 2) / W) * 100;
      tip.style.left = `${Math.min(88, Math.max(12, left))}%`;
      tip.style.top = `${(Math.max(pad.top, y(value)) / H) * 100}%`;
    };
    const off = () => {
      bar.classList.remove('is-hot');
      tip.hidden = true;
    };
    hit.addEventListener('pointerenter', on);
    hit.addEventListener('focus', on);
    hit.addEventListener('pointerleave', off);
    hit.addEventListener('blur', off);
    svg.append(hit);
  });

  wrap.append(svg, tip);
  return wrap;
}

/** A column: square at the baseline, a 4px rounded top — none when too short to round. */
function columnPath(x, base, w, h) {
  if (h <= 0.5) return '';
  const r = Math.min(4, w / 2, h);
  const top = base - h;
  return [
    `M${x},${base}`,
    `V${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `H${x + w - r}`,
    `Q${x + w},${top} ${x + w},${top + r}`,
    `V${base}`,
    'Z',
  ].join(' ');
}

function monthTable(rows, measure, { t, l10n }) {
  const table = el('table', 'stats-table');
  table.append(head([t('stats-col-month'), t(measure.label)], [false, true]));
  const body = el('tbody', '');
  for (const row of rows) {
    const value = row[measure.key] || 0;
    body.append(tr([l10n.month(row.month, { long: true }), l10n.number(value)], [false, true]));
  }
  table.append(body);
  return table;
}

// ── by assistant, by model, by folder ───────────────────────────────────────

function byAgent(data, { t, l10n, agentMark, agentLabel }) {
  const section = block(t('stats-by-agent'));
  const max = Math.max(1, ...data.agents.map((a) => a.replies));
  const table = el('table', 'stats-table');
  table.append(
    head(
      [
        t('stats-col-assistant'),
        t('stats-col-conversations'),
        t('stats-col-you'),
        t('stats-col-replies'),
        '',
        t('stats-col-received'),
      ],
      [false, true, true, true, false, true]
    )
  );
  const body = el('tbody', '');
  for (const agent of data.agents) {
    const name = el('td', 'stats-name');
    name.append(agentMark(agent.agentId), document.createTextNode(` ${agentLabel(agent.agentId)}`));
    const received = el('td', 'num');
    if (agent.received === null) {
      received.textContent = '—';
      received.title = t('stats-not-measured');
    } else {
      received.textContent = l10n.compact(agent.received);
      received.title = t('stats-exact', { value: l10n.number(agent.received) });
    }
    const row = el('tr', '');
    row.append(
      name,
      cell(l10n.number(agent.sessions), true),
      cell(l10n.number(agent.you), true),
      cell(l10n.number(agent.replies), true),
      barCell(agent.replies / max),
      received
    );
    body.append(row);
  }
  table.append(body);
  section.append(table);
  return section;
}

function byModel(data, { t, l10n }) {
  const section = block(t('stats-by-model'));
  const shown = data.models.slice(0, MODEL_ROWS);
  const rest = data.models.slice(MODEL_ROWS);
  const max = Math.max(1, ...shown.map((m) => m.replies));
  const table = el('table', 'stats-table');
  table.append(head([t('stats-col-model'), t('stats-col-replies'), ''], [false, true, false]));
  const body = el('tbody', '');
  for (const model of shown) {
    const row = el('tr', '');
    const name = el('td', 'stats-name stats-model', model.model);
    row.append(name, cell(l10n.number(model.replies), true), barCell(model.replies / max));
    body.append(row);
  }
  if (rest.length) {
    const replies = rest.reduce((n, m) => n + m.replies, 0);
    const row = el('tr', 'stats-rest');
    const name = el('td', 'stats-name', t('stats-others', { count: rest.length }));
    name.title = l10n.list(rest.map((m) => m.model));
    row.append(name, cell(l10n.number(replies), true), el('td', ''));
    body.append(row);
  }
  table.append(body);
  section.append(table);
  return section;
}

function byFolder(data, { t, l10n, folderLabel }) {
  const section = block(t('stats-by-folder'));
  const shown = data.activeFolders.slice(0, FOLDER_ROWS);
  const max = Math.max(1, ...shown.map((f) => f.messages));
  const table = el('table', 'stats-table');
  table.append(head([t('stats-col-folder'), t('stats-col-messages'), ''], [false, true, false]));
  const body = el('tbody', '');
  for (const folder of shown) {
    const label = folderLabel(folder.path);
    const name = el('td', 'stats-name');
    name.title = label.unknown ? '' : folder.path;
    name.append(
      el('span', 'stats-folder', label.unknown ? t('folder-unknown') : label.name),
      el('span', 'stats-parent', label.parent)
    );
    const row = el('tr', '');
    row.append(name, cell(l10n.number(folder.messages), true), barCell(folder.messages / max));
    body.append(row);
  }
  table.append(body);
  section.append(table, el('p', 'stats-note', t('stats-folder-note')));
  return section;
}

// ── small pieces ────────────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

function block(title) {
  const section = el('section', 'stats-block');
  section.append(el('h3', '', title));
  return section;
}

/** A labelled headline number: label first (sentence case), value below. */
function figure(label, value) {
  const box = el('div', 'stat-tile');
  box.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
  return box;
}

function head(labels, numeric) {
  const thead = el('thead', '');
  const row = el('tr', '');
  labels.forEach((label, i) => row.append(el('th', numeric[i] ? 'num' : '', label)));
  thead.append(row);
  return thead;
}

function tr(values, numeric) {
  const row = el('tr', '');
  values.forEach((value, i) => row.append(cell(value, numeric[i])));
  return row;
}

function cell(text, numeric) {
  return el('td', numeric ? 'num' : '', text);
}

/** An inline bar: a share of the column's largest value, in the chart's one hue. */
function barCell(share) {
  const td = el('td', 'stats-bar-cell');
  const track = el('span', 'stats-inline-bar');
  const fill = el('span', '');
  fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  track.append(fill);
  track.setAttribute('aria-hidden', 'true');
  td.append(track);
  return td;
}
