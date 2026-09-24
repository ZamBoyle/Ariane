'use strict';

/**
 * What the index holds, summed for the statistics view. Pure: rows in, figures
 * out, so every rule below is tested without a database or a window.
 *
 * Who spoke is decided by the screen's own rules — `speakerOf` and
 * `hasContent`, from the renderer's format.js — handed in rather than rewritten
 * here. Two implementations of "who said this" would drift, and the one this
 * app exists to get right is the one that must never put words in the person's
 * mouth (invariant 1). The main process loads them the way exports do.
 *
 * Measured on a real index (24 September 2026): of 49 411 records, 2 789 were
 * typed by the person, 22 779 were replies, 16 156 were tool output, 626 were
 * notices and 7 061 held nothing to show. The footer's "messages" counts all of
 * them; this is where the difference is told.
 */

/**
 * @typedef {object} StatisticsRow  One message, as db.statisticsRows yields it.
 * @property {string} sessionId
 * @property {string} agentId
 * @property {string} folderPath
 * @property {string} role
 * @property {string} model
 * @property {number} hasText       1 when the message has prose.
 * @property {number} hasThinking   1 when it has reasoning.
 * @property {string|null} parts    JSON, only when there is no prose: the rules
 *   need the parts only then, and parsing 49 000 of them for nothing costs time.
 * @property {number} isNotice
 * @property {number} isSidechain
 * @property {string|null} command  JSON, only on notices.
 * @property {string|null} at       ISO time; null when nothing dates it.
 * @property {number|null} tokInput
 * @property {number|null} tokOutput
 * @property {number|null} tokCacheRead
 * @property {number|null} tokCacheWrite
 */

/**
 * @param {Iterable<StatisticsRow>} rows
 * @param {object} rules  From format.js: `{speakerOf, hasContent, modelName}`.
 * @returns {object} See the return statement: every figure the view shows.
 */
function summarize(rows, { speakerOf, hasContent, modelName }) {
  const sessions = new Set();
  const folders = new Set();
  const measured = new Set();
  const speakers = { you: 0, assistant: 0, tools: 0, notices: 0, empty: 0, masked: 0 };
  const tokens = { sent: 0, received: 0, cacheRead: 0 };
  const agents = new Map();
  const models = new Map();
  const months = new Map();
  const folderActivity = new Map();
  // A subagent's work, apart: it is opened from its parent and never listed,
  // so the figures above it must describe the sidebar without it — and its
  // transcript does not always keep the final count (claude.js).
  const subagents = { sessions: new Set(), sent: 0, received: 0, cacheRead: 0 };
  let records = 0;
  let undated = 0;

  for (const row of rows) {
    if (row.isSubagent) {
      subagents.sessions.add(row.sessionId);
      const cost = costOf(row);
      if (cost) for (const key of ['sent', 'received', 'cacheRead']) subagents[key] += cost[key];
      continue;
    }
    records++;
    sessions.add(row.sessionId);
    folders.add(row.folderPath);

    const agent = agentEntry(agents, row.agentId);
    agent.sessions.add(row.sessionId);

    const message = {
      role: row.role,
      text: row.hasText ? 'x' : '',
      thinking: row.hasThinking ? 'x' : '',
      parts: parseJson(row.parts, []),
      isNotice: Boolean(row.isNotice),
      isSidechain: Boolean(row.isSidechain),
      command: parseJson(row.command, null),
    };

    let speaker = null;
    if (!hasContent(message)) {
      speakers.empty++;
      // The largest part of what shows nothing, named rather than lumped in.
      if (message.parts.some((p) => p && p.type === 'other' && p.name === 'masked-thinking'))
        speakers.masked++;
    } else {
      speaker = speakerOf(message);
      if (speaker === 'you') speakers.you++;
      else if (speaker === 'assistant') speakers.assistant++;
      else if (message.isNotice) speakers.notices++;
      // Tool output, and the briefing an assistant wrote to a subagent inside
      // an older transcript: nobody's words either.
      else speakers.tools++;
    }
    if (speaker === 'you') agent.you++;
    if (speaker === 'assistant') agent.replies++;

    // The header's own criterion for "a reply": the assistant's, with prose.
    const name = row.role === 'assistant' && row.hasText ? modelName(row.model) : '';
    if (name) models.set(name, (models.get(name) || 0) + 1);

    const cost = costOf(row);
    if (cost) {
      measured.add(row.sessionId);
      agent.measured.add(row.sessionId);
      for (const key of Object.keys(tokens)) {
        tokens[key] += cost[key];
        agent[key] += cost[key];
      }
    }

    const month = monthOf(row.at);
    if (month) {
      const entry = months.get(month) || { you: 0, replies: 0, received: 0 };
      if (speaker === 'you') entry.you++;
      if (speaker === 'assistant') entry.replies++;
      if (cost) entry.received += cost.received;
      months.set(month, entry);
    } else {
      undated++;
    }

    if (speaker === 'you' || speaker === 'assistant') {
      folderActivity.set(row.folderPath, (folderActivity.get(row.folderPath) || 0) + 1);
    }
  }

  return {
    records,
    sessions: sessions.size,
    folders: folders.size,
    speakers,
    tokens: { ...tokens, measuredSessions: measured.size },
    agents: [...agents.values()]
      .map((a) => ({
        agentId: a.agentId,
        sessions: a.sessions.size,
        you: a.you,
        replies: a.replies,
        measuredSessions: a.measured.size,
        sent: a.measured.size ? a.sent : null,
        received: a.measured.size ? a.received : null,
        cacheRead: a.measured.size ? a.cacheRead : null,
      }))
      .sort((a, b) => b.replies - a.replies || a.agentId.localeCompare(b.agentId)),
    models: [...models]
      .map(([model, replies]) => ({ model, replies }))
      .sort((a, b) => b.replies - a.replies || a.model.localeCompare(b.model)),
    months: continuousMonths(months),
    undated,
    activeFolders: [...folderActivity]
      .map(([path, messages]) => ({ path, messages }))
      .sort((a, b) => b.messages - a.messages || a.path.localeCompare(b.path)),
    subagents: {
      count: subagents.sessions.size,
      sent: subagents.sent,
      received: subagents.received,
      cacheRead: subagents.cacheRead,
    },
  };
}

function agentEntry(agents, agentId) {
  let entry = agents.get(agentId);
  if (!entry) {
    entry = {
      agentId,
      sessions: new Set(),
      measured: new Set(),
      you: 0,
      replies: 0,
      sent: 0,
      received: 0,
      cacheRead: 0,
    };
    agents.set(agentId, entry);
  }
  return entry;
}

/**
 * The three figures of the token line (format.js, sessionTokens): what was new
 * in the prompts, what came back, and the context read again — never folded
 * together. Null when the message carries no count at all.
 */
function costOf(row) {
  const known = (v) => typeof v === 'number' && Number.isFinite(v);
  const fields = [row.tokInput, row.tokOutput, row.tokCacheRead, row.tokCacheWrite];
  if (!fields.some(known)) return null;
  return {
    sent:
      (known(row.tokInput) ? row.tokInput : 0) + (known(row.tokCacheWrite) ? row.tokCacheWrite : 0),
    received: known(row.tokOutput) ? row.tokOutput : 0,
    cacheRead: known(row.tokCacheRead) ? row.tokCacheRead : 0,
  };
}

/** "2026-09" in local time — the month a person would say it happened in. */
function monthOf(at) {
  if (typeof at !== 'string' || !at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Every month from the first to the last, the empty ones included: a time axis
 * that skipped them would draw two years apart as neighbours.
 */
function continuousMonths(months) {
  const keys = [...months.keys()].sort();
  if (keys.length === 0) return [];
  const out = [];
  let [year, month] = keys[0].split('-').map(Number);
  const [lastYear, lastMonth] = keys[keys.length - 1].split('-').map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    out.push({ month: key, ...(months.get(key) || { you: 0, replies: 0, received: 0 }) });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return out;
}

function parseJson(text, fallback) {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

module.exports = { summarize };
