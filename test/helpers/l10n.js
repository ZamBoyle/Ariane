'use strict';

/**
 * A localiser for tests, built from the real language files — the same words
 * the app shows, so an assertion on "Vous" or "Aucun résultat" checks what a
 * person actually reads.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const LOCALES = path.join(__dirname, '..', '..', 'src', 'locales');

let engine;
async function loadEngine() {
  if (!engine) engine = await import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'renderer', 'l10n.js')).href);
  return engine;
}

/** @param {string} [language] A file in src/locales; English backs it up, as in the app. */
async function localizer(language = 'fr', options = {}) {
  const { createLocalizer } = await loadEngine();
  const read = (code) => fs.readFileSync(path.join(LOCALES, `${code}.ftl`), 'utf8');
  const sources = [{ language, source: read(language) }];
  if (language !== 'en') sources.push({ language: 'en', source: read('en') });
  return createLocalizer({ language, sources, ...options });
}

module.exports = { localizer, loadEngine, LOCALES };
