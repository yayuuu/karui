---
title: Karui documentation
format: markdown
---
Here you will learn how to create plugins, prepare views, and add interactions and administration settings. You can also open the [working example](/plugins/example) and use it as a starting point.

Karui renders this documentation—the same engine that powers sites built with it. The documentation has its own configuration (`docs/site.yml`), content (`docs/pages`), plugins (`docs/plugins`), and private data (`docs/state`).

## Language versions

With one language, a page uses an `index.md` file. After enabling multiple languages, it uses files such as `index.pl.md`, `index.en.md`, and `index.fr.md`. The panel migrates the filename on the first save, without rewriting all content in bulk. The public page language can be selected with the `?lang=en` parameter.

The menu has one shared structure. Links, nesting, and default-language names remain in `site.yml`. In **Menu**, select the default language to edit the tree, or another language to complete the “Default name / Translation” table. Karui stores these labels in `content/lang/<language>.po`, in the `karui-menu` gettext context.

Each language version of a page has its own gallery metadata. If another language already contains photos, the page editor offers the optional collapsed **Copy gallery from another language** action. The list contains only non-empty source galleries, and image files are shared rather than duplicated.

**Insert into content** stores a gallery photo as `[![Description](photo.small.webp)](photo.large.png)` in Markdown, or as an equivalent linked `<img>` in HTML. Karui opens that preview in a one-photo lightbox and downloads the large image only after it is clicked. The enhancement applies only when the thumbnail and link belong to the same gallery entry. Ordinary Markdown images and standalone `<img>` elements are not changed.

Image metadata, including dimensions and file size, is cached separately for every page and language version under `CONTENT_CACHE_DIR/galleries`. After a restart, the first page request needs one cache-file read instead of checking every image separately. Uploading, deleting, changing a description or order, and copying a gallery invalidate the appropriate file automatically.

## Running locally

From the project directory, after installing dependencies:

```sh
npm run docs:dev
```

Open `http://127.0.0.1:3002`. To build and run the documentation in production mode, use:

```sh
npm run docs:build
npm run docs:start
```

`docs:build` compiles the engine. Markdown pages are processed while the application is running, and the resulting HTML is stored in the cache. The example plugin is compiled when its page is opened for the first time.

## Docker

```sh
docker compose -f docker-compose.docs.yml up -d --build
```

You can change the host port by setting, for example, `DOCS_PORT=3003`. The documentation is available only locally and runs independently of the production container and its data.

The `docs` directory is mounted read-only. The exception is `docs/state`, mounted writable at `/app/content/state`. Grant the container user (UID 1000) write access to that directory. The engine and compiled-plugin caches reside on a RAM disk (tmpfs); the application rebuilds them as needed after the container is recreated.

Documentation files, like the `content` directory, are not copied into the image. You can update content without rebuilding the container: edit files under `docs/pages`, and changes usually appear after about one second. After changing plugin code, increase its version in `plugin.json`.

## Where to begin

1. [Plugin structure](/plugins).
2. [Input data, PluginContext, and routing](/plugins/context).
3. [Page content and Edge templates](/plugins/views).
4. [Web Workers and client communication](/plugins/client).
5. [Protected plugin administration](/plugins/admin).
6. [Dependencies, file storage, cache, and limits](/plugins/runtime).
7. [Working example](/plugins/example) and [testing](/testing).
