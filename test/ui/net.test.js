'use strict';

/**
 * La seule fonction d'Ariane qui parle au réseau, sous Electron
 * (`npm run test:net`).
 *
 * Elle ne peut pas être vérifiée depuis la suite unitaire : `net.request`
 * n'existe que dans le processus principal d'Electron. On l'y utilise plutôt
 * que le `http` de Node parce qu'elle emprunte la pile réseau de Chromium —
 * donc les réglages de mandataire et les certificats du système, ce qui compte
 * derrière le pare-feu d'une entreprise.
 *
 * Tout le reste de la vérification de version est testé sans réseau : la
 * requête y est injectée. Ce fichier couvre ce que cette couture laisse de
 * côté, et c'est précisément la partie qui sort de la machine — l'expiration,
 * l'avortement, la lecture de l'en-tête, et les chemins d'erreur.
 *
 * **Aucun test ici n'atteint Internet.** Un serveur HTTP est monté sur la
 * boucle locale, répond ce qu'on lui dit de répondre, et meurt à la fin.
 */

const http = require('http');
const { app } = require('electron');

const { electronRequest } = require('../../src/main/update-check');

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });

/**
 * Un serveur qui répond ce que le scénario demande, et qui note comment on
 * l'a interrogé.
 *
 * @param {(req: http.IncomingMessage, res: http.ServerResponse) => void} answer
 */
function serverThat(answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url });
    answer(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: (path = '/') => `http://127.0.0.1:${port}${path}`,
        seen,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function run() {
  // ── une redirection, ce que GitHub répond vraiment ──────────────────────
  const TAG = 'https://github.com/ZamBoyle/Ariane/releases/tag/v9.9.9';
  const redirecting = await serverThat((_req, res) => {
    res.writeHead(302, { Location: TAG });
    res.end();
  });
  const found = await electronRequest(redirecting.url('/releases/latest'));
  check(
    'une redirection rend son statut et son en-tête Location',
    found.status === 302 && found.location === TAG,
    JSON.stringify(found)
  );
  check(
    'et elle est demandée en HEAD, jamais en GET',
    redirecting.seen.length === 1 && redirecting.seen[0].method === 'HEAD',
    JSON.stringify(redirecting.seen)
  );
  await redirecting.close();

  // ── une réponse sans Location : un dépôt sans aucune version ────────────
  const plain = await serverThat((_req, res) => {
    res.writeHead(200);
    res.end();
  });
  const bare = await electronRequest(plain.url('/'));
  check(
    'une réponse sans Location rend null, et non une chaîne vide',
    bare.status === 200 && bare.location === null,
    JSON.stringify(bare)
  );
  await plain.close();

  // ── un serveur qui ne répond jamais ─────────────────────────────────────
  const mute = await serverThat(() => {
    /* on garde la connexion ouverte et on ne répond pas */
  });
  const started = Date.now();
  const timedOut = await electronRequest(mute.url('/'), 400);
  const waited = Date.now() - started;
  check(
    "un serveur muet expire, et rend un refus plutôt qu'une exception",
    timedOut.status === 0 && timedOut.location === null,
    JSON.stringify(timedOut)
  );
  check(
    "et il n'attend pas plus que le délai qu'on lui a donné",
    waited < 2000,
    `${waited} ms pour un délai de 400`
  );
  await mute.close();

  // ── rien à l'écoute ─────────────────────────────────────────────────────
  const closed = await serverThat(() => {});
  const gone = closed.url('/');
  await closed.close();
  const refused = await electronRequest(gone, 2000);
  check(
    'une connexion refusée rend un refus, jamais une exception',
    refused.status === 0 && refused.location === null,
    JSON.stringify(refused)
  );

  // ── une adresse qui n'en est pas une ────────────────────────────────────
  const nonsense = await electronRequest('pas://une/adresse', 2000);
  check(
    "une adresse illisible ne fait pas tomber l'application",
    nonsense.status === 0 && nonsense.location === null,
    JSON.stringify(nonsense)
  );

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  console.log(
    `\n# net checks ${results.length} | pass ${results.length - failed.length} | fail ${failed.length}`
  );
  return failed.length === 0 ? 0 : 1;
}

app
  .whenReady()
  .then(run)
  .then((code) => app.exit(code))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
