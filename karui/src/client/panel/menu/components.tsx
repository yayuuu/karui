import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { MenuNode } from './tree.js';
import { attachSortable, type Move } from './sortable.js';
import { t } from '../../i18n.js';

export type PageOption = { title: string; href: string };
export type Actions = {
  move: Move;
  edit: (id: string, field: 'title' | 'href', value: string) => void;
  target: (id: string, value: '_self' | '_blank') => void;
  add: (parent: string | null) => void;
  remove: (id: string) => void;
};

function ActionButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: ComponentChildren }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function MenuChildren({ node, pages, actions, depth }: { node: MenuNode; pages: PageOption[]; actions: Actions; depth: number }) {
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const sortable = attachSortable(list.current!, actions.move);
    return () => sortable.destroy();
  }, [actions]);
  return (
    <ul ref={list} class="menu-children" aria-label={t('Submenu')} data-parent={node.id}>
      <MenuItems nodes={node.children} pages={pages} actions={actions} depth={depth + 1} />
    </ul>
  );
}

export function MenuItems({ nodes, pages, actions, depth = 0 }: { nodes: MenuNode[]; pages: PageOption[]; actions: Actions; depth?: number }) {
  return <>{nodes.map(node => (
    <li key={node.id} class="menu-node" data-node-id={node.id}>
      <div class="menu-item">
        <button type="button" class="menu-handle" aria-label={t('Drag menu item')}>⠿</button>
        <input value={node.title} maxLength={200} required aria-label={t('Menu item name')}
          onInput={event => actions.edit(node.id, 'title', event.currentTarget.value)} />
        <select value={node.href.startsWith('/') ? node.href : '__external__'} aria-label={t('Target page')}
          onChange={event => actions.edit(node.id, 'href', event.currentTarget.value === '__external__' ? 'https://' : event.currentTarget.value)}>
          {pages.map(page => <option key={page.href} value={page.href}>{page.title} ({page.href})</option>)}
          <option value="__external__">{t('Custom external link')}</option>
        </select>
        {!node.href.startsWith('/') && <input type="url" value={node.href} maxLength={2000} aria-label={t('External address')} placeholder="https://example.com"
          onInput={event => actions.edit(node.id, 'href', event.currentTarget.value)} />}
        {!node.href.startsWith('/') && <select class="menu-link-target" aria-label={t('Open link')} value={node.target ?? '_self'}
          onChange={event => actions.target(node.id, event.currentTarget.value === '_blank' ? '_blank' : '_self')}>
          <option value="_self">{t('In the same tab')}</option>
          <option value="_blank">{t('In a new tab')}</option>
        </select>}
        <div class="menu-controls">
          <ActionButton label={t('Add submenu item')} disabled={depth >= 8} onClick={() => actions.add(node.id)}>+</ActionButton>
          <ActionButton label={t('Delete menu item')} onClick={() => actions.remove(node.id)}>×</ActionButton>
        </div>
      </div>
      <MenuChildren node={node} pages={pages} actions={actions} depth={depth} />
    </li>
  ))}</>;
}
