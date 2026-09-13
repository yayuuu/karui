import Sortable from 'sortablejs';

export type Move = (id: string, parent: string | null, index: number) => void;

export function attachSortable(list: HTMLUListElement, move: Move) {
  return new Sortable(list, {
    group: 'menu', animation: 150, handle: '.menu-handle', draggable: '.menu-node',
    fallbackOnBody: true, swapThreshold: .65, emptyInsertThreshold: 12,
    ghostClass: 'menu-ghost', chosenClass: 'menu-chosen',
    onEnd: event => {
      const id = event.item.dataset.nodeId!;
      const parent = event.to.dataset.parent || null;
      const index = event.newDraggableIndex ?? 0;
      // Sortable previews the drag. Restore its DOM mutation before Preact applies
      // the model update, so the two renderers never own conflicting trees.
      event.item.remove();
      event.from.insertBefore(event.item, event.from.children[event.oldDraggableIndex ?? 0] ?? null);
      move(id, parent, index);
    },
  });
}
