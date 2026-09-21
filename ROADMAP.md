# Feuille de route

Ce qui manque encore à Ariane, établi en mesurant plutôt qu'en supposant, et classé par ce qui gêne
réellement à l'usage — pas par facilité. Chaque point garde le **piège qui décide de sa
conception** : c'est la partie qu'on ne peut pas deviner en lisant le code.

Ce qui est fait vit dans [`CHANGELOG.md`](CHANGELOG.md), avec ce qui a été mesuré. Les chiffres du
corpus, datés, vivent dans `ARCHITECTURE.fr.md` § 12.

---

## 8. Windows, macOS, et une CI

**Le problème.** « Fonctionne partout » était l'exigence n°1, et l'app n'a jamais tourné ni sous
Windows ni sous macOS. Toute la qualité mesurée ici repose sur quelqu'un qui lance les tests à la
main, sur une seule machine.

**Approche.** GitHub Actions, matrice Ubuntu / Windows / macOS, qui lance les trois suites :
`npm test`, `npm run test:render`, `npm run test:ui` (sous `xvfb` pour Linux).

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
se serait pas ouverte au premier lancement, chez quelqu'un d'autre. `build/after-pack.js` lit
désormais les premiers octets de la liaison emballée, récupère celle que better-sqlite3 publie pour
la cible, et **arrête la construction** si ce qui arrive ne correspond toujours pas.

**Et elle tourne**, vérifié le même jour sous wine 9.0 64 bits, sur écran virtuel : `Ariane.exe`
démarre, ouvre son index dans `C:\users\<nom>\AppData\Roaming\Ariane`, trouve les conversations
posées à l'emplacement Windows par défaut (`C:\users\<nom>\.claude`), en indexe sept et les
affiche — interface en français, dossiers groupés, comptes justes. C'est la preuve que la DLL
native se charge : sans elle, rien de tout cela n'existerait. Wine n'est pas Windows, mais un
échec aurait tranché, et il n'y en a pas eu.

**Ce qui reste donc à vérifier sur une vraie machine** : le lancement d'un terminal (`.cmd`,
`wt.exe`, découpage des arguments) et l'ouverture d'un dossier dans l'Explorateur — les deux
endroits où Ariane sort d'elle-même, et les deux que wine ne juge pas. Il manque encore une
signature : Windows affichera « éditeur inconnu », macOS mettra un `.dmg` téléchargé en
quarantaine.

## Ordre proposé

Onze points sur douze sont faits. Il en reste un, plus un morceau.

**8.** Le huitième attend le `push` et apporte la seule chose qui manque vraiment à la qualité
d'ici : une CI, parce qu'aujourd'hui la CI c'est la personne qui lance les suites à la main.

**Reste aussi**, plus petit, le saut à une date *dans* une conversation ouverte (point 3) : les
dates sont dans l'infobulle de chaque trait du plan, mais rien ne permet d'y aller.
