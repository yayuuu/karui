---
title: Web Workers and browser interaction
format: markdown
---
Client code runs in a separate module Web Worker. It cannot access `window`, `document`, or page elements. It may use `fetch`, timers, `postMessage`, and `OffscreenCanvas` when the browser and CSP allow them.

To attach a client, return a `client` field pointing to `client.ts` or `client.js` from the view. Administration may similarly use `admin.ts` or `admin.js`. The compiler bundles the file and its dependencies as an ESM package, served from an address containing the version key `?v=...`.

Communication is mediated by the **host**, the part of the engine running in the browser’s main thread. It forwards user events to the worker and executes the worker’s view commands.

## Host → worker messages

```ts
self.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'init') {
    // message.context: JSON from [data-context], not server PluginContext
    // message.canvases: map of transferred OffscreenCanvas objects
    // message.reducedMotion: prefers-reduced-motion at mount time
  }
  if (message.type === 'event' && message.action === 'next') {
    self.postMessage({ type: 'text', selector: '[data-status]', value: 'Done' });
  }
});
```

| Element / event | `type: 'event'` message |
| --- | --- |
| Click on `[data-action]` | `action` from the attribute, optional `value` from `data-value`; the native click action is cancelled. |
| Change on `[data-change]` | `action` from the attribute and current textual `value`. It does not send the whole form. |
| Key inside the plugin | `action: 'key', key`; Enter/Space on `[data-action][role=button]` performs its action. |
| Dialog closed with Escape | `action: 'cancel'`. |
| Pointer on `canvas[data-canvas]` | `action: 'pointerdown'/'pointermove'/'pointerup'`, canvas name; down/move also include `point: [x,y]` in bitmap pixels, clamped to its bounds. |

`pointermove` is sent only while the pointer remains pressed. `pointercancel` and `lostpointercapture` finish that action. A `canvas[data-canvas="surface"]` is passed as `init.canvases.surface` so the worker can render it. If OffscreenCanvas is unavailable, the plugin displays an error.

## Worker → host messages

The host searches only inside the current plugin section. A selector may contain up to 200 characters, and one command affects at most 30 matching elements. The plugin cannot modify the engine error message or surrounding elements.

| `type` | Additional fields and behavior |
| --- | --- |
| `text` | `selector`, `value: string` up to 20,000 characters; sets `textContent`, not HTML. |
| `hidden` | `selector`, `value: boolean`; toggles `hidden`. |
| `class` | `selector`, `name` (lowercase letter followed by letters/digits/hyphens, up to 64), `value: boolean`. |
| `style` | `selector`, `name`, `value: string` shorter than 200 characters, without `url`/`expression`. |
| `attribute` | `selector`, `name`, `value: string` shorter than 2,000 characters. |
| `dialog` | `selector` targeting `<dialog>`, `value: boolean`; calls `showModal()` or `close()`. |
| `list` | `selector`, `items: [{tag, text}]`; replaces element contents. Up to 1,000 items, text up to 1,000 characters. Tags: `li`, `p`, `span`, `div`. |
| `query` | `name`, `value`; changes the current URL parameter and starts engine navigation. No selector. Name `[a-z0-9_-]` up to 64 characters, value up to 200. |

Allowed styles are `transform`, `width`, `height`, `left`, `top`, `opacity`, `pointer-events`, and `transition-duration`.

Allowed attributes are `src`, `href`, `alt`, `title`, `download`, `aria-*`, and `tabindex`. `src` and `href` values must begin with one `/`, not `//`.

The host does not allow setting `innerHTML`, executing arbitrary JavaScript, changing form values, or creating elements outside the supported tag list. For a larger view update, use `query`: the engine fetches the view again. In the panel, this navigation reloads the full page rather than replacing only the content.

## Fetch

The worker can `fetch` plugin routes. Pass `basePath: context.basePath` in client data instead of hard-coding the page address, so the plugin continues to work when assigned elsewhere:

```ts
const response = await fetch(basePath + '/api/save', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: 42 }),
});
if (!response.ok) throw new Error('Save failed');
const result = await response.json();
```

In administration, include the CSRF token and `path` parameter; see [plugin administration](/plugins/admin). Handle connection failures, invalid JSON responses, and timeouts. If a write can be retried, make it safe from duplicate execution.

The worker runs under the same origin as the page. DOM communication restrictions do not protect against deliberately malicious code, so use plugins only from trusted authors.

## Lifecycle and errors

Every second, the host pings the worker to check that it responds. `__pong` handling is added automatically during compilation. If a visible page’s worker does not answer for more than six seconds, it is stopped. Browsers may throttle timers in inactive tabs, so the limit is not enforced there.

A worker may send up to 240 messages per second, including ping replies. An exception, invalid command, or exceeded limit stops the plugin and displays an error. The site menu remains available.

When navigating away or on `pagehide`, the host stops the worker, removes event listeners, and closes dialogs. Returning starts a new instance—client globals are not durable storage.

Catch errors in asynchronous loops and limit expensive computation. A separate thread does not remove the plugin’s responsibility for CPU, GPU, and memory use.
