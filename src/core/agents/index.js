'use strict';

/**
 * Adapter registry.
 *
 * Adding support for an agent means adding one module here and nothing else:
 * the indexer, the database and the UI all work in terms of the contract.
 * Order matters only for display.
 */

const { assertAdapter, globalSessionId } = require('./contract');

const ADAPTERS = [
  require('./claude'),
  require('./codex'),
  require('./copilot-cli'),
  require('./qwen'),
  require('./gemini'),
  require('./antigravity'),
  require('./vscode'),
].map(assertAdapter);

const BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

/** Every registered adapter, in display order. */
function all() {
  return ADAPTERS.slice();
}

/** Only the agents whose data directory exists on this machine. */
function available(ctx = {}) {
  return ADAPTERS.filter((adapter) => {
    try {
      return adapter.detect(ctx);
    } catch {
      // A broken detect() must not take the whole scan down with it.
      return false;
    }
  });
}

/** Every environment variable that can relocate an agent root. */
function allEnvKeys() {
  return [...new Set(ADAPTERS.flatMap((a) => a.envKeys || []))];
}

function byId(id) {
  return BY_ID.get(id) || null;
}

module.exports = { all, available, byId, allEnvKeys, globalSessionId };
