import { initEditor } from './editor/index.js';
import { initMenu, initMenuTranslations } from './menu/index.js';
import { mountPhotos } from './photos/index.js';
import { uploadPhoto } from './photos/upload.js';
import { t } from '../i18n.js';

const panel = document.querySelector<HTMLElement>('[data-panel]')!;
const csrf = panel.dataset.csrf!;
const status = panel.querySelector<HTMLElement>('[data-panel-status]')!;
let unsaved = false, subpageOrderDirty = false, backgroundTask = false;
const dirty = () => { unsaved = true; const label = panel.querySelector('[data-dirty-status]'); if (label) label.textContent = t('Unsaved changes'); };
const clean = () => { unsaved = false; };
window.addEventListener('beforeunload', event => { if (unsaved || subpageOrderDirty || backgroundTask) { event.preventDefault(); event.returnValue = ''; } });
const showError = (error: unknown) => { status.textContent = (error as Error).message; status.classList.add('error'); status.hidden = false; status.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
async function api(url: string, body: unknown) {
  const multipart = body instanceof FormData;
  const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, ...(!multipart ? { 'Content-Type': 'application/json' } : {}) }, body: multipart ? body : JSON.stringify(body) });
  if (response.status === 401) {
    location.assign('/panel');
    return new Promise<never>(() => undefined);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? t('Changes could not be saved.'));
  return result;
}
function form(selector: string, submit: (data: Record<string, FormDataEntryValue>, element: HTMLFormElement) => Promise<void>) {
  for (const element of panel.querySelectorAll<HTMLFormElement>(selector)) element.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter instanceof HTMLButtonElement ? event.submitter : element.querySelector<HTMLButtonElement>('[type=submit]');
    if (button) button.disabled = true;
    try { await submit(Object.fromEntries(new FormData(element)), element); }
    catch (error) { showError(error); } finally { if (button) button.disabled = false; }
  });
}
panel.querySelector<HTMLInputElement>('[data-page-filter]')?.addEventListener('input', event => {
  const value = (event.target as HTMLInputElement).value.toLocaleLowerCase('pl');
  for (const row of panel.querySelectorAll<HTMLElement>('[data-page-row]')) row.hidden = !row.textContent?.toLocaleLowerCase('pl').includes(value);
});
const slug = panel.querySelector<HTMLInputElement>('[data-slug]');
if (slug) {
  let custom = false; slug.addEventListener('input', () => { custom = true; });
  panel.querySelector<HTMLInputElement>('[data-title]')!.addEventListener('input', event => {
    if (!custom) slug.value = (event.target as HTMLInputElement).value.toLowerCase().replaceAll('ł', 'l').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  });
}
form('[data-create-page]', async data => { const result = await api('/panel/api/pages/create', data); location.href = '/panel/page?path=' + encodeURIComponent(result.path); });
form('[data-site-settings]', async (data, element) => {
  const localized = element.dataset.language !== element.dataset.defaultLanguage;
  await api(localized ? '/panel/api/settings/translations' : '/panel/api/settings', localized
    ? { ...data, language: element.dataset.language }
    : { ...data, showBrandName: data.showBrandName === 'on' });
  clean();
  location.reload();
});
const settings = panel.querySelector<HTMLFormElement>('[data-site-settings]');
settings?.querySelector<HTMLSelectElement>('[data-settings-language]')?.addEventListener('change', event => {
  const select = event.currentTarget as HTMLSelectElement;
  if (unsaved && !confirm(t('Switch language and discard unsaved changes?'))) {
    select.value = settings.dataset.language!;
    return;
  }
  const url = new URL(location.href);
  url.searchParams.set('language', select.value);
  location.assign(url);
});
settings?.addEventListener('input', event => {
  const target = event.target;
  if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) && !target.matches('[data-settings-language]')) dirty();
});
const edit = panel.querySelector<HTMLElement>('[data-edit-page]');
if (edit) {
  let saving = false;
  const photoManager = edit.querySelector<HTMLElement>('[data-photo-manager]')!;
  const editor = initEditor(edit, dirty);
  const savePage = edit.querySelector<HTMLFormElement>('[data-save-page]')!;
  edit.addEventListener('input', event => {
    const target = event.target;
    if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) && target.form === savePage) dirty();
  });
  const identity = () => ({ path: edit.dataset.path, language: edit.dataset.language, revision: edit.dataset.revision });
  edit.querySelector<HTMLSelectElement>('[data-page-language]')?.addEventListener('change', event => {
    const select = event.currentTarget as HTMLSelectElement;
    if ((unsaved || backgroundTask) && !confirm(t('Switch language and discard unsaved changes?'))) {
      select.value = edit.dataset.language!;
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set('language', select.value);
    location.assign(url);
  });
  form('[data-save-page]', async data => {
    if (backgroundTask) throw new Error(t('Wait for the gallery operation to finish. Your content will not be lost.'));
    saving = true; photoManager.inert = true;
    try {
      await api('/panel/api/pages/save', { ...data, ...identity(), body: editor.source(), showPrint: data.showPrint === 'on', showPdf: data.showPdf === 'on', showSubpages: data.showSubpages === 'on', published: data.published === 'on' }); clean(); location.reload();
    } catch (error) { saving = false; photoManager.inert = false; throw error; }
  });
  edit.querySelector('[data-delete-page]')!.addEventListener('click', async () => {
    if (backgroundTask || saving) { showError(new Error(t('Wait for saving to finish.'))); return; }
    if (!confirm(t('Delete this page? A copy of its content will be stored in the private trash.'))) return;
    try { await api('/panel/api/pages/delete', identity()); clean(); location.href = '/panel/pages'; } catch (error) { showError(error); }
  });
  mountPhotos(photoManager, {
    upload: (file, alt, progress) => uploadPhoto('/panel/api/photos/upload?' + new URLSearchParams({ path: edit.dataset.path!, language: edit.dataset.language!, revision: edit.dataset.revision!, alt }), csrf, file, progress),
    change: (index, action, alt) => api('/panel/api/photos/change', { ...identity(), index, action, alt }),
    copy: sourceLanguage => api('/panel/api/photos/copy', { ...identity(), sourceLanguage }),
    committed: result => { edit.dataset.revision = result.revision; edit.querySelector('[data-photo-count]')!.textContent = t('{count} photos', { count: result.gallery.length }); },
    busy: value => { backgroundTask = value; edit.querySelector<HTMLButtonElement>('[data-page-submit]')!.disabled = value; },
    insert: editor.insertImage, error: showError,
  });
  const orderForm = edit.querySelector<HTMLFormElement>('[data-subpage-order]');
  if (orderForm) {
    const orderStatus = orderForm.querySelector<HTMLElement>('[data-subpage-order-status]')!;
    const inputs = () => [...orderForm.querySelectorAll<HTMLInputElement>('[data-subpage-order-input]')];
    orderForm.addEventListener('input', () => { subpageOrderDirty = true; orderStatus.textContent = t('Unsaved order'); });
    orderForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.submitter instanceof HTMLButtonElement ? event.submitter : orderForm.querySelector<HTMLButtonElement>('[type=submit]');
      if (button) button.disabled = true;
      try {
        const result = await api('/panel/api/pages/subpage-order', {
          parent: orderForm.dataset.parent,
          language: orderForm.dataset.language,
          children: inputs().map(input => ({ path: input.dataset.childPath, revision: input.dataset.childRevision, order: Number(input.value) })),
        }) as { children: Array<{ path: string; order: number; revision: string }> };
        const revisions = new Map(result.children.map(child => [child.path, child.revision]));
        for (const input of inputs()) input.dataset.childRevision = revisions.get(input.dataset.childPath!) ?? input.dataset.childRevision;
        const list = orderForm.querySelector<HTMLElement>('[data-subpage-list]')!;
        const rows = [...list.querySelectorAll<HTMLElement>('[data-subpage-row]')].sort((a, b) => {
          const order = Number(a.querySelector<HTMLInputElement>('[data-subpage-order-input]')!.value) - Number(b.querySelector<HTMLInputElement>('[data-subpage-order-input]')!.value);
          return order || a.dataset.title!.localeCompare(b.dataset.title!, document.documentElement.lang || 'en');
        });
        rows.forEach((row, index) => { row.querySelector<HTMLElement>('[data-subpage-number]')!.textContent = `${index + 1}.`; list.append(row); });
        subpageOrderDirty = false;
        orderStatus.textContent = t('Order saved');
      } catch (error) { showError(error); } finally { if (button) button.disabled = false; }
    });
  }
}
const menu = panel.querySelector<HTMLElement>('[data-menu-screen]');
if (menu) {
  menu.querySelector<HTMLSelectElement>('[data-menu-language]')!.addEventListener('change', event => {
    const select = event.currentTarget as HTMLSelectElement;
    if (unsaved && !confirm(t('Switch language and discard unsaved changes?'))) {
      select.value = menu.dataset.language!;
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set('language', select.value);
    location.assign(url);
  });
  if (menu.querySelector('[data-menu-editor]')) initMenu(menu, value => api('/panel/api/menu', value), dirty, clean);
  else initMenuTranslations(menu, value => api('/panel/api/menu/translations', value), dirty, clean);
}
form('[data-account-form]', async data => { const result = await api('/panel/api/accounts/save', { ...data, create: data.create === 'true' }); location.href = result.loggedOut ? '/panel' : '/panel/accounts'; });
for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-delete-account]')) button.addEventListener('click', async () => {
  if (!confirm(t('Delete account {login}?', { login: button.dataset.deleteAccount! }))) return;
  button.disabled = true;
  try { await api('/panel/api/accounts/delete', { login: button.dataset.deleteAccount }); location.reload(); } catch (error) { showError(error); } finally { button.disabled = false; }
});
