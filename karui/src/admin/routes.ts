import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Themes } from '../themes/index.js';
import type { Config } from '../config.js';
import { PanelFiles, PanelError } from './files.js';
import { PanelAuth, type Account, type Session } from './auth.js';
import { PanelStore } from './store.js';
import type { ContentRepository } from '../content.js';
import { localizedContent, route } from '../content.js';
import { renderPageContent } from '../content/code.js';
import { join, relative } from 'node:path';
import type { PluginRunner } from '../plugins.js';
import { createPluginContext } from '../plugins/context.js';
import { clientMessages, languageLinks, requestLanguage, type Translations } from '../i18n.js';

export async function registerPanel(app: FastifyInstance, themes: Themes, config: Config, repository: ContentRepository, plugins: PluginRunner, translations: Translations) {
  const files = new PanelFiles(config.contentDir);
  const store = new PanelStore(files, repository);
  const auth = new PanelAuth(files, config.panelSecureCookie);
  await auth.init();
  await app.register(async panel => {
    await panel.register(formbody);
    await panel.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, parts: 5 } });
    const context = new WeakMap<FastifyRequest, { session: Session; account?: Account }>();
    const requestTranslator = async (request: FastifyRequest) => {
      try {
        const { site } = await store.repository.load();
        const url = new URL(request.url, 'http://karui.local');
        return translations.translator(requestLanguage(site, url.searchParams.get('lang'), request.headers.cookie, request.headers['accept-language']).language);
      } catch {
        return translations.translator('en');
      }
    };
    const render = async (request: FastifyRequest, reply: FastifyReply, screen: string, data: Record<string, unknown> = {}) => {
      const current = context.get(request)!;
      const content = await store.repository.load();
      const { site } = content;
      const url = new URL(request.url, 'http://karui.local');
      const locale = requestLanguage(site, url.searchParams.get('lang'), request.headers.cookie, request.headers['accept-language']);
      if (locale.explicit) reply.setCookie('karui-language', locale.language, { path: '/', sameSite: 'lax', maxAge: 31_536_000, secure: config.panelSecureCookie });
      const t = translations.translator(locale.language);
      const localizedSite = localizedContent(content, locale.language).site;
      const { edge, theme, assetVersion } = await themes.get(site.theme);
      const footerHtml = localizedSite.footer ? renderPageContent(localizedSite.footer, localizedSite.footerFormat) : '';
      return reply.type('text/html').send(await edge.render('panel/index', {
        site: { ...localizedSite, language: locale.language }, page: { title: t('Administration panel'), keywords: '', href: '/panel', gallery: [] }, submenu: [],
        back: ['home', 'login'].includes(screen) ? '/' : ['edit', 'new'].includes(screen) ? '/panel/pages' : '/panel', print: false, home: false,
        styleUrl: theme.assets['panel.css'], footerHtml, assetVersion, theme,
        screen, screenTemplate: 'panel/' + screen, user: current.account ?? null, csrf: current.session.csrf, error: '', message: '', t,
        language: locale.language, languageLinks: languageLinks(request.url, site.languages, locale.language), clientTranslations: clientMessages(t), ...data,
      }));
    };
    panel.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex, nofollow');
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      const session = auth.session(request, reply);
      const account = await auth.account(session);
      context.set(request, { session, account });
      const path = request.url.split('?')[0];
      if (!account && !['/panel', '/panel/', '/panel/login'].includes(path!)) {
        const acceptsHtml = String(request.headers.accept ?? '').includes('text/html');
        if (request.headers['sec-fetch-dest'] === 'document' || acceptsHtml) return reply.redirect('/panel', 303);
        if (path?.startsWith('/panel/api/') || path?.startsWith('/panel/plugins/') || path?.startsWith('/panel/plugin-assets/')) return reply.code(401).send({ error: (await requestTranslator(request))('Sign in again.') });
        return reply.redirect('/panel', 303);
      }
    });
    panel.addHook('preValidation', async (request, reply) => {
      if (['GET', 'HEAD'].includes(request.method)) return;
      const current = context.get(request)!;
      const value = request.headers['x-csrf-token'] ?? (request.body as { _csrf?: unknown } | undefined)?._csrf;
      const expected = current.session.csrf;
      if (request.headers['sec-fetch-site'] === 'cross-site' || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || !timingSafeEqual(Buffer.from(value), Buffer.from(expected))) return reply.code(403).send({ error: (await requestTranslator(request))('Invalid form token. Refresh the page.') });
      if (config.panelOrigin && request.headers.origin && request.headers.origin !== config.panelOrigin) return reply.code(403).send({ error: (await requestTranslator(request))('Request origin is not allowed.') });
    });
    panel.setErrorHandler(async (error, request, reply) => {
      const known = error instanceof PanelError || error instanceof z.ZodError;
      const status = error instanceof PanelError ? error.statusCode : error instanceof z.ZodError ? 400 : (error as { statusCode?: number }).statusCode ?? 500;
      const messageId = error instanceof z.ZodError ? 'Invalid form data.' : known ? error.message : status === 413 ? 'The file is too large (maximum 10 MB).' : 'The operation could not be completed.';
      const message = (await requestTranslator(request))(messageId);
      if (!known) request.log.error(error, 'Panel request failed');
      reply.code(status);
      if (request.url.split('?')[0] === '/panel/login') return render(request, reply, 'login', { error: message, configured: true });
      return reply.send({ error: message });
    });
    panel.get('/', async (request, reply) => {
      const current = context.get(request)!;
      if (!current.account) return render(request, reply, 'login', { configured: (await auth.accounts()).length > 0 });
      const { pages } = await store.repository.load();
      return render(request, reply, 'home', { pageCount: pages.size, photoCount: [...pages.values()].reduce((sum, page) => sum + page.gallery.length, 0) });
    });
    panel.post('/login', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
      const body = z.object({ login: z.string().max(48), password: z.string().max(1024) }).parse(request.body);
      await auth.login(request, reply, body.login, body.password);
      return reply.redirect('/panel', 303);
    });
    panel.post('/logout', async (request, reply) => { auth.logout(request, reply); return reply.redirect('/panel', 303); });
    panel.get('/pages', async (request, reply) => {
      const { pages, site } = await store.repository.load();
      return render(request, reply, 'pages', { pages: [...pages.values()].sort((a, b) => a.href.localeCompare(b.href, site.language)) });
    });
    panel.get('/new', async (request, reply) => {
      const { pages } = await store.repository.load();
      const parent = z.object({ parent: z.string().default('/') }).parse(request.query).parent;
      return render(request, reply, 'new', { pages: [...pages.values()], parent });
    });
    panel.get('/page', async (request, reply) => {
      const { path, language } = z.object({ path: z.string(), language: z.string().optional() }).parse(request.query);
      const edit = await store.page(path, language);
      const { pages, site, translations: pageTranslations } = await store.repository.load();
      let pluginAdmin = '';
      if (edit.page.plugin) {
        try {
          if ((await plugins.compiler.manifest(join(config.contentDir, 'plugins', edit.page.plugin))).admin) pluginAdmin = `/panel/plugins/${edit.page.plugin}?path=${encodeURIComponent(path)}&language=${encodeURIComponent(edit.language)}`;
        } catch (error) { request.log.warn(error, 'Cannot read plugin administration manifest'); }
      }
      const childPages = [...pages.values()].filter(page => page.href.slice(0, page.href.lastIndexOf('/')) === path);
      const children = (await Promise.all(childPages.map(async page => {
        const child = await store.page(page.href, edit.language);
        return { ...child.page, revision: child.revision };
      }))).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, site.language));
      const gallerySources = [...(pageTranslations?.get(path) ?? [])]
        .map(([variantLanguage, page]) => ({ language: variantLanguage || site.language, photos: page.gallery.length }))
        .filter(source => source.language !== edit.language && source.photos > 0)
        .filter((source, index, sources) => sources.findIndex(candidate => candidate.language === source.language) === index)
        .sort((a, b) => a.language.localeCompare(b.language));
      return render(request, reply, 'edit', { edit, pluginAdmin, plugins: await store.plugins(), children, gallerySources });
    });
    // These endpoints inherit panel authentication, no-store and CSRF hooks.
    panel.get<{ Params: { name: string; key: string; '*': string } }>('/plugin-assets/:name/assets/:key/*', async (request, reply) => {
      const { name, key, '*': path } = request.params;
      if (!/^[a-z0-9-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(key)) throw new PanelError('File not found.', 404);
      const content = await repository.load();
      if (![...content.pages.values()].some(page => page.plugin === name)) throw new PanelError('Plugin not found.', 404);
      try {
        const artifact = await plugins.compiler.get(join(config.contentDir, 'plugins', name), key);
        if (!artifact.admin) throw new Error('No admin view');
        const asset = await plugins.compiler.publicAsset(artifact, path);
        if (!asset) throw new Error('No asset');
        return reply.sendFile(relative(asset.root, asset.file), asset.root, { cacheControl: false });
      } catch { throw new PanelError('Plugin file not found.', 404); }
    });
    panel.get<{ Params: { name: string; file: string }; Querystring: { v?: string } }>('/plugin-assets/:name/:file', async (request, reply) => {
      const { name, file } = request.params;
      if (!/^[a-z0-9-]+$/.test(name)) throw new PanelError('Plugin not found.', 404);
      if (!['client.ts', 'client.js', 'style.css', 'admin.ts', 'admin.js', 'admin.css'].includes(file)) throw new PanelError('File not found.', 404);
      const content = await repository.load();
      if (![...content.pages.values()].some(page => page.plugin === name)) throw new PanelError('Plugin not found.', 404);
      try {
        const artifact = await plugins.compiler.get(join(config.contentDir, 'plugins', name), request.query.v);
        if (!artifact.admin) throw new Error('No admin view');
        const code = file === 'style.css' ? artifact.styles : file === 'admin.css' ? artifact.adminStyles
          : artifact.adminClient?.file === file ? artifact.adminClient.code : artifact.client?.file === file ? artifact.client.code : undefined;
        if (code === undefined) throw new Error('No asset');
        return reply.type(file.endsWith('.css') ? 'text/css' : 'text/javascript').send(code);
      } catch { throw new PanelError('Plugin file not found.', 404); }
    });
    const pluginAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, '*': suffix = '' } = z.object({ name: z.string().regex(/^[a-z0-9-]+$/), '*': z.string().optional() }).parse(request.params);
      const { path, language } = z.object({ path: route, language: z.string().optional() }).parse(request.query);
      const edit = await store.page(path, language);
      if (edit.page.plugin !== name) throw new PanelError('The plugin is not assigned to this page.', 404);
      const current = context.get(request)!;
      const account = await auth.account(current.session);
      if (!account) throw new PanelError('The session has expired.', 401);
      const pluginDir = join(config.contentDir, 'plugins', name);
      if (!(await plugins.compiler.manifest(pluginDir)).admin) throw new PanelError('The plugin does not provide an administration view.', 404);
      const basePath = `/panel/plugins/${name}`;
      try {
        const result = await plugins.run(createPluginContext({
          url: request.url, method: request.method, body: request.body, suffix: suffix ? '/' + suffix : '',
          basePath, page: edit.page, contentRoot: config.contentDir,
          language: edit.language, defaultLanguage: (await repository.load()).site.language,
          admin: { login: account.login, role: account.role, csrf: current.session.csrf },
        }));
        if (result.type === 'json') return reply.code(result.status).send(result.data);
        reply.code(result.status);
        const asset = (file: string) => `/panel/plugin-assets/${name}/${file}?v=${result.versionKey}`;
        return render(request, reply, 'plugin', {
          edit, pluginName: name, widgetHtml: result.html, pluginError: '',
          clientUrl: result.client ? asset(result.client) : '', pluginStyleUrl: result.styles ? asset(result.styles) : '',
          back: '/panel/page?path=' + encodeURIComponent(path),
        });
      } catch (error) {
        request.log.error(error, 'Administrative plugin failed');
        return reply.code(503).send({ error: (await requestTranslator(request))('The plugin is temporarily unavailable. The panel is still working.') });
      }
    };
    panel.get('/plugins', async (request, reply) => {
      const { pages, site } = await store.repository.load();
      const entries = await Promise.all((await store.plugins()).map(async name => {
        const usedBy = [...pages.values()]
          .filter(page => page.plugin === name)
          .sort((a, b) => a.title.localeCompare(b.title, site.language) || a.href.localeCompare(b.href, site.language))
          .map(page => ({ title: page.title, href: page.href, published: page.published !== false }));
        try {
          const manifest = await plugins.compiler.manifest(join(config.contentDir, 'plugins', name));
          return { name, ...manifest, usedBy, error: '' };
        } catch (error) {
          request.log.warn(error, `Cannot read plugin manifest: ${name}`);
          return { name, version: '—', concurrent: false, admin: false, usedBy, error: (await requestTranslator(request))('plugin.json could not be read.') };
        }
      }));
      return render(request, reply, 'plugins', { plugins: entries });
    });
    panel.all('/plugins/:name', { bodyLimit: 300_000 }, pluginAdmin);
    panel.all('/plugins/:name/*', { bodyLimit: 300_000 }, pluginAdmin);
    panel.get('/menu', async (request, reply) => {
      const { language } = z.object({ language: z.string().optional() }).parse(request.query);
      const { pages } = await store.repository.load();
      return render(request, reply, 'menu', { menu: await store.menu(language), pages: [...pages.values()] });
    });
    panel.get('/accounts', async (request, reply) => {
      const actor = context.get(request)!.account!;
      const accounts = (await auth.accounts()).filter(account => actor.role === 'owner' || actor.login === account.login).map(({ login, role }) => ({ login, role }));
      return render(request, reply, 'accounts', { accounts });
    });
    panel.get('/settings', async (request, reply) => {
      const { language } = z.object({ language: z.string().optional() }).parse(request.query);
      const { pages, site } = await store.repository.load();
      return render(request, reply, 'settings', {
        settings: await store.settings(language), themes: await themes.list(),
        pages: [...pages.values()].filter(page => page.published !== false).sort((a, b) => a.title.localeCompare(b.title, site.language)),
      });
    });
    panel.get('/themes', (_request, reply) => reply.redirect('/panel/settings', 303));
    const mutation = (path: string, handler: (request: FastifyRequest, account: Account) => Promise<unknown>) => {
      panel.post(path, { bodyLimit: 300_000 }, async (request, reply) => {
        const result = await files.run(async () => {
          const actor = await auth.account(context.get(request)!.session);
          if (!actor) throw new PanelError('The session has expired. Sign in again.', 401);
          return handler(request, actor);
        });
        return reply.send({ ok: true, ...result as object });
      });
    };
    mutation('/api/pages/create', request => store.createPage(request.body));
    mutation('/api/pages/save', request => store.savePage(request.body));
    mutation('/api/pages/subpage-order', request => store.saveSubpageOrder(request.body));
    mutation('/api/pages/delete', request => { const body = z.object({ path: z.string(), revision: z.string(), language: z.string().optional() }).parse(request.body); return store.deletePage(body.path, body.revision, body.language); });
    mutation('/api/menu', request => store.saveMenu(request.body));
    mutation('/api/menu/translations', request => store.saveMenuTranslations(request.body));
    mutation('/api/settings', async request => {
      const input = z.object({ theme: z.string() }).passthrough().parse(request.body);
      try { await themes.validate(input.theme); } catch { throw new PanelError('The selected theme could not be prepared.'); }
      await store.saveSettings(request.body);
    });
    mutation('/api/settings/translations', request => store.saveLocalizedSettings(request.body));
    mutation('/api/photos/change', request => store.photo(request.body));
    mutation('/api/photos/copy', request => store.copyGallery(request.body));
    mutation('/api/accounts/save', async (request, actor) => {
      const body = z.object({ login: z.string(), password: z.string(), confirmation: z.string(), create: z.boolean() }).parse(request.body);
      await auth.saveAccount(actor, body, body.create);
      return { loggedOut: actor.login === body.login };
    });
    mutation('/api/accounts/delete', async (request, actor) => { const body = z.object({ login: z.string() }).parse(request.body); await auth.deleteAccount(actor, body.login); });
    mutation('/api/photos/upload', async request => {
      const query = z.object({ path: z.string(), language: z.string().optional(), revision: z.string(), alt: z.string().max(500).default('') }).parse(request.query);
      const file = await request.file();
      if (!file) throw new PanelError('Choose an image.');
      const buffer = await file.toBuffer();
      if (file.file.truncated) throw new PanelError('The file is too large (maximum 10 MB).', 413);
      return store.upload(query.path, query.language, query.revision, buffer, query.alt);
    });
  }, { prefix: '/panel' });
}
