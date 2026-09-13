import test from 'node:test';
import assert from 'node:assert/strict';
import { createMenuTree, findMenuNode, moveMenuNode, serializeMenu } from '../src/client/panel/menu/tree.js';

test('menu model reorders, nests and promotes whole branches without mutating the previous tree', () => {
  let serial = 0;
  const nodes = createMenuTree([
    { title: 'First', href: '/first', children: [{ title: 'Child', href: '/child', children: [] }] },
    { title: 'Second', href: '/second', children: [] },
  ], () => String(++serial));
  const before = JSON.stringify(nodes);
  const reordered = moveMenuNode(nodes, '3', null, 0);
  assert.equal(reordered[0]!.title, 'Second');
  const nested = moveMenuNode(reordered, '1', '3', 0);
  assert.equal(nested.length, 1);
  assert.equal(findMenuNode(nested, '2')!.parent, '1');
  const promoted = moveMenuNode(nested, '1', null, 1);
  assert.equal(promoted.length, 2);
  assert.equal(JSON.stringify(nodes), before);
  assert.deepEqual(serializeMenu(promoted).map(node => node.href), ['/second', '/first']);
  assert.ok(!JSON.stringify(serializeMenu(promoted)).includes('"id"'));
});

test('invalid menu drops cannot create cycles, lose nodes or exceed nine levels', () => {
  const nodes = createMenuTree([{ title: 'Root', href: '/', children: [{ title: 'Child', href: '/child', children: [] }] }]);
  const root = nodes[0]!, child = root.children[0]!;
  assert.equal(moveMenuNode(nodes, root.id, root.id, 0), nodes);
  assert.equal(moveMenuNode(nodes, root.id, child.id, 0), nodes);
  assert.equal(moveMenuNode(nodes, root.id, 'missing', 0), nodes);
  let last = root;
  for (let depth = 1; depth < 9; depth++) {
    if (!last.children.length) last.children.push(...createMenuTree([{ title: 'Deep', href: '/', children: [] }]));
    last = last.children[0]!;
  }
  const extra = createMenuTree([{ title: 'Extra', href: '/', children: [] }])[0]!;
  nodes.push(extra);
  assert.equal(moveMenuNode(nodes, extra.id, last.id, 0), nodes);
  assert.throws(() => serializeMenu(createMenuTree([{ title: ' ', href: '/', children: [] }])));
});

test('external targets survive tree moves and serialization, internal links omit them', () => {
  const nodes = createMenuTree([
    { title: 'Root', href: '/', children: [] },
    { title: 'External', href: 'https://example.org', target: '_blank', children: [] },
    { title: 'Legacy', href: 'https://example.org/legacy', children: [] },
  ]);
  const moved = moveMenuNode(nodes, nodes[1]!.id, nodes[0]!.id, 0);
  const saved = serializeMenu(moved);
  assert.equal(saved[0]!.children[0]!.target, '_blank');
  assert.equal(saved[1]!.target, '_self');
  moved[0]!.children[0]!.href = '/internal';
  assert.equal(serializeMenu(moved)[0]!.children[0]!.target, undefined);
});
