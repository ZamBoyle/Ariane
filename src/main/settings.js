'use strict';

/**
 * The one file the person edits: where each assistant's CLI lives.
 *
 * Finding a CLI is a guess — PATH, the system directories, a list of version
 * managers (terminal.js) — and the guess will always miss somewhere: a Nix
 * profile, an unusual Homebrew prefix, a corporate image. When it missed,
 * "Reprendre" opened a terminal that shut in the same instant, and nothing let
 * the person correct it. This file does.
 *
 * Two fields per assistant, and the split between them is the design:
 *
 *  - `detected` is what Ariane found. Ariane rewrites it; it is a record, never
 *    an order.
 *  - `command` belongs to the person. Empty, Ariane searches; a path, Ariane
 *    runs that and nothing else. Only the person writes it — in this file, or
 *    through the settings window, which saves exactly what they typed.
 *
 * Pre-filling `command` with the detection would read nicely and then rot: the
 * next nvm upgrade moves `codex`, and a path pinned without anyone deciding it
 * fails where detection would simply have followed.
 *
 * And three rules, because this is the person's work: an unreadable file is
 * never overwritten — a typo away from valid, it holds whatever they meant to
 * write; keys Ariane does not know are kept; writes are atomic.
 */

const fs = require('fs');
const path = require('path');

const { AGENTS } = require('../core/resume');

const FILE_NAME = 'settings.json';

/** Where a CLI typically lives on each system, for the example in the help. */
const EXAMPLES = {
  win32: 'C:/Users/vous/AppData/Roaming/npm/codex.cmd',
  darwin: '/Users/vous/.nvm/versions/node/v22.12.0/bin/codex',
  linux: '/home/vous/.nvm/versions/node/v22.12.0/bin/codex',
};

/** What `language` may hold: "auto", or a language tag such as `fr` or `pt-BR`. */
const LANGUAGE = /^(auto|[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?)$/;

/** What `theme` may hold: the system's choice, or one imposed over it. */
const THEMES = ['auto', 'light', 'dark'];

/** An agent id, as the registry spells them. */
const AGENT_ID = /^[a-z][a-z0-9-]*$/;

/** Assistants that have a CLI to launch, in a stable order: agentId -> command name. */
const CLI_AGENTS = Object.entries(AGENTS)
  .filter(([, agent]) => typeof agent.command === 'string')
  .map(([id, agent]) => [id, agent.command]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

class Settings {
  /**
   * @param {string} dir The app's user-data directory.
   * @param {object} [options]
   * @param {string} [options.platform] Which system the help's example is for.
   * @param {(example: string, platform: string) => string[]} [options.help]
   *   The lines written at the top of the file, in the app's language
   *   (locale.js). Without it the file carries no help.
   */
  constructor(dir, { platform = process.platform, help = null } = {}) {
    this.file = path.join(dir, FILE_NAME);
    this.platform = platform;
    this.help = help;
  }

  /** The language the person chose: "auto" unless they set one. */
  language() {
    const read = this.read();
    const value = read.ok ? read.data.language : undefined;
    return typeof value === 'string' && LANGUAGE.test(value) ? value : 'auto';
  }

  /**
   * The assistants the person chose not to see in the sidebar.
   *
   * A view preference, kept with the others rather than in the index: a schema
   * bump drops every table, and nobody wants their filter reset by a rebuild.
   * Unknown ids are kept in the file — an assistant may come back — but are not
   * returned, so a typo never hides anything.
   */
  hiddenAgents(known = null) {
    const read = this.read();
    const value = read.ok ? read.data.hiddenAgents : undefined;
    if (!Array.isArray(value)) return [];
    const ids = value.filter((id) => typeof id === 'string' && AGENT_ID.test(id));
    return known ? ids.filter((id) => known.includes(id)) : ids;
  }

  /**
   * Hide these assistants, show every other one.
   *
   * @param {string[]} ids
   * @param {Record<string, string|null>} detected What detection found, so this
   *   write leaves Ariane's own record as it was rather than blanking it.
   */
  hideAgents(ids, detected = {}) {
    if (!Array.isArray(ids)) throw new TypeError('hiddenAgents must be a list');
    const clean = [...new Set(ids)];
    for (const id of clean) {
      if (typeof id !== 'string' || !AGENT_ID.test(id)) throw new TypeError(`unknown assistant: ${id}`);
    }
    return this.#update(detected, {}, { hidden: clean });
  }

  /**
   * Whether the splash screen is shown at startup. True unless the person
   * ticked the box on it — a preference like the others, and the only one that
   * can be set without ever opening the settings window.
   */
  splash() {
    const read = this.read();
    return read.ok && read.data.splash === false ? false : true;
  }

  /** @param {boolean} on @param {Record<string, string|null>} detected */
  showSplash(on, detected = {}) {
    if (typeof on !== 'boolean') throw new TypeError('splash must be true or false');
    return this.#update(detected, {}, { splash: on });
  }

  /** The theme the person chose: "auto" — the system's — unless they set one. */
  theme() {
    const read = this.read();
    const value = read.ok ? read.data.theme : undefined;
    return typeof value === 'string' && THEMES.includes(value) ? value : 'auto';
  }

  /**
   * @returns {{ok: true, data: object} | {ok: false, error: string}}
   *   A missing file reads as empty; one that exists but is not a JSON object
   *   does not.
   */
  read() {
    const loaded = this.#load();
    return loaded.ok ? { ok: true, data: loaded.data } : { ok: false, error: loaded.error };
  }

  /** The file's content, parsed, and as it stands on disk (null when missing). */
  #load() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { ok: true, data: {}, text: null };
      return { ok: false, error: error.message };
    }
    try {
      const data = JSON.parse(text);
      if (!isPlainObject(data)) return { ok: false, error: 'le fichier doit contenir un objet JSON' };
      return { ok: true, data, text };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * The command the person chose for an assistant.
   *
   * @returns {{command: string|null, problem?: string}} null: search for it.
   *   `problem` says why the file could not be followed; the caller then falls
   *   back to detection and says so.
   */
  commandFor(agentId) {
    const read = this.read();
    if (!read.ok) return { command: null, problem: read.error };

    const agents = isPlainObject(read.data.agents) ? read.data.agents : {};
    const entry = Object.hasOwn(agents, agentId) ? agents[agentId] : null;
    if (!isPlainObject(entry) || entry.command === undefined || entry.command === null) {
      return { command: null };
    }
    if (typeof entry.command !== 'string') {
      return { command: null, problem: `« command » de ${agentId} doit être un texte` };
    }
    return { command: entry.command.trim() || null };
  }

  /**
   * Record what detection found, keeping everything the person wrote.
   *
   * @param {Record<string, string|null>} detected agentId -> path, or null when not found.
   * @returns {{ok: true, written: boolean} | {ok: false, error: string}}
   *   written: false when the file already said exactly this.
   */
  record(detected) {
    return this.#update(detected, {}, {});
  }

  /**
   * What the person chose in the settings window, saved as they typed it —
   * beside the detection, and without touching anything else in the file.
   *
   * @param {{commands?: Record<string, string>, language?: string, theme?: string}} choices
   *   commands: agentId -> path, '' to search again. language: "auto" or a tag.
   *   theme: "auto", "light" or "dark".
   * @param {Record<string, string|null>} detected
   * @throws {TypeError} For an assistant with no CLI, a command that is not
   *   text, a language that is not a tag, or a theme that is not one of three.
   */
  save({ commands = {}, language, theme } = {}, detected = {}) {
    for (const [id, command] of Object.entries(commands)) {
      if (!CLI_AGENTS.some(([known]) => known === id)) throw new TypeError(`unknown assistant: ${id}`);
      if (typeof command !== 'string') throw new TypeError(`command for ${id} must be text`);
    }
    if (language !== undefined && (typeof language !== 'string' || !LANGUAGE.test(language))) {
      throw new TypeError('language must be "auto" or a language tag');
    }
    if (theme !== undefined && (typeof theme !== 'string' || !THEMES.includes(theme))) {
      throw new TypeError('theme must be "auto", "light" or "dark"');
    }
    return this.#update(detected, commands, { language, theme });
  }

  #update(detected, commands, { language, theme, hidden, splash }) {
    const read = this.#load();
    if (!read.ok) return { ok: false, error: read.error }; // theirs to fix, not ours to replace

    const theirs = isPlainObject(read.data.agents) ? read.data.agents : {};
    const rest = { ...read.data };
    delete rest._aide; // rewritten below, in this version's words
    delete rest.agents;

    const agents = {};
    for (const [id] of CLI_AGENTS) {
      const entry = isPlainObject(theirs[id]) ? theirs[id] : {};
      const { command = '', ...more } = entry;
      delete more.detected;
      agents[id] = {
        command: Object.hasOwn(commands, id) ? commands[id].trim() : command,
        detected: detected[id] ?? null,
        ...more,
      };
    }
    // An assistant this version does not know is still the person's entry.
    for (const [id, entry] of Object.entries(theirs)) {
      if (!Object.hasOwn(agents, id)) agents[id] = entry;
    }

    const chosen = language ?? (typeof rest.language === 'string' ? rest.language : 'auto');
    delete rest.language;
    const chosenTheme = theme ?? (typeof rest.theme === 'string' ? rest.theme : 'auto');
    delete rest.theme;
    const chosenHidden = hidden ?? (Array.isArray(rest.hiddenAgents) ? rest.hiddenAgents : []);
    delete rest.hiddenAgents;
    const chosenSplash = splash ?? (rest.splash === false ? false : true);
    delete rest.splash;
    const help = this.help ? this.help(EXAMPLES[this.platform] || EXAMPLES.linux, this.platform) : null;
    const next = {
      ...(help ? { _aide: help } : {}),
      language: chosen,
      theme: chosenTheme,
      hiddenAgents: chosenHidden,
      splash: chosenSplash,
      agents,
      ...rest,
    };
    const text = `${JSON.stringify(next, null, 2)}\n`;
    if (read.text === text) return { ok: true, written: false };

    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const partial = `${this.file}.${process.pid}.partial`;
    try {
      fs.writeFileSync(partial, text, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(partial, this.file);
    } catch (error) {
      fs.rmSync(partial, { force: true });
      return { ok: false, error: error.message };
    }
    return { ok: true, written: true };
  }
}

module.exports = { Settings, CLI_AGENTS, FILE_NAME, EXAMPLES, THEMES, AGENT_ID };
