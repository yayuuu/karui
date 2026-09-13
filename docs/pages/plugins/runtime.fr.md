---
title: Fichiers, dépendances, compilation et réserve de workers
format: markdown
---
## Dépendances

Une extension peut posséder ses propres `package.json`, `package-lock.json` et `node_modules`. Le compilateur regroupe les fichiers backend importés localement. Les paquets Node restent externes et sont résolus depuis le point d’entrée de l’extension.

Le backend cible CommonJS (CJS) sous Node 24. Vérifiez la compatibilité des paquets, notamment ceux exclusivement ESM ou utilisant `await` au niveau supérieur. Le client et ses dépendances sont regroupés en ESM ES2022 pour le navigateur. Les bibliothèques exigeant le DOM ne fonctionnent pas dans un Web Worker.

Installez les dépendances d’une extension avec `npm ci --omit=dev --ignore-scripts` dans son répertoire, ou toutes les extensions localement ou par Docker :

```sh
npm run plugins:install
docker compose --profile tools run --rm plugins-install
```

L’outil emploie `npm ci` en présence d’un fichier de verrouillage, sinon `npm install`. Il ignore `devDependencies`, les scripts d’installation, `audit` et `fund` ; placez donc les paquets d’exécution dans `dependencies`. Les paquets natifs doivent correspondre au système et à l’architecture cibles.

## Versionnement

Au démarrage, le moteur prépare la réserve de workers sans compiler les extensions. La première requête vérifie le manifeste et cherche un artefact. Son absence, son invalidité ou une nouvelle `version` déclenche la compilation.

Augmentez la version après toute modification du backend, des aides, vues, clients, CSS, `assets/`, dépendances ou réglages `admin`/`concurrent`. Un changement de date du fichier ne suffit pas. L’artefact contient le code, les styles et modèles Edge, mais pas l’état lu à l’exécution, tel qu’un fichier JSON.

La clé de cache dépend du format d’artefact, d’esbuild, de la version majeure de Node, du chemin absolu et de la version du manifeste. Artefacts et ressources publiques sont écrits atomiquement sous `CONTENT_CACHE_DIR/plugins`. Le moteur en garde jusqu’à 32 en mémoire. Ces fichiers sont temporaires et peuvent disparaître avec le tmpfs.

Les URL JS/CSS contiennent `?v=...` et celles de `assets/` la clé d’artefact. Les fichiers publics sont mis en cache comme `immutable`, ceux de l’administration avec `no-store`. Ne placez aucun secret dans le code ou les ressources publics. Un manifeste illisible bloque l’exécution même si un artefact existe.

## Workers

### Ce qu’exécute un worker

Il s’agit ici des `node:worker_threads` du backend, pas des [Web Workers du navigateur](/plugins/client). Ce sont des threads d’un même processus Node, pas des conteneurs. Chacun possède son moteur JavaScript et ses variables globales ; plusieurs threads peuvent exécuter JavaScript en parallèle. Voir les [workers Node](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#worker-threads).

Le thread principal reçoit la requête HTTP et transmet les données à la réserve. Un worker appelle le handler et rend Edge pour une réponse de type vue. Le HTML ou JSON revient ensuite au moteur.

Un worker traite une tâche à la fois. Attendre `await readFile(...)` ou `await fetch(...)` occupe toujours sa place ; il ne reçoit une autre tâche qu’après la fin.

### Réserve permanente et threads supplémentaires

Le moteur conserve par défaut huit workers permanents partagés par toutes les extensions. Si aucun n’est libre et que la concurrence autorise une tâche supplémentaire, il peut en créer jusqu’à 16 au total. Au-delà, les tâches attendent.

Un worker temporaire peut rester inactif dix secondes après une tâche. Une nouvelle tâche réinitialise ce délai. L’expiration d’inactivité n’interrompt jamais une tâche ; le délai d’exécution est distinct.

La réserve préfère un worker libre ayant déjà chargé la bonne version, puis un worker non associé. Un worker est lié à une version d’une extension. Réutiliser sa place pour une autre remplace le thread. « Permanent » décrit donc la place dans la réserve, pas une instance immortelle ni des variables durables.

Edge est chargé à la préparation du worker, puis le code et les dépendances à la première tâche. La première visite peut être plus lente. Démarrer la réserve ne compile pas les extensions.

Avec une configuration 8/16, douze tâches concurrentes autorisées peuvent utiliser douze workers. Si elles ciblent toutes une extension `concurrent: false`, une seule s’exécute malgré les places libres.

### Réglages de la réserve

| Variable | Défaut | Plage |
| --- | --- | --- |
| `PLUGIN_WORKERS` | 8 | 1–64 |
| `PLUGIN_MAX_WORKERS` | max(16, permanents) | 1–128, au moins les permanents |
| `PLUGIN_WORKER_IDLE_MS` | 10000 | 100–300000 ms |
| `PLUGIN_TIMEOUT_MS` | 5000 | 100–30000 ms |
| `PLUGIN_WORKER_OLD_GENERATION_MB` | 64 | 16–4096 Mo, entier |
| `PLUGIN_WORKER_YOUNG_GENERATION_MB` | 16 | 4–1024 Mo, entier |
| `PLUGIN_WORKER_STACK_MB` | 4 | 1–64 Mo, entier |
| `CONTENT_CACHE_DIR` | temp + `karui-cache` | Docker : `/var/cache/karui` sur tmpfs |
| `CONTENT_REFRESH_MS` | 1000 | 100–60000 ms |

La documentation utilise un worker permanent et quatre au maximum. Le Compose principal règle `PLUGIN_WORKERS` et `PLUGIN_MAX_WORKERS` séparément. Davantage de workers augmente le débit, mais aussi la RAM et le CPU ; cela n’accélère ni un handler unique ni une file `concurrent: false`. Ajustez-les à partir de mesures réelles.

### Comprendre les limites mémoire V8

V8 est le moteur JavaScript de Node. Il place les objets dans un tas et récupère les objets inaccessibles avec le ramasse-miettes (GC). La fin d’une fonction ne libère pas immédiatement toute sa mémoire.

Les nouveaux objets commencent généralement dans la jeune génération. Ceux qui survivent peuvent passer dans l’ancienne génération. Ces noms décrivent la durée de vie des objets, pas l’âge du code. Voir les [générations et le GC de V8](https://v8.dev/blog/trash-talk#generational-layout).

`karui/src/plugins/pool.ts` convertit les variables d’environnement en `resourceLimits` :

| Réglage | Défaut | Signification |
| --- | ---: | --- |
| `maxYoungGenerationSizeMb` | 16 Mo | Objets récents. Son remplissage déclenche le GC ; ce n’est pas une limite de requête ou de fichier. |
| `maxOldGenerationSizeMb` | 64 Mo | Tas principal et valeurs durables : variables globales, bibliothèques et modèles. |
| `stackSizeMb` | 4 Mo | Pile d’appels. Une récursion profonde peut la dépasser avec peu de données. |

Ces valeurs concernent chaque worker permanent, temporaire ou remplacé. Elles ne réservent pas la mémoire et ne garantissent pas que l’usage total corresponde à leur somme.

Définissez-les dans `.env` :

```dotenv
PLUGIN_WORKER_OLD_GENERATION_MB=128
PLUGIN_WORKER_YOUNG_GENERATION_MB=32
PLUGIN_WORKER_STACK_MB=4
```

Compose les transmet au démarrage du conteneur ; ce ne sont pas des arguments de construction. Recréez le service :

```sh
docker compose up -d --force-recreate karui
docker compose -f docker-compose.docs.yml up -d --force-recreate docs
```

`docker compose restart` ne recharge pas l’environnement. Aucune reconstruction d’image ni nouvelle version d’extension n’est nécessaire. Sans Docker, transmettez les variables à Node : le moteur ne lit pas `.env` lui-même. Une valeur incorrecte empêche le démarrage.

Évitez `--max-old-space-size` et `--max-semi-space-size` simultanément, y compris dans `NODE_OPTIONS` : ils peuvent remplacer les limites des workers. Voir [`resourceLimits`](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options).

Si une extension conserve chaque rapport dans un tableau global, le GC ne peut pas les récupérer. La mémoire augmente malgré de petites requêtes. Employez un cache borné ou le stockage. Une récursion profonde peut plutôt dépasser la pile ; limitez la profondeur ou utilisez une file itérative.

### Ce que ces limites ne couvrent pas

`resourceLimits` concerne V8, pas toute la mémoire du processus. Certaines données `ArrayBuffer` et bibliothèques natives résident hors du tas. Dépasser V8 peut arrêter un worker ; épuiser toute la mémoire peut arrêter l’application.

Une image RGBA 5000 × 5000 décodée occupe environ 100 Mo avant les copies et l’espace de travail, même si son PNG est petit. Limitez dimensions, concurrence et résultats conservés. La limite du conteneur est la dernière barrière, pas un rejet progressif par tâche.

Pour diagnostiquer :

```ts
const usage = process.memoryUsage();
const mib = (bytes: number) => Math.round(bytes / 1024 / 1024);
console.log({
  heapUsedMiB: mib(usage.heapUsed),
  externalMiB: mib(usage.external),
  arrayBuffersMiB: mib(usage.arrayBuffers),
  processRssMiB: mib(usage.rss),
});
```

`heapUsed` représente le tas du thread courant. `external` inclut la mémoire externe déclarée ; `arrayBuffers` en fait déjà partie, ne les additionnez pas. `rss` couvre tout le processus et tous les workers, pas seulement le thread ni tout le conteneur. Voir [`process.memoryUsage()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage).

### Panne et délai d’exécution

`PLUGIN_TIMEOUT_MS` court de l’attribution d’une tâche à un worker prêt jusqu’au résultat. Il inclut les attentes fichier/réseau, le handler, le rendu Edge et, pour la première tâche, le chargement du code. Compilation et attente en file sont distinctes.

Après une exception, la fin d’un thread ou un dépassement, le moteur retire le worker et remplace les places permanentes. Une page publique reçoit une vue d’erreur 503 ; les endpoints JSON et l’administration reçoivent du JSON 503. Le verrou de file n’est libéré qu’à la fin du thread défaillant.

Un délai dépassé n’annule ni les écritures ni les requêtes externes. Un handler peut enregistrer puis expirer pendant le rendu : un statut 503 ne prouve donc pas l’échec de la modification. Concevez les nouvelles tentatives en conséquence.

### Isolation des pannes, pas des droits

Les workers ne sont pas une sandbox. Une extension possède les droits de l’utilisateur du processus. `storageDir` est un emplacement conseillé, pas une barrière. Un bug peut écraser les fichiers d’une autre extension ; un code malveillant peut lire ou transmettre les données accessibles. Un thread distinct et `concurrent: false` ne l’empêchent pas.

Une exception JavaScript ordinaire peut être contenue en arrêtant le worker. Une panne native ou l’épuisement global des ressources peut toucher toute l’application. Utilisez du code fiable, validez les entrées et gardez des sauvegardes.

Ne conservez pas de données sensibles aux requêtes dans les variables globales. Un worker ayant servi l’administration peut ensuite rendre une vue publique. Utilisez toujours le `context` courant ; ne mettez jamais en cache session, CSRF ou données utilisateur.

## Concurrence et état

### Effet de `concurrent`

La concurrence signifie que plusieurs tâches avancent en même temps, éventuellement en parallèle :

```json
{ "version": "1", "concurrent": false, "admin": true }
```

| Réglage | Requêtes de la même extension | À choisir lorsque |
| --- | --- | --- |
| `false` (défaut) | Une tâche à la fois ; les autres attendent. Les autres extensions peuvent avancer. | L’extension lit, modifie et écrit un état partagé. |
| `true` | Plusieurs tâches utilisent des workers distincts si disponibles. | Elles sont indépendantes/en lecture seule, ou leurs écritures sont synchronisées. |

La file couvre tout le répertoire de l’extension : pages associées, ressources, paramètres, méthodes et administration. Il n’existe pas de règle séparée pour `GET` et `POST`. Augmentez `version` après modification.

Avec `concurrent: false`, une longue requête A retarde une courte requête B de la même extension, même pour des ressources différentes. Ajouter des workers ne change pas cette règle.

### Exemple : deux clics n’incrémentent qu’une fois

Supposons que `settings.json` contienne `count: 10` :

```ts
const settings = await readSettings(context.storageDir);
settings.count += 1;
await saveSettings(context.storageDir, settings);
return { type: 'json', data: { count: settings.count } };
```

| Étape | Requête A | Requête B | Fichier |
| --- | --- | --- | ---: |
| 1 | Lit 10 | — | 10 |
| 2 | — | Lit 10 | 10 |
| 3 | Écrit 11 | — | 11 |
| 4 | — | Écrit 11 | 11 |

Les deux réussissent avec un JSON valide, mais une mise à jour est perdue. Avec `concurrent: false`, B démarre après A et écrit 12, si rien hors de la file ne modifie le fichier.

### Remplacement atomique et file résolvent des problèmes différents

Écrire un fichier temporaire puis remplacer la cible avec `rename` évite un JSON partiel, sans rendre atomique « lire → modifier → écrire ». Pour un état partagé simple, combinez `concurrent: false` et remplacement atomique avec un nom temporaire unique dans le même répertoire.

Ne transformez pas une erreur d’analyse en état vide au risque d’effacer les données de récupération. Le remplacement d’un fichier n’est pas une transaction multi-fichiers ni une garantie contre une coupure. Une modification répartie nécessite un protocole de récupération ; `finally` ne garantit rien après l’arrêt forcé du worker.

### Limites de la protection

`concurrent: false` ne protège que les tâches de cette file. Il ne couvre ni une autre extension ou un outil hôte écrivant le même fichier, ni les modifications manuelles, ni le travail continuant après le retour du handler. Séparez les données ou utilisez un rédacteur commun si une coordination plus large est nécessaire.

### `await` doit couvrir la fin du travail

```ts
// Incorrect : l’écriture continue après la réponse.
void saveSettings(context.storageDir, settings);
return { type: 'json', data: { saved: true } };
```

```ts
// Correct : la file attend et le handler reçoit l’erreur.
await saveSettings(context.storageDir, settings);
return { type: 'json', data: { saved: true } };
```

`Promise.all(...)` dans un handler peut encore créer des conflits internes. Les minuteurs et tâches de fond ne sont pas des files durables : le worker peut être remplacé ou arrêté.

### Ordre, nouvelles tentatives et formulaires périmés

La file ordonne les requêtes à leur arrivée, pas selon l’intention de l’utilisateur. Les opérations sensibles à l’ordre nécessitent un numéro ou l’attente côté client. Une absence de réponse ne prouve pas l’échec : relancer une incrémentation enregistrée mais non confirmée peut l’appliquer deux fois.

Pour une nouvelle tentative sûre, créez un identifiant d’opération avant le premier envoi et réutilisez-le. Enregistrez les identifiants terminés avec leurs résultats et protégez ensemble la vérification et la modification. Le moteur n’ajoute pas automatiquement l’idempotence.

Deux formulaires ouverts peuvent contenir un état ancien. Envoyez un numéro de révision et comparez-le à l’état courant sous la file ou le verrou ; renvoyez un conflit tel que 409 au lieu d’écraser une modification récente.

### Choisir le réglage

Commencez par `concurrent: false` pour des écritures partagées. Utilisez `true` seulement si les requêtes sont indépendantes, lisent des données immuables ou synchronisent explicitement leurs écritures. Une lecture apparente peut aussi initialiser un cache, créer un fichier ou reprendre une opération.

Avant le déploiement, envoyez des requêtes simultanées et contrôlez l’état final, pas seulement les statuts HTTP. Testez identifiants dupliqués, révisions anciennes et pannes entre les étapes sur des données temporaires.

## Où stocker les données

Stockez l’état dans `context.storageDir` et créez-le avec `mkdir({ recursive: true })`. Toutes les pages utilisant une extension partagent ce répertoire. Pour séparer leurs données, dérivez une clé déterministe sûre, par exemple un hash de `page.href` ; n’utilisez jamais une URL non validée comme chemin.

Le répertoire d’état n’est pas servi par HTTP. Ne conservez pas les données durables dans les variables globales ou le cache tmpfs. Placez les téléchargements publics dans `content/media`. Le moteur sert PNG/JPEG/WebP/GIF, MOV/MP4/WebM, MP3/OGG, WOFF2 et HTML sandboxé, mais pas automatiquement JSON, TS ou Edge.

L’extension peut lire ses fichiers avec les API Node. `PluginContext` ne permet pas de modifier les pages, galeries, comptes ou caches. Un outil externe écrivant atomiquement un fichier de page valide sera détecté au prochain rafraîchissement.

## Limites de taille et de file

- Manifeste : 4 096 caractères.
- Source client public/admin : 256 000 octets chacune avant regroupement.
- Artefact sérialisé : 8 000 000 octets.
- HTML rendu : 2 000 000 octets.
- Résultat hors vue : 4 000 000 octets après sérialisation JSON.
- File : 128 tâches au total, au plus 48 en attente pour une extension ; attente et exécution sont également limitées à 128.
- Attente en file : 10 secondes plus le délai de l’extension. Démarrage d’un worker : 10 secondes.

Renvoyez des valeurs sérialisables en JSON : objets simples, tableaux, textes, nombres, booléens et `null`. Convertissez `BigInt` et évitez cycles, fonctions ou handles de ressources. L’isolation limite les pannes, mais ne sécurise pas du code non fiable.
