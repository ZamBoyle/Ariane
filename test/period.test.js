'use strict';

/**
 * Searching by date: where a period starts, and which messages fall inside it.
 *
 * Pinned to a real time zone with daylight saving, because that is where
 * counting days goes wrong: subtract 24-hour steps across the March change and
 * "the last 7 days" starts at 11 p.m. the day before.
 */
process.env.TZ = 'Europe/Brussels';

const test = require('node:test');
const assert = require('node:assert/strict');

const { periodStart, PERIODS } = require('../src/core/period');
const { Index } = require('../src/core/db');
const { Indexer } = require('../src/core/indexer');
const { createFixture, records, resetCounters } = require('./helpers/fixture');

test.describe('where a period starts', () => {
  // 19 September 2026, 9:30 in Brussels (summer time, UTC+2).
  const now = new Date(2026, 8, 19, 9, 30);

  test('all dates: no bound', () => {
    assert.equal(periodStart('all', now), null);
  });

  test('the last 7 days are today and the six before it, from midnight', () => {
    assert.equal(periodStart('7d', now), '2026-09-12T22:00:00.000Z'); // 13 Sept, 00:00
  });

  test('the last 30 days, the same way', () => {
    assert.equal(periodStart('30d', now), '2026-08-20T22:00:00.000Z'); // 21 Aug, 00:00
  });

  test('this year starts on the 1st of January, local time', () => {
    assert.equal(periodStart('year', now), '2025-12-31T23:00:00.000Z'); // winter time, UTC+1
  });

  test('across the change to summer time, still local midnight', () => {
    // Summer time began on 29 March 2026; a week back from the 31st is 25 March, in winter time.
    assert.equal(periodStart('7d', new Date(2026, 2, 31, 10, 0)), '2026-03-24T23:00:00.000Z');
  });

  test('in the shape every adapter stores, so it compares as text', () => {
    for (const period of Object.keys(PERIODS)) {
      const start = periodStart(period, now);
      if (start !== null) assert.match(start, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    }
  });

  test('an unknown period is refused, never read as "all dates"', () => {
    for (const bad of ['', 'forever', '7D', '__proto__', 'toString', 'constructor', {}, ['7d'], 7, null, undefined]) {
      assert.throws(() => periodStart(bad, now), TypeError, JSON.stringify(bad));
    }
  });
});

test.describe('searching within a period', () => {
  function setup(t) {
    resetCounters();
    const fx = createFixture();
    const index = new Index(':memory:');
    t.after(() => {
      index.close();
      fx.cleanup();
    });
    const run = () => new Indexer(index, { env: fx.env }).run();
    return { fx, index, run };
  }

  test('keeps the messages written since the start, whatever their session', async (t) => {
    const { fx, index, run } = setup(t);
    fx.project('-p', { originalPath: '/p' })
      .session('s1', [records.userText('les sprites de janvier', { timestamp: '2026-01-05T10:00:00.000Z' })])
      .session('s2', [records.userText('les sprites de septembre', { timestamp: '2026-09-18T10:00:00.000Z' })]);
    await run();

    assert.equal(index.search('sprites').length, 2);
    const recent = index.search('sprites', { since: '2026-09-01T00:00:00.000Z' });
    assert.deepEqual(
      recent.map((h) => h.sessionId),
      ['claude:s2']
    );
    assert.equal(index.search('sprites', { since: '2026-09-18T10:00:00.000Z' }).length, 1, 'the start is inside');
  });

  // Claude Code's last-prompt pointer has no time. Measured: 83 of the person's
  // prompts exist only there. A dated search must not lose them.
  test('a prompt written without a time takes the time of the message before it', async (t) => {
    const { fx, index, run } = setup(t);
    fx.project('-p', { originalPath: '/p' }).session('s1', [
      records.userText('une question', { timestamp: '2026-09-18T08:00:00.000Z' }),
      records.assistantText('une réponse', { timestamp: '2026-09-18T08:01:00.000Z' }),
      { type: 'last-prompt', lastPrompt: 'et la girafe orpheline ?', leafUuid: 'x' },
    ]);
    await run();

    const [hit] = index.search('girafe', { since: '2026-09-18T00:00:00.000Z' });
    assert.ok(hit, 'found within the period its neighbours are in');
    assert.equal(hit.ts, '2026-09-18T08:01:00.000Z', 'and shown at that time, never blank');
    assert.equal(index.search('girafe', { since: '2026-09-19T00:00:00.000Z' }).length, 0, 'not moved to "now"');
  });
});
