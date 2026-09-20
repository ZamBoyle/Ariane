#!/usr/bin/env node
'use strict';

/**
 * Builds the distributable packages.
 *
 * A thin wrapper around electron-builder that exists for one reason: it removes
 * LD_PRELOAD from the environment first.
 *
 * Several desktop Linux setups inject a library there — Ubuntu's
 * `libgtk3-nocsd.so.0` is the common one. When electron-builder shells out to
 * its helper binaries, or to Wine for the Windows targets, that library cannot
 * be preloaded into them and the build dies with a bare
 * `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`, naming nothing. It cost an afternoon to
 * find, so it is fixed here rather than left in a README for the next person.
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
const BUILDER = path.join(ROOT, 'node_modules', '.bin', 'electron-builder');

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

console.log(`[dist] electron-builder ${args.join(' ')}`);

const result = spawnSync(BUILDER, args, { cwd: ROOT, env, stdio: 'inherit', shell: false });

if (result.error) {
  console.error(`[dist] impossible de lancer electron-builder : ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
