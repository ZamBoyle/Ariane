#!/usr/bin/env node
'use strict';

/**
 * Finds records an extractor discards that nevertheless contain prose.
 *
 * This exists because of a real bug: Claude Code writes a message typed
 * mid-turn as a `queue-operation` record, that record is the only place the
 * message is ever stored, and `queue-operation` was on the KNOWN-noise list.
 * Half of one person's words were dropped in silence for days.
 *
 * The drift detector in the indexer cannot catch this class: it reports types
 * it does not RECOGNISE, and this one was recognised — and dismissed. A wrong
 * entry on a noise list is therefore the most dangerous mistake in this
 * codebase, because it is the only one that makes no noise at all.
 *
 * So this audit works on RAW records, before the extractor has had a chance to
 * throw anything away, and asks: did we discard something a human would read?
 *
 *   node scripts/audit-noise.js            audit every agent found on this machine
 *   node scripts/audit-noise.js claude     just one
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { readRecords } = require('../src/core/jsonl');

/** Shorter than this is an identifier, a path or a flag — not prose. */
const MIN_PROSE = 40;

/** Extractors that take one raw record and say what becomes of it. */
const EXTRACTORS = {
  claude: () => require('../src/core/extract').extractRecord,
  codex: () => require('../src/core/agents/codex-extract').extractCodexRecord,
  'copilot-cli': () => require('../src/core/agents/copilot-extract').extractCopilotRecord,
  qwen: () => require('../src/core/agents/qwen').extractQwenRecord,
  antigravity: () => require('../src/core/agents/antigravity').extractAntigravityRecord,
};

/** Where each agent's raw record files live, relative to its root. */
const SOURCES = {
  claude: { root: () => require('../src/core/paths').projectsDir(), depth: 2 },
  codex: { root: () => path.join(home(), '.codex', 'sessions'), depth: 5 },
  'copilot-cli': { root: () => path.join(home(), '.copilot', 'session-state'), depth: 3 },
  qwen: { root: () => path.join(home(), '.qwen', 'projects'), depth: 4 },
  // brain/<id>/.system_generated/logs/transcript.jsonl
  antigravity: { root: () => path.join(home(), '.gemini', 'antigravity-cli', 'brain'), depth: 3 },
};

const home = () => require('os').homedir();

/** Every readable string in a record that looks like something a person wrote. */
function prose(value, depth = 0, out = []) {
  if (depth > 6 || value == null) return out;

  if (typeof value === 'string') {
    const text = value.trim();
    if (
      text.length >= MIN_PROSE &&
      /\s/.test(text) && // has spaces: a sentence, not a token
      !/^[A-Za-z0-9+/=]{60,}$/.test(text) && // not base64
      !/^[/~.]\S*$/.test(text) // not a bare path
    ) {
      out.push(text);
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) prose(item, depth + 1, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) prose(item, depth + 1, out);
  }
  return out;
}

async function* walk(dir, depth) {
  if (depth < 0) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, depth - 1);
    else if (entry.isFile() && /\.jsonl$/.test(entry.name)) yield full;
  }
}

async function auditAgent(id, { maxFiles = 40 } = {}) {
  const source = SOURCES[id];
  const root = source.root();
  if (!fs.existsSync(root)) return null;

  const extract = EXTRACTORS[id]();
  const findings = new Map();
  let records = 0;
  let files = 0;

  for await (const file of walk(root, source.depth)) {
    if (++files > maxFiles) break;
    try {
      for await (const { value } of readRecords(file)) {
        records += 1;
        const item = extract(value);
        if (!item || item.kind !== 'ignored') continue;

        const texts = prose(value);
        if (texts.length === 0) continue;

        const key = `${value && value.type} (${item.reason}${item.detail ? `/${item.detail}` : ''})`;
        if (!findings.has(key)) findings.set(key, { count: 0, chars: 0, sample: texts[0] });
        const entry = findings.get(key);
        entry.count += 1;
        entry.chars += texts.reduce((n, t) => n + t.length, 0);
      }
    } catch {
      /* unreadable file: not what this audit is about */
    }
  }

  return { id, files, records, findings };
}

(async () => {
  const only = process.argv[2];
  const ids = Object.keys(EXTRACTORS).filter((id) => !only || id === only);
  let suspicious = 0;

  for (const id of ids) {
    const result = await auditAgent(id);
    if (!result) {
      console.log(`\n=== ${id}: absent de cette machine ===`);
      continue;
    }

    console.log(`\n=== ${id}: ${result.files} fichiers, ${result.records} enregistrements ===`);
    if (result.findings.size === 0) {
      console.log('  rien d’ecarte ne contient de prose');
      continue;
    }

    const rows = [...result.findings.entries()].sort((a, b) => b[1].chars - a[1].chars);
    for (const [key, entry] of rows) {
      suspicious += 1;
      console.log(`  ${key}`);
      console.log(`    ${entry.count} fois, ${(entry.chars / 1024).toFixed(1)} Ko de texte ecarte`);
      console.log(`    ${JSON.stringify(entry.sample.slice(0, 100))}`);
    }
  }

  console.log(
    suspicious === 0
      ? '\nAucun type ecarte ne contient de prose.'
      : `\n${suspicious} type(s) a verifier : du texte lisible y est jete.`
  );
})();
