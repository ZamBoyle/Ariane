'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readRecords, readAll } = require('../src/core/jsonl');

function tmpFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-jsonl-'));
  const file = path.join(dir, 'data.jsonl');
  fs.writeFileSync(file, contents);
  return file;
}

test('reads every record in order', async () => {
  const file = tmpFile('{"a":1}\n{"a":2}\n{"a":3}\n');
  assert.deepEqual(await readAll(file), [{ a: 1 }, { a: 2 }, { a: 3 }]);
});

test('offsets are exact byte positions and end at file size', async () => {
  const file = tmpFile('{"a":1}\n{"a":2}\n');
  const seen = [];
  for await (const r of readRecords(file)) seen.push([r.offset, r.endOffset]);
  assert.deepEqual(seen, [[0, 8], [8, 16]]);
  assert.equal(seen.at(-1)[1], fs.statSync(file).size);
});

test('offsets stay correct with multi-byte UTF-8', async () => {
  const file = tmpFile('{"s":"éàü"}\n{"s":"ok"}\n');
  const first = Buffer.byteLength('{"s":"éàü"}\n');
  const seen = [];
  for await (const r of readRecords(file)) seen.push(r.offset);
  assert.deepEqual(seen, [0, first]);
});

test('resumes from a byte offset without replaying earlier records', async () => {
  const file = tmpFile('{"a":1}\n{"a":2}\n');
  assert.deepEqual(await readAll(file, { start: 8 }), [{ a: 2 }]);
  assert.deepEqual(await readAll(file, { start: 16 }), []);
});

test('skips blank lines', async () => {
  const file = tmpFile('{"a":1}\n\n   \n{"a":2}\n');
  assert.deepEqual(await readAll(file), [{ a: 1 }, { a: 2 }]);
});

test('strips a UTF-8 BOM on the first record', async () => {
  const file = tmpFile('\ufeff{"a":1}\n');
  assert.deepEqual(await readAll(file), [{ a: 1 }]);
});

test('reports malformed lines instead of throwing', async () => {
  const file = tmpFile('{"a":1}\nnot json\n{"a":2}\n');
  const errors = [];
  const out = [];
  for await (const r of readRecords(file, { onError: (e) => errors.push(e) })) out.push(r.value);
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].raw, 'not json');
});

test('yields a trailing unterminated line without advancing past it', async () => {
  // A session still being appended to ends mid-line; the next run must re-read it.
  const file = tmpFile('{"a":1}\n{"a":2}');
  const seen = [];
  for await (const r of readRecords(file)) seen.push(r);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].endOffset, 8, 'offset must not advance past an incomplete line');
});

// Un lecteur qui reprend aux octets ne doit pas la lire du tout : il la stockerait
// maintenant, puis la relirait finie à la passe suivante (voir indexer.test.js).
test('leaves an unfinished trailing line to the next run when asked', async () => {
  const file = tmpFile('{"a":1}\n{"a":2}');
  const seen = [];
  for await (const r of readRecords(file, { unfinished: false })) seen.push(r.value);
  assert.deepEqual(seen, [{ a: 1 }]);
});

test('works across chunk boundaries', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(50) }));
  const file = tmpFile(rows.join('\n') + '\n');
  const out = await readAll(file, { chunkSize: 64 });
  assert.equal(out.length, 500);
  assert.equal(out[499].i, 499);
});
