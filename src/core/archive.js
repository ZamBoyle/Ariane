'use strict';

/**
 * Conversations whose files are gone, kept where no rebuild can reach them.
 *
 * The index is derived data: a schema change drops it and rebuilds it from the
 * agents' files. But a pass never removes a conversation whose file has
 * disappeared, so once an agent deletes a transcript — Claude Code does, on a
 * schedule — the index holds the only copy left anywhere, and the next rebuild
 * would destroy it without a word. This is where such a conversation goes: one
 * JSONL file per session, beside the index, and never touched by its
 * migrations.
 *
 * What is kept is what the index held: prose, reasoning, tool previews — never
 * the bytes of attachments. Once the source is gone, it is all there is.
 *
 * Unlike the index, this format is MIGRATED, never dropped: dropping it would
 * only move the problem somewhere else.
 */

const fs = require('fs');
const path = require('path');

const FORMAT = 'ariane-archive';
const VERSION = 2;

class Archive {
  /** @param {string} dir Usually `<userData>/archive`. */
  constructor(dir) {
    this.dir = dir;
  }

  /**
   * `claude:abc` → `<dir>/claude/abc.jsonl`. The session part is encoded: an id
   * comes from files other programs wrote, and must never steer a path.
   */
  fileFor(globalId) {
    const cut = String(globalId).indexOf(':');
    const agent = cut > 0 ? globalId.slice(0, cut) : '';
    const sessionId = cut > 0 ? globalId.slice(cut + 1) : '';
    if (!/^[a-z0-9-]+$/.test(agent) || !sessionId) {
      throw new Error(`identifiant de conversation invalide : ${globalId}`);
    }
    return path.join(this.dir, agent, `${encodeURIComponent(sessionId)}.jsonl`);
  }

  has(globalId) {
    return fs.existsSync(this.fileFor(globalId));
  }

  /**
   * @param {string} globalId
   * @param {object} session  What the index knew of it; see db.js ARCHIVE_SESSION.
   * @param {object[]} messages  Its message rows, in order; see ARCHIVE_MESSAGES.
   */
  write(globalId, session, messages) {
    const file = this.fileFor(globalId);
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const header = { format: FORMAT, version: VERSION, id: globalId, savedAt: new Date().toISOString(), session };
    const body = `${[header, ...messages].map((line) => JSON.stringify(line)).join('\n')}\n`;

    // Written whole, then renamed into place: a crash half-way must never leave
    // half a conversation where the only copy of it was about to be.
    const temp = `${file}.${process.pid}.partial`;
    fs.writeFileSync(temp, body);
    fs.renameSync(temp, file);
  }

  /**
   * @returns {{id: string, session: object, messages: object[], savedAt: string}}
   * @throws on anything that is not an archive this version can read — the
   *   caller reports it, and the file is left exactly where it is.
   */
  read(file) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const header = lines.length ? JSON.parse(lines[0]) : null;
    if (!header || header.format !== FORMAT) throw new Error(`${file} is not an Ariane archive`);
    if (header.version > VERSION) {
      throw new Error(`${file} comes from a newer version of Ariane (format ${header.version})`);
    }
    // Each older version is brought up to this one, step by step — never a discard.
    let messages = lines.slice(1).map((line) => JSON.parse(line));
    if (header.version < 2 && String(header.id).startsWith('claude:')) {
      messages = withoutRepeatedUsage(messages);
    }
    return { id: header.id, session: header.session, savedAt: header.savedAt, messages };
  }

  remove(globalId) {
    fs.rmSync(this.fileFor(globalId), { force: true });
  }

  /** Every conversation kept here, as `{id, file}`. A missing archive is an empty one. */
  list() {
    const out = [];
    let agents;
    try {
      agents = fs.readdirSync(this.dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const dir = path.join(this.dir, agent.name);
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue; // .partial files are a write that never finished
        out.push({ id: `${agent.name}:${decodeURIComponent(name.slice(0, -'.jsonl'.length))}`, file: path.join(dir, name) });
      }
    }
    return out;
  }
}

const TOKEN_COLUMNS = [
  'tok_input',
  'tok_output',
  'tok_cache_read',
  'tok_cache_write',
  'tok_reasoning',
];

/**
 * Version 1 → 2: before Ariane 0.3.4, a Claude reply's usage was stored on every
 * line of the reply (agents/claude.js). Those files cannot be re-read — their
 * transcript is gone — so the repeat is recognised here instead: an assistant
 * row whose five counts equal the previous assistant row's exactly. The cache
 * read alone grows at every call, so two different replies never share all
 * five. Measured on the two archives concerned: 14 repeats of 21, 118 of 212.
 * Rows are in the index's own column names, as the archive stores them.
 */
const NO_TOKENS = Object.fromEntries(TOKEN_COLUMNS.map((k) => [k, null]));

function withoutRepeatedUsage(messages) {
  let previous = null;
  return messages.map((message) => {
    const counted = TOKEN_COLUMNS.some((k) => message[k] != null);
    if (message.role !== 'assistant' || !counted) return message;
    const key = TOKEN_COLUMNS.map((k) => message[k] ?? '').join(',');
    if (key === previous) return { ...message, ...NO_TOKENS };
    previous = key;
    return message;
  });
}

module.exports = {
  Archive,
  ARCHIVE_FORMAT: FORMAT,
  ARCHIVE_VERSION: VERSION,
  withoutRepeatedUsage,
};
