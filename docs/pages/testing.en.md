---
title: Testing and limitations
format: markdown
---
Test a plugin against data in a separate temporary directory, never against production files. Use these commands to check the engine and plugin handling:

```sh
npm run typecheck
npm run build
PLUGIN_WORKERS=1 PLUGIN_MAX_WORKERS=4 node --import tsx --test karui/tests/plugin-admin.test.ts karui/tests/plugin-http.test.ts
npm run test:panel
```

`test:browser` and `test:panel` start a separate server on port 3012 with a temporary content directory and the default theme. They do not use the live site’s data. Run these suites separately because they use the same port. Engine tests verify behavior, accessibility, and data flow rather than a theme’s particular palette or decoration. Optional tests of your own content and themes can be run with `npm run test:content`; they are not part of the engine suite.

## Plugin checklist

1. Open the page directly and through a link from another page. Both paths should produce the same view. Unsupported paths and methods should return 404 or 405, and `GET` and `HEAD` must not write data.
2. Send invalid URL parameters, request bodies, and custom YAML fields. The plugin should reject them. Also verify that a path supplied in the URL cannot be used to select an arbitrary file.
3. Try every `pluginPlacement` value. In `content` mode, make sure the text appears only once. You may use the prepared HTML or process the source yourself.
4. Check values inserted into HTML: special characters from untrusted data must be escaped. Put JSON in `data-context` through Edge double braces.
5. Try to open administration without a session, without `admin: true`, and with an incorrect page assignment. Verify that writes without CSRF are rejected. A `mode=admin` parameter in a public URL must not expose administration.
6. Verify that private client code and CSS cannot be downloaded while logged out. State files, backend code, `node_modules`, and templates must not be available over HTTP.
7. Trigger a backend exception, an execution timeout, and a client error. The rest of the page should continue to work. Also verify that concurrent writes do not overwrite each other.
8. Run the plugin in the target container image. Check its dependencies and whether changing the version refreshes its code, views, and styles.
9. View the page on a phone, navigate it with the keyboard, and enable reduced motion (`prefers-reduced-motion`). Make sure the plugin CSS does not alter unrelated page elements.
10. Check how many messages the worker sends. Use OffscreenCanvas for expensive rendering and limit the update frequency.

## What your plugin must implement

Forms, validation, and file writes belong to the plugin. The engine does not automatically generate create, read, update, and delete operations (CRUD).

The plugin API does not provide task scheduling (cron), WebSockets, streams, binary responses, custom headers and cookies, or Fastify route registration. The client changes the view through [host commands](/plugins/client), without direct DOM access. The engine provides neither an installer nor a secure environment for executing code from untrusted authors.

## Finding the cause of an error

Start with the HTTP status and server log. Check that the manifest is valid, source files and dependencies are available, and `version` was increased after a code change.

If the view opens but does not react to clicks, inspect the worker console and the Network tab in browser developer tools. Check files loaded with `?v=...` and any CSP errors. Compare limit-related messages with the [plugin limits](/plugins/runtime). If a package is involved, check its compatibility with Node and with the backend or client compilation target.
