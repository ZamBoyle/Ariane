'use strict';

/**
 * The only bridge between the sandboxed renderer and the main process.
 *
 * Nothing from Node or Electron is exposed directly: the renderer gets a fixed
 * set of functions, each mapping to one IPC channel. There is no generic
 * `invoke(channel, ...)` escape hatch, so a compromised renderer cannot reach a
 * channel this file does not name.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Unwrap the `{ ok, data, error }` envelope into a value or a thrown Error. */
async function call(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result || result.ok !== true) {
    throw new Error((result && result.error) || `IPC ${channel} failed`);
  }
  return result.data;
}

contextBridge.exposeInMainWorld('api', {
  status: () => call('app:status'),
  /** @param {{quiet?: boolean}} [options] quiet: no progress events (background passes). */
  refresh: (options = {}) => call('index:refresh', { quiet: options.quiet === true }),
  agents: () => call('agents:list'),
  folders: () => call('folders:list'),
  sessions: (folderId) => call('sessions:list', { folderId }),
  session: (id) => call('session:get', { id }),
  /** Every conversation the person starred, newest first. */
  favorites: () => call('sessions:favorites'),
  /** @param {{favorite?: boolean, note?: string}} change What is not named is left as it was. */
  markSession: (id, change = {}) => call('session:mark', { id, ...change }),
  /** Star one message of a conversation, or take its star off. */
  markMessage: (id, messageId, favorite) => call('session:markMessage', { id, messageId, favorite }),
  search: (query, options = {}) => call('search:run', { query, ...options }),
  statistics: (period) => call('stats:get', { period }),
  openFolder: (path) => call('shell:openFolder', { path }),
  resumeInfo: (id) => call('session:resumeInfo', { id }),
  resume: (id) => call('session:resume', { id }),
  /**
   * Hide these assistants in the sidebar, show every other one. The choice is
   * kept in settings.json, so it holds from one launch to the next.
   * @param {string[]} ids
   */
  hideAgents: (ids) => call('agents:hide', { ids }),

  /** The settings window: where each assistant's CLI lives. */
  settings: () => call('settings:get'),
  checkCommand: (id, command) => call('settings:check', { id, command }),
  /**
   * @param {string} [language] "auto" or a language code; left out, the language stays.
   * @param {string} [theme] "auto", "light" or "dark"; left out, the theme stays.
   * @param {string} [updateCheck] "never" or "startup"; left out, it stays.
   */
  saveSettings: (commands, language, theme, updateCheck) =>
    call('settings:save', { commands, language, theme, updateCheck }),

  /**
   * Is there a newer Ariane? Answers `{update, version?, url?, reason?}`.
   *
   * Asks nothing when the person did not ask for it: the setting is read in
   * the main process, BEFORE any request leaves the machine.
   */
  checkUpdate: () => call('update:check'),

  /**
   * Open the release page in the browser. No url crosses the bridge — the main
   * process rebuilds it from the manifest, because a window does not get to
   * choose what `shell.openExternal` is handed.
   */
  openRelease: () => call('update:open'),
  /** The language to show, its words, and the English ones to fall back on. */
  locale: () => call('app:locale'),
  browseCommand: (id) => call('settings:browse', { id }),
  openSettingsFile: () => call('settings:openFile'),
  copy: (text) => call('clipboard:write', { text }),
  forget: (id) => call('session:forget', { id }),
  /** @param {'md'|'pdf'} format */
  exportSession: (id, format, options = {}) =>
    call('session:export', { id, format, newestFirst: options.newestFirst === true }),
  copyMessage: (id) => call('message:copy', { id }),

  /**
   * Subscribe to indexing progress.
   * @param {(progress: object) => void} listener
   * @returns {() => void} Unsubscribe.
   */
  onIndexProgress(listener) {
    // The raw IpcRendererEvent is never handed to the renderer.
    const wrapped = (_event, progress) => listener(progress);
    ipcRenderer.on('index:progress', wrapped);
    return () => ipcRenderer.removeListener('index:progress', wrapped);
  },
});
