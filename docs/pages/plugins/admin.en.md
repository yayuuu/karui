---
title: Plugin administration
format: markdown
---
## Enabling administration

Add `"admin": true` to `plugin.json` and increase `version`. The editor of an assigned page will show a “Plugin administration settings” link. If you have only just selected the plugin, save the page first—the link uses the stored assignment.

The same handler serves both modes:

```ts
export default async function render(context) {
  if (context.mode === 'admin') return renderAdmin(context);
  return renderPublic(context);
}
```

The engine sets the mode after validating the panel session. `context.admin` contains login, role, and CSRF data, but not the password or cookie. Both panel roles (`owner` and `admin`) may open an assigned plugin’s administration. For an owner-only action, check `context.admin.role === 'owner'` in the plugin.

Administration uses a separate address and does not run when the public page or its editor opens. The plugin needs a valid `admin: true` manifest and must be assigned to the requested page. The page itself may be unpublished.

## Form without JavaScript

```ts
const action = context.basePath + '?path=' + encodeURIComponent(context.page.href);
return {
  type: 'view', template: 'views/admin.edge',
  data: { action, csrf: context.admin.csrf, message: '' },
  styles: 'admin.css',
};
```

```edge
<form method="post" action="{{ action }}">
  <input type="hidden" name="_csrf" value="{{ csrf }}">
  <label>Message <input name="message" value="{{ message }}" maxlength="200"></label>
  <button type="submit">Save</button>
</form>
```

For `POST`, validate `context.method`, `suffix`, and `context.body`. After saving, return a confirmation view or JSON. Never write data for `GET` or `HEAD`.

The panel checks `_csrf` before invoking the handler. For a normal form POST, do not add `data-action` to the submit button; that attribute sends the click to the client worker.

## Administration interactions

Return `client: 'admin.ts'` to attach an administration Web Worker. It has no direct DOM access, just like the public client. Code may be shared with `client.ts`, but secrets must never be included. Check authorization on the server—hiding a button does not block an action.

Pass only required data to `[data-context]`, for example `{ endpoint, csrf }`:

```ts
const endpoint = context.basePath + '/save?path=' + encodeURIComponent(context.page.href);
const response = await fetch(endpoint, {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  body: JSON.stringify({ message: 'New message' }),
});
```

Use the same origin. The browser automatically includes the HttpOnly session cookie; the worker neither needs nor can read it. Pass the CSRF token only to the administration client. After the session expires or the user logs out, requests return 401; reload and sign in again.

## Protection and isolation

`/panel/plugins/...` and `/panel/plugin-assets/...` use session checks, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, and CSP. Every method other than `GET` and `HEAD` requires CSRF. Cross-site requests are blocked; with `PANEL_ORIGIN`, the `Origin` header is also checked.

The public `/plugin-assets` route never serves `admin.ts`, `admin.js`, or `admin.css`. URL parameters such as `mode`, `admin`, and `path` do not grant privileges; rely on engine-provided mode and session data.

Keep private files out of `/media` and never expose `context.admin` through a public API. Administration uses the same worker pool, timeout, and concurrency rules as public code. A plugin failure returns 503 without stopping the panel.

A worker can terminate hung code but does not restrict filesystem permissions. Plugins can read anything available to the process user, so backend code, HTML, and styles must come from trusted authors.

## Documentation-only example account

Locally:

```sh
CONTENT_DIR=./docs npm run panel:init -- docs-admin
```

In the documentation container:

```sh
docker compose -f docker-compose.docs.yml exec docs node scripts/panel-account.ts docs-admin
```

Build the engine first. The command asks for a password; create a separate documentation account instead of copying a production account. Sign in at `/panel`, then open the [example administration](/panel/plugins/example?path=%2Fdemo).

Documentation and plugin files are read-only in the Docker configuration. Example state and accounts are stored in the separately mounted `docs/state`. Edit documentation content on the host; the panel cannot save it in this mode.
