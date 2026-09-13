import test from 'node:test';
import assert from 'node:assert/strict';
import { parentPage, parsePage, navigation, type Content } from '../src/content.js';
import { activeMenu } from '../src/content/menu.js';

test('active menu follows the closest page and its configured branch, not string prefixes or external URLs', () => {
  const menu = [
    { title: 'Home', href: '/', children: [] },
    { title: 'Group', href: '/group', children: [
      { title: 'Section', href: '/group/section', children: [{ title: 'Flat plugin', href: '/plugin', children: [] }] },
      { title: 'Outside', href: 'https://example.org/group', children: [] },
    ] },
    { title: 'Similar', href: '/groupish', children: [] },
  ];
  const snapshot = JSON.stringify(menu);
  const root = activeMenu(menu, '/');
  assert.equal(root[0]!.active, 'page'); assert.equal(root[1]!.active, 'false');
  const exact = activeMenu(menu, '/group');
  assert.equal(exact[1]!.active, 'page'); assert.equal(exact[0]!.active, 'false');
  const deep = activeMenu(menu, '/group/section/unlisted?filter=one#anchor');
  assert.equal(deep[1]!.active, 'ancestor'); assert.equal(deep[1]!.children[0]!.active, 'ancestor');
  assert.equal(deep[1]!.children[1]!.active, 'false');
  const flat = activeMenu(menu, '/plugin');
  assert.equal(flat[1]!.active, 'ancestor'); assert.equal(flat[1]!.children[0]!.active, 'ancestor');
  assert.equal(flat[1]!.children[0]!.children[0]!.active, 'page');
  assert.equal(activeMenu(menu, '/groupish')[1]!.active, 'false');
  assert.ok(activeMenu(menu, '/missing').every(item => item.active === 'false'));
  assert.equal(JSON.stringify(menu), snapshot, 'Navigation must never mutate the cached menu');
  const content: Content = { site: { title: 'Test', theme: 'default', home: '/', language: 'en', languages: ['en'], redirects: {}, menu }, pages: new Map() };
  const nav = navigation(content, parsePage('---\ntitle: Child\n---\n', '/group/section/unlisted'));
  assert.deepEqual(nav.submenu.map(item => item.href), ['/group/section', '/plugin', 'https://example.org/group']);
});

test('parent navigation uses existing ancestors, direct menu parents and home fallback', () => {
  const content: Content = {
    site: { title: 'Test', theme: 'default', home: '/', language: 'en', languages: ['en'], redirects: {}, menu: [
      { title: 'Group', href: '/group', children: [
        { title: 'Self link', href: '/group', children: [] },
        { title: 'Plugin', href: '/plugin', children: [{ title: 'Nested', href: '/nested', children: [] }] },
      ] },
    ] },
    pages: new Map(['/group', '/group/article', '/plugin', '/nested', '/standalone'].map(href => [href, parsePage('---\ntitle: Test\n---\n', href)])),
  };
  for (const [href, parent] of [
    ['/', ''], ['/group', '/'], ['/group/article', '/group'], ['/group/article/detail', '/group/article'],
    ['/group/missing/deep', '/group'], ['/plugin', '/group'], ['/nested', '/plugin'], ['/standalone', '/'], ['/missing', '/'],
  ]) assert.equal(parentPage(content, href!), parent);
});
