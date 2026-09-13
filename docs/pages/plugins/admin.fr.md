---
title: Administration d’une extension
format: markdown
---
## Activation

Ajoutez `"admin": true` à `plugin.json` et augmentez `version`. L’éditeur d’une page associée affiche alors un lien « Paramètres d’administration de l’extension ». Si vous venez de choisir l’extension, enregistrez d’abord la page : le lien utilise l’association enregistrée.

Le même handler gère les deux modes :

```ts
export default async function render(context) {
  if (context.mode === 'admin') return renderAdmin(context);
  return renderPublic(context);
}
```

Le moteur définit le mode après validation de la session du panneau. `context.admin` contient l’identifiant, le rôle et les données CSRF, mais jamais le mot de passe ni le cookie. Les rôles `owner` et `admin` peuvent ouvrir l’administration d’une extension associée. Pour une action réservée au propriétaire, vérifiez `context.admin.role === 'owner'` dans l’extension.

L’administration possède une adresse distincte et ne s’exécute pas lors de l’ouverture de la page publique ou de son éditeur. L’extension doit avoir un manifeste `admin: true` valide et être associée à la page demandée. Cette page peut ne pas être publiée.

## Formulaire sans JavaScript

```ts
const action = context.basePath + '?path=' + encodeURIComponent(context.page.href);
return {
  type: 'view', template: 'views/admin.edge',
  data: { action, csrf: context.admin.csrf, message: '' },
  styles: 'admin.css',
};
```

```edge
<form method="post" action="{{ action }}">
  <input type="hidden" name="_csrf" value="{{ csrf }}">
  <label>Message <input name="message" value="{{ message }}" maxlength="200"></label>
  <button type="submit">Enregistrer</button>
</form>
```

Pour `POST`, validez `context.method`, `suffix` et `context.body`. Après l’enregistrement, renvoyez une vue de confirmation ou du JSON. N’écrivez aucune donnée pour `GET` ou `HEAD`.

Le panneau contrôle `_csrf` avant d’appeler le handler. Pour un POST de formulaire normal, n’ajoutez pas `data-action` au bouton d’envoi : cet attribut transmettrait le clic au worker client.

## Interactions d’administration

Renvoyez `client: 'admin.ts'` pour joindre un Web Worker d’administration. Il n’accède pas directement au DOM, comme le client public. Le code peut être partagé avec `client.ts`, mais ne doit contenir aucun secret. Vérifiez les droits sur le serveur : masquer un bouton ne bloque pas une action.

Ne transmettez à `[data-context]` que les données nécessaires, par exemple `{ endpoint, csrf }` :

```ts
const endpoint = context.basePath + '/save?path=' + encodeURIComponent(context.page.href);
const response = await fetch(endpoint, {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  body: JSON.stringify({ message: 'Nouveau message' }),
});
```

Utilisez la même origine. Le navigateur ajoute automatiquement le cookie de session HttpOnly ; le worker n’en a pas besoin et ne peut pas le lire. Ne transmettez le jeton CSRF qu’au client d’administration. Après expiration de la session ou déconnexion, les requêtes renvoient 401 ; rechargez puis reconnectez-vous.

## Protection et isolation

`/panel/plugins/...` et `/panel/plugin-assets/...` utilisent la vérification de session, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` et la CSP. Toute méthode autre que `GET` et `HEAD` exige un jeton CSRF. Les requêtes intersites sont bloquées ; avec `PANEL_ORIGIN`, l’en-tête `Origin` est aussi vérifié.

La route publique `/plugin-assets` ne sert jamais `admin.ts`, `admin.js` ni `admin.css`. Les paramètres URL `mode`, `admin` et `path` n’accordent aucun droit ; utilisez le mode et la session fournis par le moteur.

Gardez les fichiers privés hors de `/media` et n’exposez jamais `context.admin` par une API publique. L’administration utilise la même réserve de workers, le même délai et les mêmes règles de concurrence que le code public. Une panne d’extension renvoie 503 sans arrêter le panneau.

Un worker peut interrompre du code bloqué, mais ne limite pas les droits sur les fichiers. Les extensions peuvent lire tout ce qui est accessible à l’utilisateur du processus ; code backend, HTML et styles doivent donc provenir d’auteurs de confiance.

## Compte d’exemple réservé à la documentation

En local :

```sh
CONTENT_DIR=./docs npm run panel:init -- docs-admin
```

Dans le conteneur de documentation :

```sh
docker compose -f docker-compose.docs.yml exec docs node scripts/panel-account.ts docs-admin
```

Construisez d’abord le moteur. La commande demande un mot de passe ; créez un compte propre à la documentation au lieu de copier un compte de production. Connectez-vous sous `/panel`, puis ouvrez [l’administration de l’exemple](/panel/plugins/example?path=%2Fdemo).

La documentation et les fichiers d’extension sont en lecture seule dans Docker. L’état de l’exemple et les comptes sont enregistrés dans `docs/state`, monté séparément. Modifiez le contenu sur l’hôte ; le panneau ne peut pas l’enregistrer dans ce mode.
