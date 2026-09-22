#!/usr/bin/env node
'use strict';

/**
 * Builds the distributable packages.
 *
 * A thin wrapper around electron-builder that exists for two reasons: it removes
 * LD_PRELOAD from the environment, and it refuses to publish anything.
 *
 * Several desktop Linux setups inject a library there — Ubuntu's
 * `libgtk3-nocsd.so.0` is the common one. When electron-builder shells out to
 * its helper binaries, or to Wine for the Windows targets, that library cannot
 * be preloaded into them and the build dies with a bare
 * `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`, naming nothing. It cost an afternoon to
 * find, so it is fixed here rather than left in a README for the next person.
 *
 * The second reason cost a release. electron-builder publishes BY ITSELF when a
 * git tag is present — "Implicit publishing triggered by git tag" — and then
 * dies on a token it was never given, after having built every package
 * correctly. Building and publishing are two decisions, and this script only
 * makes the first: `--publish never` is appended unless the caller states a
 * policy of their own. What goes to a release, and when, is decided in
 * .github/workflows/release.yml.
 *
 *   npm run dist            every target this machine can build
 *   npm run dist:linux      AppImage + deb
 *   npm run dist:win        portable .exe + installer   (needs wine on Linux)
 *   npm run dist:mac        .dmg                        (needs macOS)
 *
 * Artifacts land in dist/, which is deliberately not tracked by git.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// The package's own entry, resolved rather than guessed. `node_modules/.bin/`
// holds a shell script on POSIX and a `.cmd` on Windows, and spawnSync refuses
// to run the second without a shell: the first native Windows build died on
// "spawnSync …\node_modules\.bin\electron-builder ENOENT", having been told
// to launch a file that does not exist under that name there. Handing the
// script to this very Node needs neither shim nor shell, and behaves the same
// on the three systems.
const BUILDER = require.resolve('electron-builder/cli.js');

const env = { ...process.env };
if (env.LD_PRELOAD) {
  console.log(`[dist] LD_PRELOAD écarté pour la construction : ${env.LD_PRELOAD}`);
  delete env.LD_PRELOAD;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/dist.js --linux [AppImage deb] | --win ... | --mac ...');
  process.exit(1);
}

// Unless the caller says otherwise: build, and stop there.
if (!args.some((a) => a === '--publish' || a === '-p' || a.startsWith('--publish='))) {
  args.push('--publish', 'never');
}

console.log(`[dist] electron-builder ${args.join(' ')}`);

const result = spawnSync(process.execPath, [BUILDER, ...args], { cwd: ROOT, env, stdio: 'inherit', shell: false });

if (result.error) {
  console.error(`[dist] impossible de lancer electron-builder : ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
