---
title: PluginContext and URLs
format: markdown
---
For every request, the engine creates a `PluginContext` and passes a copy to the backend worker. It contains the request address, page data, and paths needed for file operations. It contains data only—no functions or HTTP connection objects—and is not automatically sent to the browser.

| Field | Contents |
| --- | --- |
| `url: string` | Request path including parameters after `?`, without protocol or host. |
| `method: string` | HTTP method, such as `GET`, `HEAD`, or `POST`. |
| `body: unknown` | Parsed request body or `null`. The plugin must validate its type and contents. |
| `suffix: string` | Path after the assigned page address or plugin administration path. Empty for the base address; an extra route may be `/api/save`. |
| `basePath: string` | Publicly: the assigned page address. In the panel: `/panel/plugins/<name>`. No query string. |
| `language: string` | Expected response language, selected with `?lang=` or a remembered user choice. The plugin supplies its own translations. |
| `defaultLanguage: string` | Site-wide default language, useful as a plugin translation fallback. |
| `page` | Stored page metadata and content, described below. |
| `content.source: string` | Exact Markdown/HTML content without YAML front matter. |
| `content.html: string` | Markdown rendered to HTML, or the HTML source when the format is `html`. |
| `content.format` | `markdown` or `html`. |
| `mode` | `public` or `admin`, determined by the engine and never by query/body values. |
| `admin` | `null` publicly; `{ login, role, csrf }` in the panel. `role` is `owner` or `admin`. |
| `assets` | Versioned URLs for files in `assets/`, indexed by relative path, e.g. `assets['images/logo.webp']`. |
| `pluginDir` | Absolute path to `content/plugins/<name>`. |
| `contentRoot` | Absolute path to the mounted content directory. |
| `storageDir` | Absolute path to `content/state/<name>`; the plugin creates it when necessary. |
| `cacheDir` | Absolute path to `CONTENT_CACHE_DIR/plugin-data/<name>`. Use it only for data that can be rebuilt; it may be on tmpfs and disappear after a restart. Create it when necessary. |

## Page data (`page`)

The object contains `href`, `title`, `keywords`, `order`, `plugin`, `pluginPlacement`, `format`, `published`, `showSubpages`, `showPrint`, `showPdf`, `galleryVisibility`, `gallery`, `html`, `source`, and `sourceFile`. `sourceFile` is relative to the `pages` directory.

You may add custom fields to YAML metadata. The plugin receives them in `page`, but must validate their types and values. The engine sets `href`, `html`, and `source`.

On a public page, `page.gallery` contains the photos allowed by the visibility setting, including their dimensions. In the panel it contains every stored photo. Each photo has `src`, `thumbnail`, and `alt`, plus an optional `download`. In public mode it may also contain `width` and `height`.

Changing `context` does not write to the page or any other file. Plugin globals, however, may survive between requests. Never keep sessions, CSRF tokens, or user data in them.

## Public routing

For a plugin assigned to `/tools/report`:

| Request address | `page.href` / `basePath` | `suffix` |
| --- | --- | --- |
| `/tools/report?filter=active` | `/tools/report` | `""` |
| `/tools/report/api/save?filter=active` | `/tools/report` | `/api/save` |
| `/tools/report/history/2026` | `/tools/report` | `/history/2026` |

The engine first looks for a stored page at the requested address. If none exists, it checks successive parent paths and selects the nearest page with an assigned plugin. A stored child page therefore takes precedence over a dynamic route at the same address. If that page or any parent is unpublished, access is blocked before the plugin runs.

At `/`, the engine displays only the background and menu unless a home page is configured. The documentation uses `site.home: /start`, so `/` redirects to `/start`.

The engine decodes URL paths and redirects trailing slashes to the path without them, except for `/` itself. Validate `suffix` against an allowlist before using it to select a file. `/panel`, `/assets`, `/plugin-assets`, `/media`, and `/healthz` are reserved by the engine.

```ts
const url = new URL(context.url, 'http://plugin.invalid');
const filter = url.searchParams.get('filter') ?? 'all';
if (!/^(all|active|archived)$/.test(filter)) {
  return { type: 'json', status: 400, data: { error: 'Invalid filter' } };
}
```

`http://plugin.invalid` is used only to parse a relative URL with `new URL()`. It is not the server address. The context does not contain the actual host, headers, cookies, or IP address. The `#` fragment is never sent to the backend.

## Administration routing

`/panel/plugins/example?path=%2Ftools%2Freport` has an empty `suffix`; `/panel/plugins/example/save?path=%2Ftools%2Freport` has `/save`. Every request must contain a `path` parameter naming a stored page assigned to that plugin. The page does not need to be published.

In this example, `context.url` contains the panel address, `basePath` is `/panel/plugins/example`, and `page.href` points to `/tools/report`. `path` selects a page assigned to the plugin, not an arbitrary disk file. Adding `mode=admin` or `admin=true` to a public address grants no privileges.

## Request and response bodies

Public routes accept JSON and text through Fastify parsers. URL-encoded and multipart forms are enabled only in the panel. The request-body limit is 150,000 bytes for public routes and 300,000 bytes for plugin administration routes. The panel photo API has separate limits.

`PluginContext` does not expose `request.file()`. If a plugin accepts files, design an upload using a supported format, such as JSON within an appropriate size limit, or use the engine gallery.

A JSON response is `{ type: 'json', status: 200, data: {...} }`. `status` defaults to 200 and accepts 200–599. Plugin responses cannot set custom headers or cookies, or return streams, binary files, or `Location` redirects.

Handle `HEAD` without writes or other side effects. The HTTP engine omits the response body for these requests.
