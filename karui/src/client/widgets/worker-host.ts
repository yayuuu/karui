import { t } from '../i18n.js';

type Command = { type: string; selector?: string; value?: unknown; name?: string; items?: { tag: string; text: string }[] };
const allowedStyles = new Set(['transform', 'width', 'height', 'left', 'top', 'opacity', 'pointer-events', 'transition-duration']);
const allowedTags = new Set(['li', 'p', 'span', 'div']);

export function startWidget(root: HTMLElement, navigatePage: (url: URL) => void) {
  if (!root.dataset.script) return;
  const errorBox = root.querySelector<HTMLElement>('[data-widget-error]')!;
  let worker: Worker;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const listeners = new AbortController();
  const stop = (message?: string) => {
    stopped = true;
    worker?.terminate(); clearInterval(watchdog); listeners.abort();
    root.querySelectorAll('dialog').forEach((dialog) => dialog.close());
    if (message) { errorBox.textContent = message; errorBox.hidden = false; }
  };
  try { worker = new Worker(root.dataset.script, { type: 'module' }); }
  catch { stop(t('This part of the page could not be started. Refresh the page to try again.')); return; }
  let lastPong = performance.now(), messageWindow = lastPong, messages = 0;
  worker.onerror = (event) => { event.preventDefault(); stop(t('This part of the page encountered an error. The rest of the site is still available.')); };
  worker.onmessageerror = () => stop(t('The script response could not be read.'));
  worker.onmessage = (event: MessageEvent<Command>) => {
    if (stopped) return;
    if (performance.now() - messageWindow >= 1000) { messageWindow = performance.now(); messages = 0; }
    if (++messages > 240) { stop(t('A script sending too many messages was stopped.')); return; }
    try {
      const command = event.data;
      if (!command || typeof command !== 'object') throw new Error();
      if (command.type === '__pong') { lastPong = performance.now(); return; }
      if (command.type === 'query') {
        if (typeof command.name !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(command.name) || typeof command.value !== 'string' || command.value.length > 200) throw new Error();
        const url = new URL(location.href); url.searchParams.set(command.name, command.value); navigatePage(url); return;
      }
      if (typeof command.selector !== 'string' || command.selector.length > 200) throw new Error();
      const elements = [...root.querySelectorAll<HTMLElement>(command.selector)].slice(0, 30);
      for (const element of elements) {
        if (element === errorBox || element.contains(errorBox)) continue;
        if (command.type === 'text' && typeof command.value === 'string' && command.value.length <= 20_000) element.textContent = command.value;
        else if (command.type === 'hidden' && typeof command.value === 'boolean') element.hidden = command.value;
        else if (command.type === 'class' && typeof command.name === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(command.name) && typeof command.value === 'boolean') element.classList.toggle(command.name, command.value);
        else if (command.type === 'style' && command.name && allowedStyles.has(command.name) && typeof command.value === 'string' && command.value.length < 200 && !/url|expression/i.test(command.value)) element.style.setProperty(command.name, command.value);
        else if (command.type === 'attribute' && command.name && /^(src|href|alt|title|download|aria-[a-z-]+|tabindex)$/.test(command.name) && typeof command.value === 'string' && command.value.length < 2000) {
          if (['src', 'href'].includes(command.name) && !/^\/(?!\/)/.test(command.value)) throw new Error();
          element.setAttribute(command.name, command.value);
        } else if (command.type === 'dialog' && element instanceof HTMLDialogElement && typeof command.value === 'boolean') {
          if (command.value && !element.open) element.showModal();
          if (!command.value) element.close();
        } else if (command.type === 'list' && Array.isArray(command.items) && command.items.length <= 1000) {
          const nodes = command.items.map((item) => {
            if (!allowedTags.has(item.tag) || typeof item.text !== 'string' || item.text.length > 1000) throw new Error();
            const node = document.createElement(item.tag); node.textContent = item.text; return node;
          });
          element.replaceChildren(...nodes);
        } else throw new Error();
      }
    } catch { stop(t('A script returning invalid data was stopped.')); }
  };
  const send = (data: unknown) => { if (!stopped) worker.postMessage(data); };
  watchdog = setInterval(() => {
    if (document.hidden) { lastPong = performance.now(); return; }
    if (performance.now() - lastPong > 6000) { stop(t('The script stopped responding and was terminated. Navigation is still available.')); return; }
    send({ type: '__ping' });
  }, 1000);
  const options = { signal: listeners.signal };
  document.addEventListener('visibilitychange', () => { lastPong = performance.now(); }, options);
  root.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (!target || !root.contains(target)) return;
    event.preventDefault();
    send({ type: 'event', action: target.dataset.action, value: target.dataset.value });
  }, options);
  root.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.change) send({ type: 'event', action: target.dataset.change, value: target.value });
  }, options);
  root.addEventListener('keydown', (event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (target && ['Enter', ' '].includes(event.key) && target.getAttribute('role') === 'button') {
      event.preventDefault(); send({ type: 'event', action: target.dataset.action, value: target.dataset.value });
    } else send({ type: 'event', action: 'key', key: event.key });
  }, options);
  root.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('cancel', () => send({ type: 'event', action: 'cancel' }), options));
  const transfers: Transferable[] = [];
  const canvases: Record<string, OffscreenCanvas> = {};
  for (let canvas of root.querySelectorAll<HTMLCanvasElement>('canvas[data-canvas]')) {
    // A restored BFCache document cannot transfer the same canvas a second time.
    if (canvas.dataset.transferred) {
      const fresh = canvas.cloneNode(true) as HTMLCanvasElement;
      canvas.replaceWith(fresh); canvas = fresh;
    }
    const name = canvas.dataset.canvas!;
    try { canvases[name] = canvas.transferControlToOffscreen(); canvas.dataset.transferred = 'true'; transfers.push(canvases[name]!); }
    catch { stop(t('This browser does not support this part of the page.')); return; }
    let drawing = false;
    const point = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      return [Math.max(0, Math.min(canvas.width, (event.clientX - box.left) * canvas.width / box.width)), Math.max(0, Math.min(canvas.height, (event.clientY - box.top) * canvas.height / box.height))];
    };
    canvas.addEventListener('pointerdown', (event) => { drawing = true; canvas.setPointerCapture(event.pointerId); send({ type: 'event', action: 'pointerdown', canvas: name, point: point(event) }); }, options);
    canvas.addEventListener('pointermove', (event) => { if (drawing) send({ type: 'event', action: 'pointermove', canvas: name, point: point(event) }); }, options);
    const finish = () => { if (drawing) { drawing = false; send({ type: 'event', action: 'pointerup', canvas: name }); } };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, finish, options);
  }
  try {
    const context = JSON.parse(root.querySelector<HTMLElement>('[data-context]')?.dataset.context ?? '{}');
    worker.postMessage({ type: 'init', context, canvases, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }, transfers);
  } catch { stop(t('Invalid plugin configuration.')); }
  return () => stop();
}
