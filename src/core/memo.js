'use strict';

/**
 * Work an adapter did on a file, kept from one indexing pass to the next.
 *
 * Discovery has to say what every session is before the indexer can decide
 * whether it changed. For Codex and VS Code that meant re-reading a header,
 * re-parsing a whole snapshot — up to 96 MB — or reopening a SQLite store, for
 * every file, on every pass. Measured with nothing changed: 370 ms, nearly all
 * of it spent re-deriving answers from files that had not moved.
 *
 * An entry is trusted only while its stamp — the file's size and mtime — is
 * the one it was computed from. That is the very test the indexer applies
 * before re-reading a file, so a memo can make a pass faster but never make
 * it different.
 */
class Memo {
  constructor() {
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @template T
   * @param {string} key    One file and one kind of work, e.g. `codex:header:<path>`.
   * @param {string} stamp  What the answer depends on; see `stampOf`.
   * @param {() => T | Promise<T>} compute  Must not throw for a bad file; a
   *   throw is not remembered, so the next pass tries again.
   * @returns {Promise<T>} The value. Shared between passes: never mutate it.
   */
  async get(key, stamp, compute) {
    const entry = this.entries.get(key);
    if (entry && entry.stamp === stamp) {
      this.hits += 1;
      return entry.value;
    }
    this.misses += 1;
    const value = await compute();
    this.entries.set(key, { stamp, value });
    return value;
  }
}

/**
 * Use the memo the indexer passed down, or none: adapters called directly, as
 * most tests do, simply recompute every time.
 */
function remember(ctx, key, stamp, compute) {
  const memo = ctx && ctx.memo;
  return memo ? memo.get(key, stamp, compute) : Promise.resolve().then(compute);
}

/** The stamp a file's derived facts depend on: the indexer's own change test. */
const stampOf = (stat) => `${stat.size}:${Math.floor(stat.mtimeMs)}`;

module.exports = { Memo, remember, stampOf };
