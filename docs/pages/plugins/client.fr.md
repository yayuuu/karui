---
title: Web Worker et interactions dans le navigateur
format: markdown
---
Le code client s’exécute dans un Web Worker distinct de type module. Il n’a accès ni à `window`, ni à `document`, ni aux éléments de la page. Il peut utiliser `fetch`, les minuteurs, `postMessage` et `OffscreenCanvas` lorsque le navigateur et la CSP l’autorisent.

Pour joindre un client, renvoyez depuis la vue un champ `client` pointant vers `client.ts` ou `client.js`. L’administration peut de même utiliser `admin.ts` ou `admin.js`. Le compilateur regroupe le fichier et ses dépendances dans un paquet ESM, servi depuis une adresse contenant la clé de version `?v=...`.

La communication passe par l’**hôte**, la partie du moteur exécutée dans le thread principal du navigateur. Il transmet les événements utilisateur au worker et exécute les commandes de vue renvoyées par celui-ci.

## Messages hôte → worker

```ts
self.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'init') {
    // message.context : JSON de [data-context], pas le PluginContext serveur
    // message.canvases : table des OffscreenCanvas transférés
    // message.reducedMotion : prefers-reduced-motion au montage
  }
  if (message.type === 'event' && message.action === 'next') {
    self.postMessage({ type: 'text', selector: '[data-status]', value: 'Terminé' });
  }
});
```

| Élément / événement | Message `type: 'event'` |
| --- | --- |
| Clic sur `[data-action]` | `action` provenant de l’attribut, `value` facultative provenant de `data-value` ; l’action native du clic est annulée. |
| Modification de `[data-change]` | `action` provenant de l’attribut et `value` textuelle actuelle. Le formulaire complet n’est pas envoyé. |
| Touche dans l’extension | `action: 'key', key` ; Entrée/Espace sur `[data-action][role=button]` exécute l’action. |
| Fermeture d’un dialogue avec Échap | `action: 'cancel'`. |
| Pointeur sur `canvas[data-canvas]` | `action: 'pointerdown'/'pointermove'/'pointerup'`, nom du canvas ; down/move ajoutent `point: [x,y]` en pixels du bitmap, limité à ses bords. |

`pointermove` n’est envoyé que tant que le pointeur reste pressé. `pointercancel` et `lostpointercapture` terminent l’action. Un `canvas[data-canvas="surface"]` est transmis comme `init.canvases.surface` afin que le worker puisse le dessiner. Si OffscreenCanvas n’est pas disponible, l’extension affiche une erreur.

## Messages worker → hôte

L’hôte recherche les éléments uniquement dans la section de l’extension courante. Un sélecteur peut contenir jusqu’à 200 caractères et une commande affecte au maximum 30 éléments. L’extension ne peut modifier ni le message d’erreur du moteur ni les éléments qui l’entourent.

| `type` | Champs supplémentaires et comportement |
| --- | --- |
| `text` | `selector`, `value: string` jusqu’à 20 000 caractères ; définit `textContent`, pas du HTML. |
| `hidden` | `selector`, `value: boolean` ; bascule `hidden`. |
| `class` | `selector`, `name` (lettre minuscule puis lettres/chiffres/tirets, jusqu’à 64), `value: boolean`. |
| `style` | `selector`, `name`, `value: string` de moins de 200 caractères, sans `url`/`expression`. |
| `attribute` | `selector`, `name`, `value: string` de moins de 2 000 caractères. |
| `dialog` | `selector` ciblant `<dialog>`, `value: boolean` ; appelle `showModal()` ou `close()`. |
| `list` | `selector`, `items: [{tag, text}]` ; remplace le contenu. Jusqu’à 1 000 éléments, texte jusqu’à 1 000 caractères. Tags : `li`, `p`, `span`, `div`. |
| `query` | `name`, `value` ; modifie le paramètre de l’URL courante et démarre la navigation du moteur. Sans sélecteur. Nom `[a-z0-9_-]` jusqu’à 64 caractères, valeur jusqu’à 200. |

Les styles autorisés sont `transform`, `width`, `height`, `left`, `top`, `opacity`, `pointer-events` et `transition-duration`.

Les attributs autorisés sont `src`, `href`, `alt`, `title`, `download`, `aria-*` et `tabindex`. Les valeurs `src` et `href` doivent commencer par un seul `/`, jamais `//`.

L’hôte n’autorise ni `innerHTML`, ni l’exécution de JavaScript arbitraire, ni la modification de la valeur des formulaires, ni la création d’éléments hors de la liste prise en charge. Pour une mise à jour plus importante, utilisez `query` : le moteur recharge la vue depuis le serveur. Dans le panneau, cette navigation recharge la page entière au lieu de remplacer seulement le contenu.

## Fetch

Le worker peut utiliser `fetch` sur les routes de l’extension. Transmettez `basePath: context.basePath` dans les données client au lieu de coder l’adresse de la page en dur ; l’extension fonctionnera ainsi après son association à une autre page :

```ts
const response = await fetch(basePath + '/api/save', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: 42 }),
});
if (!response.ok) throw new Error('Échec de l’enregistrement');
const result = await response.json();
```

Dans l’administration, joignez le jeton CSRF et le paramètre `path` ; consultez [l’administration d’une extension](/plugins/admin). Gérez les erreurs de connexion, les réponses JSON incorrectes et les délais dépassés. Si une écriture peut être relancée, rendez son exécution répétée sans danger.

Le worker s’exécute sous la même origine que la page. Les restrictions de communication avec le DOM ne protègent pas contre un code volontairement malveillant ; n’utilisez que des extensions d’auteurs de confiance.

## Cycle de vie et erreurs

Chaque seconde, l’hôte envoie un ping pour vérifier que le worker répond. La gestion de `__pong` est ajoutée automatiquement à la compilation. Si le worker d’une page visible ne répond pas pendant plus de six secondes, il est arrêté. Le navigateur peut ralentir les minuteurs des onglets inactifs ; cette limite n’y est donc pas appliquée.

Un worker peut envoyer jusqu’à 240 messages par seconde, réponses au ping comprises. Une exception, une commande incorrecte ou une limite dépassée arrête l’extension et affiche une erreur. Le menu du site reste disponible.

Lors d’un changement de page ou de `pagehide`, l’hôte arrête le worker, retire les écouteurs et ferme les dialogues. Une nouvelle visite crée une autre instance : les variables globales du client ne constituent pas un stockage durable.

Interceptez les erreurs dans les boucles asynchrones et limitez les calculs coûteux. Un thread distinct ne dispense pas l’extension de maîtriser son usage du processeur, du GPU et de la mémoire.
