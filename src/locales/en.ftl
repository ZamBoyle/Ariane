### Ariane — English. The reference: every other language has exactly these
### messages, and falls back to this file for any it lacks.
###
### Format: Project Fluent (https://projectfluent.org). A message is
### `id = text`; `{ $name }` is a value the app fills in; `.name = text` is an
### attribute (a tooltip, an accessible name, a placeholder). Plurals and any
### other variation are written HERE, per language:
###
###     count = { $n ->
###         [one] { $n } conversation
###        *[other] { $n } conversations
###     }
###
### Keep every { $variable } of a message; reword everything else freely.

# The name of this language, in this language: shown in the language list.
language-name = English

## Keyboard keys, as printed on this language's keyboards

key-ctrl = Ctrl
key-alt = Alt
key-esc = Esc

## The window's frame

# The splash screen, and the only sentence it shows.
splash-hide = Do not show this screen at startup
splash-continue = Continue
sidebar =
    .aria-label = Folders and conversations
home-button = Ariane
    .title = Back to the start page (Esc)
settings-button =
    .title = Settings: where to find each assistant
    .aria-label = Open the settings
refresh-button =
    .title = Re-index (Ctrl+R)
    .aria-label = Re-index the conversations
folder-filter =
    .placeholder = Filter folders…
    .aria-label = Filter folders and conversations
agent-filter =
    .aria-label = Assistants shown
agents-show-all = Show all
    .title = Show every assistant again
tree =
    .aria-label = Conversation tree
tree-loading = Loading…
outline =
    .aria-label = Your messages in this conversation

## The start page

welcome-title = Your past conversations
welcome-lead = Pick a folder on the left, or search straight away in the bar below.
welcome-key-search = search
welcome-key-find = in the conversation
welcome-key-own = your messages
welcome-key-reindex = re-index
welcome-key-home = home

## The folder list

# { $dir } is the directory where Claude Code keeps its data.
tree-no-data = No Claude Code folder found in { $dir }.
tree-no-match = No folder matches.
tree-empty = No conversations.
# Added under a folder's path, in its tooltip.
folder-purged-note = (transcripts purged — prompts only)
folder-approximate-note = (approximate path — rebuilt from the folder's name)
session-untitled = Untitled
session-badge-saved = saved
    .title = The original file is gone: Ariane keeps the only copy
session-badge-prompts = prompts
    .title = Transcript purged: only your prompts remain
# { $when } is already written out: "3 days ago", "12 Sept 2026".
session-summary = { $when } · { $count ->
        [one] { $count } message
       *[other] { $count } messages
    }

# Under a conversation whose assistant recorded what its turns cost.
# { $sent }, { $received } and { $cached } are already shortened ("7.5K",
# "14.5M"); the *Exact ones are written out in full. The arrows are sent and received.
session-tokens = ↑ { $sent } · ↓ { $received }
    .title =
        Sent: { $sentExact } tokens new in the prompts
        Received: { $receivedExact } tokens
session-tokens-cached = ↑ { $sent } · ↓ { $received } · cache { $cached }
    .title =
        Sent: { $sentExact } tokens new in the prompts
        Received: { $receivedExact } tokens
        Read back from the cache: { $cachedExact } tokens, the context resent at every turn

## The footer, and indexing

stats = { $folders ->
        [one] { $folders } folder
       *[other] { $folders } folders
    } · { $sessions ->
        [one] { $sessions } conversation
       *[other] { $sessions } conversations
    } · { $messages ->
        [one] { $messages } message
       *[other] { $messages } messages
    }
stats-indexing = indexing { $done }…
# { $agent } is an assistant's name, e.g. "Codex".
stats-indexing-agent = { $agent } · indexing { $done }…
# { $details } is a list of the parts below, e.g. "3 transcripts read and 1 conversation saved".
refresh-done = Indexing done — { $details }.
refresh-up-to-date = Index already up to date.
refresh-read = { $n ->
        [one] { $n } transcript read
       *[other] { $n } transcripts read
    }
refresh-orphans = { $n ->
        [one] { $n } recovered from the history
       *[other] { $n } recovered from the history
    }
refresh-saved = { $n ->
        [one] { $n } conversation saved
       *[other] { $n } conversations saved
    }
refresh-restored = { $n ->
        [one] { $n } conversation restored
       *[other] { $n } conversations restored
    }
refresh-errors = { $n ->
        [one] { $n } error
       *[other] { $n } errors
    }
auto-saved = { $n ->
        [one] Ariane saved { $n } conversation whose original file disappeared.
       *[other] Ariane saved { $n } conversations whose original files disappeared.
    }

## An open conversation

convo-empty = This conversation holds no message that can be shown.
convo-not-found = Conversation not found.
convo-message-count = { $n ->
        [one] { $n } message
       *[other] { $n } messages
    }
convo-part = Part { $n } of { $total }
    .title = This conversation was compacted: it goes on in another transcript
convo-part-previous =
    .title = Previous part
    .aria-label = Go to the previous part
convo-part-next =
    .title = Next part
    .aria-label = Go to the next part
convo-purged = transcript purged
convo-saved = saved by Ariane: the original file is gone
speaker-you = You
order-button =
    .title = Reverse the order of messages
order-newest = Newest at the top
order-oldest = Oldest at the top
export-button = Export
    .title = Save this conversation to a file
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = Copy
    .title = Copy the resume command
open-folder-button = Open the folder
folder-gone = This folder no longer exists on disk.
forget-button = Forget
    .title = Permanently erase the copy Ariane keeps of this conversation
forget-confirm = Forget for good?
forget-done = Conversation forgotten: Ariane keeps nothing of it any more.
export-preparing-pdf = Preparing the PDF…
export-done = Exported: { $path }
message-copy = Copy this message
message-copied = Message copied

## Inside a message

part-thinking = Reasoning
part-tool = Tool
part-result = Result
part-error = error
part-pasted = Pasted
part-pasted-lines = { $n ->
        [one] { $n } line
       *[other] { $n } lines
    }
part-image = Image
part-document = Document
part-empty = (empty)
tool-run-calls = { $n ->
        [one] { $n } tool call
       *[other] { $n } tool calls
    }
tool-run-results = { $n ->
        [one] { $n } result
       *[other] { $n } results
    }
tool-run-attachments = { $n ->
        [one] { $n } attachment
       *[other] { $n } attachments
    }
tool-errors = { $n ->
        [one] { $n } error
       *[other] { $n } errors
    }
# A strip of tool calls, in an export: "2 tool calls: Bash, Read".
tool-summary-named = { $summary }: { $names }
tool-summary-errors = { $summary } — { $errors }

## Notices: the tool or the harness speaking, not the person nor the assistant

notice-away-summary = Session summary
notice-compact-boundary = Conversation compacted
notice-failure = Failure
notice-cancelled = Request cancelled
notice-subagent = Subagent
notice-generic = Notice

## Searching within the open conversation

find-input =
    .placeholder = Search this conversation…
    .aria-label = Search this conversation
find-count =
    .title = The message found, out of all those that contain this text
find-none = none
find-previous =
    .title = Previous (Shift+Enter)
    .aria-label = Previous match
find-next =
    .title = Next (Enter)
    .aria-label = Next match
find-close =
    .title = Close (Esc)
    .aria-label = Close the search

## Resuming a conversation in its own terminal

resume-button = Resume
resume-button-latest = Resume (latest)
resume-opens = Opens a terminal: { $command }
resume-note-latest-only = Gemini can only resume by index or “latest”, not by id.
resume-note-unsupported = VS Code does not let a conversation be reopened; only its folder can be opened.
resume-opened = Terminal opened ({ $terminal }).
resume-opened-settings-ignored = Terminal opened ({ $terminal }), without following the settings: { $problem }
resume-no-terminal = No terminal found.
resume-folder-missing = This conversation's folder no longer exists.
resume-command-not-found = Ariane cannot find “{ $command }” on this machine.
resume-setting-not-absolute = Settings: the path for “{ $command }” must be absolute ({ $path }).
resume-setting-unusable = Settings: { $path } is not a program.
resume-interpreter-not-found = “{ $command }” needs “{ $interpreter }”, which cannot be found.
resume-failed = Could not open a terminal ({ $reason }).
# { $reason } is one of the sentences above.
resume-failed-copied = { $reason } Command copied.
command-copied = Command copied.
open-settings-action = Open the settings

## The search bar

results =
    .aria-label = Search results
search-input =
    .placeholder = Search your conversations…
    .aria-label = Search the conversations
scope-select =
    .aria-label = Search scope
    .title = Where to search
scope-all = Everywhere
scope-folder = Folder: { $name }
scope-folder-current = Folder: current
scope-session = This conversation
period-select =
    .aria-label = Search period
    .title = When
period-all = All dates
period-7d = Last 7 days
period-30d = Last 30 days
period-year = This year
results-count = { $n ->
        [one] { $n } result
       *[other] { $n } results
    }
results-none = No results.
results-none-7d = No results in the last 7 days.
results-none-30d = No results in the last 30 days.
results-none-year = No results this year.

## The settings window

settings-title = Settings
settings-lead = Where to find each assistant's command, for “Resume”. Leave a path empty to let Ariane look for it.
settings-language = Language
settings-language-auto = Automatic — { $language }
settings-language-select =
    .aria-label = Language of the app
settings-theme = Theme
settings-theme-select =
    .aria-label = Colour theme of the app
settings-theme-auto = System
settings-theme-light = Light
settings-theme-dark = Dark
settings-updates = Updates
settings-updates-select =
    .aria-label = Whether Ariane may ask if a newer version exists
settings-updates-never = Never ask
settings-updates-startup = At startup
update-available = Ariane { $version } is available.
update-open = See the release
update-close =
    .aria-label = Dismiss
settings-add = Add an assistant
settings-add-menu =
    .aria-label = Assistants to add
settings-open-json = Open the JSON file
settings-cancel = Cancel
settings-save = Save
settings-sessions = { $n ->
        [0] no conversations
        [one] { $n } conversation
       *[other] { $n } conversations
    }
settings-detected = Found: { $path }
settings-not-detected = Automatic search does not find it.
settings-path-label = Path to use
settings-path-input =
    .placeholder = Empty: Ariane looks for it
    .aria-label = Path to use for { $agent }
settings-browse = Browse…
    .aria-label = Browse for { $agent }
settings-check-pending = Checking…
settings-check-chosen = Used as is: { $path }
settings-check-detected = Ariane will use: { $path }
settings-check-not-found = Not found on this machine: enter its path.
settings-check-not-absolute = The path must be absolute.
settings-check-unusable = { $path } is not a program.
settings-check-interpreter = Found, but it needs “{ $interpreter }”, which cannot be found.
settings-check-refused = Path refused: { $detail }.
settings-unreadable = The settings file cannot be read ({ $error }). Ariane will not rewrite it: open it to fix it.
settings-saved = Settings saved.
settings-opened = Settings opened in your editor.
settings-opened-at = Settings: { $path }
settings-opened-unreadable = Settings opened, but they cannot be read: { $error }

## Stars and notes: the person's own marks on a conversation

mark-favorite = Star this conversation
mark-favorite-on = Starred — click to remove
mark-message = Star this message
mark-message-on = Starred — click to remove
mark-note = Note
    .title = Write a note about this conversation
mark-note-input =
    .placeholder = Why this one matters…
    .aria-label = Note about this conversation
mark-note-saved = Note saved
favorites-view = Starred
    .title = Every conversation you starred
favorites-conversations = Conversations
favorites-messages = Messages
# The excerpt of a starred message, in this language's quotation marks.
favorites-quote = “{ $text }”
favorites-empty = Nothing starred yet. The star at the top of a conversation keeps it here.
error-marks-unreadable = The stars and notes file cannot be read, so nothing was written: { $error }

## The settings file itself: written at the top of settings.json, for whoever opens it

settings-file-intro = Where Ariane finds each assistant's command, for “Resume”.
settings-file-detected = “detected”: what Ariane found on its own. Updated whenever this file is opened.
settings-file-command = “command”: leave it empty to let Ariane look; put an absolute path to impose that one.
settings-file-example = Example, for codex: { $example }
settings-file-paths = ~ stands for your home folder.
settings-file-paths-windows = Write paths with forward slashes /. %APPDATA% and ~ are understood.
settings-file-language = “language”: “auto” to follow the system, or a language code such as “en” or “fr”.
settings-file-theme = “theme”: “auto” to follow the system, or “light” or “dark”.

## Errors the app reports

error-forget-not-saved = Only a conversation saved by Ariane can be forgotten: the others live in their assistant's files.
error-message-not-found = Message not found.
error-resume-impossible = This conversation cannot be resumed ({ $reason }).
error-settings-unreadable = The settings cannot be read, so nothing was written: { $error }
browse-title = Where is { $agent }?

## Exports: a conversation written to a Markdown file or printed to PDF

export-dialog-title = Export the conversation
export-file-name = conversation
# "Folder: /home/ada/project" — the separator differs between languages.
export-field = { $label }: { $value }
export-field-assistant = Assistant
export-field-folder = Folder
export-field-branch = Branch
export-field-period = Period
export-field-messages = Messages
export-period = from { $from } to { $to }
export-order-newest = newest to oldest
export-order-oldest = oldest to newest
export-messages = { $count }, { $order }
export-saved = Saved by Ariane: the original file is gone.
export-footer = Exported from Ariane.
export-footer-at = Exported from Ariane on { $date }.
