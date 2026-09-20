'use strict';

/**
 * Where the window was, and how big.
 *
 * Electron remembers nothing: every launch opened at 1280×860, centred,
 * whatever the person had done with the window the day before.
 *
 * This is NOT kept in settings.json. That file is the one a person opens and
 * edits by hand (CLI paths, language, theme); a window position changes every
 * time a window is dragged, and machine state has no business churning a file
 * someone writes in. It lives in `<userData>/window.json`, beside the index and
 * the archive.
 *
 * ── The trap this module exists for ───────────────────────────────────────
 * A position is only meaningful on the screen it was saved on. Unplug the
 * second monitor, dock a laptop, change the resolution — and a faithfully
 * restored `x: 2400` puts the window where nobody can reach it, with no visible
 * way to get it back. So a saved position is only followed when it still lands
 * on a screen that exists, with enough of the window on it to be grabbed;
 * otherwise the size is kept and the position is forgotten, and the window is
 * centred as on a first launch.
 *
 * Everything here is pure but for the read and the write: `displays` is passed
 * in, so the rules are tested without a screen.
 */

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'window.json';

/** Enough of the window on a screen to be seen and dragged back. */
const VISIBLE_MARGIN = 80;

const isFinitePositive = (value) => Number.isFinite(value) && value > 0;

/**
 * Does this rectangle show enough of itself on one of these screens?
 *
 * @param {{x: number, y: number, width: number, height: number}} bounds
 * @param {Array<{x: number, y: number, width: number, height: number}>} areas
 *   The work areas of the screens, as Electron reports them.
 */
function onScreen(bounds, areas) {
  return areas.some((area) => {
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapX >= VISIBLE_MARGIN && overlapY >= VISIBLE_MARGIN;
  });
}

/**
 * The bounds to open with, from what was saved and what the screens are now.
 *
 * @param {object|null} saved What the file held, or null.
 * @param {{width: number, height: number, minWidth: number, minHeight: number}} fallback
 * @param {Array<object>} areas Work areas of the screens available right now.
 * @returns {{width: number, height: number, x?: number, y?: number, maximized: boolean}}
 */
function boundsFrom(saved, fallback, areas = []) {
  const out = { width: fallback.width, height: fallback.height, maximized: false };
  if (!saved || typeof saved !== 'object') return out;

  // A size is portable: it means the same thing on any screen. Only clamp it to
  // what the app itself accepts, and to the largest screen there is.
  const widest = Math.max(fallback.width, ...areas.map((a) => a.width));
  const tallest = Math.max(fallback.height, ...areas.map((a) => a.height));
  if (isFinitePositive(saved.width) && isFinitePositive(saved.height)) {
    out.width = Math.min(Math.max(Math.round(saved.width), fallback.minWidth), widest);
    out.height = Math.min(Math.max(Math.round(saved.height), fallback.minHeight), tallest);
  }

  out.maximized = saved.maximized === true;

  // A position is not portable. It is followed only if it still lands somewhere
  // a person can see and grab.
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && areas.length) {
    const candidate = { x: Math.round(saved.x), y: Math.round(saved.y), width: out.width, height: out.height };
    if (onScreen(candidate, areas)) {
      out.x = candidate.x;
      out.y = candidate.y;
    }
  }
  return out;
}

class WindowState {
  /** @param {string} dir The app's user-data directory. */
  constructor(dir) {
    this.file = path.join(dir, FILE_NAME);
  }

  /** What was saved, or null — an unreadable file is not an error worth raising. */
  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {{width: number, height: number, minWidth: number, minHeight: number}} fallback
   * @param {Array<object>} areas
   */
  bounds(fallback, areas = []) {
    return boundsFrom(this.read(), fallback, areas);
  }

  /**
   * Remember it. Written atomically, like everything else here: a window closed
   * by a crash must not leave half a file behind.
   *
   * @param {{width: number, height: number, x: number, y: number, maximized: boolean}} state
   */
  save(state) {
    if (!isFinitePositive(state.width) || !isFinitePositive(state.height)) return { ok: false };
    const next = {
      width: Math.round(state.width),
      height: Math.round(state.height),
      x: Number.isFinite(state.x) ? Math.round(state.x) : undefined,
      y: Number.isFinite(state.y) ? Math.round(state.y) : undefined,
      maximized: state.maximized === true,
    };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const partial = `${this.file}.${process.pid}.partial`;
      fs.writeFileSync(partial, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(partial, this.file);
      return { ok: true };
    } catch (error) {
      // Nothing here is worth interrupting anyone for: the window simply opens
      // where it always did next time.
      return { ok: false, error: error.message };
    }
  }
}

module.exports = { WindowState, boundsFrom, onScreen, FILE_NAME, VISIBLE_MARGIN };
