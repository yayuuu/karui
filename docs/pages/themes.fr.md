---
title: Thèmes
format: markdown
showSubpages: false
---

Un thème contrôle l’apparence de tout le site, panneau d’administration compris. Ce n’est pas une extension associée à une page particulière. Il peut contenir des modèles Edge, des styles, des images et du code exécuté dans le navigateur.

## Choisir un thème

Dans le panneau, ouvrez **Paramètres du site**, choisissez un thème et enregistrez. Le même choix peut être inscrit dans `site.yml` :

```yaml
title: Mon site
theme: example
menu: []
```

Le même onglet configure la page d’accueil et les données utilisées par le thème par défaut :

```yaml
title: Mon site
home: /actualites
language: fr
description: Une courte description du site
brandName: Nom de la marque
tagline: Texte supplémentaire dans l’en-tête
logo: /media/logo.png
favicon: /media/favicon.png
showBrandName: true
footerFormat: markdown
footer: |
  © 2026 **Nom de la marque** · [Contact](/contact)
```

`title` devient le titre du document, `language` l’attribut `lang` et `description` les métadonnées de la page. `brandName`, `tagline` et `logo` composent l’en-tête. Le logo et l’icône peuvent référencer un fichier sous `/media/` ou une URL HTTPS absolue. Le pied de page accepte du Markdown ou du HTML selon `footerFormat`. Le thème par défaut gère tous ces champs ; un thème personnalisé choisit lesquels utiliser et où les afficher.

`site.yml` reste toujours la configuration principale. Pour chaque langue supplémentaire, `site.<langue>.yml` peut remplacer uniquement `title`, `description`, `brandName`, `tagline` et `footer`. Le sélecteur de langue du panneau change le fichier modifié et désactive les champs communs tels que le thème, la page d’accueil, le logo, la liste des langues et le format du pied de page. Une traduction absente reprend la valeur de `site.yml`.

Sans champ `theme`, Karui utilise le thème `default` du moteur dans `karui/templates/`. Aucun répertoire de thèmes n’est alors nécessaire dans le contenu. Un répertoire de contenu vide affiche la page d’accueil de Karui ; vous pouvez ensuite ajouter des pages dans le panneau. La documentation utilise également le thème par défaut.

## Créer un modèle personnalisé

Cette commande exporte le thème par défaut complet pour le personnaliser. Exécutez-la dans le projet ou le terminal du conteneur :

```bash
npm run create-template
```

Elle demande un nom et écrit les fichiers dans `content/templates/<nom>`. Le nom utilise des lettres minuscules, des chiffres et des tirets. Pour l’automatisation, passez-le en argument : `npm run create-template -- entreprise`.

Le modèle exporté apparaît dans **Paramètres du site** avec les thèmes de `content/themes`. Les deux répertoires utilisent le même format et la même compilation. N’employez pas le même nom dans les deux. La commande n’écrase jamais un modèle existant.

## Fichiers du thème

```text
content/
  site.yml
  themes/
    example/
      theme.json
      client.ts
      client/
        controls.tsx
      templates/
        components/layout.edge
        partials/home.edge
      assets/
        site.css
        images/logo.svg
  templates/
    entreprise/
      theme.json
      templates/
      assets/
```

Seul `theme.json` est obligatoire :

```json
{
  "name": "Exemple",
  "version": "1.0.0",
  "description": "Une courte description de l’apparence."
}
```

L’identifiant du thème est le nom du répertoire sous `content/themes` ou `content/templates`. Utilisez des lettres minuscules, des chiffres et des tirets, jusqu’à 64 caractères. `default` est réservé au thème du moteur. `version` est obligatoire ; modifiez-la lorsque vous publiez des changements de modèles, styles ou scripts.

Les modèles et ressources remplacent les fichiers par défaut de même chemin. Les fichiers absents sont hérités : vous pouvez remplacer uniquement `assets/site.css` tout en conservant les formulaires du panneau et toutes les vues du moteur.

## Modèles et ressources

Edge reçoit un objet `theme` :

| Champ | Signification |
| --- | --- |
| `name` | Identifiant du répertoire, par ex. `example` |
| `label` | Nom du manifeste |
| `version` | Version du manifeste |
| `key` | Clé du paquet compilé |
| `assets` | Table des noms relatifs vers les URL publiques |
| `client` | URL du paquet navigateur ou chaîne vide |

```edge
<link rel="stylesheet" href="{{ theme.assets['site.css'] }}">
<img src="{{ theme.assets['images/logo.svg'] }}" alt="Logo">
```

Dans le CSS, utilisez des chemins relatifs à la feuille, par exemple `url("images/logo.svg")`. Dans `client.ts`, obtenez l’URL d’une image avec `new URL('./images/logo.svg', import.meta.url)` : le `client.js` produit se trouve dans le même répertoire public que `site.css`.

Seuls `assets/` et le résultat compilé de `client.ts` sont publiés. Les sources TypeScript, le manifeste et les modèles Edge restent privés. Les liens symboliques de l’arborescence sont ignorés. Les noms peuvent contenir des lettres ASCII, chiffres, points, tirets et tirets bas, mais ni espaces, ni chemins `..`, ni fichiers cachés. Limites : 1 024 fichiers et 128 Mio par arborescence, 32 Mio par fichier. Le paquet JavaScript peut atteindre 4 Mo.

## Mise en page compatible avec le moteur

Le plus simple est d’hériter de `components/layout.edge` et de modifier le CSS. Si vous remplacez la mise en page, conservez ces points d’intégration :

- `.site-shell` — parent commun du contenu et de la navigation ;
- `#page` — conteneur du contenu avec `tabindex="-1"` et le titre dans `aria-label` ;
- `#menu` et les vues `partials/menu` et `partials/submenu` — navigation et données de l’arborescence mobile ;
- `data-theme`, `data-theme-client`, `data-asset-version` et `data-print` sur `body` ;
- le script `/assets/main.js?v={{ assetVersion }}` et les styles de la page (`styleUrl` et CSS de galerie).

`partials/page-content.edge` assemble le contenu, l’extension, la galerie et les sous-pages. `partials/home.edge` affiche l’accueil. Un thème peut laisser cette dernière vue vide si l’accueil ne doit pas montrer de conteneur. La navigation gère ce cas sans recharger le document.

Le moteur fournit aux vues `site`, `page`, `submenu`, `children`, `back`, `home`, `print`, `styleUrl`, `assetVersion` et les données de l’extension. Les contrats et attributs exacts figurent dans les modèles par défaut. Conservez-les si vous remplacez la galerie ou le panneau : ils forment l’interface entre le HTML et le moteur.

## Code navigateur et transitions

Le fichier facultatif `client.ts` est compilé par esbuild en ESM. Il peut importer des fichiers `.ts` et `.tsx`, utiliser Preact et les dépendances du moteur ou le `node_modules` du thème. Installez les dépendances vous-même : le serveur ne lance pas leur installation.

```ts
export default function initialize() {
  return {
    async transition(element, entering, signal) {
      if (!element || signal.aborted) return;
      const animation = element.animate(
        { opacity: entering ? [0, 1] : [1, 0] },
        { duration: entering ? 150 : 125 }
      );
      const cancel = () => animation.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try { await animation.finished; } catch { /* Annulation. */ }
      finally {
        signal.removeEventListener('abort', cancel);
        animation.cancel();
      }
    },
    waiting(page, shell) {
      return () => { /* Retirer décorations, minuteurs et observateurs. */ };
    }
  };
}
```

Les deux fonctions sont facultatives. Sans transition personnalisée, le moteur applique un fondu de sortie de 125 ms et d’entrée de 150 ms. La sortie commence en parallèle du chargement ; l’entrée attend la sortie, le contenu et les styles. `AbortSignal` annule une ancienne transition après un nouveau clic. La préférence de réduction des animations les désactive.

`transition` reçoit le conteneur de page ou la navigation mobile. Sa promesse doit se terminer. Ne remplacez ni ne clonez son contenu : vous pourriez perdre l’état des formulaires, images et extensions. La fonction de nettoyage renvoyée par `waiting` s’exécute après une réponse, une erreur ou une annulation. Une navigation réussie émet `karui:navigated` sur `document`.

## Compilation et cache

Les thèmes ne sont pas compilés au démarrage du processus. La compilation a lieu à la première utilisation ; enregistrer un thème dans le panneau le prépare avant de valider le choix. Les requêtes simultanées d’un même processus partagent la compilation. Le paquet produit contient un instantané des modèles, ressources et du code client.

Les URL publiques suivent la forme `/assets/themes/<thème>/<clé>/<fichier>`. Les paquets sont enregistrés sous `CONTENT_CACHE_DIR/themes`, hors du contenu et de l’installation de l’application. L’image Docker n’a pas besoin d’être modifiable. Un cache tmpfs réside en RAM et peut disparaître à la recréation du conteneur.

Un redémarrage réutilise un paquet existant. Modifier les sources sans changer `version` ne le reconstruit pas. Un nouveau paquet apparaît après une modification de la version du thème, du moteur, des modèles par défaut ou d’esbuild, ou si le cache manque. Les anciennes URL restent valides pour les documents déjà ouverts. Les réponses du cache sont `immutable` ; un changement de thème ou de paquet déclenche un chargement complet à la navigation suivante afin de ne pas mélanger les apparences.

Un manifeste incorrect ou une erreur de compilation rétablit l’apparence par défaut ; le panneau refuse d’enregistrer ce choix. Les thèmes sont du code administrateur de confiance, pas une sandbox : Edge peut exécuter des expressions sur le serveur et `client.ts` possède les droits du document dans le navigateur, panneau compris. N’installez pas de thèmes de source inconnue. Les exceptions client sont interceptées, mais une boucle infinie peut bloquer l’onglet.
