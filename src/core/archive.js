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
const VERSION = 3;

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

    const header = {
      format: FORMAT,
      version: VERSION,
      id: globalId,
      savedAt: new Date().toISOString(),
      session,
    };
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
    if (header.version < 3 && String(header.id).startsWith('claude:')) {
      messages = withoutEchoedPrompts(messages);
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
        out.push({
          id: `${agent.name}:${decodeURIComponent(name.slice(0, -'.jsonl'.length))}`,
          file: path.join(dir, name),
        });
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

/** A text with every run of blanks made one space, as Claude Code's pointer writes it. */
const flattenPrompt = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What Claude Code's `last-prompt` pointer repeats. It writes the prompt in its
 * own shape — blanks flattened to one space, and past 200 characters cut and
 * ended with "…" — so it repeats a message whose flattened text is its own, or
 * begins with it when cut. `matches` takes a text already flattened: callers
 * flatten each candidate once, not once per pointer.
 *
 * @returns {{stem: string, matches: (flatHeld: string) => boolean}}
 */
function echoOf(pointer) {
  const flat = flattenPrompt(pointer);
  const cut = flat.endsWith('…');
  const stem = cut ? flat.slice(0, -1).trimEnd() : flat;
  return {
    stem,
    matches: (flatHeld) => Boolean(stem) && (cut ? flatHeld.startsWith(stem) : flatHeld === stem),
  };
}

/** How close a queued copy and its delivery are, when the file no longer says. */
const QUEUED_COPY_MS = 2000;

/**
 * Version 2 → 3: until 25 September 2026, the person's words could be stored twice
 * (agents/claude.js, db.js hasMessageText). The index is rebuilt from the files;
 * an archive cannot be, so the two echoes are recognised here instead:
 *
 * - a `last-prompt` pointer — the only rows with neither a time nor an id — whose
 *   text, blanks flattened, is another message of the person's, or begins one
 *   when Claude Code cut it with "…";
 * - a queued copy — no id, a time — followed within QUEUED_COPY_MS by a line of
 *   the person's with an id and the same text. The file's own proof, the
 *   `dequeue`, is not in an archive; the delay is, and it is tight on purpose:
 *   measured, half the deliveries follow within 74 ms. A copy that waited
 *   longer stays twice, rather than risk a word the person typed only once.
 */
function withoutEchoedPrompts(messages) {
  const said = messages.filter((m) => m.role === 'user' && !m.is_notice && m.text);
  const drop = new Set();
  for (const m of said) {
    if (m.uuid) continue;
    if (!m.ts) {
      const { matches } = echoOf(m.text);
      const echoes = said.some(
        (o) => o !== m && !drop.has(o) && (o.uuid || o.ts) && matches(flattenPrompt(o.text))
      );
      if (echoes) drop.add(m);
      continue;
    }
    const at = Date.parse(m.ts);
    const delivery = said.find(
      (o) =>
        o.uuid &&
        o.seq > m.seq &&
        o.text === m.text &&
        Date.parse(o.ts) - at >= 0 &&
        Date.parse(o.ts) - at <= QUEUED_COPY_MS
    );
    if (delivery) drop.add(m);
  }
  return drop.size ? messages.filter((m) => !drop.has(m)) : messages;
}

module.exports = {
  Archive,
  ARCHIVE_FORMAT: FORMAT,
  ARCHIVE_VERSION: VERSION,
  withoutRepeatedUsage,
  withoutEchoedPrompts,
  flattenPrompt,
  echoOf,
};
