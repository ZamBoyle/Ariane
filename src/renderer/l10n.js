/**
 * Localisation: every sentence the app shows comes from a Fluent file,
 * src/locales/<language>.ftl — one file per language, and adding a language
 * is adding a file.
 *
 * Fluent (Mozilla's format, the one Firefox uses) was chosen because it keeps
 * the grammar of each language in that language's file: plural forms, and any
 * other variation a sentence needs, are written by whoever translates, never
 * by the code. English has two plural forms, Polish three, Arabic six; the code
 * passes a number and nothing else.
 *
 * Everything that is not a sentence — dates, relative times, numbers — comes
 * from Intl, which knows every language already.
 *
 * Pure: no DOM, no Node. The renderer localises the screen with it, and the
 * main process imports it to write exports and dialogs in the same words (see
 * the ES-module exception in CLAUDE.md).
 */

import { FluentBundle, FluentResource } from '../../node_modules/@fluent/bundle/esm/index.js';

/** The language every other one falls back to, message by message. */
export const FALLBACK_LANGUAGE = 'en';

/** A BCP 47 tag as a locale file may be named: `fr`, `pt-BR`, `zh-CN`. */
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

/**
 * The language to use: the first one wanted that exists, matching the whole
 * tag first (`pt-BR`), then its language alone (`fr-BE` finds `fr`).
 *
 * @param {string[]} wanted In order of preference: the setting, then the system's.
 * @param {string[]} available Languages that have a file.
 */
export function negotiateLanguage(wanted, available) {
  const byLower = new Map(available.map((code) => [code.toLowerCase(), code]));
  for (const tag of wanted) {
    if (typeof tag !== 'string' || !tag) continue;
    const exact = byLower.get(tag.toLowerCase());
    if (exact) return exact;
    const base = tag.split(/[-_]/)[0].toLowerCase();
    const sameLanguage = byLower.get(base) || available.find((code) => code.toLowerCase().startsWith(`${base}-`));
    if (sameLanguage) return sameLanguage;
  }
  return available.includes(FALLBACK_LANGUAGE) ? FALLBACK_LANGUAGE : available[0];
}

/** Which way a language is written. */
export function directionOf(language) {
  try {
    const locale = new Intl.Locale(language);
    const info = typeof locale.getTextInfo === 'function' ? locale.getTextInfo() : locale.textInfo;
    return info && info.direction === 'rtl' ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

/**
 * A localiser for one language.
 *
 * @param {object} options
 * @param {string} options.language The language shown.
 * @param {Array<{language: string, source: string}>} options.sources Its file,
 *   then the fallback's: a message missing from the first is looked for in the next.
 * @param {boolean} [options.pseudo] Test only: every sentence comes out as
 *   ⟦…⟧, so a sentence that did not go through here stands out on screen.
 * @param {(problem: string) => void} [options.onProblem] Told of a missing
 *   message or a broken file; development only.
 */
/** SI prefixes for a count, largest first. */
const COMPACT_UNITS = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/** [the shortened number, its prefix] — [646, ''], [7.5, 'K'], [1, 'M']. */
function compactParts(n) {
  // `|| 0`: a count rounded to nothing is 0, not "-0".
  if (Math.abs(n) < 999.5) return [Math.round(n) || 0, ''];
  for (let i = 0; i < COMPACT_UNITS.length; i++) {
    const [size, unit] = COMPACT_UNITS[i];
    if (Math.abs(n) < size * 0.9995 && i < COMPACT_UNITS.length - 1) continue;
    const scaled = n / size;
    const rounded = Number(scaled.toFixed(Math.abs(scaled) < 99.95 ? 1 : 0));
    if (Math.abs(rounded) >= 1000 && i > 0) {
      const [bigger, biggerUnit] = COMPACT_UNITS[i - 1];
      return [Number((n / bigger).toFixed(1)), biggerUnit];
    }
    return [rounded, unit];
  }
  return [Math.round(n), ''];
}

export function createLocalizer({ language, sources, pseudo = false, onProblem = () => {} }) {
  const bundles = sources.map(({ language: code, source }) => {
    const bundle = new FluentBundle(code, {
      // Unicode isolation marks around every variable keep a Latin path
      // readable inside an Arabic sentence — and are invisible noise in a
      // left-to-right one, where they would end up in whatever is copied.
      useIsolating: directionOf(code) === 'rtl',
    });
    for (const error of bundle.addResource(new FluentResource(source))) {
      onProblem(`${code}: ${error.message}`);
    }
    return bundle;
  });

  // In the pseudo-language, dates and numbers are marked too: a date formatted
  // in the code itself, bypassing the language, would show up bare.
  const wrap = pseudo ? (text) => (text === '' ? text : `⟦${text}⟧`) : (text) => text;

  /** The bundle that has this message, and the message itself. */
  function find(id) {
    for (const bundle of bundles) {
      const message = bundle.getMessage(id);
      if (message) return { bundle, message };
    }
    onProblem(`missing message: ${id}`);
    return null;
  }

  function format(bundle, pattern, args) {
    const errors = [];
    const text = bundle.formatPattern(pattern, args, errors);
    for (const error of errors) onProblem(`${String(error)}`);
    return text;
  }

  const dates = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' });
  const days = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' });
  const dateTimes = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const fullDateTimes = new Intl.DateTimeFormat(language, { dateStyle: 'full', timeStyle: 'medium' });
  const units = Object.fromEntries(
    ['day', 'hour', 'minute', 'second'].map((unit) => [
      unit,
      new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'short' }),
    ])
  );
  const unitLists = new Intl.ListFormat(language, { style: 'short', type: 'unit' });
  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'always' });
  const numbers = new Intl.NumberFormat(language);
  const tenths = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const percents = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 });
  const months = new Intl.DateTimeFormat(language, { month: 'short', year: '2-digit' });
  const longMonths = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' });
  const lists = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' });

  return {
    language,
    direction: directionOf(language),

    /**
     * A message's text. Unknown ids come back as themselves — visible, and
     * reported — rather than as nothing.
     * @param {string} id
     * @param {Record<string, string|number>} [args]
     */
    t(id, args) {
      const found = find(id);
      if (!found || found.message.value === null) return wrap(id);
      return wrap(format(found.bundle, found.message.value, args));
    },

    /**
     * A message whole: its text, null when it has none, and its attributes
     * (`.title`, `.aria-label`, `.placeholder`…) — what an element is given.
     */
    message(id, args) {
      const found = find(id);
      if (!found) return { value: wrap(id), attributes: {} };
      const attributes = {};
      for (const [name, pattern] of Object.entries(found.message.attributes)) {
        attributes[name] = wrap(format(found.bundle, pattern, args));
      }
      const value = found.message.value === null ? null : wrap(format(found.bundle, found.message.value, args));
      return { value, attributes };
    },

    /** Whether a message exists, in this language or the fallback. */
    has(id) {
      return bundles.some((bundle) => bundle.hasMessage(id));
    },

    /** "12 Sept 2026", "12 sept. 2026", "2026年9月12日". Empty for a missing date. */
    date(iso) {
      const value = toDate(iso);
      return value ? wrap(dates.format(value)) : '';
    },

    /** "19 Sept", "19 sept.", "9月19日": a day on an axis, where the year goes without saying. */
    day(iso) {
      const value = toDate(iso);
      return value ? wrap(days.format(value)) : '';
    },

    dateTime(iso) {
      const value = toDate(iso);
      return value ? wrap(dateTimes.format(value)) : '';
    },

    /**
     * "25 sept. 2026, 09:12 – 11:47": two moments as one, what they share said
     * once — the way a calendar writes an event, in each language's own form
     * ("2026/9/25 9時12分～11時47分"). One moment when both are the same.
     */
    span(startIso, endIso) {
      const start = toDate(startIso);
      const end = toDate(endIso);
      if (!start || !end) return start || end ? wrap(dateTimes.format(start || end)) : '';
      if (end <= start) return wrap(dateTimes.format(start));
      return wrap(dateTimes.formatRange(start, end));
    },

    /** "vendredi 25 septembre 2026 à 09:12:04": a moment in full, for a tooltip. */
    fullDateTime(iso) {
      const value = toDate(iso);
      return value ? wrap(fullDateTimes.format(value)) : '';
    },

    /**
     * "2 h et 35 min", "2 days, 2 hr", "40 s": how long, in its two largest
     * units — minutes alone under an hour, seconds alone under a minute.
     * Empty for anything that is not a length of time.
     */
    duration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
      if (ms < 59500) return wrap(units.second.format(Math.round(ms / 1000)));
      const minutes = Math.round(ms / 60000);
      const parts =
        minutes < 60
          ? [['minute', minutes]]
          : minutes < 1440
            ? [
                ['hour', Math.floor(minutes / 60)],
                ['minute', minutes % 60],
              ]
            : [
                ['day', Math.floor(minutes / 1440)],
                ['hour', Math.floor((minutes % 1440) / 60)],
              ];
      const said = parts.filter(([, n]) => n > 0).map(([unit, n]) => units[unit].format(n));
      return wrap(unitLists.format(said));
    },

    /** "3 days ago", "il y a 3 jours": within a month, then the date itself. */
    ago(iso, now = Date.now()) {
      const value = toDate(iso);
      if (!value) return '';
      // A moment ahead of this clock — another machine's, set a little fast —
      // is said as ahead, "in 2 hours", never as "1 second ago".
      const elapsed = Math.floor((now - value.getTime()) / 1000);
      const sign = elapsed < 0 ? 1 : -1;
      const seconds = Math.max(1, Math.abs(elapsed));
      for (const [limit, unit, size] of RELATIVE_STEPS) {
        if (seconds < limit) return wrap(relative.format(sign * Math.max(1, Math.floor(seconds / size)), unit));
      }
      return wrap(dates.format(value));
    },

    number(value) {
      return wrap(numbers.format(value));
    },

    /**
     * "646", "7.5K", "190K", "14.5M", "2.2G" — "7,5K" in French. K, M, G and T
     * whatever the language, with the language's own decimal mark: a count of
     * tokens is read in SI prefixes, as the person asked. Intl's compact
     * notation was not used: it writes "7,5 k" in French, leaves thousands
     * whole in German and counts in 万 in Japanese — three widths for one line.
     * One decimal below 100, none above; a value that rounds up to the next
     * unit takes it ("1M", never "1000K").
     */
    compact(value) {
      // A number or nothing: Number(null) is 0, and an absence is not a zero.
      if (typeof value !== 'number' || !Number.isFinite(value)) return '';
      const [number, unit] = compactParts(value);
      return wrap(`${tenths.format(number)}${unit}`);
    },

    /** "6 %", "6%": a share, whole percent. Below one percent reads "<1 %" as the language writes it. */
    percent(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '';
      if (value > 0 && value < 0.005) return wrap(`<${percents.format(0.01)}`);
      return wrap(percents.format(value));
    },

    /**
     * A month from its "2026-09" key: "sept. 26" for an axis, "septembre 2026"
     * in full. Built on the 15th, so no time zone can move it into a neighbour.
     */
    month(key, { long = false } = {}) {
      const found = /^(\d{4})-(\d{2})$/.exec(String(key));
      if (!found) return '';
      const date = new Date(Number(found[1]), Number(found[2]) - 1, 15);
      return wrap((long ? longMonths : months).format(date));
    },

    /** "12 KB", "12 Ko", "12 kB": the unit as this language writes it. */
    bytes(value) {
      const n = Number(value) || 0;
      const [unit, size] =
        n < 1024
          ? ['byte', 1]
          : n < 1024 ** 2
            ? ['kilobyte', 1024]
            : n < 1024 ** 3
              ? ['megabyte', 1024 ** 2]
              : ['gigabyte', 1024 ** 3];
      return wrap(
        new Intl.NumberFormat(language, {
          style: 'unit',
          unit,
          unitDisplay: 'short',
          maximumFractionDigits: unit === 'byte' ? 0 : 1,
        }).format(n / size)
      );
    },

    /** "a, b and c", "a, b et c", "a、b、c". */
    list(items) {
      return wrap(lists.format(items));
    },
  };
}

const RELATIVE_STEPS = [
  [60, 'second', 1],
  [3600, 'minute', 60],
  [86400, 'hour', 3600],
  [2592000, 'day', 86400],
];

function toDate(iso) {
  if (!iso) return null;
  const value = new Date(iso);
  return Number.isNaN(value.getTime()) ? null : value;
}
