---
title: Exemple d’extension avec administration
format: markdown
plugin: example
pluginPlacement: content
showSubpages: false
---
Ce paragraphe provient du fichier français de la page, mais il est **rendu par l’extension**.

L’extension remplace un marqueur du contenu par un message enregistré dans ses paramètres : **[[notice]]**.

Le code de l’exemple se trouve dans `docs/plugins/example`. Un clic sur le bouton ci-dessous envoie un événement au Web Worker public. Le worker renvoie une commande de modification de texte que le moteur exécute sur la page.

Vous pouvez comparer deux méthodes de stockage : le compteur de clics ne dure que jusqu’au départ de la page, tandis que le compteur d’administration est enregistré dans `state/example/settings.json`. Le compteur enregistré est commun à toutes les pages utilisant cette extension.

[Configuration de l’administration](/plugins/admin) · [API publique d’état](/plugins/example/api/status)
