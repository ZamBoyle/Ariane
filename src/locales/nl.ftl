### Ariane — Nederlands.
### Een eerste vertaling, die nog nagelezen moet worden door een moedertaalspreker.
###
### Formaat: Project Fluent (https://projectfluent.org). Zie en.ftl, de
### referentie: dezelfde berichten, dezelfde { $variables }.

language-name = Nederlands

## Toetsen, zoals ze op de toetsenborden van deze taal staan

key-ctrl = Ctrl
key-alt = Alt
key-esc = Esc

## Het venster

splash-hide = Dit scherm niet meer tonen bij het opstarten
splash-continue = Doorgaan
sidebar =
    .aria-label = Mappen en gesprekken
home-button = Ariane
    .title = Terug naar het startscherm (Esc)
settings-button =
    .title = Instellingen: waar elke assistent te vinden is
    .aria-label = Instellingen openen
refresh-button =
    .title = Opnieuw indexeren (Ctrl+R)
    .aria-label = Gesprekken opnieuw indexeren
folder-filter =
    .placeholder = Mappen filteren…
    .aria-label = Mappen en gesprekken filteren
agent-filter =
    .aria-label = Getoonde assistenten
agents-show-all = Alles tonen
    .title = Alle assistenten weer tonen
tree =
    .aria-label = Boomstructuur van de gesprekken
tree-loading = Laden…
outline =
    .aria-label = Jouw berichten in dit gesprek

## Het startscherm

welcome-title = Je eerdere gesprekken
welcome-lead = Kies links een map, of zoek meteen in de balk hieronder.
welcome-key-search = zoeken
welcome-key-find = in het gesprek
welcome-key-own = je berichten
welcome-key-reindex = opnieuw indexeren
welcome-key-home = start

## De mappenlijst

tree-no-data = Geen Claude Code-map gevonden in { $dir }.
tree-no-match = Geen enkele map komt overeen.
tree-empty = Geen gesprekken.
folder-purged-note = (transcripten gewist — alleen prompts)
folder-approximate-note = (pad bij benadering — afgeleid uit de mapnaam)
session-untitled = Zonder titel
session-badge-saved = bewaard
    .title = Het originele bestand is weg: Ariane heeft de enige kopie
session-badge-prompts = prompts
    .title = Transcript gewist: alleen je prompts zijn er nog
session-summary = { $when } · { $count ->
        [one] { $count } bericht
       *[other] { $count } berichten
    }

## De voettekst, en het indexeren

stats = { $folders ->
        [one] { $folders } map
       *[other] { $folders } mappen
    } · { $sessions ->
        [one] { $sessions } gesprek
       *[other] { $sessions } gesprekken
    } · { $messages ->
        [one] { $messages } bericht
       *[other] { $messages } berichten
    }
stats-indexing = indexeren { $done }…
stats-indexing-agent = { $agent } · indexeren { $done }…
refresh-done = Indexeren klaar — { $details }.
refresh-up-to-date = Index al bijgewerkt.
refresh-read = { $n ->
        [one] { $n } transcript gelezen
       *[other] { $n } transcripten gelezen
    }
refresh-orphans = { $n ->
        [one] { $n } teruggehaald uit de geschiedenis
       *[other] { $n } teruggehaald uit de geschiedenis
    }
refresh-saved = { $n ->
        [one] { $n } gesprek bewaard
       *[other] { $n } gesprekken bewaard
    }
refresh-restored = { $n ->
        [one] { $n } gesprek hersteld
       *[other] { $n } gesprekken hersteld
    }
refresh-errors = { $n ->
        [one] { $n } fout
       *[other] { $n } fouten
    }
auto-saved = { $n ->
        [one] Ariane heeft { $n } gesprek bewaard waarvan het originele bestand verdwenen is.
       *[other] Ariane heeft { $n } gesprekken bewaard waarvan de originele bestanden verdwenen zijn.
    }

## Een geopend gesprek

convo-empty = Dit gesprek bevat geen enkel bericht dat getoond kan worden.
convo-not-found = Gesprek niet gevonden.
convo-message-count = { $n ->
        [one] { $n } bericht
       *[other] { $n } berichten
    }
convo-part = Deel { $n } van { $total }
    .title = Deze conversatie is gecomprimeerd: ze gaat verder in een ander transcript
convo-part-previous =
    .title = Vorig deel
    .aria-label = Ga naar het vorige deel
convo-part-next =
    .title = Volgend deel
    .aria-label = Ga naar het volgende deel
convo-purged = transcript gewist
convo-saved = bewaard door Ariane: het originele bestand is weg
speaker-you = Jij
order-button =
    .title = Volgorde van de berichten omkeren
order-newest = Nieuwste bovenaan
order-oldest = Oudste bovenaan
export-button = Exporteren
    .title = Dit gesprek in een bestand opslaan
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = Kopiëren
    .title = Het commando om te hervatten kopiëren
open-folder-button = Map openen
folder-gone = Deze map bestaat niet meer op de schijf.
forget-button = Vergeten
    .title = De kopie die Ariane van dit gesprek bewaart definitief wissen
forget-confirm = Definitief vergeten?
forget-done = Gesprek vergeten: Ariane bewaart er niets meer van.
export-preparing-pdf = PDF voorbereiden…
export-done = Geëxporteerd: { $path }
message-copy = Dit bericht kopiëren
message-copied = Bericht gekopieerd

## In een bericht

part-thinking = Redenering
part-tool = Tool
part-result = Resultaat
part-error = fout
part-pasted = Geplakt
part-pasted-lines = { $n ->
        [one] { $n } regel
       *[other] { $n } regels
    }
part-image = Afbeelding
part-document = Document
part-empty = (leeg)
tool-run-calls = { $n ->
        [one] { $n } toolaanroep
       *[other] { $n } toolaanroepen
    }
tool-run-results = { $n ->
        [one] { $n } resultaat
       *[other] { $n } resultaten
    }
tool-run-attachments = { $n ->
        [one] { $n } bijlage
       *[other] { $n } bijlagen
    }
tool-errors = { $n ->
        [one] { $n } fout
       *[other] { $n } fouten
    }
tool-summary-named = { $summary }: { $names }
tool-summary-errors = { $summary } — { $errors }

## Meldingen: de tool of de omgeving aan het woord, niet de persoon en niet de assistent

notice-away-summary = Sessiesamenvatting
notice-compact-boundary = Gesprek gecomprimeerd
notice-failure = Mislukt
notice-cancelled = Verzoek geannuleerd
notice-subagent = Subagent
notice-generic = Melding

## Zoeken in het geopende gesprek

find-input =
    .placeholder = Zoeken in dit gesprek…
    .aria-label = Zoeken in dit gesprek
find-count =
    .title = Het gevonden bericht, van alle berichten die deze tekst bevatten
find-none = geen
find-previous =
    .title = Vorige (Shift+Enter)
    .aria-label = Vorige treffer
find-next =
    .title = Volgende (Enter)
    .aria-label = Volgende treffer
find-close =
    .title = Sluiten (Esc)
    .aria-label = Zoeken sluiten

## Een gesprek hervatten in een eigen terminal

resume-button = Hervatten
resume-button-latest = Hervatten (laatste)
resume-opens = Opent een terminal: { $command }
resume-note-latest-only = Gemini kan alleen hervatten via een index of “latest”, niet via een id.
resume-note-unsupported = In VS Code kan een gesprek niet opnieuw worden geopend; alleen de map kan geopend worden.
resume-opened = Terminal geopend ({ $terminal }).
resume-opened-settings-ignored = Terminal geopend ({ $terminal }), zonder de instellingen te volgen: { $problem }
resume-no-terminal = Geen terminal gevonden.
resume-folder-missing = De map van dit gesprek bestaat niet meer.
resume-command-not-found = Ariane vindt “{ $command }” niet op deze computer.
resume-setting-not-absolute = Instellingen: het pad voor “{ $command }” moet absoluut zijn ({ $path }).
resume-setting-unusable = Instellingen: { $path } is geen programma.
resume-interpreter-not-found = “{ $command }” heeft “{ $interpreter }” nodig, maar dat is niet te vinden.
resume-failed = Kon geen terminal openen ({ $reason }).
resume-failed-copied = { $reason } Commando gekopieerd.
command-copied = Commando gekopieerd.
open-settings-action = Instellingen openen

## De zoekbalk

results =
    .aria-label = Zoekresultaten
search-input =
    .placeholder = Zoeken in je gesprekken…
    .aria-label = Zoeken in de gesprekken
scope-select =
    .aria-label = Zoekbereik
    .title = Waar zoeken
scope-all = Overal
scope-folder = Map: { $name }
scope-folder-current = Map: huidige
scope-session = Dit gesprek
period-select =
    .aria-label = Zoekperiode
    .title = Wanneer
period-all = Alle datums
period-7d = Laatste 7 dagen
period-30d = Laatste 30 dagen
period-year = Dit jaar
results-count = { $n ->
        [one] { $n } resultaat
       *[other] { $n } resultaten
    }
results-none = Geen resultaten.
results-none-7d = Geen resultaten in de laatste 7 dagen.
results-none-30d = Geen resultaten in de laatste 30 dagen.
results-none-year = Geen resultaten dit jaar.

## Het instellingenvenster

settings-title = Instellingen
settings-lead = Waar het commando van elke assistent te vinden is, voor “Hervatten”. Laat een pad leeg om Ariane het zelf te laten zoeken.
settings-language = Taal
settings-language-auto = Automatisch — { $language }
settings-language-select =
    .aria-label = Taal van de app
settings-theme = Thema
settings-theme-select =
    .aria-label = Kleurthema van de app
settings-theme-auto = Systeem
settings-theme-light = Licht
settings-theme-dark = Donker
settings-updates = Updates
settings-updates-select =
    .aria-label = Of Ariane mag vragen of er een nieuwere versie is
settings-updates-never = Nooit vragen
settings-updates-startup = Bij het starten
update-available = Ariane { $version } is beschikbaar.
update-open = Bekijk de versie
update-close =
    .aria-label = Sluiten
settings-add = Assistent toevoegen
settings-add-menu =
    .aria-label = Toe te voegen assistenten
settings-open-json = JSON-bestand openen
settings-cancel = Annuleren
settings-save = Opslaan
settings-sessions = { $n ->
        [0] geen gesprekken
        [one] { $n } gesprek
       *[other] { $n } gesprekken
    }
settings-detected = Gevonden: { $path }
settings-not-detected = Automatisch zoeken vindt het niet.
settings-path-label = Te gebruiken pad
settings-path-input =
    .placeholder = Leeg: Ariane zoekt het zelf
    .aria-label = Te gebruiken pad voor { $agent }
settings-browse = Bladeren…
    .aria-label = Bladeren naar { $agent }
settings-check-pending = Controleren…
settings-check-chosen = Gebruikt zoals ingevuld: { $path }
settings-check-detected = Ariane gebruikt: { $path }
settings-check-not-found = Niet gevonden op deze computer: vul het pad in.
settings-check-not-absolute = Het pad moet absoluut zijn.
settings-check-unusable = { $path } is geen programma.
settings-check-interpreter = Gevonden, maar het heeft “{ $interpreter }” nodig, en dat is niet te vinden.
settings-check-refused = Pad geweigerd: { $detail }.
settings-unreadable = Het instellingenbestand kan niet gelezen worden ({ $error }). Ariane overschrijft het niet: open het om het te herstellen.
settings-saved = Instellingen opgeslagen.
settings-opened = Instellingen geopend in je editor.
settings-opened-at = Instellingen: { $path }
settings-opened-unreadable = Instellingen geopend, maar ze kunnen niet gelezen worden: { $error }

## Sterren en notities: de merktekens die je zelf bij een gesprek zet

mark-favorite = Als favoriet markeren
mark-favorite-on = Favoriet — klik om te verwijderen
mark-message = Dit bericht als favoriet markeren
mark-message-on = Favoriet — klik om te verwijderen
mark-note = Notitie
    .title = Een notitie bij dit gesprek schrijven
mark-note-input =
    .placeholder = Waarom juist dit gesprek telt…
    .aria-label = Notitie bij dit gesprek
mark-note-saved = Notitie opgeslagen
favorites-view = Favorieten
    .title = Alle gesprekken die je als favoriet hebt gemarkeerd
favorites-conversations = Conversaties
favorites-messages = Berichten
favorites-quote = ‘{ $text }’
favorites-empty = Nog geen favorieten. Met de ster bovenaan een gesprek komt het hier terecht.
error-marks-unreadable = Het bestand met favorieten en notities kan niet gelezen worden, dus er is niets geschreven: { $error }

## Het instellingenbestand zelf: bovenaan settings.json geschreven, voor wie het opent

settings-file-intro = Waar Ariane het commando van elke assistent vindt, voor “Hervatten”.
settings-file-detected = “detected”: wat Ariane zelf gevonden heeft. Bijgewerkt telkens als dit bestand geopend wordt.
settings-file-command = “command”: laat leeg om Ariane te laten zoeken; vul een absoluut pad in om precies dat pad te gebruiken.
settings-file-example = Voorbeeld, voor codex: { $example }
settings-file-paths = ~ staat voor je persoonlijke map.
settings-file-paths-windows = Schrijf paden met gewone schuine strepen /. %APPDATA% en ~ worden begrepen.
settings-file-language = “language”: “auto” om het systeem te volgen, of een taalcode zoals “nl” of “en”.
settings-file-theme = “theme”: “auto” om het systeem te volgen, of “light” of “dark”.

## Fouten die de app meldt

error-forget-not-saved = Alleen een gesprek dat Ariane bewaard heeft, kan vergeten worden: de andere staan in de bestanden van hun assistent.
error-message-not-found = Bericht niet gevonden.
error-resume-impossible = Dit gesprek kan niet hervat worden ({ $reason }).
error-settings-unreadable = De instellingen kunnen niet gelezen worden, dus er is niets geschreven: { $error }
browse-title = Waar staat { $agent }?

## Exports: een gesprek als Markdown-bestand, of afgedrukt als PDF

export-dialog-title = Gesprek exporteren
export-file-name = gesprek
export-field = { $label }: { $value }
export-field-assistant = Assistent
export-field-folder = Map
export-field-branch = Branch
export-field-period = Periode
export-field-messages = Berichten
export-period = van { $from } tot { $to }
export-order-newest = van nieuwste naar oudste
export-order-oldest = van oudste naar nieuwste
export-messages = { $count }, { $order }
export-saved = Bewaard door Ariane: het originele bestand is weg.
export-footer = Geëxporteerd uit Ariane.
export-footer-at = Geëxporteerd uit Ariane op { $date }.
