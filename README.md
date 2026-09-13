# Karui

Karui is a lightweight website engine for fast, file-based sites. It is built with TypeScript, Fastify, Edge, and Preact, and runs on Node.js 24.

Pages, navigation, galleries, themes, and settings live in a mounted `content/` directory. The engine itself does not require a database. Plugins may connect to databases or external services when an application needs accounts, orders, search, or other stateful features.

## Quick start with Docker

Requirements: Docker with Compose support.

```sh
cp .env.example .env
docker compose build
docker compose up -d karui
```

Open `http://localhost:3000`. Adjust `PORT` and `CONTENT_PATH` in `.env` when needed. The content directory is mounted at runtime and is not copied into the image.

## Administration account

Create the first administrator interactively:

```sh
docker compose --profile tools run --rm panel-init
```

The command asks for a password without displaying it. The administration panel is available at `/panel`.

For a local installation without Docker, build the engine first and run:

```sh
npm run panel:init -- admin
```

## Plugin dependencies

Plugins live in `content/plugins/<name>` and may have their own `package.json` and lockfile. Install dependencies for every plugin with:

```sh
docker compose --profile tools run --rm plugins-install
```

Without Docker:

```sh
npm run plugins:install
```

Karui compiles plugins on first use. After changing plugin code, views, styles, assets, dependencies, or manifest settings, increase `version` in its `plugin.json`.

## Exporting the default theme

To create an editable copy of the default theme under `content/templates/`:

```sh
docker compose --profile tools run --rm create-template
```

Without Docker:

```sh
npm run create-template
```

Both commands ask for the new template name and never overwrite an existing template.

## Running locally

Requirements: Node.js 24 and npm.

```sh
npm ci
npm run build
CONTENT_DIR=./content CONTENT_CACHE_DIR=/tmp/karui-cache PORT=3000 HOST=127.0.0.1 npm start
```

For development with automatic TypeScript reloads:

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

Or use the dedicated Compose configuration:

```sh
docker compose -f docker-compose.docs.yml up -d --build
```

The complete English guide starts at [docs/pages/start.en.md](docs/pages/start.en.md). Polish and French versions are stored alongside it.

## Useful checks

```sh
npm run typecheck
npm test
npm run build
```

Run all engine checks with:

```sh
npm run check
```
