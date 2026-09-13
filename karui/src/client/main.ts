import { initGalleries } from './gallery/index.js';
import { initNavigation } from './navigation/index.js';
import { initScrollControls } from './navigation/scroll-controls.js';
import { startWidget } from './widgets/worker-host.js';
import { initTheme } from './themes.js';
import { initMobileNavigation } from './navigation/mobile.js';

document.querySelector<HTMLSelectElement>('[data-language-select]')?.addEventListener('change', event => {
  const target = event.currentTarget as HTMLSelectElement;
  location.assign(target.selectedOptions[0]?.dataset.href ?? `?lang=${encodeURIComponent(target.value)}`);
});

const updateScrollButton = initScrollControls();
if (document.body.dataset.print === 'true') window.addEventListener('load', () => window.print());

await initTheme();
const mobileNavigation = initMobileNavigation();
let navigatePage = (url: URL) => { location.assign(url); };
navigatePage = initNavigation(() => {
  mobileNavigation.refresh();
  const cleanupGallery = initGalleries();
  const widgets = [...document.querySelectorAll<HTMLElement>('[data-widget]')]
    .map(root => startWidget(root, url => navigatePage(url)));
  updateScrollButton();
  return () => {
    cleanupGallery();
    widgets.forEach(stop => stop?.());
  };
}, mobileNavigation.navigation);
