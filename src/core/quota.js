'use strict';

/**
 * What an assistant's usage limits stood at — read from its own files, never
 * asked of its servers. Pure: no I/O.
 *
 * Codex writes a reading with every `token_count` (7 133 of 7 541, measured on
 * 25 September 2026): for each window — five hours, a week — the percentage
 * used and when the window ends; and the credit balance. Claude writes nothing
 * of the kind, except on the request its limit refused: a 429 whose record
 * carries `quotaLimits` (75, on three days, 69 of them in subagents) — the
 * window's kind and its end, no percentage.
 *
 * A percentage is a READING, not a count: it is never summed. Four measured
 * facts shape how readings are kept:
 *
 *  - The windows changed in July 2026: five hours and a week, then a week
 *    alone. A window is known by its length in minutes, never by the slot
 *    (`primary`, `secondary`) it was written in.
 *  - The same window's end moves by a second or two from one reading to the
 *    next (49 of 91 five-hour ends were within ten minutes of another). One
 *    window is therefore every reading of that length whose end is within
 *    WINDOW_SLACK of another's.
 *  - Within a window, usage only grows — yet 16 readings went down, each from
 *    another conversation than the one before, and a fork copies old records
 *    with its own date on them: 0 % for a week already at 95 %. So a window
 *    keeps its HIGHEST reading, which no copy can raise, dated the first time
 *    it was seen, which a copy always comes after.
 *  - Past 100 %, Codex goes on with credits, and the balance falls reading
 *    after reading: 500 down to 123.27 over one week at 100 %. So the plan and
 *    the credits come from the LAST reading at that highest level — never from
 *    a lower one, which is another conversation's stale view.
 *  - The oldest format (October 2025) wrote no end at all. Those windows cannot
 *    be told apart and are not kept.
 */

/** How far apart two readings' window ends may be and still be one window, in seconds. */
const WINDOW_SLACK = 600;

/** Claude names its windows; Codex counts them in minutes. */
const CLAUDE_WINDOWS = { five_hour: 300, seven_day: 10080 };

/**
 * The windows of Claude's cached reading, and the limit each belongs to: the
 * plan's own, or a model's. Its other keys are code names, empty here, with no
 * meaning a reader could be told.
 */
const CLAUDE_CACHED = {
  five_hour: ['claude', 300],
  seven_day: ['claude', 10080],
  seven_day_opus: ['opus', 10080],
  seven_day_sonnet: ['sonnet', 10080],
};

/**
 * @typedef {object} QuotaWindow  One window of one limit, as far as it was read.
 * @property {string} limit        Codex's `limit_id` ('codex', 'premium'), or 'claude'
 * @property {number} minutes      Its length
 * @property {number} resetsAt     When it ends, in epoch seconds
 * @property {number|null} used    The highest percentage read; null when the agent never says
 * @property {boolean} reached     The limit refused a request, or stood at 100 %
 * @property {string} at           When that highest reading was first seen (ISO)
 * @property {string} lastAt       When it was last read at that level (ISO)
 * @property {string|null} plan    The plan named by that last reading
 * @property {{has: boolean, unlimited: boolean, balance: number|null}|null} credits  Idem
 */

/** @returns {QuotaWindow[]} The windows one Codex `rate_limits` object reads. */
function codexQuota(limits, at) {
  if (!limits || typeof limits !== 'object' || typeof at !== 'string' || !at) return [];
  const limit = typeof limits.limit_id === 'string' && limits.limit_id ? limits.limit_id : 'codex';
  const plan = typeof limits.plan_type === 'string' && limits.plan_type ? limits.plan_type : null;
  const c = limits.credits;
  const credits =
    c && typeof c === 'object'
      ? {
          has: Boolean(c.has_credits),
          unlimited: Boolean(c.unlimited),
          // Written as a string: "260.2003100000".
          balance: c.balance == null || c.balance === '' ? null : finite(Number(c.balance)),
        }
      : null;

  const windows = [];
  for (const slot of [limits.primary, limits.secondary]) {
    if (!slot || typeof slot !== 'object') continue;
    const minutes = finite(Number(slot.window_minutes));
    const resetsAt = finite(Number(slot.resets_at));
    const used = finite(Number(slot.used_percent));
    if (!(minutes > 0) || !(resetsAt > 0) || used == null) continue;
    windows.push({
      limit,
      minutes,
      resetsAt,
      used,
      reached: used >= 100,
      at,
      lastAt: at,
      plan,
      credits,
    });
  }
  return windows;
}

/** @returns {QuotaWindow[]} The window a refused Claude request names, if it names one. */
function claudeQuota(limits, at) {
  if (!limits || typeof limits !== 'object' || typeof at !== 'string' || !at) return [];
  const minutes = CLAUDE_WINDOWS[limits.rateLimitType];
  const resetsAt = finite(Number(limits.resetsAt));
  if (!minutes || !(resetsAt > 0)) return [];
  return [
    {
      limit: 'claude',
      minutes,
      resetsAt,
      used: null,
      reached: limits.status === 'rejected',
      at,
      lastAt: at,
      plan: null,
      credits: null,
    },
  ];
}

/**
 * @returns {QuotaWindow[]} Claude's last reading of its limits, from
 * `cachedUsageUtilization` in `~/.claude.json` (paths.globalStateFile): what
 * Claude Code last fetched, with the time it did. One reading, not a history —
 * measured on 25 September 2026, it dated from the 23rd.
 */
function claudeCachedQuota(cache) {
  if (!cache || typeof cache !== 'object' || !Number.isFinite(cache.fetchedAtMs)) return [];
  const at = new Date(cache.fetchedAtMs).toISOString();
  const usage = cache.utilization && typeof cache.utilization === 'object' ? cache.utilization : {};
  const windows = [];
  for (const [key, [limit, minutes]] of Object.entries(CLAUDE_CACHED)) {
    const w = usage[key];
    if (!w || typeof w !== 'object') continue;
    const used = finite(Number(w.utilization));
    const resetsAt = finite(Math.round(Date.parse(w.resets_at) / 1000));
    if (used == null || !(resetsAt > 0)) continue;
    windows.push({
      limit,
      minutes,
      resetsAt,
      used,
      reached: used >= 100,
      at,
      lastAt: at,
      plan: null,
      credits: null,
    });
  }
  return windows;
}

/** Are these two readings of one and the same window? */
function sameWindow(a, b) {
  return (
    a.limit === b.limit &&
    a.minutes === b.minutes &&
    Math.abs(a.resetsAt - b.resetsAt) <= WINDOW_SLACK
  );
}

/**
 * What a window keeps, of what it holds and a new reading: the higher level;
 * at an equal level, the first time it was seen, and the plan and credits of
 * the last. A lower reading changes nothing but `reached`.
 */
function keeper(held, next) {
  const reached = held.reached || next.reached;
  const a = held.used ?? -1;
  const b = next.used ?? -1;
  if (b > a) return { ...next, reached };
  if (b < a) return { ...held, reached };
  const latest = next.lastAt > held.lastAt ? next : held;
  return {
    ...held,
    reached,
    at: next.at < held.at ? next.at : held.at,
    lastAt: latest.lastAt,
    plan: latest.plan,
    credits: latest.credits,
    session: latest.session,
  };
}

/** Add readings to a list of windows, in place: one entry per window. */
function addReadings(windows, readings) {
  for (const reading of readings) {
    const i = windows.findIndex((w) => sameWindow(w, reading));
    if (i < 0) windows.push(reading);
    else windows[i] = keeper(windows[i], reading);
  }
  return windows;
}

const finite = (n) => (Number.isFinite(n) ? n : null);

module.exports = {
  WINDOW_SLACK,
  CLAUDE_WINDOWS,
  codexQuota,
  claudeQuota,
  claudeCachedQuota,
  sameWindow,
  keeper,
  addReadings,
};
