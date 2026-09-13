import { createIsland } from '../ui/island.js';
import { t } from '../i18n.js';

/** Opt-in, local-only snapshot. No cookies, storage, account data or uploads. */
export function initGalleryDiagnostics(root: HTMLElement) {
  if (new URLSearchParams(location.search).get('gallery-debug') !== '1') return;
  const island = createIsland('gallery-diagnostics');
  const download = () => {
    const inspect = (element: Element | null) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        tag: element.tagName, class: element.className,
        box: element.getBoundingClientRect().toJSON(),
        css: Object.fromEntries(['width', 'height', 'display', 'visibility', 'opacity', 'position', 'z-index', 'overflow', 'content-visibility', 'contain', 'clip-path', 'mask-image', 'transform', 'filter', 'object-fit'].map(name => [name, style.getPropertyValue(name)])),
      };
    };
    // Read all geometry before inserting a download link or otherwise changing DOM.
    const report = {
      version: 1, browser: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, scale: visualViewport?.scale },
      asset: document.querySelector<HTMLScriptElement>('script[src*="/assets/main.js"]')?.getAttribute('src'),
      page: inspect(root.closest('#page')), gallery: inspect(root.querySelector('.gallery')),
      images: [...root.querySelectorAll<HTMLImageElement>('.imgframe img')].map((image, index) => {
        const box = image.getBoundingClientRect();
        const cover = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { index: index + 1, src: image.currentSrc, complete: image.complete, natural: [image.naturalWidth, image.naturalHeight], loading: image.loading, decoding: image.decoding, image: inspect(image), tile: inspect(image.parentElement), row: inspect(image.parentElement?.parentElement ?? null), covered: cover !== image, cover: cover ? { tag: cover.tagName, class: cover.className } : null };
      }),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'gallery-diagnostics.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  island.render(
    <button type="button" onClick={download}
      style={{ position: 'fixed', top: 8, left: 8, zIndex: 1000, padding: 10, borderRadius: 8, background: 'white', color: '#222', border: '1px solid #777' }}>
      {t('Download gallery diagnostics')}
    </button>,
  );
  return island.dispose;
}
