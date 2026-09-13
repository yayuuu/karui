---
title: Static content and Edge templates
format: markdown
---
## Markdown code blocks

Surround a code block with three backticks (`` ` ``). Add the language name after the opening fence, for example `ts`, `js`, `json`, `yaml`, `sh`, `html`, `css`, `python`, `sql`, or `edge`. **highlight.js** colors the syntax on both the site and documentation:

````markdown
```ts
const message = "Hello world";
console.log(message);
```
````

Result:

```ts
const message = "Hello world";
console.log(message);
```

`edge` enables HTML/Handlebars rules that recognize tags and brace expressions. With no language, an unknown name, `text`, or `plaintext`, the block keeps its frame but is not highlighted. The engine does not auto-detect languages and skips blocks over 50,000 characters to avoid slowing page rendering.

Code colors follow the light or dark theme. Long lines scroll inside the block, including on phones; they wrap when printed. HTML and JavaScript in a code block are displayed as text, not executed.

Highlighting happens on the server while refreshing the content cache. It needs no browser library, works without JavaScript and during partial navigation, and never changes the Markdown source.

In `context.content.html`, blocks are already highlighted. This does not cover pages with `format: html`, manually inserted HTML, or inline code. The editor stores content without the markup added by highlighting.

## Markdown tables

Use standard Markdown table syntax. The engine gives tables a distinct header, border, and subtle alternating rows that follow the theme. Wide tables scroll horizontally with touch or keyboard instead of stretching the whole page.

```markdown
| Option | State | Count |
| :--- | :---: | ---: |
| `cache` | **Active** | 8 |
| Plugins | Optional | 16 |
```

| Option | State | Count |
| :--- | :---: | ---: |
| `cache` | **Active** | 8 |
| Plugins | Optional | 16 |

Colons in the separator row align a column left, center, or right. Cells may contain links, emphasis, and code. Escape a vertical bar as `\|` so it is not interpreted as a column boundary.

The result is an accessible HTML table that works without JavaScript. It provides no sorting or pagination. Styles apply only to Markdown tables; manually inserted HTML and the source file remain unchanged. A plugin receives the completed table in `context.content.html`. Printed tables wrap their contents instead of clipping them.

## Shared element styling

The engine loads `ui.css` on every page, including the panel and documentation. Text fields, buttons, selects, checkboxes, `fieldset`, `details`, quotations, and separators have default styles that follow the theme. Base selectors have low specificity so plugins can adjust layouts without `!important`.

A plain `<section>` gets no frame or background. Use these shared classes to build views:

| Class | Purpose |
| --- | --- |
| `ui-section` | Transparent section inheriting the text color. |
| `ui-section-heading` | Section heading; choose the size appropriate for the view. |
| `ui-surface` | Transparent padded block with a thin border and rounded corners. |
| `ui-badge` | Small label using the theme accent. |
| `ui-empty` | Empty-state message. |
| `ui-notice` | Message with an accented edge. |

```html
<section class="ui-section ui-surface">
  <h2 class="ui-section-heading">Tasks <span class="ui-badge">Today</span></h2>
  <p class="ui-empty">No tasks are scheduled.</p>
</section>
```

Custom CSS can use `--ui-accent`, `--ui-muted`, `--ui-line`, `--ui-rule`, `--ui-tint`, and `--ui-radius`. Controls use `--ui-control-bg`, `--ui-control-text`, and `--ui-control-border`; interactive states use `--ui-hover` and `--ui-active`. These variables let a theme switch restyle the plugin without JavaScript.

## Plugin position relative to content

Select a plugin in the page editor, then choose “Plugin position relative to content”. The corresponding YAML field is `pluginPlacement`:

| `pluginPlacement` | Behavior |
| --- | --- |
| `after` | Default order: text, gallery, subpage list, plugin. |
| `before` | Page title, plugin, text, gallery, subpage list. |
| `content` | The plugin receives `context.content` and decides how to use it. The engine does not display the text separately. Gallery and subpages retain their settings and appear before the plugin. |

The plugin can access content in every mode; `content` changes only rendering. Without a plugin, the engine displays text regardless of this field.

The engine renders the page heading. The selected order applies to direct visits, partial navigation, and printing, but not to JSON responses.

`context.content.source` contains source without YAML and `context.content.html` contains rendered HTML. A plugin can omit it, place it in its own view, split it, or replace markers:

```ts
const escape = (text: string) => text.replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const html = context.content.html.replaceAll('[[notice]]', escape('Plugin message'));
return { type: 'view', template: 'views/public.edge', data: { html } };
```

Insert the result with `{{{ html }}}`. Triple braces render HTML instead of escaping it. Never use them for unvalidated URL parameters or request data. The Markdown parser allows raw HTML and does not remove dangerous tags—page content and plugin code must come from trusted authors.

## Local views

A handler can return:

```ts
return {
  type: 'view',
  template: 'views/public.edge',
  data: { title: context.page.title, items: ['A', 'B'] },
  client: 'client.ts',
  styles: 'style.css',
};
```

The engine finds `.edge` files in the plugin directory and its subdirectories. `template` is relative to the plugin root and includes `.edge`. Directory and file names may contain ASCII letters, digits, `_`, and `-`. Absolute paths and `..` are forbidden. Hidden directories, `node_modules`, and symbolic links are skipped; only registered views can be used.

Optional `status` sets the HTTP status of a rendered view. A plugin can therefore display an error in the normal page container while returning the correct status, for example `{ type: 'view', template: 'views/not-found.edge', status: 404 }`. The default is 200.

View variables come from the returned `data`. Templates do not automatically receive `context`, `page`, server paths, session data, or CSRF. Pass only what is needed:

```edge
<h2>{{ title }}</h2>
@include('views/partials/list')
```

`views/partials/list.edge`:

```edge
<ul>
  @each(item in items)
    <li>{{ item }}</li>
  @end
</ul>
```

In `@include`, use a path without the extension, relative to the plugin root rather than the including file. Conditions, loops, components, slots, and other Edge directives are available.

The plugin worker has its own Edge instance and cannot access engine views. A handler cannot register global Edge values or helpers. Compute values before returning and pass them in `data`.

## Passing data to the client

Place one element inside the view:

```edge
<div data-context="{{ JSON.stringify(clientContext) }}">
  <button type="button" data-action="next">Next</button>
</div>
```

`clientContext` is a browser-safe object prepared by the handler. Use double braces so Edge escapes special characters in the HTML attribute. The engine reads JSON from the first `[data-context]` in the plugin and sends it as `init.context`; without one, it sends `{}`.

Never send the whole `PluginContext` to the browser: it contains server paths and, in administration, session data.

## CSS and static resources

Return `styles: 'style.css'` to include a stylesheet tied to the plugin version. Administration may use `admin.css`.

Styles are not isolated automatically. Prefix selectors with a plugin class such as `.example-plugin button` so they do not alter the menu or panel.

Place public images, fonts, documents, and other files in the plugin’s `assets/` directory. During compilation, the engine copies them to a versioned directory under `CONTENT_CACHE_DIR/plugins/public`. Edge views receive `pluginAssets`; the backend receives the same mapping as `context.assets`:

```edge
<img src="{{ pluginAssets['images/logo.webp'] }}" alt="Logo">
<a href="{{ pluginAssets['documents/manual.pdf'] }}">Manual</a>
```

```ts
const logoUrl = context.assets['images/logo.webp'];
```

Do not construct these addresses manually. The URL includes the plugin name and compiled artifact key. Administration views point to protected panel routes; public views use public routes, so one template can serve both.

In CSS, reference the source directory relatively. The compiler rewrites it to a versioned URL:

```css
.example-plugin { background-image: url("./assets/images/background.webp"); }
```

External paths, `/media/...`, `data:`, and references outside `assets/` remain unchanged. `@import` is not bundled automatically.

The directory may contain at most 512 files. One file may be up to 32 MiB and the total up to 128 MiB. Path segments allow ASCII letters, digits, dots, `_`, and `-`; the full path may contain up to 240 characters. Hidden files/directories and symbolic links are skipped. A missing `url("./assets/...")` file fails the build instead of publishing broken CSS.

Everything in `assets/` is public. Never store configuration, source code, keys, or user data there. Increase `version` after changing a file; an already-open document retains its previous snapshot URL.

Attach client code through `client`, not a `<script>` tag in HTML. CSP blocks scripts embedded in view content.

Public plugin routes expose only compiled `client.ts`/`client.js`, `style.css`, and the `assets/` snapshot. Backend code, manifests, views, and `node_modules` are not served. `admin.ts`/`admin.js` and `admin.css` are available only through protected panel routes.
