'use strict';

/**
 * Décider s'il existe une version plus récente, sans réseau ni horloge.
 *
 * La règle qui tient tout : ne rien dire est toujours sûr, annoncer une mise à
 * jour qui n'en est pas une ne l'est pas. Tout ce qui n'est pas comparable rend
 * donc un refus, jamais une supposition.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse, compare, decide } = require('../src/core/update');

// ── lire une version ──────────────────────────────────────────────────────

test('une étiquette et une version sont la même chose', () => {
  assert.deepEqual(parse('v0.2.0'), parse('0.2.0'), 'le « v » d’une étiquette ne change rien');
  assert.deepEqual(parse(' 0.2.0 ').parts, [0, 2, 0], 'les espaces non plus');
});

test('ce qui n’est pas une version ne se devine pas', () => {
  for (const bad of ['', 'latest', '0.2', 'v0.2.0.1', 'main', null, undefined, 42, {}]) {
    assert.equal(parse(bad), null, `« ${String(bad)} » ne doit pas être lu comme une version`);
  }
});

// ── comparer ──────────────────────────────────────────────────────────────

test('les nombres se comparent comme des nombres, pas comme du texte', () => {
  assert.equal(compare('0.10.0', '0.9.0'), 1, '0.10.0 est PLUS RÉCENT que 0.9.0');
  assert.equal(compare('0.9.0', '0.10.0'), -1);
  assert.equal(compare('1.0.0', '0.99.99'), 1);
  assert.equal(compare('0.2.0', '0.2.0'), 0);
});

test('une pré-version est plus ancienne que la version qu’elle annonce', () => {
  assert.equal(compare('0.3.0-rc.1', '0.3.0'), -1);
  assert.equal(compare('0.3.0', '0.3.0-rc.1'), 1);
});

test('une version illisible ne se compare pas, elle rend null', () => {
  assert.equal(compare('0.2.0', 'main'), null);
  assert.equal(compare(undefined, '0.2.0'), null);
});

// ── décider ───────────────────────────────────────────────────────────────

test('une version plus récente est annoncée, sans son « v »', () => {
  const answer = decide({ current: '0.2.0', latest: 'v0.3.0' });
  assert.equal(answer.update, true);
  assert.equal(answer.version, '0.3.0', 'la version est rendue telle qu’on l’affiche');
});

test('la même version ne s’annonce pas', () => {
  assert.deepEqual(decide({ current: '0.2.0', latest: 'v0.2.0' }), {
    update: false,
    reason: 'up-to-date',
  });
});

test('une version plus ancienne que la sienne n’est pas un défaut', () => {
  // Le cas de qui construit depuis les sources entre deux versions.
  assert.deepEqual(decide({ current: '0.3.0', latest: 'v0.2.0' }), {
    update: false,
    reason: 'up-to-date',
  });
});

test('une pré-version n’est jamais proposée', () => {
  assert.deepEqual(decide({ current: '0.2.0', latest: 'v0.3.0-rc.1' }), {
    update: false,
    reason: 'latest-prerelease',
  });
});

test('ce qu’on ne sait pas lire ne devient jamais une proposition', () => {
  assert.equal(decide({ current: '0.2.0', latest: 'main' }).reason, 'latest-unreadable');
  assert.equal(decide({ current: 'inconnue', latest: 'v0.3.0' }).reason, 'current-unreadable');
  assert.equal(decide({}).update, false, 'sans rien, on ne propose rien');
  assert.equal(decide().update, false, 'sans argument non plus');
});

test('la décision rend un code, jamais une phrase', () => {
  const refus = decide({ current: '0.2.0', latest: 'v0.2.0' });
  assert.match(refus.reason, /^[a-z-]+$/, 'un code se traduit, une phrase ne se traduit pas');
});
