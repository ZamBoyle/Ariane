/**
 * The settings window: where each assistant's CLI lives, for « Reprendre ».
 *
 * The file behind it belongs to the person (src/main/settings.js). This window
 * edits one field per assistant — the path they impose, empty to let Ariane
 * search — and shows beside it what Ariane found and whether it would run.
 * Nothing is launched to find out: the main process only looks.
 *
 * It lists first the assistants that matter on this machine — found here, used
 * in a conversation, or already set — and offers the others under "Add". It
 * also holds the choice of language, which reloads the window once saved, and
 * the choice of theme, which does not: the main process makes
 * prefers-color-scheme answer the chosen one, and the page repaints itself.
 *
 * Built from DOM nodes and textContent only: every path shown comes from the
 * disk or from the person, and none of it is ever markup.
 */

import { icon, setButton } from './icons.js';

/** Long enough not to check every keystroke, short enough to feel live. */
const CHECK_DELAY_MS = 250;

/**
 * What a check means, in words: the same vocabulary as a failed "Resume".
 * @param {{ok: boolean, executable?: string, reason?: string, detail?: string}} check
 * @param {boolean} chosen Whether the person typed a path, or detection answered.
 * @param {{t: Function}} l10n
 */
export function describeCheck(check, chosen, { t }) {
  if (check.ok) {
    return { ok: true, text: t(chosen ? 'settings-check-chosen' : 'settings-check-detected', { path: check.executable }) };
  }
  switch (check.reason) {
    case 'command-not-found':
      return { ok: false, text: t('settings-check-not-found') };
    case 'setting-not-absolute':
      return { ok: false, text: t('settings-check-not-absolute') };
    case 'setting-unusable':
      return { ok: false, text: t('settings-check-unusable', { path: check.detail }) };
    case 'interpreter-not-found':
      return { ok: false, text: t('settings-check-interpreter', { interpreter: check.detail }) };
    default:
      return { ok: false, text: t('settings-check-refused', { detail: check.detail || check.reason }) };
  }
}

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export class SettingsDialog {
  /**
   * @param {HTMLDialogElement} dialog The skeleton in index.html.
   * @param {object} options
   * @param {object} options.api
   * @param {(message: string, isError?: boolean) => void} options.toast
   * @param {object} options.l10n The words of the language in use.
   * @param {() => void} [options.onLanguageChange] Called once a new language
   *   is saved: every word on screen has to be written again.
   */
  constructor(dialog, { api, toast, l10n, onLanguageChange = () => {} }) {
    this.dialog = dialog;
    this.api = api;
    this.toast = toast;
    this.l10n = l10n;
    this.onLanguageChange = onLanguageChange;
    this.languageSelect = dialog.querySelector('#settings-language');
    this.themeSelect = dialog.querySelector('#settings-theme');
    this.updatesSelect = dialog.querySelector('#settings-updates');
    this.rows = dialog.querySelector('.settings-rows');
    this.banner = dialog.querySelector('.settings-banner');
    this.addButton = dialog.querySelector('.settings-add-btn');
    this.addMenu = dialog.querySelector('.settings-add-menu');
    this.saveButton = dialog.querySelector('.settings-save');
    this.jsonButton = dialog.querySelector('.settings-json');

    this.view = null;
    /** agentId -> the command as it was loaded, to know what changed. */
    this.loaded = new Map();
    /** agentId -> its row's parts. */
    this.parts = new Map();
    this.timers = new Map();
    this.tokens = new Map();

    dialog.querySelector('.settings-cancel').addEventListener('click', () => this.close());
    this.saveButton.addEventListener('click', () => this.save());
    this.jsonButton.addEventListener('click', () => this.openFile());
    this.addButton.addEventListener('click', () => this.toggleAddMenu());
    dialog.addEventListener('keydown', (event) => {
      // The nearer thing first: an open menu, then the window itself.
      if (event.key === 'Escape' && !this.addMenu.hidden) {
        event.preventDefault();
        this.closeAddMenu();
        this.addButton.focus();
      }
    });
    dialog.addEventListener('click', (event) => {
      if (!this.addMenu.hidden && !event.target.closest('.settings-add')) this.closeAddMenu();
    });
    dialog.addEventListener('close', () => this.closeAddMenu());
  }

  get isOpen() {
    return this.dialog.open;
  }

  /**
   * @param {{focus?: string|null}} [options] An assistant to put the cursor on —
   *   the one whose « Reprendre » just failed, listed even if it was not.
   */
  async open({ focus = null } = {}) {
    let view;
    try {
      view = await this.api.settings();
    } catch (error) {
      this.toast(error.message, true);
      return;
    }
    this.render(view, focus);
    if (!this.dialog.open) this.dialog.showModal();
    const target = (focus && this.parts.get(focus)?.input) || this.firstInput() || this.jsonButton;
    target.focus();
  }

  close() {
    this.dialog.close();
  }

  // -- painting ---------------------------------------------------------------

  render(view, focus = null) {
    this.view = view;
    this.loaded = new Map(view.agents.map((agent) => [agent.id, agent.command]));
    const matters = (agent) => agent.detected || agent.sessions > 0 || agent.command.trim() || agent.id === focus;
    const shown = new Set(view.agents.filter(matters).map((agent) => agent.id));
    // Nothing found and nothing used: every assistant, rather than an empty window.
    if (shown.size === 0) for (const agent of view.agents) shown.add(agent.id);

    this.parts.clear();
    this.rows.replaceChildren(...view.agents.map((agent) => this.row(agent, !shown.has(agent.id))));
    this.paintAddMenu();

    const locked = Boolean(view.unreadable);
    this.banner.hidden = !locked;
    this.banner.textContent = locked ? this.l10n.t('settings-unreadable', { error: view.unreadable }) : '';
    this.saveButton.disabled = locked;
    this.addButton.disabled = locked;
    this.paintLanguages(view.language, locked);
    this.paintTheme(view.theme, locked);
    this.paintUpdates(view.updateCheck, locked);
  }

  /** Automatic — the system's language, named — then every language that has a file, in itself. */
  paintLanguages(language, locked) {
    const nameOf = (code) => (language.available.find((l) => l.code === code) || {}).name || code;
    const options = [
      { value: 'auto', label: this.l10n.t('settings-language-auto', { language: nameOf(language.system) }) },
      ...language.available.map((l) => ({ value: l.code, label: l.name, lang: l.code })),
    ];
    this.languageSelect.replaceChildren(
      ...options.map((o) => {
        const option = node('option', '', o.label);
        option.value = o.value;
        // Each name in its own language, so a screen reader says it right.
        if (o.lang) option.lang = o.lang;
        return option;
      })
    );
    this.languageSelect.value = language.setting;
    this.languageSelect.disabled = locked;
  }

  /** The system's choice, then the two that override it. */
  paintTheme(theme, locked) {
    const { t } = this.l10n;
    this.themeSelect.replaceChildren(
      ...['auto', 'light', 'dark'].map((value) => {
        const option = node('option', '', t(`settings-theme-${value}`));
        option.value = value;
        return option;
      })
    );
    this.themeSelect.value = theme;
    this.themeSelect.disabled = locked;
  }

  /**
   * Whether Ariane may ask GitHub if a newer version exists.
   *
   * Off unless chosen, and the words say what it costs rather than what it
   * does: the question travels to GitHub, and so does the fact of asking it.
   */
  paintUpdates(value, locked) {
    const { t } = this.l10n;
    this.updatesSelect.replaceChildren(
      ...['never', 'startup'].map((choice) => {
        const option = node('option', '', t(`settings-updates-${choice}`));
        option.value = choice;
        return option;
      })
    );
    this.updatesSelect.value = value === 'startup' ? 'startup' : 'never';
    this.updatesSelect.disabled = locked;
  }

  row(agent, hidden) {
    const locked = Boolean(this.view.unreadable);
    const section = node('section', 'settings-row');
    section.dataset.agent = agent.id;
    section.hidden = hidden;

    const head = node('div', 'settings-row-head');
    const chip = node('span', 'agent-chip', agent.label);
    chip.dataset.agent = agent.id;
    const { t } = this.l10n;
    head.append(chip, node('span', 'settings-sessions', t('settings-sessions', { n: agent.sessions })));

    const detected = node(
      'p',
      'settings-detected',
      agent.detected ? t('settings-detected', { path: agent.detected }) : t('settings-not-detected')
    );

    const input = node('input', 'settings-input');
    input.type = 'text';
    input.id = `settings-command-${agent.id}`;
    input.value = agent.command;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.disabled = locked;
    this.localizeAs(input, 'settings-path-input', { agent: agent.label });
    const label = node('label', 'settings-label', t('settings-path-label'));
    label.htmlFor = input.id;

    const browse = node('button', 'ghost-btn settings-browse');
    browse.type = 'button';
    browse.disabled = locked;
    setButton(browse, { icon: 'folderOpen', label: t('settings-browse') });
    this.localizeAs(browse, 'settings-browse', { agent: agent.label }, ['aria-label']);

    const field = node('div', 'settings-field');
    field.append(input, browse);

    const status = node('p', 'settings-check');
    status.setAttribute('aria-live', 'polite');
    this.paintCheck(status, agent.check, agent.command.trim() !== '');

    input.addEventListener('input', () => this.scheduleCheck(agent.id));
    browse.addEventListener('click', () => this.browse(agent.id));

    section.append(head, detected, label, field, status);
    this.parts.set(agent.id, { section, input, status });
    return section;
  }

  /** Give an element a message's attributes (placeholder, aria-label…), leaving its content alone. */
  localizeAs(element, id, args, only = null) {
    const { attributes } = this.l10n.message(id, args);
    for (const [name, text] of Object.entries(attributes)) {
      if (!only || only.includes(name)) element.setAttribute(name, text);
    }
  }

  paintCheck(status, check, chosen) {
    const { ok, text } = describeCheck(check, chosen, this.l10n);
    status.className = `settings-check ${ok ? 'ok' : 'bad'}`;
    status.replaceChildren(icon(ok ? 'check' : 'close'), node('span', '', text));
  }

  paintAddMenu() {
    const hidden = this.view.agents.filter((agent) => this.parts.get(agent.id).section.hidden);
    this.addButton.hidden = hidden.length === 0;
    this.addMenu.replaceChildren(
      ...hidden.map((agent) => {
        const item = node('button', 'menu-item', agent.label);
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.addEventListener('click', () => this.add(agent.id));
        return item;
      })
    );
  }

  // -- acting -----------------------------------------------------------------

  /** An assistant Ariane knows, not listed yet: its row, ready to be filled. */
  add(id) {
    this.closeAddMenu();
    this.parts.get(id).section.hidden = false;
    this.paintAddMenu();
    this.parts.get(id).input.focus();
  }

  toggleAddMenu() {
    if (!this.addMenu.hidden) return this.closeAddMenu();
    this.addMenu.hidden = false;
    this.addButton.setAttribute('aria-expanded', 'true');
    this.addMenu.querySelector('.menu-item')?.focus();
  }

  closeAddMenu() {
    this.addMenu.hidden = true;
    this.addButton.setAttribute('aria-expanded', 'false');
  }

  scheduleCheck(id, delay = CHECK_DELAY_MS) {
    const { input, status } = this.parts.get(id);
    clearTimeout(this.timers.get(id));
    // A late answer must never overwrite the answer to what is typed now.
    const token = (this.tokens.get(id) || 0) + 1;
    this.tokens.set(id, token);
    status.className = 'settings-check pending';
    status.replaceChildren(node('span', '', this.l10n.t('settings-check-pending')));
    this.timers.set(
      id,
      setTimeout(async () => {
        let check;
        try {
          check = await this.api.checkCommand(id, input.value);
        } catch (error) {
          check = { ok: false, reason: 'refused', detail: error.message };
        }
        if (this.tokens.get(id) === token) this.paintCheck(status, check, input.value.trim() !== '');
      }, delay)
    );
  }

  async browse(id) {
    let file = null;
    try {
      file = await this.api.browseCommand(id);
    } catch (error) {
      this.showProblem(error.message);
    }
    const { input } = this.parts.get(id);
    if (file) {
      input.value = file;
      this.scheduleCheck(id, 0);
    }
    input.focus();
  }

  /** What the person typed, for every assistant listed. */
  commands() {
    const commands = {};
    for (const [id, { section, input }] of this.parts) if (!section.hidden) commands[id] = input.value;
    return commands;
  }

  isDirty() {
    if (this.languageSelect.value !== this.view.language.setting) return true;
    if (this.themeSelect.value !== this.view.theme) return true;
    if (this.updatesSelect.value !== this.view.updateCheck) return true;
    return Object.entries(this.commands()).some(([id, value]) => value !== (this.loaded.get(id) ?? ''));
  }

  /**
   * @param {{close?: boolean, reload?: boolean}} [options] reload: when the
   *   language changed, write the window again now — every word on screen is
   *   in the old one. A caller with more to do first passes false, and does it.
   * @returns {Promise<false | {languageChanged: boolean}>} False when nothing was saved.
   */
  async save({ close = true, reload = true } = {}) {
    const language = this.languageSelect.value;
    const languageChanged = language !== this.view.language.setting;
    const theme = this.themeSelect.value;
    const themeChanged = theme !== this.view.theme;
    const updates = this.updatesSelect.value;
    const updatesChanged = updates !== this.view.updateCheck;
    try {
      const view = await this.api.saveSettings(
        this.commands(),
        languageChanged ? language : undefined,
        themeChanged ? theme : undefined,
        updatesChanged ? updates : undefined
      );
      if (languageChanged) {
        this.close();
        if (reload) this.onLanguageChange();
        return { languageChanged };
      }
      if (close) {
        this.close();
        this.toast(this.l10n.t('settings-saved'));
      } else {
        this.render(view);
      }
      return { languageChanged };
    } catch (error) {
      // Said inside the window: a message behind a modal would go unseen.
      this.showProblem(error.message);
      return false;
    }
  }

  /**
   * The file itself, in the person's editor. What they typed here is saved
   * first, so the file shows what the window did.
   */
  async openFile() {
    let saved = { languageChanged: false };
    if (!this.view.unreadable && this.isDirty()) {
      saved = await this.save({ close: false, reload: false });
      if (!saved) return;
    }
    this.close();
    try {
      const result = await this.api.openSettingsFile();
      const { t } = this.l10n;
      if (result.unreadable) this.toast(t('settings-opened-unreadable', { error: result.unreadable }), true);
      else this.toast(result.opened ? t('settings-opened') : t('settings-opened-at', { path: result.path }));
    } catch (error) {
      this.toast(error.message, true);
    }
    if (saved.languageChanged) this.onLanguageChange();
  }

  showProblem(message) {
    this.banner.hidden = false;
    this.banner.textContent = message;
  }

  firstInput() {
    for (const { section, input } of this.parts.values()) if (!section.hidden && !input.disabled) return input;
    return null;
  }
}
