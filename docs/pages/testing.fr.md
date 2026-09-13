---
title: Tests et limites
format: markdown
---
Testez une extension avec des données placées dans un répertoire temporaire distinct, jamais avec les fichiers de production. Utilisez ces commandes pour vérifier le moteur et la gestion des extensions :

```sh
npm run typecheck
npm run build
PLUGIN_WORKERS=1 PLUGIN_MAX_WORKERS=4 node --import tsx --test karui/tests/plugin-admin.test.ts karui/tests/plugin-http.test.ts
npm run test:panel
```

`test:browser` et `test:panel` démarrent un serveur distinct sur le port 3012, avec un répertoire de contenu temporaire et le thème par défaut. Ils n’utilisent pas les données du site réel. Exécutez ces suites séparément, car elles utilisent le même port. Les tests du moteur vérifient le comportement, l’accessibilité et le flux des données, pas la palette ou les décorations d’un thème particulier. Les tests facultatifs de votre propre contenu et de vos thèmes peuvent être lancés avec `npm run test:content` ; ils ne font pas partie de la suite du moteur.

## Liste de contrôle d’une extension

1. Ouvrez la page directement puis depuis un lien d’une autre page. Les deux méthodes doivent produire la même vue. Les chemins et méthodes non pris en charge doivent renvoyer 404 ou 405, et `GET` ainsi que `HEAD` ne doivent jamais écrire de données.
2. Envoyez des paramètres URL, un corps de requête et des champs YAML personnalisés incorrects. L’extension doit les refuser. Vérifiez également qu’un chemin fourni dans l’URL ne permet pas de choisir un fichier arbitraire.
3. Essayez toutes les valeurs de `pluginPlacement`. En mode `content`, vérifiez que le texte n’apparaît qu’une fois. Vous pouvez utiliser le HTML préparé ou traiter vous-même la source.
4. Contrôlez les valeurs insérées dans le HTML : les caractères spéciaux provenant de données non fiables doivent être échappés. Placez le JSON de `data-context` entre doubles accolades Edge.
5. Essayez d’ouvrir l’administration sans session, sans `admin: true` et avec une mauvaise association de page. Vérifiez que les écritures sans CSRF sont refusées. Un paramètre `mode=admin` dans une URL publique ne doit pas ouvrir l’administration.
6. Vérifiez qu’un utilisateur déconnecté ne peut pas télécharger le client privé ni sa feuille CSS. Les fichiers d’état, le code backend, `node_modules` et les modèles ne doivent pas être disponibles par HTTP.
7. Provoquez une erreur backend, un dépassement du temps d’exécution et une erreur client. Le reste du site doit continuer à fonctionner. Vérifiez aussi que des écritures concurrentes ne s’écrasent pas.
8. Exécutez l’extension dans l’image de conteneur cible. Vérifiez ses dépendances et que le changement de version actualise le code, les vues et les styles.
9. Consultez la page sur un téléphone, parcourez-la au clavier et activez la réduction des animations (`prefers-reduced-motion`). Assurez-vous que le CSS de l’extension ne modifie pas les autres éléments de la page.
10. Vérifiez le nombre de messages envoyés par le worker. Utilisez OffscreenCanvas pour les rendus coûteux et limitez la fréquence des mises à jour.

## Ce que votre extension doit gérer

Les formulaires, la validation des données et l’écriture des fichiers sont à réaliser dans l’extension. Le moteur ne génère pas automatiquement les opérations de création, lecture, modification et suppression (CRUD).

L’API des extensions ne fournit ni planificateur de tâches (cron), ni WebSocket, ni flux, ni réponse binaire, ni en-têtes et cookies personnalisés, ni enregistrement de routes Fastify. Le client modifie la vue à l’aide des [commandes de l’hôte](/plugins/client), sans accès direct au DOM. Le moteur ne fournit ni installateur ni environnement sécurisé pour exécuter le code d’auteurs non fiables.

## Rechercher la cause d’une erreur

Commencez par le statut HTTP et le journal du serveur. Vérifiez que le manifeste est valide, que les fichiers sources et les dépendances sont disponibles, et que `version` a été augmenté après une modification du code.

Si la vue s’ouvre mais ne réagit pas aux clics, consultez la console du worker et l’onglet Réseau des outils de développement du navigateur. Vérifiez le chargement des fichiers avec `?v=...` et les éventuelles erreurs CSP. Comparez les messages de dépassement avec les [limites des extensions](/plugins/runtime). Si le problème concerne un paquet, vérifiez sa compatibilité avec Node et avec la cible de compilation du backend ou du client.
