'use strict';

/**
 * Demander s'il existe une version plus récente — et ne rien demander du tout
 * quand la personne ne l'a pas voulu.
 *
 * Aucun test n'atteint GitHub : la requête est derrière une couture, et
 * plusieurs de ces tests vérifient précisément qu'elle n'est jamais appelée.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkForUpdate, repositoryUrl } = require('../src/main/update-check');

const PKG = { repository: { type: 'git', url: 'git+https://github.com/ZamBoyle/Ariane.git' } };
const TAG = (v) => `https://github.com/ZamBoyle/Ariane/releases/tag/${v}`;

/** Un faux réseau qui compte ce qu'on lui demande. */
function fakeNet(answer) {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    return typeof answer === 'function' ? answer(url) : answer;
  };
  return { request, calls };
}

const startup = { updateCheck: () => 'startup' };
const never = { updateCheck: () => 'never' };

// ── le réglage décide, et il décide AVANT la requête ───────────────────────

test('éteint, rien n’est demandé à personne', async () => {
  const net = fakeNet({ status: 302, location: TAG('v9.9.9') });
  const answer = await checkForUpdate({
    settings: never,
    version: '0.2.0',
    request: net.request,
    pkg: PKG,
  });

  assert.deepEqual(answer, { ok: false, error: 'update-check-off' });
  assert.equal(
    net.calls.length,
    0,
    'un réglage qui masquerait le résultat aurait déjà prévenu GitHub'
  );
});

test('sans réglage du tout, rien n’est demandé non plus', async () => {
  const net = fakeNet({ status: 302, location: TAG('v9.9.9') });
  const answer = await checkForUpdate({ version: '0.2.0', request: net.request, pkg: PKG });

  assert.equal(answer.error, 'update-check-off', 'le silence vaut refus');
  assert.equal(net.calls.length, 0);
});

test('« Vérifier maintenant » demande, même éteint : c’est la personne qui demande', async () => {
  const net = fakeNet({ status: 302, location: TAG('v9.9.9') });
  const answer = await checkForUpdate({
    settings: never,
    version: '0.2.0',
    request: net.request,
    pkg: PKG,
    asked: true,
  });
  assert.equal(net.calls.length, 1, 'une seule fois, et parce qu’on a cliqué');
  assert.deepEqual(answer.data, { update: true, version: '9.9.9', url: TAG('v9.9.9') });
});

// ── ce qu'on demande, et où ────────────────────────────────────────────────

test('la redirection est interrogée, jamais l’API', async () => {
  const net = fakeNet({ status: 302, location: TAG('v0.3.0') });
  await checkForUpdate({ settings: startup, version: '0.2.0', request: net.request, pkg: PKG });

  assert.deepEqual(net.calls, ['https://github.com/ZamBoyle/Ariane/releases/latest']);
  assert.ok(
    !net.calls[0].includes('api.github.com'),
    'l’API a un quota, la redirection n’en a pas'
  );
});

test('le dépôt se lit dans le manifeste, sous ses trois écritures', () => {
  const attendu = 'https://github.com/ZamBoyle/Ariane';
  assert.equal(repositoryUrl(PKG), attendu, 'un « git+… .git » est nettoyé');
  assert.equal(repositoryUrl({ repository: 'https://github.com/ZamBoyle/Ariane/' }), attendu);
  assert.equal(repositoryUrl({ homepage: attendu }), attendu);
});

test('un manifeste sans dépôt ne demande rien, et ne se plaint pas', async () => {
  const net = fakeNet({ status: 302, location: TAG('v0.3.0') });
  const answer = await checkForUpdate({
    settings: startup,
    version: '0.2.0',
    request: net.request,
    pkg: {},
  });

  assert.equal(
    answer.error,
    'no-repository',
    'un fork qui ne l’a pas rempli ne demande simplement jamais'
  );
  assert.equal(net.calls.length, 0);
});

test('une adresse qui n’est pas GitHub n’est pas interrogée', async () => {
  assert.equal(repositoryUrl({ homepage: 'https://exemple.test/ariane' }), null);
  assert.equal(
    repositoryUrl({ homepage: 'https://github.com/ZamBoyle' }),
    null,
    'il faut un dépôt, pas un compte'
  );
});

// ── ce qu'on en conclut ────────────────────────────────────────────────────

test('une version plus récente est annoncée avec son lien', async () => {
  const net = fakeNet({ status: 302, location: TAG('v0.3.0') });
  const answer = await checkForUpdate({
    settings: startup,
    version: '0.2.0',
    request: net.request,
    pkg: PKG,
  });

  assert.equal(answer.ok, true);
  assert.deepEqual(answer.data, { update: true, version: '0.3.0', url: TAG('v0.3.0') });
});

test('à jour, on le dit sans proposer quoi que ce soit', async () => {
  const net = fakeNet({ status: 302, location: TAG('v0.2.0') });
  const answer = await checkForUpdate({
    settings: startup,
    version: '0.2.0',
    request: net.request,
    pkg: PKG,
  });

  assert.deepEqual(answer, { ok: true, data: { update: false, reason: 'up-to-date' } });
});

test('une pré-version n’est pas poussée sur qui a demandé des versions', async () => {
  const net = fakeNet({ status: 302, location: TAG('v0.3.0-rc.1') });
  const answer = await checkForUpdate({
    settings: startup,
    version: '0.2.0',
    request: net.request,
    pkg: PKG,
  });

  assert.equal(answer.data.update, false);
  assert.equal(answer.data.reason, 'latest-prerelease');
});

// ── quand ça se passe mal ──────────────────────────────────────────────────

test('un réseau muet rend un code, pas une exception', async () => {
  const net = fakeNet({ status: 0, location: null });
  const answer = await checkForUpdate({
    settings: startup,
    version: '0.2.0',
    request: net.request,
    pkg: PKG,
  });

  assert.deepEqual(answer, { ok: false, error: 'unreachable' });
});

test('un dépôt sans aucune version ne devient pas une erreur obscure', async () => {
  // GitHub renvoie alors vers la page des releases, pas vers une étiquette.
  const net = fakeNet({ status: 302, location: 'https://github.com/ZamBoyle/Ariane/releases' });
  const answer = await checkForUpdate({
    settings: startup,
    version: '0.2.0',
    request: net.request,
    pkg: PKG,
  });

  assert.deepEqual(answer, { ok: false, error: 'no-release' });
});

test('tout ce qui sort d’ici est un code, jamais une phrase', async () => {
  const net = fakeNet({ status: 0, location: null });
  const cas = [
    await checkForUpdate({ settings: never, version: '0.2.0', request: net.request, pkg: PKG }),
    await checkForUpdate({ settings: startup, version: '0.2.0', request: net.request, pkg: {} }),
    await checkForUpdate({ settings: startup, version: '0.2.0', request: net.request, pkg: PKG }),
  ];
  for (const { error } of cas) {
    assert.match(error, /^[a-z-]+$/, `« ${error} » doit être traduisible par le renderer`);
  }
});
