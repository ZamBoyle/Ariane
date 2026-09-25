'use strict';

/**
 * The size of the text, the keys that change it, and the menu around them.
 *
 * Until 25 September 2026 the only way to zoom was Electron's default menu,
 * hidden and in English: Ctrl+Shift+= and Ctrl+- worked, but Ctrl+= and the
 * numeric keypad — the keys everyone tries first — did nothing, and the same
 * menu offered the developer tools and a forced reload in every published
 * package. Measured on the running app, through its real input path.
 *
 * Everything here is pure, so the rules are tested without a window: main.js
 * applies them, settings.js keeps the size.
 */

/** The sizes offered, in percent — the same range as the other viewers offer. */
const TEXT_SIZES = [90, 100, 110, 120, 130];
const DEFAULT_TEXT_SIZE = 100;

/** The offered size closest to a percentage, e.g. an earlier zoom of 120.0001. */
function nearestSize(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return DEFAULT_TEXT_SIZE;
  return TEXT_SIZES.reduce((best, size) =>
    Math.abs(size - value) < Math.abs(best - value) ? size : best
  );
}

/**
 * One step up (+1), one down (-1), or back to the default (0) — never past
 * either end.
 */
function stepSize(current, step) {
  if (step === 0) return DEFAULT_TEXT_SIZE;
  const at = TEXT_SIZES.indexOf(nearestSize(current));
  const next = Math.min(TEXT_SIZES.length - 1, Math.max(0, at + Math.sign(step)));
  return TEXT_SIZES[next];
}

/**
 * What a key press asks of the window, if anything.
 *
 * Read from `before-input-event`, so the page never sees these keys. Both the
 * character and the physical key are looked at: on an AZERTY keyboard "0" is
 * typed with Shift and Ctrl+à arrives as `Digit0`; "+" is Shift+= everywhere,
 * and the keypad sends `NumpadAdd`.
 *
 * On macOS the application menu keeps quitting, closing and full screen under
 * their usual keys; elsewhere there is no menu any more, so they are here.
 *
 * @param {{type: string, key: string, code: string, control: boolean,
 *          meta: boolean, shift: boolean, alt: boolean}} input
 * @param {{platform?: string, packaged?: boolean}} [options]
 * @returns {null | 'text-bigger' | 'text-smaller' | 'text-reset' | 'quit' |
 *           'close' | 'fullscreen' | 'devtools'}
 */
function keyAction(input, { platform = process.platform, packaged = true } = {}) {
  if (!input || input.type !== 'keyDown' || input.alt) return null;
  const key = typeof input.key === 'string' ? input.key : '';
  const code = typeof input.code === 'string' ? input.code : '';
  const command = platform === 'darwin' ? input.meta : input.control;

  if (command) {
    if (key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd')
      return 'text-bigger';
    if (key === '-' || code === 'Minus' || code === 'NumpadSubtract') return 'text-smaller';
    if (key === '0' || code === 'Digit0' || code === 'Numpad0') return 'text-reset';
  }
  if (platform === 'darwin') return null;

  const letter = key.toLowerCase();
  if (input.control && !input.shift && letter === 'q') return 'quit';
  if (input.control && !input.shift && letter === 'w') return 'close';
  if (!input.control && key === 'F11') return 'fullscreen';
  // For whoever builds Ariane, never in a published package.
  if (!packaged && (key === 'F12' || (input.control && input.shift && letter === 'i'))) {
    return 'devtools';
  }
  return null;
}

/**
 * The application menu: none on Linux and Windows — it was hidden anyway —
 * and on macOS only what the system expects, since copy and paste there go
 * through the Edit menu. No View menu: its zoom would bypass the setting, and
 * its reload has no business in a published package.
 *
 * @returns {object[] | null} A template for Menu.buildFromTemplate, or null.
 */
function menuTemplate({ platform = process.platform, packaged = true } = {}) {
  if (platform !== 'darwin') return null;
  return [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
    ...(packaged
      ? []
      : [{ label: 'Development', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] }]),
  ];
}

module.exports = {
  TEXT_SIZES,
  DEFAULT_TEXT_SIZE,
  nearestSize,
  stepSize,
  keyAction,
  menuTemplate,
};
