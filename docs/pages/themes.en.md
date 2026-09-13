---
title: Themes
format: markdown
showSubpages: false
---

A theme controls the appearance of the entire site, including the administration panel. It is not a plugin assigned to a particular page. It may contain Edge templates, styles, images, and browser code.

## Selecting a theme

Open **Site settings** in the panel, select a theme, and save. The same choice can be stored in `site.yml`:

```yaml
title: My site
theme: example
menu: []
```

The same tab configures the home page and values used by the default theme:

```yaml
title: My site
home: /news
language: en
description: A short site description
brandName: Brand name
tagline: Additional header text
logo: /media/logo.png
favicon: /media/favicon.png
showBrandName: true
footerFormat: markdown
footer: |
  © 2026 **Brand name** · [Contact](/contact)
```

`title` becomes the document title, `language` the `lang` attribute, and `description` the page metadata. `brandName`, `tagline`, and `logo` build the header. Logo and favicon may reference `/media/` files or absolute HTTPS URLs. The footer accepts Markdown or HTML according to `footerFormat`. The default theme supports all these fields; a custom theme decides which ones it uses and where.

`site.yml` always remains the primary configuration. For every additional language, `site.<language>.yml` may override only `title`, `description`, `brandName`, `tagline`, and `footer`. The panel language selector switches the edited file and disables shared fields such as the theme, home page, logo, language list, and footer format. Missing translations fall back to `site.yml`.

Without `theme`, Karui uses the engine’s `default` theme from `karui/templates/`. It requires no theme directory in the content. An empty content directory displays the Karui welcome page; you can add pages in the panel. The documentation also uses the default theme.

## Creating a custom template

This command exports the complete default theme for customization. Run it in the project directory or container terminal:

```bash
npm run create-template
```

It asks for a name and writes files to `content/templates/<name>`. Names use lowercase letters, digits, and hyphens. For automation, pass the name as an argument: `npm run create-template -- corporate`.

The exported template appears in **Site settings** alongside themes from `content/themes`. Both directories use the same format and build process. Do not use the same name in both. The command never overwrites an existing template.

## Theme files

```text
content/
  site.yml
  themes/
    example/
      theme.json
      client.ts
      client/
        controls.tsx
      templates/
        components/layout.edge
        partials/home.edge
      assets/
        site.css
        images/logo.svg
  templates/
    corporate/
      theme.json
      templates/
      assets/
```

Only `theme.json` is required:

```json
{
  "name": "Example",
  "version": "1.0.0",
  "description": "A short appearance description."
}
```

The theme identifier is the directory name under `content/themes` or `content/templates`. Use lowercase letters, digits, and hyphens, up to 64 characters. `default` is reserved for the engine theme. `version` is required; change it when publishing template, style, or script changes.

Templates and resources replace default files at the same relative path. Missing files are inherited, so you may replace only `assets/site.css` while keeping the panel forms and all engine views.

## Templates and resources

Edge receives a `theme` object:

| Field | Meaning |
| --- | --- |
| `name` | Directory identifier, e.g. `example` |
| `label` | Manifest name |
| `version` | Manifest version |
| `key` | Compiled bundle key |
| `assets` | Map from relative filenames to public URLs |
| `client` | Browser bundle URL or an empty string |

```edge
<link rel="stylesheet" href="{{ theme.assets['site.css'] }}">
<img src="{{ theme.assets['images/logo.svg'] }}" alt="Logo">
```

In CSS, use paths relative to the stylesheet, such as `url("images/logo.svg")`. In `client.ts`, obtain an image URL with `new URL('./images/logo.svg', import.meta.url)`: the generated `client.js` resides in the same public directory as `site.css`.

Only `assets/` and the compiled `client.ts` output are published. TypeScript sources, the manifest, and Edge templates remain private. Symbolic links in the resource tree are ignored. Filenames may contain ASCII letters, digits, dots, hyphens, and underscores, but no spaces, `..` paths, or hidden files. Limits are 1,024 files and 128 MiB per tree, 32 MiB per file. The JavaScript bundle may be up to 4 MB.

## Engine-compatible layout

The simplest approach is to inherit `components/layout.edge` and change CSS. If you replace the layout, preserve these integration points:

- `.site-shell` — common parent of content and navigation;
- `#page` — content container with `tabindex="-1"` and the page title in `aria-label`;
- `#menu` and the `partials/menu` and `partials/submenu` views — navigation and mobile-tree data;
- `data-theme`, `data-theme-client`, `data-asset-version`, and `data-print` on `body`;
- `/assets/main.js?v={{ assetVersion }}` and current-page styles (`styleUrl` and gallery CSS).

`partials/page-content.edge` combines content, plugin output, gallery, and subpages. `partials/home.edge` renders the home view. A theme may leave the latter empty when its home page should show no content container. Navigation supports this without reloading the document.

Views receive `site`, `page`, `submenu`, `children`, `back`, `home`, `print`, `styleUrl`, `assetVersion`, and plugin data from the engine. Exact contracts and attributes are shown in the default templates. Preserve them when replacing the gallery or panel: they form the interface between HTML and engine code.

## Browser code and transitions

The optional `client.ts` is bundled by esbuild as ESM. It may import `.ts` and `.tsx` files, use Preact, and use dependencies available in the engine or the theme’s own `node_modules`. Install dependencies yourself—the server does not run package installation.

```ts
export default function initialize() {
  return {
    async transition(element, entering, signal) {
      if (!element || signal.aborted) return;
      const animation = element.animate(
        { opacity: entering ? [0, 1] : [1, 0] },
        { duration: entering ? 150 : 125 }
      );
      const cancel = () => animation.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try { await animation.finished; } catch { /* Cancelled. */ }
      finally {
        signal.removeEventListener('abort', cancel);
        animation.cancel();
      }
    },
    waiting(page, shell) {
      return () => { /* Remove decorations, timers, and observers. */ };
    }
  };
}
```

Both functions are optional. Without a custom transition, the engine gently fades out for 125 ms and in for 150 ms. Exit starts in parallel with fetching; entry waits for exit, content, and styles. `AbortSignal` cancels an older transition after another click. Reduced-motion preferences skip animations.

`transition` receives the page container or mobile navigation. Its promise must settle. Do not replace or clone the container contents—you may lose form, image, and plugin state. The cleanup returned by `waiting` runs after a response, error, or cancellation. Successful navigation emits `karui:navigated` on `document`.

## Compilation and cache

Themes are not compiled at process startup. Compilation occurs on first use; saving a theme choice in the panel prepares it before committing the setting. Concurrent requests in one process share the build. The resulting bundle contains snapshots of templates, resources, and client code.

Public URLs have the form `/assets/themes/<theme>/<key>/<file>`. Bundles are stored under `CONTENT_CACHE_DIR/themes`, outside both content and the application installation. The Docker image does not need write access. A tmpfs cache resides in RAM and may disappear when the container is recreated.

A restart reuses an existing bundle. Changing source files without changing `version` does not rebuild it. A new bundle is created after changes to the theme version, engine, default templates, or esbuild, or when cache is absent. Old URLs remain valid for already-open documents. Cache responses are `immutable`; switching theme or bundle triggers a full load on the next navigation to avoid mixing appearances.

An invalid manifest or build failure falls back to the default appearance; the panel will not save that selection. Themes are trusted administrator code, not a sandbox: Edge can execute server expressions and `client.ts` has browser document privileges, including in the panel. Do not install themes from untrusted sources. Client exceptions are caught, but an infinite loop can freeze the tab.
