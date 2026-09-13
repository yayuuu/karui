import type { MenuItem } from '../content.js';

export type NavigationItem = Omit<MenuItem, 'children'> & {
  active: 'page' | 'ancestor' | 'false';
  children: NavigationItem[];
};

/** Match whole URL segments, then follow the configured tree (also for flat
 * plugin URLs). The longest match wins; home is never every page's ancestor. */
export function activeMenu(items: MenuItem[], href: string): NavigationItem[] {
  const path = href.split(/[?#]/, 1)[0]!.replace(/\/$/, '') || '/';
  let selected: MenuItem[] = [], length = -1;
  const visit = (items: MenuItem[], parents: MenuItem[]) => {
    for (const item of items) {
      const chain = [...parents, item];
      const matches = item.href.startsWith('/') && !item.href.startsWith('//')
        && (item.href === path || (item.href !== '/' && path.startsWith(item.href + '/')));
      if (matches && (item.href.length > length || (item.href.length === length && chain.length > selected.length))) {
        selected = chain; length = item.href.length;
      }
      visit(item.children, chain);
    }
  };
  visit(items, []);
  const branch = new Set(selected);
  const decorate = (items: MenuItem[]): NavigationItem[] => items.map(item => ({
    ...item, active: branch.has(item) ? item.href === path ? 'page' : 'ancestor' : 'false',
    children: decorate(item.children),
  }));
  return decorate(items);
}
