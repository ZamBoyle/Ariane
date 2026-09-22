'use strict';

/**
 * Asking whether a newer Ariane exists — and nothing more.
 *
 * Nothing is downloaded, nothing is executed, no installer is run. The answer
 * is a version number and a link; what the person does with it is theirs. That
 * is deliberate and not a first step: none of Ariane's packages are signed, so
 * an application that fetched and ran a binary on its own would be asking to be
 * trusted for something it cannot prove.
 *
 * ── Why not the API ───────────────────────────────────────────────────────
 *
 * `https://github.com/<owner>/<repo>/releases/latest` answers a 302 whose
 * `Location` ends in the tag. No JSON, no token, and none of the API's sixty
 * requests an hour per address — the whole exchange is a few hundred bytes of
 * headers. `latest` also skips drafts and pre-releases, which is what we want.
 *
 * ── Where this runs ───────────────────────────────────────────────────────
 *
 * In the main process, never in the window: `connect-src 'none'` stays true,
 * and the renderer keeps reaching the world through `window.api` alone.
 *
 * The request is made once per launch, when the setting says `startup`. There
 * is no timer and no stored "last checked" stamp, because there is nothing to
 * remember: launching the app IS the occasion.
 */

const { decide } = require('../core/update');

/** How long to wait before deciding the network is not going to answer. */
const TIMEOUT_MS = 5000;

/** `.../releases/tag/v0.2.0` — the tag is the last segment. */
const TAG_IN_LOCATION = /\/releases\/tag\/([^/?#]+)$/;

/**
 * The project's page, taken from package.json rather than written twice.
 *
 * @param {object} [pkg]
 * @returns {string|null} Null when the manifest names no repository, which is
 *   not a fault: a fork that never filled it in simply never asks.
 */
function repositoryUrl(pkg) {
  const manifest = pkg || require('../../package.json');
  const raw =
    (manifest.repository && (manifest.repository.url || manifest.repository)) || manifest.homepage;
  if (typeof raw !== 'string' || !raw) return null;
  const cleaned = raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(cleaned) ? cleaned : null;
}

/**
 * The real request, kept behind an injectable seam so no test ever reaches
 * GitHub. Answers `{status, location}` and never throws.
 *
 * @param {string} url
 * @returns {Promise<{status: number, location: string|null}>}
 */
function electronRequest(url) {
  const { net } = require('electron');
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let request;
    try {
      // `manual`: the redirect IS the answer. Following it would fetch a whole
      // HTML page to learn what its URL already said.
      request = net.request({ method: 'HEAD', url, redirect: 'manual' });
    } catch {
      return done({ status: 0, location: null });
    }

    const timer = setTimeout(() => {
      try {
        request.abort();
      } catch {
        /* already gone */
      }
      done({ status: 0, location: null });
    }, TIMEOUT_MS);

    request.on('response', (response) => {
      clearTimeout(timer);
      const header = response.headers && response.headers.location;
      const location = Array.isArray(header) ? header[0] : header || null;
      done({
        status: response.statusCode,
        location: typeof location === 'string' ? location : null,
      });
      response.on('data', () => {});
      response.on('end', () => {});
    });
    request.on('redirect', (status, _method, redirectUrl) => {
      clearTimeout(timer);
      done({ status, location: typeof redirectUrl === 'string' ? redirectUrl : null });
      try {
        request.abort();
      } catch {
        /* already gone */
      }
    });
    request.on('error', () => {
      clearTimeout(timer);
      done({ status: 0, location: null });
    });

    try {
      request.end();
    } catch {
      clearTimeout(timer);
      done({ status: 0, location: null });
    }
  });
}

/**
 * Is there a newer Ariane?
 *
 * @param {object} args
 * @param {{updateCheck: () => string}} args.settings
 * @param {string} args.version   What is running.
 * @param {(url: string) => Promise<{status: number, location: string|null}>} [args.request]
 * @param {object} [args.pkg]     The manifest, for tests.
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string}>}
 *   `error` is a CODE. The renderer says it; this file never writes a sentence.
 */
async function checkForUpdate({ settings, version, request = electronRequest, pkg } = {}) {
  // Read FIRST, and make no request at all when the answer is no. A setting
  // that merely hides the result would still have told GitHub we were here.
  const when =
    settings && typeof settings.updateCheck === 'function' ? settings.updateCheck() : 'never';
  if (when !== 'startup') return { ok: false, error: 'update-check-off' };

  const repository = repositoryUrl(pkg);
  if (!repository) return { ok: false, error: 'no-repository' };

  const answer = await request(`${repository}/releases/latest`);
  if (!answer || !answer.location) return { ok: false, error: 'unreachable' };

  const found = TAG_IN_LOCATION.exec(answer.location);
  // A repository with no release at all redirects to the releases page itself.
  if (!found) return { ok: false, error: 'no-release' };

  const verdict = decide({ current: version, latest: found[1] });
  return {
    ok: true,
    data: verdict.update
      ? { update: true, version: verdict.version, url: answer.location }
      : { update: false, reason: verdict.reason },
  };
}

module.exports = { checkForUpdate, repositoryUrl, TIMEOUT_MS };
