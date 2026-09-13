---
title: Creating a plugin
format: markdown
showSubpages: false
---
A plugin adds custom TypeScript or JavaScript logic to a page. Place its files in the mounted `content/plugins/<name>` directory. Use lowercase ASCII letters, digits, and hyphens in the name. Install code only from trusted authors—plugins can access server files.

The gallery and page editor are engine features and do not require plugins.

```text
content/
  pages/example.md
  plugins/example/
    plugin.json        # required manifest with a version number
    index.ts           # required backend handler (or index.js)
    views/public.edge  # any .edge views and subdirectories
    views/admin.edge
    client.ts          # optional public Web Worker (or client.js)
    style.css          # optional public CSS
    assets/            # optional public images, fonts, and other files
      logo.webp
    admin.ts           # optional private Web Worker (or admin.js)
    admin.css          # optional private CSS
    package.json       # optional plugin dependencies
    package-lock.json
    node_modules/
  state/example/       # private working data created by the plugin
  media/               # public media served by the engine
```

Minimal `plugin.json`:

```json
{ "version": "1", "concurrent": false, "admin": false }
```

The `version` field is required. It must contain 1–64 characters, beginning with an ASCII letter or digit. Dots, underscores, and hyphens are also allowed after the first character.

`concurrent` and `admin` are optional and both default to `false`. The manifest accepts no other keys.

The `pages/example.md` page:

```yaml
---
title: Example
format: markdown
plugin: example
pluginPlacement: after
---
This is ordinary **page content**.
```

The `index.ts` handler:

```ts
export default async function render(context) {
  if (context.suffix || !['GET', 'HEAD'].includes(context.method)) {
    return { type: 'json', status: 404, data: { error: 'Not found' } };
  }
  return {
    type: 'view',
    template: 'views/public.edge',
    data: { title: context.page.title },
  };
}
```

The `views/public.edge` view:

```edge
<p>{{ title }}</p>
```

Export the request handler as the default export. It may be synchronous or asynchronous. It returns a view or JSON; the engine handles request routing and sends the response. The handler receives neither a Fastify instance nor a `reply` object.

Complete `PluginContext` and `PluginResponse` definitions are in `karui/src/plugins/contracts.ts`. Use `PluginResponse` to describe handler responses. `PluginResult` is used internally by the engine to hold the result after view rendering.

The example in this repository imports types through a relative path to the engine file. The compiler removes that import. If you develop a plugin in a separate repository, you may keep the type definitions locally; do not import engine runtime code into the plugin.

`.ts` files take precedence over matching `.js` files. The compiler bundles locally imported backend files into the output. The contents of `assets/` are also tied to the plugin version. To publish changed code or an asset, [increase the plugin version](/plugins/runtime)—saving the source alone does not trigger recompilation.
