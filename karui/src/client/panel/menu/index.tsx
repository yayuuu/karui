import { render } from 'preact';
import type { MenuItem } from '../../../content.js';
import { createMenuTree, findMenuNode, moveMenuNode, serializeMenu } from './tree.js';
import { MenuItems, type Actions, type PageOption } from './components.js';
import { attachSortable } from './sortable.js';
import { t } from '../../i18n.js';

export function initMenu(root: HTMLElement, save: (value: unknown) => Promise<unknown>, dirty: () => void, clean: () => void) {
  const editor = root.querySelector<HTMLElement>('[data-menu-editor]')!;
  const pages: PageOption[] = [{ title: t('Home page'), href: '/' }, ...JSON.parse(editor.dataset.pages!)];
  const tree = editor.querySelector<HTMLUListElement>('[data-menu-root]')!;
  const status = root.querySelector<HTMLElement>('[data-menu-status]')!;
  let nodes = createMenuTree(JSON.parse(editor.dataset.menu!) as MenuItem[]);
  const draw = () => render(<MenuItems nodes={nodes} pages={pages} actions={actions} />, tree);
  const changed = () => { dirty(); status.textContent = t('Unsaved changes'); draw(); };
  const actions: Actions = {
    move: (id, parent, index) => {
      const next = moveMenuNode(nodes, id, parent, index);
      if (next === nodes) return;
      nodes = next;
      changed();
    },
    edit: (id, field, value) => {
      const found = findMenuNode(nodes, id);
      if (found) {
        found.node[field] = value;
        if (field === 'href' && value.startsWith('/')) delete found.node.target;
        changed();
      }
    },
    target: (id, value) => {
      const found = findMenuNode(nodes, id);
      if (found) { found.node.target = value; changed(); }
    },
    add: parent => {
      const list = parent ? findMenuNode(nodes, parent)?.node.children : nodes;
      if (!list) return;
      const item = createMenuTree([{ title: 'Nowy przycisk', href: '/', children: [] }])[0]!;
      list.push(item);
      changed();
      tree.querySelector<HTMLInputElement>(`[data-node-id="${item.id}"] > .menu-item > input`)?.focus();
    },
    remove: id => {
      if (!confirm(t('Delete this menu item and its submenu? The change will be published after saving.'))) return;
      const found = findMenuNode(nodes, id);
      if (found) { found.siblings.splice(found.index, 1); changed(); }
    },
  };
  draw();
  attachSortable(tree, actions.move);
  root.querySelector('[data-menu-add]')!.addEventListener('click', () => actions.add(null));
  root.querySelector('[data-menu-save]')!.addEventListener('click', async () => {
    const button = root.querySelector<HTMLButtonElement>('[data-menu-save]')!;
    button.disabled = true;
    try { await save({ menu: serializeMenu(nodes), revision: editor.dataset.revision }); clean(); location.reload(); }
    catch (error) { status.textContent = (error as Error).message; }
    finally { button.disabled = false; }
  });
}

export function initMenuTranslations(root: HTMLElement, save: (value: unknown) => Promise<unknown>, dirty: () => void, clean: () => void) {
  const editor = root.querySelector<HTMLElement>('[data-menu-translations]')!;
  const status = root.querySelector<HTMLElement>('[data-menu-status]')!;
  const inputs = [...editor.querySelectorAll<HTMLInputElement>('[data-menu-translation]')];
  for (const input of inputs) input.addEventListener('input', () => {
    dirty();
    status.textContent = t('Unsaved changes');
  });
  root.querySelector<HTMLButtonElement>('[data-menu-save]')!.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await save({
        language: editor.dataset.language,
        revision: editor.dataset.revision,
        siteRevision: editor.dataset.siteRevision,
        translations: inputs.map(input => ({ source: input.dataset.source, translation: input.value })),
      });
      clean();
      location.reload();
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      button.disabled = false;
    }
  });
}
