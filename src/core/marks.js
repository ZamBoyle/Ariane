'use strict';

/**
 * The person's own marks: a star and a note on a conversation, and a star on
 * any message inside one.
 *
 * Everything else in Ariane is derived — the index can be thrown away and
 * rebuilt from the agents' files in ten seconds, and `#migrate()` does exactly
 * that at every schema change. These marks cannot be rebuilt from anything:
 * they are the only thing here that someone wrote themselves. So they live in
 * their own file, in the app's user-data directory, beside the archive and the
 * settings, out of the index's reach.
 *
 * They are keyed on the global session id (`claude:64ffbe9a-…`), the only
 * identifier that survives a reindexing: row ids do not.
 *
 * A marked MESSAGE has the same problem, one level down, and no single answer:
 * measured on a real corpus, 98 % of Claude's messages carry an id of their
 * own, 91 % of Codex's, 74 % of Copilot's — and none of VS Code's. So a mark
 * stores several coordinates and is resolved by the most reliable one that
 * still matches: the message's own id, else its position, else the opening of
 * its text. The text is what catches a position that shifted because the
 * extraction rules changed — which is exactly when the index is rebuilt.
 *
 * Rules, each with a test that fails without it:
 *  - a file that cannot be read is NEVER overwritten — it holds someone's
 *    words, one typo away from valid;
 *  - keys this version does not know are kept, at both levels;
 *  - a mark with neither star nor note is removed rather than stored empty;
 *  - writes are atomic: a temporary file, then a rename.
 */

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'marks.json';
const FORMAT = 'ariane-marks';
const VERSION = 1;

/** A note is a few lines, not a document: enough for "why this one matters". */
const NOTE_MAX = 2000;

/** Enough of a message to recognise it again, and not a copy of it. */
const PREVIEW_MAX = 160;

/** `claude:64ffbe9a-…` — an agent, then the agent's own id. */
const SESSION_ID = /^[a-z0-9-]+:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** What a note may hold: text, of a sane length, with no control character but newline and tab. */
function cleanNote(value) {
  if (typeof value !== 'string') throw new TypeError('note must be text');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new TypeError('note holds control characters');
  const text = value.trim();
  if (text.length > NOTE_MAX) throw new TypeError(`note is longer than ${NOTE_MAX} characters`);
  return text;
}

class Marks {
  /** @param {string} dir The app's user-data directory. */
  constructor(dir) {
    this.file = path.join(dir, FILE_NAME);
  }

  /**
   * @returns {{ok: true, marks: object} | {ok: false, error: string}}
   *   A missing file reads as no marks; anything else that cannot be parsed
   *   does not — and then nothing is ever written over it.
   */
  read() {
    const loaded = this.#load();
    return loaded.ok ? { ok: true, marks: loaded.marks } : { ok: false, error: loaded.error };
  }

  /** One conversation's mark: `{favorite, note, messages}`, all always present. */
  of(sessionId) {
    const read = this.read();
    const mark = read.ok && isPlainObject(read.marks[sessionId]) ? read.marks[sessionId] : {};
    return {
      favorite: mark.favorite === true,
      note: typeof mark.note === 'string' ? mark.note : '',
      messages: messagesIn(mark),
    };
  }

  /**
   * Star a message, or take the star off.
   *
   * @param {string} sessionId
   * @param {{uuid?: string, seq: number, role?: string, at?: string, preview?: string}} message
   *   Every coordinate the caller can give: the resolution uses whichever still
   *   holds. Built from the index by the main process — never from the renderer.
   * @param {boolean} on
   */
  setMessage(sessionId, message, on = true) {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
      throw new TypeError('sessionId must be an agent-namespaced id');
    }
    const coordinates = cleanMessage(message);

    const read = this.#load();
    if (!read.ok) return { ok: false, error: read.error };

    const marks = { ...read.marks };
    const previous = isPlainObject(marks[sessionId]) ? marks[sessionId] : {};
    const messages = messagesIn(previous).filter((m) => keyOf(m) !== keyOf(coordinates));
    if (on) messages.push(coordinates);

    const next = {
      ...previous,
      favorite: previous.favorite === true,
      note: typeof previous.note === 'string' ? previous.note : '',
      messages,
    };
    if (!next.favorite && !next.note && messages.length === 0) delete marks[sessionId];
    else marks[sessionId] = { ...next, updatedAt: new Date().toISOString() };

    const written = this.#write(read.data, marks);
    if (!written.ok) return written;
    return { ok: true, messages };
  }

  /**
   * Which of these messages are starred, by the most reliable coordinate that
   * still matches.
   *
   * @param {string} sessionId
   * @param {Array<{id: number, uuid?: string, seq: number, text?: string}>} messages
   *   The conversation as the index holds it now.
   * @returns {number[]} The row ids of the starred ones, in the order given.
   */
  resolve(sessionId, messages) {
    const marks = this.of(sessionId).messages;
    if (marks.length === 0) return [];
    const byUuid = new Map();
    const bySeq = new Map();
    for (const message of messages) {
      if (message.uuid) byUuid.set(message.uuid, message);
      bySeq.set(message.seq, message);
    }

    const found = new Set();
    for (const mark of marks) {
      const match =
        (mark.uuid && byUuid.get(mark.uuid)) ||
        matching(bySeq.get(mark.seq), mark) ||
        // The position moved — the extraction changed what it keeps — so the
        // opening of the text is what is left to recognise it by.
        messages.find((message) => matching(message, mark, true));
      if (match) found.add(match.id);
    }
    return messages.filter((message) => found.has(message.id)).map((message) => message.id);
  }

  /** Every marked conversation: id -> `{favorite, note}`. Empty when the file cannot be read. */
  all() {
    const read = this.read();
    if (!read.ok) return {};
    const out = {};
    for (const [id, mark] of Object.entries(read.marks)) {
      if (!isPlainObject(mark)) continue;
      out[id] = {
        favorite: mark.favorite === true,
        note: typeof mark.note === 'string' ? mark.note : '',
        messages: messagesIn(mark),
      };
    }
    return out;
  }

  /**
   * Set the star, the note, or both. What is not named is left as it was.
   *
   * @param {string} sessionId Global id: `agent:sessionId`.
   * @param {{favorite?: boolean, note?: string}} change
   * @returns {{ok: true, mark: {favorite: boolean, note: string}} | {ok: false, error: string}}
   * @throws {TypeError} For an id that is not one, or a note that is not text.
   */
  set(sessionId, change = {}) {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
      throw new TypeError('sessionId must be an agent-namespaced id');
    }
    const favorite = change.favorite === undefined ? undefined : change.favorite === true;
    const note = change.note === undefined ? undefined : cleanNote(change.note);

    const read = this.#load();
    if (!read.ok) return { ok: false, error: read.error }; // theirs to fix, not ours to replace

    const marks = { ...read.marks };
    const previous = isPlainObject(marks[sessionId]) ? marks[sessionId] : {};
    const next = {
      ...previous,
      favorite: favorite === undefined ? previous.favorite === true : favorite,
      note: note === undefined ? (typeof previous.note === 'string' ? previous.note : '') : note,
    };

    // Nothing marked any more: the entry goes, rather than lingering empty.
    if (!next.favorite && !next.note && messagesIn(next).length === 0) delete marks[sessionId];
    else marks[sessionId] = { ...next, updatedAt: new Date().toISOString() };

    const written = this.#write(read.data, marks);
    if (!written.ok) return written;
    return { ok: true, mark: { favorite: next.favorite, note: next.note } };
  }

  /** Every conversation with a star, a note or a starred message. */
  remove(sessionId) {
    const read = this.#load();
    if (!read.ok) return { ok: false, error: read.error };
    if (!Object.hasOwn(read.marks, sessionId)) return { ok: true, removed: false };
    const marks = { ...read.marks };
    delete marks[sessionId];
    const written = this.#write(read.data, marks);
    return written.ok ? { ok: true, removed: true } : written;
  }

  #load() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { ok: true, data: {}, marks: {} };
      return { ok: false, error: error.message };
    }
    try {
      const data = JSON.parse(text);
      if (!isPlainObject(data)) return { ok: false, error: 'the file must hold a JSON object' };
      if (data.format !== undefined && data.format !== FORMAT) {
        return { ok: false, error: `${this.file} is not an Ariane marks file` };
      }
      if (typeof data.version === 'number' && data.version > VERSION) {
        return { ok: false, error: `${this.file} comes from a newer version of Ariane` };
      }
      return { ok: true, data, marks: isPlainObject(data.marks) ? data.marks : {} };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /** Keeps every key this version does not know, at both levels. */
  #write(data, marks) {
    const next = { ...data, format: FORMAT, version: VERSION, marks };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const partial = `${this.file}.${process.pid}.partial`;
    try {
      fs.writeFileSync(partial, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(partial, this.file);
    } catch (error) {
      fs.rmSync(partial, { force: true });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }
}

/** A mark's messages, as stored — anything malformed is ignored rather than trusted. */
function messagesIn(mark) {
  const messages = isPlainObject(mark) && Array.isArray(mark.messages) ? mark.messages : [];
  return messages.filter((m) => isPlainObject(m) && Number.isInteger(m.seq));
}

/** What identifies a starred message in the file: its own id, or its position. */
const keyOf = (message) => (message.uuid ? `uuid:${message.uuid}` : `seq:${message.seq}`);

/** Does this message answer to that mark? By text when the position has moved. */
function matching(message, mark, byTextOnly = false) {
  if (!message) return null;
  if (mark.uuid && message.uuid) return message.uuid === mark.uuid ? message : null;
  if (!mark.preview) return byTextOnly ? null : message;
  const start = openingOf(message.text || '');
  if (!start) return null;
  return start === mark.preview ? message : null;
}

const openingOf = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX);

function cleanMessage(message) {
  if (!isPlainObject(message) || !Number.isInteger(message.seq) || message.seq < 0) {
    throw new TypeError('a marked message needs its position');
  }
  const out = { seq: message.seq };
  if (message.uuid) {
    if (typeof message.uuid !== 'string' || message.uuid.length > 128) throw new TypeError('uuid must be a short string');
    out.uuid = message.uuid;
  }
  if (message.role) out.role = String(message.role).slice(0, 32);
  if (message.at) out.at = String(message.at).slice(0, 40);
  const preview = openingOf(message.preview || '');
  if (preview) out.preview = preview;
  return out;
}

module.exports = { Marks, FILE_NAME, NOTE_MAX, PREVIEW_MAX, SESSION_ID };
