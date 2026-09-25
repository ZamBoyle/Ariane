<p align="center">
  <a href="README.md">English</a> · <a href="README.fr.md">Français</a>
</p>

![Ariane](docs/banner.jpg)

# Ariane

**Le fil pour retrouver toutes vos conversations d'assistants de code — quel que soit l'assistant.**

Claude Code, Codex, Copilot CLI, Qwen, Gemini, la CLI d'Antigravity et le panneau de chat de
VS Code archivent chacun vos
conversations sur votre disque. Dans sept formats différents, sous sept répertoires différents, sans
aucun moyen de les parcourir — et surtout sans jamais se voir entre eux.

Ariane les réunit, et les classe par **dossier de travail**.

![Ariane](docs/ariane.png)

---

## L'idée

Vous n'avez pas travaillé sur un projet « avec Claude ». Vous avez travaillé **sur un projet**, et
selon les jours vous aviez Claude, Codex ou Copilot sous la main.

Aucun éditeur ne montrera jamais ça : chacun ne voit que ses propres données. Sur la machine de
développement de ce projet, **20 dossiers** avaient été travaillés par plusieurs assistants, dont
deux par cinq d'entre eux :

| Dossier | Assistants | Conversations |
|---|---|---:|
| un projet de jeu rétro | Codex · Claude · Gemini · Copilot · VS Code | **72** |
| un dossier de documents | Claude · Codex · Copilot · Gemini · VS Code | **46** |
| le dossier personnel | Claude · Codex · Copilot · VS Code | 39 |

<sub>Chiffres réels, noms de dossiers remplacés : ce sont de vrais répertoires de travail.</sub>

---

## Ce que ça fait

- **Tous vos dossiers de travail**, avec le vrai chemin — accents compris, jamais le nom encodé
  illisible que certains assistants utilisent sur disque.
- **Une pastille par assistant** sur chaque dossier, et une sur chaque conversation : un dossier se
  lit comme une seule liste, la plus récente en tête, quel que soit l'assistant qui l'a écrite.
- **Recherche plein texte instantanée**, insensible aux accents : `mathematiques` trouve
  `Mathématiques`. Partout, ou ciblée sur un assistant, un dossier, une conversation — et sur
  une période : 7 jours, 30 jours, cette année.
- **Une conversation compactée reste une conversation** : quand Claude Code la coupe en deux
  fichiers, Ariane le dit — « Partie 2 sur 3 » — et vous emmène d'une partie à l'autre.
- **Les sous-agents, rejoints d'où ils sont partis** : la transcription que Claude Code ou Codex
  écrit pour chaque sous-agent est lue, et s'ouvre depuis la conversation qui l'a lancé — un
  workflow de 300 agents n'enterre pas votre liste. Ce qu'ils ont coûté est montré à part, et
  comme un minimum. Une conversation **reprise** ne montre que ce qu'elle a ajouté, et dit où est
  le reste.
- **Vos repères** : une étoile sur une conversation **ou sur un message précis**, une note sous le
  titre, et une vue qui ne montre que ce qui est marqué. Elles vivent dans un fichier à vous, hors de l'index :
  une mise à jour d'Ariane ne peut pas les effacer.
- **Ce que coûte chaque message** : sous chaque réponse, les jetons envoyés, reçus et relus depuis
  le cache — la même ligne que sous le nom de la conversation. De quoi montrer, en formation, que
  le contexte relu à chaque tour pèse bien plus que la réponse elle-même.
- **Des statistiques** : qui a écrit quoi — les messages que vous avez tapés, les réponses, les
  sorties d'outils —, puis les jetons envoyés, reçus et relus depuis le cache, mois par mois, par
  assistant, par modèle et par dossier. Elles disent combien de conversations ont vraiment été
  mesurées, et n'estiment rien : aucun montant en dollars tiré d'une grille de prix. Et les
  **limites d'utilisation** telles que les assistants les ont écrites — la semaine de Codex et ses
  crédits ; la semaine en cours de Claude et son historique — si Claude Desktop est installé —, son
  dernier relevé et chaque requête que sa limite a refusée —, lues dans leurs fichiers, jamais
  demandées à un serveur.
- **Dans votre langue** : français, anglais, néerlandais, allemand, espagnol, italien, portugais
  (Brésil), japonais et chinois — celle du système par défaut, une autre au choix dans les
  Réglages. Ajouter une langue, c'est ajouter un fichier dans `src/locales/`.
- **La taille du texte**, de 90 à 130 % : dans les Réglages, ou avec Ctrl + et Ctrl −, le pavé
  numérique compris.
- **Lecture confortable** : Markdown rendu, raisonnements repliés, et les rafales d'appels d'outils
  regroupées en un seul bandeau dépliable au lieu de vingt bulles.
- **Attribution honnête** : l'outil qui répond n'est pas vous. Voir plus bas — c'est le point le
  plus important du projet.
- **Récupération des conversations purgées** : quand une transcription disparaît, vos prompts
  survivent souvent ailleurs et restent consultables.
- **Prévenue quand une version plus récente existe** — si vous le demandez. Éteint tant que vous
  ne l'allumez pas, une requête au lancement, un bouton qui attend à côté de l'engrenage : rien
  n'est téléchargé, rien n'est exécuté.
- **Lecture seule.** Ariane n'écrit jamais dans les répertoires des assistants.

---

## Assistants pris en charge

Mesures réelles, pas des estimations — sur une machine, le 20 septembre 2026. Un corpus grossit
tous les jours : ces chiffres valent pour ce jour-là.

| Assistant | Où | Conversations | Sur disque | Prose |
|---|---|---:|---:|---:|
| **Codex** | `~/.codex/sessions/` | 222 | 398 Mo | 0,64 % |
| **Claude Code** | `~/.claude/projects/` | 70 | 370 Mo | 0,83 % |
| **Gemini CLI** | `~/.gemini/tmp/*/chats/` | 20 | 6 Mo | 3,0 % |
| **Copilot CLI** | `~/.copilot/session-state/` | 18 | 6 Mo | 2,9 % |
| **VS Code Chat** | `~/.config/Code/User/workspaceStorage/` | 14 | 403 Mo | 0,04 % |
| **Antigravity CLI** | `~/.gemini/antigravity-cli/brain/*/` | 15 | 49 Mo | 0,27 % |
| **Qwen Code** | `~/.qwen/projects/*/chats/` | 0 | 1 Mo | — |

Total indexé : **359 conversations, 44 081 messages, 52 dossiers** — lues en une dizaine de
secondes. Sur ~1,25 Go de fichiers, la prose pèse **6,2 Mo** : un demi pour cent.

**Antigravity CLI** (`agy`) range ses données dans `~/.gemini/`, avec Gemini CLI, sans être Gemini :
ce sont deux outils et deux adaptateurs.

VS Code Chat couvre aussi **VSCodium et Cursor**, qui partagent son stockage. Le panneau de chat de
l'éditeur, pas Copilot CLI : ce sont deux produits distincts.

### Reprendre une conversation

Quatre assistants savent rouvrir exactement la session affichée. Le bouton **Reprendre** ouvre un
terminal dans le bon dossier :

| Assistant | Commande |
|---|---|
| Claude Code | `claude --resume <id>` |
| Codex | `codex resume <id>` |
| Copilot CLI | `copilot --resume=<id>` |
| Qwen Code | `qwen --resume <id>` |

Gemini ne sait reprendre que « la dernière » — le bouton le dit plutôt que d'ouvrir silencieusement
une autre conversation. VS Code n'expose rien : `code chat` démarre une session, il n'en rouvre pas.

Ariane cherche chaque commande dans le PATH, les répertoires système et chez les gestionnaires de
versions courants (nvm, fnm, Volta, asdf, mise, npm global, scoop…). Si elle ne la trouve pas, ou
pas l'interpréteur dont elle a besoin (`node`), elle le dit au lieu d'ouvrir un terminal qui se
referme aussitôt, et propose d'**ouvrir les réglages**.

La fenêtre **Réglages** (la roue dentée, en haut à gauche) liste les assistants trouvés sur la
machine ou présents dans vos conversations. Pour chacun : ce qu'Ariane a trouvé, un chemin à
imposer — tapé ou choisi avec **Parcourir…** — et, vérifié à mesure, s'il marchera. **Ajouter un
assistant** propose les autres qu'Ariane sait reprendre. **Ouvrir le fichier JSON** ouvre le
fichier lui-même dans votre éditeur :

```json
"codex": {
  "command": "",
  "detected": "/home/vous/.nvm/versions/node/v22.12.0/bin/codex"
}
```

`detected` est ce qu'Ariane a trouvé ; `command` est à vous — vide, Ariane cherche ; un chemin
absolu, Ariane utilise celui-là. Le fichier, `settings.json`, vit dans le dossier de données de
l'app (`~/.config/Ariane` sous Linux, `%APPDATA%\Ariane` sous Windows,
`~/Library/Application Support/Ariane` sous macOS). S'il devient illisible, Ariane ne le réécrit
pas : la fenêtre le dit et propose de l'ouvrir pour le corriger.

### Écartés, et pourquoi

Trois assistants ont été étudiés puis abandonnés. Les raisons sont consignées pour que la question
ne soit pas reposée à zéro :

- **Copilot dans l'IDE** — le format est lisible, mais **aucun chemin de projet n'est stocké**.
  Les répertoires sont nommés par KSUID. Or l'attribution à un dossier est la raison d'être
  d'Ariane. Gain mesuré : 8 messages.
- **Antigravity** — les conversations sont deux fichiers `.pb` de 21 Mo à **8,00 bits/octet
  d'entropie**, le maximum théorique. Compressés ou chiffrés, sans schéma public. Rien à lire.
- **Cursor** — son stockage est lu avec celui de VS Code, mais il ne contenait qu'un espace de
  travail de démonstration, avec une bulle vide.

---

## Installation

### Télécharger

Les paquets prêts à l'emploi sont attachés à chaque version —
**[la dernière](https://github.com/ZamBoyle/Ariane/releases/latest)**. Rien d'autre n'est
nécessaire : ni Node, ni compilateur, ni clone.

| Système | Fichier | Quoi en faire |
|---|---|---|
| **Linux**, toute distribution | `Ariane-<version>.AppImage` | `chmod +x`, puis on lance. Aucun droit root, aucun gestionnaire de paquets. |
| **Debian**, Ubuntu | `ariane_<version>_amd64.deb` | `sudo dpkg -i ariane_*.deb` |
| **Windows** | `Ariane.Setup.<version>.exe` | l'installeur |
| **Windows**, sans rien installer | `Ariane.<version>.exe` | portable — on le lance là où il est |
| **macOS**, Apple Silicon | `Ariane-<version>-arm64.dmg` | on l'ouvre, on glisse Ariane dans Applications |

**Rien de tout cela n'est signé**, et les deux systèmes que ça regarde le disent :

- **Windows** affiche « éditeur inconnu » via SmartScreen. Informations complémentaires → Exécuter
  quand même.
- **macOS** met un `.dmg` téléchargé en quarantaine et le déclare endommagé, ce qu'il n'est pas :
  `xattr -dr com.apple.quarantine /Applications/Ariane.app`

Un certificat ne rendrait pas Ariane plus sûre — il ferait seulement disparaître ces deux boîtes de
dialogue, pour quelques centaines d'euros par an. **Une application qu'on a compilée soi-même n'a
ni l'un ni l'autre problème** : macOS ne met en quarantaine que ce qui a été téléchargé.

Le `.dmg` est **réservé aux Mac Apple Silicon** pour l'instant. Un Mac Intel doit construire depuis
les sources.

### Depuis un clone

```bash
git clone <ce dépôt> ariane
cd ariane
npm install
npm start
```

C'est tout. Vérifié en clonant le dépôt dans un dossier vierge : `npm install`
puis `npm test` passent sans autre préparatif. Les chiffres des suites vivent dans
[`ARCHITECTURE.fr.md`](ARCHITECTURE.fr.md) § 12, mesurés et datés.

**Prérequis : Node 22.14 ou plus récent, et rien d'autre.** En particulier,
*aucun compilateur C++ n'est nécessaire* — contrairement à ce qu'on attend d'un
projet qui embarque un module natif. `better-sqlite3` livre un binaire Node-API
par système, et `npm install` se contente de le déposer : rien ne se compile, et
rien n'est à reconstruire quand Electron change de version.

La réserve tient en une ligne : le plancher est Node-API 10, arrivé dans Node
22.14. Un Node plus ancien s'installe sans broncher, puis meurt à la première
requête — `better-sqlite3` déclare `engines: node >= 22`, ce qui est plus large
que ce qu'il supporte réellement.

npm reçoit donc l'ordre de refuser plutôt que d'avertir. `.npmrc` pose
`engine-strict=true`, et un Node plus ancien arrête l'installation en nommant
les deux versions :

```
npm error notsup Required: {"node":">=22.14"}
npm error notsup Actual:   {"node":"v20.19.0","npm":"10.8.2"}
```

C'est tout le prérequis. Rien d'autre à installer, aucun gestionnaire de
versions à apprendre.

Ni Python, ni `make`. npm lance un `node-gyp rebuild` implicite pour tout paquet
portant un `binding.gyp`, et `better-sqlite3` en porte un alors que son binaire
est déjà livré. Sous Linux, cela réclamait python3 et make pour ne rien
construire ; sous Windows, cela échoue franchement — gyp trouve un Python qu'il
ne peut pas exécuter et emporte toute l'installation. `.npmrc` pose donc
`ignore-scripts=true`. Rien dans l'arbre n'a besoin d'un script : le seul autre
appartient à electron-winstaller, pour une cible Squirrel que ces paquets
n'utilisent pas, et Electron n'en déclare aucun — il télécharge son binaire au
premier usage.

### Si Electron refuse de démarrer sur une bibliothèque manquante (Linux)

Sur un Linux minimal — WSL, un conteneur, une image de CI — Electron réclame
des bibliothèques système que `npm install` n'apporte pas : une Ubuntu de
bureau les a déjà, une Ubuntu nue non. Ce sont celles de `build.deb.depends`,
que le `.deb` installe tout seul et qu'un clone des sources n'installe pas.
Sur une Ubuntu 24.04 nue, il en manquait quatre :

```bash
sudo apt install -y libnss3 libnotify4 libsecret-1-0 xdg-utils
```

Sans elles, le binaire ne démarre pas du tout : `error while loading shared
libraries: libnspr4.so`.

### Si le lancement s'interrompt sur `chrome-sandbox` (Linux)

Une fois par installation d'Electron :

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

### Mettre à jour un clone

```bash
git pull
npm ci
npm start
```

**`git pull` seul ne suffit pas.** Il apporte le code, pas ce que contient
`node_modules` : quand une version change une dépendance, l'ancienne y reste
tant que npm ne repasse pas. La 0.6.0 en est une — elle fait passer Electron
de la 44.4.3 à la 44.4.5. `npm ci` vide `node_modules` et installe exactement
ce que nomme `package-lock.json` : c'est le choix sûr après chaque `git pull`.
Le premier lancement télécharge ensuite le nouvel Electron (une centaine de Mo,
une fois par version), et sous Linux l'étape `chrome-sandbox` ci-dessus est à
refaire : ce fichier a été réinstallé avec lui.

### Construire les paquets soi-même

```bash
npm run dist          # tout ce que cette machine sait produire
npm run dist:deb      # seulement le .deb        <- le plus utile sous Ubuntu
npm run dist:linux    # AppImage + .deb
npm run dist:setup    # l'installeur Windows     <- l'équivalent du .deb
npm run dist:exe      # le .exe portable, rien à installer
npm run dist:win      # les deux paquets Windows
npm run dist:mac      # .dmg                         (exige un Mac)
```

**Qui peut construire quoi :**

| Cible | Sous Windows | Sous Linux | Sous macOS |
|---|---|---|---|
| `.deb`, AppImage | — | oui | — |
| `.exe` portable, installeur NSIS | oui, tel quel | **exige `wine`** | **exige `wine`** |
| `.dmg` | — | — | oui |

Autrement dit, `wine` est nécessaire dès que l'hôte n'est **pas** Windows — ce
n'est pas une particularité de Linux. Sous Ubuntu : `sudo apt install wine
wine64`. Vérifié en le masquant : electron-builder s'arrête net sur « wine is
required ».

**Les paquets ne sont pas signés**, et ça se voit surtout ailleurs que sur la
machine qui les fabrique :

- un `.exe` téléchargé déclenche l'avertissement « éditeur inconnu » de
  SmartScreen ;
- un `.dmg` téléchargé est mis en quarantaine par macOS, qui annonce alors
  « Ariane est endommagée et ne peut pas être ouverte » — le fichier est
  intact, c'est Gatekeeper. `xattr -dr com.apple.quarantine /Applications/Ariane.app`
  lève la quarantaine, ou un clic droit → Ouvrir.

**Une application compilée sur place n'a aucun de ces problèmes** : macOS ne met
en quarantaine que ce qui a été téléchargé. Sur un Mac, `npm install` puis
`npm run dist:mac` est donc le chemin le plus court — et le seul qui ne demande
ni compte développeur Apple ni 99 $ par an.

La liaison native, elle, n'est jamais compilée — ni ici, ni ailleurs.
`better-sqlite3` publie un binaire Node-API par système et les embarque tous
dans son paquet npm, donc une construction destinée à une autre plateforme
emporte mécaniquement le bon fichier. C'est ce qui rend `npm run dist:win`
depuis Linux sûr sans vérification particulière.

Les fichiers atterrissent dans `dist/`, qui n'est pas versionné. Après
modification du code, il faut reconstruire **et réinstaller** pour que l'app
installée en bénéficie :

```bash
npm run dist:deb && sudo dpkg -i dist/ariane_0.1.0_amd64.deb
```

Ces commandes passent par `scripts/dist.js`, qui retire `LD_PRELOAD` de
l'environnement avant d'appeler electron-builder. Plusieurs bureaux Linux y
injectent une bibliothèque (`libgtk3-nocsd.so.0` sous Ubuntu) qui ne peut pas
être préchargée dans les binaires auxiliaires du constructeur ni dans Wine : la
construction échoue alors sur un `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` qui ne
nomme rien.

---

## Utilisation

La disposition reprend celle de Claude Desktop : les dossiers à gauche, la conversation à droite,
et — à la place de la zone de saisie — **la recherche**.

| Raccourci | Effet |
|---|---|
| `Ctrl/Cmd + K` | aller à la recherche |
| `Ctrl/Cmd + F` | chercher dans la conversation ouverte — `Entrée` suivant, `Maj + Entrée` précédent |
| `Alt + ↑` `Alt + ↓` | votre message précédent, suivant, dans la conversation ouverte |
| `Ctrl/Cmd + R` | réindexer tout de suite — Ariane le fait seule toutes les 30 s, et à chaque retour sur la fenêtre |
| `↑` `↓` | parcourir les résultats |
| `Entrée` | ouvrir le résultat, à la bonne position dans la conversation |
| `Échap` | fermer les résultats |

La liste déroulante à gauche de la barre choisit la portée : **Partout**, un assistant précis, le
dossier ouvert, ou la conversation en cours. La suivante choisit la période : **Toutes les dates**,
les **7** ou **30 derniers jours** (aujourd'hui compris, depuis minuit), ou **cette année**. Chaque
résultat indique quand il a été écrit.

Chaque bouton porte une icône qui dit ce qu'il fait ; dans une fenêtre étroite, les icônes
restent seules et leur nom s'affiche au survol.

**Exporter**, en haut d'une conversation, l'enregistre en **Markdown** ou en **PDF**, dans
l'ordre où elle s'affiche : titre, assistant, dossier, dates et sens de lecture en tête, qui parle
clairement marqué, code en blocs, appels d'outils résumés. Chaque message a aussi son bouton **Copier**.

Une conversation s'ouvre sur son **dernier message, en haut**. Le bouton **Plus récent en haut /
Plus ancien en haut**, dans son en-tête, inverse l'ordre pour la relire depuis le début. L'ordre
appartient à chaque conversation : en inverser une ne change pas les autres. Il tient tant que
l'app est ouverte ; au lancement suivant, toutes repartent du plus récent en haut.

Même très longue — des milliers de messages — une conversation s'ouvre sans figer la fenêtre : ce
qui est à l'écran s'affiche aussitôt, le reste suit en tâche de fond. À droite, un **plan** montre
un trait par message que vous avez écrit ; un clic y mène, l'infobulle en donne le début et la
date.

---

## Vos données restent chez vous

Ariane **lit** les répertoires des assistants et n'y écrit jamais. Son index vit dans le répertoire
de données de l'application (`~/.config/Ariane` sous Linux), **hors du dépôt** : aucune conversation
n'est jamais versionnée ni distribuée. La fenêtre, elle, n'atteint rien : elle applique
`Content-Security-Policy: default-src 'none'; connect-src 'none'`.

Une seule requête existe, et seulement si vous la demandez. **Réglages → Mises à jour** propose
d'interroger GitHub, une fois au lancement, pour savoir s'il existe une version plus récente. Elle
est **éteinte tant que vous ne l'allumez pas**, elle part du processus principal et jamais de la
fenêtre, et tout ce qu'elle fait est d'afficher un numéro de version et un lien : rien n'est
téléchargé, rien n'est exécuté. Demander apprend à GitHub une adresse, une version et la fréquence
à laquelle cette machine démarre l'application — c'est pourquoi le choix vous revient.

---

## Sous le capot

> Le détail complet — le chemin de la donnée, le contrat d'adaptateur, le schéma de la base, le
> modèle de sécurité — vit dans [ARCHITECTURE.fr.md](ARCHITECTURE.fr.md).

### La sélectivité, ou pourquoi c'est rapide

Ce qui est stocké n'est presque jamais de la conversation. Sur le corpus mesuré ci-dessus — 1,2 Go
— la prose représente **un demi pour cent**. Le reste — sorties d'outils, instantanés de fichiers, pièces jointes en
base64 — est conservé sous forme d'aperçu tronqué pour l'affichage, ou réduit à ses métadonnées,
mais **jamais indexé**. C'est ce qui rend la recherche à la fois rapide (2–8 ms) et pertinente.

### L'indexation est incrémentale

Un fichier inchangé n'est pas rouvert ; un fichier qui a grandi est relu depuis son dernier
offset. Passage complet : ~10 s. Tant que l'app est ouverte, un passage sans changement coûte
**~60 ms** — un `stat` par fichier, rien de plus — ce qui permet de se tenir à jour toutes les 30 s
sans que cela se sente. La première passe après le lancement, elle, relit les en-têtes : ~400 ms.

Rafraîchir ne fait pas perdre sa place : les dossiers ouverts le restent, et une conversation en
cours de lecture n'est repeinte que si des messages y sont arrivés — on reste en bas si on y était.

### Ne jamais vous faire dire ce que vous n'avez pas dit

Les formats enregistrent les **résultats d'outils** et les **blocs injectés par le harnais** sous le
rôle `user`, parce que c'est ainsi que l'API les transporte. Sur 7 298 enregistrements de ce rôle,
**885 seulement (12 %) avaient réellement été tapés par la personne** — 6 128 étaient des sorties
d'outils, 285 des avis du système.

Ariane ne crédite personne pour ceux-là. C'est l'invariant numéro un du projet, avant même
l'échappement HTML.

### Et ne jamais perdre ce que vous avez dit

Le symétrique, et la source des défauts les plus coûteux du projet. Un message tapé **pendant que
l'assistant travaille** est mis en file d'attente, et s'il en est retiré, cet enregistrement est le
seul endroit où il existe. Le traiter comme de la plomberie faisait disparaître la moitié d'une
conversation.

Six types d'enregistrements ont été récupérés après coup, chacun contenant des mots qui
n'existaient nulle part ailleurs : messages en file d'attente, pointeurs `last-prompt` (11 uniques
sur 101, comptés exactement le 25 septembre 2026), commandes différées (35 sur 109), **résumés de session** écrits pour vous pendant votre
absence (71), contenus **collés** dans un prompt dont la transcription a été purgée (7 sur 510), et
la **raison d'un échec** que VS Code enregistrait pendant que l'affichage laissait croire à une
question ignorée (4 sur 53).

**Mais jamais deux fois non plus.** Claude Code réécrit aujourd'hui un message sorti de la file
comme un message ordinaire, et répète le dernier prompt dans un pointeur aux retours à la ligne
aplatis, coupé à 200 caractères. Ariane reconnaît les deux — la file par le `dequeue` que le fichier
écrit, le pointeur par sa forme — et ne garde que l'original : 309 doublons sur ce corpus, dont un
signalé depuis Windows, qui s'affichait comme votre message le plus récent.

Et quand un chemin ne peut pas être établi avec certitude — un nom de dossier décodé, un encodage
qui a détruit les accents — il est affiché comme une approximation, jamais comme un fait.

**Quand un assistant efface une conversation**, Ariane en garde la copie. Claude Code supprime ses
anciennes transcriptions ; si Ariane les avait lues, elle les conserve dans une archive à part
(`~/.config/Ariane/archive`), qu'aucune mise à jour de l'app ne touche, et les marque **sauvée**.
Il n'y a que celles-là dans l'archive : tout le reste existe encore chez son assistant. Un bouton
**Oublier**, sur une conversation sauvée, l'efface définitivement — de l'archive comme de l'index,
y compris des zones libérées de la base.

Le danger n'était pas les types **inconnus** — l'indexeur les signale. C'étaient les types
*connus*, examinés une fois, jugés inutiles, puis écartés à jamais sans un mot. `test/noise.test.js`
oblige désormais chaque type écarté à prouver qu'il ne contient rien de vous, et
`npm run audit:noise` refait la vérification sur les données réelles.

---

## Développement

Comment lancer le projet, ce qui doit passer avant d'envoyer un changement, et comment une version
est publiée : [`CONTRIBUTING.md`](CONTRIBUTING.md). La version longue — le chemin de données, les
invariants, les pièges — vit dans [`ARCHITECTURE.fr.md`](ARCHITECTURE.fr.md).

```bash
npm test              # la suite unitaire, sans framework (node --test)
npm run test:render   # le vrai moteur de rendu, sous Electron
npm run test:ui       # 26 vérifications de mise en page
npm run test:splash   # 7 vérifications de l'écran d'accueil
npm run test:all      # les quatre
npm run audit:noise   # cherche du texte jeté par erreur, sur vos données
npm run demo          # l'app réelle sur un corpus fictif, gardé dans ~/.config/Ariane-demo
npm run demo -- --reset   # le régénère, avec des dates fraîches
npm run demo:capture  # régénère docs/ariane.png à partir de ce corpus
npm run lint
```

Le cœur (`src/core/`) est du **Node pur, sans la moindre importation d'Electron** : toute la logique
de lecture, d'extraction et de recherche se teste sans ouvrir de fenêtre — y compris la couche IPC,
où `electron` est remplacé par un double.

Les deux suites Electron ouvrent une vraie fenêtre : sur une machine sans écran (une CI, un serveur),
il faut les lancer sous `xvfb-run`. `npm test` seul n'en a pas besoin.

Les deux suites Electron existent parce que les bugs qu'elles surveillent vivent dans le DOM, pas
dans les fonctions pures. Le bug d'attribution ci-dessus passait **tous** les tests unitaires de son
propre helper pendant que l'interface attribuait à l'utilisateur la sortie de `git status`.

Ajouter un assistant, c'est écrire **un module** implémentant le contrat de
`src/core/agents/contract.js` — trois questions : où sont les sessions, dans quel dossier chacune a
tourné, et qu'est-ce qu'un message. Le reste de l'application ne change pas.

Voir [`ARCHITECTURE.fr.md`](ARCHITECTURE.fr.md) pour l'architecture détaillée et les pièges de chaque
format, [`CHANGELOG.md`](CHANGELOG.md) pour ce qui a été fait et mesuré, et
[`ROADMAP.md`](ROADMAP.md) pour ce qui reste.

---

## Licence

**GNU GPL v3 ou ultérieure**, assortie d'une clause d'attribution — voir
[`LICENSE`](LICENSE) et [`NOTICE`](NOTICE).

Ce que vous pouvez faire : utiliser Ariane pour n'importe quoi, l'étudier, la
modifier, la redistribuer, la vendre même. Ce que vous devez faire en échange,
et c'est le marché :

- **publier votre code**, sous la même licence, si vous redistribuez Ariane ou
  quoi que ce soit qui en dérive. Pas seulement les fichiers modifiés :
  l'ensemble.
- **préserver l'attribution** — `Ariane — © 2026 Johnny Piette —
  https://github.com/ZamBoyle/ariane` — dans le code source et dans les
  mentions légales affichées par votre travail, s'il en affiche. C'est un terme
  additionnel au titre de l'**article 7(b)** de la GPLv3, qui l'autorise
  explicitement, et il ne peut pas être retiré par ceux qui redistribuent.

En une phrase : reprenez ce code, mais rendez-le, et dites d'où il vient.

**Pourquoi la GPL et pas MIT ou Apache.** Toutes deux permettent une version
fermée d'Ariane — une application qui lit vos conversations privées ne devrait
pas pouvoir devenir opaque. MPL 2.0 aurait été un compromis, mais elle n'oblige
à publier que les *fichiers modifiés*, pas l'ensemble.

**Ce que ça coûte, dit franchement** : la GPL et les conditions de l'App Store
d'Apple sont incompatibles ; Ariane ne pourra donc jamais y être publiée. Le
`.dmg` distribué directement, lui, ne pose aucun problème.

Les dépendances le permettent : Electron, better-sqlite3 et electron-builder
sont sous MIT, `@fluent/bundle` sous Apache 2.0 — toutes compatibles avec la
GPL **version 3** (Apache 2.0 ne l'est pas avec la version 2, d'où le choix de
la v3).

---

## Auteur

**Johnny Piette** — [@ZamBoyle](https://github.com/ZamBoyle)

Copyright © 2026 Johnny Piette. Ariane est un logiciel libre, distribué sans
aucune garantie.
