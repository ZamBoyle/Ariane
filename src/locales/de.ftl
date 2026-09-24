### Ariane — Deutsch.
### Eine erste Übersetzung, die noch von einer Muttersprachlerin oder einem
### Muttersprachler geprüft werden sollte.
###
### Format: Project Fluent (https://projectfluent.org). Siehe en.ftl, die
### Referenz: dieselben Nachrichten, dieselben { $variables }.

language-name = Deutsch

## Tasten, so wie sie auf den Tastaturen dieser Sprache stehen

key-ctrl = Strg
key-alt = Alt
key-esc = Esc

## Der Fensterrahmen

splash-hide = Diesen Bildschirm beim Start nicht mehr anzeigen
splash-continue = Weiter
sidebar =
    .aria-label = Ordner und Unterhaltungen
home-button = Ariane
    .title = Zurück zur Startseite (Esc)
settings-button =
    .title = Einstellungen: wo die einzelnen Assistenten zu finden sind
    .aria-label = Einstellungen öffnen
refresh-button =
    .title = Neu indizieren (Strg+R)
    .aria-label = Unterhaltungen neu indizieren
folder-filter =
    .placeholder = Ordner filtern…
    .aria-label = Ordner und Unterhaltungen filtern
agent-filter =
    .aria-label = Angezeigte Assistenten
agents-show-all = Alle anzeigen
    .title = Wieder alle Assistenten anzeigen
tree =
    .aria-label = Baumansicht der Unterhaltungen
tree-loading = Wird geladen…
outline =
    .aria-label = Ihre Nachrichten in dieser Unterhaltung

## Die Startseite

welcome-title = Ihre bisherigen Unterhaltungen
welcome-lead = Wählen Sie links einen Ordner oder suchen Sie gleich in der Leiste unten.
welcome-key-search = suchen
welcome-key-find = in der Unterhaltung
welcome-key-own = Ihre Nachrichten
welcome-key-reindex = neu indizieren
welcome-key-home = Startseite

## Die Ordnerliste

tree-no-data = Kein Claude-Code-Ordner in { $dir } gefunden.
tree-no-match = Kein Ordner passt.
tree-empty = Keine Unterhaltungen.
folder-purged-note = (Transkripte gelöscht — nur Prompts)
folder-approximate-note = (ungefährer Pfad — aus dem Ordnernamen rekonstruiert)
session-untitled = Ohne Titel
session-badge-saved = gesichert
    .title = Die Originaldatei ist weg: Ariane hat die einzige Kopie
session-badge-prompts = Prompts
    .title = Transkript gelöscht: Nur Ihre Prompts sind noch da
session-summary = { $when } · { $count ->
        [one] { $count } Nachricht
       *[other] { $count } Nachrichten
    }

session-models = { $model } +{ $more }
session-tokens = ↑ { $sent } · ↓ { $received }
    .title =
        Gesendet: { $sentExact } neue Tokens in den Prompts
        Empfangen: { $receivedExact } Tokens
session-tokens-cached = ↑ { $sent } · ↓ { $received } · Cache { $cached }
    .title =
        Gesendet: { $sentExact } neue Tokens in den Prompts
        Empfangen: { $receivedExact } Tokens
        Aus dem Cache gelesen: { $cachedExact } Tokens – der Kontext, der in jeder Runde erneut gesendet wird

## Die Fußzeile, und die Indizierung

stats = { $folders ->
        [one] { $folders } Ordner
       *[other] { $folders } Ordner
    } · { $sessions ->
        [one] { $sessions } Unterhaltung
       *[other] { $sessions } Unterhaltungen
    } · { $messages ->
        [one] { $messages } Nachricht
       *[other] { $messages } Nachrichten
    }
stats-indexing = Indizierung { $done }…
stats-indexing-agent = { $agent } · Indizierung { $done }…
refresh-done = Indizierung abgeschlossen — { $details }.
refresh-up-to-date = Index bereits aktuell.
refresh-read = { $n ->
        [one] { $n } Transkript gelesen
       *[other] { $n } Transkripte gelesen
    }
refresh-orphans = { $n ->
        [one] { $n } aus dem Verlauf zurückgeholt
       *[other] { $n } aus dem Verlauf zurückgeholt
    }
refresh-saved = { $n ->
        [one] { $n } Unterhaltung gesichert
       *[other] { $n } Unterhaltungen gesichert
    }
refresh-restored = { $n ->
        [one] { $n } Unterhaltung wiederhergestellt
       *[other] { $n } Unterhaltungen wiederhergestellt
    }
refresh-errors = { $n ->
        [one] { $n } Fehler
       *[other] { $n } Fehler
    }
auto-saved = { $n ->
        [one] Ariane hat { $n } Unterhaltung gesichert, deren Originaldatei verschwunden ist.
       *[other] Ariane hat { $n } Unterhaltungen gesichert, deren Originaldateien verschwunden sind.
    }

## Eine geöffnete Unterhaltung

convo-empty = Diese Unterhaltung enthält keine Nachricht, die sich anzeigen lässt.
convo-not-found = Unterhaltung nicht gefunden.
convo-message-count = { $n ->
        [one] { $n } Nachricht
       *[other] { $n } Nachrichten
    }
convo-part = Teil { $n } von { $total }
    .title = Diese Unterhaltung wurde komprimiert: Sie wird in einem weiteren Transkript fortgesetzt
convo-part-previous =
    .title = Vorheriger Teil
    .aria-label = Zum vorherigen Teil springen
convo-part-next =
    .title = Nächster Teil
    .aria-label = Zum nächsten Teil springen
convo-copied = { $count ->
    [one] Dieses Gespräch begann mit der Kopie einer Nachricht aus „{ $title }“: Sie steht dort und wird hier nicht wiederholt.
   *[other] Dieses Gespräch begann mit der Kopie von { $count } Nachrichten aus „{ $title }“: Sie stehen dort und werden hier nicht wiederholt.
}
convo-copied-open = Original öffnen
convo-purged = Transkript gelöscht
convo-saved = von Ariane gesichert: Die Originaldatei ist weg
speaker-you = Sie
order-button =
    .title = Reihenfolge der Nachrichten umkehren
order-newest = Neueste oben
order-oldest = Älteste oben
export-button = Exportieren
    .title = Diese Unterhaltung in einer Datei speichern
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = Kopieren
    .title = Befehl zum Fortsetzen kopieren
open-folder-button = Ordner öffnen
folder-gone = Dieser Ordner existiert nicht mehr auf dem Datenträger.
forget-button = Vergessen
    .title = Die Kopie, die Ariane von dieser Unterhaltung aufbewahrt, endgültig löschen
forget-confirm = Endgültig vergessen?
forget-done = Unterhaltung vergessen: Ariane bewahrt nichts mehr davon auf.
export-preparing-pdf = PDF wird vorbereitet…
export-done = Exportiert: { $path }
message-copy = Diese Nachricht kopieren
message-copied = Nachricht kopiert

## In einer Nachricht

part-thinking = Gedankengang
part-tool = Tool
part-result = Ergebnis
part-error = Fehler
part-pasted = Eingefügt
part-pasted-lines = { $n ->
        [one] { $n } Zeile
       *[other] { $n } Zeilen
    }
part-image = Bild
part-document = Dokument
part-empty = (leer)
tool-run-calls = { $n ->
        [one] { $n } Tool-Aufruf
       *[other] { $n } Tool-Aufrufe
    }
tool-run-results = { $n ->
        [one] { $n } Ergebnis
       *[other] { $n } Ergebnisse
    }
tool-run-attachments = { $n ->
        [one] { $n } Anhang
       *[other] { $n } Anhänge
    }
tool-errors = { $n ->
        [one] { $n } Fehler
       *[other] { $n } Fehler
    }
tool-summary-named = { $summary }: { $names }
tool-summary-errors = { $summary } — { $errors }

## Hinweise: Hier spricht das Tool oder die Umgebung, weder die Person noch der Assistent

notice-away-summary = Sitzungszusammenfassung
notice-compact-boundary = Unterhaltung komprimiert
notice-failure = Fehlschlag
notice-cancelled = Anfrage abgebrochen
notice-subagent = Subagent
notice-generic = Hinweis

## Suchen in der geöffneten Unterhaltung

find-input =
    .placeholder = In dieser Unterhaltung suchen…
    .aria-label = In dieser Unterhaltung suchen
find-count =
    .title = Die gefundene Nachricht, von allen, die diesen Text enthalten
find-none = keine
find-previous =
    .title = Vorherige (Umschalt+Eingabe)
    .aria-label = Vorheriger Treffer
find-next =
    .title = Nächste (Eingabe)
    .aria-label = Nächster Treffer
find-close =
    .title = Schließen (Esc)
    .aria-label = Suche schließen

## Eine Unterhaltung in einem eigenen Terminal fortsetzen

resume-button = Fortsetzen
resume-button-latest = Fortsetzen (letzte)
resume-opens = Öffnet ein Terminal: { $command }
resume-note-latest-only = Gemini kann nur per Index oder „latest“ fortsetzen, nicht per ID.
resume-note-unsupported = VS Code erlaubt nicht, eine Unterhaltung erneut zu öffnen; nur ihr Ordner lässt sich öffnen.
resume-opened = Terminal geöffnet ({ $terminal }).
resume-opened-settings-ignored = Terminal geöffnet ({ $terminal }), ohne die Einstellungen zu befolgen: { $problem }
resume-no-terminal = Kein Terminal gefunden.
resume-folder-missing = Der Ordner dieser Unterhaltung existiert nicht mehr.
resume-command-not-found = Ariane findet „{ $command }“ auf diesem Rechner nicht.
resume-setting-not-absolute = Einstellungen: Der Pfad für „{ $command }“ muss absolut sein ({ $path }).
resume-setting-unusable = Einstellungen: { $path } ist kein Programm.
resume-interpreter-not-found = „{ $command }“ benötigt „{ $interpreter }“, das nicht zu finden ist.
resume-failed = Terminal konnte nicht geöffnet werden ({ $reason }).
resume-failed-copied = { $reason } Befehl kopiert.
command-copied = Befehl kopiert.
open-settings-action = Einstellungen öffnen

## Die Suchleiste

results =
    .aria-label = Suchergebnisse
search-input =
    .placeholder = Ihre Unterhaltungen durchsuchen…
    .aria-label = Die Unterhaltungen durchsuchen
scope-select =
    .aria-label = Suchbereich
    .title = Wo suchen
scope-all = Überall
scope-folder = Ordner: { $name }
scope-folder-current = Ordner: aktueller
scope-session = Diese Unterhaltung
period-select =
    .aria-label = Suchzeitraum
    .title = Wann
period-all = Gesamter Zeitraum
period-7d = Letzte 7 Tage
period-30d = Letzte 30 Tage
period-year = Dieses Jahr
results-count = { $n ->
        [one] { $n } Ergebnis
       *[other] { $n } Ergebnisse
    }
results-none = Keine Ergebnisse.
results-none-7d = Keine Ergebnisse in den letzten 7 Tagen.
results-none-30d = Keine Ergebnisse in den letzten 30 Tagen.
results-none-year = Keine Ergebnisse in diesem Jahr.

## Das Einstellungsfenster

settings-title = Einstellungen
settings-lead = Wo der Befehl jedes Assistenten zu finden ist, für „Fortsetzen“. Lassen Sie einen Pfad leer, damit Ariane selbst danach sucht.
settings-language = Sprache
settings-language-auto = Automatisch — { $language }
settings-language-select =
    .aria-label = Sprache der App
settings-theme = Erscheinungsbild
settings-theme-select =
    .aria-label = Farbschema der App
settings-theme-auto = System
settings-theme-light = Hell
settings-theme-dark = Dunkel
settings-updates = Aktualisierungen
settings-updates-select =
    .aria-label = Ob Ariane fragen darf, ob eine neuere Version vorliegt
settings-updates-never = Nie nachfragen
settings-updates-startup = Beim Start
update-available = Ariane { $version } ist verfügbar.
update-open = Version ansehen
update-close =
    .aria-label = Hinweis schließen
settings-add = Assistenten hinzufügen
settings-add-menu =
    .aria-label = Hinzuzufügende Assistenten
settings-open-json = JSON-Datei öffnen
settings-cancel = Abbrechen
settings-save = Speichern
settings-sessions = { $n ->
        [0] keine Unterhaltungen
        [one] { $n } Unterhaltung
       *[other] { $n } Unterhaltungen
    }
settings-detected = Gefunden: { $path }
settings-not-detected = Von der automatischen Suche nicht gefunden.
settings-path-label = Fester Pfad
settings-path-input =
    .placeholder = Leer: Ariane sucht selbst
    .aria-label = Fester Pfad für { $agent }
settings-browse = Durchsuchen…
    .aria-label = Nach { $agent } suchen
settings-check-pending = Wird geprüft…
settings-check-chosen = Wird so verwendet: { $path }
settings-check-detected = Ariane verwendet: { $path }
settings-check-not-found = Auf diesem Rechner nicht gefunden: Geben Sie den Pfad an.
settings-check-not-absolute = Der Pfad muss absolut sein.
settings-check-unusable = { $path } ist kein Programm.
settings-check-interpreter = Gefunden, benötigt aber „{ $interpreter }“, das nicht zu finden ist.
settings-check-refused = Pfad abgelehnt: { $detail }.
settings-unreadable = Die Einstellungsdatei kann nicht gelesen werden ({ $error }). Ariane überschreibt sie nicht: Öffnen Sie sie, um sie zu korrigieren.
settings-saved = Einstellungen gespeichert.
settings-opened = Einstellungen in Ihrem Editor geöffnet.
settings-opened-at = Einstellungen: { $path }
settings-opened-unreadable = Einstellungen geöffnet, aber sie können nicht gelesen werden: { $error }

## Sterne und Notizen: die eigenen Markierungen an einer Unterhaltung

mark-favorite = Als Favorit markieren
mark-favorite-on = Favorit — zum Entfernen klicken
mark-message = Diese Nachricht als Favorit markieren
mark-message-on = Favorit — zum Entfernen klicken
mark-note = Notiz
    .title = Eine Notiz zu dieser Unterhaltung schreiben
mark-note-input =
    .placeholder = Warum gerade diese wichtig ist…
    .aria-label = Notiz zu dieser Unterhaltung
mark-note-saved = Notiz gespeichert
favorites-view = Favoriten
    .title = Alle Unterhaltungen, die Sie als Favorit markiert haben
favorites-conversations = Unterhaltungen
favorites-messages = Nachrichten
favorites-quote = „{ $text }“
favorites-empty = Noch keine Favoriten. Der Stern oben in einer Unterhaltung legt sie hier ab.
error-marks-unreadable = Die Datei mit Favoriten und Notizen kann nicht gelesen werden, daher wurde nichts geschrieben: { $error }

## Die Einstellungsdatei selbst: steht oben in settings.json, für alle, die sie öffnen

settings-file-intro = Wo Ariane den Befehl jedes Assistenten findet, für „Fortsetzen“.
settings-file-detected = „detected“: was Ariane selbst gefunden hat. Wird bei jedem Öffnen dieser Datei aktualisiert.
settings-file-command = „command“: leer lassen, damit Ariane sucht; einen absoluten Pfad angeben, um genau diesen vorzugeben.
settings-file-example = Beispiel für codex: { $example }
settings-file-paths = ~ steht für Ihren Benutzerordner.
settings-file-paths-windows = Schreiben Sie Pfade mit normalen Schrägstrichen /. %APPDATA% und ~ werden verstanden.
settings-file-language = „language“: „auto“, um dem System zu folgen, oder ein Sprachcode wie „de“ oder „en“.
settings-file-theme = „theme“: „auto“ folgt dem System, sonst „light“ oder „dark“.

## Fehler, die die App meldet

error-forget-not-saved = Nur eine von Ariane gesicherte Unterhaltung kann vergessen werden: Die anderen liegen in den Dateien ihres Assistenten.
error-message-not-found = Nachricht nicht gefunden.
error-resume-impossible = Diese Unterhaltung kann nicht fortgesetzt werden ({ $reason }).
error-settings-unreadable = Die Einstellungen können nicht gelesen werden, daher wurde nichts geschrieben: { $error }
browse-title = Wo ist { $agent }?

## Exporte: eine Unterhaltung als Markdown-Datei geschrieben oder als PDF gedruckt

export-dialog-title = Unterhaltung exportieren
export-file-name = Unterhaltung
export-field = { $label }: { $value }
export-field-assistant = Assistent
export-field-folder = Ordner
export-field-branch = Branch
export-field-period = Zeitraum
export-field-messages = Nachrichten
export-period = vom { $from } bis { $to }
export-order-newest = von neu nach alt
export-order-oldest = von alt nach neu
export-messages = { $count }, { $order }
export-saved = Von Ariane gesichert: Die Originaldatei ist weg.
export-footer = Aus Ariane exportiert.
export-footer-at = Am { $date } aus Ariane exportiert.

## Statistics

stats-button =
    .title = Statistik
    .aria-label = Statistik anzeigen
stats-footer-title = Statistik anzeigen
stats-title = Statistik
stats-loading = Wird gezählt …
stats-period = { $period } · { $sessions ->
        [one] { $sessions } Unterhaltung
       *[other] { $sessions } Unterhaltungen
    } · { $folders ->
        [one] { $folders } Ordner
       *[other] { $folders } Ordner
    }
stats-hidden = { $count ->
        [one] { $count } in der Seitenleiste ausgeblendeter Assistent wird nicht mitgezählt.
       *[other] { $count } in der Seitenleiste ausgeblendete Assistenten werden nicht mitgezählt.
    }
stats-empty = In diesem Zeitraum wurde nichts geschrieben.
stats-who = Wer geschrieben hat
stats-you = Von Ihnen getippt
stats-replies = Antworten der Assistenten
stats-tools = Werkzeugausgaben
stats-notices = Systemhinweise
stats-share = { $share } des Angezeigten
stats-records = Die Seitenleiste zählt { $records } Einträge: { $empty } davon enthalten nichts Anzeigbares.
stats-masked = Davon sind { $masked } Überlegungen, die Claude nur noch verschlüsselt aufbewahrt: Es bleibt nur eine Signatur.
stats-tokens = Tokens
stats-sent = ↑ Gesendet
    .title = Neu in den Prompts: frische Eingabe und was in den Cache geschrieben wurde
stats-received = ↓ Empfangen
    .title = Was die Assistenten geschrieben haben, Überlegungen eingeschlossen
stats-cache = Aus dem Cache gelesen
    .title = Der in jeder Runde erneut gesendete Kontext — getrennt gehalten, nie zum Rest addiert
stats-exact = { $value } Tokens
stats-coverage = Gemessen in { $measured } von { $total } Unterhaltungen.
stats-uncovered = { $agents } { $count ->
        [one] zeichnet
       *[other] zeichnen
    } keine Token-Zahlen auf, die Ariane lesen kann.
stats-months = Monat für Monat
stats-measure-you = Ihre Nachrichten
stats-measure-replies = Antworten
stats-measure-received = Empfangene Tokens
stats-months-table = Als Tabelle anzeigen
stats-col-month = Monat
stats-undated = { $count ->
        [one] { $count } Nachricht hat kein Datum und fehlt im Diagramm.
       *[other] { $count } Nachrichten haben kein Datum und fehlen im Diagramm.
    }
stats-chart = { $measure }, Monat für Monat
stats-bar = { $month }: { $value }
stats-by-agent = Nach Assistent
stats-by-model = Nach Modell
stats-by-folder = Aktivste Ordner
stats-col-assistant = Assistent
stats-col-conversations = Unterhaltungen
stats-col-you = Sie
stats-col-replies = Antworten
stats-col-received = ↓ Empfangen
stats-col-model = Modell
stats-col-folder = Ordner
stats-col-messages = Nachrichten
stats-others = { $count ->
        [one] { $count } weiteres Modell
       *[other] { $count } weitere Modelle
    }
stats-not-measured = nicht aufgezeichnet
stats-folder-note = Ihre Nachrichten und die Antworten; Werkzeugausgaben zählen nicht.
