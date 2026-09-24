<p align="center">
  <a href="ARCHITECTURE.md">English</a> · <a href="ARCHITECTURE.fr.md">Français</a>
</p>

# Architecture d'Ariane

Ce document explique **comment l'application est faite**, et surtout **pourquoi elle est faite
ainsi**. C'est le détail, à ouvrir quand on en a besoin : les pièges de chaque format, le contrat
d'adaptateur, le schéma, le modèle de sécurité.

Le plan de ce qui reste à faire vit dans `ROADMAP.md`, ce qui est fait dans `CHANGELOG.md`, et ce
que l'app offre à l'utilisateur dans `README.md`.

---

## 1. Ce que fait l'application

Sept assistants de code écrivent leurs conversations sur le disque, chacun dans son format. Ariane
les lit **en lecture seule**, en extrait ce qui est de la conversation (environ 1 % des octets), et
les présente **regroupées par dossier de travail** — car la question qu'on se pose est « qu'est-ce
que j'ai fait dans ce projet ? », pas « qu'est-ce que j'ai dit à tel outil ? ».

Tout ce qu'Ariane écrit lui appartient et vit dans son répertoire de données
(`~/.config/Ariane` sous Linux, `%APPDATA%\Ariane` sous Windows,
`~/Library/Application Support/Ariane` sous macOS) : l'index, l'archive, les réglages, et les
repères que la personne pose elle-même.

```
  ~/.claude/  ~/.codex/  ~/.copilot/  ~/.qwen/  ~/.gemini/  <config>/Code/User/…
        │          │          │          │          │              │
        └──────────┴──────────┴────┬─────┴──────────┴──────────────┘
                                   │  lecture seule, jamais d'écriture
                      ┌────────────▼────────────┐
                      │  src/core/agents/*      │  un adaptateur par assistant
                      │  discover() / read()    │  (contrat : contract.js)
                      └────────────┬────────────┘
                                   │  enregistrements bruts
                      ┌────────────▼────────────┐
                      │  src/core/extract.js    │  sélectivité : ce qui est
                      │  + *-extract.js         │  conversation, et rien d'autre
                      └────────────┬────────────┘
                                   │  messages normalisés
                      ┌────────────▼────────────┐
                      │  src/core/indexer.js    │  incrémental, archive, reprise
                      └────────────┬────────────┘
                                   │
                      ┌────────────▼────────────┐        ┌──────────────────────┐
                      │  src/core/db.js         │◄──────►│  src/core/archive.js │
                      │  SQLite + FTS5          │        │  ce qui n'existe     │
                      └────────────┬────────────┘        │  plus nulle part     │
                                   │                     └──────────────────────┘
                      ┌────────────▼────────────┐
                      │  src/main/ipc.js        │  frontière de confiance
                      └────────────┬────────────┘
                                   │  canaux nommés, charges validées
                      ┌────────────▼────────────┐
                      │  src/preload/preload.js │  contextBridge
                      └────────────┬────────────┘
                                   │  window.api : fonctions nommées
                      ┌────────────▼────────────┐
                      │  src/renderer/*         │  bac à sable : ni Node, ni réseau
                      └─────────────────────────┘
```

---

## 2. Les quatre couches

| Couche | Rôle | Interdits |
|---|---|---|
| `src/core/` | toute la logique : lecture, extraction, index, archive | `require('electron')` — jamais |
| `src/main/` | processus principal : fenêtre, sécurité, canaux IPC, terminal, export | — |
| `src/preload/` | le seul pont, par `contextBridge` | aucun `invoke(canal)` générique |
| `src/renderer/` | l'interface, en bac à sable | ni Node, ni réseau, ni accès disque |

**La direction des dépendances ne s'inverse jamais.** `src/core/` reste importable par un `node`
ordinaire : c'est ce qui permet de tester tout le chemin de la donnée sans ouvrir une fenêtre.

**Une exception assumée.** Trois fichiers du moteur de rendu sont des modules ES purs — sans DOM,
sans effet de bord (`src/renderer/package.json` les déclare `type: module`) — et le processus
principal les importe dynamiquement :

- `format.js` : échappement, rendu Markdown, attribution de la parole, regroupements ;
- `export-document.js` : une conversation mise en page en Markdown ou en HTML imprimable ;
- `l10n.js` : les mots de la langue en cours.

La raison est une règle du projet : **un export doit créditer les locuteurs exactement comme
l'écran**, et dans les mêmes mots. Un module partagé est le seul moyen que cela reste vrai. Ces
trois fichiers ne doivent donc jamais toucher `window` ni `document`.

---

## 3. Le chemin de la donnée, de bout en bout

### 3.1 Une passe d'indexation

`Indexer.run()` (`src/core/indexer.js`) :

1. **Découverte.** Chaque adaptateur énumère ses sessions et renvoie des _descripteurs_ — pas de
   contenu. Un descripteur porte notamment le `fingerprint` (« ça a changé ? ») et le
   `folderPath` réel.
2. **Tri.** Pour chaque descripteur, l'indexeur compare le `fingerprint` à celui stocké dans la
   table `sources` :
   - identique → la session est ignorée entièrement, aucun octet n'est lu ;
   - différent → l'adaptateur relit, en repartant du `cursor` stocké.
3. **Extraction.** Les enregistrements bruts passent par `extract.js` (Claude) ou par le
   `*-extract.js` de l'agent, qui décide ce qui est de la conversation.
4. **Écriture.** Les messages sont insérés, le dossier créé ou retrouvé, la session mise à jour.
5. **Archive.** Une session vue disparue est sauvegardée ; une session revenue entière voit sa
   copie supprimée (§ 6).

Le point 2 est ce qui rend l'app utilisable : passe complète sur 342 conversations ≈ 10 s, passe
sans changement ≈ 60 ms tant que l'app tourne.

### 3.2 La sélectivité : pourquoi l'index fait ~1 % de l'entrée

Mesuré deux fois, à deux tailles de corpus : 2,7 Mo de conversation sur 213 Mo de fichiers, puis
toujours **moins de 1 %** quand le corpus a atteint 646 Mo. Les règles :

| Bloc | Stocké | Indexé (recherche) |
|---|---|---|
| texte | oui | **oui** |
| raisonnement (`thinking`) | oui, replié | non |
| appel et résultat d'outil | aperçu tronqué à 2000 caractères | non |
| image, document | métadonnées seules — **le base64 est jeté** | non |

Les enveloppes `<system-reminder>` et les commandes slash sont retirées avant l'indexation : sans
cela, chaque session correspondrait au contenu du fichier d'instructions que l'assistant a chargé
au démarrage — et une recherche sur n'importe quel mot de ce fichier remonterait tout.

### 3.3 Le contrat d'adaptateur

Défini et documenté dans `src/core/agents/contract.js`. Trois fonctions :

- `discover(ctx)` → descripteurs ;
- `read(descriptor, ctx)` → messages + nouveau `cursor` ;
- `canResume(...)` → l'agent sait-il rouvrir _cette_ session ?

Deux chaînes opaques portent tout l'état de reprise, et **ne sont jamais interprétées par
l'appelant** : `fingerprint` (a-t-elle changé ?) et `cursor` (où reprendre). Un adaptateur sur
JSONL y met « taille:mtime » et un décalage d'octets ; un adaptateur sur SQLite y mettrait un
identifiant de ligne. Un adaptateur incapable de reprendre ignore le `cursor` et renvoie tout :
la correction n'en dépend pas, seule la vitesse en dépend.

`ctx.memo` (`src/core/memo.js`) survit d'une passe à l'autre : toute lecture d'en-tête doit y
passer, estampillée par la taille et la date du fichier. C'est ce qui fait qu'une passe sans
changement coûte un `stat` par fichier. Un nouvel adaptateur qui l'ignore rend le rafraîchissement
automatique coûteux.

### 3.4 Les sept adaptateurs

| Agent | Où | Forme | Particularité |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<encodé>/<id>.jsonl` | un enregistrement par ligne | `sessions-index.json` donne le seul chemin exact ; `history.jsonl` survit à la purge des transcriptions |
| Codex | `~/.codex/sessions/AAAA/MM/JJ/rollout-*.jsonl` | idem | en-tête à relire pour le `cwd` (d'où le mémo) |
| Copilot CLI | `~/.copilot/session-state/<uuid>/events.jsonl` | journal d'événements | des dossiers sans fichier d'événements existent |
| Qwen Code | `~/.qwen/projects/<encodé>/chats/<uuid>.jsonl` | un par ligne | — |
| Gemini CLI | `~/.gemini/tmp/<slug>/chats/session-*.jsonl` | **journal de mutations**, pas une liste de messages | il faut rejouer le journal ; les `.json` anciens sont lus aussi |
| Antigravity CLI | `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl` | un par ligne | le protobuf voisin est un leurre ; **aucun dossier de travail enregistré**, il est dérivé et marqué approximatif |
| VS Code Chat | `<config>/User/workspaceStorage/<hash>/` | `state.vscdb` (SQLite) + `chatSessions/*.jsonl` | couvre aussi VSCodium et Cursor ; `state.vscdb.backup` n'est jamais ouvert |

**Ne jamais décoder un nom de dossier pour retrouver un chemin.** L'encodage remplace chaque
caractère non alphanumérique par `-`, ce qui détruit les accents et rend les vrais tirets
ambigus. `paths.decodeHint()` existe pour l'affichage, en dernier recours seulement.

---

## 4. La base

`src/core/schema.sql` — cinq tables et un index plein texte.

| Table | Contenu | À savoir |
|---|---|---|
| `folders` | un dossier réel, **partagé entre agents** | c'est le cœur du produit : une ligne par chemin, quelles que soient les conversations qui s'y rattachent. `path_exact` ne monte jamais vers l'approximation |
| `agents` | un assistant connu | — |
| `sessions` | une conversation | identifiant `agent:session` ; `source` vaut `transcript`, `history` ou `archive` ; `continues_uuid` chaîne une conversation compactée à celle qu'elle poursuit |
| `messages` | un message | `parts` en JSON ; `is_notice` marque ce que personne n'a dit |
| `messages_fts` | index plein texte | FTS5 en _external content_ : seul `text` y entre, les lignes restent dans `messages` |
| `sources` | l'état d'incrémentalité | `fingerprint` et `cursor`, opaques |

Trois déclencheurs tiennent l'index plein texte à jour à l'insertion, la suppression et la mise à
jour. Le tokeniseur est `unicode61 remove_diacritics 2` : « mathematiques » trouve
« Mathématiques ».

**La compaction.** Claude Code compacte en ouvrant un **nouveau fichier** : la personne a vécu une
conversation, le disque en porte deux. L'enregistrement `compact_boundary` nomme le dernier message
du fichier précédent (`logicalParentUuid`) ; l'index le retient et `db.chain()` remonte puis
redescend la chaîne. Les autres assistants compactent dans le même fichier — mesuré — et ne sont
pas concernés.

**`SCHEMA_VERSION` (dans `db.js`) se hausse pour un changement de schéma _ou_ d'extraction.** La
montée **jette toutes les tables et reconstruit** depuis les fichiers des agents — en une dizaine
de secondes — car un fichier inchangé est ignoré et ne verrait jamais les nouvelles règles. C'est
justement pourquoi l'archive existe.

**Une colonne neuve, ce sont quatre endroits et non deux — et les deux qu'on oublie sont ceux de
l'archive.** En ajouter une à `messages` demande : la colonne dans `schema.sql`, l'`INSERT` de
`db.js` (sa liste de colonnes **et** ses paramètres `@nommés`), **`ARCHIVE_MESSAGE_COLUMNS`** et
**`ARCHIVED_MESSAGE_DEFAULTS`**. En oublier un des deux derniers casse précisément la mécanique dont
le seul travail est d'empêcher qu'on perde des conversations :

- La migration lit un index écrit par un schéma **antérieur**, donc elle ne peut jamais nommer une
  colonne d'aujourd'hui — une qui n'existe pas fait échouer la sauvegarde entière, celle-là même qui
  doit précéder le vidage des tables. C'est pourquoi `archiveMessagesSql()` construit sa requête
  depuis `PRAGMA table_info`. Constaté à la dure quand la v10 a ajouté cinq colonnes de jetons :
  `index v9 could not be read for the archive (no such column: tok_input)`.
- Un fichier d'archive est **migré, jamais jeté**, donc un fichier écrit avant l'existence d'une
  colonne revient sans cette clé — et un paramètre nommé que la requête attend mais que la ligne ne
  porte pas fait **lever**, pas `null`. D'où les valeurs par défaut.

`test/db.migration.test.js` garde les deux cas, tous deux vérifiés en échec sans le correctif.

---

## 5. La recherche

- `src/core/query.js` transforme une saisie libre en expression FTS5 valide. Chaque mot devient une
  phrase littérale, le dernier reçoit un joker : taper `it's` ou un `AND` isolé ne doit jamais
  produire d'erreur.
- `db.search()` filtre par portée (partout, agent, dossier, conversation) et par période
  (`src/core/period.js` donne la borne, en jours de calendrier locaux).
- Les extraits reviennent avec des **sentinelles** `\u0001` / `\u0002` autour des mots trouvés,
  jamais du HTML : c'est le moteur de rendu qui échappe d'abord, puis décore (invariant 2).
- Les messages sans horodatage prennent, pour la recherche par date, l'heure du message précédent
  (`MESSAGE_TIME_SQL` dans `db.js`) : 83 prompts d'un corpus réel n'en ont aucun.

---

## 6. L'archive — ce qui n'existe plus nulle part

`src/core/archive.js`, un fichier JSONL par conversation, dans le répertoire de données, **hors de
portée des migrations**.

L'index n'est pas purement dérivé : dès qu'un agent efface une transcription, l'index en détient la
seule copie. Les règles, chacune tenue par un test :

- **des prompts seuls ne remplacent jamais une conversation entière** — une transcription Claude
  effacée revient aussitôt de `history.jsonl` sous une forme appauvrie ;
- **une passe ne sauve que ce qu'aucune source n'a offert**, et seulement pour les agents dont la
  découverte est allée à son terme ;
- **la migration sauve avant de jeter** : tout ce qui n'est pas _prouvé_ présent sur le disque est
  copié d'abord. Quelques copies inutiles, jamais l'inverse ;
- **le format de l'archive se migre et ne se jette jamais** ;
- **« Oublier » efface pour de bon** : `secure_delete`, fusion des segments FTS, `wal_checkpoint`.

---

## 7. Le processus principal

### 7.1 Sécurité

- Fenêtre : `contextIsolation`, `sandbox`, pas d'intégration Node.
- CSP posée sur chaque réponse (`main.js`) : `default-src 'none'`, `script-src 'self'`,
  `connect-src 'none'`. Aucun code distant, aucun `eval`, et la fenêtre n'atteint rien.
- **Un lien dans une conversation s'ouvre dans le navigateur, jamais dans Ariane.** `renderMarkdown`
  ne donne d'adresse qu'à `http(s)`, avec `target="_blank"` ; le clic arrive à
  `setWindowOpenHandler`, qui refuse toujours la fenêtre et ne confie l'adresse à
  `shell.openExternal` que si le processus principal y lit `http:` ou `https:`. `will-navigate`
  refuse tout ce qui n'est pas le `file:` de l'application (`test/links.test.js`).
- **Une seule requête existe, et seulement si la personne l'a demandée.** La clé `updateCheck` de
  `settings.json` — `never` tant qu'on ne l'allume pas — autorise le processus PRINCIPAL à demander
  à GitHub, une fois par lancement, s'il existe une version plus récente
  (`src/main/update-check.js`). Elle est lue avant que quoi que ce soit ne quitte la machine : un
  refus ne fait aucune requête, plutôt que d'en masquer le résultat. Ce qui revient est un numéro et
  un lien ; rien n'est téléchargé et rien n'est exécuté, aucun paquet n'étant signé. L'adresse
  ouverte est reconstruite depuis le manifeste, jamais reçue de la fenêtre.
- Navigation et fenêtres extérieures refusées : un lien s'ouvre dans le navigateur du système.
- **Le moteur de rendu n'est pas digne de confiance** : chaque canal valide sa charge
  (`asInt` rejette les objets, `asId` refuse un identifiant douteux, seul un `true` vaut vrai).
  Les gestionnaires renvoient `{ok, data}` ou `{ok, error}` et ne lèvent jamais à travers le pont.
- L'enveloppe commune attend la langue avant de répondre : aucune réponse ne peut contenir un
  identifiant de message brut à la place d'une phrase.

### 7.2 Lancer un terminal

`src/main/terminal.js` est le seul endroit où Ariane démarre un processus. `spawn` avec un
**vecteur d'arguments** et `shell: false`, jamais une chaîne de commande : un dossier peut
légitimement s'appeler `; rm -rf ~`. Tout est vérifié avant d'ouvrir une fenêtre : le dossier, la
commande, puis l'interpréteur que nomme sa première ligne (`#!/usr/bin/env node`). Le chemin d'une
CLI peut être imposé dans les réglages (§ 8).

### 7.3 Exporter

`src/main/export.js` construit le document **depuis l'index**, jamais depuis ce que le moteur de
rendu envoie (il n'envoie qu'un identifiant et un format). Le PDF s'imprime dans une fenêtre
invisible **avec JavaScript coupé**, à partir d'une page écrite dans un répertoire privé (0700,
fichier 0600) et supprimée aussitôt : une conversation contient tout ce que quelqu'un a jamais
collé.

---

## 8. Les fichiers de la personne : réglages et repères

### 8.1 Les réglages

`<données>/settings.json`, décrit dans `src/main/settings.js`. Deux champs par assistant, et la
séparation **est** la conception :

- `detected` : ce qu'Ariane a trouvé. Elle le réécrit ; c'est un constat, jamais une consigne.
- `command` : à la personne. Ariane ne l'écrit que depuis ce qu'elle a tapé, dans le fichier ou
  dans la fenêtre Réglages.

S'y ajoutent les préférences de l'application : `language` (`auto` ou une étiquette de langue),
`theme` (`auto`, `light`, `dark`), `hiddenAgents` (les assistants masqués dans la barre latérale) et
`splash` (montrer l'écran d'accueil ou non). Un fichier illisible n'est **jamais réécrit**, et les
clés inconnues sont conservées : c'est le travail de quelqu'un.

La géométrie de la fenêtre, elle, n'est **pas** ici : elle vit dans `<données>/window.json`
(`src/main/window-state.js`). Une position change à chaque déplacement de la fenêtre, et l'état
d'une machine n'a rien à faire dans un fichier que quelqu'un ouvre et modifie à la main. Une taille
se transpose d'un écran à l'autre, une position non : elle n'est suivie que si elle tombe encore sur
un écran existant, sinon la fenêtre revient au centre.

### 8.2 Les repères : l'étoile et la note

`<données>/marks.json` (`src/core/marks.js`). Une étoile et une note par conversation, rangées sous
l'identifiant global `agent:sessionId`.

**C'est la seule chose dans Ariane que personne ne peut reconstruire.** Tout le reste — dossiers,
conversations, messages — revient des fichiers des assistants en dix secondes, et `#migrate()` les
jette à chaque changement de schéma. Des favoris rangés dans l'index disparaîtraient à la première
mise à jour ; ils vivent donc dans leur fichier, hors de portée, et sont rattachés à l'identifiant
global parce que c'est le seul qui survive à une réindexation.

**Une étoile sur un message** pose le même problème un cran plus bas, et il n'a pas de réponse
unique : mesuré sur un corpus réel, 98 % des messages de Claude portent un identifiant propre, 91 %
de ceux de Codex, 74 % de ceux de Copilot — et **aucun** de ceux de VS Code. Une marque enregistre
donc plusieurs coordonnées — l'identifiant s'il existe, la position, le rôle, la date, le début du
texte — et se résout par la plus fiable qui corresponde encore. Le texte rattrape une position
décalée parce que l'extraction a changé : c'est-à-dire exactement le moment où l'index est
reconstruit.

Les règles, chacune tenue par un test qui échoue sans elle :

- un fichier **illisible n'est jamais réécrit** — il contient les mots de quelqu'un ;
- les clés inconnues sont gardées, aux deux niveaux ;
- une entrée sans étoile ni note est retirée plutôt que stockée vide ;
- l'écriture est atomique : un fichier temporaire, puis un renommage ;
- **« Oublier », c'est oublier** : la marque part avec le reste.

Une étoile posée sur une conversation que l'index ne contient plus est **gardée** — sa
transcription peut revenir — mais la vue « Favoris » ne montre que ce qui existe.

---

## 9. Les langues

`src/locales/<étiquette>.ftl`, au format **Fluent** (celui de Firefox). `en.ftl` est la référence
et le repli ; **ajouter une langue, c'est ajouter un fichier** — `src/main/locale.js` lit le
répertoire.

- `src/renderer/l10n.js` : le moteur (module ES pur, partagé avec le processus principal). Il tient
  aussi les dates, les temps relatifs, les nombres, les tailles et les listes, par `Intl`.
- `src/renderer/l10n-dom.js` : `data-l10n-id` sur un élément lui donne son texte et ses attributs.
- La grammaire d'une langue vit dans son fichier : le code ne passe qu'un nombre.
- **Les frontières transportent des codes, pas des phrases** : l'index stocke `away-summary` ou
  `failure`, `resume.js` renvoie des codes de note, l'IPC des codes de raison.

---

## 10. L'interface

Un seul fichier mène la danse, `src/renderer/app.js`, aidé de modules spécialisés :

| Fichier | Rôle |
|---|---|
| `format.js` | échapper puis décorer ; qui parle ; regrouper les rafales d'outils |
| `transcript-view.js` | peindre une conversation **par tranches** (120 lignes tout de suite, le reste pendant les temps morts) |
| `settings-dialog.js` | la fenêtre Réglages |
| `icons.js` | une famille d'icônes construites en DOM — rien à charger, rien à autoriser dans la CSP |
| `export-document.js` | la mise en page d'un export (partagée avec le processus principal) |

**Le mot cherché est surligné dans la conversation**, et pas seulement dans l'extrait : ouvrir un
résultat emporte les mots de la recherche (`state.searchTerms`), qui sont marqués partout où ils
apparaissent. Le piège est la peinture par tranches — un surlignage posé à l'ouverture ne toucherait
que les 120 premières lignes. La vue prévient donc à chaque tranche peinte (`onPaint`), et le
marqueur est **idempotent** : il refuse les nœuds déjà dans un `<mark>`, puisque le surlignage de
recherche et celui du Ctrl+F peuvent être allumés en même temps.

Deux règles tiennent tout le reste :

1. **Échapper, puis décorer.** `innerHTML` ne reçoit jamais que la sortie de
   `renderMarkdown` / `renderSnippet` ; tout le reste passe par `textContent`.
2. **Ne jamais mettre de mots dans la bouche de quelqu'un.** `speakerOf()` renvoie un rôle
   (`'you'`, `'assistant'`, ou rien) : sur un corpus réel, 88 % des enregistrements de rôle
   « user » étaient des sorties d'outils ou des avis du harnais.

---

## 11. Cycle de vie

1. `main.js` pose la CSP, appelle `registerIpc`, puis crée la fenêtre — à la taille et à la place
   retenues du dernier lancement — et, si les réglages le demandent, l'écran d'accueil au-dessus
   d'elle.
2. `registerIpc` ouvre l'index, l'archive, le mémo, les réglages, et **charge la langue**.
3. Le moteur de rendu demande la langue, localise la page, puis charge l'état et l'arbre.
4. Une indexation est lancée au premier démarrage, ou quand un agent est apparu depuis la dernière
   fois.
5. Ensuite, une passe silencieuse toutes les 30 s tant que la fenêtre est visible, et une au retour
   du focus. Jamais deux à la fois : le processus principal garde la passe en cours (`state.indexing`
dans `ipc.js`) et la partage avec tout appel qui arrive pendant qu'elle tourne.

---

## 12. Ce qui a été mesuré

**C'est ici que vivent les chiffres du projet.** Les autres documents renvoient à cette section
plutôt que de les recopier : le corpus grossit tous les jours, et trois documents ont déjà porté
trois totaux différents.

### Les suites, mesurées par la CI le 24 septembre 2026

| | Unitaires | Rendu | Mise en page | Accueil | Réseau |
|---|---|---|---|---|---|
| linux | 787 / 787 | 168 | 28 | 7 | 7 |
| macos | 787 / 787 | 168 | 28 | 7 | 7 |
| windows | 771 / 772 | 168 | 28 | 7 | 7 |

Windows en exécute quinze de moins et en compte un sans le passer : ce sont les `POSIX_ONLY` de
`terminal.test.js`, déclarés avec leur raison — bits d'exécution, shebangs, exécutables sans
extension. Une abstention écrite, pas un trou.

**Ne recopiez pas ces chiffres ailleurs.** Quatre documents en ont déjà porté trois différents, et
c'est précisément ce que cette section existe pour empêcher.

### Couverture, 24 septembre 2026

`npm run test:coverage` — **96,72 % des lignes, 87,89 % des branches, 94,89 % des fonctions.**

**Elle ne mesure que la suite unitaire.** Les cinq suites Electron n'y sont pas comptées, donc un
fichier qu'elles seules éprouvent paraît bas : `src/main/update-check.js` affiche 62 % parce que
`electronRequest` — la seule fonction d'Ariane qui parle au réseau — est couverte par
`test/ui/net.test.js`, que la mesure ne voit pas. Ce chiffre dit « ce que `npm test` prouve », pas
« ce qui est testé ».

Le corpus, mesuré le **20 septembre 2026** sur la machine de développement :

| Assistant | Conversations | Sur disque | Prose |
|---|---:|---:|---:|
| Codex | 222 | 398 Mo | 2,5 Mo |
| Claude Code | 70 | 370 Mo | 3,1 Mo |
| Gemini CLI | 20 | 6 Mo | 0,18 Mo |
| Copilot CLI | 18 | 6 Mo | 0,18 Mo |
| VS Code Chat | 14 | 403 Mo | 0,17 Mo |
| Antigravity CLI | 15 | 49 Mo | 0,13 Mo |
| Qwen Code | 0 | 1 Mo | — |
| **total** | **359** | **≈ 1,25 Go** | **6,2 Mo** |

**44 081 messages, 52 dossiers** — relevés dans l'index lui-même le jour dit. La prose pèse **un
demi pour cent** de ce qui est lu. Ces chiffres bougent en permanence : l'index a gagné des messages
pendant la mesure elle-même, ceux de la conversation qui l'écrivait.

Les durées ci-dessous datent du **19 septembre 2026**, quand le corpus comptait 342 conversations
et 38 691 messages.

| Mesure | Valeur | Où |
|---|---|---|
| passe complète | ≈ 10 s | six agents |
| passe sans changement | ≈ 60 ms (app ouverte), ≈ 420 ms (premier passage) | grâce à `memo.js` |
| part de conversation dans l'entrée | 2,7 Mo sur 213 Mo | `extract.js` |
| plus grosse conversation | 6 642 messages | ouverture : 840 ms → **13 ms** par tranches |
| export PDF | 400 messages → 51 pages A4 en 0,8 s | sans figer l'app |
| couverture de `terminal.js` | 95,5 % des lignes | le seul fichier qui lance un processus |

Ces chiffres viennent de mesures, pas d'estimations. Les remesurer plutôt que les recopier.

---

## 13. La liaison native, et le piège qui coûtait le plus cher

`better-sqlite3` est un module natif, et ce fait a longtemps été le plus coûteux de ce dépôt.
Electron et le Node qui lance les tests n'exposaient pas la même `NODE_MODULE_VERSION`, et charger
la mauvaise liaison n'est pas une erreur qu'on rattrape : le processus meurt sur un `SIGILL`, sans
exception et sans message. Il fallait compiler et garder deux binaires, un par moteur. Il fallait
surveiller l'empaqueteur, qui embarquait ce que `node_modules` contenait — et il s'est trompé deux
fois : un ELF dans `Ariane.exe`, puis une ABI 127 dans un `.deb` Electron qui s'installait,
s'ouvrait, et mourait à la première requête. `src/core/binding.js`, `scripts/save-binding.js`,
`scripts/native-prebuild.js` et `build/after-pack.js` n'existaient que pour ça.

**`better-sqlite3` 13 est passé à Node-API, et le problème est parti avec.** Un binaire Node-API
n'est pas lié à une `NODE_MODULE_VERSION` mais à un niveau de Node-API, que chaque moteur maintient
compatible. Un fichier par système, `prebuilds/<plateforme>-<arch>.node`, choisi par la bibliothèque
elle-même au chargement : plus rien ici ne sélectionne quoi que ce soit, et il n'y a plus rien à
reconstruire après un `npm install` ou un saut d'Electron. Il n'y a plus de `postinstall`, et
aucun compilateur C++ n'est nécessaire pour travailler sur Ariane — sur Linux, npm lance encore un
`node-gyp rebuild` implicite, donc `python3` et `make` doivent exister, mais ils ne construisent
rien.

Le paquet publié emporte un binaire pour chaque système qu'il gère, donc un paquet construit pour un
autre est juste par construction : `--win` depuis Linux embarque `win32-x64.node` parce que ce
fichier était déjà dans `node_modules`. Aucune des deux pannes ci-dessus ne peut se reproduire.

Ce qui remplace le piège est un plancher, et c'est la seule chose qu'il reste à retenir :

| moteur | Node-API | verdict |
| --- | --- | --- |
| Node 22.13 et avant | 9 | segfault au premier `new Database()` |
| **Node 22.14+** | 10 | supporté |
| Electron 33 | 9 | inutilisable |
| **Electron 44+** | 10 | supporté |

Le plancher est réel et il mord en silence : `better-sqlite3` déclare `engines: node >= 22`, ce qui
est trop large — 22.12 le satisfait et meurt quand même. `package.json` porte la version qui marche
vraiment, `>= 22.14`.

La mécanique disparue, et les deux paquets qu'elle a laissé partir faux, restent racontés dans
`CHANGELOG.md`.

## 14. Les tests

| Suite | Commande | Ce qu'elle attrape, et que les autres ne voient pas |
|---|---|---|
| unitaires | `npm test` | la logique, sur un vrai `~/.claude` jetable (`test/helpers/fixture.js`) — streaming, décalages, analyse réellement exercés |
| rendu | `npm run test:render` | ce qui vit dans le DOM : l'attribution de la parole, les tranches, la recherche, l'export, les réglages, la pseudo-langue |
| mise en page | `npm run test:ui` | le CSS calculé et la géométrie de défilement (le piège `min-height: auto`) |
| écran d'accueil | `npm run test:splash` | une page qui s'ouvre avant tout le reste : ses trois sorties, ses phrases venues du pont, et qu'elle n'atteint rien d'autre |
| hygiène | inclus dans `npm test` | octets de contrôle bruts dans les sources, catalogues de langue divergents |

Les suites Electron existent parce que le pire défaut du projet — créditer la personne de la sortie
de `git status` — passait tous les tests unitaires de `speakerOf()` pendant que l'écran se trompait.

---

## 15. Où changer quoi

| Je veux… | Fichier |
|---|---|
| ajouter un assistant | un module sous `src/core/agents/`, puis `agents/index.js` ; lire `contract.js` d'abord |
| changer ce qui est indexé | `extract.js` ou le `*-extract.js` de l'agent, **et hausser `SCHEMA_VERSION`** |
| ajouter une colonne à `messages` | `schema.sql`, l'`INSERT` de `db.js`, **et les deux constantes d'archive** — voir § 4 |
| toucher aux marques | `src/core/marks.js` ; elles vivent dans `marks.json`, jamais dans l'index |
| ajouter une phrase à l'écran | `src/locales/en.ftl` **et tous les autres fichiers** ; jamais dans le code |
| ajouter une langue | déposer `src/locales/<étiquette>.ftl` ; rien d'autre |
| ajouter un canal IPC | `src/main/ipc.js` (+ la liste `CHANNELS`), puis `src/preload/preload.js` |
| toucher à la recherche | `src/core/query.js` (expression), `db.search` (filtres), `app.js` (affichage) |
| toucher à l'export | `src/renderer/export-document.js` (mise en page), `src/main/export.js` (fichier, PDF) |
| changer la façon dont une CLI est trouvée | `src/main/terminal.js`, et se souvenir que les réglages priment |
| changer le rendu du Markdown | `renderMarkdown` dans `src/renderer/format.js`, son style dans `styles.css` **et** dans `export-document.js` (papier) ; comparer l'ancien et le nouveau sur tout le corpus |
| toucher à la vérification de version | `src/core/update.js` (comparer), `src/main/update-check.js` (demander), `app.js` (le bouton) |
