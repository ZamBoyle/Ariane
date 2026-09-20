# Journal des changements

Ce qui a été fait, et ce que cela a coûté à mesurer. La feuille de route (`ROADMAP.md`) ne garde
que ce qui reste ; tout ce qui est terminé vient ici.

Chaque entrée dit trois choses : **ce que ça change** pour la personne qui s'en sert, **ce qui a
été mesuré**, et **ce qu'on a trouvé de cassé en chemin** — car presque aucun de ces travaux n'a
révélé ce qu'on croyait.

Les chiffres du corpus de référence vivent dans `ARCHITECTURE.fr.md` § 12, datés.

---

## 20 septembre 2026

### La fenêtre retrouve sa taille

**Constaté à l'usage** : chaque lancement rouvrait Ariane en 1280 × 860,
quoi qu'on ait fait de la fenêtre la veille. Electron ne retient rien tout seul,
et rien ne l'enregistrait.

**Où c'est écrit, et pourquoi pas ailleurs.** Dans `<userData>/window.json`, et
non dans `settings.json` : ce dernier est le fichier qu'une personne ouvre et
modifie à la main, alors qu'une position change à chaque fois qu'on déplace la
fenêtre. L'état d'une machine n'a rien à faire dans le fichier de quelqu'un.

**La règle qui décide de tout : une taille est transposable, une position ne
l'est pas.** 1000 × 700 veut dire la même chose sur n'importe quel écran ;
`x: 2400` ne veut plus rien dire dès qu'on débranche le second moniteur — et
restituer fidèlement cette position rouvre la fenêtre là où personne ne peut
l'attraper, sans aucun moyen visible de la ramener. La position n'est donc
suivie que si elle tombe encore sur un écran existant, avec au moins 80 px de
prise. Sinon la taille est gardée et la fenêtre revient au centre, comme au
premier lancement.

**Deux pièges notés au passage**, chacun ayant coûté un bug ailleurs :
`getNormalBounds()` et non `getBounds()` — le second répond la taille de l'écran
tant que la fenêtre est agrandie, et restituer ça donne une fenêtre aux
dimensions de l'écran mais non agrandie, impossible à réduire. Et l'état
« agrandie » se restitue en appelant `maximize()`, jamais en restituant ces
dimensions-là.

**Mesuré sur l'application réelle**, sur écran virtuel : ouverte en 1280 × 860,
redimensionnée à 1000 × 700 en +60+40 par le serveur X, fermée ; `window.json`
contient exactement ces valeurs ; au relancement, la fenêtre s'ouvre en
1000 × 700 en +60+40. 16 tests couvrent les écrans disparus, les tailles
aberrantes et un fichier illisible.

### Un écran d'accueil, et une case pour ne plus le voir

Une fenêtre sans cadre, centrée, portant la bannière du projet, qui reste à
l'écran tant qu'on ne l'a pas fermée. En bas, sur sa propre bande : « Ne plus
afficher cet écran au démarrage ». Le choix va dans `settings.json` (`splash`),
à côté de la langue, du thème et du filtre.

**Ce qui décide de sa conception : elle s'ouvre avant tout le reste.** Elle ne
peut donc dépendre de rien — ni de la localisation, ni de l'index, ni des
réglages. Son pont expose **trois fonctions** là où celui de l'application en
expose soixante : dire les phrases, retenir la réponse, demander sa fermeture.
Une image n'a pas à pouvoir atteindre les conversations. Et si ce pont ne répond
pas, la bande disparaît plutôt que de rester muette — l'image s'affiche quand
même, et Échap fonctionne toujours.

**Il attend, au-dessus de l'application et non à sa place.** Deux versions ont
précédé celle-ci, toutes deux corrigées à l'usage. La première se fermait
d'elle-même dès que l'application était prête : mesuré, elle restait **1,7
seconde** à l'écran — assez pour la voir, beaucoup trop peu pour cocher une
case. La seconde gardait la fenêtre principale cachée jusqu'à la fermeture du
splash : il ne restait plus qu'une image à l'écran. Désormais l'application
s'ouvre normalement et le splash flotte par-dessus jusqu'à ce que la personne le
ferme — le bouton « Continuer », la touche Échap, ou un clic sur l'image.

`alwaysOnTop` ne suffit pas à le garantir : c'est une demande au gestionnaire de
fenêtres, et la fenêtre principale est affichée *après* le splash. Celui-ci
réclame donc le premier plan (`moveTop`) une fois l'application montrée.

**Une seule sécurité demeure** (`failsafeMs`, 10 s) : un splash dont la page ne
se charge jamais enfermerait l'application pour de bon. S'il n'a même pas réussi
à s'afficher, il est détruit et Ariane s'ouvre. Un moteur de rendu mort ou une
fenêtre fermée font pareil.

**Trouvé en le regardant** : la pastille de la case tombait pile sur la rangée
de boutons de la bannière. Elle a maintenant sa bande à elle, sous l'image, avec
le bouton à l'autre bout.

**Mesuré.** Une suite dédiée (`npm run test:splash`, 7 contrôles) charge la page
avec un faux pont : l'image se charge et couvre la fenêtre, les deux phrases
viennent bien du pont, les **trois** sorties demandent chacune la fermeture, la
case écrit au clic et écrit l'inverse au déclic, la fenêtre n'atteint rien
d'autre que ses trois fonctions, et un pont muet masque la bande.

Et sur l'application réelle, lancée sur écran virtuel : les deux fenêtres sont
visibles, et l'ordre d'empilement du serveur X met bien le splash **au-dessus**
de l'application ; il reste là indéfiniment ; une touche Échap envoyée au serveur
X le fait disparaître, l'application restant en place. `splash: false` → aucune
fenêtre d'accueil. L'image pèse 100 Ko en JPEG, contre 1,6 Mo en PNG :
elle est lue à chaque démarrage.

### Ariane a enfin une icône

Chaque construction annonçait `default Electron icon is used` : l'app portait l'icône d'Electron
sur les trois systèmes. Le motif vient des bannières du projet — le A traversé
par le fil, qui dit le nom sans l'écrire.

**Ce qui a été mesuré avant de l'installer**, parce qu'une icône se juge à 16 pixels et pas à 1000 :
rendue à 16, 24, 32, 48, 64 et 128 px, la première version se réduisait à une tache — le A occupait
la moitié de la tuile, et les marges mangeaient les pixels qui comptent. La version resserrée, où
le motif remplit environ 80 % du carré, reste lisible à 16 px : une lettre pleine barrée d'un trait
orange.

**Ce que les paquets emportent maintenant.** Neuf tailles sous Linux (16 → 1024), déclarées par
`linux.icon` : les bureaux n'ont plus à réduire une image de 1024 px à la volée pour la barre des
tâches. Et un `.ico` **multi-tailles** pour Windows (16 → 256), fabriqué explicitement : celui
qu'electron-builder générait tout seul ne contenait qu'une entrée 1024, une taille que Windows
n'attend jamais.

**Trouvé en vérifiant.** La variante à fond transparent, elle, n'est utilisable que sur fond
sombre : le A y est blanc, et sur le fond clair d'un README GitHub il disparaît, réduit à son
liseré orange. Elle reste donc pour la bannière, pas pour le logotype.

### Masquer un assistant dans la barre latérale

Sous le champ de filtre, une pastille par assistant — les mêmes
couleurs que dans l'arborescence — qu'on coche et décoche. Le nom complet s'affiche au survol.
Le choix va dans `settings.json` (`hiddenAgents`) : il tient d'un lancement à l'autre.

**Ce qui décide de la conception.** Le filtre est appliqué **dans le SQL**, pas dans la page :
`sessionCount`, le nombre de dossiers et les comptes du pied sont calculés par ces requêtes, et
filtrer ailleurs laisserait le pied décrire des lignes que l'écran ne montre pas. Un dossier qui
n'a plus rien à afficher disparaît tout seul, par le `HAVING` qui existait déjà. La recherche suit
aussi : masquer Codex à gauche et continuer à recevoir des résultats Codex en bas seraient deux
réponses à la même question.

**Trois garde-fous**, parce qu'un filtre qui tient dans le temps peut faire croire qu'on a perdu
des conversations : une pastille masquée **reste affichée** (sinon on ne pourrait jamais la
rappeler), « Tout afficher » apparaît dès qu'une seule est décochée, et on ne peut pas toutes les
masquer — la dernière refuse, plutôt que de laisser une barre vide.

**Trouvé en écrivant le test :** le pied et l'arborescence se contredisaient déjà dans le banc
d'essai du rendu (« 1 dossier » pour trois lignes affichées), parce que les chiffres y étaient
écrits à la main. Le contrôle compare maintenant les deux, et le banc d'essai calcule ses comptes
comme la vraie requête. Au passage, un `startsWith` qui échouait sans raison : le français met une
espace insécable entre le nombre et le nom.

**Mesuré.** 671 tests unitaires, 149 contrôles de rendu, 26 de mise en page. La chaîne complète
est vérifiée de bout en bout : masquer Codex retire son dossier de la liste, ses conversations des
résultats, et met le pied d'accord avec ce qui reste.

### Le .deb s'installait et mourait à la première requête

**Constaté à l'installation.** Un `npm run rebuild:node` lancé la veille avait remis
`node_modules` en ABI Node (127). electron-builder empaquette ce qu'il y trouve, sans le reconstruire —
le `.deb` suivant embarquait donc une liaison pour Node dans une app Electron (130). L'app
s'installait, s'ouvrait, et le renderer ne recevait qu'un
`No handler registered for 'app:locale'` : `registerIpc()` était mort en ouvrant la base.

**Le crochet `after-pack` aurait dû l'attraper et ne l'a pas fait** : il vérifiait le système
d'exploitation, pas le moteur. Un ELF pour Node et un ELF pour Electron sont le même fichier à
l'œil. Il contrôle maintenant les deux, à chaque construction et pour chaque cible.

**Comment on lit une ABI**, puisqu'elle n'est écrite nulle part : on tend le fichier à un
chargeur, et c'est son refus qui la dit — « compiled against … NODE_MODULE_VERSION 127 ». Dans un
**processus enfant**, jamais dans celui de la construction : une liaison de la mauvaise ABI meurt
en SIGILL, pas en exception. Posée sur place, la question a fait sortir electron-builder en
erreur 1 avec le paquet déjà écrit et rien dans le journal — deuxième défaut du jour, trouvé en
vérifiant le premier.

**Mesuré.** `node_modules` en ABI 127, construction lancée sans y toucher : le crochet détecte,
récupère `better-sqlite3-v11.10.0-electron-v130-linux-x64`, remplace, et annonce « ABI 130 ». Le
paquet extrait porte bien 130 ; l'app installée tourne 75 secondes sans incident et écrit un index
de 73 Mo. Code de sortie 0.

### Antigravity CLI (`agy`) est lu — le protobuf était un leurre

**Ce que ça change.** Les conversations d'`agy` apparaissent dans Ariane comme les autres : lues,
indexées, cherchables, et « Reprendre » les rouvre (`agy --conversation <id>`). Il apparaît aussi
dans les réglages, avec son champ de chemin — ce qui manquait jusque-là.

**Pourquoi c'était reporté, et pourquoi ça ne l'est plus.** Le point 11 avait été écarté le
20 septembre pour une raison précise : le coût était dans le décodage d'un protobuf sans schéma
(7,37 bits/octet, 36 % lisible), un travail qui vieillit mal. La raison a disparu en regardant au
bon endroit. À côté de la base vivante, `agy` écrit
`brain/<id>/.system_generated/logs/transcript.jsonl` : la conversation entière en clair, un
enregistrement par ligne, avec `source` (`USER_EXPLICIT` / `MODEL` / `SYSTEM`), `created_at`,
`content` et `thinking` dans son propre champ. Rien à déchiffrer.

**Le vrai problème était ailleurs : le dossier de travail.** `agy` ne l'écrit nulle part de fiable
— pas dans le journal, pas dans la base de la conversation, et `conversation_summaries.db` contient
2 lignes datées de huit mois avant les 15 conversations présentes. Trois sources, dans cet ordre :
`workspace_uris` quand il existe (exact), une **dérivation** sinon (marquée approximative), rien du
tout en dernier. La dérivation est une soustraction, pas une supposition : un chemin absolu vu dans
un appel d'outil qui se termine par un chemin relatif que la personne a tapé désigne le répertoire
où elle se tenait. **Un seul candidat ou rien** — deux candidats, c'est un désaccord, et un
désaccord n'est pas un constat.

**Mesuré.** 15 conversations, 250 enregistrements, 0 écarté. 15 tours de la personne, 118 du
modèle, 99 sorties d'outil créditées à personne, 18 avis. Dossier : 8 dérivés sur 15, jamais
ambigu ; des 7 restants, 5 ne nomment aucun fichier — il n'y a rien à trouver. `npm run audit:noise`
couvre le nouvel adaptateur : rien d'écarté ne contient de prose.

**Deux défauts trouvés par les tests, tous deux sur les accents.** Le motif de chemin absolu
refusait `é` (il s'arrêtait à `/home/ada/projets/sant`), et le détecteur de suites lisibles rejetait
les octets de continuation UTF-8, coupant `Mathématiques` en deux. Invisibles sur le corpus réel, où les
chemins sont encodés en pourcents — c'est le banc d'essai, avec ses chemins écrits tels quels, qui
les a révélés. Le même piège que `Mathématiques`, une troisième fois.

**Gemini reste.** `agy` s'ajoute, il ne remplace rien : les anciennes conversations Gemini sont sur
le disque et continuent d'être lues. Les deux vivent sous `~/.gemini/` sans se marcher dessus —
Gemini ne lit que `tmp/`, Antigravity que `antigravity-cli/`.

### Le thème se choisit : système, clair ou sombre

**Ce que ça change.** Les réglages offrent « Thème » à côté de « Langue » : *Système*, *Clair*,
*Sombre*. Le choix va dans `settings.json` (`"theme"`), à côté de la langue, et vaut pour les
prochains lancements.

**Ce qui n'a pas été écrit, et c'est l'essentiel.** Les deux palettes existaient déjà dans
`styles.css`, peintes depuis `prefers-color-scheme`. Electron sait faire mentir cette question
(`nativeTheme.themeSource`). Le thème s'arrête donc dans le processus principal : il ne traverse
pas le pont, la page n'a rien à appliquer, rien ne se recharge quand il change — contrairement à la
langue, qui réécrit toute la fenêtre — et l'app s'ouvre dans la bonne couleur au lieu d'afficher
l'autre le temps d'une image.

**Trouvé en chemin.** `main.js` peignait la fenêtre en `#1a1915` en dur — la couleur sombre, même
sur un bureau clair. Le cadre est peint avant que la page existe, donc cette couleur doit y rester ;
elle est maintenant choisie selon le thème, et un contrôle de mise en page lit `--bg` dans le vrai
moteur, palette claire puis sombre, et échoue si les deux fichiers divergent.

**Vérifié aussi** : l'export PDF passe par une fenêtre cachée qui hérite du thème de l'app. Sa page
a sa propre palette « pour le papier » et n'interroge pas la préférence d'écran — un test le lui
interdit désormais, sinon un PDF exporté en thème sombre sortirait sur fond noir.

**Mesuré.** Capture de la vraie app, corpus fictif, thème imposé par le fichier : fond
`rgb(26, 25, 21)` en sombre, `rgb(250, 249, 245)` en clair, `data-theme` resté à `auto` — la preuve
que rien n'a été touché côté page. 629 tests unitaires, 145 contrôles de rendu, 26 de mise en page.

### Ariane pour Windows — et la liaison native qui serait partie avec le mauvais système

**Ce que ça change.** `npm run dist:win` construit depuis Linux les deux paquets Windows :
`Ariane 0.1.0.exe` (portable, 77 Mo) et `Ariane Setup 0.1.0.exe` (installeur NSIS, 77 Mo).

**Ce qu'on a trouvé de cassé en chemin**, et c'était le sujet. Le premier paquet produit
s'installait, se lançait — et n'aurait jamais ouvert sa base. electron-builder appelle
`@electron/rebuild`, qui compile **pour la machine qui construit**, pas pour la cible : le
`better_sqlite3.node` emballé dans `Ariane.exe` était un objet **ELF Linux**. Rien ne le disait ;
la construction se terminait avec un code 0. Les notes du projet affirmaient l'inverse depuis le début
(« electron-builder rebuilds natives for the target ») — cette phrase est corrigée.

**Comment c'est réparé.** Un module natif ne peut pas être compilé pour Windows depuis Linux : il
n'y a pas de compilateur pour ça ici. Mais better-sqlite3 publie un binaire par (moteur, ABI,
système, architecture). `build/after-pack.js` lit les premiers octets de la liaison emballée — les
seuls octets qui ne peuvent pas mentir sur leur système : `ELF`, `MZ`, les six magies Mach-O —
récupère par `prebuild-install` celle qui correspond à la cible, et **arrête la construction** si ce
qui arrive ne correspond toujours pas. Un paquet qui emporte le mauvais binaire est pire qu'une
construction qui échoue. Rien n'est écrit dans `node_modules` : le téléchargement va dans un
répertoire temporaire, le crochet copie dans le paquet.

**Mesuré.** Liaison vérifiée après construction : `PE32+ executable (DLL) x86-64, for MS Windows`.
L'asar emporte les 9 langues, `@fluent` et better-sqlite3. 16 tests couvrent la reconnaissance du
format, le nom de l'archive publiée, la table des architectures d'electron-builder et les quatre
décisions du crochet — aucun ne touche le réseau, comme aucun test de terminal ne touche un vrai
terminal.

**Trouvé aussi** : le profil AppArmor, déclaré en `extraResources` global, partait dans le paquet
Windows (`resources/apparmor`). Il est passé sous `linux`.

**Et elle tourne.** Vérifié ensuite sous wine 9.0 64 bits, sur écran virtuel : `Ariane.exe`
démarre, écrit son index dans `AppData\Roaming\Ariane`, trouve un corpus fictif posé à
l'emplacement Windows par défaut, en indexe les sept transcriptions et les affiche — 6 dossiers,
7 conversations, 39 messages, en français. La base écrite (WAL de 933 Ko) est la preuve directe que
la DLL native se charge. Wine n'est pas Windows, mais un échec aurait tranché.

**Ce qui reste à vérifier sur une vraie machine** : le lancement d'un terminal et l'ouverture d'un
dossier dans l'Explorateur — les deux endroits où Ariane sort d'elle-même. Les paquets portent
encore l'icône d'Electron par défaut et ne sont pas signés. *(L'icône est arrivée depuis — voir
plus bas.)*

### Deux sections dans « Favoris », parce qu'on ne voyait pas la différence

Constaté à l'usage : une conversation favorite et un message favori portaient la même
étoile, et seule la place du texte les distinguait — ce qui ne se voit pas d'un coup d'œil. La vue
se lit maintenant en deux parties, **Conversations** puis **Messages** ; un message y est cité
entre les guillemets de sa langue (« … », „…“, 「…」), en italique, avec sa conversation dessous.
Le compteur de la ligne « Favoris » compte désormais les deux.

### Une conversation compactée ne se lit plus comme deux inconnues

**Le problème.** Quand Claude Code compacte une conversation, il ouvre
un **nouveau fichier** avec un nouvel identifiant. Ariane en montrait donc deux là où la personne
n'en avait vécu qu'une. Mesuré : 5 conversations du corpus réel sont dans ce cas — dont celle qui a
servi à écrire tout ceci.

**Mesuré aussi, avant de coder** : les autres assistants ne posent pas ce problème. Codex, Copilot
CLI et Gemini compactent **dans le même fichier** — la conversation y continue (55, 20 et 2
enregistrements après la marque, sur les fichiers concernés). Qwen ne compacte pas. C'est un
défaut propre à Claude Code.

**Ce que ça change.** Chaque partie garde sa ligne — ce sont des fichiers distincts, avec leurs
dates et leurs comptes — mais l'en-tête dit « Partie 2 sur 3 » et offre d'aller à la précédente ou
à la suivante. Rien n'est fusionné : aucun compte n'est faussé.

**Comment le lien est retrouvé.** Il était déjà dans les fichiers : l'enregistrement
`compact_boundary` porte `logicalParentUuid`, l'identifiant du dernier message de la conversation
précédente. L'index le retient (`continues_uuid`), et remonte puis redescend la chaîne. Une partie
dont la transcription a été purgée interrompt la marche : la chaîne montre ce qui existe, jamais
une supposition.

**Au prix d'une reconstruction unique.** Le schéma passe en version 9, donc l'index sera reconstruit
au prochain démarrage — une dizaine de secondes. C'est justement ce que l'archive et le fichier des
repères rendent sans danger.

### Vos repères : une étoile et une note

**Ce que ça change.** Une étoile en haut d'une conversation, une note sous son titre, et une ligne
« Favoris » dans la colonne qui ne montre que ce qui est marqué. La note s'écrit à mesure qu'on la
tape, et la vue « Favoris » affiche son début à la place de la date — c'est ce qu'on cherchait.

**La décision qui décide de tout.** Ces repères sont la **seule chose dans Ariane que personne ne
peut reconstruire** : les dossiers, les conversations, les messages reviennent des fichiers des
assistants en dix secondes, et l'index est justement supprimé et reconstruit à chaque changement de
schéma. Des favoris rangés là auraient disparu à la première mise à jour. Ils vivent donc dans leur
propre fichier (`marks.json`, dans le dossier de données), rattachés à l'identifiant global
`agent:sessionId` — le seul qui survive à une réindexation.

**Vérifié de bout en bout** : l'index est vidé, reconstruit depuis les fichiers des assistants, et
l'étoile comme la note sont toujours là. Cinq garanties cassées exprès, cinq tests qui l'ont vu :
un fichier illisible n'est jamais réécrit, les clés inconnues sont gardées, une entrée vide est
retirée, un identifiant douteux est refusé, et « Oublier » emporte la marque avec le reste.

**Trouvé en chemin.** La ligne « Favoris » n'affichait pas son nombre : la localisation de la page
remplace le contenu d'un élément, et effaçait donc le compteur placé dedans. Le test qui l'aurait
vu n'existait pas ; il existe.

### Une étoile sur un message, pas seulement sur une conversation

**Ce que ça change.** Chaque message peut être marqué — souvent, ce qu'on cherche est une réponse
précise dans une conversation de six mille messages. Le message marqué ressort dans le plan, à
droite, d'un trait plus épais et de la couleur de l'étoile ; il apparaît dans la vue « Favoris »
avec ses propres mots, et un clic y retourne directement.

**Le piège, mesuré.** Le numéro de ligne d'un message change à chaque reconstruction de l'index :
le viser, c'est perdre le favori à la première mise à jour. Et l'identifiant propre au message
n'existe pas partout : 98 % chez Claude Code, 91 % chez Codex, 74 % chez Copilot CLI, 100 % chez
Gemini — et **0 % chez VS Code**. Une marque enregistre donc plusieurs coordonnées et se résout par
la plus fiable qui corresponde encore ; le début du texte rattrape une position décalée par un
changement d'extraction.

**Vérifié** : on marque un message, on vide l'index, on réécrit la transcription avec un message
inséré **avant** celui qui est marqué, on reconstruit — et l'étoile retombe dessus, à une autre
position et sur une autre ligne.

**Trouvé en chemin, encore.** Un gabarit imbriqué dans le gabarit qui porte le script de la suite
de rendu : le fichier ne se chargeait plus, et la suite restait pendue au lieu d'échouer. Sept
minutes par essai, trois essais, avant de rediriger sa sortie vers un fichier plutôt que de la
perdre en coupant le processus.

### Les documents remis d'aplomb

Une lecture neuve des notes du projet, de `ROADMAP.md` et de `README.md`, sans rien en connaître, puis
a répondu à huit questions pratiques. Elle a trouvé : un tableau du README qui additionnait 406
sessions pour un total annoncé de 342, trois totaux de messages différents dans trois documents,
trois tailles de corpus, un « ordre proposé » qui recommandait des points déjà faits, et un gel de
`SCHEMA_VERSION` resté écrit au présent alors que sa raison d'être avait disparu.

Tout a été remesuré, et les chiffres ne vivent plus qu'à un seul endroit, daté. Un test de plus :
le processus principal ne pouvant pas importer un module ES, `locale.js` recopie le motif
d'étiquette de langue de `l10n.js` — deux copies divergent toujours, celle-ci ne peut plus.

Et `ARCHITECTURE.fr.md` est né : le détail que des notes courtes ne peuvent pas porter, puisqu'elles sont lues au
démarrage de chaque session.

---

## 19 septembre 2026

### Ariane parle neuf langues

**Ce que ça change.** L'app suit la langue du système (`fr-BE` trouve le français), et se change
dans les Réglages : la fenêtre se réécrit et rouvre la conversation en cours. Français, anglais,
néerlandais, allemand, espagnol, italien, portugais du Brésil, japonais, chinois simplifié.

Chaque phrase vit dans `src/locales/<langue>.ftl`, au format **Fluent** de Mozilla : la grammaire
de chaque langue — pluriels, variantes — est dans son fichier, le code ne passe qu'un nombre.
Ajouter une langue, c'est ajouter un fichier. Dates, nombres, tailles et listes viennent d'`Intl`.

**Mesuré.** ~190 phrases sorties du code. Aucun débordement de l'en-tête en allemand, japonais ni
néerlandais, mesuré en pixels.

**Trouvé en chemin.** Des libellés français étaient **enregistrés dans l'index** (« Résumé de
session », « Échec ») : l'index stocke désormais des codes, et lit encore les anciens libellés —
aucune reconstruction nécessaire. `speakerOf` renvoyait un nom ; il renvoie un rôle, car le plan de
la conversation comparait au mot « Vous », ce qui aurait cassé dès la deuxième langue.

**Garde-fous.** Mêmes clés, mêmes attributs et mêmes variables dans chaque fichier ; une
pseudo-langue qui marque ⟦…⟧ tout ce qui passe par le traducteur et parcourt chaque écran pour
révéler une phrase restée en dur ; rien d'autre que le moteur ne formate une date.

### Dire à Ariane où vit une CLI, et une fenêtre pour le faire

**Ce que ça change.** La roue dentée ouvre une fenêtre qui liste les assistants trouvés ou
utilisés : ce qu'Ariane a trouvé, un chemin à imposer — tapé ou choisi par « Parcourir… » —
vérifié à mesure sans rien lancer, et « Ajouter un assistant » pour les autres. « Ouvrir le fichier
JSON » donne accès au fichier lui-même.

Avant d'ouvrir un terminal, Ariane vérifie la commande **et** l'interpréteur que nomme sa première
ligne. Le terminal qui s'ouvrait et se refermait dans la même seconde est remplacé par une phrase
qui dit ce qui manque, avec un bouton « Ouvrir les réglages ».

**La décision qui compte.** Deux champs par assistant, jamais fusionnés : `detected`, ce qu'Ariane
a trouvé, et `command`, à la personne. Le plan prévoyait de pré-remplir `command` avec la
détection ; ç'aurait figé un chemin que la prochaine mise à jour de nvm aurait cassé.

**Mesuré.** Couverture de `terminal.js` : 74,5 % → **95,5 %** des lignes. Aucun test ne peut
atteindre un vrai terminal : `spawn` est injecté.

**Trouvé en chemin.** Les versions de node étaient triées par ordre alphabétique — `v9` passait
avant `v22`. `resume.js` refusait tout dossier ne commençant pas par `/`, donc tout dossier
Windows. Un dossier portant le nom d'une commande passait pour exécutable. Et un échec de
lancement, sans écouteur, pouvait faire tomber le processus principal.

### Chercher par date

**Ce que ça change.** Une seconde liste dans la barre de recherche : toutes les dates, 7 derniers
jours, 30 derniers jours, cette année. Chaque résultat indique sa date, et un résultat vide dit si
c'est la période qui en est la cause.

Les jours se comptent en jours de calendrier locaux, depuis minuit, y compris à travers un
changement d'heure. Le moteur de rendu ne fait que nommer la période ; le processus principal
calcule la borne, et refuse une période inconnue plutôt que de chercher partout en silence.

**Trouvé en chemin.** 83 de vos propres prompts, dans 21 conversations, n'ont aucun horodatage (le
pointeur `last-prompt` de Claude Code n'en porte pas) : ils prennent l'heure du message qui les
précède, sinon toute recherche datée les aurait perdus. Et le champ de recherche tombait à 174 px
entre les deux listes — il passe à la ligne quand la place manque.

### Des icônes qui parlent

Une famille dessinée dans `icons.js` — trait fin, SVG construit par le DOM, rien de chargé, rien à
autoriser dans la politique de sécurité. Quand l'en-tête manque de place (mesuré : six actions et
leurs libellés font ~635 px), les libellés s'effacent et les icônes restent, chaque bouton gardant
son nom pour les lecteurs d'écran. Sans cela, dans une fenêtre de 900 px, le titre de la
conversation tombait à 22 px.

### Exporter une conversation, et copier un message

**Ce que ça change.** « Exporter » dans l'en-tête : Markdown ou PDF, construits par le processus
principal à partir de l'index. Titre, assistant, dossier, branche et période en tête ; qui parle
marqué par sa couleur ; code en blocs ; outils résumés ; réflexion repliée. Dans l'ordre où la
conversation s'affiche, sens de lecture annoncé en tête. « Copier » sur chaque message.

**Mesuré.** 400 messages → 51 pages A4 en 0,8 s, sans figer l'app.

**Pourquoi par identifiant.** Le canal presse-papier plafonne à 4 096 caractères, et une réponse
les dépasse souvent : le moteur de rendu envoie l'identifiant du message, jamais son texte.

**Corrigé après coup.** L'export ignorait l'ordre d'affichage. Vous l'avez vu ; il suit désormais
l'écran.

### Naviguer dans les grosses conversations

**Ce que ça change.** Affichage par tranches, recherche dans la conversation ouverte (Ctrl+F, sans
accents ni casse), et un plan à droite : un trait par message de la personne, Alt+↑ / Alt+↓ pour
aller de l'un à l'autre.

**Mesuré.** Ouverture d'une conversation de 6 642 messages : fenêtre figée **~840 ms → ~13 ms**, le
reste peint par tranches d'environ 30 ms. Un résultat de recherche au bout est peint puis atteint
d'un saut ; un message qui arrive n'ajoute que sa ligne.

**Pas fait.** Le saut « à une date » dans une conversation : les dates sont dans l'infobulle de
chaque trait.

### Garder ce que les agents effacent

**Ce que ça change.** Une conversation dont le fichier disparaît est copiée dans une archive à
part, que les migrations ne touchent jamais ; après une reconstruction, elle revient d'elle-même,
marquée « sauvée ». Un bouton **Oublier** l'efface pour de bon — sauver par défaut, oublier sur
demande.

**Pourquoi.** L'index n'est pas purement dérivé : dès qu'un agent efface une transcription, il en
détient la seule copie. Or une hausse de `SCHEMA_VERSION` supprime toutes les tables.

**Trouvé en chemin, et plus grave que prévu.** Une transcription Claude effacée revenait aussitôt
de `history.jsonl` sous la forme de « prompts seuls », et la passe suivante supprimait tout le
reste de la conversation — sans attendre aucune migration.

**Vérifié.** « Oublier » efface vraiment : `secure_delete`, fusion des segments de l'index plein
texte, point de contrôle du journal. Le test lit les octets du fichier, connexion encore ouverte,
et n'y trouve plus rien.

### Se tenir à jour tout seul

**Ce que ça change.** Une passe silencieuse toutes les 30 s tant que la fenêtre est visible, et une
au retour sur la fenêtre. Une conversation terminée à l'instant n'attend plus un Ctrl+R.

**Mesuré.** Passe sans changement : **~420 ms → ~60 ms** tant que l'app tourne. Ce qui restait,
c'est un `stat` par fichier (~700 fichiers) et une requête par session. La découverte relisait
chaque en-tête, réanalysait des instantanés VS Code entiers et rouvrait 188 bases SQLite à chaque
passe ; elle passe maintenant par un mémo estampillé par la taille et la date.

**Trouvé en chemin.** Après un Ctrl+R, les dossiers ouverts restaient bloqués sur « Chargement… ».

### L'ordre de lecture, conversation par conversation

Un bouton dans l'en-tête inverse l'ordre des messages. L'état appartient à **chaque conversation**,
il est gardé tant que l'app tourne, et tout revient à l'ordre par défaut au relancement — le plus
récent en haut. Une ancienne version rangeait un ordre unique pour toutes les conversations : la
clé est effacée au démarrage.

### Un corpus de démo, et une capture qui ne montre personne

La capture du README montrait de vraies conversations. Un corpus fictif a été écrit — Ada, 14
conversations chez quatre assistants, dans les vrais formats — avec `npm run demo` et
`npm run demo:capture`. La capture refuse de se faire si un dossier sort de `/home/ada`.
L'ancienne image a été retirée de l'historique git.

---

## 18 septembre 2026 — les fondations

### Six assistants, un index, une recherche

Claude Code, Codex, Copilot CLI, Qwen Code, Gemini CLI et le panneau de chat de VS Code (qui couvre
aussi VSCodium et Cursor), derrière un contrat d'adaptateur unique. Les conversations sont
regroupées **par dossier de travail**, quel que soit l'assistant. Recherche plein texte
insensible aux accents, index incrémental.

### Ne jamais mettre de mots dans la bouche de quelqu'un

Le format enregistre les sorties d'outils **sous le rôle « user »**, parce que c'est ainsi que
l'API les transporte. Mesuré sur un corpus réel : sur 7 298 enregistrements « user », 885 seulement
(12 %) avaient été tapés par la personne ; 6 128 étaient des sorties d'outils et 285 des avis du
harnais. L'écran ne crédite plus personne dans ces cas-là.

Ce défaut passait tous les tests unitaires pendant que l'écran se trompait : c'est lui qui a fait
naître la suite de rendu sous Electron.

### Reprendre une conversation dans son terminal

Quatre assistants savent rouvrir exactement la session affichée ; Gemini ne sait reprendre que « la
dernière » et le dit ; VS Code n'expose rien. La commande est reconstruite dans le processus
principal, jamais reçue du moteur de rendu, et lancée avec un vecteur d'arguments — jamais une
chaîne passée à un shell.

### Ce que les audits ont récupéré

Plusieurs passes d'audit, chacune mesurée, ont rendu à la lecture ce que l'extraction jetait :
les messages tapés pendant que l'assistant travaillait (sur une session réelle, 30 des ~50 messages
de la personne ne vivaient que là), les résultats d'outils de Codex et Copilot, les prompts écrits
en blocs de contenu, et les types d'enregistrements que personne n'avait regardés. Le filet est
resté : `npm run audit:noise` oblige chaque type écarté à prouver qu'il ne contient rien de la
personne.
