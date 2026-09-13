---
title: Documentation de Karui
format: markdown
---
Vous apprendrez ici à créer des extensions, préparer des vues et ajouter des interactions ainsi que des paramètres d’administration. Vous pouvez également consulter [l’exemple fonctionnel](/plugins/example) et l’utiliser comme point de départ.

Cette documentation est affichée par Karui — le même moteur qui fait fonctionner les sites créés avec lui. Elle possède sa propre configuration (`docs/site.yml`), son contenu (`docs/pages`), ses extensions (`docs/plugins`) et ses données privées (`docs/state`).

## Versions linguistiques

Avec une seule langue, une page utilise le fichier `index.md`. Après l’activation de plusieurs langues, elle utilise des fichiers tels que `index.pl.md`, `index.en.md` et `index.fr.md`. Le panneau migre le nom du fichier lors du premier enregistrement, sans réécrire tout le contenu. La langue de la page publique peut être choisie avec le paramètre `?lang=fr`.

Le menu possède une structure unique et partagée. Les liens, l’imbrication et les noms dans la langue par défaut restent dans `site.yml`. Dans **Menu**, choisissez la langue par défaut pour modifier l’arborescence, ou une autre langue pour remplir le tableau « Nom par défaut / Traduction ». Karui enregistre ces libellés dans `content/lang/<langue>.po`, dans le contexte gettext `karui-menu`.

Chaque version linguistique d’une page possède ses propres métadonnées de galerie. Si une autre langue contient déjà des photos, l’éditeur propose l’action facultative et repliée **Copier la galerie depuis une autre langue**. La liste ne contient que les galeries sources non vides et les fichiers image sont partagés plutôt que dupliqués.

## Exécution locale

Depuis le répertoire du projet, après l’installation des dépendances :

```sh
npm run docs:dev
```

Ouvrez `http://127.0.0.1:3002`. Pour construire et exécuter la documentation en mode production, utilisez :

```sh
npm run docs:build
npm run docs:start
```

`docs:build` compile le moteur. Les pages Markdown sont traitées pendant l’exécution de l’application et le HTML produit est placé dans le cache. L’extension d’exemple est compilée à la première ouverture de sa page.

## Docker

```sh
docker compose -f docker-compose.docs.yml up -d --build
```

Vous pouvez changer le port de l’hôte en définissant, par exemple, `DOCS_PORT=3003`. La documentation n’est accessible que localement et fonctionne indépendamment du conteneur de production et de ses données.

Le répertoire `docs` est monté en lecture seule. L’exception est `docs/state`, monté en écriture sous `/app/content/state`. Accordez à l’utilisateur du conteneur (UID 1000) le droit d’écrire dans ce répertoire. Les caches du moteur et des extensions compilées résident sur un disque RAM (tmpfs) ; après la recréation du conteneur, l’application les reconstruit selon les besoins.

Les fichiers de documentation, tout comme le répertoire `content`, ne sont pas copiés dans l’image. Vous pouvez modifier le contenu sans reconstruire le conteneur : éditez les fichiers dans `docs/pages` et la modification apparaît généralement après environ une seconde. Après une modification du code d’une extension, augmentez sa version dans `plugin.json`.

## Par où commencer

1. [Structure d’une extension](/plugins).
2. [Données d’entrée, PluginContext et routage](/plugins/context).
3. [Contenu de page et modèles Edge](/plugins/views).
4. [Web Worker et communication avec le client](/plugins/client).
5. [Administration protégée d’une extension](/plugins/admin).
6. [Dépendances, stockage des fichiers, cache et limites](/plugins/runtime).
7. [Exemple fonctionnel](/plugins/example) et [tests](/testing).
