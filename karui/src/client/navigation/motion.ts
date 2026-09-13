import { animateTheme, waitForTheme } from '../themes.js';

export const transition = animateTheme;

/** Starts synchronously with the click, while the request runs independently. */
export function startDeparture(page: HTMLElement | null, shell: HTMLElement, signal: AbortSignal) {
  let disposed = false;
  let stopWaiting = () => {};
  const visibility = page?.style.getPropertyValue('visibility') ?? '';
  const priority = page?.style.getPropertyPriority('visibility') ?? '';
  const inert = page?.inert ?? false;
  const restore = () => {
    if (disposed) return;
    disposed = true;
    stopWaiting();
    if (page) {
      if (visibility) page.style.setProperty('visibility', visibility, priority);
      else page.style.removeProperty('visibility');
      page.inert = inert;
    }
    signal.removeEventListener('abort', restore);
  };
  signal.addEventListener('abort', restore, { once: true });
  if (page) page.inert = true;
  const ready = (async () => {
    await transition(page, false, signal);
    if (disposed || signal.aborted) return;
    if (page) page.style.visibility = 'hidden';
    stopWaiting = waitForTheme(page, shell);
  })();
  return { ready, restore };
}
