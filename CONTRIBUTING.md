# Contribuer à Ariane

Ce document dit trois choses : comment lancer le projet, ce qui doit passer avant qu'un changement
soit envoyé, et comment une version est publiée. Le reste — l'architecture, les invariants, les
pièges — vit dans [`ARCHITECTURE.fr.md`](ARCHITECTURE.fr.md), dont la **§ 15 « Où changer quoi »**
est le meilleur point d'entrée.

*An English version of this page is welcome; the code and its comments are in English, the internal
documents in French.*

---

## Lancer le projet

```bash
git clone https://github.com/ZamBoyle/Ariane
cd Ariane
npm install
npm start
```

**Node 22.14 ou plus récent, et rien d'autre** — ni compilateur, ni Python, ni `make`. Le plancher
est réel et muet : un Node plus ancien s'installe sans broncher puis meurt d'un segfault à la
première requête SQLite, c'est pourquoi `.npmrc` pose `engine-strict=true` et laisse npm refuser.

Le même fichier pose `ignore-scripts=true`. Rien dans l'arbre n'a besoin d'un script d'installation,
et celui que npm lance de lui-même pour tout paquet portant un `binding.gyp` reconstruirait un
binaire déjà livré — sous Windows, il fait échouer `npm install` en entier.

Au premier lancement, Electron télécharge son binaire (~100 Mo) : il ne déclare plus de script
d'installation et le récupère à la demande. Pour s'en débarrasser d'avance : `npx install-electron`.

Sur un Linux minimal — WSL, conteneur, image de CI — il manque aussi les bibliothèques système
d'Electron : `sudo apt install -y libnss3 libnotify4 libsecret-1-0 xdg-utils`.

## Ce qui doit passer

```bash
npm run test:all   # les quatre suites
npm run lint
```

Les trois suites d'interface demandent un moteur de rendu. Sans affichage, il faut un écran virtuel
**d'au moins 1402 px de large** — la suite de mise en page ouvre une fenêtre de cette taille pour
vérifier qu'un en-tête garde ses six libellés, et elle échoue sur un écran plus étroit pour une
raison étrangère au code :

```bash
xvfb-run -a --server-args="-screen 0 1920x1080x24" npm run test:all
```

La CI fait tourner les quatre suites sur **Ubuntu, Windows et macOS** à chaque poussée. Les trois
sont vertes ; qu'elles le restent.

**Quinze tests ne s'exécutent pas sous Windows, délibérément** (`POSIX_ONLY` dans
`terminal.test.js`) : bits d'exécution, shebangs, exécutables sans extension. Une abstention
déclarée avec sa raison, pas un trou.

## Quelques règles qui coûtent cher à réapprendre

- **Aucune phrase dans le code.** Les identifiants vivent dans `index.html`, les mots dans les neuf
  fichiers de `src/locales/`. `test/l10n.test.js` échoue sur un message manquant, un message en trop
  ou une variable qu'aucun code ne passe.
- **Ce qui traverse une frontière est un code, jamais une phrase.** Celui qui affiche traduit.
- **`src/core/` n'importe jamais `electron`** : c'est ce qui rend tout le chemin de données testable
  sans ouvrir de fenêtre.
- **La fenêtre n'est pas digne de confiance.** Chaque canal IPC valide sa charge et rend `{ok, …}`.
- **Ajouter une colonne à `messages`, c'est quatre endroits, pas deux** — et les deux qu'on oublie
  sont ceux de l'archive. Voir `ARCHITECTURE.fr.md` § 4 : l'oubli casse la sauvegarde qui précède le
  vidage des tables, c'est-à-dire la seule mécanique qui empêche de perdre des conversations.
- **Les messages de commit sont en français**, et ne portent aucune attribution d'assistant.

## Publier une version

Deux commandes, et l'étiquette déclenche tout le reste :

```bash
npm version minor -m "passe en %s"   # ou patch ; écrit package.json, commite, étiquette
git push --follow-tags               # nommer la branche : jamais « git push --all »
```

`.github/workflows/release.yml` prend alors la suite :

1. un **garde-fou** refuse de construire si l'étiquette et `package.json` divergent — sans quoi une
   release « v0.3.0 » pourrait contenir des fichiers nommés 0.2.0 sans que rien ne le dise ;
2. chaque cible est construite **sur son propre système** — `.deb` et AppImage sous Ubuntu, NSIS et
   portable sous Windows, `.dmg` sous macOS ;
3. les paquets sont attachés à la release avec leurs `latest*.yml`, les manifestes que lit un
   vérificateur de mise à jour.

`scripts/dist.js` impose `--publish never` à electron-builder : celui-ci publie de lui-même dès
qu'une étiquette git est présente, et réclame alors un jeton qu'on ne lui donne pas. **Construire et
publier sont deux décisions**, et seule la seconde appartient au workflow.

**Rien n'est signé**, et ça se voit : Windows affiche « éditeur inconnu », macOS met un `.dmg`
téléchargé en quarantaine. Un certificat ne rendrait pas Ariane plus sûre — il ferait disparaître
ces deux boîtes de dialogue, pour quelques centaines d'euros par an.

## Licence

GPL v3 ou ultérieure, avec une clause d'attribution : voir [`LICENSE`](LICENSE) et
[`NOTICE`](NOTICE). En proposant un changement, vous acceptez qu'il soit distribué sous cette
licence.
