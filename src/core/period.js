'use strict';

/**
 * The search's "when": where a period starts.
 *
 * Counted in whole local days, because that is how a person counts them: at
 * 9 a.m., "the last 7 days" means today and the six days before it, mornings
 * included — not the 168 hours since 9 a.m. a week ago. Local midnight is found
 * through the calendar, never by subtracting 24-hour steps, which would land an
 * hour off on either side of a daylight-saving change.
 *
 * The result is an ISO instant in UTC, the exact shape every adapter stores
 * (`2026-09-19T08:00:00.000Z`), so the database compares it as plain text.
 */

/** Each period: how many days back it reaches, today included; or where it starts. */
const PERIODS = {
  all: null,
  '7d': { days: 7 },
  '30d': { days: 30 },
  year: { yearStart: true },
};

/**
 * @param {string} period One of the keys of PERIODS.
 * @param {Date} [now]
 * @returns {string|null} The first instant inside the period; null for no bound.
 * @throws {TypeError} For a period that does not exist — never silently "all":
 *   a filter quietly dropped shows results from outside the period asked for.
 */
function periodStart(period, now = new Date()) {
  if (typeof period !== 'string' || !Object.hasOwn(PERIODS, period)) {
    throw new TypeError(`unknown period: ${String(period).slice(0, 40)}`);
  }
  const rule = PERIODS[period];
  if (!rule) return null;

  const start = rule.yearStart
    ? new Date(now.getFullYear(), 0, 1)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (rule.days - 1));
  return start.toISOString();
}

module.exports = { periodStart, PERIODS };
