import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePage, siteSchema, navigation, type Photo } from '../src/content.js';
import { inlineGallery, visibleGallery } from '../src/gallery.js';
import { PanelFiles } from '../src/admin/files.js';
import { PanelStore } from '../src/admin/store.js';
import { buildApp } from '../src/app.js';
import { configFromEnv } from '../src/config.js';
import { fragmentType } from '../src/page-fragment.js';

test('explicit formats and legacy Markdown/HTML are rendered without changing source', () => {
  const page = (body: string, format = '') => parsePage(`---\ntitle: Test\n${format ? `format: ${format}\n` : ''}---\n${body}`, '/test');
  assert.match(page('**Bold**').html, /<strong>Bold<\/strong>/);
  assert.equal(page('<p>Old</p>').format, 'html');
  assert.equal(page('').format, 'markdown');
  assert.match(page('**Bold**\n\n<div data-custom="1">HTML</div>', 'markdown').html, /data-custom="1"/);
  assert.equal(page('**not markdown**<b>HTML</b>', 'html').html, '**not markdown**<b>HTML</b>');
});

test('gallery visibility matches actual inline images, variants, relative URLs and srcset', () => {
  const gallery: Photo[] = Array.from({ length: 5 }, (_, i) => ({ src: `/media/${i}.png`, thumbnail: `/media/${i}.small.png`, download: `/media/${i}.full.png`, alt: '' }));
  const page = { ...parsePage('---\ntitle: Test\n---\n', '/parent/test'), gallery, galleryVisibility: 'unused' as const,
    html: '<img src="../media/0.png?v=2"><img src="https://example.test/media/1.small.png"><picture><source srcset="/media/2.full.png 2x"></picture><img src="/media/%33.png">' +
      '<!-- <img src="/media/4.png"> --><script>"<img src=/media/4.png>"</script><code>&lt;img src="/media/4.png"&gt;</code><img src="https://other.test/media/4.png">' };
  assert.deepEqual(visibleGallery(page, 'https://example.test'), [gallery[4]]);
  assert.equal(visibleGallery({ ...page, galleryVisibility: 'all' }, 'https://example.test'), gallery);
  assert.deepEqual(visibleGallery({ ...page, galleryVisibility: 'hidden' }, 'https://example.test'), []);
  assert.match(page.html, /<img/);
});

test('inline gallery photos render their WebP preview and remain lightbox triggers', () => {
  const photos: Photo[] = [{ src: '/media/gallery/photo.large.png', thumbnail: '/media/gallery/photo.small.webp', download: '/media/gallery/photo.download.png', alt: 'Preview' }];
  const direct = inlineGallery('<p><img src="/media/gallery/photo.large.png" alt="Preview"></p>', '/article', photos);
  assert.deepEqual(direct, { html: '<p><img src="/media/gallery/photo.large.png" alt="Preview"></p>', count: 0 });
  const linked = inlineGallery('<a href="/media/gallery/photo.large.png"><img src="/media/gallery/photo.small.webp"></a>', '/article', photos);
  assert.equal(linked.count, 1);
  assert.match(linked.html, /<a href="\/media\/gallery\/photo\.large\.png" data-gallery-src="\/media\/gallery\/photo\.large\.png" class="inline-gallery-photo">/);
  assert.match(linked.html, /loading="lazy" decoding="async"/);
  assert.equal(inlineGallery('<a href="/media/gallery/photo.download.png"><img src="/media/gallery/photo.small.webp"></a>', '/article', photos).count, 0);
  assert.equal(inlineGallery('<a href="/media/gallery/photo.large.png"><img src="/media/gallery/photo.large.png"></a>', '/article', photos).count, 0);
});

test('external menu links accept only safe absolute HTTP(S) addresses', () => {
  for (const target of ['_blank', '_self'] as const) {
    assert.equal(siteSchema.parse({ menu: [{ title: 'Link', href: 'https://example.org', target }] }).menu[0]!.target, target);
  }
  for (const target of ['_top', 'arbitrary-window', '"><script>']) {
    assert.equal(siteSchema.safeParse({ menu: [{ title: 'Link', href: 'https://example.org', target }] }).success, false);
  }
  for (const href of ['https://example.org/?a=1&b=2#photos', 'http://example.org/', '/']) {
    assert.equal(siteSchema.parse({ menu: [{ title: 'Link', href }] }).menu[0]!.href, href);
  }
  for (const href of ['javascript:alert(1)', 'data:text/html,test', '//example.org', 'https:example.org', 'https://user:pass@example.org', 'https://example.org\\evil', 'https://example.org/with space']) {
    assert.equal(siteSchema.safeParse({ menu: [{ title: 'Link', href }] }).success, false, href);
  }
});

test('unpublished pages and descendants return 404, disappear from SSR and fragments, remain editable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'karui-settings-'));
  const files = new PanelFiles(directory), store = new PanelStore(files);
  await files.write('site.yml', 'title: Test\nhome: /secret\nmenu:\n  - title: Secret\n    href: /secret\n  - title: Public\n    href: /public\n    children:\n      - title: Submenu outside\n        href: https://example.org/submenu\n        target: _blank\n  - title: Outside\n    href: https://example.org\n    target: _blank\n');
  await files.write('pages/secret/index.md', '---\ntitle: Secret\npublished: false\nplugin: private\n---\nPRIVATE TEXT');
  await files.write('pages/secret/child.md', '---\ntitle: Secret child\n---\nPRIVATE CHILD');
  await files.write('pages/public.md', '---\ntitle: Public\n---\nPUBLIC TEXT');
  await files.write('plugins/private/client.js', 'throw new Error("must not execute")');
  const app = await buildApp({ ...configFromEnv(), contentDir: directory, contentCacheDir: join(directory, 'cache') });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  for (const url of ['/secret', '/secret/child', '/secret/api', '/se%63ret', '/plugin-assets/private/client.js']) {
    for (const method of ['GET', 'HEAD'] as const) {
      const response = await app.inject({ url, method });
      assert.equal(response.statusCode, 404, `${method} ${url}`);
      assert.doesNotMatch(response.body, /PRIVATE TEXT|PRIVATE CHILD/);
    }
  }
  assert.equal((await app.inject({ url: '/secret/api', method: 'POST', payload: {} })).statusCode, 404);
  const home = await app.inject('/'); assert.equal(home.statusCode, 200);
  assert.doesNotMatch(home.body, /href="\/secret"/);
  assert.match(home.body, /href="https:\/\/example.org"/);
  assert.match(home.body, /href="https:\/\/example.org"\s+target="_blank" rel="noopener noreferrer"/);
  const publicFragment = (await app.inject({ url: '/public', headers: { accept: fragmentType } })).json();
  assert.match(publicFragment.menu, /target="_blank" rel="noopener noreferrer"/);
  assert.match(publicFragment.submenu, /href="https:\/\/example.org\/submenu"\s+target="_blank" rel="noopener noreferrer"/);
  const fragment = await app.inject({ url: '/secret', headers: { accept: fragmentType } });
  assert.equal(fragment.statusCode, 404);
  assert.doesNotMatch(fragment.json().menu, /href="\/secret"/);
  assert.match((await store.page('/secret')).body, /PRIVATE TEXT/);
  const original = await store.page('/secret');
  await store.savePage({ path: '/secret', revision: original.revision, title: 'Secret', order: 0, body: '**Published**', published: true, format: 'markdown', galleryVisibility: 'unused' });
  assert.equal((await store.page('/secret')).document.get('galleryVisibility'), 'unused');
  // The app's cache has its own refresh interval; a fresh repository confirms file state.
  const restored = await store.repository.load();
  assert.equal(restored.pages.get('/secret')!.published, true);
  await store.createPage({ title: 'New', slug: 'new', parent: '/' });
  const created = await store.page('/new');
  assert.equal(created.document.get('format'), 'markdown');
  assert.equal(created.document.get('published'), true);
  assert.equal(created.document.get('galleryVisibility'), 'all');
  const menu = await store.menu();
  await store.saveMenu({ revision: menu.revision, menu: [{ title: 'External', href: 'https://example.org', target: '_blank', children: [{ title: 'Public', href: '/public' }] }] });
  const content = await store.repository.load();
  assert.equal(content.site.menu[0]!.target, '_blank');
  assert.equal(navigation(content, content.pages.get('/public')!).back, '/');
});
