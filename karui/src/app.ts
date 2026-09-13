import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { containedFile, localizedContent, navigation, type Page } from './content.js';
import { renderPageContent } from './content/code.js';
import { CachedContentRepository } from './content/cache.js';
import { configFromEnv, type Config } from './config.js';
import { PluginRunner } from './plugins.js';
import { createPluginContext } from './plugins/context.js';
import { registerPanel } from './admin/routes.js';
import { GalleryImages, inlineGallery, visibleGallery } from './gallery.js';
import { isPublished, publicContent } from './content/public.js';
import { fragmentType, type PageFragment } from './page-fragment.js';
import { Themes } from './themes/index.js';
import { clientMessages, languageLinks, requestLanguage, Translations } from './i18n.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = ["default-src 'self'", "script-src 'self'", "worker-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: https:", "media-src 'self' https:", "frame-src https://www.youtube.com https://www.youtube-nocookie.com", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'", "form-action 'self'"].join('; ');

export async function buildApp(config: Config = configFromEnv(), logging = false) {
  const app = Fastify({ logger: logging, bodyLimit: 150_000, routerOptions: { maxParamLength: 256 } });
  await app.register(cookie);
  const repository = new CachedContentRepository(config.contentDir, config.contentCacheDir, config.contentRefreshMs,
    error => app.log.warn({ err: error }, 'Content refresh failed; serving the last valid snapshot'));
  app.addHook('onClose', () => repository.close());
  app.addHook('onReady', async () => { repository.start(); });
  const galleryImages = new GalleryImages(config.contentDir);
  await repository.load();
  const assetHash = createHash('sha256');
  for (const name of ['main.js', 'panel.js']) assetHash.update(await readFile(join(root, 'public/assets', name)));
  const themes = new Themes(root, config.contentDir, join(config.contentCacheDir, 'themes'), assetHash.digest('hex'), error => app.log.warn({ err: error }, 'Theme failed; using default'));
  const translations = await Translations.load(join(root, 'lang'));
  const plugins = new PluginRunner({
    timeoutMs: config.pluginTimeoutMs, workers: config.pluginWorkers, maxWorkers: config.pluginMaxWorkers,
    idleMs: config.pluginWorkerIdleMs, memoryLimits: config.pluginMemoryLimits,
    cacheDir: join(config.contentCacheDir, 'plugins'),
  });
  app.addHook('onReady', () => plugins.start());
  app.addHook('onClose', () => plugins.close());
  await app.register(rateLimit, { max: 100_000, timeWindow: '1 minute' });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', policy);
  });
  await app.register(fastifyStatic, { root: join(root, 'public/assets'), prefix: '/assets/', dotfiles: 'deny', maxAge: '1h' });
  app.get('/healthz', async () => { await repository.load(); return { status: 'ok' }; });
  app.get<{ Params: { name: string; key: string; '*': string } }>('/assets/themes/:name/:key/*', async (request, reply) => {
    const asset = await themes.asset(request.params.name, request.params.key, request.params['*']);
    if (!asset) return reply.code(404).send();
    return reply.sendFile(asset.path, asset.root, { maxAge: '1y', immutable: true });
  });
  await registerPanel(app, themes, config, repository, plugins, translations);
  // A photo wall can fetch hundreds of images without exhausting the page/API budget.
  app.get<{ Params: { '*': string } }>('/media/*', { config: { rateLimit: { max: 1200, timeWindow: '1 minute' } } }, async (request, reply) => {
    const mediaRoot = join(config.contentDir, 'media');
    const name = request.params['*'];
    if (!/\.(?:png|jpe?g|webp|gif|mov|mp4|webm|mp3|ogg|woff2|html)$/i.test(name)) return reply.code(404).send();
    const file = await containedFile(mediaRoot, name);
    if (!file) return reply.code(404).send();
    if (name.endsWith('.html')) reply.header('Content-Security-Policy', "sandbox allow-scripts allow-downloads; default-src 'self' https: data: blob:; script-src 'self' https: 'unsafe-inline'; style-src 'self' https: 'unsafe-inline'; object-src 'none'; base-uri 'none'");
    return reply.sendFile(relative(mediaRoot, file), mediaRoot);
  });
  app.get<{ Params: { name: string; key: string; '*': string } }>('/plugin-assets/:name/assets/:key/*', async (request, reply) => {
    const { name, key, '*': path } = request.params;
    if (!/^[a-z0-9-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(key)) return reply.code(404).send();
    const content = publicContent(await repository.load());
    if (![...content.pages.values()].some(page => page.plugin === name)) return reply.code(404).send();
    try {
      const artifact = await plugins.compiler.get(join(config.contentDir, 'plugins', name), key);
      const asset = await plugins.compiler.publicAsset(artifact, path);
      if (!asset) return reply.code(404).send();
      return reply.sendFile(relative(asset.root, asset.file), asset.root, { maxAge: '1y', immutable: true });
    } catch { return reply.code(404).send(); }
  });
  app.get<{ Params: { name: string; file: string }; Querystring: { v?: string } }>('/plugin-assets/:name/:file', async (request, reply) => {
    const { name, file } = request.params;
    if (!/^[a-z0-9-]+$/.test(name) || !['client.ts', 'client.js', 'style.css'].includes(file)) return reply.code(404).send();
    const content = publicContent(await repository.load());
    if (![...content.pages.values()].some((page) => page.plugin === name)) return reply.code(404).send();
    const pluginDir = join(config.contentDir, 'plugins', name);
    try {
      const artifact = await plugins.compiler.get(pluginDir, request.query.v);
      const code = file === 'style.css' ? artifact.styles : artifact.client?.file === file ? artifact.client.code : undefined;
      if (code === undefined) return reply.code(404).send();
      return reply.type(file === 'style.css' ? 'text/css' : 'text/javascript')
        .header('Cache-Control', request.query.v ? 'public, max-age=31536000, immutable' : 'no-cache').send(code);
    } catch (error) { if (request.query.v) return reply.code(404).send(); throw error; }
  });
  app.setErrorHandler(async (error, request, reply) => {
    request.log.error(error);
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    let t = translations.translator('en');
    try {
      const site = (await repository.load()).site;
      const url = new URL(request.url, 'http://karui.local');
      t = translations.translator(requestLanguage(site, url.searchParams.get('lang'), request.headers.cookie, request.headers['accept-language']).language);
    } catch { /* The content error itself may be why this handler is running. */ }
    return reply.code(status).type('text/plain; charset=utf-8').send(t(status >= 500 ? 'The page could not be loaded. Try again later.' : 'Invalid request.'));
  });
  app.all('/*', async (request, reply) => {
    const url = new URL(request.url, 'http://localhost');
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return reply.code(400).send(); }
    if (path === '/index.php') {
      const old = (url.searchParams.get('p') ?? '').replace(/^\//, '');
      const sub = url.searchParams.get('s');
      if (!/^[a-z0-9-]*(?:,[a-z0-9-]+)?$/.test(old) || (sub && !/^[a-z0-9-]+$/.test(sub))) return reply.code(400).send();
      return reply.redirect('/' + old.replace(',', '/') + (sub ? '/' + sub : ''), 301);
    }
    if (/^\/[a-z0-9-]+,[a-z0-9-]+$/.test(path)) return reply.redirect(path.replace(',', '/') + url.search, 301);
    if (path.length > 1 && path.endsWith('/')) return reply.redirect(path.slice(0, -1) + url.search, 301);
    const allContent = await repository.load();
    const locale = requestLanguage(allContent.site, url.searchParams.get('lang'), request.headers.cookie, request.headers['accept-language']);
    if (locale.explicit) reply.setCookie('karui-language', locale.language, { path: '/', sameSite: 'lax', maxAge: 31_536_000, secure: config.panelSecureCookie });
    const t = translations.translator(locale.language);
    const { edge, theme, assetVersion } = await themes.get(allContent.site.theme);
    const selectedContent = localizedContent(publicContent(allContent), locale.language);
    const content = selectedContent;
    const blocked = !isPublished(allContent, path);
    if (blocked && !['GET', 'HEAD'].includes(request.method)) return reply.code(404).send();
    if (!blocked && path === '/' && content.site.home !== '/' && isPublished(allContent, content.site.home)) return reply.redirect(content.site.home, 302);
    for (const [prefix, target] of Object.entries(content.site.redirects)) {
      if (!blocked && path.startsWith(prefix)) return reply.redirect(target + path.slice(prefix.length) + url.search, 301);
    }
    const home = path === '/' && !blocked;
    const selected = blocked ? undefined : content.pages.get(path) ?? [...content.pages.values()].filter((page) => page.plugin && path.startsWith(page.href + '/')).sort((a, b) => b.href.length - a.href.length)[0];
    const sourcePage = selected ?? content.pages.get('/404') ?? { title: t('Error 404'), href: '/404', html: `<br><br><h1 style="text-align:center">404<br>${t('The requested page does not exist.')}</h1><br><br>`, keywords: '', order: 0, gallery: [] } satisfies Page;
    const origin = `${request.protocol}://${request.host}`;
    const visiblePhotos = visibleGallery(sourcePage, origin);
    const galleryPhotos = await galleryImages.describe(sourcePage.gallery);
    const visibleSources = new Set(visiblePhotos.map(photo => photo.src));
    const embeddedGallery = inlineGallery(sourcePage.html, sourcePage.href, galleryPhotos, origin);
    const page = { ...sourcePage, html: embeddedGallery.html, gallery: galleryPhotos.filter(photo => visibleSources.has(photo.src)) };
    if (home) { page.title = content.site.title; page.href = '/'; page.html = ''; }
    let status = home || selected ? 200 : 404;
    let widgetHtml = '', clientUrl = '', styleUrl = '', pluginError = '';
    if (page.plugin && !home) {
      try {
        const result = await plugins.run(createPluginContext({ url: request.url, method: request.method, body: request.body, suffix: path.slice(page.href.length), page, contentRoot: config.contentDir, cacheRoot: config.contentCacheDir, language: locale.language, defaultLanguage: allContent.site.language }));
        if (result.type === 'json') return reply.code(result.status).send(result.data);
        status = result.status;
        widgetHtml = result.html;
        if (result.client) clientUrl = `/plugin-assets/${page.plugin}/${result.client}?v=${result.versionKey}`;
        if (result.styles) styleUrl = `/plugin-assets/${page.plugin}/${result.styles}?v=${result.versionKey}`;
      } catch (error) {
        request.log.error(error, 'Page plugin failed');
        if (path !== page.href || request.method !== 'GET') return reply.code(503).send({ error: t('The plugin is temporarily unavailable.') });
        status = 503;
        pluginError = t('This part of the page is temporarily unavailable. The rest of the site is working normally.');
      }
    } else if (!['GET', 'HEAD'].includes(request.method)) return reply.code(405).header('Allow', 'GET, HEAD').send();
    const nav = navigation(content, home ? { ...page, href: '/' } : page);
    if (home) { nav.submenu = []; nav.children = []; nav.back = ''; }
    const print = ['print', 'pdf'].includes(url.searchParams.get('m') ?? '');
    const footerHtml = content.site.footer ? renderPageContent(content.site.footer, content.site.footerFormat) : '';
    const view = {
      site: { ...content.site, language: locale.language, menu: nav.menu }, page, galleryPhotos, galleryEnabled: page.gallery.length > 0 || embeddedGallery.count > 0, ...nav, home, widgetHtml, clientUrl, styleUrl,
      pluginError, footerHtml, assetVersion, notFound: status === 404, print, theme, t, language: locale.language,
      languageLinks: languageLinks(request.url, content.site.languages, locale.language), clientTranslations: clientMessages(t),
    };
    reply.code(status).header('Cache-Control', 'no-cache').header('Vary', 'Accept, Accept-Language, Cookie');
    if (request.method === 'GET' && request.headers.accept === fragmentType && !print) {
      const fragment: PageFragment = {
        version: 1, assetVersion, title: content.site.title, pageTitle: page.title, keywords: page.keywords,
        href: url.pathname + url.search, home,
        content: await edge.render(home ? 'partials/home' : 'partials/page-content', view),
        submenu: await edge.render('partials/submenu', view), back: nav.back,
        menu: await edge.render('partials/menu', view),
        styles: [...((page.gallery.length || embeddedGallery.count) ? [theme.assets['gallery.css']!] : []), ...(styleUrl ? [styleUrl] : [])],
      };
      return reply.type(fragmentType).send(fragment);
    }
    return reply.type('text/html').send(await edge.render('page', view));
  });
  return app;
}
