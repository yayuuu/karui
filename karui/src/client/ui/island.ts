import { render, type ComponentChildren } from 'preact';

/** Preact owns only this host. SSR content, canvases and worker DOM stay outside. */
export function createIsland(name: string, parent: HTMLElement = document.body) {
  const host = document.createElement('div');
  host.dataset.uiIsland = name;
  host.style.display = 'contents';
  parent.append(host);
  let disposed = false;
  return {
    render(view: ComponentChildren) {
      if (!disposed) render(view, host);
    },
    dispose() {
      if (disposed) return;
      render(null, host);
      host.remove();
      disposed = true;
    },
  };
}
