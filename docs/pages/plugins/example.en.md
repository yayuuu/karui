---
title: Example plugin with administration
format: markdown
plugin: example
pluginPlacement: content
showSubpages: false
---
This paragraph comes from the English page file, but the **plugin renders it**.

The plugin replaces a marker in the content with a message from its settings: **[[notice]]**.

The example code is in `docs/plugins/example`. Clicking the button below sends an event to the public Web Worker. The worker returns a text-change command, which the engine performs on the page.

You can compare two storage methods: the click counter lasts only until you leave the page, while the counter in administration is saved to `state/example/settings.json`. The saved counter is shared by all pages using this plugin.

[Administration setup](/plugins/admin) · [Public status API](/plugins/example/api/status)
