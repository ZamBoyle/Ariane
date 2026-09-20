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
const VERSION = 1;

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
    // Version 1 is the only one so far. A future change of shape adds its
    // step here, from each older version up to this one — never a discard.
    return {
      id: header.id,
      session: header.session,
      savedAt: header.savedAt,
      messages: lines.slice(1).map((line) => JSON.parse(line)),
    };
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

module.exports = { Archive, ARCHIVE_FORMAT: FORMAT, ARCHIVE_VERSION: VERSION };
