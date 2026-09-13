---
title: Créer une extension
format: markdown
showSubpages: false
---
Une extension ajoute une logique TypeScript ou JavaScript personnalisée à une page. Placez ses fichiers dans le répertoire monté `content/plugins/<nom>`. Utilisez des lettres ASCII minuscules, des chiffres et des tirets dans le nom. N’installez que du code provenant d’auteurs de confiance : les extensions ont accès aux fichiers du serveur.

La galerie et l’éditeur de pages font partie du moteur et ne nécessitent aucune extension.

```text
content/
  pages/example.md
  plugins/example/
    plugin.json        # manifeste obligatoire avec un numéro de version
    index.ts           # handler backend obligatoire (ou index.js)
    views/public.edge  # vues .edge et sous-répertoires
    views/admin.edge
    client.ts          # Web Worker public facultatif (ou client.js)
    style.css          # CSS public facultatif
    assets/            # images, polices et autres fichiers publics facultatifs
      logo.webp
    admin.ts           # Web Worker privé facultatif (ou admin.js)
    admin.css          # CSS privé facultatif
    package.json       # dépendances facultatives de l’extension
    package-lock.json
    node_modules/
  state/example/       # données de travail privées créées par l’extension
  media/               # médias publics servis par le moteur
```

`plugin.json` minimal :

```json
{ "version": "1", "concurrent": false, "admin": false }
```

Le champ `version` est obligatoire. Sa valeur doit comporter de 1 à 64 caractères et commencer par une lettre ASCII ou un chiffre. Les points, tirets bas et tirets sont également autorisés après le premier caractère.

Les champs `concurrent` et `admin` sont facultatifs et valent tous deux `false` par défaut. Le manifeste n’accepte aucune autre clé.

La page `pages/example.md` :

```yaml
---
title: Exemple
format: markdown
plugin: example
pluginPlacement: after
---
Ceci est le **contenu de la page**.
```

Le handler `index.ts` :

```ts
export default async function render(context) {
  if (context.suffix || !['GET', 'HEAD'].includes(context.method)) {
    return { type: 'json', status: 404, data: { error: 'Introuvable' } };
  }
  return {
    type: 'view',
    template: 'views/public.edge',
    data: { title: context.page.title },
  };
}
```

La vue `views/public.edge` :

```edge
<p>{{ title }}</p>
```

Exportez le handler de requête comme export par défaut. Il peut être synchrone ou asynchrone. Il renvoie une vue ou du JSON ; le moteur assure le routage et l’envoi de la réponse. Le handler ne reçoit ni instance Fastify ni objet `reply`.

Les définitions complètes de `PluginContext` et `PluginResponse` se trouvent dans `karui/src/plugins/contracts.ts`. Utilisez `PluginResponse` pour décrire les réponses du handler. `PluginResult` est utilisé en interne par le moteur pour conserver le résultat après le rendu de la vue.

L’exemple de ce dépôt importe les types par un chemin relatif vers le fichier du moteur. Le compilateur supprime cet import. Si vous développez une extension dans un dépôt distinct, vous pouvez conserver les définitions de types localement ; n’importez pas le code d’exécution du moteur dans l’extension.

Les fichiers `.ts` ont priorité sur les fichiers `.js` correspondants. Le compilateur regroupe les fichiers backend importés localement dans le résultat. Le contenu de `assets/` dépend également de la version de l’extension. Pour publier du code ou une ressource modifiés, [augmentez la version de l’extension](/plugins/runtime) : enregistrer la source seule ne déclenche pas de nouvelle compilation.
