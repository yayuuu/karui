# Karui

Karui is a lightweight website engine for fast, file-based sites. It is built
with TypeScript, Fastify, Edge, and Preact, and runs on Node.js 24.

Pages, navigation, galleries, themes, plugins, and settings live in a mounted
`content/` directory. The engine itself does not require a database. Plugins
may connect to databases or external services when a site needs accounts,
orders, search, or other stateful features.

## Run from Docker Hub

This is the recommended way to run Karui. It requires Docker with Compose
support, but does not require cloning or building the engine.

Create a directory for the site and save the following file as `compose.yml`:

```yaml
services:
  karui:
    image: yayuuu/karui:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      CONTENT_DIR: /app/content
      CONTENT_CACHE_DIR: /var/cache/karui
      PANEL_SECURE_COOKIE: "false"
    volumes:
      - ./content:/app/content
    tmpfs:
      - /var/cache/karui
```

Start Karui:

```sh
docker compose up -d
```

Open `http://localhost:3000`. Set `PANEL_SECURE_COOKIE` to `true` when the site
is served through HTTPS. Docker creates the mounted `content/` directory when it
does not exist, and Karui makes it writable by its unprivileged application
user before startup. The directory contains the complete site configuration and
data; it is never copied into the image.

To update Karui:

```sh
docker compose pull
docker compose up -d
```

Replace `latest` with a release tag such as `1.0.1` when a deployment should
remain pinned to a specific version.

## Create an administrator

Create or update the `admin` account interactively using the Docker Hub image:

```sh
docker compose run --rm karui node scripts/panel-account.ts admin
```

The command asks for a password without displaying it. The administration panel
is available at `/panel`.

## Install plugin dependencies

Plugins live in `content/plugins/<name>` and may provide their own `package.json`
and lockfile. Install dependencies for every plugin using the same mounted
content directory:

```sh
docker compose run --rm \
  -e npm_config_cache=/tmp/npm-cache \
  karui node scripts/install-plugins.ts
```

Karui compiles plugins on first use. After changing plugin code, views, styles,
assets, dependencies, or manifest settings, increase `version` in its
`plugin.json`.

## Export the default theme

Create an editable copy of the built-in default theme under
`content/templates/`:

```sh
docker compose run --rm karui node scripts/create-template.ts
```

The command asks for the new template name and never overwrites an existing
template.

## Build the image locally

Building from source is a secondary option intended for Karui development and
testing unreleased revisions:

```sh
git clone https://github.com/yayuuu/karui.git
cd karui
cp .env.example .env
docker compose up -d --build karui
```

The repository Compose configuration also exposes named tool services:

```sh
docker compose --profile tools run --rm panel-init
docker compose --profile tools run --rm plugins-install
docker compose --profile tools run --rm create-template
```

## Local development

Local development requires Node.js 24 and npm:

```sh
npm ci
npm run build
CONTENT_DIR=./content CONTENT_CACHE_DIR=/tmp/karui-cache PORT=3000 HOST=127.0.0.1 npm start
```

Run the development server with automatic TypeScript reloads:

```sh
CONTENT_DIR=./content CONTENT_CACHE_DIR=/tmp/karui-cache PORT=3000 HOST=127.0.0.1 npm run dev
```

## Documentation

Run the documentation development server:

```sh
npm ci
npm run docs:dev
```

Open `http://127.0.0.1:3002`.

To run the production documentation build locally:

```sh
npm run docs:build
npm run docs:start
```

Alternatively, use its dedicated Compose configuration:

```sh
docker compose -f docker-compose.docs.yml up -d --build
```

The complete English guide starts at
[docs/pages/start.en.md](docs/pages/start.en.md). Polish and French versions are
stored alongside it.

## Checks

```sh
npm run check
```

## License

Karui is available under the [BSD 3-Clause License](LICENSE).
