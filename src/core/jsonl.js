'use strict';

/**
 * Streaming JSONL reader with byte-offset tracking.
 *
 * Transcripts are append-only and can reach tens of megabytes (the largest one
 * observed was 64 MB for a single session), so they are never read whole. Each
 * record is yielded with the byte offset just past its newline, which lets the
 * indexer resume from where it stopped instead of re-parsing the file.
 *
 * Malformed lines are reported rather than thrown: a truncated last line is
 * normal for a session that is still being written to.
 */

const fs = require('fs');

const DEFAULT_CHUNK = 1 << 20; // 1 MiB

/**
 * @param {string} filePath
 * @param {object} [options]
 * @param {number} [options.start=0]     Byte offset to resume from.
 * @param {number} [options.chunkSize]
 * @param {(err: {offset: number, error: Error, raw: string}) => void} [options.onError]
 * @yields {{value: unknown, offset: number, endOffset: number}}
 */
async function* readRecords(filePath, options = {}) {
  const { start = 0, chunkSize = DEFAULT_CHUNK, onError } = options;

  const stream = fs.createReadStream(filePath, { start, highWaterMark: chunkSize });

  let pending = Buffer.alloc(0);
  let cursor = start;

  for await (const chunk of stream) {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

    let newline;
    while ((newline = pending.indexOf(0x0a)) !== -1) {
      const rawBuf = pending.subarray(0, newline);
      const lineStart = cursor;
      const lineBytes = newline + 1;
      cursor += lineBytes;
      pending = pending.subarray(newline + 1);

      const record = parseLine(rawBuf, lineStart, onError);
      if (record !== undefined) {
        yield { value: record, offset: lineStart, endOffset: cursor };
      }
    }
  }

  // A trailing line with no newline means the writer is mid-append. Parse it,
  // but do NOT advance past it: the next run must re-read it once complete.
  if (pending.length > 0) {
    const record = parseLine(pending, cursor, onError);
    if (record !== undefined) {
      yield { value: record, offset: cursor, endOffset: cursor };
    }
  }
}

function parseLine(buf, offset, onError) {
  // Skip blank lines and any UTF-8 BOM on the first record.
  let view = buf;
  if (offset === 0 && view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    view = view.subarray(3);
  }
  if (view.length === 0) return undefined;

  const raw = view.toString('utf8');
  if (raw.trim() === '') return undefined;

  try {
    return JSON.parse(raw);
  } catch (error) {
    if (onError) onError({ offset, error, raw: raw.slice(0, 200) });
    return undefined;
  }
}

/** Collect every record, for tests and small files such as history.jsonl. */
async function readAll(filePath, options) {
  const out = [];
  for await (const record of readRecords(filePath, options)) out.push(record.value);
  return out;
}

module.exports = { readRecords, readAll, DEFAULT_CHUNK };
