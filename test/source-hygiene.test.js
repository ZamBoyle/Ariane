'use strict';

/**
 * Invariant 6 of CLAUDE.md: no raw control byte in a source file. Git takes a
 * file holding one for binary, and from then on shows no diff of it at all —
 * the change is committed, and nobody can read it in review.
 *
 * It happened: a `\u0000` written through a tool that decoded it landed in
 * src/main/export.js as a real NUL, and the next change to that file showed
 * as "0 insertions, 0 deletions". Nothing caught it; this does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TEXT = /\.(js|cjs|mjs|json|css|html|md|sql|sh|yml|yaml)$/;
const SKIP = new Set(['node_modules', 'dist', 'prebuilds', '.git', 'coverage']);

function* sources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(full);
    else if (TEXT.test(entry.name)) yield full;
  }
}

/** Tab, line feed and carriage return are text; every other C0 byte, and DEL, is not. */
const isControl = (byte) => (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f;

test('no source file holds a raw control byte', () => {
  const offenders = [];
  let scanned = 0;
  for (const file of sources(ROOT)) {
    scanned += 1;
    const bytes = fs.readFileSync(file);
    const at = bytes.findIndex(isControl);
    if (at >= 0) {
      const line = bytes.subarray(0, at).toString('utf8').split('\n').length;
      offenders.push(`${path.relative(ROOT, file)}:${line} (0x${bytes[at].toString(16).padStart(2, '0')})`);
    }
  }
  assert.ok(scanned > 50, `only ${scanned} files scanned: the walk is broken`);
  assert.deepEqual(offenders, [], `write \\u0000, not the byte: ${offenders.join(', ')}`);
});
