type ThemeEffects = {
  transition?: (element: HTMLElement | null, entering: boolean, signal: AbortSignal) => Promise<void>;
  waiting?: (page: HTMLElement | null, shell: HTMLElement) => () => void;
};
let effects: ThemeEffects = {};
const active = new WeakMap<HTMLElement, Animation>();

export async function initTheme() {
  const client = document.body.dataset.themeClient;
  if (!client || !/^\/assets\/themes\/[a-z0-9-]+\/[a-f0-9]{64}\/client\.js$/.test(client)) return;
  try {
    const theme = await import(client);
    effects = await theme.default() ?? {};
  } catch (error) { console.error('Theme initialization failed', error); }
}

export async function animateTheme(element: HTMLElement | null, entering: boolean, signal: AbortSignal) {
  if (!element || signal.aborted || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (effects.transition) {
    try { await effects.transition(element, entering, signal); return; }
    catch (error) { console.error('Theme transition failed', error); }
  }
  element.dataset.transition = entering ? 'enter' : 'leave';
  const animation = element.animate({ opacity: entering ? [0, 1] : [1, 0] }, { duration: entering ? 150 : 125 });
  active.set(element, animation);
  const cancel = () => {
    animation.cancel();
    if (active.get(element) === animation) { active.delete(element); delete element.dataset.transition; }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try { await animation.finished; } catch { /* Cancelled navigation. */ }
  finally { signal.removeEventListener('abort', cancel); cancel(); }
}

export function waitForTheme(page: HTMLElement | null, shell: HTMLElement): () => void {
  try { return effects.waiting?.(page, shell) ?? (() => {}); }
  catch (error) { console.error('Theme waiting effect failed', error); return () => {}; }
}
