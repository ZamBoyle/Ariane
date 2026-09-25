'use strict';

/**
 * Walks every available agent and fills the index.
 *
 * This module knows nothing about any particular agent: it drives the contract
 * in `agents/contract.js` and nothing else. Adding an agent means adding an
 * adapter, never editing this file.
 *
 * Incrementality rests on two opaque strings the adapter supplies:
 *
 *   fingerprint unchanged -> the session is skipped without being opened;
 *   fingerprint changed   -> reading resumes from the stored cursor;
 *   no stored cursor, or the adapter restarted from the beginning
 *                         -> the session's messages are replaced wholesale.
 *
 * Correctness never depends on an adapter being resumable. An adapter that
 * always re-reads everything is simply slower, never wrong.
 */

const registry = require('./agents');
const { globalSessionId } = require('./agents/contract');
const { echoOf, flattenPrompt } = require('./archive');
const { addReadings } = require('./quota');

/** A queued message as the queue wrote it: the person's words, a time, no id. */
const isQueuedCopy = (m) => m.role === 'user' && !m.uuid && m.timestamp && !m.isNotice && m.text;

/** Rows buffered before hitting the database, to keep transactions chunky. */
const BATCH_SIZE = 500;

class Indexer {
  /**
   * @param {import('./db').Index} index
   * @param {{env?: object, home?: string, adapters?: object[],
   *          onProgress?: (p: object) => void}} [options]
   */
  constructor(index, options = {}) {
    this.index = index;
    // The memo outlives this indexer: the caller keeps one for the app's life.
    this.ctx = { env: options.env || process.env, home: options.home, memo: options.memo };
    this.adapters = options.adapters || null;
    /** Where conversations that exist nowhere else are kept; see archive.js. */
    this.archive = options.archive || null;
    this.onProgress = options.onProgress || (() => {});
  }

  /** Adapters to run: those explicitly given, else every one detected here. */
  get targets() {
    return this.adapters || registry.available(this.ctx);
  }

  /**
   * @returns {Promise<{scanned, indexed, skipped, messages, agents, errors,
   *                    unknownKinds: Record<string, number>}>}
   */
  async run() {
    const report = {
      scanned: 0,
      indexed: 0,
      skipped: 0,
      messages: 0,
      orphans: 0,
      empty: 0,
      // Conversations whose files vanished, copied to the archive this pass,
      // and conversations brought back from it after a rebuild.
      saved: 0,
      restored: 0,
      // Messages whose copy flag changed (Index.markCopies).
      copies: 0,
      agents: [],
      errors: [],
      // Counted rather than discarded: a type we do not recognise is how format
      // drift announces itself. Silence here would mean silent data loss.
      unknownKinds: {},
    };

    const adapters = this.targets;
    this.onProgress({ phase: 'start', agents: adapters.map((a) => a.id) });
    // Whatever this pass writes has a higher id: copies are looked for there.
    const since = this.index.lastMessageId();
    // An empty index is filled whole: its full-text index is built once, at
    // the end, rather than row by row (Index.suspendSearchIndex).
    const filling = since === 0;
    if (filling) this.index.suspendSearchIndex();
    try {
      await this.#pass(report, adapters, since);
    } finally {
      if (filling) this.index.resumeSearchIndex();
    }
    this.index.setMeta('lastIndexedAt', new Date().toISOString());
    // What the pass wrote goes from the journal into the database now, rather
    // than sitting in a journal allowed to reach 64 MB. Last, so nothing is
    // written after it.
    if (report.indexed || report.saved || report.restored) this.index.settle();
    this.onProgress({ phase: 'done', ...report });
    return report;
  }

  /** Read every adapter, then settle the archive and the copies. */
  async #pass(report, adapters, since) {
    // Every session some source still offers, and those offered WHOLE — not
    // reduced to the prompts history.jsonl keeps of them.
    this.seen = new Set();
    this.seenWhole = new Set();
    const completed = new Set();

    for (const adapter of adapters) {
      try {
        const summary = await this.#runAdapter(adapter, report);
        report.agents.push(summary);
        completed.add(adapter.id);
        // Limits an agent keeps outside any conversation (Claude's cached reading).
        if (adapter.quotas) {
          this.index.recordQuotas(adapter.id, null, await adapter.quotas(this.ctx));
        }
      } catch (error) {
        report.errors.push({ agent: adapter.id, message: error.message });
      }
    }

    if (this.archive) {
      this.#saveVanished(report, adapters, completed);
      this.#reconcileArchive(report);
    }

    // A resumed or forked conversation begins with a copy of another's history.
    // Sorted out once everything is in, since either side may have come first;
    // skipped when nothing changed, so an idle pass stays free.
    if (report.indexed || report.saved || report.restored) {
      report.copies = this.index.markCopies({ since });
    }
  }

  /** Copy a session to the archive and mark it as living there. */
  #save(sessionId, report) {
    const rows = this.index.archiveRows(sessionId);
    if (!rows || rows.messages.length === 0) return false;
    this.archive.write(sessionId, rows.session, rows.messages);
    this.index.markArchived(sessionId);
    report.saved += 1;
    return true;
  }

  /**
   * Sessions no source offered this pass: their files are gone, and the
   * index holds the last copy. Only an agent whose discovery ran to the end can
   * vouch for that. An agent no longer on this machine at all counts too — its
   * files went with it — unless this run was told which adapters to use.
   */
  #saveVanished(report, adapters, completed) {
    const present = new Set(adapters.map((a) => a.id));
    const vouched = (agentId) =>
      completed.has(agentId) || (!this.adapters && !present.has(agentId));

    for (const { id, agentId, source } of this.index.sessionsBrief()) {
      if (source === 'archive' || this.seen.has(id) || !vouched(agentId)) continue;
      this.#save(id, report);
    }
  }

  /**
   * Bring the archive and the index into line. A conversation its agent offers
   * whole again drops its copy: the live file is the truth. One the index has
   * lost — after a rebuild — or holds only as prompts is restored from it.
   */
  #reconcileArchive(report) {
    for (const { id, file } of this.archive.list()) {
      if (this.seenWhole.has(id)) {
        this.archive.remove(id);
        continue;
      }
      const current = this.index.session(id);
      if (current && current.source !== 'history') continue; // saved, and already shown

      try {
        const saved = this.archive.read(file);
        const agent = registry.byId(saved.session.agent_id);
        this.index.restoreArchived(id, saved.session, saved.messages, agent && agent.label);
        report.restored += 1;
      } catch (error) {
        // Left exactly where it is: an unreadable archive is reported, never deleted.
        report.errors.push({ agent: 'archive', key: file, message: error.message });
      }
    }
  }

  async #runAdapter(adapter, report) {
    this.index.upsertAgent(adapter.id, adapter.label, safeRoot(adapter, this.ctx));

    const summary = { id: adapter.id, label: adapter.label, sessions: 0, messages: 0 };
    let seen = 0;

    for await (const descriptor of adapter.discover(this.ctx)) {
      seen += 1;
      const sessionId = globalSessionId(adapter.id, descriptor.sessionId);
      this.seen.add(sessionId);
      if (descriptor.source !== 'history') this.seenWhole.add(sessionId);
      report.scanned += 1;

      try {
        const result = await this.#indexSession(adapter, descriptor, report);
        if (result.skipped) report.skipped += 1;
        else report.indexed += 1;
        if (descriptor.source === 'history') report.orphans += 1;
        report.messages += result.messages;
        summary.messages += result.messages;
      } catch (error) {
        report.errors.push({ agent: adapter.id, key: descriptor.key, message: error.message });
        // The session row was created before reading began. Leaving it behind
        // would list a conversation that opens onto nothing, for ever.
        const id = globalSessionId(adapter.id, descriptor.sessionId);
        this.index.finalizeSession(id);
        this.index.dropIfEmpty(id);
      }

      this.onProgress({ phase: 'scanning', agent: adapter.id, done: seen });
    }

    summary.sessions = seen;
    return summary;
  }

  async #indexSession(adapter, descriptor, report) {
    const id = globalSessionId(adapter.id, descriptor.sessionId);
    const previous = this.index.sourceState(descriptor.key);

    if (previous && previous.fingerprint === descriptor.fingerprint) {
      return { skipped: true, messages: 0 };
    }

    // Prompts alone must never replace a whole conversation. When Claude Code
    // deletes a transcript, the session comes straight back from history.jsonl
    // with only what was typed — and reading it would start by deleting every
    // message the index held. The whole conversation is saved at that moment,
    // and the poorer copy is set aside.
    if (this.archive && descriptor.source === 'history') {
      const current = this.index.session(id);
      if (current && current.source !== 'history') {
        if (current.source !== 'archive') this.#save(id, report);
        return { skipped: true, messages: 0 };
      }
    }

    // A stored cursor is only usable if the adapter still vouches for it; see
    // canResume in the contract. Otherwise we re-read from scratch.
    let cursor = previous ? previous.cursor : null;
    if (cursor && adapter.canResume && !adapter.canResume(descriptor, cursor, this.ctx)) {
      cursor = null;
    }
    // Reading from the start replays messages we already stored, so they go.
    if (!cursor) this.index.resetSession(id, null);

    const folderId = this.index.folderId(
      descriptor.folderPath || '(inconnu)',
      descriptor.dirName || null,
      descriptor.folderOnDisk !== false,
      // An adapter that could not confirm the path says so; the reader is then
      // told the folder is a guess rather than being shown one as a fact.
      descriptor.folderExact !== false
    );

    this.index.upsertSession({
      id,
      agent_id: adapter.id,
      folder_id: folderId,
      source: descriptor.source === 'history' ? 'history' : 'transcript',
      file_path: descriptor.filePath || null,
      title: descriptor.title || null,
      // A subagent's conversation hangs off the one that launched it.
      parent_id: descriptor.parentId ? globalSessionId(adapter.id, descriptor.parentId) : null,
      // A fork names the conversation it continues (Index.chain).
      continues_from: descriptor.continuesFrom
        ? globalSessionId(adapter.id, descriptor.continuesFrom)
        : null,
    });

    let buffer = [];
    let count = 0;
    let lastCursor = cursor;
    let gitBranch = null;

    // Records that merely repeat a turn stored elsewhere are held back until the
    // whole session has been read: the duplicate they shadow may come later in
    // the file, and a check made on the way past could not see it. They carry no
    // timestamp of their own, so they have no natural position to lose.
    const deferred = [];

    // What a reply cost, when no reply is stored yet to carry it. Older Codex
    // files write the count BEFORE the reply it paid for, so a conversation's
    // first one arrives with nothing to attach to: 43 of them on a real corpus,
    // lost until this queue. It waits for the next assistant message instead.
    const pendingUsage = [];
    const settleUsage = () => {
      while (pendingUsage.length && this.index.addUsage(id, pendingUsage[0])) pendingUsage.shift();
    };
    // The last assistant message still in the buffer. A cost is added to it in
    // memory: writing each of Codex's 7 521 counts on its own — a flush, then
    // an UPDATE, each its own transaction — made a full pass three times slower.
    let lastReply = null;

    // Read from the start, this pass sees everything the session will hold —
    // resetSession emptied it above. The two checks on the person's words are
    // then made on what it read: asking the database for each cost half a
    // second of a full pass. Only a pass that resumes a file halfway asks.
    const whole = !cursor;
    const said = new Set();
    const queuedWritten = new Map();

    // What the agent's limits stood at, one entry per window: thousands of
    // readings in a long Codex conversation, a handful of windows, written once.
    const quotaWindows = [];

    const flush = () => {
      if (buffer.length === 0) return;
      for (const m of buffer) {
        if (isQueuedCopy(m)) queuedWritten.set(m.text, (queuedWritten.get(m.text) || 0) + 1);
      }
      count += this.index.addMessages(id, buffer);
      buffer = [];
      lastReply = null;
      settleUsage();
    };

    for await (const chunk of adapter.read(descriptor, { cursor, ctx: this.ctx })) {
      const { item } = chunk;
      if (chunk.cursor !== undefined) lastCursor = chunk.cursor;
      if (item.quota) addReadings(quotaWindows, item.quota);

      switch (item.kind) {
        case 'message':
          // In a subagent's conversation nobody is the person: its opening
          // "user" turn is the briefing the parent assistant wrote. Claude marks
          // every such line itself; Codex does not, so the whole session is.
          if (descriptor.parentId) item.isSidechain = true;
          if (!gitBranch && item.gitBranch) gitBranch = item.gitBranch;
          // Some records name the session AND say something; both are kept.
          if (item.slug) this.index.setSlug(id, item.slug);
          // A compaction boundary names the transcript this one continues.
          if (item.continuesUuid) this.index.setContinues(id, item.continuesUuid);
          if (item.dedupeByText) {
            if (item.text) deferred.push(item);
            break;
          }
          // A queued message, now delivered as a line of its own (claude.js):
          // its queued copy goes, from the buffer or from an earlier pass.
          if (item.deliversQueued) {
            const copy = buffer.findLastIndex((m) => isQueuedCopy(m) && m.text === item.text);
            if (copy >= 0) buffer.splice(copy, 1);
            else if (!whole || queuedWritten.get(item.text) > 0) {
              if (this.index.dropQueuedCopy(id, item.text) && whole) {
                queuedWritten.set(item.text, queuedWritten.get(item.text) - 1);
              }
            }
          }
          if (whole && item.role === 'user' && item.text) said.add(item.text);
          buffer.push(item);
          if (item.role === 'assistant') {
            lastReply = item;
            // Costs that came before any reply belong to this one.
            while (pendingUsage.length) {
              lastReply.usage = sumUsage(lastReply.usage, pendingUsage.shift());
            }
          }
          if (buffer.length >= BATCH_SIZE) flush();
          break;
        case 'title':
          if (item.title) this.index.setTitle(id, item.title);
          break;
        case 'summary':
          if (item.slug) this.index.setSlug(id, item.slug);
          break;
        case 'continuation':
          // Resumed elsewhere: the old file names the new one (Index.chain).
          if (item.continuedIn) {
            this.index.setContinuedIn(id, globalSessionId(adapter.id, item.continuedIn));
          }
          break;
        case 'usage':
          // To the last reply: in memory while it is still buffered, in the
          // database once it has been written, and held while there is none.
          if (lastReply) {
            lastReply.usage = sumUsage(lastReply.usage, item.usage);
          } else if (pendingUsage.length || !this.index.addUsage(id, item.usage)) {
            pendingUsage.push(item.usage);
          }
          break;
        case 'ignored':
          if (item.reason && !item.reason.startsWith('known-')) {
            report.unknownKinds[item.reason] = (report.unknownKinds[item.reason] || 0) + 1;
          }
          break;
        default:
          report.unknownKinds[`kind:${item.kind}`] =
            (report.unknownKinds[`kind:${item.kind}`] || 0) + 1;
      }
    }
    flush();

    // Now that everything else is stored, keep only the deferred records whose
    // text the session still lacks, in any shape (archive.js, echoOf). Measured
    // on 25 September 2026: 11 survivors in the whole corpus, lost otherwise.
    const kept = [];
    const seen = new Set();
    let flatSaid = null;
    const holds = (item) => {
      if (!whole || item.role !== 'user')
        return this.index.hasMessageText(id, item.role, item.text);
      if (said.has(item.text)) return true;
      flatSaid ??= [...said].map(flattenPrompt);
      const { matches } = echoOf(item.text);
      return flatSaid.some(matches);
    };
    for (const item of deferred) {
      const key = `${item.role}\u0000${item.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (holds(item)) continue;
      kept.push(item);
    }
    if (kept.length > 0) count += this.index.addMessages(id, kept);
    settleUsage();
    this.index.recordQuotas(adapter.id, id, quotaWindows);
    // A cost with no reply anywhere in the session: reported, never guessed.
    if (pendingUsage.length) {
      report.unknownKinds['usage-without-reply'] =
        (report.unknownKinds['usage-without-reply'] || 0) + pendingUsage.length;
    }

    if (gitBranch) {
      this.index.upsertSession({
        id,
        agent_id: adapter.id,
        folder_id: folderId,
        git_branch: gitBranch,
        source: descriptor.source === 'history' ? 'history' : 'transcript',
        file_path: descriptor.filePath || null,
      });
    }

    this.index.finalizeSession(id);

    // A session with nothing readable in it is not a conversation; listing it
    // would offer the reader a row that opens onto an empty pane.
    if (this.index.dropIfEmpty(id)) report.empty += 1;

    this.index.saveSourceState({
      key: descriptor.key,
      agent_id: adapter.id,
      session_id: id,
      fingerprint: descriptor.fingerprint,
      cursor: lastCursor,
    });

    return { skipped: false, messages: count };
  }
}

function safeRoot(adapter, ctx) {
  try {
    return adapter.root(ctx);
  } catch {
    return null;
  }
}

/** Two usages added field by field; a field neither recorded stays null. */
function sumUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const out = {};
  for (const key of Object.keys({ ...a, ...b })) {
    const x = a[key];
    const y = b[key];
    out[key] = x == null && y == null ? null : (x || 0) + (y || 0);
  }
  return out;
}

module.exports = { Indexer, BATCH_SIZE };
