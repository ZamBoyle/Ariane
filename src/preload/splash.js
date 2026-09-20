'use strict';

/**
 * The splash screen's bridge — three functions, and nothing else.
 *
 * It is deliberately separate from preload.js: that window opens before
 * everything else and has no reason to reach the index, the archive or the
 * settings. Handing it the app's full bridge would expose sixty functions to a
 * picture.
 */

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result || result.ok !== true) {
    throw new Error((result && result.error) || `IPC ${channel} failed`);
  }
  return result.data;
}

contextBridge.exposeInMainWorld('splash', {
  /** The window's sentences, in the app's language. */
  words: () => call('splash:words'),
  /** @param {boolean} on false: stop showing this screen at startup. */
  keep: (on) => call('splash:keep', { on: on === true }),
  /** Close it. Only the main process owns this window. */
  close: () => call('splash:close'),
});
