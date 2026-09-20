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
  const dateTimes = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'always' });
  const numbers = new Intl.NumberFormat(language);
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

    dateTime(iso) {
      const value = toDate(iso);
      return value ? wrap(dateTimes.format(value)) : '';
    },

    /** "3 days ago", "il y a 3 jours": within a month, then the date itself. */
    ago(iso, now = Date.now()) {
      const value = toDate(iso);
      if (!value) return '';
      const seconds = Math.max(1, Math.floor((now - value.getTime()) / 1000));
      for (const [limit, unit, size] of RELATIVE_STEPS) {
        if (seconds < limit) return wrap(relative.format(-Math.max(1, Math.floor(seconds / size)), unit));
      }
      return wrap(dates.format(value));
    },

    number(value) {
      return wrap(numbers.format(value));
    },

    /** "12 KB", "12 Ko", "12 kB": the unit as this language writes it. */
    bytes(value) {
      const n = Number(value) || 0;
      const [unit, size] = n < 1024 ? ['byte', 1] : n < 1024 * 1024 ? ['kilobyte', 1024] : ['megabyte', 1024 * 1024];
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
