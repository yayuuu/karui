import { fragmentType, type PageFragment } from '../../page-fragment.js';
import { transition, startDeparture } from './motion.js';
import { createNavigationChrome } from './chrome.js';
import { t } from '../i18n.js';

const publicURL = (url: URL) => url.origin === location.origin && /^https?:$/.test(url.protocol)
  && !/^\/(?:panel|media|assets|plugin-assets|healthz)(?:\/|$)/.test(url.pathname)
  && !['print', 'pdf'].includes(url.searchParams.get('m') ?? '')
  && !/\/api(?:\/|$)|\.[a-z0-9]{2,5}$/i.test(url.pathname.replace(/\/index\.php$/, '/'));

function fragment(value: unknown): value is PageFragment {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.home === 'boolean'
    && ['assetVersion', 'title', 'pageTitle', 'keywords', 'href', 'content', 'submenu', 'back'].every(key => typeof v[key] === 'string')
    && (v.menu === undefined || typeof v.menu === 'string')
    && Array.isArray(v.styles) && v.styles.length <= 8 && v.styles.every(style => typeof style === 'string' && /^\/(?:assets|plugin-assets)\/[^\s]+$/.test(style));
}

async function prepareStyles(styles: string[], signal: AbortSignal, created: HTMLLinkElement[]) {
  await Promise.all(styles.map(href => {
    if ([...document.querySelectorAll<HTMLLinkElement>('link[data-page-style]')].some(link => link.getAttribute('href') === href)) return;
    return new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      created.push(link); link.rel = 'stylesheet'; link.href = href;
      const done = (error?: Error) => {
        clearTimeout(timer); signal.removeEventListener('abort', aborted);
        link.onload = link.onerror = null;
        if (error) reject(error); else resolve();
      };
      const aborted = () => done(new Error('Navigation cancelled'));
      const timer = setTimeout(() => done(new Error('Stylesheet timeout')), 8000);
      link.onload = () => done(); link.onerror = () => done(new Error('Stylesheet failed'));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) { aborted(); return; }
      document.head.append(link);
    });
  }));
}

type Scroll = { x: number; y: number; top: number };
type NavigationSurface = {
  departure?: () => HTMLElement | null;
  restore?: () => void;
  close?: () => Promise<void>;
  scrollTop?: () => number | undefined;
};

export function initNavigation(mount: () => () => void, surface: NavigationSurface = {}): (url: URL) => void {
  let cleanup = mount();
  window.addEventListener('pagehide', () => cleanup());
  // Panel forms retain their separate CSP, session handling and unsaved-change guard.
  if (!publicURL(new URL(location.href)) || document.body.dataset.print === 'true') return url => location.assign(url);
  const chrome = createNavigationChrome();
  const shell = document.querySelector<HTMLElement>('.site-shell')!;
  const menu = document.querySelector<HTMLElement>('#menu')!;
  let committed = new URL(location.href);
  let key: string = crypto.randomUUID();
  let serial = 0, request: AbortController | undefined;
  const positions = new Map<string, Scroll>();
  history.replaceState({ ...history.state, karuiKey: key }, '', location.href);
  history.scrollRestoration = 'manual';
  const saveScroll = () => {
    positions.set(key, { x: scrollX, y: scrollY, top: surface.scrollTop?.() ?? document.querySelector('#page')?.scrollTop ?? 0 });
    if (positions.size > 100) positions.delete(positions.keys().next().value!);
  };
  document.addEventListener('scroll', saveScroll, { passive: true, capture: true });
  window.addEventListener('scroll', saveScroll, { passive: true });
  const scrollToTarget = (url: URL, saved?: Scroll) => {
    const page = document.querySelector<HTMLElement>('#page');
    page?.focus({ preventScroll: true });
    if (!page) {
      const mobile = shell.querySelector<HTMLButtonElement>('.mobile-menu-toggle');
      if (mobile?.getBoundingClientRect().height) mobile.focus({ preventScroll: true });
      else { menu.tabIndex = -1; menu.focus({ preventScroll: true }); }
    }
    if (saved) { window.scrollTo(saved.x, saved.y); if (page) page.scrollTop = saved.top; return; }
    window.scrollTo(0, 0); if (page) page.scrollTop = 0;
    if (url.hash) {
      let id = url.hash.slice(1); try { id = decodeURIComponent(id); } catch { /* Literal hash. */ }
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }
  };
  const commitURL = (url: URL, pop: boolean, savedKey?: string) => {
    key = savedKey ?? crypto.randomUUID();
    const state = { ...history.state, karuiKey: key };
    if (pop) history.replaceState(state, '', url); else history.pushState(state, '', url);
    committed = url;
  };
  const navigate = async (url: URL, pop = false, savedKey?: string) => {
    if (!publicURL(url)) { surface.restore?.(); location.assign(url); return; }
    saveScroll();
    const saved = pop && savedKey ? positions.get(savedKey) : undefined;
    const id = ++serial;
    request?.abort(); request = new AbortController();
    const controller = request, signal = controller.signal;
    chrome.loading();
    if (url.pathname + url.search === committed.pathname + committed.search) {
      await surface.close?.();
      if (id !== serial) return;
      if (pop || url.href !== committed.href) commitURL(url, pop, savedKey);
      scrollToTarget(url, saved); shell.removeAttribute('aria-busy'); chrome.announce(''); return;
    }
    shell.setAttribute('aria-busy', 'true');
    const created: HTMLLinkElement[] = [];
    const timeout = setTimeout(() => controller.abort(new Error('Navigation timeout')), 12000);
    const oldPage = document.querySelector<HTMLElement>('#page');
    const departure = startDeparture(surface.departure?.() ?? oldPage, shell, signal);
    let applied = false;
    try {
      const response = await fetch(url, { headers: { Accept: fragmentType }, credentials: 'same-origin', signal });
      if (id !== serial) return;
      const destination = new URL(response.url || url.href);
      destination.hash = url.hash;
      if (!publicURL(destination) || !response.headers.get('content-type')?.includes(fragmentType)) {
        if (response.ok) { location.assign(destination); return; }
        throw new Error('Unexpected response');
      }
      const data: unknown = await response.json();
      if (!fragment(data)) throw new Error('Invalid page fragment');
      if (data.assetVersion !== document.body.dataset.assetVersion) { location.assign(destination); return; }
      await Promise.all([prepareStyles(data.styles, signal, created), departure.ready]);
      if (id !== serial) return;
      signal.throwIfAborted();
      cleanup();
      departure.restore();
      surface.restore?.();
      // A theme may leave its home template empty (a background-only landing page).
      let page = oldPage;
      if (data.home && !data.content.trim()) { page?.remove(); page = null; }
      else {
        if (!page) { page = document.createElement('main'); page.id = 'page'; page.tabIndex = -1; shell.prepend(page); }
        page.setAttribute('aria-label', data.pageTitle);
        page.innerHTML = data.content;
      }
      shell.querySelector('.submenu')?.remove();
      const submenu = document.createElement('template'); submenu.innerHTML = data.submenu;
      shell.append(submenu.content);
      if (data.menu !== undefined && menu.innerHTML.trim() !== data.menu.trim()) menu.innerHTML = data.menu;
      shell.classList.toggle('with-submenu', !!shell.querySelector('.submenu'));
      chrome.setBack(data.home ? '' : data.back);
      document.querySelectorAll<HTMLLinkElement>('link[data-page-style]').forEach(link => {
        if (!data.styles.includes(link.getAttribute('href')!)) link.remove();
      });
      created.forEach(link => { link.dataset.pageStyle = ''; });
      applied = true;
      document.title = data.title;
      document.querySelector('meta[name="keywords"]')?.setAttribute('content', data.keywords);
      // Both menus carry server-computed page/ancestor state, including menu
      // tree assignments that do not mirror URL paths (e.g. /sandbox → /showroom).
      commitURL(destination, pop, savedKey);
      cleanup = mount();
      scrollToTarget(destination, saved);
      chrome.announce(data.home ? t('Home page') : data.pageTitle);
      // The network timeout must not interrupt the appearance of already committed content.
      clearTimeout(timeout);
      await transition(page, true, signal);
      if (id === serial) document.dispatchEvent(new CustomEvent('karui:navigated'));
    } catch {
      if (id !== serial) return;
      if (pop) { location.reload(); return; }
      controller.abort();
      surface.restore?.();
      chrome.fail(url.href, () => { void navigate(url); });
    } finally {
      clearTimeout(timeout);
      departure.restore();
      if (!applied) created.forEach(link => link.remove());
      if (id === serial) { surface.restore?.(); shell.removeAttribute('aria-busy'); }
    }
  };
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!target || target.hasAttribute('download') || target.hasAttribute('data-full-navigation') || (target.target && target.target !== '_self') || target.closest('[contenteditable="true"]')) return;
    const url = new URL(target.href);
    if (!publicURL(url)) return;
    event.preventDefault(); void navigate(url);
  });
  window.addEventListener('popstate', event => { void navigate(new URL(location.href), true, event.state?.karuiKey); });
  window.addEventListener('pagehide', () => { ++serial; request?.abort(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { cleanup = mount(); scrollToTarget(committed, positions.get(key)); } });
  return url => { void navigate(url); };
}
