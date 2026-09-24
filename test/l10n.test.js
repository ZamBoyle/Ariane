'use strict';

/**
 * Localisation: the engine, and the language files themselves.
 *
 * A language file is written by someone who may never run the tests, so the
 * tests read every file in src/locales and hold each one to the English
 * reference: the same messages, the same attributes, no variable the code
 * does not pass. A translation that drifts fails here, not on someone's screen.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { localizer, loadEngine, LOCALES } = require('./helpers/l10n');

const files = fs.readdirSync(LOCALES).filter((f) => f.endsWith('.ftl'));
const codes = files.map((f) => f.slice(0, -4));

let E;
let Fluent;
test.before(async () => {
  E = await loadEngine();
  Fluent = await import('../node_modules/@fluent/bundle/esm/index.js');
});

/** Every message of a file: its value's and each attribute's variables. */
function shapeOf(code) {
  const resource = new Fluent.FluentResource(fs.readFileSync(path.join(LOCALES, `${code}.ftl`), 'utf8'));
  const shape = new Map();
  for (const entry of resource.body) {
    if (entry.id.startsWith('-')) continue; // a term: private to its file
    shape.set(entry.id, {
      value: entry.value === null ? null : variablesIn(entry.value),
      attributes: Object.fromEntries(Object.entries(entry.attributes).map(([k, v]) => [k, variablesIn(v)])),
    });
  }
  return shape;
}

function variablesIn(pattern, found = new Set()) {
  if (typeof pattern === 'string') return found;
  for (const element of pattern) {
    if (typeof element === 'string') continue;
    walk(element, found);
  }
  return found;
}

function walk(expression, found) {
  if (expression.type === 'var') found.add(expression.name);
  if (expression.type === 'select') {
    walk(expression.selector, found);
    for (const variant of expression.variants) variablesIn(variant.value, found);
  }
  for (const arg of expression.args || []) walk(arg.type === 'narg' ? arg.value : arg, found);
}

test.describe('every language file', () => {
  test('is named by a language tag', () => {
    assert.ok(codes.includes('en'), 'English is the reference and the fallback');
    for (const code of codes) assert.match(code, /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/, code);
  });

  test('parses without a single error', () => {
    for (const code of codes) {
      const bundle = new Fluent.FluentBundle(code);
      const errors = bundle.addResource(
        new Fluent.FluentResource(fs.readFileSync(path.join(LOCALES, `${code}.ftl`), 'utf8'))
      );
      assert.deepEqual(errors.map(String), [], code);
    }
  });

  test('has exactly the English messages, with the same attributes', () => {
    const reference = shapeOf('en');
    for (const code of codes) {
      const shape = shapeOf(code);
      const missing = [...reference.keys()].filter((id) => !shape.has(id));
      const extra = [...shape.keys()].filter((id) => !reference.has(id));
      assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, code);
      for (const [id, { value, attributes }] of reference) {
        const theirs = shape.get(id);
        assert.equal(theirs.value === null, value === null, `${code}: ${id} has a value in one file only`);
        assert.deepEqual(Object.keys(theirs.attributes).sort(), Object.keys(attributes).sort(), `${code}: ${id}`);
      }
    }
  });

  // A misspelt variable ({ $comand }) formats as nothing, silently.
  test('uses only the variables the code passes', () => {
    const reference = shapeOf('en');
    for (const code of codes) {
      for (const [id, theirs] of shapeOf(code)) {
        const ours = reference.get(id);
        const check = (mine, allowed, where) => {
          for (const name of mine) assert.ok(allowed.has(name), `${code}: ${where} uses $${name}, which nothing passes`);
        };
        if (theirs.value) check(theirs.value, ours.value, id);
        for (const [attr, vars] of Object.entries(theirs.attributes)) check(vars, ours.attributes[attr], `${id}.${attr}`);
      }
    }
  });

  test('names its language in that language', async () => {
    for (const code of codes) {
      const l10n = await localizer(code);
      const name = l10n.t('language-name');
      assert.ok(name && name !== 'language-name', code);
      if (code !== 'en') assert.notEqual(name, 'English', `${code} still calls itself English`);
    }
  });
});

test.describe('choosing the language', () => {
  test('whole tag first, then the language alone, then English', () => {
    const available = ['en', 'fr', 'pt-BR', 'zh-CN'];
    assert.equal(E.negotiateLanguage(['pt-BR'], available), 'pt-BR');
    assert.equal(E.negotiateLanguage(['fr-BE', 'en-US'], available), 'fr');
    assert.equal(E.negotiateLanguage(['pt-PT'], available), 'pt-BR', 'Portuguese rather than English');
    assert.equal(E.negotiateLanguage(['zh'], available), 'zh-CN');
    assert.equal(E.negotiateLanguage(['de-DE', 'fr-FR'], available), 'fr', 'the second wish, before the fallback');
    assert.equal(E.negotiateLanguage(['tlh'], available), 'en');
    assert.equal(E.negotiateLanguage([], available), 'en');
    assert.equal(E.negotiateLanguage([null, 42, ''], available), 'en', 'garbage is skipped');
  });

  test('knows which way each language is written', () => {
    assert.equal(E.directionOf('fr'), 'ltr');
    assert.equal(E.directionOf('ar'), 'rtl');
    assert.equal(E.directionOf('he'), 'rtl');
    assert.equal(E.directionOf('not a tag!'), 'ltr');
  });
});

test.describe('the words, in French and in English', () => {
  test('plurals are the language file’s, numbers are Intl’s', async () => {
    const fr = await localizer('fr');
    const en = await localizer('en');
    assert.equal(fr.t('stats', { folders: 1, sessions: 3, messages: 38814 }), '1\u00a0dossier · 3\u00a0conversations · 38\u202f814\u00a0messages');
    assert.equal(en.t('stats', { folders: 1, sessions: 3, messages: 38814 }), '1 folder · 3 conversations · 38,814 messages');
    // French counts zero as singular; the file says so, not the code.
    assert.equal(fr.t('settings-sessions', { n: 0 }), 'aucune conversation');
    assert.equal(en.t('results-count', { n: 1 }), '1 result');
  });

  test('dates, relative times, sizes and lists come from Intl', async () => {
    const fr = await localizer('fr');
    const en = await localizer('en');
    const now = Date.parse('2026-09-17T12:00:00Z');
    assert.equal(fr.ago('2026-09-15T12:00:00Z', now), 'il y a 2 jours');
    assert.equal(en.ago('2026-09-15T12:00:00Z', now), '2 days ago');
    assert.equal(fr.ago('2026-09-17T11:59:30Z', now), 'il y a 30 secondes');
    assert.equal(en.ago('2025-01-02T12:00:00Z', now), 'Jan 2, 2025', 'a month on, the date itself');
    assert.equal(fr.ago('pas une date'), '');
    assert.equal(fr.dateTime(null), '');
    assert.equal(en.bytes(512), '512 byte');
    assert.match(fr.bytes(3 * 1024 * 1024), /^3\sMo$/, 'the unit as French writes it, non-breaking space included');
    assert.equal(en.list(['a', 'b', 'c']), 'a, b, and c');
    assert.equal(fr.list(['a', 'b', 'c']), 'a, b et c');
  });

  test('token counts are shortened with K, M and G, in the language’s own decimals', async () => {
    const fr = await localizer('fr');
    const en = await localizer('en');
    assert.equal(en.compact(646), '646');
    assert.equal(en.compact(4386), '4.4K');
    assert.equal(fr.compact(4386), '4,4K', 'la virgule décimale du français');
    assert.equal(en.compact(190255), '190K', 'no decimal from 100 on');
    assert.equal(fr.compact(14510696), '14,5M');
    assert.equal(en.compact(2278555911), '2.3G', 'a count in the billions');
    assert.equal(en.compact(0), '0', 'a measured zero is shown');
    assert.equal(en.compact(null), '', 'an absence is not a zero');
    assert.equal(en.compact('12'), '', 'only a number is a count');
  });

  test('a share and a month, as each language writes them', async () => {
    const fr = await localizer('fr');
    const en = await localizer('en');
    assert.equal(fr.percent(0.0564), '6\u00a0%', 'le français met une espace insécable avant %');
    assert.equal(en.percent(0.47), '47%');
    assert.equal(en.percent(0.001), '<1%', 'a sliver is not rounded down to nothing');
    assert.equal(en.percent(null), '', 'an absence is not zero percent');
    assert.equal(fr.month('2026-09'), 'sept. 26');
    assert.equal(fr.month('2026-09', { long: true }), 'septembre 2026');
    assert.equal(en.month('2026-01', { long: true }), 'January 2026', 'the 15th: no time zone moves it');
    assert.equal(en.month('not a month'), '');
  });

  test('a value that rounds up takes the next prefix', async () => {
    const en = await localizer('en');
    assert.equal(en.compact(999.6), '1K', 'never "1000"');
    assert.equal(en.compact(9990), '10K');
    assert.equal(en.compact(99949), '99.9K');
    assert.equal(en.compact(99950), '100K');
    assert.equal(en.compact(999950), '1M', 'never "1000K"');
    assert.equal(en.compact(999960000), '1G', 'never "1000M"');
  });

  test('a message missing from a language comes from English, one by one', async () => {
    const { createLocalizer } = E;
    const en = fs.readFileSync(path.join(LOCALES, 'en.ftl'), 'utf8');
    const l10n = createLocalizer({
      language: 'fr',
      sources: [{ language: 'fr', source: 'settings-title = Réglages\n' }, { language: 'en', source: en }],
    });
    assert.equal(l10n.t('settings-title'), 'Réglages');
    assert.equal(l10n.t('settings-save'), 'Save');
  });

  test('an unknown message shows its id, and is reported', async () => {
    const problems = [];
    const l10n = await localizer('fr', { onProblem: (p) => problems.push(p) });
    assert.equal(l10n.t('no-such-message'), 'no-such-message');
    assert.ok(problems.some((p) => p.includes('no-such-message')));
  });

  // What the render suite uses to find a sentence that bypassed the files.
  test('the pseudo-language marks every sentence that went through it', async () => {
    const l10n = await localizer('en', { pseudo: true });
    assert.equal(l10n.t('settings-title'), '⟦Settings⟧');
    assert.equal(l10n.message('settings-button').attributes['aria-label'], '⟦Open the settings⟧');
  });

  test('a left-to-right language gets no invisible isolation marks', async () => {
    const l10n = await localizer('fr');
    assert.equal(l10n.t('export-done', { path: '/tmp/x.md' }), 'Exportée : /tmp/x.md');
  });
});

// What the pseudo-language cannot see: a date written in digits by the code
// itself has no word to leave bare. So nothing but l10n.js formats one.
test('only the localiser formats dates and numbers', () => {
  const offenders = [];
  const pattern = /toLocale(Date|Time)?String\(|Intl\.(DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat)/;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js') && entry.name !== 'l10n.js') {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (pattern.test(line)) offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
        });
      }
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  assert.deepEqual(offenders, []);
});

// The main process cannot require an ES module, so locale.js keeps its own copy
// of the language-tag pattern. Two copies drift; this one cannot.
test('the main process and the engine agree on what a language tag is', () => {
  const { LANGUAGE_TAG } = E;
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'locale.js'), 'utf8');
  const copy = /^const TAG = (\/.*\/);$/m.exec(source);
  assert.ok(copy, 'locale.js must state its pattern on one line, so this test can read it');
  assert.equal(copy[1], String(LANGUAGE_TAG), 'locale.js and l10n.js disagree about language tags');
});
