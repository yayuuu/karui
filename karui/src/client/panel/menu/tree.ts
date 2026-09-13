import type { MenuItem } from '../../../content.js';
import { t } from '../../i18n.js';

export type MenuNode = Omit<MenuItem, 'children'> & { id: string; children: MenuNode[] };
export const createMenuTree = (items: MenuItem[], id: () => string = () => crypto.randomUUID()): MenuNode[] =>
  items.map(item => ({ ...item, id: id(), children: createMenuTree(item.children, id) }));

export function findMenuNode(nodes: MenuNode[], id: string, parent: string | null = null):
  { node: MenuNode; siblings: MenuNode[]; index: number; parent: string | null } | undefined {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) return { node, siblings: nodes, index, parent };
    const found = findMenuNode(node.children, id, node.id);
    if (found) return found;
  }
}

/** Model is authoritative; invalid drops never lose a branch or form a cycle. */
export function moveMenuNode(nodes: MenuNode[], id: string, parent: string | null, index: number): MenuNode[] {
  const next = structuredClone(nodes);
  const found = findMenuNode(next, id);
  if (!found || parent === id || (parent && findMenuNode(found.node.children, parent))) return nodes;
  const target = parent ? findMenuNode(next, parent)?.node.children : next;
  if (!target) return nodes;
  found.siblings.splice(found.index, 1);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, found.node);
  const depth = (items: MenuNode[]): number => items.length ? 1 + Math.max(...items.map(item => depth(item.children))) : 0;
  return depth(next) <= 9 ? next : nodes;
}

export function serializeMenu(nodes: MenuNode[], depth = 0): MenuItem[] {
  if (depth > 8 && nodes.length) throw new Error(t('The menu may have at most 9 levels.'));
  return nodes.map(node => {
    const title = node.title.trim();
    if (!title) throw new Error(t('Every menu item must have a name.'));
    return { title, href: node.href, ...(!node.href.startsWith('/') ? { target: node.target ?? '_self' } : {}), children: serializeMenu(node.children, depth + 1) };
  });
}
