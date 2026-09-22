'use strict';

/**
 * Is there a newer Ariane, and should we say so?
 *
 * Pure: no network, no Electron, no clock of its own. Whoever calls it brings
 * the two versions and gets a decision back. `src/main/update-check.js` does
 * the asking; this file only ever answers.
 *
 * ── What a version is here ────────────────────────────────────────────────
 *
 * `major.minor.patch`, optionally followed by a pre-release (`-beta.2`). That
 * is what package.json carries and what a tag repeats. Anything else is not
 * refused loudly — it is simply not comparable, and an incomparable version
 * yields no offer. Saying nothing is always safe; announcing an update that is
 * not one is not.
 *
 * **A pre-release is never offered.** GitHub's `/releases/latest` already skips
 * them, so this is a second lock on the same door: someone tagging `v0.3.0-rc.1`
 * must not push it onto people who asked for releases.
 */

/** `v0.2.0` and `0.2.0` are the same version wearing different clothes. */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * @typedef {object} Version
 * @property {number[]} parts       major, minor, patch
 * @property {string|null} pre      the pre-release, or null for a real release
 */

/**
 * @param {unknown} value
 * @returns {Version|null} Null when it is not a version this can compare.
 */
function parse(value) {
  if (typeof value !== 'string') return null;
  const found = VERSION.exec(value.trim());
  if (!found) return null;
  return {
    parts: [Number(found[1]), Number(found[2]), Number(found[3])],
    pre: found[4] || null,
  };
}

/**
 * Compare two versions the way people read them: 0.10.0 is newer than 0.9.0,
 * whatever the strings do alphabetically. The pre-release is not ranked — it
 * only makes a version lower than the same one without it, which is enough
 * here since a pre-release is never offered anyway.
 *
 * @returns {number} -1, 0 or 1; null when either side is not comparable.
 */
function compare(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;

  for (let i = 0; i < 3; i += 1) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] < right.parts[i] ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  return left.pre ? -1 : 1;
}

/**
 * Should the person be told about `latest`?
 *
 * @param {object} args
 * @param {string} args.current  What is running — package.json's version.
 * @param {string} args.latest   What the release page answered, tag or version.
 * @returns {{update: true, version: string} | {update: false, reason: string}}
 *   A CODE, never a sentence: whoever shows it translates it.
 */
function decide({ current, latest } = {}) {
  const here = parse(current);
  const there = parse(latest);

  if (!here) return { update: false, reason: 'current-unreadable' };
  if (!there) return { update: false, reason: 'latest-unreadable' };
  // Never push someone onto an -rc who asked for releases.
  if (there.pre) return { update: false, reason: 'latest-prerelease' };

  const order = compare(current, latest);
  if (order === null) return { update: false, reason: 'latest-unreadable' };
  // Running something NEWER than the release page is normal for whoever builds
  // from source between two versions. It is not an update, and not a fault.
  if (order >= 0) return { update: false, reason: 'up-to-date' };

  return { update: true, version: there.parts.join('.') };
}

module.exports = { parse, compare, decide };
