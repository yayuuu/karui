import type { Content, MenuItem } from '../content.js';

/** Hiding a parent also hides its descendants and plugin endpoints. */
export function isPublished(content: Content, href: string): boolean {
  let path = href;
  while (path) {
    if (content.pages.get(path)?.published === false) return false;
    path = path.slice(0, path.lastIndexOf('/'));
  }
  return true;
}

const snapshots = new WeakMap<Content, Content>();
export function publicContent(content: Content): Content {
  const cached = snapshots.get(content);
  if (cached) return cached;
  const pages = new Map([...content.pages].filter(([href]) => isPublished(content, href)));
  const menu = (items: MenuItem[]): MenuItem[] => items
    .filter(item => !item.href.startsWith('/') || isPublished(content, item.href))
    .map(item => ({ ...item, children: menu(item.children) }));
  const translations = content.translations && new Map([...content.translations].filter(([href]) => pages.has(href)));
  const result = {
    pages,
    translations,
    menuTranslations: content.menuTranslations,
    siteTranslations: content.siteTranslations,
    site: { ...content.site, menu: menu(content.site.menu) },
  };
  snapshots.set(content, result);
  return result;
}
