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

Step 2 is what makes the app usable: a full pass over 342 conversations takes about 10 s, a pass
with nothing changed about 60 ms while the app is running.

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

---

## 4. The database

`src/core/schema.sql` — five tables and a full-text index.

| Table | Holds | Worth knowing |
|---|---|---|
| `folders` | one real folder, **shared between agents** | this is the heart of the product: one row per path, whatever conversations attach to it. `path_exact` never rises back to an approximation |
| `agents` | one known assistant | — |
| `sessions` | one conversation | id `agent:session`; `source` is `transcript`, `history` or `archive`; `continues_uuid` chains a compacted conversation to the one it continues |
| `messages` | one message | `parts` as JSON; `is_notice` marks what nobody said |
| `messages_fts` | full-text index | FTS5 as _external content_: only `text` goes in, the rows stay in `messages` |
| `sources` | the incrementality state | `fingerprint` and `cursor`, both opaque |

Three triggers keep the full-text index current on insert, delete and update. The tokeniser is
`unicode61 remove_diacritics 2`: “mathematiques” finds “Mathématiques”.

**Compaction.** Claude Code compacts by opening a **new file**: the person lived through one
conversation, the disk holds two. The `compact_boundary` record names the last message of the
previous file (`logicalParentUuid`); the index keeps it, and `db.chain()` walks back and then
forward. The other assistants compact in place — measured — and are unaffected.

**`SCHEMA_VERSION` (in `db.js`) is raised for a change of schema _or_ of extraction.** Raising it
**drops every table and rebuilds** from the agents’ own files — in about ten seconds — because an
unchanged file is skipped and would never see the new rules. That is precisely why the archive
exists.

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
- **the archive format is migrated, never dropped**;
- **“Forget” really forgets**: `secure_delete`, FTS segment merge, `wal_checkpoint`.

---

## 7. The main process

### 7.1 Security

- Window: `contextIsolation`, `sandbox`, no Node integration.
- A CSP set on every response (`main.js`): `default-src 'none'`, `script-src 'self'`,
  `connect-src 'none'`. No remote code, no `eval`, no network.
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
`light`, `dark`), `hiddenAgents` (assistants hidden from the sidebar) and `splash` (show the splash
screen or not). A file that cannot be read is **never rewritten**, and unknown keys are kept: it is
someone’s work.

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
| `icons.js` | a family of icons built in the DOM — nothing to load, nothing to allow in the CSP |
| `export-document.js` | the layout of an export (shared with the main process) |

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
| add a sentence on screen | `src/locales/en.ftl` **and every other file**; never in the code |
| add a language | drop in `src/locales/<tag>.ftl`; nothing else |
| add an IPC channel | `src/main/ipc.js` (+ the `CHANNELS` list), then `src/preload/preload.js` |
| touch search | `src/core/query.js` (the expression), `db.search` (the filters), `app.js` (the display) |
| touch export | `src/renderer/export-document.js` (layout), `src/main/export.js` (file, PDF) |
| change how a CLI is found | `src/main/terminal.js`, remembering that the settings win |
