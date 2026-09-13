import type { Photo } from '../../content.js';
import justifiedLayout from 'justified-layout';
import { initGalleryDiagnostics } from './diagnostics.js';
import { t } from '../i18n.js';

function initPhotoWall(gallery: HTMLElement) {
  const lifetime = new AbortController();
  const options = { signal: lifetime.signal };
  const tiles = [...gallery.querySelectorAll<HTMLAnchorElement>('.imgframe')];
  const images = tiles.map(tile => tile.querySelector('img')!);
  let frame = 0;
  let previousWidth = 0;
  let previousGeometry = '';
  // Layout width must ignore the temporary skew/translation of page transitions.
  const measureWidth = () => Number.parseFloat(getComputedStyle(gallery).width) || gallery.clientWidth;
  const layout = () => {
    frame = 0;
    const width = measureWidth();
    if (!width) return;
    previousWidth = width;
    const geometry = justifiedLayout(images.map(image => {
      const w = image.naturalWidth || Number(image.getAttribute('width'));
      const h = image.naturalHeight || Number(image.getAttribute('height'));
      return w > 0 && h > 0 ? w / h : 1;
    }), {
      containerWidth: width, containerPadding: 0, boxSpacing: 4,
      targetRowHeight: Number.parseFloat(getComputedStyle(gallery).getPropertyValue('--row-height')),
      targetRowHeightTolerance: .2, showWidows: true,
    });
    const signature = JSON.stringify(geometry.boxes);
    if (signature === previousGeometry) return;
    previousGeometry = signature;
    // Keep rows in normal document flow. Absolute, fractionally positioned
    // images can miss a paint invalidation in Chromium/Vivaldi after decoding.
    const rows = document.createDocumentFragment();
    let row: HTMLDivElement;
    let rowTop = -1;
    geometry.boxes.forEach((box, index) => {
      if (box.top !== rowTop) {
        row = document.createElement('div');
        row.className = 'gallery-row';
        rows.append(row);
        rowTop = box.top;
      }
      const tile = tiles[index]!;
      Object.assign(tile.style, { width: `${box.width}px`, height: `${box.height}px` });
      row.append(tile);
    });
    gallery.replaceChildren(rows);
    gallery.classList.add('gallery-ready');
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(layout); };
  images.forEach(image => image.addEventListener('load', schedule, options));
  const resizeObserver = new ResizeObserver(() => {
    if (measureWidth() !== previousWidth) schedule();
  });
  resizeObserver.observe(gallery);
  window.addEventListener('resize', schedule, options);
  window.addEventListener('pageshow', schedule, options);
  layout();

  // Explicitly load nearby tiles, including within the scrolling #page.
  let observer: IntersectionObserver | undefined;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.querySelector('img')!.loading = 'eager';
        observer!.unobserve(entry.target);
      }
    }, { rootMargin: '600px' });
    tiles.forEach(tile => observer!.observe(tile));
  } else {
    images.forEach(image => { image.loading = 'eager'; });
  }
  return () => { lifetime.abort(); resizeObserver.disconnect(); observer?.disconnect(); cancelAnimationFrame(frame); };
}

export function initGalleries() {
  const cleanup: (() => void)[] = [];
  for (const root of document.querySelectorAll<HTMLElement>('[data-gallery]')) {
    const lifetime = new AbortController();
    const options = { signal: lifetime.signal };
    const diagnostic = initGalleryDiagnostics(root);
    const wall = initPhotoWall(root.querySelector<HTMLElement>('.gallery')!);
    const photos: Photo[] = JSON.parse(root.dataset.photos ?? '[]');
    const galleryItems: Photo[] = JSON.parse(root.dataset.galleryItems ?? root.dataset.photos ?? '[]');
    const scope = root.closest<HTMLElement>('#page') ?? root.parentElement ?? root;
    const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
    const image = root.querySelector<HTMLImageElement>('[data-gallery-image]')!;
    const download = root.querySelector<HTMLAnchorElement>('[data-gallery-download]')!;
    const counter = root.querySelector<HTMLElement>('[data-gallery-counter]')!;
    const transitionDuration = 125;
    let transition = 0;
    let pointerStartedOutside = false;
    const outsideDialog = (event: MouseEvent) => {
      const box = dialog.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    };
    // Backdrop events target the dialog itself, as do clicks on its border.
    // Check both ends of a gesture so dragging from the photo cannot dismiss it.
    dialog.addEventListener('pointerdown', event => {
      pointerStartedOutside = event.isPrimary && event.button === 0 && event.target === dialog && outsideDialog(event);
    }, options);
    dialog.addEventListener('pointercancel', () => { pointerStartedOutside = false; }, options);
    dialog.addEventListener('close', () => { pointerStartedOutside = false; }, options);
    dialog.addEventListener('click', event => {
      const dismiss = pointerStartedOutside && event.target === dialog && outsideDialog(event);
      pointerStartedOutside = false;
      if (dismiss) dialog.close();
    }, options);
    let activePhotos = photos, index = 0, requestedIndex = 0;
    const render = () => {
      const photo = activePhotos[index];
      if (!photo) return;
      image.src = photo.src; image.alt = photo.alt;
      download.href = photo.download ?? photo.src;
      counter.textContent = t('Photo {current} of {total}', { current: index + 1, total: activePhotos.length });
      for (const button of root.querySelectorAll<HTMLButtonElement>('.photo-navigation')) button.hidden = activePhotos.length < 2;
    };
    const stopImageAnimations = () => image.getAnimations().forEach(animation => animation.cancel());
    const photoReady = (photo: Photo) => new Promise<boolean>(resolve => {
      const preload = new Image();
      let settled = false;
      const finish = (loaded: boolean) => {
        if (settled) return;
        settled = true;
        if (!loaded) return resolve(false);
        preload.decode().catch(() => undefined).finally(() => resolve(true));
      };
      preload.addEventListener('load', () => finish(true), { once: true });
      preload.addEventListener('error', () => finish(false), { once: true });
      preload.decoding = 'async';
      preload.src = photo.src;
      if (preload.complete) finish(preload.naturalWidth > 0);
    });
    const navigate = async (step: number) => {
      if (activePhotos.length < 2) return;
      requestedIndex = (requestedIndex + activePhotos.length + step) % activePhotos.length;
      const target = requestedIndex, token = ++transition;
      const opacity = Number.parseFloat(getComputedStyle(image).opacity);
      stopImageAnimations();
      const fadeOut = image.animate(
        [{ opacity: Number.isFinite(opacity) ? opacity : 1 }, { opacity: 0 }],
        { duration: transitionDuration, easing: 'ease-out', fill: 'forwards' },
      );
      const [, loaded] = await Promise.all([fadeOut.finished.catch(() => undefined), photoReady(activePhotos[target]!)]);
      if (token !== transition) return;
      if (!loaded) requestedIndex = index;
      else { index = target; render(); }
      fadeOut.cancel();
      const fadeIn = image.animate([{ opacity: 0 }, { opacity: 1 }], { duration: transitionDuration, easing: 'ease-in', fill: 'both' });
      await fadeIn.finished.catch(() => undefined);
      if (token === transition) fadeIn.cancel();
    };
    const selectedIndex = (items: Photo[], button: HTMLElement) => items.findIndex(photo => photo.src === button.dataset.gallerySrc);
    scope.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLElement>('[data-action], [data-gallery-src]');
      if (!button) return;
      event.preventDefault();
      if (button.dataset.action === 'open') {
        const selected = selectedIndex(photos, button);
        if (selected < 0) return;
        transition++; stopImageAnimations(); activePhotos = photos; index = selected; requestedIndex = index; render(); dialog.showModal();
      } else if (button.dataset.gallerySrc) {
        const selected = selectedIndex(galleryItems, button);
        if (selected < 0) return;
        transition++; stopImageAnimations(); activePhotos = [galleryItems[selected]!]; index = 0; requestedIndex = index; render(); dialog.showModal();
      }
      if (button.dataset.action === 'close') dialog.close();
      if (button.dataset.action === 'next') void navigate(1);
      if (button.dataset.action === 'previous') void navigate(-1);
    }, options);
    scope.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      const trigger = (event.target as Element).closest<HTMLElement>('[data-gallery-src]');
      if (!trigger || trigger.tagName === 'A') return;
      const selected = selectedIndex(galleryItems, trigger);
      if (selected < 0) return;
      event.preventDefault(); activePhotos = [galleryItems[selected]!]; index = 0; render(); dialog.showModal();
    }, options);
    dialog.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      if (activePhotos.length < 2) return;
      event.preventDefault(); void navigate(event.key === 'ArrowRight' ? 1 : -1);
    }, options);
    cleanup.push(() => { transition++; stopImageAnimations(); lifetime.abort(); dialog.close(); wall(); diagnostic?.(); });
  }
  return () => cleanup.forEach(stop => stop());
}
