# Journal des changements

Ce qui a été fait, et ce que cela a coûté à mesurer. La feuille de route (`ROADMAP.md`) ne garde
que ce qui reste ; tout ce qui est terminé vient ici.

Chaque entrée dit trois choses : **ce que ça change** pour la personne qui s'en sert, **ce qui a
été mesuré**, et **ce qu'on a trouvé de cassé en chemin** — car presque aucun de ces travaux n'a
révélé ce qu'on croyait.

Les chiffres du corpus **et ceux des suites** vivent dans `ARCHITECTURE.fr.md` § 12, mesurés et
datés. Ils ne sont recopiés nulle part ailleurs : quatre documents en ont déjà porté trois
différents.

## Versions publiées

Les entrées ci-dessous sont classées par date, parce que c'est la date qui explique une décision.
Voici à quelle version chacune appartient.

| Version | Date | Ce qu'elle apporte |
|---|---|---|
| [0.7.0](https://github.com/ZamBoyle/Ariane/releases/tag/v0.7.0) | 25 sept. 2026 | les limites d'utilisation de Codex et de Claude, lues et datées ; ce qu'a coûté une conversation, en haut d'elle ; vos mots une seule fois ; une conversation qui mettait 31 s à s'ouvrir s'ouvre aussitôt |
| [0.6.0](https://github.com/ZamBoyle/Ariane/releases/tag/v0.6.0) | 25 sept. 2026 | ce que coûte chaque réponse, en jetons ; la taille du texte réglable, avec Ctrl+= et le pavé numérique ; une conversation reprise reliée à celle qu'elle continue ; Electron 44.4.5 |
| [0.5.1](https://github.com/ZamBoyle/Ariane/releases/tag/v0.5.1) | 25 sept. 2026 | une indexation complète deux fois plus rapide : 13 s au lieu de 30 |
| [0.5.0](https://github.com/ZamBoyle/Ariane/releases/tag/v0.5.0) | 25 sept. 2026 | les sous-agents de Claude et de Codex, rattachés à leur conversation ; une conversation reprise ne répète plus celle qu'elle reprend |
| [0.4.2](https://github.com/ZamBoyle/Ariane/releases/tag/v0.4.2) | 25 sept. 2026 | les jetons de Gemini et de Copilot ; la couverture du code visible sur GitHub |
| [0.4.1](https://github.com/ZamBoyle/Ariane/releases/tag/v0.4.1) | 24 sept. 2026 | les appels d'outils d'Antigravity ; le raisonnement masqué de Claude nommé dans les statistiques |
| [0.4.0](https://github.com/ZamBoyle/Ariane/releases/tag/v0.4.0) | 24 sept. 2026 | une vue Statistiques : qui a écrit, les jetons, mois par mois, par assistant, modèle et dossier |
| [0.3.7](https://github.com/ZamBoyle/Ariane/releases/tag/v0.3.7) | 24 sept. 2026 | l'indexation retrouve sa vitesse d'avant les jetons de Codex |
| [0.3.6](https://github.com/ZamBoyle/Ariane/releases/tag/v0.3.6) | 24 sept. 2026 | le modèle dans la barre latérale ; une conversation sans titre nommée par ses premiers mots |
| [0.3.5](https://github.com/ZamBoyle/Ariane/releases/tag/v0.3.5) | 24 sept. 2026 | quel modèle a répondu ; les titres de Copilot réparés |
| [0.3.4](https://github.com/ZamBoyle/Ariane/releases/tag/v0.3.4) | 24 sept. 2026 | les jetons de Claude comptés une fois, ceux de Codex ; une conversation Codex retrouvée |
| [0.3.3](https://github.com/ZamBoyle/Ariane/releases/tag/v0.3.3) | 24 sept. 2026 | ce que chaque conversation a coûté en jetons, sous son nom — comptés jusqu'à 2,5 fois pour Claude |
| [0.3.2](https://github.com/ZamBoyle/Ariane/releases/tag/v0.3.2) | 23 sept. 2026 | le Markdown des assistants : tableaux, liens, listes imbriquées ; un dossier se lit par date ; la fenêtre porte son icône |
| [0.3.1](https://github.com/ZamBoyle/Ariane/releases/tag/v0.3.1) | 23 sept. 2026 | le paquet n'emporte plus les sources C : −2,2 Mo |
| [0.3.0](https://github.com/ZamBoyle/Ariane/releases/tag/v0.3.0) | 23 sept. 2026 | Ariane prévient qu'une version existe ; l'icône de la barre des tâches |
| [0.2.0](https://github.com/ZamBoyle/Ariane/releases/tag/v0.2.0) | 22 sept. 2026 | la première version téléchargeable ; la CI sur trois systèmes ; les jetons indexés |

---

## 25 septembre 2026

### Quand une conversation a commencé, et quand elle a fini

**Demandé** : dans l'en-tête, la date et l'heure du début et de la fin, « attention de bien trouver
les bonnes icônes ou la bonne présentation ». L'en-tête ne donnait que la date du dernier message.

**La présentation d'un agenda** : un rendez-vous s'écrit « 23 sept. 2026, 16:19 – 18:29 », la date
une fois quand tout tient dans la journée, les deux dates sinon — « 21 sept. 2026, 08:11 – 25 sept.
2026, 22:19 ». C'est `formatRange` d'Intl qui l'écrit, donc chaque langue a sa forme (« 2026/9/25
9時12分～11時47分 »). Derrière un **calendrier** ; au survol, chaque bout en entier (« Premier
message : mercredi 23 septembre 2026 à 16:19:24 »). Puis **combien de temps**, derrière un
**chronomètre** — son bouton le distingue de l'horloge qui dit « il y a » dans la barre latérale :
« 2 h et 10 min », « 4 j et 14 h », deux unités au plus. Une conversation d'un seul instant a sa
date, et pas de durée.

**Mesuré sur le corpus** : 356 conversations, dont 113 d'un seul instant, 215 dans une même journée
et 28 sur plusieurs jours (jusqu'à 142). **Le piège** : la date de début de la session compte les
copies, et une reprise recopie l'historique qu'elle reprend avec ses heures d'origine. Une
conversation sur 356 — celle qui recopie 922 messages — aurait commencé 41 minutes trop tôt. Le
début et la fin sont donc ceux de ses propres messages.

**Et les faits passent sous les boutons.** Dans la colonne du titre, la plage d'une conversation de
plusieurs jours repoussait tout : cinq lignes à côté d'un grand vide sous les boutons. Ils prennent
maintenant toute la largeur de l'en-tête, et l'option A retrouve ses trois lignes. L'ordre de
lecture ne change pas pour un lecteur d'écran : le titre, les faits, puis les boutons.

**Une question par ligne**, sur une remarque d'ergonomie (« les messages ne devraient pas passer au
début de la dernière ligne ? ») : le nombre de messages quitte la ligne des dates et ouvre celle
de ce qu'a coûté la conversation. Qui et où ; quand et combien de temps ; combien — les messages,
puis les jetons. « Transcription purgée » et « sauvée par Ariane » ferment cette dernière ligne :
elles disent ce qui reste de la conversation.

**Vérifié** : l'index (le début d'une reprise est son premier message à elle), le formatage en
français et en anglais, l'en-tête rendu (la plage, les deux bouts au survol, la durée, les deux
icônes, et pas de durée pour un seul instant), et la mise en page (les faits sur toute la largeur,
sous les boutons). Chacun de ces tests a échoué sur le code volontairement cassé : sans le filtre
des copies, avec une durée pour un seul instant, avec l'ancienne colonne.

### La barre latérale, dans le même esprit

**Demandé** : le même soin que pour l'en-tête. Sous le nom de chaque conversation, deux lignes
grises : « il y a 1 minute · 7 706 messages », puis le modèle et trois chiffres de jetons — et
cette troisième ligne était coupée sur presque chaque conversation (« cache 1,… »).

**Deux maquettes, sur les vraies conversations.** L'une regroupée comme l'en-tête, sur trois
lignes ; l'autre épurée sur deux — qui, dans les 300 px de la barre, se coupait partout (« il y a
28… », « 2 549 mes… », « claude-o… ») : pire qu'avant. C'est la première.

**Ce qui se voit maintenant** : quand et combien, chacun annoncé par son icône, comme dans
l'en-tête ; puis le modèle dans une étiquette et ce que la conversation a coûté, envoyé et reçu —
« ↑ 11,3M · ↓ 2,4M ». Le chiffre du cache, celui qui se coupait, passe au survol avec les chiffres
exacts, et reste en toutes lettres dans l'en-tête. Plus rien n'est coupé ; si la place manque un
jour, seul le nom du modèle cède.

### Un en-tête où l'on s'y retrouve

**Signalé** : « tout est mélangé dans l'entête de la conversation, on ne s'y retrouve pas ». Huit
faits de nature différente — l'assistant, les modèles, le dossier, la branche, la date, le nombre de
messages, trois chiffres de jetons — tenaient dans une seule chaîne de points, à la même taille et
dans la même couleur, et le dossier finissait coupé (« /home/zam/Do… »). Il fallait tout lire pour
trouver un fait.

**Choisi sur pièces.** Deux maquettes, faites dans l'application réelle sur la conversation de la
capture et montrées en images : A garde les libellés des boutons, et les faits passent sur trois
lignes ; C met les boutons en icônes, et les faits tiennent en deux. C a été essayée pour de vrai,
puis écartée — « trop d'infos sur une ligne » — : c'est **A**.

**Ce qui se voit maintenant.** Sous le titre, les faits sont groupés par la question qu'ils
règlent : **qui** (la marque de l'assistant, comme dans la barre latérale, son nom, les modèles),
**où** (le dossier par son nom, le chemin entier au survol, la branche en étiquette), **quand**,
**combien** de messages — chaque groupe annoncé par une icône, deux questions par ligne : qui et
où, puis quand et combien. Sur une ligne à elle, **ce qu'a coûté
la conversation**, ses chiffres nommés : « ↑ 756K envoyés · ↓ 477K reçus · 94,8M relus depuis le
cache ». Un groupe passe entier à la ligne quand la place manque ; seul sur la sienne et encore trop
long — un nom de dossier interminable —, son texte finit par « … » au lieu de déborder, le chemin
entier au survol. La CI l'a appris : sous macOS et Windows, dont les polices sont plus larges, le
premier jet débordait ; le test reproduit désormais le cas sous Linux aussi. Les boutons gardent
leurs libellés ; « Oublier » montre sa question en toutes lettres pendant qu'il attend le second
clic, même quand la fenêtre étroite les réduit à des icônes — ce qu'il ne faisait pas.

**Vérifié** : la suite de rendu contrôle les groupes et leur répartition par ligne, le chemin au
survol, la branche nommée, le coût sur sa ligne, et que chaque action affichée a un nom — elle
échoue si on retire l'infobulle d'« Ouvrir le dossier », ajoutée pour l'occasion dans les neuf
langues, utile quand la fenêtre étroite ne montre que les icônes. La suite de mise en page vérifie
qu'un dossier au nom interminable fait passer des groupes à la ligne sans que rien ne déborde.

### Des textes qu'on lit : le contraste, mesuré

**Signalé** : « les textes sont sombres un peu, non ? » — et ils l'étaient, chiffres à l'appui. Le
ton « pâle » des textes secondaires — dates, chemins, lignes sous les titres, jetons, notes, 41
usages — ne passait que **2,7:1 en clair et 3,4:1 en sombre**, là où l'accessibilité en demande 4,5
pour un petit texte. L'accent orange, quand il écrit (« Codex », « Claude »), n'atteignait que 3,7
en clair.

**Le thème reste celui de Claude Code** : mêmes teintes, seule la clarté bouge, juste ce qu'il faut.
En clair, le pâle passe de `#97938b` à `#6f6b63`, le doux de `#6b6862` à `#5a5752` pour rester un
cran au-dessus, l'accent de `#c2603c` à `#a85334` ; en sombre, le pâle de `#7a766d` à `#959188` et
le doux de `#a8a49a` à `#b3b0a7`. Tous les tons de texte passent désormais 4,5:1 sur chaque fond —
la page, la barre latérale, les cartes — dans les deux thèmes, et la hiérarchie tient : 15,8 > 6,8 >
5,0 en clair, 15,1 > 8,1 > 5,6 en sombre.

**La suite de mise en page le mesure**, sur les couleurs que calcule le vrai moteur, et échoue sur
les anciennes en nommant chaque paire trop faible. L'accessibilité devient l'étape 5 de la feuille
de route ; le contraste en est la première pièce.

### L'identifiant de la conversation, tout en haut

**Demandé** : tout en haut de l'en-tête, sur une ligne à lui, l'identifiant de la conversation tel
que son assistant le connaît — celui qu'on donne à `claude --resume` —, en petits caractères à
chasse fixe, sélectionnable pour être copié, et son sens au survol. Calculé par la même fonction
que la reprise dans un terminal (`bareId`), pour qu'il ne puisse pas y avoir deux règles.

**Une ligne à lui, parce que dans la colonne du titre il était coupé** : les six boutons de
l'en-tête ne lui laissaient que 260 px, et `…04175df3fd…` ne se copie pas. La suite de mise en page
vérifie qu'il occupe toute la largeur de l'en-tête — elle échoue s'il retourne dans la colonne.

### Une conversation qui mettait 31 secondes à s'ouvrir

**Signalé** : « une conversation très difficile à ouvrir ». Mesuré étape par étape sur les plus
grosses : pour « Historique des conversations et dossiers », tout le temps était dans une seule
requête — celle qui cherche d'où une conversation reprise a recopié ses premiers messages, pour le
bandeau « a commencé par recopier… ». **31 360 ms**, pour 922 messages recopiés.

**Le piège, déjà payé une fois.** L'index des `uuid` est partiel (`WHERE uuid <> ''`) : SQLite ne
s'en sert que si la requête redit cette condition. Celle-ci ne la redisait pas, et le moteur
parcourait chaque conversation de l'assistant et tous ses messages, une fois par copie. C'était
exactement l'erreur corrigée dans `markCopies` en 0.5.0 (272 s → 72 ms), restée dans sa voisine.
Corrigée : **5 ms**. En cherchant la même faute ailleurs, une troisième : la chaîne des parties
d'une conversation lisait toute la table des messages à chaque ouverture, **46 ms → 0,17 ms**.

**Vérifié** : pour les 745 conversations de l'index, la chaîne et l'origine des copies sont
identiques avant et après — 71 s pour toutes les parcourir avant, 0,12 s après. Dans l'application,
les deux conversations les plus lourdes s'ouvrent maintenant en 180 à 420 ms, la plus grosse (7 484
messages) en 390 ms. Et **un test lit désormais le plan de SQLite** pour les quatre requêtes qui
cherchent par `uuid` : il échoue dès que l'une n'utilise plus l'index — c'est l'absence d'un tel
test qui avait laissé la faute revenir.

### Ce qu'a coûté la conversation, en haut de la conversation

**Demandé** : la ligne `↑ envoyés · ↓ reçus · cache relus` de la barre latérale est maintenant
aussi au bout de la ligne sous le titre, les chiffres exacts au survol, avec le coût des
sous-agents à part et, pour un sous-agent, le rappel que ses chiffres sont un plancher. Mêmes
sommes que la barre latérale, calculées de la même façon : une copie compte là d'où elle vient, un
agent qui n'a rien mesuré n'affiche rien, pas « 0 ».

**Quand la ligne est trop longue, c'est son texte qui se coupe** — le dossier, la date —, jamais les
jetons : la suite de mise en page le mesure sur une ligne huit fois trop longue, et échoue si on
retire la règle. Sur cette conversation-ci : 7 403 messages, ↑ 11,1M · ↓ 2,2M · cache 1,1G.

**Et par message, chez les autres ?** Lu dans le code de claude-code-history-viewer : une réponse
montre ses jetons bruts dans une infobulle, un message de la personne n'en a pas — les fichiers
n'en ont pas. Leur total de conversation, dans une carte à part, additionne tout, cache compris :
le « milliard de jetons » qu'Ariane refuse d'écrire.

### L'historique des limites de Claude, grâce à Claude Desktop

**Trouvé en lisant leur code**, comme demandé (« lire, jamais recopier ») : les documents de
conception d'Agent Sessions nomment un fichier que **Claude Desktop** tient à jour,
`plan-usage-history.json`. Il est chez toi, dans `~/.config/Claude/` : un relevé tous les quarts
d'heure tant que Claude Desktop tourne, 551 relevés sur un mois. Vérifié sur tes fichiers avant d'y
croire : le 23 septembre à 08:04 il dit 16 et 11, le cache de `~/.claude.json` dit 16 et 11 deux
minutes plus tard. Claude a donc maintenant sa semaine en cours — 27 %, lue aujourd'hui, au lieu
du relevé du 23 — et l'historique de ses semaines : 31, 15, 65, 73 %.

**Ce que le fichier ne dit pas, et comment on s'en passe.** Aucune fin de fenêtre. La semaine de
Claude est un bloc fixe : ses quatre remises à zéro du mois sont tombées pile sur la frontière que
nomme `~/.claude.json` (le mardi à 03:59 UTC), si bien qu'un relevé va à la semaine que cette
frontière découpe — et sans elle, rien n'est gardé. Les fenêtres de cinq heures commencent au
premier message (56 remises à zéro, à toute heure) : impossibles à séparer, elles ne sont pas
lues. Seulement le compte connecté ; un fichier d'une autre version est refusé plutôt que deviné.

**Il faut Claude Desktop, et il faut qu'il tourne.** Sans lui, rien ne change : le dernier relevé
de `~/.claude.json` et les requêtes refusées restent. Et comme il ne garde qu'un mois, **une
reconstruction de l'index ne perd plus les fenêtres déjà lues** : elles attendent la première
passe, qui ne remet que celles que les fichiers ne redonnent plus — ce que disent les fichiers
gagne toujours sur ce qu'une version plus ancienne a calculé. La logique de l'archive, appliquée
aux limites.

**Vérifié** : les cinq semaines sont exactement les niveaux atteints juste avant chaque remise à
zéro ; huit mutations, huit échecs ; une passe complète et une passe à vide, même temps qu'avec la
0.6.0.

### Les limites d'utilisation : lues, datées, jamais additionnées

**Ce que ça change.** La vue Statistiques a un bloc « Limites d'utilisation ». Pour chaque
assistant, la dernière fenêtre de chaque durée — cinq heures, une semaine — avec son pourcentage et
sa remise à zéro, atténuée quand elle est finie ; la date du relevé, l'offre et les crédits ;
combien de fois une limite a été atteinte ; et, pour Codex, les semaines relevées en colonnes.
Ariane ne demande rien à aucun serveur : elle lit ce que les assistants ont écrit.

**Où c'est écrit, mesuré.** Codex écrit un relevé à chaque `token_count` : 7 133 sur 7 541, dans
122 fichiers sur 145 — y compris dans des `token_count` sans jetons, qui ne comptaient pour rien.
Claude n'écrit ses limites dans ses conversations que sur une requête refusée (75 erreurs 429, sur
trois jours, 69 dans des sous-agents) : le type de fenêtre et sa fin, pas de pourcentage. **La
feuille de route disait « à vérifier » pour Claude, et avait raison** : c'est en regardant comment
font les autres qu'on a trouvé le reste — `~/.claude.json` garde le dernier relevé que Claude Code
a demandé (`cachedUsageUtilization`) : 16 % de la fenêtre de cinq heures, 11 % de la semaine, lu le
23 septembre. Un relevé, pas un historique.

**Quatre pièges, tous mesurés avant d'écrire une ligne.**
- Les fenêtres de Codex ont changé en juillet 2026 : cinq heures et une semaine, puis la semaine
  seule, passée de la case `secondary` à `primary`. Une fenêtre se reconnaît à sa durée.
- La fin d'une même fenêtre bouge d'une seconde ou deux entre deux relevés (49 fins de cinq heures
  sur 91 à moins de dix minutes d'une autre) : une fenêtre se retrouve par sa fin, à dix minutes
  près.
- Dans une fenêtre, l'usage ne fait que monter — et pourtant 16 relevés redescendent, chacun venu
  d'une autre conversation : une duplication recopie de vieux relevés sous sa propre date (0 % pour
  une semaine déjà à 95 %). Une fenêtre garde donc son plus haut relevé, daté de la première fois
  qu'il a été vu : aucune copie ne peut le hausser, et une copie vient toujours après l'original.
- Passé 100 %, Codex continue sur les crédits, et le solde baisse relevé après relevé : de 500 à
  123,27 en une semaine. Le premier jet montrait 260,2, pris au premier relevé à 100 %. Les crédits
  viennent maintenant du **dernier** relevé à ce niveau.

**Vérifié** : les 70 fenêtres de Codex que garde l'index sont identiques, champ par champ, à un
calcul indépendant fait sur les fichiers bruts. Une passe complète de Codex et Claude prend le même
temps qu'avec la 0.6.0 (13,6 s contre 13,9), la passe à vide aussi (430 ms). Dix mutations, dix
échecs de tests. `SCHEMA_VERSION` passe à 19.

**Ce qu'on ne montre pas, exprès.** Aucune prévision d'épuisement, aucun montant d'argent. Et
**rien sur les messages « Vous »** : demandé, mais aucun fichier ne compte les jetons d'un message
seul, et le `↑` de l'appel qui le suit ne suit pas sa longueur — mesuré sur 627 messages, 10
caractères donnent 1 779 jetons envoyés et 1 331 caractères 615. C'est le contexte qu'on envoie,
pas le message.

### Tes mots une seule fois : l'écho du dernier message, et la file d'attente

**Signalé depuis Windows** : dans une conversation Claude, « mon message initial est remis en
dernier ». En tête de la conversation — la plus récente, puisque l'ordre par défaut commence par la
fin —, un « Vous » sans date répétait le premier message, coupé par « … ». C'était le pointeur
`last-prompt` que Claude Code écrit pour `--resume`. Ariane l'écartait quand la conversation tenait
déjà le même texte, mais Claude Code l'écrit dans sa propre forme : retours à la ligne aplatis en
espaces, coupé au-delà de 200 caractères par « … ». La comparaison exacte échouait, et l'écho,
ajouté en fin de passe, s'affichait comme le message le plus récent. Il n'a pas fallu la base du
PC Windows : le même défaut était ici. **90 pointeurs sur 101** restés dans l'index répétaient
ainsi un message ; les 11 autres n'existent nulle part ailleurs et restent. La première mesure,
« 92 uniques sur 647 », comptait donc surtout des échos coupés.

**En cherchant, un second écho, plus gros.** Un message tapé pendant que Claude travaille est mis
en file (`enqueue`) — Ariane le récupère depuis la version 3 du schéma, parce que c'était alors le
seul endroit où il existait. Claude Code a changé depuis : sorti de la file (`dequeue`), le
message est écrit une seconde fois comme une ligne ordinaire. **219 messages sur 219 livrés**
s'affichaient deux fois. Ceux qu'on retire de la file (`remove`, 124) n'existent toujours que là.

**Le fichier décide, pas le texte.** Un « oui » retiré de la file puis un « oui » tapé plus tard
sont deux messages ; comparer les textes les aurait fondus. La règle suit donc ce que Claude Code
écrit : le premier message de la personne lu après un `dequeue` — mesuré, de 1 à 14 lignes plus
loin, en moins de 532 ms, toujours précédé d'un `dequeue` — est sa livraison, et la copie de la
file s'en va. Deux pièges payés en chemin : un « [Request interrupted by user] » s'intercale
parfois entre les deux (7 livraisons manquées au premier essai), et une passe peut s'arrêter entre
le `dequeue` et la livraison, d'où l'attente portée dans le curseur.

**Vérifié sur le vrai corpus**, le vrai indexeur contre la 0.6.0, ligne par ligne : 309 lignes en
moins — les 219 copies de la file, toutes suivies d'un `dequeue` dans le fichier, et les 90 échos —,
chacune avec son original présent, et pas une ligne portant un identifiant touchée. Le premier jet
coûtait 0,5 à 1 s de plus sur une passe complète : il interrogeait la base pour chaque écho
possible. Une passe qui lit un fichier depuis le début décide maintenant sur ce qu'elle a lu, et
trois passes alternées donnent 9,26 s pour la 0.6.0 contre 9,24 s.

**L'archive aussi**, qu'on ne relit pas : son format passe en version 3 et retire les deux échos.
Là où la preuve du fichier n'existe plus, seule part une copie de la file livrée en moins de deux
secondes — la moitié des livraisons suivent en 74 ms ; une copie qui a attendu plus longtemps reste
en double, plutôt que risquer un mot tapé une seule fois. La migration de l'index sauve de même,
sans leurs échos, les conversations qu'elle met à l'abri. `SCHEMA_VERSION` passe à 18 : le premier
lancement relit tout, une fois.

### Sous Windows, la fenêtre d'Ariane ne s'ouvrait plus

**Ce qui s'est passé.** Le travail sur la taille du texte, juste en dessous, l'appliquait au
`did-finish-load`, sur la page encore cachée. Sous Linux, rien à voir ; sous Windows,
`ready-to-show` ne venait alors jamais : l'écran d'accueil, puis rien — pas même dans Alt+Tab, et
le processus tournait toujours. Aucune suite ne pouvait le voir : la CI lance le rendu, la mise en
page et l'écran d'accueil, jamais la vraie fenêtre de `main.js`.

**Trouvé par bissection, sur la vraie machine.** Quatre variantes de `main.js` lancées sous
Windows : telle que publiée, l'écran d'accueil seul ; en gardant l'ancien menu, pareil ; sans le
zoom au chargement, l'écran d'accueil et la fenêtre ; sans les nouvelles touches, l'écran d'accueil
seul. Le coupable est le zoom posé sur la page cachée — ni le menu, ni les touches.

**C'est un bogue d'Electron, déjà connu** :
[#51972](https://github.com/electron/electron/issues/51972), ouvert en juin 2026 — «
`ready-to-show` never emitted when `webContents.setZoomFactor()` is called on a hidden window
before first paint », Windows, depuis Electron 40. Corrigé dans la 44.4.4 du 22 septembre ;
**Ariane passe de la 44.4.3 à la 44.4.5**, la dernière, qui y ajoute les correctifs de sécurité de
Chromium. **Vérifié sous Windows** : avec l'ancien `main.js` et la 44.4.5, la fenêtre apparaît — la
nouvelle version corrige le bogue à elle seule. La correction ci-dessous reste pourtant : elle
l'évite quelle que soit la version, `ready-to-show` a déjà régressé ailleurs
([#24855](https://github.com/electron/electron/issues/24855),
[#54025](https://github.com/electron/electron/issues/54025)), et une page cachée n'a aucune raison
d'être zoomée.

**La correction** : la taille s'applique une fois la fenêtre montrée, dans `ready-to-show`, juste
après `win.show()`. Vérifié sous Linux sur l'application lancée : 120 % enregistrés rouvrent à 120
%, avec ou sans écran d'accueil, stables sur dix secondes ; Ctrl+= mène à 130, Ctrl − à 120 puis
110, Ctrl+0 à 100, chaque fois enregistré ; un rechargement (changement de langue) garde la taille
; un ancien zoom de Chromium est toujours repris une fois. **Et sous Windows, sur la même
machine**, avec l'écran d'accueil : la fenêtre apparaît à côté de lui, deux Ctrl + du pavé
numérique mènent à 120 % — la barre latérale passe d'environ 277 à 331 px —, et la relance garde
120 %. Un contrôle lit `main.js` et refuse un zoom au `did-finish-load` : il échoue sur le code
publié.

### Ctrl+Q quitte aussi depuis l'écran d'accueil

**Signalé depuis Windows, pendant l'essai de la correction ci-dessus** : au second lancement,
Ctrl+Q ne fermait rien, et il a fallu arrêter les processus de force. L'écran d'accueil prend le
clavier à l'ouverture, et il n'a ni menu ni gestionnaire de touches : Ctrl+Q n'y a jamais rien fait
— mesuré sous Linux aussi, ce n'est pas le changement de menu qui l'a causé. Il lit maintenant les
mêmes touches que l'application, pour quitter et fermer seulement : Ctrl+Q quitte, Ctrl+W le ferme
— une quatrième sortie. Vérifié sur l'application lancée, en envoyant les touches à l'écran
d'accueil : Ctrl+W le ferme et l'application reste, Ctrl+Q ne laisse aucun processus. **Et sous
Windows** : l'écran d'accueil a bien le clavier au lancement, Ctrl+W le ferme en laissant
l'application ouverte, et Ctrl+Q ne laisse aucun processus six secondes plus tard. Un contrôle lit
`main.js` et échoue sans le gestionnaire.

### La taille du texte, les bonnes touches, et « Vérifier maintenant »

**Ce que ça change.** La taille du texte se règle de 90 à 130 %, dans les Réglages ou au clavier :
Ctrl+= (avec ou sans Maj), Ctrl −, le + et le − du pavé numérique, Ctrl+0 pour revenir — Cmd sous
macOS. Elle vaut pour toute l'application et se retrouve au lancement suivant. Et un bouton
« Vérifier maintenant », à côté du réglage des mises à jour, demande tout de suite s'il existe une
version plus récente : il dit « Ariane 0.5.1 est à jour », ou nomme la version qui attend, avec de
quoi aller la voir.

**Ce qui existait déjà, sans que personne le sache.** Mesuré sur l'application lancée, par de
vraies frappes : le zoom venait du menu par défaut d'Electron, caché et en anglais. Ctrl+Maj+=
agrandissait et Ctrl − réduisait, mais **Ctrl+= et le pavé numérique ne faisaient rien** — les
touches qu'on essaie d'abord. Ce même menu offrait « Toggle Developer Tools » et « Force Reload »
dans chaque paquet publié. Il n'y a plus de menu sous Linux et Windows (Ctrl+Q, Ctrl+W et F11
restent) ; macOS garde le strict nécessaire, sans lequel copier-coller n'y marche pas ; les outils
de développement n'existent plus que pour qui construit Ariane.

**Un zoom réglé avant est repris**, pas défait : sans taille enregistrée, Ariane reprend celle que
Chromium avait gardée. Vérifié : une page zoomée à 120 % par l'ancien raccourci rouvre à 120 %, et
le réglage le dit.

**« Vérifier maintenant » ne trahit pas la promesse** : aucune requête ne part sans que la personne
la demande. Réglé sur « jamais », Ariane ne demande rien au lancement ; un clic sur le bouton est
une demande, et c'est la seule fois où le réglage ne décide pas.

### Ce que coûte chaque message

**Demandé pour une formation** : montrer le poids d'un message en jetons, en plus de celui de la
conversation. Chaque réponse porte désormais, dans sa tête, la même ligne que sous le nom de la
conversation — `↑ envoyés · ↓ reçus · cache relus` —, les chiffres exacts au survol. On y voit ce
qu'on explique d'ordinaire avec les mains : la réponse elle-même pèse quelques centaines de jetons,
le contexte relu à chaque tour en pèse des dizaines de milliers, et il grossit de tour en tour.

**Le piège, mesuré avant d'écrire** : le compte d'une réponse n'est souvent pas sur ce que l'écran
montre. Chez Claude, 10 095 des 19 699 lignes qui portent un compte sont masquées — le raisonnement
chiffré, qui ne laisse qu'une signature —, et 18 413 n'ont pas de texte. Un affichage ligne par
ligne en aurait perdu la moitié. Les comptes sont donc **regroupés** par ce qui s'affiche : une ligne
masquée confie le sien au bloc suivant de la même réponse, sa prose ou sa bande d'appels d'outils,
et une bande additionne tous ses appels. Le message de la personne n'en porte jamais, ni un avis de
l'outil ; un compte encore en route quand la personne reparle revient à la réponse d'avant.

**Pas pour Copilot**, qui n'écrit qu'un total par session : sous une réponse, il passerait pour le
coût de cette réponse. Et pour un sous-agent, l'infobulle dit que ses chiffres sont un minimum.

**Vérifié** sur une vraie conversation, dans l'application : une bande de trois appels
`↑ 40,5K · ↓ 704 · cache 153K`, puis la réponse `↑ 762 · ↓ 2,3K · cache 65,1K`.

### Une conversation reprise sait d'où elle vient, et l'originale où elle continue

**Ce que ça change.** Quand on reprend une conversation, l'ancienne et la nouvelle sont désormais
deux parties d'une même chaîne, comme une conversation compactée : « Partie 1 sur 2 », et les
flèches pour passer de l'une à l'autre. Jusqu'ici, la reprise disait bien d'où venaient ses
copies, mais l'originale ne disait pas qu'elle continuait ailleurs.

**Trouvé en lisant le compteur de formats inconnus**, que chaque passe remplit et que personne
n'avait regardé depuis des jours. Cinq types s'y signalaient ; mesurés un par un :

- **`continued-in`** : Claude Code l'écrit dans l'**ancienne** transcription au moment de la
  reprise, avec le nom de la nouvelle. Un cas sur la machine, `64ffbe9a` → `d4c518b6`.
- **`forked_from_id`**, dans l'en-tête Codex : le même lien, écrit cette fois dans la
  **nouvelle**. Huit en-têtes le portent, dont sept sont des sous-agents — il y nomme le parent, et
  ceux-là restent des sous-agents. Le huitième est une duplication faite à la main, et comme elle
  n'a rien ajouté, elle n'apparaît pas comme une partie.
- **`agent-name`** (308 fois, le titre répété mot pour mot), **`agent-setting`** (`claude`) et le
  **`subagent.deselected`** de Copilot (trois clics d'interface, sans contenu) : rien à montrer,
  désormais nommés, pour que le compteur ne signale plus que du neuf. Le test qui audite le bruit
  exige la forme de chacun.

Il n'y reste que le fichier VS Code de 166 Mo, écarté exprès. L'index est reconstruit une fois
(`SCHEMA_VERSION` 17) ; il le fait désormais en 13 s.

### Une indexation complète deux fois plus rapide

**Signalé à l'usage** : « ça reste quand même fort lent à indexer par rapport au début du
projet ». Et à raison de corriger ma première explication : les messages des conversations n'ont
augmenté que d'un quart depuis le 19 septembre (38 691 → 48 660). Ce qui a presque doublé, c'est ce
qu'Ariane écrit — 74 802 lignes, avec les 24 172 des sous-agents et 2 086 copies gardées.

**Mesuré, assistant par assistant puis au profileur** : lire et interpréter les fichiers ne coûte
presque rien (2,6 s sur les 17,8 de Claude). Le temps partait dans l'écriture, et surtout dans les
pauses du journal de SQLite : tous les 4 Mo, il était recopié dans la base et le disque attendu.
Une reconstruction réécrit chaque page environ quatre fois — 475 Mo passent par le journal pour un
index de 117 Mo —, soit une centaine de pauses : la moitié de la passe. L'index plein texte, tenu
ligne à ligne, en prenait encore 4 s.

**Ce que ça change.** Le journal n'est plus recopié que tous les 64 Mo (au plus 68 Mo sur le
disque, vidé à la fin de chaque passe qui a écrit), et quand un index vide se remplit — au premier
lancement, ou après une mise à jour qui le reconstruit —, l'index de recherche est construit une
seule fois à la fin, en 0,3 s. Une indexation complète passe de **30 s à 13 s**, sur le même
corpus, deux fois de suite ; la passe de fond reste vers 80 ms. Ne jamais vider le journal pendant
la passe aurait gagné 2 s de plus pour un fichier temporaire de 475 Mo : écarté.

**Et si l'application est quittée pendant une reconstruction**, rien n'échappe à la recherche :
un drapeau posé avant de suspendre l'index plein texte le fait reconstruire à l'ouverture suivante.
Un test coupe une reconstruction en route et vérifie que la recherche retrouve ce qui a été écrit.

### Les sous-agents, lus et rattachés à leur conversation

**Ce que ça change.** Les transcriptions que Claude Code écrit pour chaque sous-agent — et celles
de Codex — sont enfin lues. Un sous-agent n'entre pas dans la liste de gauche : on le rejoint
depuis la conversation qui l'a lancé, par une ligne dépliable sous son en-tête (« 327 sous-agents
lancés depuis cette conversation »), et il y ramène par un bouton. Il se lit, se cherche et
s'exporte comme une conversation ; « Reprendre » ne le propose pas, puisque son outil refuse de le
rouvrir. Sa consigne est écrite par l'assistant parent : elle s'affiche sans être attribuée à
personne. Ce qu'ils ont coûté apparaît au survol de la ligne de jetons de leur conversation et
dans une phrase des statistiques — à part, et comme un minimum.

**Mesuré sur la machine**, avant d'écrire : 381 transcriptions sous 6 conversations de Claude — 23
sous-agents et 358 agents de workflow —, 122 Mo, et 7 sous-agents chez Codex. Aucune ligne commune
avec la transcription principale. Trois pièges : le compte d'une réponse qui grandit de ligne en
ligne (réglé juste avant, ci-dessous) ; la consigne, que rien ne distingue d'un message tapé ; et le
lien vers la conversation mère, que Claude donne par le dossier et Codex par `parent_thread_id`.

**Vérifié** avec le vrai indexeur sur les vrais fichiers : 381 + 7 sous-agents, chacun rattaché à
son parent, aucun orphelin ; 4 399 539 jetons reçus chez Claude, exactement la mesure brute. Et
dans l'application réelle, sur une copie des réglages : les 327 sous-agents de la conversation qui
a lancé trois workflows, dépliés, ouverts, et le retour.

**Ce que ça coûte.** 24 000 messages de plus : une indexation complète — après une mise à jour qui
reconstruit l'index — passe de 14 à 24 s. La passe de fond, toutes les 30 secondes, de 72 à 82 ms :
la première version en prenait 105, parce qu'elle interrogeait deux fois chacun des 381 fichiers,
l'un après l'autre. Le tri des copies ne regarde plus que ce que la passe vient d'écrire.

### Une conversation reprise ne répète plus celle qu'elle reprend

**Signalé en mesurant les sous-agents.** Deux conversations de Claude partageaient 922 messages :
affichés deux fois, trouvés deux fois par la recherche, et 387 K jetons de sortie comptés deux
fois.

**Ce qui se passe.** Quand on reprend une conversation, Claude Code ouvre un nouveau fichier qui
commence par recopier tout ce qui suit la dernière compaction — mêmes identifiants, mêmes heures.
Codex fait de même quand on duplique une session (heures réécrites) : une reprise d'une seconde
recopiait 973 messages, et ses anciens instantanés de 2025 répétaient chacun toute la conversation
précédente, une même réponse dans 60 fichiers. ccusage a corrigé le même phénomène le 18 septembre
(v20.0.23).

**Ce que ça change.** Un message qu'une conversation plus ancienne du même assistant contient déjà
est une copie : il se lit, se compte et se trouve là d'où il vient, et nulle part ailleurs. La
reprise ne montre que ce qu'elle a ajouté, et une ligne sous son titre dit combien de messages elle
a recopiés et d'où, avec un bouton pour y aller. Une reprise qui n'a rien ajouté n'est plus listée.
La règle ne vaut que pour Claude et Codex, dont les identifiants sont uniques partout : Copilot et
Gemini numérotent leurs appels d'outils par session, et `bash_5` ici n'est pas `bash_5` là.

**Vérifié** avec le vrai indexeur sur les vrais fichiers, dans une base jetable : 922 copies chez
Claude et 1 164 chez Codex (64 conversations), 387 196 et 419 082 jetons de sortie en moins,
exactement le double compte ; Copilot, Gemini, Antigravity et VS Code strictement inchangés. La
première version du tri prenait **272 s** sur le corpus — SQLite parcourait toutes les
conversations pour chaque message — ; elle en prend 72 ms, et une passe complète dure ce qu'elle
durait en 0.4.2 (13,6 s contre 13,2 à 14,2 s).

**Et au passage.** La chaîne des conversations compactées ne passe plus par une copie, sans quoi
une reprise aurait pu se faire passer pour la partie précédente de son propre original. Mesuré
aussi : Claude Code compacte désormais dans le même fichier, et la chaîne ne relie plus rien
aujourd'hui.

### Le compte d'une réponse de Claude qui grandit de ligne en ligne

Dans une transcription principale, chaque ligne d'une réponse répète le même compte de jetons ;
Ariane compte donc la première. Dans celle d'un sous-agent, chaque ligne porte le compte **tel
qu'il était quand elle a été écrite** — `8, 8, 177` — et seule la dernière est juste (4 169
réponses sur 4 484 ; ticket Anthropic #93620). Chaque ligne compte désormais ce qu'elle **ajoute**
au plus haut compte déjà vu pour sa réponse : rien pour une répétition, la croissance pour un
nouvel instantané. Aucun changement pour les conversations principales ; indispensable pour lire
les sous-agents.

## 24 septembre 2026

### Les jetons de Gemini et de Copilot

**Ce que ça change.** Quatre assistants sur sept montrent maintenant ce que chaque conversation a
coûté : Gemini et Copilot rejoignent Claude et Codex, sous le nom de la conversation et dans les
statistiques. Les trois autres n'écrivent aucun compte.

**Mesuré avant d'écrire une ligne**, sur les fichiers de la machine, parce que chacun cachait un
piège que les noms des champs ne disaient pas :

- **Gemini** met le compte sur chaque réponse, mais son `input` **contient** ce que le cache a
  servi, et son raisonnement (`thoughts`) est compté **à côté** de la sortie : sur les 11 réponses
  qui en portent, `total = input + output + thoughts + tool`, chaque fois. Ariane retire le cache de
  l'entrée et ajoute le raisonnement à la sortie, pour que les mots veuillent dire la même chose que
  chez les autres.
- **Copilot** n'écrit aucun compte par réponse : seulement un **total cumulé** de la session, à
  chaque fermeture. Une session reprise réécrit le même total, ou un plus grand — l'une d'elles l'a
  répété trois fois avant de le faire grandir. Additionner les fermetures aurait compté la même
  dépense plusieurs fois ; Ariane ne compte que ce que chaque fermeture **ajoute**, et s'en
  souvient d'un passage à l'autre.

**Vérifié** avec le vrai indexeur sur les vrais fichiers, dans une base jetable : les 16
conversations Copilot qui portent un compte ont exactement le dernier total écrit par Copilot (les
2 autres n'en ont jamais écrit), et les 6 conversations Gemini qui contiennent une réponse, la somme
exacte de leurs réponses (les 13 autres n'ont que des questions). L'index est reconstruit une fois
(`SCHEMA_VERSION` 14).

### La couverture du code, visible sur GitHub et gardée par un seuil

**Ce que ça change.** Chaque exécution de la CI sous Linux mesure la couverture de la suite
unitaire et écrit son tableau dans le résumé de l'exécution, sur GitHub. Et `npm run test:coverage`
porte un seuil — 96 % des lignes, 87 % des branches, 94 % des fonctions, juste sous les 96,78 /
88,11 / 95,09 mesurés — en dessous duquel il échoue : une baisse devient une exécution rouge, plus
un chiffre que personne ne lit. Rien n'est envoyé à un service tiers ; pas de badge, qui l'aurait
exigé.

**Vérifié** en montant le seuil à 99 % : « 96.78% line coverage does not meet threshold of 99% »,
et un code de sortie 1 qui traverse le `tee` du résumé.

### Ce qui ne s'affiche pas, expliqué — et deux défauts qui s'y cachaient

**Signalé à l'usage.** La vue Statistiques annonçait « 6 561 ne contiennent rien à afficher, comme
une enveloppe vide ». Le nombre semblait trop grand pour être normal.

**Analysé enregistrement par enregistrement, jusqu'à la ligne d'origine.** **6 093** sont le
raisonnement de Claude, que Claude Code n'écrit plus en clair depuis avril 2026 : un bloc `thinking`
de 0 caractère et sa seule signature (0 raisonnement lisible sur 1 408 en août). Normal, et ce sont
eux qui portent les jetons de la réponse. 167 sont des enveloppes de Claude Code qu'Ariane retire
exprès. Mais deux groupes étaient des défauts, anciens tous les deux :

- **Antigravity perdait tous ses appels d'outils.** L'adaptateur ignorait le champ `tool_calls` :
  104 appels (`run_command` ×63, `view_file` ×21…), et 72 réponses qui n'étaient que des appels
  s'affichaient vides. On voyait la sortie d'une commande, jamais la commande. Les appels sont
  maintenant lus comme chez les autres assistants, leurs arguments décodés — chaque valeur arrive
  encodée en JSON une seconde fois.
- **Les avis de fin de tâche passés par la file d'attente** de Claude Code étaient rangés comme 218
  messages vides de la personne, alors que le même texte arrivé par une ligne ordinaire devient un
  avis. La file suit maintenant la même règle.

**Et le libellé est juste.** Un raisonnement masqué laisse désormais une trace (invisible) à
l'indexation, et la vue le nomme : « Parmi eux, 6 093 sont des raisonnements que Claude ne garde
plus que chiffrés : il n'en reste qu'une signature. »

**Vérifié sur les vrais fichiers**, dans une base jetable : 6 021 raisonnements masqués nommés
(sans l'archive), les 104 appels d'Antigravity lus et 7 réponses vraiment vides chez lui, plus aucun
message vide de la personne venu de la file. L'index est reconstruit une fois (`SCHEMA_VERSION` 13).

### Des statistiques, qui disent ce qu'elles mesurent

**Signalé à l'usage.** Le pied de la barre latérale annonçait « 49 411 messages », sans dire ce que
la personne avait envoyé ni reçu. Le concurrent a un tableau de bord ; ccusage des rapports.

**Ce que ça change.** Une icône à côté de l'engrenage — et le pied de la barre lui-même — ouvrent
une vue Statistiques dans le panneau de lecture. Qui a écrit : **2 791 messages tapés par vous,
23 451 réponses, 16 225 sorties d'outils, 627 avis** ; les 6 546 enregistrements restants ne
contiennent rien à afficher. Puis les jetons, envoyés, reçus et relus depuis le cache, avec la
couverture écrite en toutes lettres — mesurés dans 162 conversations sur 363, et le nom des
assistants qui n'en enregistrent pas. Puis une colonne par mois, une mesure à la fois ; et des
tableaux par assistant, par modèle et par dossier. Les assistants masqués et la période de la barre
de recherche s'y appliquent, comme partout ailleurs.

**Qui a parlé est décidé par les règles de l'écran.** Le calcul (`src/core/statistics.js`) reçoit
`speakerOf` et `hasContent` de format.js au lieu de les réécrire en SQL : deux implémentations de
« qui a dit ça » dériveraient, et c'est celle qui ne doit jamais mettre de mots dans la bouche de
la personne. La prose ne quitte pas SQLite, seulement le fait qu'il y en a ; les parts ne sortent
que quand il n'y en a pas. Environ 0,3 s sur 49 000 messages, au clic.

**Ce que la vue refuse de montrer : un coût en dollars.** C'est une estimation ; les fichiers
indiquent un abonnement (`plan_type: plus`), pas une facture au jeton ; et une grille de prix
vieillit — le journal du concurrent note *« Fixed claude-opus-4-7 3× overcharge »*.

**Les formes avant la couleur**, selon la méthode de visualisation suivie : des chiffres pour les
quelques grandeurs clés, des colonnes pour le temps, des tableaux à barre intégrée pour les
catégories, tous d'une seule teinte. Cette teinte a été passée au validateur de palette dans les
deux thèmes : l'accent passe en clair, et échoue d'un cheveu en sombre (L 0,672 pour 0,67) — les
colonnes y prennent un cran plus sombre.

**Trouvé en chemin.** Mon premier comptage oubliait la colonne `thinking` : 560 réponses faites de
raisonnement seul passaient pour vides. Un test le garde. Et un test de rendu vérifiait la période
à la fin du parcours, après qu'un autre clic l'avait déjà réappliquée : il ne pouvait pas échouer.
Il relève maintenant les appels au bon moment, et la mutation qui le prouvait inutile le fait
échouer.

### L'indexation redevient aussi rapide qu'avant les jetons de Codex

**Signalé à l'usage.** Un premier lancement, avec la reconstruction de l'index, semblait lent.
Une installation de paquets tournait en même temps, mais elle n'expliquait pas tout.

**Mesuré, version contre version, sur les mêmes fichiers et l'une après l'autre** : la 0.3.1
faisait une passe complète en 18 à 23 s, dont Codex en 7 à 9 ; la 0.3.6 en 32 à 45 s, dont Codex
en **21 à 30**. Claude n'avait pas bougé : la cause était l'adaptateur de jetons de Codex, ajouté
dans la 0.3.4.

**La cause.** À chacun des 7 521 `token_count`, l'indexeur vidait son tampon pour que la réponse
soit en base, puis faisait une mise à jour SQL — des milliers de transactions d'une ligne, là où
le tampon existe précisément pour écrire par lots de 500. Un compte s'ajoute maintenant **en
mémoire** à la dernière réponse encore dans le tampon ; il ne passe par la base que si sa réponse
y est déjà.

**Mesuré après** : Codex en 8 s, la passe complète en 21, au niveau de la 0.3.1. Les jetons restent
exacts au jeton près dans les 125 conversations Codex. Un test compte les écritures — cinquante
réponses et cinquante comptes, un seul lot et aucune mise à jour — et échoue avec l'ancien code.

### Le modèle dans la barre latérale

**Signalé à l'usage.** Un débat envoie la même question à plusieurs assistants : dans un dossier,
trois conversations portent le même titre, et rien ne disait laquelle était celle de Kimi-K3 sans
l'ouvrir. Le modèle ne s'affichait que dans l'en-tête.

**Ce que ça change.** La dernière ligne sous une conversation commence par son modèle :
`kimi-k3`, ou `gpt-5.6-sol · ↑ 474K · ↓ 15K · cache 9,5M`. Quand plusieurs ont répondu, celui qui
a le plus répondu, puis le nombre des autres — `gpt-6-astra +3` —, la liste entière au survol :
quatre noms ne tiennent pas dans une barre latérale. Les réponses comptées sont celles que
l'en-tête compte, celles qui portent du texte ; deux routes vers un même modèle n'en font qu'un.

**Ce que ça coûte, mesuré sur trois vrais dossiers** : 5,7 ms pour lister un dossier, contre 3,2
avec les jetons seuls. Un index aurait gagné 2 ms, mais seulement en comptant aussi les appels
d'outils — un autre nombre que l'en-tête — et au prix d'une reconstruction : écarté.

**Et deux défauts vus sur les captures.** Une conversation sans titre s'appelait « Sans titre »
dans l'en-tête et par ses premiers mots dans la barre latérale : l'en-tête reprend maintenant les
premiers mots. Et la ligne sous le titre, coupée quand elle nomme quatre modèles, se lit en entier
au survol.

### Quel modèle a répondu

**Signalé à l'usage.** Des débats menés avec Kimi-K3 à travers Copilot : Ariane les rangeait sous
Copilot, comme une conversation menée avec GPT, sans rien pour les distinguer. Le modèle était
enregistré depuis toujours et **ne s'affichait nulle part**.

**Ce que ça change.** L'en-tête d'une conversation nomme les modèles qui y ont répondu, dans
l'ordre où ils l'ont fait. Une réponse porte le nom de son modèle **quand il prend la main** — pas
sur chacune : deux cents fois le même nom ne dit rien, et quand un seul modèle a répondu du début à
la fin, l'en-tête suffit. Le concurrent l'affiche sur chaque message ; l'idée de le montrer vient de
là, pas la manière.

**Vérifié avant d'écrire, et le plan en a changé.** Copilot écrit le modèle sur chaque réponse
(269 sur 283), sauf dans deux conversations sur gpt-5.4 où il n'est que dans l'événement de
changement : le modèle en cours sert désormais de secours. Codex, lui, ne l'écrit **que** dans ses
`turn_context` — 1 963 dans 145 fichiers — et en change 23 fois au milieu d'une conversation :
chaque réponse reçoit le modèle de son tour, et le modèle voyage dans le curseur pour qu'une lecture
reprise le sache encore. Vérifié par le vrai indexeur sur les vrais fichiers : **136 conversations
Codex sur 136** portent sur chaque réponse le modèle de son tour. Les autres n'en nomment aucun,
nulle part — l'ancienne génération de fichiers.

**Et des titres que Copilot abîmait.** Ariane lit `workspace.yaml` à plat, sans parseur : quand le
nom est long, Copilot l'écrit en bloc (`name: |-`, puis le texte en dessous), et le titre devenait
« |- » — 7 conversations sur 18. Une apostrophe doublée entre apostrophes, comme YAML l'écrit,
restait doublée : « l''audit ». Et une invite commençant par un titre Markdown donnait « # ANALYSE… ».
Les 18 titres sont maintenant lisibles ; les 10 qui l'étaient n'ont pas bougé.

**L'index est reconstruit une fois** (`SCHEMA_VERSION` 12), pour relire ce qui l'avait été sans.

### Les jetons de Claude comptés deux fois

**Trouvé en expliquant un calcul, pas par un test.** Claude Code écrit une réponse en plusieurs
lignes — sa réflexion, son texte, chaque appel d'outil — et **chaque ligne répète le compte de la
réponse**. La 0.3.3 les additionnait toutes : 34 096 lignes portaient un compte pour 15 069 vraies
réponses, soit **2,26 fois trop** en moyenne. Sur la plus grosse conversation, Ariane affichait
6,4 M reçus et 2,2 G relus, pour 2,6 M et 1,0 G en réalité. Tous les chiffres mesurés ce jour-là
dans l'index en étaient faux, y compris ceux de l'entrée ci-dessous, corrigés depuis.

**Ce que ça change.** Une ligne ne compte que si sa réponse (`message.id`) n'est pas celle qui
vient d'être comptée. Les lignes d'une réponse se suivent toujours — aucune exception dans 434
transcriptions, sous-agents compris —, et le dernier identifiant voyage dans le curseur, pour
qu'une lecture reprise entre deux lignes d'une même réponse ne la recompte pas.

**Ce qu'aucune relecture ne peut corriger** : deux conversations n'existent plus que dans
l'archive d'Ariane, avec leurs comptes gonflés (14 lignes répétées sur 21, 118 sur 212). L'archive
passe au format v2, et sa migration retire le compte d'une ligne qui répète exactement celui de la
précédente — cinq nombres identiques, dont le contexte relu qui grandit à chaque appel. La
reconstruction de l'index, qui sauve ce que les agents n'ont plus, applique le même filtre quand
elle part d'un index antérieur.

**Vérifié au jeton près** : le vrai indexeur sur les vraies transcriptions, comparé à une réponse
comptée une fois par identifiant — **35 conversations sur 35 exactes**.

**Et une limite qui existait déjà, mesurée en passant** : Claude Code range ses sous-agents dans des
fichiers à part (`subagents/`), qu'Ariane ne lit pas — ni leur texte, ni leurs jetons. 384 fichiers,
4,4 M jetons reçus. Noté dans la feuille de route.

### Les jetons de Codex, et une conversation que Codex cachait

**Ce que ça change.** Les conversations Codex affichent leurs jetons comme celles de Claude : 125
de plus. Et une conversation disparue depuis le 5 septembre réapparaît.

**Le contrat se trompait, et le corpus l'a dit.** Il prescrivait d'additionner le
`last_token_usage` de chaque événement `token_count`. Mesuré sur les 145 fichiers : Codex
**répète** l'événement — 1 185 fois, le cumul n'a pas bougé —, et **35 fichiers sur 125**
sortaient trop haut, l'un au triple. Chaque fois que le cumul bouge, il bouge d'exactement
`last_token_usage` : 6 201 fois sur 6 201. Dix fois il recule : la conversation a été reprise, le
compteur repart, et ce tour-là est réel. D'où la règle : **un tour compte, sauf si le cumul égale
le précédent.** Le dernier cumul voyage dans le curseur de l'adaptateur, pour qu'une lecture
reprise reconnaisse encore une répétition.

**Deux autres pièges, trouvés en faisant tourner le vrai indexeur sur les vrais fichiers.** Les
fichiers plus anciens écrivent le compte **avant** la réponse qu'il paie : la toute première de
chaque conversation n'avait rien à quoi s'accrocher, et 43 comptes se perdaient. Ils attendent
maintenant la réponse suivante. Et `token_usage_record`, un flux plus récent, n'est pas lu : il
n'existe que dans 19 fichiers, nomme d'autres fils, et contredit `token_count` dans 8.

**Vérifié au jeton près** : le vrai indexeur, sur les vrais fichiers, dans une base jetable, comparé
au cumul de chaque fichier — **125 sur 125 exacts**. L'entrée de Codex inclut le cache et en est
retranchée, comme le contrat le définit.

**La conversation cachée.** Un fil de sous-agent porte dans son en-tête l'identifiant de la session
**parente** (`session_id`) et le sien dans `id`. Ariane lisait le premier : le sous-agent, 21
messages, prenait la place de sa conversation parente — 25 réponses et 15 messages de la personne,
invisibles. L'identifiant propre passe maintenant en premier. Dans les 130 autres en-têtes qui
portent les deux, ils sont identiques : aucune étoile ni note ne change de conversation.

**L'index est reconstruit une fois** (`SCHEMA_VERSION` 11), sans quoi les conversations déjà lues
ne le seraient jamais à nouveau.

### Ce que chaque conversation a coûté, sous son nom

**Ce que ça change.** Sous le résumé de chaque conversation, une ligne plus discrète :
`↑ 167K · ↓ 78,2K · cache 5,9M`. Au survol, les chiffres exacts. Une conversation dont
l'assistant n'a rien mesuré n'affiche rien — pas « 0 », qui prétendrait qu'il a mesuré et trouvé
rien.

**Les autres ont décidé de la forme.** ccusage, l'outil de référence, ne mélange jamais : entrée,
sortie, écriture et lecture du cache en colonnes séparées. Et un billet intitulé *« j'ai cru
utiliser un milliard de jetons, 97 % était du cache »* décrit le piège exact de nos chiffres. Le
premier plan tombait dedans : « envoyés » comptait le cache relu, soit **plus d'un milliard** pour
la plus grosse conversation.

**Mesuré sur les 35 conversations Claude qui en portent**, en médiane : 170 jetons d'entrée
fraîche, 166 K écrits en cache, 78 K reçus, 5,9 M relus depuis le cache. *(Chiffres corrigés le
jour même : la 0.3.3 comptait chaque réponse de Claude jusqu'à 2,5 fois, et les premières mesures
de cette entrée en portaient la trace — voir « Les jetons de Claude comptés deux fois ».)* D'où
trois nombres qui
disent chacun une chose vraie : **↑** ce qui était nouveau dans les invites — l'entrée fraîche
*plus* l'écriture en cache, car Claude fait passer presque tout le nouveau par le cache ; seule,
l'entrée fraîche ne voudrait rien dire —, **↓** ce qui a été reçu, et le **cache relu à part**,
nommé comme tel.

**K, M et G dans toutes les langues**, comme demandé, avec la virgule décimale de chacune :
`7,5K` en français, `7.5K` en anglais. La notation compacte d'`Intl` aurait écrit `7,5 k` en
français, rien abrégé en allemand, et compté en 万 en japonais. Une valeur qui s'arrondit au
palier suivant le prend : `1M`, jamais `1000K`.

**Trouvé en chemin : seul l'adaptateur de Claude lit les jetons.** Le contrat les définit pour
quatre agents, mais Codex, Gemini et Copilot n'ont jamais été branchés : 260 conversations sans
chiffre. C'est noté dans la feuille de route, avec le piège qui en décide la conception. Et un
`compact(null)` qui rendait « 0 » a été attrapé par son propre test avant de s'afficher nulle part.

**Ce que ça coûte.** Les sommes sont calculées par la requête qui liste un dossier, sur ses seules
conversations : 1,2 ms pour le plus gros dossier (78 conversations).

## 23 septembre 2026

### Le Markdown que les assistants écrivent vraiment

**Signalé à l'usage.** Un tableau dans une réponse de Claude s'affichait en lignes de barres
verticales et de tirets. Le moteur de rendu, écrit à la main, ne connaissait que les blocs de code,
les titres, les citations, les listes simples, le gras, l'italique et le code en ligne.

**Mesuré avant de rien écrire**, sur les 9 379 messages du corpus qui portent du texte : des
tableaux dans **483** (dont 464 écrits par un assistant), des liens dans 226, des listes imbriquées
dans 205, des filets `---` dans 183, du barré dans 31. Cases à cocher, titres de niveau 5 et
emphase `_ainsi_` : **zéro**, donc rien d'écrit pour eux. Les formules mathématiques : huit.

**Ce que ça change.** Les tableaux s'affichent, alignement compris, et défilent dans leur propre
boîte au lieu d'élargir la conversation. Les listes s'imbriquent, et une liste numérotée coupée par
une ligne vide reprend à son numéro au lieu de repartir de 1 (177 messages). Un titre suivi
directement d'une ligne de texte est un titre (546 messages le laissaient en `##` brut). Les filets,
le barré, et les liens — qui s'ouvrent dans le navigateur. Les exports reçoivent le même rendu, avec
leur propre style pour le papier.

**Pourquoi pas une bibliothèque.** Le concurrent le plus avancé assemble `react-markdown` et
`remark-gfm` ; Ariane n'a ni React ni empaqueteur. Les autres candidats, `marked` ou
`markdown-it`, produisent du HTML brut, ce qui rend un désinfectant obligatoire : deux dépendances
dans le bac à sable, à la place de la règle qui le protège — échapper, puis décorer. Cinq
constructions mesurées tenaient en quelques centaines de lignes. Le seuil auquel ce choix
s'inverserait est écrit dans `format.js`.

**Un lien ne peut rien ouvrir d'autre qu'une page web.** Seul `http(s)` reçoit une adresse ; un
lien vers `file:`, `javascript:` ou un chemin du projet garde son libellé et perd sa cible. Et un
clic ne navigue pas : il demande une fenêtre, que `main.js` refuse toujours, après avoir confié
l'adresse au navigateur si le processus principal — pas la fenêtre — la reconnaît comme web. Ce
garde existait sans test ; il en a quatre, chacun vu échouer quand on retire ce qu'il protège.

**Comparé sur tout le corpus, ancien moteur contre nouveau.** 1 810 messages changent de rendu.
Un seul perdait un vrai mot : une ligne de tableau plus large que son en-tête, dont GFM jette la
cellule en trop — « 12 ✓ » disparaissait. Ariane la garde : une visionneuse de conversations ne
jette pas de mots. Les autres écarts sont voulus et conformes à GFM : `\|` devient `|` dans une
cellule, et `**` à l'intérieur de `` `code` `` reste littéral — l'ancien moteur mettait en gras
*dans* le code, c'était lui qui avait tort.

**Trouvé en chemin.** Un « 2. » qui suit les sous-puces d'un « 1. » n'était pas reconnu, parce que
la règle regardait le dernier élément (la puce) et non le dernier du même niveau. Et les 546
nouveaux titres ont été relus un par un côté personne, à la recherche d'un commentaire shell collé
sans bloc de code qui serait devenu un titre : aucun.

### Un dossier se lit par date, pas par assistant

**Ce que ça change.** Les conversations d'un dossier étaient regroupées par assistant, le groupe le
plus fourni en tête : dans un dossier où Codex avait écrit quarante fois et Claude trois, une
conversation de Claude vieille de dix minutes passait sous quarante plus anciennes. C'est
maintenant une seule liste, la plus récente en haut, et chaque ligne porte la pastille de son
assistant — celle des dossiers.

**Aucune requête n'a changé** : `db.sessions` répondait déjà dans cet ordre, le regroupement le
défaisait.

### La fenêtre porte enfin son icône

**La correction de la veille ne suffisait pas.** `StartupWMClass` relie une fenêtre à son lanceur ;
il ne peint rien. Lu sur la fenêtre en marche, `xprop _NET_WM_ICON` répondait `not found` :
Electron ne donne aucune icône à une fenêtre Linux de lui-même, et les images ne partaient même pas
dans le paquet — `build/` est exclu par electron-builder, `/opt/Ariane` n'en contenait aucune.

**Ce que ça change.** Les deux fenêtres reçoivent `icon:`, en huit tailles de 16 à 512 px, que le
gestionnaire de fenêtres choisit selon la place. C'est le mécanisme freedesktop que lisent Mutter,
KWin, Marco, Xfwm, Openbox, Fluxbox et i3 — pas une astuce propre à un bureau.

### Le paquet n'emporte plus ce que rien ne compilera

**Ce que ça change.** Le `.deb` passe de 109 778 632 à 107 526 488 octets, l'AppImage de 131,5 à
128,9 Mo. Personne ne téléchargera plus 2,2 Mo pour rien.

**Ce qui partait pour rien.** `better-sqlite3` livre son binaire déjà construit, **et aussi de quoi
le construire** : 9,9 Mo dans `deps/`, dont 9,1 de source C de SQLite, plus des `gypi`, des patches
et un script de téléchargement ; et 172 Ko de C++ dans `src/`. Tout cela voyageait dans chaque
paquet depuis toujours, pour une chaîne de compilation qui ne tourne jamais — c'était tout le sens
du passage à Node-API l'avant-veille.

**Vérifié avant d'exclure**, parce qu'un paquet allégé qui ne s'ouvre plus serait pire : rien dans
`lib/` ne référence `deps/`, et le paquet produit ouvre toujours une base — `better-sqlite3` chargé
depuis `app.asar.unpacked`, une ligne écrite, SQLite 3.53.4.

**Ce qui reste, et pourquoi.** Les 17 Mo de `prebuilds/` : sept des huit binaires sont inutiles sur
un système donné, mais ce sont eux qui rendent la construction croisée juste par construction. Les
filtrer demande la vérification octet par octet qu'on réserve à un travail à part.

### Ce que la documentation racontait de faux

**Une session d'IA a relu les documents sans rien savoir du projet**, en répondant deux fois à
chaque question — ce que dit la documentation, puis ce que dit le code — et en signalant chaque
écart. Le résultat vaut d'être gardé, parce qu'il dit comment une documentation pourrit.

**Le pire était un piège de perte de données.** `ARCHITECTURE` § 15 disait : ajouter une donnée
indexée, c'est `extract.js` **et** hausser `SCHEMA_VERSION`. C'est nécessaire et **insuffisant** : il
faut aussi `ARCHIVE_MESSAGE_COLUMNS` et `ARCHIVED_MESSAGE_DEFAULTS`, dont les noms n'apparaissaient
dans aucun document. Quelqu'un qui suivait l'architecture à la lettre reproduisait exactement le
défaut expédié l'avant-veille — `no such column: tok_input` — et le reproduisait dans le seul code
dont le travail est d'empêcher qu'on perde des conversations. La § 4 le dit maintenant, dans les
deux langues.

**Le reste était de la pourriture par recopie.** Quatre documents portaient trois totaux de tests
différents — 673, 684, 707 — et `README.fr.md` se contredisait lui-même à 240 lignes d'écart. Le
plus cinglant : la § 12 de l'architecture avait prévu ça par écrit, *« trois documents ont déjà
porté trois totaux différents »*, et s'était instituée seule dépositaire. Quatre documents ont
continué à recopier. Les chiffres sont désormais **au seul endroit qui les réclamait**, et les
autres y renvoient.

**Et une leçon sur les demi-corrections.** `CLAUDE.md` annonçait « 707/707 sous Linux, 668/669 sous
Windows » : le second chiffre est l'arithmétique d'un total de 684. Une moitié de phrase avait été
mise à jour, l'autre non — une erreur qu'aucun test ne peut attraper et qu'aucune relecture rapide
ne voit.

**Restaient enfin trois affirmations devenues fausses** : le commentaire en tête de `test.yml`
annonçait un Windows rouge réparé la veille ; la ROADMAP donnait la 0.2.0 pour dernière version et
listait comme « gratuits à retirer » les 9,1 Mo retirés deux heures plus tôt ; et `CLAUDE.md`
comptait deux suites Electron là où il y en a trois, plus trois points de feuille de route tous
livrés.

**Ce qui manquait.** Un `CONTRIBUTING.md` : la procédure de publication n'existait que dans
`CLAUDE.md`, qui est ignoré par git et ne partira jamais. Un dépôt public sous GPL n'avait aucune
mécanique de contribution écrite.

## 22 septembre 2026

### Prévenue qu'une version existe, sans rien télécharger

**La question qui a ouvert deux jours de travail.** Une fois installée, Ariane ne savait pas qu'une
version plus récente existait, et rien ne le lui aurait dit : ni canal, ni notification, ni
gestionnaire de paquets derrière elle.

**Ce que ça change.** Réglages → Mises à jour propose d'interroger GitHub une fois au lancement.
Quand une version plus récente existe, un bouton apparaît dans l'entête de la barre latérale, juste
avant l'engrenage, et **il attend** : son infobulle porte le numéro, un clic ouvre la page dans le
navigateur. Rien n'est téléchargé, rien n'est exécuté.

**Pourquoi ça s'arrête là.** Aucun paquet n'est signé. Une application qui récupérerait et
exécuterait un binaire toute seule réclamerait une confiance qu'elle ne peut pas prouver — et les
systèmes qui s'en soucient le lui diraient : SmartScreen sur chaque `.exe` téléchargé, Gatekeeper
sur chaque `.dmg`. Seule l'AppImage pourrait se mettre à jour en place sans certificat ; elle reste
au point 13 de la feuille de route, faute d'une vraie AppImage pour l'éprouver.

**Le réglage est éteint par défaut, et il est lu AVANT toute requête.** Demander apprend à GitHub
une adresse, une version et la fréquence de démarrage de la machine ; un réglage qui se contenterait
de masquer le résultat aurait déjà prévenu de notre passage. Deux tests vérifient qu'aucun appel
n'est émis quand la réponse est non. La requête interroge la redirection de `/releases/latest`
plutôt que l'API — pas de quota par adresse, quelques centaines d'octets d'en-têtes — et le lien
ouvert est reconstruit depuis le manifeste : aucune URL choisie par la fenêtre n'atteint
`shell.openExternal`.

**Le défaut que seule la suite de rendu a vu.** `call()` déballe déjà l'enveloppe `{ok, data}`, et
le renderer testait `answer.ok`. **Le bandeau ne serait jamais apparu.** Aucun test unitaire ne
pouvait le montrer : les deux moitiés étaient justes, c'est leur jonction qui ne l'était pas.

**Un premier essai jeté en route.** L'annonce passait d'abord par le `toast` existant, qui dure dix
secondes. C'est la bonne durée pour une erreur qu'on corrige tout de suite, la mauvaise pour une
version disponible : qui regardait ailleurs ne la revoyait qu'au lancement suivant, et le message
s'affichait par-dessus la barre de recherche au moment précis où quelqu'un vient chercher quelque
chose.

**Mesuré.** 23 tests unitaires, 5 vérifications de rendu — dont deux qui gardent la conception
plutôt que le code : le bouton est bien le voisin de l'engrenage, et rien ne s'affiche par-dessus la
barre de recherche. Les huit messages existent dans les neuf langues.

**Et éprouvé contre le vrai monde, le 23 septembre 2026** : une 0.3.0 installée, le réglage allumé,
l'application relancée — le bouton est apparu, il annonçait la 0.3.1, et le clic a ouvert sa page.
C'est le seul maillon qu'aucun test ne peut couvrir, puisque aucun n'a le droit d'atteindre GitHub.

### L'icône que le bureau refusait à la fenêtre

**Signalé à l'usage.** La barre des tâches n'affichait pas Ariane mais une icône générique de
fenêtre applicative.

**Une majuscule.** Lu sur la vraie fenêtre, sur écran virtuel :

```
WM_CLASS(STRING) = "ariane", "ariane"     ce que la fenêtre annonce
StartupWMClass=Ariane                      ce que le .desktop cherchait
```

La correspondance est sensible à la casse. Le bureau ne reliait donc jamais la fenêtre ouverte à
l'entrée qui porte l'icône, et se rabattait sur la générique faute de savoir à qui appartenait cette
fenêtre.

**Deux fausses pistes, notées parce qu'elles coûtent du temps.** `syncDesktopName: true` seul ne
corrige rien — il nomme le *fichier*, pas la classe. Et `desktopName` sous `build.linux` fait
**échouer la construction** : le schéma l'y refuse. La clé se pose à la **racine** de `package.json`,
ce que l'avertissement d'electron-builder ne disait pas, bien qu'il l'ait réclamée à chaque
construction Linux depuis des semaines.

**Mesuré.** Dans le paquet produit : `StartupWMClass=ariane`, et zéro avertissement là où il y en
avait deux.

### Ariane se télécharge

**Trouvé en jouant l'utilisateur.** « Je suis un simple utilisateur, j'ai nodejs parce qu'on le
demande souvent et je n'ai rien d'autre. Je saurai installer Ariane ? » La réponse était **non** :
aucune version n'était publiée, et les deux README faisaient commencer par `git clone`, c'est-à-dire
par le chemin du développeur présenté comme le seul. Un Node de distribution — 18 sur Ubuntu 24.04,
20 sur les plus récentes — passe sous le plancher et l'application serait morte à la première
requête, sans un mot.

**Ce que ça change.** La **0.2.0** attache neuf fichiers à sa release : l'AppImage qui ne réclame ni
droits root ni gestionnaire de paquets, le `.deb`, l'installeur NSIS, le portable Windows, le `.dmg`,
et les trois manifestes `latest*.yml` que lira un jour l'updater. 583 Mo au total. Le README
« Installation » se lit désormais dans l'ordre où on en a besoin : télécharger d'abord, cloner
ensuite.

**Chaque cible est construite sur son propre système**, ce qui n'était jamais arrivé — les paquets
Windows étaient croisés depuis Linux et vérifiés sous wine, et macOS n'avait jamais rien construit
du tout.

**Quatre tentatives, et chacune a appris quelque chose.** electron-builder **publie de lui-même**
dès qu'une étiquette git est présente, et meurt alors sur un jeton qu'on ne lui a jamais donné —
après avoir produit des paquets corrects ; `scripts/dist.js` lui impose désormais `--publish never`,
parce que construire et publier sont deux décisions. Puis Windows est tombé sur
`node_modules/.bin/electron-builder`, nom sans extension qui n'existe pas là-bas : le défaut était
**consigné depuis la veille** dans une note de passation, avec la mention qu'il n'avait jamais gêné
puisque tout était construit depuis Linux. Il a cessé d'être théorique le jour où la CI a construit
nativement. Enfin `gh` cherchait un dépôt git dans un job qui n'en contient aucun.

**Mesuré.** Les neuf artefacts sont rassemblés correctement, espaces compris — `Ariane 0.2.0.exe` a
traversé un tableau bash sans se couper en deux. Le `.dmg` est **arm64 uniquement** : les runners
macOS sont en Apple Silicon, et un Mac Intel ne pourra pas l'ouvrir. C'est écrit dans le README.

### Trois systèmes, vérifiés à chaque poussée

**Le problème.** « Fonctionne partout » était l'exigence n°1, et toute la qualité mesurée ici
reposait sur quelqu'un qui lançait les suites à la main, sur une machine.

**Ce que ça change.** `test.yml` lance les quatre suites sur Ubuntu, Windows et macOS à chaque
poussée, `fail-fast` désactivé pour qu'un échec n'en cache pas un autre. `release.yml` construit sur
étiquette, après un garde-fou qui refuse de publier si l'étiquette et `package.json` divergent — sans
quoi une release « v0.2.0 » aurait pu contenir `Ariane 0.1.0.exe` sans que rien ne le dise.

**Ce qu'elle a trouvé au premier tour, et c'est le plus intéressant.** Onze échecs sous Windows,
trois sous macOS, et **pas un seul défaut du produit**. Le code gérait déjà la casse de `Path`, la
résolution des variables d'environnement, la normalisation d'un chemin saisi. C'étaient quatorze
tests écrits depuis une seule machine — dont trois qui **plantaient au lieu d'échouer**,
`undefined.split()` sur un `env.PATH` que Windows épelle `Path`. Un autre supprimait un répertoire
pendant que sa base SQLite était encore ouverte : Node exécute les crochets `after` dans l'ordre
d'enregistrement, et la fermeture avait été enregistrée après la suppression. Linux pardonne,
Windows répond `EPERM`.

**Deux pièges du banc d'essai, notés parce qu'ils se reproduiront.** `xvfb-run` ouvre un écran de
1280x1024 alors que la suite de mise en page demande une fenêtre de 1402 px — rognée, les six
libellés néerlandais se serrent et le titre tombe à 195 px sous un seuil de 200. Et une fenêtre
`show: false` n'a pas encore sa taille sous macOS quand sa page répond : **une taille demandée n'est
pas une taille obtenue**, ce que la fenêtre principale savait déjà puisqu'elle passait par un
`resizeTo` qui attend et lève.

**Mesuré.** 684/684 sous Linux et macOS, 668/669 sous Windows, et 155 · 26 · 7 partout. Les quinze
tests qui ne s'exécutent pas sous Windows sont les skips `POSIX_ONLY`, déclarés avec leur raison :
une abstention écrite, pas un trou.

### Ce que chaque tour a coûté

**Ce que ça change.** L'index garde désormais les jetons d'un tour quand l'agent les a mesurés :
entrée, sortie, cache lu, cache écrit, raisonnement. Le modèle, lui, était stocké depuis toujours et
n'avait jamais été affiché.

**Le dictionnaire, et pourquoi il ne suffit pas.** Quatre agents sur sept enregistrent des jetons,
chacun avec ses mots — `cache_read_input_tokens` chez Claude, `cached_input_tokens` chez Codex,
`cached` chez Gemini, `cacheReadTokens` chez Copilot. Le contrat porte la table de correspondance,
mais surtout la **définition** de chaque champ : `input_tokens` exclut le cache chez Claude — mesuré,
2 frais contre 24 641 lus — et l'**inclut** chez Codex, 2 692 dont 1 920 cachés. Additionner les deux
colonnes parce qu'elles portent le même nom produirait un nombre sans signification.

**Ce qu'Ariane refuse d'inventer.** Antigravity est facturé au forfait, donc aucun chiffre par jeton
n'est exposé au client ; les outils qui en affichent un l'**estiment** depuis des BLOBs protobuf.
Ariane ne l'estime pas. Et VS Code garde `max_output_tokens` et `token_prices`, qui disent ce que le
modèle *peut* faire et ce qu'il *coûte* au jeton, jamais ce qu'un tour a consommé : les lire comme un
usage donnerait des nombres justes d'allure et vides de sens. Une absence rend `null`, jamais zéro —
l'invariant n°1 sous un autre costume.

**Mesuré.** Claude enregistre un usage sur **32 376 messages assistant sur 32 376**, répartis en 429
fichiers. Couverture totale.

**Et un défaut expédié le soir, réparé le matin.** Les cinq nouvelles colonnes étaient nommées dans
la requête que la migration utilise pour **sauver avant de vider** — sur une base qui ne les a pas :
*« index v9 could not be read for the archive (no such column: tok_input) »*. La sauvegarde a échoué
en entier et n'a dégradé proprement que par chance. La migration lit désormais ce que la base
contient réellement, et la restauration tolère une archive écrite avant l'existence d'une colonne.

### L'installation n'exécute plus aucun script

**Le problème, remonté depuis un vrai poste Windows.** `npm install` échouait sur un `node-gyp
rebuild` réclamant un Python introuvable — alors que `better-sqlite3` 13 ne déclare **aucun script**
d'installation. C'est npm qui lance un `node-gyp rebuild` de lui-même pour tout paquet portant un
`binding.gyp`, et il reconstruisait un binaire déjà livré dans le paquet.

**Ce que ça change.** `.npmrc` pose `ignore-scripts=true`. L'arbre ne contient qu'un seul
`binding.gyp` et qu'un seul autre script d'installation — celui d'electron-winstaller, pour une
cible Squirrel que ces paquets n'utilisent pas. Ni Python, ni `make`, ni compilateur, sur aucun
système. Le même fichier pose `engine-strict=true`, pour que npm **refuse** au lieu d'avertir sous un
Node trop ancien.

**Le détail cruel.** La machine en question *avait* Python 3.11, à deux emplacements. gyp les trouve
et les rejette tous les deux — `version is ""`, *could not be run*. Installer Python n'y aurait rien
changé.

**Mesuré.** `npm ci` refait de zéro sans exécuter un seul script, puis les 870 vérifications des
quatre suites passent. Sous un Node 22.12, l'installation s'arrête sur `EBADENGINE` en nommant les
deux versions.

---

## 21 septembre 2026

### Le piège ABI n'existe plus

**Ce que c'était.** `better-sqlite3` était lié à un `NODE_MODULE_VERSION`, et Electron n'expose pas
le même que le Node qui lance les tests. Charger le mauvais binaire n'est pas une erreur qu'on
rattrape : le processus meurt d'un `SIGILL`, sans exception et sans message. Le dépôt portait donc
deux binaires, un cache à sa racine, un module de sélection par chemin et un contrôle à
l'empaquetage. Il avait quand même expédié deux paquets faux : un ELF dans `Ariane.exe`, puis une
ABI 127 dans un `.deb` Electron qui s'installait, s'ouvrait, et mourait à sa première requête.

**Ce que ça change.** `better-sqlite3` 13 est passé en **Node-API** : un binaire par système, livré
dans le paquet, choisi par la bibliothèque elle-même. `new Database(chemin)` suffit. Cinq fichiers et
vingt-et-une vérifications disparaissent avec le piège, ainsi que les scripts `postinstall` et
`rebuild:*`. Une construction croisée devient juste **par construction** : `--win` depuis Linux
emporte `win32-x64.node` parce que ce fichier était déjà dans `node_modules`.

**Ce qui le remplace est un plancher.** Node-API 10, c'est-à-dire Node 22.14 et Electron 44. Il mord
en silence : `better-sqlite3` déclare `engines: node >= 22`, plus large que ce qu'il supporte — un
22.12 s'installe sans broncher puis meurt à la première requête.

**Mesuré.** La liaison Linux du paquet installé importe **60 symboles `napi_` et zéro symbole V8** :
elle ne peut structurellement plus être attachée à une version d'ABI. Le paquet transporte les huit
binaires, chacun du bon type — ELF pour Linux, DLL PE32+ pour Windows, Mach-O pour macOS.

---

## 20 septembre 2026

### Le mot cherché est surligné là où il se trouve

**Venu de l'usage.** Cliquer un résultat amenait bien au bon message et lui posait un fin liseré,
mais le **mot**, lui, n'était marqué nulle part. Sur un message de quarante lignes, la recherche
disait *lequel*, pas *où dedans* : l'œil refaisait le travail. Les extraits sous la barre de
recherche surlignaient déjà, le Ctrl+F aussi ; c'est seulement le trajet « résultat → conversation »
qui perdait l'information en route.

**Ce que ça change.** Les mots de la recherche sont marqués dans **toute la conversation ouverte**,
au jaune du surligneur — la même couleur que dans les extraits, parce que c'est la même information,
déplacée de l'extrait vers le texte. Le liseré reste sur le message que le résultat désignait : deux
informations différentes, deux signaux différents. Vider la recherche, ou ouvrir une conversation
depuis ailleurs, éteint le surlignage.

**Le piège, et c'est là qu'était le travail.** La conversation se peint par tranches : 120 lignes
tout de suite, le reste pendant les temps morts. Un surlignage posé à l'ouverture n'aurait touché
que ce qui était déjà peint. La vue prévient donc à chaque tranche (`onPaint`), et le marqueur est
**idempotent** — il refuse les nœuds déjà dans un `<mark>`, puisque le surlignage de recherche et
celui du Ctrl+F peuvent être allumés ensemble. Au passage, le Ctrl+F a cessé d'avoir sa propre copie
du marqueur : les deux partagent le même.

**Mesuré.** Six contrôles de rendu, sur une conversation de 2 000 messages : chercher
« profond numero » marque 2 000 occurrences, marque `numéro` alors qu'on a tapé `numero` sans
accent, n'imbrique aucune marque, et — le point qui compte — **les lignes 1 400 à 1 440 portent
toutes la marque** alors que la première tranche n'en peint que 120. Vider la recherche n'en laisse
aucune.

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
