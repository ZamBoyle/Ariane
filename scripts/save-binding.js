#!/usr/bin/env node
'use strict';

/**
 * Caches the freshly compiled better-sqlite3 binding under `prebuilds/`.
 *
 * Electron and Node ship different NODE_MODULE_VERSIONs, so each is built once
 * and kept side by side. `src/core/binding.js` then selects the right file *by
 * path* at runtime — nothing under node_modules is ever modified, which is what
 * lets `npm test` run while the app is open.
 *
 * Usage:
 *   node scripts/save-binding.js node|electron   cache the current build
 *   node scripts/save-binding.js --status        report what is cached
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { prebuildPath, runtime, PREBUILDS } = require('../src/core/binding');

const ROOT = path.join(__dirname, '..');
const BUILT = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const TARGETS = ['node', 'electron'];

function digest(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

function save(target) {
  if (!TARGETS.includes(target)) fail(`unknown target "${target}" (expected: ${TARGETS.join(', ')})`);
  if (!fs.existsSync(BUILT)) fail(`nothing built at ${path.relative(ROOT, BUILT)} — run the rebuild first`);

  fs.mkdirSync(PREBUILDS, { recursive: true });
  fs.copyFileSync(BUILT, prebuildPath(target));
  console.log(`[save-binding] cached the ${target} binding (${digest(BUILT)})`);
}

function status() {
  console.log(`current runtime: ${runtime()}`);
  for (const target of TARGETS) {
    const file = prebuildPath(target);
    const hash = digest(file);
    console.log(`  ${target.padEnd(8)} ${hash ? `${hash}  ${path.relative(ROOT, file)}` : 'not cached'}`);
  }
  if (!digest(prebuildPath('node')) || !digest(prebuildPath('electron'))) {
    console.log('\nMissing one? run: npm run rebuild:node && npm run rebuild:electron');
  }
}

function fail(message) {
  console.error(`[save-binding] ${message}`);
  process.exit(1);
}

const [, , arg] = process.argv;
if (arg === '--status') status();
else if (arg) save(arg);
else fail('missing target (node|electron) or --status');
