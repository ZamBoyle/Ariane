### Ariane — italiano.
### Una prima traduzione, che merita la revisione di un madrelingua.
###
### Formato: Project Fluent (https://projectfluent.org). Vedi en.ftl, il
### riferimento: stessi messaggi, stesse { $variables }.

language-name = Italiano

## Tasti, così come sono stampati sulle tastiere di questa lingua

key-ctrl = Ctrl
key-alt = Alt
key-esc = Esc

## La cornice della finestra

splash-hide = Non mostrare più questa schermata all’avvio
splash-continue = Continua
sidebar =
    .aria-label = Cartelle e conversazioni
home-button = Ariane
    .title = Torna alla pagina iniziale (Esc)
settings-button =
    .title = Impostazioni: dove trovare ogni assistente
    .aria-label = Apri le impostazioni
refresh-button =
    .title = Reindicizza (Ctrl+R)
    .aria-label = Reindicizza le conversazioni
folder-filter =
    .placeholder = Filtra le cartelle…
    .aria-label = Filtra cartelle e conversazioni
agent-filter =
    .aria-label = Assistenti mostrati
agents-show-all = Mostra tutti
    .title = Mostra di nuovo tutti gli assistenti
tree =
    .aria-label = Albero delle conversazioni
tree-loading = Caricamento…
outline =
    .aria-label = I tuoi messaggi in questa conversazione

## La pagina iniziale

welcome-title = Le tue conversazioni passate
welcome-lead = Scegli una cartella a sinistra, oppure cerca subito nella barra in basso.
welcome-key-search = cerca
welcome-key-find = nella conversazione
welcome-key-own = i tuoi messaggi
welcome-key-reindex = reindicizza
welcome-key-home = inizio

## L'elenco delle cartelle

tree-no-data = Nessuna cartella di Claude Code trovata in { $dir }.
tree-no-match = Nessuna cartella corrisponde.
tree-empty = Nessuna conversazione.
folder-purged-note = (trascrizioni eliminate — solo prompt)
folder-approximate-note = (percorso approssimativo — ricostruito dal nome della cartella)
session-untitled = Senza titolo
session-badge-saved = salvata
    .title = Il file originale non c'è più: Ariane ne conserva l'unica copia
session-badge-prompts = prompt
    .title = Trascrizione eliminata: restano solo i tuoi prompt
session-summary = { $when } · { $count ->
        [one] { $count } messaggio
       *[other] { $count } messaggi
    }

session-models = { $model } +{ $more }
session-tokens = ↑ { $sent } · ↓ { $received }
    .title =
        Inviati: { $sentExact } token nuovi nei prompt
        Ricevuti: { $receivedExact } token
session-tokens-cached = ↑ { $sent } · ↓ { $received } · cache { $cached }
    .title =
        Inviati: { $sentExact } token nuovi nei prompt
        Ricevuti: { $receivedExact } token
        Riletti dalla cache: { $cachedExact } token, il contesto rinviato a ogni turno

## Il piè di colonna, e l'indicizzazione

stats = { $folders ->
        [one] { $folders } cartella
       *[other] { $folders } cartelle
    } · { $sessions ->
        [one] { $sessions } conversazione
       *[other] { $sessions } conversazioni
    } · { $messages ->
        [one] { $messages } messaggio
       *[other] { $messages } messaggi
    }
stats-indexing = indicizzazione { $done }…
stats-indexing-agent = { $agent } · indicizzazione { $done }…
refresh-done = Indicizzazione completata — { $details }.
refresh-up-to-date = Indice già aggiornato.
refresh-read = { $n ->
        [one] { $n } trascrizione letta
       *[other] { $n } trascrizioni lette
    }
refresh-orphans = { $n ->
        [one] { $n } recuperata dalla cronologia
       *[other] { $n } recuperate dalla cronologia
    }
refresh-saved = { $n ->
        [one] { $n } conversazione salvata
       *[other] { $n } conversazioni salvate
    }
refresh-restored = { $n ->
        [one] { $n } conversazione ripristinata
       *[other] { $n } conversazioni ripristinate
    }
refresh-errors = { $n ->
        [one] { $n } errore
       *[other] { $n } errori
    }
auto-saved = { $n ->
        [one] Ariane ha salvato { $n } conversazione il cui file originale è scomparso.
       *[other] Ariane ha salvato { $n } conversazioni i cui file originali sono scomparsi.
    }

## Una conversazione aperta

convo-empty = Questa conversazione non contiene alcun messaggio da mostrare.
convo-not-found = Conversazione non trovata.
convo-message-count = { $n ->
        [one] { $n } messaggio
       *[other] { $n } messaggi
    }
convo-part = Parte { $n } di { $total }
    .title = Questa conversazione è stata compattata: prosegue in un'altra trascrizione
convo-part-previous =
    .title = Parte precedente
    .aria-label = Vai alla parte precedente
convo-part-next =
    .title = Parte successiva
    .aria-label = Vai alla parte successiva
convo-purged = trascrizione eliminata
convo-saved = salvata da Ariane: il file originale non c'è più
speaker-you = Tu
order-button =
    .title = Inverti l'ordine dei messaggi
order-newest = Più recenti in alto
order-oldest = Meno recenti in alto
export-button = Esporta
    .title = Salva questa conversazione in un file
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = Copia
    .title = Copia il comando per riprendere
open-folder-button = Apri la cartella
folder-gone = Questa cartella non esiste più sul disco.
forget-button = Dimentica
    .title = Cancella definitivamente la copia che Ariane conserva di questa conversazione
forget-confirm = Dimenticare definitivamente?
forget-done = Conversazione dimenticata: Ariane non ne conserva più nulla.
export-preparing-pdf = Preparazione del PDF…
export-done = Esportato: { $path }
message-copy = Copia questo messaggio
message-copied = Messaggio copiato

## Dentro un messaggio

part-thinking = Ragionamento
part-tool = Strumento
part-result = Risultato
part-error = errore
part-pasted = Incollato
part-pasted-lines = { $n ->
        [one] { $n } riga
       *[other] { $n } righe
    }
part-image = Immagine
part-document = Documento
part-empty = (vuoto)
tool-run-calls = { $n ->
        [one] { $n } chiamata a strumento
       *[other] { $n } chiamate a strumenti
    }
tool-run-results = { $n ->
        [one] { $n } risultato
       *[other] { $n } risultati
    }
tool-run-attachments = { $n ->
        [one] { $n } allegato
       *[other] { $n } allegati
    }
tool-errors = { $n ->
        [one] { $n } errore
       *[other] { $n } errori
    }
tool-summary-named = { $summary }: { $names }
tool-summary-errors = { $summary } — { $errors }

## Avvisi: parla lo strumento o l'ambiente, non la persona né l'assistente

notice-away-summary = Riepilogo della sessione
notice-compact-boundary = Conversazione compattata
notice-failure = Errore
notice-cancelled = Richiesta annullata
notice-subagent = Subagente
notice-generic = Avviso

## Cercare nella conversazione aperta

find-input =
    .placeholder = Cerca in questa conversazione…
    .aria-label = Cerca in questa conversazione
find-count =
    .title = Il messaggio trovato, fra tutti quelli che contengono questo testo
find-none = nessuno
find-previous =
    .title = Precedente (Maiusc+Invio)
    .aria-label = Risultato precedente
find-next =
    .title = Successivo (Invio)
    .aria-label = Risultato successivo
find-close =
    .title = Chiudi (Esc)
    .aria-label = Chiudi la ricerca

## Riprendere una conversazione nel suo terminale

resume-button = Riprendi
resume-button-latest = Riprendi (ultima)
resume-opens = Apre un terminale: { $command }
resume-note-latest-only = Gemini può riprendere solo per indice o «latest», non per id.
resume-note-unsupported = VS Code non permette di riaprire una conversazione; si può aprire solo la sua cartella.
resume-opened = Terminale aperto ({ $terminal }).
resume-opened-settings-ignored = Terminale aperto ({ $terminal }), senza seguire le impostazioni: { $problem }
resume-no-terminal = Nessun terminale trovato.
resume-folder-missing = La cartella di questa conversazione non esiste più.
resume-command-not-found = Ariane non trova «{ $command }» su questo computer.
resume-setting-not-absolute = Impostazioni: il percorso di «{ $command }» deve essere assoluto ({ $path }).
resume-setting-unusable = Impostazioni: { $path } non è un programma.
resume-interpreter-not-found = «{ $command }» richiede «{ $interpreter }», che non si trova.
resume-failed = Impossibile aprire un terminale ({ $reason }).
resume-failed-copied = { $reason } Comando copiato.
command-copied = Comando copiato.
open-settings-action = Apri le impostazioni

## La barra di ricerca

results =
    .aria-label = Risultati della ricerca
search-input =
    .placeholder = Cerca nelle tue conversazioni…
    .aria-label = Cerca nelle conversazioni
scope-select =
    .aria-label = Ambito della ricerca
    .title = Dove cercare
scope-all = Ovunque
scope-folder = Cartella: { $name }
scope-folder-current = Cartella: corrente
scope-session = Questa conversazione
period-select =
    .aria-label = Periodo della ricerca
    .title = Quando
period-all = Tutte le date
period-7d = Ultimi 7 giorni
period-30d = Ultimi 30 giorni
period-year = Quest'anno
results-count = { $n ->
        [one] { $n } risultato
       *[other] { $n } risultati
    }
results-none = Nessun risultato.
results-none-7d = Nessun risultato negli ultimi 7 giorni.
results-none-30d = Nessun risultato negli ultimi 30 giorni.
results-none-year = Nessun risultato quest'anno.

## La finestra delle impostazioni

settings-title = Impostazioni
settings-lead = Dove trovare il comando di ogni assistente, per «Riprendi». Lascia vuoto un percorso perché Ariane lo cerchi da sola.
settings-language = Lingua
settings-language-auto = Automatica — { $language }
settings-language-select =
    .aria-label = Lingua dell'app
settings-theme = Tema
settings-theme-select =
    .aria-label = Tema di colore dell'app
settings-theme-auto = Sistema
settings-theme-light = Chiaro
settings-theme-dark = Scuro
settings-updates = Aggiornamenti
settings-updates-select =
    .aria-label = Se Ariane può chiedere se esiste una versione più recente
settings-updates-never = Non chiedere mai
settings-updates-startup = All'avvio
update-available = Ariane { $version } è disponibile.
update-open = Vedi la versione
update-close =
    .aria-label = Chiudi
settings-add = Aggiungi un assistente
settings-add-menu =
    .aria-label = Assistenti da aggiungere
settings-open-json = Apri il file JSON
settings-cancel = Annulla
settings-save = Salva
settings-sessions = { $n ->
        [0] nessuna conversazione
        [one] { $n } conversazione
       *[other] { $n } conversazioni
    }
settings-detected = Trovato: { $path }
settings-not-detected = La ricerca automatica non lo trova.
settings-path-label = Percorso da usare
settings-path-input =
    .placeholder = Vuoto: Ariane lo cerca da sola
    .aria-label = Percorso da usare per { $agent }
settings-browse = Sfoglia…
    .aria-label = Sfoglia per trovare { $agent }
settings-check-pending = Verifica in corso…
settings-check-chosen = Usato così com'è: { $path }
settings-check-detected = Ariane userà: { $path }
settings-check-not-found = Non trovato su questo computer: indica il suo percorso.
settings-check-not-absolute = Il percorso deve essere assoluto.
settings-check-unusable = { $path } non è un programma.
settings-check-interpreter = Trovato, ma richiede «{ $interpreter }», che non si trova.
settings-check-refused = Percorso rifiutato: { $detail }.
settings-unreadable = Il file delle impostazioni non è leggibile ({ $error }). Ariane non lo riscriverà: aprilo per correggerlo.
settings-saved = Impostazioni salvate.
settings-opened = Impostazioni aperte nel tuo editor.
settings-opened-at = Impostazioni: { $path }
settings-opened-unreadable = Impostazioni aperte, ma non leggibili: { $error }

## Stelle e note: i segni che metti tu su una conversazione

mark-favorite = Aggiungi ai preferiti
mark-favorite-on = Tra i preferiti — clicca per togliere
mark-message = Aggiungi questo messaggio ai preferiti
mark-message-on = Tra i preferiti — clicca per togliere
mark-note = Nota
    .title = Scrivi una nota su questa conversazione
mark-note-input =
    .placeholder = Perché proprio questa conta…
    .aria-label = Nota su questa conversazione
mark-note-saved = Nota salvata
favorites-view = Preferiti
    .title = Tutte le conversazioni che hai aggiunto ai preferiti
favorites-conversations = Conversazioni
favorites-messages = Messaggi
favorites-quote = «{ $text }»
favorites-empty = Nessun preferito per ora. La stella, in cima a una conversazione, la mette qui.
error-marks-unreadable = Il file dei preferiti e delle note non è leggibile, quindi non è stato scritto nulla: { $error }

## Il file delle impostazioni: scritto in cima a settings.json, per chi lo apre

settings-file-intro = Dove Ariane trova il comando di ogni assistente, per «Riprendi».
settings-file-detected = «detected»: ciò che Ariane ha trovato da sola. Aggiornato ogni volta che questo file viene aperto.
settings-file-command = «command»: lascialo vuoto perché Ariane lo cerchi; inserisci un percorso assoluto per imporre quello.
settings-file-example = Esempio, per codex: { $example }
settings-file-paths = ~ indica la tua cartella personale.
settings-file-paths-windows = Scrivi i percorsi con barre normali /. %APPDATA% e ~ sono riconosciuti.
settings-file-language = «language»: «auto» per seguire il sistema, oppure un codice di lingua come «it» o «en».
settings-file-theme = «theme»: «auto» per seguire il sistema, oppure «light» o «dark».

## Errori segnalati dall'app

error-forget-not-saved = Si può dimenticare solo una conversazione salvata da Ariane: le altre vivono nei file del loro assistente.
error-message-not-found = Messaggio non trovato.
error-resume-impossible = Questa conversazione non può essere ripresa ({ $reason }).
error-settings-unreadable = Le impostazioni non sono leggibili, quindi non è stato scritto nulla: { $error }
browse-title = Dov'è { $agent }?

## Esportazioni: una conversazione scritta in un file Markdown o stampata in PDF

export-dialog-title = Esporta la conversazione
export-file-name = conversazione
export-field = { $label }: { $value }
export-field-assistant = Assistente
export-field-folder = Cartella
export-field-branch = Branch
export-field-period = Periodo
export-field-messages = Messaggi
export-period = dal { $from } al { $to }
export-order-newest = dal più recente al meno recente
export-order-oldest = dal meno recente al più recente
export-messages = { $count }, { $order }
export-saved = Salvata da Ariane: il file originale non c'è più.
export-footer = Esportato da Ariane.
export-footer-at = Esportato da Ariane il { $date }.

## Statistics

stats-button =
    .title = Statistiche
    .aria-label = Mostra le statistiche
stats-footer-title = Mostra le statistiche
stats-title = Statistiche
stats-loading = Conteggio in corso…
stats-period = { $period } · { $sessions ->
        [one] { $sessions } conversazione
       *[other] { $sessions } conversazioni
    } · { $folders ->
        [one] { $folders } cartella
       *[other] { $folders } cartelle
    }
stats-hidden = { $count ->
        [one] { $count } assistente nascosto nella barra laterale non è conteggiato.
       *[other] { $count } assistenti nascosti nella barra laterale non sono conteggiati.
    }
stats-empty = Nulla è stato scritto in questo periodo.
stats-who = Chi ha scritto
stats-you = Scritti da te
stats-replies = Risposte degli assistenti
stats-tools = Output degli strumenti
stats-notices = Avvisi di sistema
stats-share = { $share } di ciò che è mostrato
stats-records = La barra laterale conta { $records } voci: { $empty } non contengono nulla da mostrare.
stats-masked = Di queste, { $masked } sono ragionamenti che Claude ormai conserva solo cifrati: ne resta soltanto una firma.
stats-tokens = Token
stats-sent = ↑ Inviati
    .title = Nuovi nei prompt: l’input fresco e ciò che è stato scritto nella cache
stats-received = ↓ Ricevuti
    .title = Ciò che gli assistenti hanno scritto, ragionamento compreso
stats-cache = Riletti dalla cache
    .title = Il contesto rinviato a ogni turno — tenuto a parte, mai sommato al resto
stats-exact = { $value } token
stats-coverage = Misurati in { $measured } conversazioni su { $total }.
stats-uncovered = { $agents } non { $count ->
        [one] registra
       *[other] registrano
    } token che Ariane sappia leggere.
stats-months = Mese per mese
stats-measure-you = I tuoi messaggi
stats-measure-replies = Risposte
stats-measure-received = Token ricevuti
stats-months-table = Mostra come tabella
stats-col-month = Mese
stats-undated = { $count ->
        [one] { $count } messaggio non ha data e non compare nel grafico.
       *[other] { $count } messaggi non hanno data e non compaiono nel grafico.
    }
stats-chart = { $measure }, mese per mese
stats-bar = { $month }: { $value }
stats-by-agent = Per assistente
stats-by-model = Per modello
stats-by-folder = Cartelle più attive
stats-col-assistant = Assistente
stats-col-conversations = Conversazioni
stats-col-you = Tu
stats-col-replies = Risposte
stats-col-received = ↓ Ricevuti
stats-col-model = Modello
stats-col-folder = Cartella
stats-col-messages = Messaggi
stats-others = { $count ->
        [one] { $count } altro modello
       *[other] { $count } altri modelli
    }
stats-not-measured = non registrato
stats-folder-note = I tuoi messaggi e le risposte; l’output degli strumenti non conta.
