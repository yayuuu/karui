import { readdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { contentFormats, editingFormat } from './content/format.js';
import { renderPageContent } from './content/code.js';
import { parse } from 'yaml';
import { z } from 'zod';
import { activeMenu } from './content/menu.js';
import { parseMenuTranslations, translateMenu } from './content/menu-translations.js';

export const route = z.string().max(240).regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/);
export const languageCode = z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/).max(35);
export type MenuItem = { title: string; href: string; target?: '_self' | '_blank'; children: MenuItem[] };
const externalLink = z.string().max(2000).url().refine(value => {
  try {
    const url = new URL(value);
    return /^https?:\/\//i.test(value) && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !/[\s\\]/.test(value);
  } catch { return false; }
}, 'Only absolute HTTP(S) links without credentials are allowed');
const link: z.ZodType<MenuItem> = z.lazy(() => z.object({ title: z.string().min(1).max(200), href: z.union([route, externalLink]), target: z.enum(['_self', '_blank']).optional(), children: z.array(link).max(100).default([]) }));
const siteImage = z.string().max(2000).refine(value => {
  if (value === '') return true;
  if (/^\/media\/[\w/.,%-]+$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/[\s\\]/.test(value); }
  catch { return false; }
}, 'Use /media/... or an absolute HTTPS address');
const siteFields = z.object({
  title: z.string().min(1).max(200).default('karui'),
  theme: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).default('default'),
  home: route.default('/'),
  language: languageCode.default('en'),
  languages: z.array(languageCode).min(1).max(20).default(['en']),
  description: z.string().max(500).optional(),
  brandName: z.string().max(200).optional(),
  tagline: z.string().max(300).optional(),
  logo: siteImage.optional(),
  favicon: siteImage.optional(),
  showBrandName: z.boolean().optional(),
  footer: z.string().max(100_000).optional(),
  footerFormat: z.enum(contentFormats).optional(),
  menu: z.array(link).max(100).default([]),
  redirects: z.record(z.string().regex(/^\/[a-z0-9/-]+\/$/), z.string().regex(/^\/[a-z0-9/-]+\/$/)).default({}),
});
export const siteSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const site = { ...value as Record<string, unknown> };
  const language = typeof site.language === 'string' ? site.language.trim().toLowerCase() : 'en';
  if (site.languages === undefined) site.languages = [language];
  return site;
}, siteFields.superRefine((site, context) => {
  if (!site.languages.includes(site.language)) context.addIssue({ code: 'custom', path: ['languages'], message: 'Available languages must include the default language' });
  if (new Set(site.languages).size !== site.languages.length) context.addIssue({ code: 'custom', path: ['languages'], message: 'Language codes must be unique' });
}));
export const siteTranslationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  brandName: z.string().max(200).optional(),
  tagline: z.string().max(300).optional(),
  footer: z.string().max(100_000).optional(),
}).strict();
const mediaUrl = z.string().max(1000).regex(/^\/media\/[\w/.,%-]+$/);
export const photoSchema = z.object({ src: mediaUrl, thumbnail: mediaUrl, download: mediaUrl.optional(), alt: z.string().max(500).default('') });
export type Photo = z.infer<typeof photoSchema>;
export const galleryVisibility = z.enum(['all', 'unused', 'hidden']);
export const pluginPlacement = z.enum(['before', 'after', 'content']);
export const metadata = z.object({ title: z.string().min(1).max(300), keywords: z.string().max(2000).default(''), order: z.number().int().nonnegative().default(0), plugin: z.string().regex(/^[a-z0-9-]+$/).optional(), pluginPlacement: pluginPlacement.optional(), gallery: z.array(photoSchema).max(500).default([]), showPrint: z.boolean().optional(), showPdf: z.boolean().optional(), showSubpages: z.boolean().optional(), format: z.enum(contentFormats).optional(), published: z.boolean().optional(), galleryVisibility: galleryVisibility.optional() }).passthrough();
export type Site = z.infer<typeof siteSchema>;
export type SiteTranslation = z.infer<typeof siteTranslationSchema>;
export type Page = z.infer<typeof metadata> & { href: string; html: string; source?: string; sourceFile?: string; baseFile?: string; language?: string };
export type Content = {
  site: Site;
  pages: Map<string, Page>;
  translations?: Map<string, Map<string, Page>>;
  menuTranslations?: Map<string, Map<string, string>>;
  siteTranslations?: Map<string, SiteTranslation>;
};

export function parsePage(source: string, href: string): Page {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`Missing YAML front matter: ${href}`);
  const data = metadata.parse(parse(match[1]!));
  const html = renderPageContent(match[2]!, data.format);
  // Actions are opt-in, including for existing files without these fields.
  return { ...data, href, html, source: match[2]!, pluginPlacement: data.pluginPlacement ?? 'after', format: editingFormat(match[2]!, data.format), published: data.published ?? true, galleryVisibility: data.galleryVisibility ?? 'all', showPrint: data.showPrint ?? false, showPdf: data.showPdf ?? false, showSubpages: data.showSubpages ?? true };
}

export function flattenMenu(items: MenuItem[], depth = 0): (MenuItem & { depth: number })[] {
  if (depth > 8) throw new Error('Menu is nested too deeply');
  return items.flatMap(item => [{ ...item, depth }, ...flattenMenu(item.children, depth + 1)]);
}

export class ContentRepository {
  constructor(private readonly directory: string) {}
  /** Uncached readers need no invalidation; cached implementations override this. */
  invalidate(): void {}
  async load(): Promise<Content> {
    const source = await readFile(join(this.directory, 'site.yml'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const site = siteSchema.parse(parse(source) ?? {});
    const pages = new Map<string, Page>();
    const translations = new Map<string, Map<string, Page>>();
    const menuTranslations = new Map<string, Map<string, string>>();
    const siteTranslations = new Map<string, SiteTranslation>();
    const visit = async (directory: string, segments: string[]) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name)) await visit(path, [...segments, entry.name]);
        else if (entry.isFile()) {
          const name = /^([a-z0-9-]+)(?:\.([a-z]{2,3}(?:-[a-z0-9]{2,8})*))?\.md$/.exec(entry.name);
          if (!name) continue;
          const slug = name[1]!, language = name[2]?.toLowerCase() ?? '';
          const href = '/' + [...segments, ...(slug === 'index' ? [] : [slug])].join('/');
          const variants = translations.get(href) ?? new Map<string, Page>();
          if (variants.has(language)) throw new Error(`Duplicate page translation: ${href} (${language || site.language})`);
          const sourceFile = [...segments, entry.name].join('/');
          const baseFile = [...segments, slug + '.md'].join('/');
          variants.set(language, { ...parsePage(await readFile(path, 'utf8'), href), sourceFile, baseFile, language: language || site.language });
          translations.set(href, variants);
        }
      }
    };
    await visit(join(this.directory, 'pages'), []).catch(error => { if (error.code !== 'ENOENT') throw error; });
    for (const language of site.languages) {
      if (language === site.language) continue;
      const localizedSite = await readFile(join(this.directory, `site.${language}.yml`), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (localizedSite !== undefined) siteTranslations.set(language, siteTranslationSchema.parse(parse(localizedSite) ?? {}));
      const catalog = await readFile(join(this.directory, 'lang', `${language}.po`)).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (catalog) menuTranslations.set(language, parseMenuTranslations(catalog));
    }
    for (const [href, variants] of translations) {
      const page = variants.get(site.language) ?? variants.get('') ?? variants.values().next().value;
      if (page) pages.set(href, page);
    }
    if (site.home !== '/' && !pages.has(site.home)) throw new Error(`Home page does not exist: ${site.home}`);
    for (const item of flattenMenu(site.menu)) if (item.href.startsWith('/') && item.href !== '/' && !pages.has(item.href)) throw new Error(`Menu target does not exist: ${item.href}`);
    return { site, pages, translations, menuTranslations, siteTranslations };
  }
}

export function localizedContent(content: Content, language: string): Content {
  const selected = languageCode.parse(language);
  const pages = new Map<string, Page>();
  for (const [href, variants] of content.translations ?? []) {
    const page = variants.get(selected)
      ?? (selected === content.site.language ? variants.get('') : undefined)
      ?? variants.get(content.site.language)
      ?? variants.get('')
      ?? variants.values().next().value;
    if (page) pages.set(href, page);
  }
  return {
    ...content,
    site: {
      ...content.site,
      ...(selected === content.site.language ? {} : content.siteTranslations?.get(selected)),
      menu: selected === content.site.language ? content.site.menu : translateMenu(content.site.menu, content.menuTranslations?.get(selected)),
    },
    pages: content.translations ? pages : content.pages,
  };
}

export function navigation(content: Content, page: Page) {
  const menu = activeMenu(content.site.menu, page.href);
  const group = menu.find(item => item.active !== 'false');
  const children = [...content.pages.values()].filter((candidate) => candidate.href !== page.href && candidate.href.slice(0, candidate.href.lastIndexOf('/')) === page.href).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, content.site.language));
  return { menu, submenu: flattenMenu(group?.children ?? []), children, back: parentPage(content, page.href) };
}

/** Content hierarchy, never browser history; flat plugin URLs use their menu parent. */
export function parentPage(content: Content, href: string): string {
  if (href === '/') return '';
  let ancestor = href.slice(0, href.lastIndexOf('/'));
  while (ancestor) {
    if (content.pages.has(ancestor)) return ancestor;
    ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'));
  }
  const menuParent = (items: MenuItem[], parent = '/'): string | undefined => {
    for (const item of items) {
      if (item.href === href && parent !== href) return parent.startsWith('/') ? parent : '/';
      const found = menuParent(item.children, item.href);
      if (found) return found;
    }
    return undefined;
  };
  return menuParent(content.site.menu) ?? '/';
}

export async function containedFile(root: string, path: string): Promise<string | null> {
  try {
    const actualRoot = await realpath(root);
    const candidate = await realpath(resolve(root, path));
    return candidate.startsWith(actualRoot + sep) ? candidate : null;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}
