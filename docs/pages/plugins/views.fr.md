---
title: Contenu statique et modèles Edge
format: markdown
---
## Blocs de code Markdown

Entourez un bloc de code de trois accents graves (`` ` ``). Après l’ouverture, indiquez le langage, par exemple `ts`, `js`, `json`, `yaml`, `sh`, `html`, `css`, `python`, `sql` ou `edge`. **highlight.js** colore la syntaxe sur le site comme dans la documentation :

````markdown
```ts
const message = "Hello world";
console.log(message);
```
````

Résultat :

```ts
const message = "Hello world";
console.log(message);
```

`edge` active les règles HTML/Handlebars qui reconnaissent les balises et expressions entre accolades. Sans langage, avec un nom inconnu, `text` ou `plaintext`, le bloc conserve son cadre mais n’est pas coloré. Le moteur ne détecte pas automatiquement le langage et ignore les blocs dépassant 50 000 caractères afin de ne pas ralentir le rendu.

Les couleurs suivent le thème clair ou sombre. Les longues lignes défilent dans le bloc, y compris sur téléphone, et sont renvoyées à la ligne à l’impression. Le HTML et le JavaScript d’un bloc sont affichés comme texte, jamais exécutés.

La coloration a lieu sur le serveur lors de l’actualisation du cache. Elle ne requiert aucune bibliothèque dans le navigateur, fonctionne sans JavaScript et pendant la navigation partielle, et ne modifie jamais la source Markdown.

Dans `context.content.html`, les blocs sont déjà colorés. Cette fonction ne concerne ni les pages `format: html`, ni le HTML inséré manuellement, ni le code en ligne. L’éditeur enregistre le contenu sans le balisage ajouté par la coloration.

## Tableaux Markdown

Utilisez la syntaxe Markdown standard. Le moteur donne aux tableaux un en-tête distinct, une bordure et des lignes alternées discrètes adaptées au thème. Les tableaux larges défilent horizontalement au toucher ou au clavier au lieu d’élargir toute la page.

```markdown
| Option | État | Nombre |
| :--- | :---: | ---: |
| `cache` | **Actif** | 8 |
| Extensions | Facultatives | 16 |
```

| Option | État | Nombre |
| :--- | :---: | ---: |
| `cache` | **Actif** | 8 |
| Extensions | Facultatives | 16 |

Les deux-points de la ligne de séparation alignent une colonne à gauche, au centre ou à droite. Les cellules acceptent liens, emphase et code. Échappez une barre verticale avec `\|` afin qu’elle ne marque pas une limite de colonne.

Le résultat est un tableau HTML accessible sans JavaScript. Il ne propose ni tri ni pagination. Les styles ne s’appliquent qu’aux tableaux Markdown ; le HTML manuel et le fichier source restent inchangés. Une extension reçoit le tableau final dans `context.content.html`. À l’impression, son contenu revient à la ligne au lieu d’être coupé.

## Style commun des éléments

Le moteur charge `ui.css` sur chaque page, panneau et documentation compris. Champs texte, boutons, listes déroulantes, cases à cocher, `fieldset`, `details`, citations et séparateurs possèdent des styles par défaut adaptés au thème. Les sélecteurs de base ont une faible spécificité afin que l’extension ajuste son agencement sans `!important`.

Un simple `<section>` ne reçoit ni cadre ni fond. Utilisez ces classes communes :

| Classe | Rôle |
| --- | --- |
| `ui-section` | Section transparente héritant de la couleur du texte. |
| `ui-section-heading` | Titre de section, à dimensionner selon la vue. |
| `ui-surface` | Bloc transparent espacé, avec bordure fine et coins arrondis. |
| `ui-badge` | Petite étiquette utilisant l’accent du thème. |
| `ui-empty` | Message d’absence de contenu. |
| `ui-notice` | Message avec un bord accentué. |

```html
<section class="ui-section ui-surface">
  <h2 class="ui-section-heading">Tâches <span class="ui-badge">Aujourd’hui</span></h2>
  <p class="ui-empty">Aucune tâche planifiée.</p>
</section>
```

Votre CSS peut utiliser `--ui-accent`, `--ui-muted`, `--ui-line`, `--ui-rule`, `--ui-tint` et `--ui-radius`. Les contrôles utilisent `--ui-control-bg`, `--ui-control-text` et `--ui-control-border`, les états interactifs `--ui-hover` et `--ui-active`. Ces variables permettent au changement de thème de restyler l’extension sans JavaScript.

## Position de l’extension par rapport au contenu

Choisissez une extension dans l’éditeur, puis « Position de l’extension par rapport au contenu ». Le champ YAML correspondant est `pluginPlacement` :

| `pluginPlacement` | Comportement |
| --- | --- |
| `after` | Ordre par défaut : texte, galerie, sous-pages, extension. |
| `before` | Titre, extension, texte, galerie, sous-pages. |
| `content` | L’extension reçoit `context.content` et décide comment l’utiliser. Le moteur n’affiche pas le texte séparément. Galerie et sous-pages conservent leurs réglages et précèdent l’extension. |

L’extension accède au contenu dans tous les modes ; `content` ne change que l’affichage. Sans extension, le moteur affiche le texte indépendamment de ce champ.

Le moteur affiche le titre de page. L’ordre choisi s’applique à l’accès direct, à la navigation partielle et à l’impression, mais pas aux réponses JSON.

`context.content.source` contient la source sans YAML et `context.content.html` le HTML rendu. Une extension peut l’ignorer, l’insérer dans sa vue, le découper ou remplacer des marqueurs :

```ts
const escape = (text: string) => text.replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const html = context.content.html.replaceAll('[[notice]]', escape('Message de l’extension'));
return { type: 'view', template: 'views/public.edge', data: { html } };
```

Insérez le résultat avec `{{{ html }}}`. Les triples accolades rendent le HTML sans l’échapper. Ne les utilisez jamais pour des paramètres URL ou données de requête non validés. Le parseur Markdown autorise le HTML brut et ne retire pas les balises dangereuses : contenu et code doivent provenir d’auteurs de confiance.

## Vues locales

Un handler peut renvoyer :

```ts
return {
  type: 'view',
  template: 'views/public.edge',
  data: { title: context.page.title, items: ['A', 'B'] },
  client: 'client.ts',
  styles: 'style.css',
};
```

Le moteur trouve les fichiers `.edge` dans le répertoire de l’extension et ses sous-répertoires. `template` est relatif à la racine de l’extension et inclut `.edge`. Les noms acceptent lettres ASCII, chiffres, `_` et `-`. Les chemins absolus et `..` sont interdits. Répertoires cachés, `node_modules` et liens symboliques sont ignorés ; seules les vues enregistrées sont utilisables.

Le champ facultatif `status` définit le statut HTTP d’une vue. Une extension peut afficher une erreur dans le conteneur normal tout en renvoyant le bon statut, par exemple `{ type: 'view', template: 'views/not-found.edge', status: 404 }`. La valeur par défaut est 200.

Les variables proviennent de `data`. Les modèles ne reçoivent pas automatiquement `context`, `page`, les chemins serveur, la session ou le CSRF. Ne transmettez que le nécessaire :

```edge
<h2>{{ title }}</h2>
@include('views/partials/list')
```

`views/partials/list.edge` :

```edge
<ul>
  @each(item in items)
    <li>{{ item }}</li>
  @end
</ul>
```

Dans `@include`, utilisez un chemin sans extension, relatif à la racine de l’extension et non au fichier courant. Conditions, boucles, composants, slots et autres directives Edge sont disponibles.

Le worker possède sa propre instance Edge et n’accède pas aux vues du moteur. Un handler ne peut enregistrer de valeurs globales ni d’aides Edge. Calculez les valeurs avant la réponse et transmettez-les dans `data`.

## Transmettre des données au client

Placez un seul élément dans la vue :

```edge
<div data-context="{{ JSON.stringify(clientContext) }}">
  <button type="button" data-action="next">Suivant</button>
</div>
```

`clientContext` est un objet destiné au navigateur, préparé par le handler. Les doubles accolades permettent à Edge d’échapper les caractères spéciaux de l’attribut. Le moteur lit le JSON du premier `[data-context]` de l’extension et l’envoie comme `init.context` ; s’il n’existe pas, il envoie `{}`.

Ne transmettez jamais tout `PluginContext` au navigateur : il contient des chemins serveur et, dans l’administration, des données de session.

## CSS et ressources statiques

Renvoyez `styles: 'style.css'` pour joindre une feuille liée à la version. L’administration peut employer `admin.css`.

Les styles ne sont pas isolés automatiquement. Préfixez les sélecteurs avec une classe propre, par exemple `.example-plugin button`, afin de ne pas modifier le menu ou le panneau.

Placez images, polices, documents et autres fichiers publics dans `assets/`. À la compilation, le moteur les copie vers un répertoire versionné sous `CONTENT_CACHE_DIR/plugins/public`. Les vues Edge reçoivent `pluginAssets` et le backend la même table dans `context.assets` :

```edge
<img src="{{ pluginAssets['images/logo.webp'] }}" alt="Logo">
<a href="{{ pluginAssets['documents/manual.pdf'] }}">Manuel</a>
```

```ts
const logoUrl = context.assets['images/logo.webp'];
```

Ne construisez pas ces adresses manuellement. L’URL contient le nom de l’extension et la clé de l’artefact compilé. Les vues d’administration utilisent les routes protégées du panneau, les vues publiques les routes publiques ; un même modèle peut donc servir les deux.

Dans le CSS, référencez le répertoire source relativement. Le compilateur remplace l’adresse par une URL versionnée :

```css
.example-plugin { background-image: url("./assets/images/background.webp"); }
```

Les chemins externes, `/media/...`, `data:` et références hors de `assets/` restent inchangés. `@import` n’est pas regroupé automatiquement.

Le répertoire peut contenir au maximum 512 fichiers. Un fichier peut atteindre 32 Mio et l’ensemble 128 Mio. Les segments acceptent lettres ASCII, chiffres, points, `_` et `-` ; le chemin complet est limité à 240 caractères. Fichiers/répertoires cachés et liens symboliques sont ignorés. Un fichier `url("./assets/...")` absent fait échouer la compilation au lieu de publier un CSS cassé.

Tout ce qui se trouve dans `assets/` est public. N’y stockez ni configuration, ni source, ni clé, ni donnée utilisateur. Augmentez `version` après une modification ; un document déjà ouvert conserve l’URL de son ancien instantané.

Joignez le code client avec `client`, jamais avec une balise `<script>` dans le HTML. La CSP bloque les scripts intégrés aux vues.

Les routes publiques d’extension exposent uniquement le `client.ts`/`client.js` compilé, `style.css` et l’instantané de `assets/`. Code backend, manifeste, vues et `node_modules` ne sont pas servis. `admin.ts`/`admin.js` et `admin.css` ne sont accessibles que par les routes protégées du panneau.
