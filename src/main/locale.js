'use strict';

/**
 * Which language the app speaks, and the words for it.
 *
 * The languages are the files in src/locales: dropping `pt-BR.ftl` there adds
 * Portuguese, with nothing to register. The choice is the person's setting
 * ("auto" by default), then the system's preferred languages, then English —
 * matched whole first (`pt-BR`), then by language (`fr-BE` finds `fr`).
 *
 * The renderer receives the chosen file and the English one, and builds its own
 * localiser from them; the main process keeps one too, for what it writes
 * itself: dialog titles, errors, exports, the settings file.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const LOCALES_DIR = path.join(__dirname, '..', 'locales');
const FALLBACK = 'en';
/** Mirrors LANGUAGE_TAG in l10n.js, which cannot be required from here. */
const TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

let engine = null;
/** l10n.js is an ES module shared with the renderer: imported once, when first needed. */
async function loadEngine() {
  if (!engine) engine = await import(pathToFileURL(path.join(__dirname, '..', 'renderer', 'l10n.js')).href);
  return engine;
}

class Locale {
  /**
   * @param {{dir?: string, systemLanguages?: () => string[]}} [options]
   */
  constructor({ dir = LOCALES_DIR, systemLanguages = () => [] } = {}) {
    this.dir = dir;
    this.systemLanguages = systemLanguages;
    this.current = null;
  }

  /** Every language that has a file, with its name in itself. */
  available() {
    let files;
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    return files
      .filter((file) => file.endsWith('.ftl') && TAG.test(file.slice(0, -4)))
      .map((file) => {
        const code = file.slice(0, -4);
        return { code, name: nameIn(this.source(code)) || code };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  source(code) {
    return fs.readFileSync(path.join(this.dir, `${code}.ftl`), 'utf8');
  }

  /**
   * Load the language `setting` asks for — "auto", or a code — and return it.
   * An unknown code falls back as "auto" does, rather than to nothing.
   */
  async use(setting = 'auto') {
    const { negotiateLanguage, createLocalizer } = await loadEngine();
    const codes = this.available().map((l) => l.code);
    const wanted = setting && setting !== 'auto' ? [setting, ...this.systemLanguages()] : this.systemLanguages();
    const language = negotiateLanguage(wanted, codes);
    const sources = this.sourcesFor(language);
    this.current = {
      setting: setting || 'auto',
      language,
      system: negotiateLanguage(this.systemLanguages(), codes),
      sources,
      l10n: createLocalizer({ language, sources }),
    };
    return this.current;
  }

  /** A language's own file, then English for whatever it lacks. */
  sourcesFor(language) {
    const sources = [{ language, source: this.source(language) }];
    if (language !== FALLBACK) sources.push({ language: FALLBACK, source: this.source(FALLBACK) });
    return sources;
  }

  /** The words of the language in use. Safe before `use()`: ids come back as themselves. */
  t(id, args) {
    return this.current ? this.current.l10n.t(id, args) : id;
  }
}

/** `language-name = Français` → "Français", without parsing the whole file. */
function nameIn(source) {
  const match = /^language-name\s*=\s*(.+)$/m.exec(source);
  return match ? match[1].trim() : '';
}

module.exports = { Locale, LOCALES_DIR, FALLBACK };
