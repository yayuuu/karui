---
title: PluginContext et URL
format: markdown
---
Pour chaque requête, le moteur crée un `PluginContext` et en transmet une copie au worker backend. Il contient l’adresse de la requête, les données de la page et les chemins nécessaires aux opérations sur les fichiers. Il ne contient que des données, sans fonctions ni objets liés à la connexion HTTP, et n’est pas envoyé automatiquement au navigateur.

| Champ | Contenu |
| --- | --- |
| `url: string` | Chemin de la requête avec les paramètres après `?`, sans protocole ni hôte. |
| `method: string` | Méthode HTTP, par exemple `GET`, `HEAD` ou `POST`. |
| `body: unknown` | Corps analysé de la requête ou `null`. L’extension doit en valider le type et le contenu. |
| `suffix: string` | Partie du chemin après l’adresse de la page associée ou de l’administration. Vide pour l’adresse principale ; une route supplémentaire peut valoir `/api/save`. |
| `basePath: string` | En public : adresse de la page associée. Dans le panneau : `/panel/plugins/<nom>`. Sans query string. |
| `language: string` | Langue attendue pour la réponse, choisie avec `?lang=` ou mémorisée pour l’utilisateur. L’extension fournit ses propres traductions. |
| `defaultLanguage: string` | Langue par défaut du site, utile comme repli pour les traductions de l’extension. |
| `page` | Métadonnées et contenu de la page enregistrée, décrits ci-dessous. |
| `content.source: string` | Contenu Markdown/HTML exact, sans front matter YAML. |
| `content.html: string` | Markdown rendu en HTML, ou source HTML lorsque le format est `html`. |
| `content.format` | `markdown` ou `html`. |
| `mode` | `public` ou `admin`, déterminé par le moteur et jamais par les valeurs query/body. |
| `admin` | `null` en public ; `{ login, role, csrf }` dans le panneau. `role` vaut `owner` ou `admin`. |
| `assets` | URL versionnées des fichiers de `assets/`, indexées par chemin relatif, par ex. `assets['images/logo.webp']`. |
| `pluginDir` | Chemin absolu vers `content/plugins/<nom>`. |
| `contentRoot` | Chemin absolu du répertoire de contenu monté. |
| `storageDir` | Chemin absolu vers `content/state/<nom>` ; l’extension le crée si nécessaire. |
| `cacheDir` | Chemin absolu vers `CONTENT_CACHE_DIR/plugin-data/<nom>`. Utilisez-le uniquement pour les données qui peuvent être recréées. Il peut se trouver sur tmpfs et disparaître après un redémarrage ; l’extension le crée si nécessaire. |

## Données de page (`page`)

L’objet contient `href`, `title`, `keywords`, `order`, `plugin`, `pluginPlacement`, `format`, `published`, `showSubpages`, `showPrint`, `showPdf`, `galleryVisibility`, `gallery`, `html`, `source` et `sourceFile`. `sourceFile` est relatif au répertoire `pages`.

Vous pouvez ajouter des champs personnalisés aux métadonnées YAML. L’extension les reçoit dans `page`, mais doit en valider le type et la valeur. Le moteur définit `href`, `html` et `source`.

Sur une page publique, `page.gallery` contient les photos autorisées par le réglage de visibilité, avec leurs dimensions. Dans le panneau, il contient toutes les photos enregistrées. Chaque photo possède `src`, `thumbnail` et `alt`, ainsi qu’un éventuel `download`. En mode public, elle peut aussi posséder `width` et `height`.

Modifier `context` n’écrit rien dans la page ni dans un autre fichier. Les variables globales de l’extension peuvent en revanche survivre entre les requêtes. N’y conservez jamais de session, de jeton CSRF ni de données utilisateur.

## Routage public

Pour une extension associée à `/tools/report` :

| Adresse demandée | `page.href` / `basePath` | `suffix` |
| --- | --- | --- |
| `/tools/report?filter=active` | `/tools/report` | `""` |
| `/tools/report/api/save?filter=active` | `/tools/report` | `/api/save` |
| `/tools/report/history/2026` | `/tools/report` | `/history/2026` |

Le moteur recherche d’abord une page enregistrée à l’adresse demandée. S’il n’en trouve pas, il remonte les chemins parents et choisit la page la plus proche à laquelle une extension est associée. Une sous-page enregistrée est donc prioritaire sur une route dynamique de même adresse. Si cette page ou l’un de ses parents n’est pas publié, l’accès est bloqué avant l’exécution de l’extension.

À l’adresse `/`, le moteur affiche uniquement le fond et le menu, sauf si une page d’accueil est configurée. La documentation utilise `site.home: /start` ; `/` redirige donc vers `/start`.

Le moteur décode les chemins URL et redirige les chemins terminés par `/` vers leur forme sans barre finale, sauf pour `/` lui-même. Validez `suffix` par une liste de valeurs autorisées avant de l’utiliser pour sélectionner un fichier. `/panel`, `/assets`, `/plugin-assets`, `/media` et `/healthz` sont réservés au moteur.

```ts
const url = new URL(context.url, 'http://plugin.invalid');
const filter = url.searchParams.get('filter') ?? 'all';
if (!/^(all|active|archived)$/.test(filter)) {
  return { type: 'json', status: 400, data: { error: 'Filtre incorrect' } };
}
```

`http://plugin.invalid` sert uniquement à analyser une URL relative avec `new URL()`. Ce n’est pas l’adresse du serveur. Le contexte ne contient ni l’hôte réel, ni les en-têtes, ni les cookies, ni l’adresse IP. Le fragment après `#` n’est jamais envoyé au backend.

## Routage de l’administration

`/panel/plugins/example?path=%2Ftools%2Freport` possède un `suffix` vide ; `/panel/plugins/example/save?path=%2Ftools%2Freport` possède `/save`. Chaque requête doit contenir un paramètre `path` désignant une page enregistrée associée à cette extension. La page n’a pas besoin d’être publiée.

Dans cet exemple, `context.url` contient l’adresse du panneau, `basePath` vaut `/panel/plugins/example` et `page.href` pointe vers `/tools/report`. `path` sélectionne une page associée à l’extension, pas un fichier arbitraire du disque. Ajouter `mode=admin` ou `admin=true` à une adresse publique n’accorde aucun droit.

## Corps des requêtes et réponses

Les routes publiques acceptent le JSON et le texte grâce aux parseurs Fastify. Les formulaires URL-encoded et multipart ne sont activés que dans le panneau. La limite du corps est de 150 000 octets pour les routes publiques et de 300 000 octets pour les routes d’administration d’une extension. L’API photo du panneau possède ses propres limites.

`PluginContext` n’expose pas `request.file()`. Si une extension doit accepter des fichiers, concevez un transfert dans un format pris en charge, par exemple du JSON avec une limite adaptée, ou utilisez la galerie du moteur.

Une réponse JSON prend la forme `{ type: 'json', status: 200, data: {...} }`. `status` vaut 200 par défaut et accepte les valeurs de 200 à 599. Une réponse d’extension ne peut pas définir d’en-têtes ni de cookies personnalisés, ni renvoyer de flux, de fichiers binaires ou de redirection `Location`.

Traitez `HEAD` sans écriture ni autre effet de bord. Le moteur HTTP omet le corps de réponse pour ces requêtes.
