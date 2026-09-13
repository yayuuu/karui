import { useState } from 'preact/hooks';
import { activeMenu, type NavigationItem } from '../../content/menu.js';
import type { MenuItem } from '../../content.js';
import { createIsland } from '../ui/island.js';
import { transition } from './motion.js';
import { t } from '../i18n.js';

function TreeItem({ item }: { item: NavigationItem }) {
  const [expanded, setExpanded] = useState(item.active !== 'false');
  return <li>
    <div class="mobile-tree-row">
      <a href={item.href} target={item.target} rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
        data-active={item.active} aria-current={item.active === 'page' ? 'page' : undefined}><span class="mobile-tree-label">{item.title}</span></a>
      {item.children.length > 0 && <button type="button" aria-label={t(expanded ? 'Collapse: {title}' : 'Expand: {title}', { title: item.title })}
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : '+'}</button>}
    </div>
    {item.children.length > 0 && <ul hidden={!expanded}>{item.children.map((child, index) => <TreeItem key={index} item={child} />)}</ul>}
  </li>;
}

function BackArrow() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg>;
}

type Language = { code: string; href: string; current: boolean };
type View = { open: boolean; shown: boolean; title: string; back: string; items: NavigationItem[]; languages: Language[]; revision: number;
  toggle: () => void; close: (focus?: boolean) => void };

function MobileNavigation({ open, shown, title, back, items, languages, revision, toggle, close }: View) {
  return <>
    <nav id="mobile-navigation" class="mobile-navigation-panel" aria-label={t('Site navigation')} tabIndex={-1} hidden={!shown}>
      <h2 class="pagetitle page-heading">{t('Navigation')}</h2>
      <ul class="mobile-tree" key={revision}>{items.map((item, index) => <TreeItem key={index} item={item} />)}</ul>
      {languages.length > 1 && <label class="mobile-language"><span>{t('Language')}</span><select value={languages.find(item => item.current)?.href}
        onChange={event => location.assign(event.currentTarget.value)}>{languages.map(item => <option value={item.href} lang={item.code}>{item.code.toUpperCase()}</option>)}</select></label>}
    </nav>
    <nav class="mobile-bar" aria-label={t('Mobile navigation')}>
      {open ? <button key="back" type="button" class="mobile-back" onClick={() => close(true)} aria-label={t('Back to content')}><BackArrow /></button>
        : back ? <a key="back" class="mobile-back" href={back} aria-label={t('Parent page')}><BackArrow /></a> : <span key="back" />}
      <button key="title" type="button" class="mobile-page-title" title={title} aria-label={`${t(open ? 'Close navigation' : 'Open navigation')}: ${title}`}
        aria-expanded={open} aria-controls="mobile-navigation" onClick={toggle}>{title}</button>
      <button key="toggle" type="button" class="mobile-menu-toggle" aria-label={t(open ? 'Close navigation' : 'Open navigation')}
        aria-expanded={open} aria-controls="mobile-navigation" onClick={toggle}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d={open ? 'M6 6 18 18M18 6 6 18' : 'M4 6h16M4 12h16M4 18h16'} />
        </svg>
      </button>
    </nav>
  </>;
}

/** A separate Preact island: never reparent or remount page/gallery/widget DOM. */
export function initMobileNavigation() {
  const root = document.querySelector<HTMLElement>('.site-shell');
  if (!root || document.body.dataset.print === 'true') return { refresh() {}, navigation: {} };
  const shell = root;
  const media = matchMedia('(max-width: 899px)');
  const island = createIsland('mobile-navigation', shell);
  let open = false, targetOpen = false, revision = 0, items: NavigationItem[] = [], languages: Language[] = [], title = '', back = '';
  let motion: AbortController | undefined;
  let saved: { page: HTMLElement; top: number; hidden: HTMLElement['hidden']; inert: boolean } | undefined;
  const render = () => island.render(<MobileNavigation {...{ title, back, items, languages, revision, toggle }} open={targetOpen} shown={open} close={focus => {
    if (shell.getAttribute('aria-busy') !== 'true') void switchView(false, focus);
  }} />);
  const focusToggle = () => shell.querySelector<HTMLButtonElement>('.mobile-menu-toggle')?.focus({ preventScroll: true });
  const surface = () => shell.querySelector<HTMLElement>(open ? '#mobile-navigation' : '#page');
  function show(next: boolean) {
    if (next === open) return;
    open = next;
    if (next) {
      const page = shell.querySelector<HTMLElement>('#page');
      if (page) {
        saved = { page, top: page.scrollTop, hidden: page.hidden, inert: page.inert };
        page.hidden = true; page.inert = true;
      }
      render();
    } else {
      const previous = saved; saved = undefined;
      if (previous) { previous.page.hidden = previous.hidden; previous.page.inert = previous.inert; }
      render();
      if (previous) previous.page.scrollTop = previous.top;
    }
  }
  function closeImmediately() {
    motion?.abort(); motion = undefined;
    targetOpen = false; show(false); render();
  }
  async function switchView(next: boolean, focus = true) {
    if (!media.matches || (next && shell.getAttribute('aria-busy') === 'true')) return;
    motion?.abort();
    const controller = new AbortController(); motion = controller;
    const { signal } = controller;
    targetOpen = next; render();
    if (next === open) { motion = undefined; if (focus) (next ? surface() : shell.querySelector<HTMLElement>('.mobile-menu-toggle'))?.focus({ preventScroll: true }); return; }
    let unlock = () => {};
    const animate = async (element: HTMLElement | null, entering: boolean) => {
      const inert = element?.inert ?? false;
      if (element) element.inert = true;
      let released = false;
      const restore = () => { if (!released && element) element.inert = inert; released = true; };
      unlock = restore;
      signal.addEventListener('abort', restore, { once: true });
      try { await transition(element, entering, signal); }
      finally { signal.removeEventListener('abort', restore); if (unlock === restore) { restore(); unlock = () => {}; } }
    };
    try {
      await animate(surface(), false);
      if (signal.aborted) return;
      if (!media.matches) { closeImmediately(); return; }
      show(next);
      await animate(surface(), true);
      if (signal.aborted) return;
      if (focus) { if (next) surface()?.focus({ preventScroll: true }); else focusToggle(); }
    } finally {
      unlock();
      if (motion === controller) motion = undefined;
    }
  }
  function toggle() {
    if (shell.getAttribute('aria-busy') !== 'true') void switchView(!targetOpen);
  }
  function refresh() {
    closeImmediately();
    const source = shell.querySelector<HTMLTemplateElement>('[data-mobile-menu]');
    try {
      const menu = JSON.parse(source?.dataset.items ?? 'null') as MenuItem[];
      if (!Array.isArray(menu)) throw new Error('Missing navigation');
      const withHome = menu.some(item => item.href === '/') ? menu : [{ title: t('Home page'), href: '/', children: [] }, ...menu];
      items = activeMenu(withHome, location.pathname);
      const options = [...shell.querySelectorAll<HTMLOptionElement>('[data-language-select] option')];
      languages = options.map(option => ({ code: option.value, href: option.dataset.href ?? `?lang=${encodeURIComponent(option.value)}`, current: option.selected }));
    } catch {
      shell.classList.remove('mobile-navigation-ready'); island.render(null); return;
    }
    title = shell.querySelector('#page')?.getAttribute('aria-label') || t('Home page');
    back = document.querySelector<HTMLAnchorElement>('.backbutton')?.getAttribute('href') ?? '';
    revision++; render(); shell.classList.add('mobile-navigation-ready');
  }
  media.addEventListener('change', event => {
    const focus = document.activeElement;
    if (!event.matches) {
      closeImmediately();
      if (focus?.closest('[data-ui-island="mobile-navigation"]')) shell.querySelector<HTMLElement>('#page, #menu a')?.focus({ preventScroll: true });
    }
  });
  document.addEventListener('keydown', event => {
    if ((open || targetOpen) && event.key === 'Escape' && shell.getAttribute('aria-busy') !== 'true') { event.preventDefault(); void switchView(false); }
  });
  window.addEventListener('beforeprint', closeImmediately);
  window.addEventListener('pagehide', closeImmediately);
  refresh();
  return { refresh, navigation: {
    departure: () => { motion?.abort(); motion = undefined; targetOpen = open; render(); return surface(); },
    restore: closeImmediately,
    close: () => switchView(false),
    scrollTop: () => saved?.top,
  } };
}
