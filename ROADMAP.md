# Feuille de route

Ce qui manque encore à Ariane, établi en mesurant plutôt qu'en supposant, et classé par ce qui gêne
réellement à l'usage — pas par facilité. Chaque point garde le **piège qui décide de sa
conception** : c'est la partie qu'on ne peut pas deviner en lisant le code.

Ce qui est fait vit dans [`CHANGELOG.md`](CHANGELOG.md), avec ce qui a été mesuré. Les chiffres du
corpus, datés, vivent dans `ARCHITECTURE.fr.md` § 12.

---

## 8. Windows, macOS, et une CI

**Le problème.** « Fonctionne partout » était l'exigence n°1, et toute la qualité mesurée ici a
longtemps reposé sur quelqu'un qui lançait les tests à la main, sur une seule machine.

**Fait le 22 septembre 2026 : la CI tourne, et les trois systèmes sont verts.**
`.github/workflows/test.yml` lance les quatre suites sur Ubuntu, Windows et macOS à chaque poussée,
`fail-fast` désactivé pour qu'un échec n'en cache pas un autre.

Les chiffres des quatre suites, par système, vivent dans `ARCHITECTURE.fr.md` § 12 — mesurés,
datés, et à un seul endroit.

**Ce que la première exécution a trouvé, et ce qu'elle n'a pas trouvé.** Onze échecs sous Windows,
trois sous macOS, et **pas un seul défaut du produit**. Le code gérait déjà la casse de `Path`, la
résolution des variables d'environnement, la normalisation d'un chemin saisi ; ce sont quatorze
tests qui avaient été écrits depuis une seule machine — dont un qui *plantait* au lieu d'échouer,
`undefined.split()` sur un `env.PATH` que Windows épelle `Path`. Ils l'étaient depuis des mois sans
que personne pût le savoir.

Deux pièges du banc d'essai, notés parce qu'ils se reproduiront : `xvfb-run` ouvre un écran de
1280x1024 alors que la suite de mise en page demande une fenêtre de 1402 px, et une fenêtre
`show: false` n'a pas encore sa taille sous macOS au moment où sa page répond — une taille demandée
n'est pas une taille obtenue.

**Constaté en écrivant les réglages de CLI (voir le journal), à vérifier sur de vraies machines.**
Le *lancement* du terminal n'a jamais tourné hors de Linux, et deux défauts se voient à la
lecture :
- **macOS** : `open -a Terminal <dossier>` ouvre un terminal dans le dossier mais **ne lance pas la
  commande** — « Reprendre » n'y reprend rien. Piste : `osascript` avec la ligne de commande passée
  en argument (jamais interpolée dans l'AppleScript), chaque mot entre apostrophes POSIX ; macOS
  demandera l'autorisation de piloter Terminal.
- **Windows** : les CLI npm sont des `.cmd`, que Node refuse de lancer sans shell ; ils passent par
  `wt.exe` ou `cmd.exe /c start`, dont les règles de découpage ne sont pas celles de Node. Les
  identifiants de session sont sûrs (`SAFE_ID`), mais un chemin choisi contenant `&` ou `^` ne l'est
  pas encore.

**Piège levé par better-sqlite3 13.** La liaison native est passée en Node-API : un binaire par
système, choisi par la bibliothèque elle-même, plus rien à reconstruire par OS ni par ABI. Ce qui
reste est un plancher, Node-API 10 — Node 22.14 et Electron 44. Voir `ARCHITECTURE.fr.md` § 13.

**Fait le 20 septembre 2026 : le paquet Windows se construit.** `npm run dist:win`, depuis Linux,
produit `Ariane 0.1.0.exe` (portable) et `Ariane Setup 0.1.0.exe` (installeur NSIS), 77 Mo chacun.
Le piège ci-dessus était pire que prévu : electron-builder ne recompile que pour la machine qui
construit, et il avait emporté le binaire **ELF** dans l'exécutable Windows sans un mot. La base ne
se serait pas ouverte au premier lancement, chez quelqu'un d'autre. Un contrôle à l'empaquetage
veillait alors sur ce point ; il a été supprimé le 21 septembre avec le reste de la mécanique, la
construction croisée étant devenue juste par construction — `better-sqlite3` livre les huit
binaires dans son propre paquet, et `--win` depuis Linux emporte `win32-x64.node` parce que ce
fichier était déjà là. Vérifié dans les octets du paquet produit.

**Et elle tourne**, vérifié le même jour sous wine 9.0 64 bits, sur écran virtuel : `Ariane.exe`
démarre, ouvre son index dans `C:\users\<nom>\AppData\Roaming\Ariane`, trouve les conversations
posées à l'emplacement Windows par défaut (`C:\users\<nom>\.claude`), en indexe sept et les
affiche — interface en français, dossiers groupés, comptes justes. C'est la preuve que la DLL
native se charge : sans elle, rien de tout cela n'existerait. Wine n'est pas Windows, mais un
échec aurait tranché, et il n'y en a pas eu.

**Et elle tourne pour de vrai**, vérifié le 22 septembre 2026 sur une machine Windows et sous
WSL : clone, `npm install`, `npm start`, conversations affichées.

**Ce qui reste à vérifier, et que rien n'automatise** : le lancement d'un terminal (`.cmd`,
`wt.exe`, découpage des arguments) et l'ouverture d'un dossier dans l'Explorateur — les deux
endroits où Ariane sort d'elle-même, que ni wine ni la CI ne jugent, puisque aucun test ne peut
atteindre un vrai terminal. Il manque aussi une signature : Windows affichera « éditeur inconnu »,
macOS mettra un `.dmg` téléchargé en quarantaine.

**Et un défaut d'affichage observé sous WSLg**, sur l'écran principal d'une installation à trois
moniteurs identiques : une fenêtre maximisée ne peint qu'environ 70 % de sa largeur. Ni la mise à
l'échelle ni la géométrie ne l'expliquent, et il n'a pas été reproduit sur un Linux natif ni sous
Windows en natif — [issue 1](https://github.com/ZamBoyle/Ariane/issues/1).

## 13. Se mettre à jour

**Fait le 22 septembre 2026 : prévenir.** Réglages → Mises à jour propose d'interroger GitHub une
fois au lancement, **éteint tant que personne ne l'allume**. La requête part du processus principal,
interroge la redirection de `/releases/latest` — pas l'API, qui a un quota — et tout ce qu'elle
produit est un numéro de version et un lien. Rien n'est téléchargé, rien n'est exécuté, et l'adresse
ouverte est reconstruite depuis le manifeste : aucune URL choisie par la fenêtre n'atteint
`shell.openExternal`.

**Ce qui reste : l'AppImage peut se mettre à jour seule.** C'est la seule cible qui le puisse sans
certificat et sans droits root, et `electron-updater` sait le faire. Deux raisons de l'avoir remis :
la dépendance est lourde, et elle ne s'éprouve pas sans une vraie AppImage en fonctionnement.
`process.env.APPIMAGE`, posé par le lanceur, reste le seul discriminant fiable pour savoir qu'on y
est.

**Le problème qu'il restait à régler.** Depuis la 0.2.0, Ariane se télécharge. Mais une fois
installée, elle ne savait pas qu'une version plus récente existe, et rien ne le lui aurait dit : ni
canal, ni notification, ni gestionnaire de paquets derrière elle.

**Le piège, et c'est lui qui décide de toute la conception : rien n'est signé.**

| Cible | Mise à jour automatique sans certificat |
|---|---|
| **AppImage** | **oui** — `electron-updater` la fait sans signature ni droits root |
| `.deb` | possible via `pkexec`, mais se bat avec dpkg et réclame un mot de passe |
| **NSIS** | techniquement oui, mais chaque `.exe` téléchargé rouvre SmartScreen — et l'application exécuterait seule un binaire non signé |
| **`.dmg`** | **non** — Squirrel.Mac exige une application signée. Blocage dur |

D'où **un mécanisme, deux modes**, décidés à l'exécution par la manière dont l'application a été
installée : `process.env.APPIMAGE` est posé par le lanceur AppImage, et c'est le seul discriminant
fiable. En AppImage, mise à jour complète et en place. Ailleurs, un bandeau qui prévient et un
bouton vers la page de la release — **rien n'est téléchargé, rien n'est exécuté**.

**Ce qui existe déjà et n'est pas à écrire.** La release attache ses `latest-linux.yml`,
`latest-mac.yml` et `latest.yml` : ce sont les manifestes que lit `electron-updater`, produits par
electron-builder sans qu'on lui demande. Et `resources/app-update.yml` est écrit dans chaque paquet,
avec le dépôt déjà nommé.

**La réserve, et elle n'est pas technique.** Le README promet aujourd'hui *« no telemetry, no update
check, no account »*. Une vérification de mise à jour est une requête réseau : elle apprend à GitHub
une adresse IP, une version et une fréquence de lancement. On ne contourne pas cette phrase, on la
réécrit — et le réglage qui va avec vit dans `settings.json`, **par défaut éteint**, validé comme
`theme` l'est. La requête vit dans le processus principal : le `connect-src 'none'` de la fenêtre ne
bouge pas.

## Ordre proposé — 25 septembre 2026

Classé par une logique, pas par envie : d'abord ce qu'Ariane laisse de côté sans le savoir, puis ce
qui gêne chaque jour et coûte peu, puis ce que les fichiers disent déjà et qu'Ariane tait, puis la
lecture, puis l'accessibilité — que tout le monde puisse lire —, puis la confiance qu'on peut faire
à un paquet, et en dernier les chantiers qui demandent d'abord une décision. Chaque étape ne
suppose que celles d'avant.

### 1. Ce que les fichiers disent et qu'Ariane ne lit pas — fait le 25 septembre 2026

Les cinq types que le compteur de formats inconnus signalait sont lus ou nommés : `continued-in`
(Claude) et `forked_from_id` (Codex) relient une conversation reprise ou dupliquée à celle qu'elle
continue ; `agent-name`, `agent-setting` et le `subagent.deselected` de Copilot, mesurés vides de
tout contenu, sont rangés comme bruit connu. Il ne reste que le fichier VS Code de 166 Mo, voulu :
2,5 Ko de conversation dans 166 Mo de sorties d'outils, qu'on ne sait pas lire en flux. Voir le
journal.

### 2. Le confort de tous les jours — fait le 25 septembre 2026

La taille du texte (90 à 130 %) se règle dans les Réglages ou au clavier — Ctrl+=, Ctrl+Maj+=, le
pavé numérique, Ctrl+0 —, et un zoom réglé avant est repris. Le menu par défaut d'Electron, caché
et en anglais, a disparu sous Linux et Windows, et les outils de développement ne sont plus dans
les paquets publiés. « Vérifier maintenant » est à côté du réglage des mises à jour. Voir le
journal.

### 3. Les quotas — fait le 25 septembre 2026

Un bloc « Limites d'utilisation » dans les Statistiques : pour Codex, la semaine (et les cinq heures
tant qu'elles existaient), ses crédits et l'historique des semaines ; pour Claude, l'historique de
ses semaines que tient Claude Desktop quand il est installé, son dernier relevé gardé dans
`~/.claude.json` et chaque requête que sa limite a refusée. Un relevé et sa date, jamais un total ;
les fenêtres déjà lues survivent à une reconstruction de l'index. Voir le journal.

Restent deux suites possibles, chacune avec son piège : **ce qu'une conversation a consommé** d'une
fenêtre (Agent Sessions le montre pour les sessions actives) — un écart entre deux relevés, que
d'autres conversations menées en parallèle faussent ; et **le budget d'usage supplémentaire** de
Claude (`extra_usage`, en euros), qui demanderait d'écrire une somme d'argent à l'écran.

### 4. Lire plus vite ce qui compte — moyen

- **Des filtres d'affichage retenus** : masquer les outils, les avis, ne garder que ses propres
  messages, déplier les raisonnements. Le piège est l'en-tête, que la suite de mise en page mesure en
  allemand, en japonais et en néerlandais : un menu « Affichage » plutôt que des boutons de plus.
- **Un lien de l'appel au sous-agent.** Aujourd'hui un sous-agent se rejoint par la liste dépliable
  sous l'en-tête ; le lien depuis l'appel `Agent` lui-même reste à faire. Son résultat porte
  l'`agentId` (24 sur 24 mesurés) ; les agents d'un workflow n'ont que l'identifiant `wf_…` de leur
  dossier.
- **Le saut à une date** dans une conversation ouverte : les dates sont dans l'infobulle de chaque
  trait du plan, mais rien ne permet d'y aller.
- **La coloration syntaxique — faite le 25 septembre 2026** (voir le journal). Reste, mesuré :
  les `Edit` et `Write` de Claude (886 appels) montrent encore leur JSON — le contenu d'un `Write` se
  colorierait d'après l'extension du fichier, un `Edit` se montrerait en diff ; les 18 blocs `asm`
  (de l'assembleur 6502, sans grammaire dans la bibliothèque) restent en texte ; un bloc sans
  étiquette n'est pas deviné, par choix.

### 5. L'accessibilité — commencée le 25 septembre 2026, moyen

Demandée le 25 septembre 2026. Ce qui se mesure est mesuré par un test ; ce qui s'écoute ne se juge
qu'avec un vrai lecteur d'écran.

- **Le contraste — fait.** Le ton « pâle » des textes secondaires (dates, chemins, lignes sous les
  titres) ne passait que 2,7:1 en clair et 3,4:1 en sombre, pour 4,5 exigés ; l'accent, écrit en
  texte, 3,7 en clair. Même thème, seule la clarté a bougé : tous les tons passent 4,5 sur chaque
  fond, dans les deux thèmes, et la suite de mise en page le mesure.
- **Le mode contraste élevé de Windows** (`forced-colors`) : aucune règle. Les marques des
  assistants, faites d'un fond coloré, risquent d'y disparaître.
- **Six `outline: none`** : chacun doit avoir un remplaçant visible au clavier (`:focus-visible`
  en a huit). À vérifier un par un, puis par un test qui navigue au clavier.
- **Tout au clavier** : la barre latérale, la transcription, les réglages, la recherche, sans
  souris — jamais parcouru de bout en bout.
- **Un lecteur d'écran** (Orca sous Linux, NVDA sous Windows) : six zones annoncent leurs
  changements (`aria-live`), les boutons-icônes ont un nom ; rien n'a jamais été écouté.
- Déjà là : la taille du texte (étape 2), `prefers-reduced-motion`, un tableau à côté de chaque
  graphique, des infobulles qui s'ouvrent aussi au clavier.

### 6. Un paquet auquel on peut se fier — petit à moyen

Aucun de ces points ne gêne qui utilise déjà Ariane ; tous comptent pour qui hésite à la télécharger.

- **Un `CHECKSUMS.sha256`** attaché à chaque release, comme le fait claude-code-history-viewer.
- **Le `.dmg` est arm64 uniquement** : les runners macOS sont en Apple Silicon, un Mac Intel ne peut
  pas l'ouvrir. Une cible universelle, ou une seconde construction x64.
- **La mise à jour en place de l'AppImage** : la seconde moitié du point 13, ci-dessus.
- **Une vingtaine de mégaoctets inutiles** par paquet : 15 Mo de binaires pour d'autres systèmes,
  7 Mo de langues que l'application n'affiche pas. C'est le genre de filtrage malin qui a déjà
  expédié un binaire faux ici : il ne se fait qu'avec la vérification octet par octet.

### 7. La solidité, entre deux chantiers

- **La couverture, de 96,9 % vers 98 %** : les chemins de `ipc.js`, `terminal.js` et
  `settings.js` ; `update-check.js` et `export.js` ne s'éprouvent que sous Electron. Puis remonter
  le seuil de la CI.
- **ESLint 10** : la 9 n'est plus maintenue, et c'est une migration de configuration.
- **Le lancement d'un terminal et l'ouverture d'un dossier sous Windows et macOS** (point 8) : seule
  une vraie machine en juge, aucun test n'ayant le droit de toucher un vrai terminal. À faire depuis
  le poste Windows.

### 8. Les chantiers qui demandent d'abord une décision

- **Les fichiers modifiés et leurs différences**, comme chez claude-code-history-viewer. Le piège
  est la sélectivité : l'index fait 1 % de l'entrée parce qu'il coupe les aperçus à 2 000
  caractères. Montrer des différences, c'est garder davantage, ou relire les fichiers des assistants
  à la demande.
- **Les sessions actives** — celles qui tournent, celles qui attendent une réponse —, comme le
  « cockpit » d'Agent Sessions. La conversation ouverte se met déjà à jour toutes les 30 s ; ce qui
  manque est la vue d'ensemble.
- **D'autres assistants** (Cursor, Cline, Aider, OpenCode…). Aucun n'a de conversation sur la
  machine de développement : sans fichiers réels à mesurer, un adaptateur serait écrit à l'aveugle.
- **Un coût en dollars**, en option et libellé « équivalent au prix public de l'API » : la décision
  est déjà écrite, personne ne l'a demandé.

### Hors de portée, par choix

Écrire chez les assistants — renommer ou supprimer leurs sessions, régler leurs serveurs MCP —,
démarrer une session, ou servir l'historique sur le web. Ariane lit, et ne fait que lire : c'est ce
qui permet de lui confier tout un historique.
