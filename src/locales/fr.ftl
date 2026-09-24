### Ariane — français.
###
### Format : Project Fluent (https://projectfluent.org). Voir en.ftl, la
### référence : mêmes messages, mêmes { $variables }.

language-name = Français

## Touches du clavier, telles qu'imprimées sur les claviers de cette langue

key-ctrl = Ctrl
key-alt = Alt
key-esc = Échap

## Le cadre de la fenêtre

# L'écran d'accueil, la seule phrase qu'il montre.
splash-hide = Ne plus afficher cet écran au démarrage
splash-continue = Continuer
sidebar =
    .aria-label = Dossiers et conversations
home-button = Ariane
    .title = Revenir à l'accueil (Échap)
settings-button =
    .title = Réglages : où trouver chaque assistant
    .aria-label = Ouvrir les réglages
refresh-button =
    .title = Réindexer (Ctrl+R)
    .aria-label = Réindexer les conversations
folder-filter =
    .placeholder = Filtrer les dossiers…
    .aria-label = Filtrer les dossiers et conversations
agent-filter =
    .aria-label = Assistants affichés
agents-show-all = Tout afficher
    .title = Réafficher tous les assistants
tree =
    .aria-label = Arborescence des conversations
tree-loading = Chargement…
outline =
    .aria-label = Vos messages dans cette conversation

## L'accueil

welcome-title = Vos conversations passées
welcome-lead = Choisissez un dossier à gauche, ou cherchez directement dans la barre du bas.
welcome-key-search = recherche
welcome-key-find = dans la conversation
welcome-key-own = vos messages
welcome-key-reindex = réindexer
welcome-key-home = accueil

## La liste des dossiers

tree-no-data = Aucun dossier Claude Code trouvé dans { $dir }.
tree-no-match = Aucun dossier ne correspond.
tree-empty = Aucune conversation.
folder-purged-note = (transcriptions purgées — prompts seuls)
folder-approximate-note = (chemin approximatif — reconstruit depuis le nom du dossier)
session-untitled = Sans titre
session-badge-saved = sauvée
    .title = Le fichier d'origine a disparu : Ariane en garde la seule copie
session-badge-prompts = prompts
    .title = Transcription purgée : seuls vos prompts subsistent
session-summary = { $when } · { $count ->
        [one] { $count } message
       *[other] { $count } messages
    }

session-models = { $model } +{ $more }
session-tokens = ↑ { $sent } · ↓ { $received }
    .title =
        Envoyés : { $sentExact } jetons nouveaux dans les prompts
        Reçus : { $receivedExact } jetons
session-tokens-cached = ↑ { $sent } · ↓ { $received } · cache { $cached }
    .title =
        Envoyés : { $sentExact } jetons nouveaux dans les prompts
        Reçus : { $receivedExact } jetons
        Relus depuis le cache : { $cachedExact } jetons, le contexte renvoyé à chaque tour

## Le pied de colonne, et l'indexation

stats = { $folders ->
        [one] { $folders } dossier
       *[other] { $folders } dossiers
    } · { $sessions ->
        [one] { $sessions } conversation
       *[other] { $sessions } conversations
    } · { $messages ->
        [one] { $messages } message
       *[other] { $messages } messages
    }
stats-indexing = indexation { $done }…
stats-indexing-agent = { $agent } · indexation { $done }…
refresh-done = Indexation terminée — { $details }.
refresh-up-to-date = Index déjà à jour.
refresh-read = { $n ->
        [one] { $n } transcription lue
       *[other] { $n } transcriptions lues
    }
refresh-orphans = { $n ->
        [one] { $n } récupérée de l'historique
       *[other] { $n } récupérées de l'historique
    }
refresh-saved = { $n ->
        [one] { $n } conversation sauvée
       *[other] { $n } conversations sauvées
    }
refresh-restored = { $n ->
        [one] { $n } conversation restaurée
       *[other] { $n } conversations restaurées
    }
refresh-errors = { $n ->
        [one] { $n } erreur
       *[other] { $n } erreurs
    }
auto-saved = { $n ->
        [one] Ariane a sauvé { $n } conversation dont le fichier d'origine a disparu.
       *[other] Ariane a sauvé { $n } conversations dont le fichier d'origine a disparu.
    }

## Une conversation ouverte

convo-empty = Cette conversation ne contient aucun message affichable.
convo-not-found = Conversation introuvable.
convo-message-count = { $n ->
        [one] { $n } message
       *[other] { $n } messages
    }
convo-part = Partie { $n } sur { $total }
    .title = Cette conversation a été compactée : elle se poursuit dans une autre transcription
convo-part-previous =
    .title = Partie précédente
    .aria-label = Aller à la partie précédente
convo-part-next =
    .title = Partie suivante
    .aria-label = Aller à la partie suivante
convo-purged = transcription purgée
convo-saved = sauvée par Ariane : le fichier d'origine a disparu
speaker-you = Vous
order-button =
    .title = Inverser l'ordre des messages
order-newest = Plus récent en haut
order-oldest = Plus ancien en haut
export-button = Exporter
    .title = Enregistrer cette conversation dans un fichier
export-markdown = Markdown (.md)
export-pdf = PDF (.pdf)
copy-command-button = Copier
    .title = Copier la commande de reprise
open-folder-button = Ouvrir le dossier
folder-gone = Ce dossier n'existe plus sur le disque.
forget-button = Oublier
    .title = Effacer définitivement la copie qu'Ariane garde de cette conversation
forget-confirm = Oublier définitivement ?
forget-done = Conversation oubliée : Ariane n’en garde plus rien.
export-preparing-pdf = Préparation du PDF…
export-done = Exportée : { $path }
message-copy = Copier ce message
message-copied = Message copié

## Dans un message

part-thinking = Réflexion
part-tool = Outil
part-result = Résultat
part-error = erreur
part-pasted = Collé
part-pasted-lines = { $n ->
        [one] { $n } ligne
       *[other] { $n } lignes
    }
part-image = Image
part-document = Document
part-empty = (vide)
tool-run-calls = { $n ->
        [one] { $n } appel d'outil
       *[other] { $n } appels d'outils
    }
tool-run-results = { $n ->
        [one] { $n } résultat
       *[other] { $n } résultats
    }
tool-run-attachments = { $n ->
        [one] { $n } pièce jointe
       *[other] { $n } pièces jointes
    }
tool-errors = { $n ->
        [one] { $n } erreur
       *[other] { $n } erreurs
    }
tool-summary-named = { $summary } : { $names }
tool-summary-errors = { $summary } — { $errors }

## Les avis : l'outil ou le harnais qui parle, ni la personne ni l'assistant

notice-away-summary = Résumé de session
notice-compact-boundary = Conversation compactée
notice-failure = Échec
notice-cancelled = Requête annulée
notice-subagent = Sous-agent
notice-generic = Avis

## Chercher dans la conversation ouverte

find-input =
    .placeholder = Chercher dans cette conversation…
    .aria-label = Chercher dans cette conversation
find-count =
    .title = Le message trouvé, sur tous ceux qui contiennent ce texte
find-none = aucun
find-previous =
    .title = Précédent (Maj+Entrée)
    .aria-label = Message trouvé précédent
find-next =
    .title = Suivant (Entrée)
    .aria-label = Message trouvé suivant
find-close =
    .title = Fermer (Échap)
    .aria-label = Fermer la recherche

## Reprendre une conversation dans son propre terminal

resume-button = Reprendre
resume-button-latest = Reprendre (dernière)
resume-opens = Ouvre un terminal : { $command }
resume-note-latest-only = Gemini ne sait reprendre que par index ou « latest », pas par identifiant.
resume-note-unsupported = VS Code n’expose pas la réouverture d’une conversation ; seul le dossier peut être ouvert.
resume-opened = Terminal ouvert ({ $terminal }).
resume-opened-settings-ignored = Terminal ouvert ({ $terminal }), sans suivre les réglages : { $problem }
resume-no-terminal = Aucun terminal trouvé.
resume-folder-missing = Le dossier de cette conversation n'existe plus.
resume-command-not-found = Ariane ne trouve pas « { $command } » sur cette machine.
resume-setting-not-absolute = Réglages : le chemin de « { $command } » doit être absolu ({ $path }).
resume-setting-unusable = Réglages : { $path } n'est pas un programme.
resume-interpreter-not-found = « { $command } » a besoin de « { $interpreter } », introuvable.
resume-failed = Impossible d'ouvrir un terminal ({ $reason }).
resume-failed-copied = { $reason } Commande copiée.
command-copied = Commande copiée.
open-settings-action = Ouvrir les réglages

## La barre de recherche

results =
    .aria-label = Résultats de recherche
search-input =
    .placeholder = Rechercher dans vos conversations…
    .aria-label = Rechercher dans les conversations
scope-select =
    .aria-label = Portée de la recherche
    .title = Où chercher
scope-all = Partout
scope-folder = Dossier : { $name }
scope-folder-current = Dossier : courant
scope-session = Cette conversation
period-select =
    .aria-label = Période de la recherche
    .title = Quand
period-all = Toutes les dates
period-7d = 7 derniers jours
period-30d = 30 derniers jours
period-year = Cette année
results-count = { $n ->
        [one] { $n } résultat
       *[other] { $n } résultats
    }
results-none = Aucun résultat.
results-none-7d = Aucun résultat sur les 7 derniers jours.
results-none-30d = Aucun résultat sur les 30 derniers jours.
results-none-year = Aucun résultat cette année.

## La fenêtre Réglages

settings-title = Réglages
settings-lead = Où trouver la commande de chaque assistant, pour « Reprendre ». Laissez un chemin vide pour qu'Ariane le cherche elle-même.
settings-language = Langue
settings-language-auto = Automatique — { $language }
settings-language-select =
    .aria-label = Langue de l'application
settings-theme = Thème
settings-theme-select =
    .aria-label = Thème de couleurs de l'application
settings-theme-auto = Système
settings-theme-light = Clair
settings-theme-dark = Sombre
settings-updates = Mises à jour
settings-updates-select =
    .aria-label = Si Ariane peut demander s'il existe une version plus récente
settings-updates-never = Ne jamais demander
settings-updates-startup = Au lancement
update-available = Ariane { $version } est disponible.
update-open = Voir la version
update-close =
    .aria-label = Fermer
settings-add = Ajouter un assistant
settings-add-menu =
    .aria-label = Assistants à ajouter
settings-open-json = Ouvrir le fichier JSON
settings-cancel = Annuler
settings-save = Enregistrer
settings-sessions = { $n ->
        [0] aucune conversation
        [one] { $n } conversation
       *[other] { $n } conversations
    }
settings-detected = Trouvé : { $path }
settings-not-detected = La recherche automatique ne le trouve pas.
settings-path-label = Chemin imposé
settings-path-input =
    .placeholder = Vide : Ariane cherche elle-même
    .aria-label = Chemin imposé pour { $agent }
settings-browse = Parcourir…
    .aria-label = Parcourir pour { $agent }
settings-check-pending = Vérification…
settings-check-chosen = Utilisé tel quel : { $path }
settings-check-detected = Ariane utilisera : { $path }
settings-check-not-found = Introuvable sur cette machine : indiquez son chemin.
settings-check-not-absolute = Le chemin doit être absolu.
settings-check-unusable = { $path } n'est pas un programme.
settings-check-interpreter = Trouvé, mais il a besoin de « { $interpreter } », introuvable.
settings-check-refused = Chemin refusé : { $detail }.
settings-unreadable = Le fichier de réglages est illisible ({ $error }). Ariane ne le réécrira pas : ouvrez-le pour le corriger.
settings-saved = Réglages enregistrés.
settings-opened = Réglages ouverts dans votre éditeur.
settings-opened-at = Réglages : { $path }
settings-opened-unreadable = Réglages ouverts, mais illisibles : { $error }

## Étoiles et notes : les repères que la personne pose elle-même

mark-favorite = Mettre en favori
mark-favorite-on = En favori — cliquer pour retirer
mark-message = Mettre ce message en favori
mark-message-on = En favori — cliquer pour retirer
mark-note = Note
    .title = Écrire une note sur cette conversation
mark-note-input =
    .placeholder = Pourquoi celle-ci compte…
    .aria-label = Note sur cette conversation
mark-note-saved = Note enregistrée
favorites-view = Favoris
    .title = Toutes les conversations que vous avez mises en favori
favorites-conversations = Conversations
favorites-messages = Messages
# L'extrait d'un message favori, entre les guillemets de cette langue.
favorites-quote = « { $text } »
favorites-empty = Aucun favori pour l'instant. L'étoile, en haut d'une conversation, la range ici.
error-marks-unreadable = Le fichier des favoris est illisible, rien n'a été écrit : { $error }

## Le fichier de réglages lui-même : écrit en tête de settings.json

settings-file-intro = Où Ariane trouve la commande de chaque assistant, pour « Reprendre ».
settings-file-detected = « detected » : ce qu’Ariane a trouvé seule. Mis à jour à chaque ouverture de ce fichier.
settings-file-command = « command » : laissez vide pour qu’Ariane cherche ; mettez un chemin absolu pour imposer celui-là.
settings-file-example = Exemple, pour codex : { $example }
settings-file-paths = ~ est compris comme votre dossier personnel.
settings-file-paths-windows = Écrivez les chemins avec des barres obliques /. %APPDATA% et ~ sont compris.
settings-file-language = « language » : « auto » pour suivre le système, ou un code de langue comme « fr » ou « en ».
settings-file-theme = « theme » : « auto » pour suivre le système, ou « light » ou « dark ».

## Les erreurs que l'app signale

error-forget-not-saved = Seule une conversation sauvée par Ariane peut être oubliée : les autres vivent dans les fichiers de leur agent.
error-message-not-found = Message introuvable.
error-resume-impossible = Cette conversation ne peut pas être reprise ({ $reason }).
error-settings-unreadable = Réglages illisibles, rien n'a été écrit : { $error }
browse-title = Où se trouve { $agent } ?

## Les exports : une conversation écrite en Markdown ou imprimée en PDF

export-dialog-title = Exporter la conversation
export-file-name = conversation
export-field = { $label } : { $value }
export-field-assistant = Assistant
export-field-folder = Dossier
export-field-branch = Branche
export-field-period = Période
export-field-messages = Messages
export-period = du { $from } au { $to }
export-order-newest = du plus récent au plus ancien
export-order-oldest = du plus ancien au plus récent
export-messages = { $count }, { $order }
export-saved = Sauvée par Ariane : le fichier d'origine a disparu.
export-footer = Exporté depuis Ariane.
export-footer-at = Exporté depuis Ariane le { $date }.

## Statistiques

stats-button =
    .title = Statistiques
    .aria-label = Afficher les statistiques
stats-footer-title = Afficher les statistiques
stats-title = Statistiques
stats-loading = Calcul en cours…
stats-period = { $period } · { $sessions ->
        [one] { $sessions } conversation
       *[other] { $sessions } conversations
    } · { $folders ->
        [one] { $folders } dossier
       *[other] { $folders } dossiers
    }
stats-hidden = { $count ->
        [one] { $count } assistant masqué dans la barre latérale n’est pas compté.
       *[other] { $count } assistants masqués dans la barre latérale ne sont pas comptés.
    }
stats-empty = Rien n’a été écrit dans cette période.
stats-who = Qui a écrit
stats-you = Tapés par vous
stats-replies = Réponses des assistants
stats-tools = Sorties d’outils
stats-notices = Avis du système
stats-share = { $share } de ce qui s’affiche
stats-records = La barre latérale compte { $records } enregistrements : { $empty } ne contiennent rien à afficher, comme une enveloppe vide.
stats-tokens = Jetons
stats-sent = ↑ Envoyés
    .title = Nouveaux dans les invites : l’entrée fraîche et ce qui a été écrit dans le cache
stats-received = ↓ Reçus
    .title = Ce que les assistants ont écrit, raisonnement compris
stats-cache = Relus depuis le cache
    .title = Le contexte renvoyé à chaque tour — tenu à part, jamais additionné au reste
stats-exact = { $value } jetons
stats-coverage = Mesurés dans { $measured } conversations sur { $total }.
stats-uncovered = { $agents } { $count ->
        [one] n’enregistre
       *[other] n’enregistrent
    } pas de jetons qu’Ariane sait lire.
stats-months = Mois par mois
stats-measure-you = Vos messages
stats-measure-replies = Réponses
stats-measure-received = Jetons reçus
stats-months-table = Voir en tableau
stats-col-month = Mois
stats-undated = { $count ->
        [one] { $count } message n’a pas de date et ne figure pas dans le graphique.
       *[other] { $count } messages n’ont pas de date et ne figurent pas dans le graphique.
    }
stats-chart = { $measure }, mois par mois
stats-bar = { $month } : { $value }
stats-by-agent = Par assistant
stats-by-model = Par modèle
stats-by-folder = Dossiers les plus actifs
stats-col-assistant = Assistant
stats-col-conversations = Conversations
stats-col-you = Vous
stats-col-replies = Réponses
stats-col-received = ↓ Reçus
stats-col-model = Modèle
stats-col-folder = Dossier
stats-col-messages = Messages
stats-others = { $count ->
        [one] { $count } autre modèle
       *[other] { $count } autres modèles
    }
stats-not-measured = non enregistré
stats-folder-note = Vos messages et les réponses ; les sorties d’outils ne comptent pas.
