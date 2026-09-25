<p align="center">
  <a href="ARCHITECTURE.md">English</a> · <a href="ARCHITECTURE.fr.md">Français</a>
</p>

# Ariane — architecture

This document explains **how the application is built**, and above all **why it is built this way**.
It is the detail, to be opened when needed: the trap in each format, the adapter contract, the
schema, the security model.

What is left to do lives in `ROADMAP.md`, what was done in `CHANGELOG.md`, and what the app offers
its user in `README.md`.

---

## 1. What the application does

Seven coding assistants write their conversations to disk, each in its own format. Ariane reads them
**read-only**, extracts what is actually conversation (about 1 % of the bytes), and presents it
**grouped by working directory** — because the question people ask is “what did I do on this
project?”, not “what did I say to that tool?”.

Everything Ariane writes belongs to it and lives in its own user-data directory (`~/.config/Ariane`
on Linux, `%APPDATA%\Ariane` on Windows, `~/Library/Application Support/Ariane` on macOS): the
index, the archive, the settings, and the marks the person makes themselves.

```
  ~/.claude/  ~/.codex/  ~/.copilot/  ~/.qwen/  ~/.gemini/  <config>/Code/User/…
        │          │          │          │          │              │
        └──────────┴──────────┴────┬─────┴──────────┴──────────────┘
                                   │  read-only, never written to
                      ┌────────────▼────────────┐
                      │  src/core/agents/*      │  one adapter per assistant
                      │  discover() / read()    │  (contract: contract.js)
                      └────────────┬────────────┘
                                   │  raw records
                      ┌────────────▼────────────┐
                      │  src/core/extract.js    │  selectivity: what is
                      │  + *-extract.js         │  conversation, nothing else
                      └────────────┬────────────┘
                                   │  normalised messages
                      ┌────────────▼────────────┐
                      │  src/core/indexer.js    │  incremental, archive, resume
                      └────────────┬────────────┘
                                   │
                      ┌────────────▼────────────┐        ┌──────────────────────┐
                      │  src/core/db.js         │◄──────►│  src/core/archive.js │
                      │  SQLite + FTS5          │        │  what exists         │
                      └────────────┬────────────┘        │  nowhere else        │
                                   │                     └──────────────────────┘
                      ┌────────────▼────────────┐
                      │  src/main/ipc.js        │  the trust boundary
                      └────────────┬────────────┘
                                   │  named channels, validated payloads
                      ┌────────────▼────────────┐
                      │  src/preload/preload.js │  contextBridge
                      └────────────┬────────────┘
                                   │  window.api: named functions
                      ┌────────────▼────────────┐
                      │  src/renderer/*         │  sandboxed: no Node, no network
                      └─────────────────────────┘
```

---

## 2. The four layers

| Layer | Role | Forbidden |
|---|---|---|
| `src/core/` | all the logic: reading, extraction, index, archive | `require('electron')` — never |
| `src/main/` | main process: window, security, IPC channels, terminal, export | — |
| `src/preload/` | the only bridge, through `contextBridge` | no generic `invoke(channel)` |
| `src/renderer/` | the interface, sandboxed | no Node, no network, no disk |

**The direction of dependencies never reverses.** `src/core/` stays importable by a plain `node`:
that is what makes the whole data path testable without opening a window.

**One deliberate exception.** Three renderer files are pure ES modules — no DOM, no side effects
(`src/renderer/package.json` declares them `type: module`) — and the main process imports them
dynamically:

- `format.js`: escaping, Markdown rendering, who is speaking, grouping;
- `export-document.js`: a conversation laid out as Markdown or printable HTML;
- `l10n.js`: the words of the current language.

The reason is a rule of this project: **an export must credit speakers exactly as the screen does**,
and in the same words. One shared module is the only way that stays true. Those three files must
therefore never touch `window` or `document`.

---

## 3. The data path, end to end

### 3.1 One indexing pass

`Indexer.run()` (`src/core/indexer.js`):

1. **Discovery.** Each adapter enumerates its sessions and returns _descriptors_ — no content. A
   descriptor carries the `fingerprint` (“did this change?”) and the real `folderPath`.
2. **Sorting.** For each descriptor, the indexer compares the `fingerprint` with the one stored in
   the `sources` table:
   - identical → the session is skipped entirely, not one byte is read;
   - different → the adapter re-reads, resuming from the stored `cursor`.
3. **Extraction.** Raw records go through `extract.js` (Claude) or the agent’s own `*-extract.js`,
   which decides what counts as conversation.
4. **Writing.** Messages are inserted, the folder created or found, the session updated.
5. **Archive.** A session seen to have vanished is saved; a session that came back whole has its
   copy removed (§ 6).
6. **Copies.** When anything changed, `Index.markCopies()` flags every message an earlier
   conversation of the same agent already holds (§ 4). Last, because either side may have been
   read first.

Step 2 is what makes the app usable: a full pass over 74,802 rows took 13 s on 25 September 2026,
a pass with nothing changed about 80 ms while the app is running (§ 12).

### 3.2 Selectivity: why the index is ~1 % of the input

Measured twice, at two corpus sizes: 2.7 MB of conversation out of 213 MB of files, then still
**under 1 %** once the corpus had reached 646 MB. The rules:

| Block | Stored | Indexed (search) |
|---|---|---|
| text | yes | **yes** |
| reasoning (`thinking`) | yes, collapsed | no |
| tool call and tool result | preview truncated at 2000 characters | no |
| image, document | metadata only — **the base64 is discarded** | no |

`<system-reminder>` envelopes and slash-command wrappers are stripped before indexing: without that,
every session would match the contents of whichever instruction file the assistant loaded at
startup — and a search for any word in that file would return everything.

### 3.3 The adapter contract

Defined and documented in `src/core/agents/contract.js`. Three functions:

- `discover(ctx)` → descriptors;
- `read(descriptor, ctx)` → messages + a new `cursor`;
- `canResume(...)` → can the agent reopen _this_ session?

Two opaque strings carry all the resume state, and are **never interpreted by the caller**:
`fingerprint` (has it changed?) and `cursor` (where to resume). A JSONL adapter puts `size:mtime`
and a byte offset in them; a SQLite adapter would put a row id. An adapter that cannot resume
ignores the `cursor` and yields everything: correctness never depends on it, only speed does.

`ctx.memo` (`src/core/memo.js`) survives from one pass to the next: any header read must go through
it, stamped with the file’s size and mtime. That is what makes a pass with nothing changed cost one
`stat` per file. A new adapter that ignores it makes the background refresh expensive.

Three optional flags describe what an adapter's data MEANS, and each was measured before being
declared: `globalIds` (a message id is the same message wherever it appears — Claude, Codex; § 4,
copies), `usagePerSession` (the agent only writes what a whole session cost — Copilot; § 10) and,
on a descriptor, `parentId` / `continuesFrom` (a subagent, a fork; § 3.4, § 4).

**Usage limits** ride along rather than being an item of their own: any item may carry `quota`,
the windows its record read (`src/core/quota.js`), and an adapter may offer `quotas(ctx)` for
readings kept outside any conversation — Claude's last one, cached in `~/.claude.json`, and the
weeks of Claude Desktop's `plan-usage-history.json` when it is installed, placed by the week's end
that cached reading names (the week is a fixed block; its five-hour windows are not kept). The indexer
keeps one entry per window in memory and writes a conversation's windows once, never one write per
reading (Codex writes 7 133).

### 3.4 The seven adapters

| Agent | Where | Shape | What makes it different |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<encoded>/<id>.jsonl` | one record per line | `sessions-index.json` holds the only exact path; `history.jsonl` survives a purge of the transcripts |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | same | the header must be re-read for the `cwd` (hence the memo) |
| Copilot CLI | `~/.copilot/session-state/<uuid>/events.jsonl` | event log | directories with no events file do exist |
| Qwen Code | `~/.qwen/projects/<encoded>/chats/<uuid>.jsonl` | one per line | — |
| Gemini CLI | `~/.gemini/tmp/<slug>/chats/session-*.jsonl` | **a mutation log**, not a list of messages | the log must be replayed; the older `.json` files are read too |
| Antigravity CLI | `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` | one per line | the protobuf store beside it is a decoy; **no working directory is recorded**, it is derived and marked approximate |
| VS Code chat | `<config>/User/workspaceStorage/<hash>/` | `state.vscdb` (SQLite) + `chatSessions/*.jsonl` | also covers VSCodium and Cursor; `state.vscdb.backup` is never opened |

**Never decode a directory name to recover a path.** The encoding replaces every non-alphanumeric
character with `-`, which destroys accents and makes real hyphens ambiguous. `paths.decodeHint()`
exists for display, and only as a last resort.

**Subagents.** Claude Code writes each subagent's conversation to a file of its own,
`<id>/subagents/agent-<a>.jsonl` — a workflow's agents one level down, under `workflows/wf_…/` — with
an `agent-<a>.meta.json` beside it naming its task. Codex writes a rollout per subagent whose header
names `parent_thread_id`. Either way the descriptor carries `parentId`, the indexer stores it as
`sessions.parent_id` and marks every turn a sidechain — the opening one is the parent assistant's
briefing, never the person's. A subagent is not listed; it is opened from its parent. Measured on
25 September 2026: 381 Claude subagents (122 MB, 24 000 messages) and 7 Codex ones.

**The person's words, once.** Claude Code writes two echoes of them, and each is recognised by what
the file says, never by the text alone. A message typed while Claude works is queued (`enqueue`,
stored); taken off the queue (`dequeue`), it is written again as an ordinary `user` line —
`markDelivery` in `claude.js` marks the first message of the person within 32 lines of a dequeue,
the cursor carrying the wait (`d<n>`) across passes, and the indexer drops the queued copy. One
`remove`d from the queue exists nowhere else and stays. And the `last-prompt` pointer repeats the
last prompt with its blanks flattened, cut past 200 characters with "…" (`echoOf` in
`archive.js`). Measured on 25 September 2026: 219 queued copies and 90 pointers shown twice, the
pointer as the newest message, undated. A pass that reads a file from the start decides both on
what it read; only a pass resuming a file asks the database — asking every time cost half a second
of a full pass.

---

## 4. The database

`src/core/schema.sql` — six tables and a full-text index.

| Table | Holds | Worth knowing |
|---|---|---|
| `folders` | one real folder, **shared between agents** | this is the heart of the product: one row per path, whatever conversations attach to it. `path_exact` never rises back to an approximation |
| `agents` | one known assistant | — |
| `sessions` | one conversation | id `agent:session`; `source` is `transcript`, `history` or `archive`; `continues_uuid` chains a compacted conversation to the one it continues; `parent_id` hangs a subagent's conversation off the one that launched it; `continued_in` / `continues_from` link a resumed or forked conversation to the one it continues |
| `messages` | one message | `parts` as JSON; `is_notice` marks what nobody said; `is_copy` what another conversation already holds |
| `messages_fts` | full-text index | FTS5 as _external content_: only `text` goes in, the rows stay in `messages` |
| `sources` | the incrementality state | `fingerprint` and `cursor`, both opaque |
| `quota_windows` | one window of one usage limit — five hours, a week | its HIGHEST reading, first and last seen; found again by its end give or take 10 minutes (§ 10). Rebuilt from the files — and carried across that rebuild, since Claude Desktop keeps a month: the first pass puts back only the windows the files no longer give (`restoreCarriedQuotas`), so the files always win |

Three triggers keep the full-text index current on insert, delete and a change of text — except
while an **empty** index is filled whole (the first pass, the one after a schema change): they are
set aside and the index is built once at the end, 0.3 s instead of 4 s for Claude alone
(`suspendSearchIndex`). A flag in `meta` is set first, so a pass cut short is caught up when the
index is next opened. The tokeniser is
`unicode61 remove_diacritics 2`: “mathematiques” finds “Mathématiques”.

**Compaction.** Claude Code used to compact by opening a **new file**: the person lived through one
conversation, the disk held two. The `compact_boundary` record names the last message of the
previous file (`logicalParentUuid`); the index keeps it, and `db.chain()` walks back and then
forward. Measured on 25 September 2026, Claude Code now compacts **in place** — all six boundaries
on this machine name a message of their own file — so the chain links nothing today, and is kept
for the older files. The other assistants compact in place too.

**Resumes and forks are linked too**, as the files state it and on the side that writes it:
Claude Code names the NEW transcript in the old one (`continued-in` → `continued_in`), Codex names
the OLD one in the new header (`forked_from_id` → `continues_from`, but not for a subagent, whose
`forked_from_id` is its parent). `chain()` follows both, and leaves out a part made of copies alone.

**Copies.** What does open a new file now is a **resume**: the new session begins by copying the
conversation since its last compaction, same uuids, same times. Codex does the same on a fork, with
the times rewritten, and its 2025 snapshots each repeated the whole conversation before them. A
message an **earlier** conversation of the same agent already holds is flagged `is_copy` — earlier
by first line, then last, then id — and is then shown, counted and searched only where it came
from; a conversation holding nothing but copies is not listed. Only for agents whose ids are
global (`globalIds` in the contract): Copilot and Gemini number tool calls per session. The
parent/child lookups of `chain()` skip copies, or a resume would pass for the part before its own
original. Measured: 922 Claude and 1 164 Codex messages, 387 K and 419 K output tokens that were
counted twice.

**`SCHEMA_VERSION` (in `db.js`) is raised for a change of schema _or_ of extraction.** Raising it
**drops every table and rebuilds** from the agents’ own files — in about ten seconds — because an
unchanged file is skipped and would never see the new rules. That is precisely why the archive
exists.

**A new column is four places, not two, and the two extra ones are the archive’s.** Adding one to
`messages` means: the column in `schema.sql`, the `INSERT` in `db.js` (both its column list and its
`@named` parameters), **`ARCHIVE_MESSAGE_COLUMNS`**, and **`ARCHIVED_MESSAGE_DEFAULTS`**. Forgetting
either of the last two breaks the machinery whose only job is to stop conversations being lost:

- The migration reads an index written by an **older** schema, so it must never name a column of
  today’s — one that does not exist aborts the whole save, the save that runs *before* the tables
  are dropped. `archiveMessagesSql()` builds its SELECT from `PRAGMA table_info` for that reason.
  Measured the hard way when v10 added five token columns:
  `index v9 could not be read for the archive (no such column: tok_input)`.
- An archive file is **migrated, never dropped**, so one written before a column existed comes back
  without it — and a named parameter the statement expects but the row does not carry is a throw,
  not a null. Hence the defaults.

`test/db.migration.test.js` holds both cases, and both were verified to fail without the fix.

**`is_copy` is the one exception, on purpose**: it is derived after the pass, defaults to 0 on
insert, and is never archived — a restored conversation has its copies flagged again. Its update
does not touch the full-text index either: the trigger fires on `UPDATE OF text` only.

---

## 5. Search

- `src/core/query.js` turns free-form input into a valid FTS5 expression. Each word becomes a
  literal phrase, the last one gets a wildcard: typing `it's` or a lone `AND` must never raise.
- `db.search()` filters by scope (everywhere, agent, folder, conversation) and by period
  (`src/core/period.js` gives the bound, in local calendar days).
- Snippets come back with **sentinels** `\u0001` / `\u0002` around the matches, never HTML: the
  renderer escapes first, then decorates (invariant 2).
- Messages with no timestamp take, for date searches, the time of the message before them
  (`MESSAGE_TIME_SQL` in `db.js`): 83 prompts in a real corpus have none at all.

---

## 6. The archive — what exists nowhere else

`src/core/archive.js`, one JSONL file per conversation, in the user-data directory, **out of reach
of migrations**.

The index is not purely derived: the moment an agent deletes a transcript, the index holds the only
copy left. The rules, each held up by a test:

- **prompts alone never replace a whole conversation** — a deleted Claude transcript comes straight
  back from `history.jsonl` in a poorer form;
- **a pass only saves what no source offered**, and only for agents whose discovery ran to the end;
- **the migration saves before it drops**: anything not _proven_ present on disk is copied first. A
  few needless copies, never the reverse;
- **the archive format is migrated, never dropped** — version 3 removes the two echoes of § 3.4,
  and where the file's proof (`dequeue`) is gone, only a queued copy delivered within two seconds
  goes: a copy that waited longer stays twice, rather than risk a word typed once;
- **“Forget” really forgets**: `secure_delete`, FTS segment merge, `wal_checkpoint`.

---

## 7. The main process

### 7.1 Security

- Window: `contextIsolation`, `sandbox`, no Node integration.
- A CSP set on every response (`main.js`): `default-src 'none'`, `script-src 'self'`,
  `connect-src 'none'`. No remote code, no `eval`, and the window reaches nothing.
- **A link in a conversation opens in the browser, never in Ariane.** `renderMarkdown` gives an
  address only to `http(s)`, with `target="_blank"`; the click reaches `setWindowOpenHandler`, which
  always denies the window and hands the url to `shell.openExternal` only if the main process reads
  `http:` or `https:`. `will-navigate` refuses anything that is not the app's own `file:`
  (`test/links.test.js`).
- **One request exists, and only if the person asked for it** — at launch when `updateCheck` says
  so, or once when they click "Check now" in the settings, whatever the setting says: then they are
  asking.
- **The launch-time check**: `settings.json`'s `updateCheck` —
  `never` unless turned on — lets the MAIN process ask GitHub once per launch whether a newer
  version exists (`src/main/update-check.js`). It is read before anything leaves the machine, so a
  refusal makes no request at all rather than hiding its result. What comes back is a version and a
  link; nothing is downloaded and nothing is run, because no package is signed. The url opened is
  rebuilt from the manifest, never taken from the window.
- Navigation and external windows refused: a link opens in the system browser.
- **The renderer is not trusted**: every channel validates its payload (`asInt` rejects objects,
  `asId` refuses a doubtful id, only a real `true` counts as true). Handlers return `{ok, data}` or
  `{ok, error}` and never throw across the bridge.
- The shared wrapper waits for the language before answering: no reply can carry a raw message id
  in place of a sentence.

### 7.2 Launching a terminal

`src/main/terminal.js` is the only place Ariane starts a process. `spawn` with an **argument
vector** and `shell: false`, never a command string: a folder may legitimately be called
`; rm -rf ~`. Everything is checked before a window opens: the folder, the command, then the
interpreter its first line names (`#!/usr/bin/env node`). A CLI’s path can be imposed in the
settings (§ 8).

### 7.3 Exporting

`src/main/export.js` builds the document **from the index**, never from what the renderer sends (it
sends only an id and a format). The PDF is printed in an invisible window **with JavaScript
disabled**, from a page written into a private directory (0700, file 0600) and deleted immediately
afterwards: a conversation contains everything anyone ever pasted.

---

## 8. The person’s own files: settings and marks

### 8.1 The settings

`<userData>/settings.json`, described in `src/main/settings.js`. Two fields per assistant, and the
split between them **is** the design:

- `detected`: what Ariane found. Ariane rewrites it; it is a record, never an order.
- `command`: the person’s. Ariane only ever writes it from what they typed, in the file or in the
  settings window.

The app’s preferences live there too: `language` (`auto` or a language tag), `theme` (`auto`,
`light`, `dark`), `textSize` (90 to 130, absent until chosen), `hiddenAgents` (assistants hidden
from the sidebar) and `splash` (show the splash screen or not).

**The text size** (`src/main/text-size.js`, pure and tested) is applied by the main process as the
page's zoom. It is changed in the settings window or with the keys, read in `before-input-event`
so the page never sees them: Ctrl (Cmd) with `=`, `+`, `-`, `0` or the keypad — the physical key
counts too, since an AZERTY Ctrl+0 arrives as `Digit0`. An absent `textSize` means "as it was": a
zoom set before the setting existed is taken up once, not undone. There is no application menu on
Linux and Windows any more (Electron's default one, hidden and in English, carried the zoom — but
not on Ctrl+= nor the keypad — and the developer tools in every package); Ctrl+Q, Ctrl+W and F11
are kept by the same key handler. The splash reads the same keys, for quitting and closing only: it
has the keyboard at launch and no menu, and until 25 September 2026 Ctrl+Q there did nothing. macOS keeps the App, Edit and Window menus it needs for copy and
paste. The developer tools exist only outside a published package.

**The size is applied once the window is shown**, in `ready-to-show` right after `win.show()` —
never on the hidden page. Set in `did-finish-load`, while the window was still hidden, it kept
`ready-to-show` from ever firing under Windows: the splash, then nothing, not even in Alt+Tab, with
the process still running. Linux showed nothing wrong, and no suite launches `main.js`'s real
window, so it shipped; a bisection on a real Windows machine found it. It is Electron's own bug,
[#51972](https://github.com/electron/electron/issues/51972) — there since 40, fixed in 44.4.4 —
and applying after show avoids it whatever the version. A check in
`test/text-size.test.js` reads `main.js` and refuses a zoom in `did-finish-load`.

A file that cannot be read is **never rewritten**, and unknown keys are kept: it is someone’s work.

The window’s geometry is **not** here: it lives in `<userData>/window.json`
(`src/main/window-state.js`). A position changes every time a window is dragged, and machine state
has no business in a file someone opens and edits by hand. A size carries from one screen to
another, a position does not: it is only followed when it still lands on a screen that exists,
otherwise the window is centred.

### 8.2 The marks: the star and the note

`<userData>/marks.json` (`src/core/marks.js`). A star and a note per conversation, filed under the
global id `agent:sessionId`.

**This is the only thing in Ariane nobody can rebuild.** Everything else — folders, conversations,
messages — comes back from the assistants’ files in ten seconds, and `#migrate()` throws it all away
at every schema change. Favourites kept in the index would vanish at the first update; they
therefore live in their own file, out of reach, and hang off the global id because it is the only
one that survives a reindexing.

**A star on a message** poses the same problem one level down, and it has no single answer: measured
on a real corpus, 98 % of Claude’s messages carry an id of their own, 91 % of Codex’s, 74 % of
Copilot’s — and **none** of VS Code’s. A mark therefore stores several coordinates — the id if there
is one, the position, the role, the date, the opening of the text — and is resolved by the most
reliable one that still matches. The text catches a position that shifted because the extraction
changed: that is to say, exactly when the index is rebuilt.

The rules, each held up by a test that fails without it:

- a file that **cannot be read is never rewritten** — it holds someone’s words;
- unknown keys are kept, at both levels;
- an entry with neither star nor note is removed rather than stored empty;
- writes are atomic: a temporary file, then a rename;
- **“Forget” means forget**: the mark goes with the rest.

A star on a conversation the index no longer holds is **kept** — its transcript may come back — but
the “Starred” view only shows what exists.

---

## 9. Languages

`src/locales/<tag>.ftl`, in **Fluent** format (the one Firefox uses). `en.ftl` is the reference and
the fallback; **adding a language is adding a file** — `src/main/locale.js` reads the directory.

- `src/renderer/l10n.js`: the engine (a pure ES module, shared with the main process). It also
  handles dates, relative times, numbers, sizes and lists, through `Intl`.
- `src/renderer/l10n-dom.js`: `data-l10n-id` on an element gives it its text and its attributes.
- A language’s grammar lives in its own file: the code only ever passes a number.
- **Boundaries carry codes, not sentences**: the index stores `away-summary` or `failure`,
  `resume.js` returns note codes, the IPC layer returns reason codes.

---

## 10. The interface

One file leads, `src/renderer/app.js`, helped by specialised modules:

| File | Role |
|---|---|
| `format.js` | escape then decorate; who is speaking; group bursts of tool calls |
| `transcript-view.js` | paint a conversation **in slices** (120 rows at once, the rest in idle time) |
| `settings-dialog.js` | the settings window |
| `stats-view.js` | the statistics view — figures counted by `src/core/statistics.js` with the screen's own rules |
| `icons.js` | a family of icons built in the DOM — nothing to load, nothing to allow in the CSP |
| `export-document.js` | the layout of an export (shared with the main process) |

**Each reply shows what it cost**, in its head — the three figures of the sidebar's token line,
exact on hover. The count is rarely on a line that shows: in Claude, 10,095 of 19,699 counted lines
are masked reasoning, hidden by `hasContent`. So `groupMessages` gives every group it paints a
`usage`: a hidden line's count goes to the next thing the same reply shows — its prose, or its
strip of tool calls, which adds up all of them — never to the person's message or a notice, and a
count still pending when the person speaks again goes back to the reply before. None is shown
where the adapter declares `usagePerSession` (Copilot): a session's total under one reply would
read as that reply's cost. A subagent's figures say, on hover, that they are a floor.

**Its id opens the header, on a row of its own** (`#convo-id`, `flex-basis: 100%`): in the title's
column the action buttons cut it. As its assistant knows it — `bareId`, the rule the terminal
resume uses, applied in `session:get` — selectable, its meaning on hover.

**Under the title, the facts are grouped by the question they answer** (`headerFacts` in
`app.js`, chosen on screenshots on 25 September 2026): who (the assistant's mark, its name, the
models), where (the folder by its name, the whole path on hover, the git branch as a tag), when,
how many messages — each group led by an icon, never a string of dots — and on a line of its own
what the conversation cost, its figures named (`headerCost`, subagents apart; `session:get` adds
`Index.sessionTokens`, the sidebar's definition). A group wraps whole; none is cut. For that room
the header's actions are icons alone, each named on hover and for screen readers; only « Oublier »
shows its question while it waits for the second click. The layout suite measures the wrapping,
the render suite that every shown action has a name.

**Nothing counts the person's own message.** The files count per call to the model, never per
message: measured on 627 prompts, the `↑` of the call that follows one does not follow its length
(10 characters → 1 779 sent, 1 331 characters → 615) — it is the context. An estimate from the text
is possible; none is shown.

**The usage limits** have their block in the statistics view (`quotas` in `stats-view.js`): for
each assistant and limit, the latest window of each length that was still open at the latest
reading — a reading and its date, never a total — dimmed once it has ended; how often a limit was
reached; and the weeks read as columns, one measure, with their table. The columns are the windows
read, not a calendar: the caption says so, since Codex was not used every week.

**The searched word is highlighted in the conversation**, not only in the snippet: opening a result
carries the search words along (`state.searchTerms`), and they are marked wherever they appear. The
trap is the slicing — a highlight applied on opening would only ever touch the first 120 rows. The
view therefore calls back on every slice it paints (`onPaint`), and the marker is **idempotent**: it
refuses nodes already inside a `<mark>`, since the search highlight and the Ctrl+F one can both be
on at once.

Two rules hold up everything else:

1. **Escape, then decorate.** `innerHTML` is only ever fed the output of
   `renderMarkdown` / `renderSnippet`; everything else goes through `textContent`.
2. **Never put words in anyone’s mouth.** `speakerOf()` returns a role (`'you'`, `'assistant'`, or
   nothing): on a real corpus, 88 % of records with the role `user` were tool output or harness
   notices.

---

## 11. Lifecycle

1. `main.js` sets the CSP, calls `registerIpc`, then creates the window — at the size and place kept
   from the last launch — and, if the settings ask for it, the splash screen above it.
2. `registerIpc` opens the index, the archive, the memo and the settings, and **loads the language**.
3. The renderer asks for the language, localises the page, then loads the state and the tree.
4. An indexing pass runs on the first launch, or when an agent has appeared since the last one.
5. After that, a quiet pass every 30 s while the window is visible, and one when focus returns.
   Never two at once: the main process keeps the pass in flight (`state.indexing` in `ipc.js`) and
   shares it with any call that arrives while it runs.

---

## 12. What was measured

**This is where the project’s numbers live.** The other documents point here rather than copying
them: the corpus grows every day, and three documents have already carried three different totals.

### The suites, measured by the CI on 25 September 2026

| | Unit | Renderer | Layout | Splash | Network |
|---|---|---|---|---|---|
| linux | 918 / 918 | 220 | 29 | 7 | 7 |
| macos | 918 / 918 | 220 | 29 | 7 | 7 |
| windows | 902 / 903 | 220 | 29 | 7 | 7 |

Windows runs fifteen fewer and counts one without passing it: the `POSIX_ONLY` skips in
`terminal.test.js`, declared with their reason — execute bits, shebang lines, executables with no
extension. A stated abstention, not a hole.

**Do not copy these figures elsewhere.** Four documents have already carried three different totals,
which is what this section exists to stop.

### Coverage, 25 September 2026

`npm run test:coverage` — **97.07 % of lines, 88.67 % of branches, 94.99 % of functions.**

**It has a floor, and the CI enforces it**: the script itself states `--test-coverage-lines=96`,
`--test-coverage-branches=87` and `--test-coverage-functions=94`, so it fails below them — locally
and on the Linux CI run, which uses it in place of `npm test` and writes the table into the run's
summary on GitHub. Nothing is sent to a third party. Raise the floor when the figures rise; lowering
it is a decision, not a fix.

**It measures the unit suite alone.** The four Electron suites are not counted, so a file exercised
only by them reads low: `src/main/update-check.js` shows 62 % because `electronRequest` — the one
function in Ariane that speaks to the network — is covered by `test/ui/net.test.js`, which the
coverage run does not see. Read the figure as "what `npm test` proves", not as "what is tested".

The corpus, measured on **20 September 2026** on the development machine:

| Assistant | Conversations | On disk | Prose |
|---|---:|---:|---:|
| Codex | 222 | 398 MB | 2.5 MB |
| Claude Code | 70 | 370 MB | 3.1 MB |
| Gemini CLI | 20 | 6 MB | 0.18 MB |
| Copilot CLI | 18 | 6 MB | 0.18 MB |
| VS Code chat | 14 | 403 MB | 0.17 MB |
| Antigravity CLI | 15 | 49 MB | 0.13 MB |
| Qwen Code | 0 | 1 MB | — |
| **total** | **359** | **≈ 1.25 GB** | **6.2 MB** |

**44,081 messages, 52 folders** — read from the index itself on the day. Prose weighs **half a per
cent** of what is read. These numbers move constantly: the index gained messages during the
measurement itself, those of the conversation writing it.

The timings below date from **19 September 2026**, when the corpus held 342 conversations and
38,691 messages.

| Measure | Value | Where |
|---|---|---|
| full pass | ≈ 10 s | six agents |
| pass with nothing changed | ≈ 60 ms (app open), ≈ 420 ms (first pass) | thanks to `memo.js` |
| share of the input that is conversation | 2.7 MB out of 213 MB | `extract.js` |
| largest conversation | 6,642 messages | opening: 840 ms → **13 ms** in slices |
| PDF export | 400 messages → 51 A4 pages in 0.8 s | without freezing the app |

**On 25 September 2026** the index held 74,802 rows — 48,660 in the conversations the sidebar lists,
24,172 from subagents, 2,086 copies — and a full pass took **30 s**, then **13 s**. Reading and
interpreting the files was never the cost (2.6 s of Claude's 17.8): SQLite's journal was. It was
copied into the database, and the disk waited on, every 4 MB — about a hundred times per rebuild,
since each page is written some four times (475 MB through the journal for a 117 MB index). Now:
every 64 MB (journal peak 68 MB), emptied after each pass that wrote, and the full-text index built
once when an empty index is filled. The pass with nothing changed stayed at about 80 ms.
| coverage of `terminal.js` | 95.5 % of lines | the only file that starts a process |

These figures come from measurements, not estimates. Measure them again rather than copying them.

---

## 13. The native binding, and the trap that used to cost the most

`better-sqlite3` is a native module, and for a long time that was the most expensive fact in this
repository. Electron and the Node that runs the tests exposed different `NODE_MODULE_VERSION`s, and
loading the wrong binary is not a catchable error: the process dies on a `SIGILL`, with no exception
and no message. Two binaries had to be compiled and cached, one per runtime. The packager had to be
watched, because it shipped whatever `node_modules` happened to hold — and twice it shipped
something wrong: an ELF inside `Ariane.exe`, then ABI 127 inside an Electron `.deb` that installed,
opened, and died on the first query. `src/core/binding.js`, `scripts/save-binding.js`,
`scripts/native-prebuild.js` and `build/after-pack.js` existed for that, and for nothing else.

**`better-sqlite3` 13 moved to Node-API, and the whole problem left with it.** A Node-API binary is
not tied to a `NODE_MODULE_VERSION` but to a Node-API level, which every runtime keeps compatible.
One file per system, `prebuilds/<platform>-<arch>.node`, picked by the library itself at load time:
nothing here selects anything, and there is nothing to rebuild after an `npm install` or an Electron
bump. There is no `postinstall` any more, and no C++ compiler is needed to work on Ariane — on Linux,
npm still runs an implicit `node-gyp rebuild`, so `python3` and `make` must exist, but they build
nothing.

The published package carries a binary for every system it supports, so a package built for another
one is right by construction: `--win` from Linux ships `win32-x64.node` because that file was
already sitting in `node_modules`. Neither of the two failures above can happen again.

What replaced the trap is a floor, and it is the only thing left to remember:

| runtime | Node-API | verdict |
| --- | --- | --- |
| Node 22.13 and below | 9 | segfaults on the first `new Database()` |
| **Node 22.14+** | 10 | supported |
| Electron 33 | 9 | unusable |
| **Electron 44+** | 10 | supported |

The floor is a real one and it bites quietly: `better-sqlite3` declares `engines: node >= 22`, which
is too generous — 22.12 satisfies it and still dies. `package.json` states the version that actually
works, `>= 22.14`.

The design that is gone, and the two packages it shipped wrong, are kept in `CHANGELOG.md`.

---

## 14. The tests

| Suite | Command | What it catches that the others cannot |
|---|---|---|
| unit | `npm test` | the logic, against a throwaway real `~/.claude` (`test/helpers/fixture.js`) — streaming, offsets and parsing genuinely exercised |
| renderer | `npm run test:render` | what lives in the DOM: speaker attribution, slicing, search, export, settings, the pseudo-language |
| layout | `npm run test:ui` | computed CSS and scroll geometry (the `min-height: auto` trap) |
| splash | `npm run test:splash` | a page that opens before everything else: its three ways out, its sentences coming from the bridge, and that it reaches nothing else |
| hygiene | included in `npm test` | raw control bytes in sources, language catalogues that drifted apart |

The Electron suites exist because the worst defect this project ever had — crediting the person with
the output of `git status` — passed every unit test of `speakerOf()` while the screen got it wrong.

---

## 15. Where to change what

| I want to… | File |
|---|---|
| add an assistant | a module under `src/core/agents/`, then `agents/index.js`; read `contract.js` first |
| change what gets indexed | `extract.js` or the agent’s `*-extract.js`, **and raise `SCHEMA_VERSION`** |
| add a column to `messages` | `schema.sql`, the `INSERT` in `db.js`, **and both archive constants** — see § 4 |
| touch the text size or the keys | `src/main/text-size.js` (the rules), `main.js` (applying them — once the window is shown, never before), `textSize` in `settings.js` |
| touch what a reply shows it cost | `groupMessages` / `sumUsage` in `format.js` (the grouping), `replyCost` in `app.js` (the display), `usagePerSession` on the adapter |
| touch subagents | discovery in `claude.js` (`discoverSubagents`) and `codex.js` (the header), `parentId` in the contract, `LISTED` and `Index.subagents` in `db.js`, `paintSubagents` in `app.js` |
| touch what counts as the person's echo | `markDelivery` in `claude.js` (the queue), `deliversQueued` in `indexer.js`, `echoOf` in `archive.js` (the `last-prompt` shape) |
| touch what counts as a copy | `Index.markCopies` in `db.js` (the rule), `globalIds` on the adapter (who it applies to), `OWN_MESSAGES` (what is listed) |
| touch marks | `src/core/marks.js`; they live in `marks.json`, never in the index |
| add a sentence on screen | `src/locales/en.ftl` **and every other file**; never in the code |
| add a language | drop in `src/locales/<tag>.ftl`; nothing else |
| add an IPC channel | `src/main/ipc.js` (+ the `CHANNELS` list), then `src/preload/preload.js` |
| touch search | `src/core/query.js` (the expression), `db.search` (the filters), `app.js` (the display) |
| touch export | `src/renderer/export-document.js` (layout), `src/main/export.js` (file, PDF) |
| change how a CLI is found | `src/main/terminal.js`, remembering that the settings win |
| touch the usage limits | `src/core/quota.js` (what a reading says, what a window keeps), `recordQuotas` / `quotas` in `db.js`, `quotas` in `stats-view.js` |
| change the statistics | `src/core/statistics.js` (counting — it takes `speakerOf` from format.js, never its own), `db.statisticsRows` (the rows), `stats-view.js` (the layout) |
| change how Markdown renders | `renderMarkdown` in `src/renderer/format.js`, its style in `styles.css` **and** in `export-document.js` (paper); compare old and new on the whole corpus |
| touch the update check | `src/core/update.js` (comparing), `src/main/update-check.js` (asking), `app.js` (the button) |
