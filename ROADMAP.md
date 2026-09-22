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

| | Unitaires | Rendu | Mise en page | Accueil |
|---|---|---|---|---|
| linux | 684 / 684 | 155 | 26 | 7 |
| macos | 684 / 684 | 155 | 26 | 7 |
| windows | 668 / 669 | 155 | 26 | 7 |

Sous Windows, quinze tests ne s'exécutent pas et un est compté sans être passé : ce sont les skips
`POSIX_ONLY` de `terminal.test.js`, déclarés avec leur raison — bits d'exécution, shebangs,
exécutables sans extension. Une abstention écrite, pas un trou.

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

## Ordre proposé

Onze points sur douze sont faits. Il en reste un, plus un morceau.

**8.** Le huitième attend le `push` et apporte la seule chose qui manque vraiment à la qualité
d'ici : une CI, parce qu'aujourd'hui la CI c'est la personne qui lance les suites à la main.

**Reste aussi**, plus petit, le saut à une date *dans* une conversation ouverte (point 3) : les
dates sont dans l'infobulle de chaque trait du plan, mais rien ne permet d'y aller.
