import { readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { stringify, parse, parseDocument } from 'yaml';
import sharp from 'sharp';
import { z } from 'zod';
import { ContentRepository, flattenMenu, galleryVisibility, languageCode, pluginPlacement, metadata, parsePage, photoSchema, route, siteSchema, siteTranslationSchema, type Page } from '../content.js';
import { contentFormats } from '../content/format.js';
import { menuMessageIds, parseMenuTranslations, updateMenuCatalog } from '../content/menu-translations.js';
import { PanelFiles, PanelError, digest } from './files.js';

const pageInput = z.object({ path: route, language: languageCode.optional(), revision: z.string(), title: z.string(), keywords: z.string().default(''), order: z.coerce.number().int().nonnegative(), body: z.string().max(200_000), plugin: z.string().default(''), pluginPlacement: pluginPlacement.optional(), showPrint: z.boolean().optional(), showPdf: z.boolean().optional(), showSubpages: z.boolean().optional(), format: z.enum(contentFormats).optional(), published: z.boolean().optional(), galleryVisibility: galleryVisibility.optional() });
const subpageOrderInput = z.object({
  parent: route, language: languageCode.optional(),
  children: z.array(z.object({ path: route, revision: z.string(), order: z.coerce.number().int().nonnegative() })).max(500),
});
const languageList = z.string().max(720).transform(value => value.split(',').map(code => languageCode.parse(code)).filter(Boolean)).pipe(z.array(languageCode).min(1).max(20)).superRefine((languages, context) => {
  if (new Set(languages).size !== languages.length) context.addIssue({ code: 'custom', message: 'Language codes cannot be repeated.' });
});
const settingsInput = z.object({
  revision: z.string(), theme: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  title: z.string().min(1).max(200), home: route,
  language: languageCode.default('en'), languages: languageList, description: z.string().max(500).default(''),
  brandName: z.string().max(200).default(''), tagline: z.string().max(300).default(''),
  logo: z.string().max(2000).default(''), favicon: z.string().max(2000).default(''),
  showBrandName: z.boolean().default(false), footer: z.string().max(100_000).default(''),
  footerFormat: z.enum(contentFormats).default('markdown'),
}).superRefine((settings, context) => {
  if (!settings.languages.includes(settings.language)) context.addIssue({ code: 'custom', path: ['languages'], message: 'The available language list must include the default language.' });
});
const localizedSettingsInput = z.object({
  language: languageCode,
  revision: z.string(),
  siteRevision: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).default(''),
  brandName: z.string().max(200).default(''),
  tagline: z.string().max(300).default(''),
  footer: z.string().max(100_000).default(''),
});
const parentPath = (path: string) => path.lastIndexOf('/') <= 0 ? '/' : path.slice(0, path.lastIndexOf('/'));
function splitSource(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw new PanelError('Page metadata is missing.');
  return { document: parseDocument(match[1]!), body: match[2]! };
}

export class PanelStore {
  constructor(readonly files: PanelFiles, readonly repository = new ContentRepository(files.root)) {}
  async plugins() {
    const entries = await readdir(await this.files.path('plugins'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    return entries.filter(entry => entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name)).map(entry => entry.name).filter(name => name !== 'gallery').sort();
  }
  async page(path: string, language?: string) {
    const content = await this.repository.load();
    const href = route.parse(path), selectedLanguage = languageCode.parse(language ?? content.site.language);
    if (!content.site.languages.includes(selectedLanguage)) throw new PanelError('This language is not available for the site.', 400);
    const variants = content.translations?.get(href);
    const canonical = content.pages.get(href);
    if (!variants || !canonical?.sourceFile || !canonical.baseFile) throw new PanelError('Page not found.', 404);
    const multilingual = content.site.languages.length > 1;
    const direct = multilingual ? variants.get(selectedLanguage) : variants.get('');
    const page = direct ?? (selectedLanguage === content.site.language ? variants.get('') : undefined)
      ?? variants.get(content.site.language) ?? variants.get('') ?? variants.values().next().value;
    if (!page?.sourceFile) throw new PanelError('The requested language version was not found.', 404);
    const targetSourceFile = canonical.baseFile.replace(/\.md$/, multilingual ? `.${selectedLanguage}.md` : '.md');
    const migration = !direct && selectedLanguage === content.site.language
      && ((multilingual && variants.get('') === page) || (!multilingual && variants.get(content.site.language) === page));
    const file = 'pages/' + page.sourceFile;
    const source = (await this.files.read(file)).toString();
    // The revision and editable metadata must describe the same on-disk file,
    // including external edits made since the last background cache refresh.
    return {
      page: { ...parsePage(source, page.href), sourceFile: page.sourceFile, baseFile: canonical.baseFile, language: selectedLanguage },
      file, targetFile: 'pages/' + targetSourceFile, migration, inherited: !direct && !migration,
      language: selectedLanguage, languages: content.site.languages, source, revision: digest(source), ...splitSource(source),
    };
  }
  async savePage(value: unknown) {
    const input = pageInput.parse(value);
    const original = await this.page(input.path, input.language);
    await this.files.checkRevision(original.file, input.revision);
    const document = original.document;
    document.set('title', input.title); document.set('keywords', input.keywords); document.set('order', input.order);
    for (const field of ['format', 'published', 'galleryVisibility', 'pluginPlacement'] as const) {
      if (input[field] !== undefined) document.set(field, input[field]);
    }
    for (const option of ['showPrint', 'showPdf', 'showSubpages'] as const) {
      if (input[option] !== undefined) document.set(option, input[option]);
    }
    if (input.plugin) {
      if (!(await this.plugins()).includes(input.plugin)) throw new PanelError('Unknown plugin.');
      document.set('plugin', input.plugin);
    } else document.delete('plugin');
    const source = `---\n${document.toString()}---\n${input.body}`;
    metadata.parse(document.toJSON()); parsePage(source, input.path);
    await this.files.write(original.targetFile, source);
    if (original.migration && original.file !== original.targetFile) await this.files.remove(original.file);
    this.repository.invalidate();
    return { path: input.path, language: original.language };
  }
  async saveSubpageOrder(value: unknown) {
    const input = subpageOrderInput.parse(value);
    if (new Set(input.children.map(child => child.path)).size !== input.children.length) throw new PanelError('The same subpage occurs more than once in the list.');
    const prepared = [];
    for (const child of input.children) {
      if (parentPath(child.path) !== input.parent) throw new PanelError('The list contains a page outside the selected section.');
      const original = await this.page(child.path, input.language);
      await this.files.checkRevision(original.file, child.revision);
      original.document.set('order', child.order);
      const source = `---\n${original.document.toString()}---\n${original.body}`;
      metadata.parse(original.document.toJSON());
      parsePage(source, child.path);
      prepared.push({ file: original.file, path: child.path, order: child.order, source, revision: digest(source) });
    }
    for (const child of prepared) await this.files.write(child.file, child.source);
    if (prepared.length) this.repository.invalidate();
    return { children: prepared.map(({ path, order, revision }) => ({ path, order, revision })) };
  }
  async createPage(value: unknown) {
    const input = z.object({ title: z.string().min(1).max(300), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), parent: route }).parse(value);
    const path = (input.parent === '/' ? '' : input.parent) + '/' + input.slug;
    route.parse(path);
    if (['panel', 'media', 'assets', 'plugin-assets', 'healthz', 'index'].includes(path.split('/')[1]!) || input.slug === 'index') throw new PanelError('This address is reserved by the engine.');
    const { pages, site } = await this.repository.load();
    if (pages.has(path)) throw new PanelError('A page already exists at this address.', 409);
    if (input.parent !== '/' && !pages.has(input.parent)) throw new PanelError('Parent page not found.');
    const suffix = site.languages.length > 1 ? `.${site.language}` : '';
    await this.files.write(`pages${path}/index${suffix}.md`, `---\n${stringify({ title: input.title, keywords: '', order: 0, showPrint: false, showPdf: false, showSubpages: true, format: 'markdown', published: true, galleryVisibility: 'all' })}---\n`);
    this.repository.invalidate();
    return { path };
  }
  async deletePage(path: string, revision: string, language?: string) {
    const original = await this.page(path, language);
    await this.files.checkRevision(original.file, revision);
    const content = await this.repository.load();
    if (content.site.home === path || flattenMenu(content.site.menu).some(item => item.href === path)) throw new PanelError('Remove links to this page from the menu and home page settings first.', 409);
    if ([...content.pages.keys()].some(href => href.startsWith(path + '/'))) throw new PanelError('Remove the subpages first. They are not deleted automatically.', 409);
    const variants = content.translations?.get(path);
    const sources = [];
    for (const page of variants?.values() ?? []) {
      if (!page.sourceFile) continue;
      const file = 'pages/' + page.sourceFile;
      sources.push({ file, source: (await this.files.read(file)).toString() });
    }
    const backup = 'state/panel/trash/' + Date.now() + '-' + randomUUID() + '.json';
    await this.files.write(backup, JSON.stringify({ type: 'page', source: sources[0]?.source ?? '', translations: sources }));
    for (const source of sources) await this.files.remove(source.file);
    this.repository.invalidate();
    return { backup };
  }
  async menu(language?: string) {
    const source = await this.files.read('site.yml').catch(error => { if (error.code === 'ENOENT') return Buffer.from(''); throw error; });
    const site = siteSchema.parse(parse(source.toString()) ?? {});
    const selectedLanguage = languageCode.parse(language ?? site.language);
    if (!site.languages.includes(selectedLanguage)) throw new PanelError('This language is not available for the site.', 400);
    const catalog = selectedLanguage === site.language ? Buffer.from('') : await this.files.read(`lang/${selectedLanguage}.po`).catch(error => {
      if (error.code === 'ENOENT') return Buffer.from('');
      throw error;
    });
    const translated = parseMenuTranslations(catalog);
    return {
      site,
      revision: digest(source),
      language: selectedLanguage,
      defaultLanguage: site.language,
      languages: site.languages,
      translationRevision: digest(catalog),
      translations: menuMessageIds(site.menu).map(source => ({ source, translation: translated.get(source) ?? '' })),
    };
  }
  async settings(language?: string) {
    const source = await this.files.read('site.yml').catch(error => { if (error.code === 'ENOENT') return Buffer.from(''); throw error; });
    const site = siteSchema.parse(parse(source.toString()) ?? {});
    const selectedLanguage = languageCode.parse(language ?? site.language);
    if (!site.languages.includes(selectedLanguage)) throw new PanelError('This language is not available for the site.', 400);
    const localized = selectedLanguage === site.language ? Buffer.from('') : await this.files.read(`site.${selectedLanguage}.yml`).catch(error => {
      if (error.code === 'ENOENT') return Buffer.from('');
      throw error;
    });
    const translation = selectedLanguage === site.language ? {} : siteTranslationSchema.parse(parse(localized.toString()) ?? {});
    return {
      site: { ...site, ...translation },
      language: selectedLanguage,
      defaultLanguage: site.language,
      languages: site.languages,
      revision: selectedLanguage === site.language ? digest(source) : digest(localized),
      siteRevision: digest(source),
      inherited: selectedLanguage !== site.language && !localized.length,
    };
  }
  private async siteSource(revision: string) {
    const source = await this.files.read('site.yml').catch(error => { if (error.code === 'ENOENT') return Buffer.from(''); throw error; });
    if (digest(source) !== revision) throw new PanelError('Settings changed after opening the form. Refresh the page before saving.', 409);
    return source.toString();
  }
  async saveSettings(value: unknown) {
    const input = settingsInput.parse(value);
    const content = await this.repository.load();
    if (input.home !== '/') {
      const page = content.pages.get(input.home);
      if (!page || page.published === false) throw new PanelError('The home page must be a published page.', 409);
    }
    const document = parseDocument(await this.siteSource(input.revision));
    for (const field of ['theme', 'title', 'home', 'language', 'showBrandName', 'footerFormat'] as const) document.set(field, input[field]);
    document.set('languages', input.languages);
    for (const field of ['description', 'brandName', 'tagline', 'logo', 'favicon', 'footer'] as const) {
      if (input[field]) document.set(field, input[field]); else document.delete(field);
    }
    const site = siteSchema.parse(document.toJSON());
    if (site.theme !== input.theme) throw new PanelError('Invalid theme.');
    await this.files.write('site.yml', document.toString());
    this.repository.invalidate();
  }
  async saveLocalizedSettings(value: unknown) {
    const input = localizedSettingsInput.parse(value);
    const source = await this.siteSource(input.siteRevision);
    const site = siteSchema.parse(parse(source) ?? {});
    if (input.language === site.language) throw new PanelError('The default language uses the main site settings file.');
    if (!site.languages.includes(input.language)) throw new PanelError('This language is not available for the site.');
    const file = `site.${input.language}.yml`;
    const localized = await this.files.read(file).catch(error => {
      if (error.code === 'ENOENT') return Buffer.from('');
      throw error;
    });
    if (digest(localized) !== input.revision) throw new PanelError('The localized site settings changed after opening the form. Refresh the page before saving.', 409);
    const document = parseDocument(localized.toString());
    for (const field of ['title', 'description', 'brandName', 'tagline', 'footer'] as const) document.set(field, input[field]);
    siteTranslationSchema.parse(document.toJSON());
    await this.files.write(file, document.toString());
    this.repository.invalidate();
  }
  async saveMenu(value: unknown) {
    const input = z.object({ menu: z.unknown(), revision: z.string() }).parse(value);
    let count = 0;
    const checkTree = (items: unknown, depth = 0) => {
      if (depth > 8) throw new PanelError('The menu may have at most 9 levels.');
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (++count > 200) throw new PanelError('The menu may contain at most 200 items.');
        if (item && typeof item === 'object' && Array.isArray(item.children) && item.children.length) checkTree(item.children, depth + 1);
      }
    };
    checkTree(input.menu);
    const source = await this.siteSource(input.revision);
    const document = parseDocument(source); document.set('menu', input.menu);
    const site = siteSchema.parse(document.toJSON());
    const items = flattenMenu(site.menu);
    if (items.length > 200) throw new PanelError('The menu may contain at most 200 items.');
    const { pages } = await this.repository.load();
    if (items.some(item => item.href.startsWith('/') && item.href !== '/' && !pages.has(item.href))) throw new PanelError('The menu points to a page that does not exist.');
    await this.files.write('site.yml', document.toString());
    this.repository.invalidate();
  }
  async saveMenuTranslations(value: unknown) {
    const input = z.object({
      language: languageCode,
      revision: z.string(),
      siteRevision: z.string(),
      translations: z.array(z.object({ source: z.string().min(1).max(200), translation: z.string().max(200) })).max(200),
    }).parse(value);
    const siteSource = await this.siteSource(input.siteRevision);
    const site = siteSchema.parse(parse(siteSource) ?? {});
    if (input.language === site.language) throw new PanelError('The default language menu is edited as a menu tree.');
    if (!site.languages.includes(input.language)) throw new PanelError('This language is not available for the site.');
    const expected = menuMessageIds(site.menu);
    const submitted = new Map(input.translations.map(entry => [entry.source, entry.translation.trim()]));
    if (submitted.size !== input.translations.length || expected.length !== submitted.size || expected.some(message => !submitted.has(message))) {
      throw new PanelError('The menu structure changed after opening the form. Refresh the page before saving.', 409);
    }
    const file = `lang/${input.language}.po`;
    const catalog = await this.files.read(file).catch(error => {
      if (error.code === 'ENOENT') return Buffer.from('');
      throw error;
    });
    if (digest(catalog) !== input.revision) throw new PanelError('The translation file changed after opening the form. Refresh the page before saving.', 409);
    await this.files.write(file, updateMenuCatalog(catalog, input.language, submitted));
    this.repository.invalidate();
  }
  private async updateGallery(page: Awaited<ReturnType<PanelStore['page']>>, photos: Page['gallery']) {
    page.document.set('gallery', photos);
    const source = `---\n${page.document.toString()}---\n${page.body}`;
    await this.files.write(page.targetFile, source);
    if (page.migration && page.file !== page.targetFile) await this.files.remove(page.file);
    this.repository.invalidate();
    // A successful commit must not depend on a second, fallible cache refresh.
    return { revision: digest(source), gallery: photos };
  }
  async upload(path: string, language: string | undefined, revision: string, buffer: Buffer, alt: string) {
    const original = await this.page(path, language);
    await this.files.checkRevision(original.file, revision);
    if (original.page.gallery.length >= 500) throw new PanelError('A gallery may contain at most 500 photos.');
    const image = sharp(buffer, { limitInputPixels: 25_000_000, animated: false });
    let format: string | undefined;
    try { format = (await image.metadata()).format; } catch { throw new PanelError('Invalid image.'); }
    if (!['jpeg', 'png', 'webp', 'gif', 'avif'].includes(format ?? '')) throw new PanelError('Allowed image formats are JPEG, PNG, WebP, GIF and AVIF.');
    const id = randomUUID();
    const prefix = `media/gallery/${id}`;
    const photo = photoSchema.parse({ src: '/' + prefix + '.large.png', thumbnail: '/' + prefix + '.small.webp', download: '/' + prefix + '.download.png', alt });
    const created: string[] = [];
    try {
      for (const [size, width, height, format] of [['small', 640, 480, 'webp'], ['large', 1600, 1200, 'png'], ['download', 5000, 5000, 'png']] as const) {
        const resized = image.clone().rotate().resize(width, height, { fit: 'inside', withoutEnlargement: true });
        const data = format === 'webp' ? await resized.webp({ quality: 82, effort: 4 }).toBuffer() : await resized.png().toBuffer();
        const file = `${prefix}.${size}.${format}`;
        await this.files.write(file, data); created.push(file);
      }
      const result = await this.updateGallery(original, [...original.page.gallery, photo]);
      return { photo, ...result };
    } catch (error) { for (const file of created) await this.files.remove(file); throw error; }
  }
  async photo(value: unknown) {
    const input = z.object({ path: route, language: languageCode.optional(), revision: z.string(), index: z.number().int().nonnegative(), action: z.enum(['delete', 'up', 'down', 'alt']), alt: z.string().max(500).optional() }).parse(value);
    const original = await this.page(input.path, input.language);
    await this.files.checkRevision(original.file, input.revision);
    const photos = original.page.gallery.map(photo => ({ ...photo }));
    const photo = photos[input.index];
    if (!photo) throw new PanelError('Photo not found.');
    if (input.action === 'delete') {
      // Retain image files: another page or its HTML may still reference them.
      await this.files.write('state/panel/trash/' + Date.now() + '-' + randomUUID() + '.json', JSON.stringify({ type: 'photo', page: input.path, photo }));
      photos.splice(input.index, 1);
    }
    if (input.action === 'alt') photo.alt = input.alt ?? '';
    const target = input.index + (input.action === 'up' ? -1 : 1);
    if (['up', 'down'].includes(input.action) && photos[target]) [photos[input.index], photos[target]] = [photos[target]!, photo];
    return this.updateGallery(original, photos);
  }
  async copyGallery(value: unknown) {
    const input = z.object({ path: route, language: languageCode, sourceLanguage: languageCode, revision: z.string() }).parse(value);
    if (input.language === input.sourceLanguage) throw new PanelError('Choose a different language as the gallery source.');
    const content = await this.repository.load();
    if (!content.site.languages.includes(input.language) || !content.site.languages.includes(input.sourceLanguage)) {
      throw new PanelError('This language is not available for the site.');
    }
    const variants = content.translations?.get(input.path);
    const sourceVariant = variants?.get(input.sourceLanguage)
      ?? (input.sourceLanguage === content.site.language ? variants?.get('') : undefined);
    if (!sourceVariant?.sourceFile) throw new PanelError('The selected language does not have its own gallery.');
    const original = await this.page(input.path, input.language);
    await this.files.checkRevision(original.file, input.revision);
    const source = await this.page(input.path, input.sourceLanguage);
    if (!source.page.gallery.length) throw new PanelError('The selected language gallery is empty.');
    return this.updateGallery(original, source.page.gallery.map(photo => ({ ...photo })));
  }
}
