'use strict';

/**
 * Picks the better-sqlite3 native binding that matches the current runtime.
 *
 * better-sqlite3 is a native module, and Electron ships a different
 * NODE_MODULE_VERSION than the Node that runs the test suite. Loading the wrong
 * one does not raise a catchable error — the process dies with SIGILL the first
 * time it calls into the library.
 *
 * Both ABIs are therefore compiled once into `prebuilds/`, and the right file is
 * selected *by path* at open time. Nothing under node_modules is ever mutated,
 * so `npm test` and a running app coexist safely. An earlier design swapped the
 * file in place and killed any open window; do not reintroduce it.
 */

const fs = require('fs');
const path = require('path');

const PREBUILDS = path.join(__dirname, '..', '..', 'prebuilds');

/** 'electron' inside an Electron process, 'node' everywhere else. */
function runtime(versions = process.versions) {
  return versions.electron ? 'electron' : 'node';
}

function prebuildPath(target = runtime()) {
  return path.join(PREBUILDS, `better_sqlite3-${target}.node`);
}

/**
 * Absolute path to the binding to load, or `undefined` to let better-sqlite3
 * resolve its own default build (which is correct on a machine that only ever
 * built for one runtime).
 *
 * @returns {string|undefined}
 */
function nativeBinding() {
  const candidate = prebuildPath();
  return fs.existsSync(candidate) ? candidate : undefined;
}

module.exports = { nativeBinding, prebuildPath, runtime, PREBUILDS };
