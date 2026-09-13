import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { ContentRepository, localizedContent } from '../src/content.js';
import { CachedContentRepository } from '../src/content/cache.js';
import { PanelStore } from '../src/admin/store.js';
import { PanelFiles } from '../src/admin/files.js';
import { buildApp } from '../src/app.js';
import { configFromEnv } from '../src/config.js';

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'karui-cache-test-'));
  const source = join(root, 'content');
  const cache = join(root, 'cache');
  await mkdir(join(source, 'pages'), { recursive: true });
  await mkdir(join(source, 'plugins'));
  await writeFile(join(source, 'site.yml'), 'title: Cache test\nlanguage: en\nlanguages: [en, pl]\nmenu: []\n');
  await writeFile(join(source, 'pages/example.md'), '---\ntitle: Example\n---\nOriginal content');
  const errors: unknown[] = [];
  const repository = new CachedContentRepository(source, cache, 100, error => errors.push(error));
  t.after(async () => { await repository.close(); await rm(root, { recursive: true, force: true }); });
  return { root, source, cache, repository, errors };
}

test('content hot path uses a shared parsed snapshot, with an atomic file cache outside content', async t => {
  const { source, cache, repository } = await fixture(t);
  const reads = t.mock.method(ContentRepository.prototype, 'load');
  const snapshots = await Promise.all(Array.from({ length: 30 }, () => repository.load()));
  assert.equal(reads.mock.callCount(), 1, 'Concurrent requests share a single source read');
  assert.ok(snapshots.every(snapshot => snapshot === snapshots[0]));
  await repository.refresh();
  assert.equal(reads.mock.callCount(), 1, 'Unchanged files must not be parsed again');
  const directories = await readdir(cache);
  assert.equal(directories.length, 1);
  const files = await readdir(join(cache, directories[0]!));
  assert.deepEqual(files, ['content.json']);
  const disk = JSON.parse(await readFile(join(cache, directories[0]!, 'content.json'), 'utf8'));
  assert.equal(disk.version, 4);
  assert.equal(disk.pages[0][1].html, '<p>Original content</p>\n');
  assert.deepEqual((await readdir(source)).sort(), ['pages', 'plugins', 'site.yml']);
  await rename(source, source + '-offline');
  for (let i = 0; i < 50; i++) assert.equal(await repository.load(), snapshots[0], 'Hot path does not touch CephFS');
  await assert.rejects(repository.refresh(), { code: 'ENOENT' });
  assert.equal(await repository.load(), snapshots[0], 'Transient storage failures retain last valid content');
  await repository.close();
  assert.deepEqual(await readdir(cache), [], 'Only this instance’s derived cache is removed on shutdown');
});

test('refresh detects new, edited and removed files and retains the last valid snapshot on errors', async t => {
  const { source, repository } = await fixture(t);
  const before = await repository.load();
  await writeFile(join(source, 'pages/example.md'), '---\ntitle: Updated\n---\nChanged');
  await mkdir(join(source, 'pages/nested'));
  await writeFile(join(source, 'pages/nested/index.md'), '---\ntitle: Nested\n---\n');
  await writeFile(join(source, 'site.yml'), 'title: Changed site\nmenu:\n  - title: Nested\n    href: /nested\n');
  await repository.refresh();
  const updated = await repository.load();
  assert.notEqual(updated, before);
  assert.equal(updated.site.title, 'Changed site');
  assert.equal(updated.pages.get('/example')?.title, 'Updated');
  assert.ok(updated.pages.has('/nested'));
  await writeFile(join(source, 'pages/example.md'), 'incomplete YAML edit');
  await assert.rejects(repository.refresh(), /front matter/);
  assert.equal(await repository.load(), updated);
  await rm(join(source, 'pages/example.md'));
  await repository.refresh();
  assert.equal((await repository.load()).pages.has('/example'), false);
});

test('background polling observes external edits without a request triggering filesystem access', async t => {
  const { source, repository, errors } = await fixture(t);
  await repository.load();
  repository.start();
  await writeFile(join(source, 'pages/example.md'), '---\ntitle: External edit\n---\n');
  for (let i = 0; i < 60; i++) {
    if ((await repository.load()).pages.get('/example')?.title === 'External edit') break;
    await delay(50);
  }
  assert.equal((await repository.load()).pages.get('/example')?.title, 'External edit');
  assert.deepEqual(errors, []);
});

test('cache refresh observes localized site settings files', async t => {
  const { source, repository } = await fixture(t);
  const initial = await repository.load();
  assert.equal(localizedContent(initial, 'pl').site.title, 'Cache test');
  await writeFile(join(source, 'site.pl.yml'), 'title: Polska wersja\ndescription: Polski opis\n');
  await repository.refresh();
  const localized = localizedContent(await repository.load(), 'pl').site;
  assert.equal(localized.title, 'Polska wersja');
  assert.equal(localized.description, 'Polski opis');
});

test('a request after a panel write retries a background refresh superseded by that write', async t => {
  const { source, repository } = await fixture(t);
  await repository.load();
  await writeFile(join(source, 'pages/example.md'), '---\ntitle: Before upload\n---\nEdited text');
  const read = ContentRepository.prototype.load;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  t.mock.method(ContentRepository.prototype, 'load', async function (this: ContentRepository) {
    const value = await read.call(this);
    if (first) { first = false; entered(); await paused; }
    return value;
  });
  const polling = repository.refresh();
  const pollingError = polling.catch(error => error);
  await started;
  await writeFile(join(source, 'pages/example.md'), '---\ntitle: After upload\ngallery:\n  - src: /media/new.png\n    thumbnail: /media/new.png\n---\nEdited text');
  repository.invalidate();
  const response = repository.load();
  release();
  const result = await response;
  assert.equal(result.pages.get('/example')?.gallery.length, 1);
  assert.match(result.pages.get('/example')!.html, /Edited text/);
  await pollingError;
});

test('panel page, menu and gallery mutations invalidate shared snapshots immediately', async t => {
  const { source, repository } = await fixture(t);
  const store = new PanelStore(new PanelFiles(source), repository);
  await repository.load();
  await store.createPage({ title: 'Created', slug: 'created', parent: '/' });
  assert.ok((await repository.load()).pages.has('/created'));
  const original = await store.page('/created');
  await store.savePage({ path: '/created', revision: original.revision, title: 'Saved', order: 0, body: 'New body' });
  assert.equal((await repository.load()).pages.get('/created')?.title, 'Saved');
  const menu = await store.menu();
  await store.saveMenu({ revision: menu.revision, menu: [{ title: 'Example link', href: '/example' }] });
  assert.equal((await repository.load()).site.menu[0]?.title, 'Example link');
  await store.deletePage('/created', (await store.page('/created')).revision);
  assert.equal((await repository.load()).pages.has('/created'), false);

  await writeFile(join(source, 'pages/example.md'), '---\ntitle: Gallery\ngallery:\n  - src: /media/photo.png\n    thumbnail: /media/photo.png\n    alt: Original\n---\n');
  await repository.refresh();
  const previous = await repository.load();
  await store.photo({ path: '/example', revision: (await store.page('/example')).revision, index: 0, action: 'alt', alt: 'Changed' });
  assert.equal(previous.pages.get('/example')?.gallery[0]?.alt, 'Original', 'Panel must not mutate a published snapshot');
  assert.equal((await repository.load()).pages.get('/example')?.gallery[0]?.alt, 'Changed');
  await store.photo({ path: '/example', revision: (await store.page('/example')).revision, index: 0, action: 'delete' });
  assert.equal((await repository.load()).pages.get('/example')?.gallery.length, 0);
});

test('HTTP pages and fragments stay available without source filesystem access', async t => {
  const { source, cache } = await fixture(t);
  const app = await buildApp({ ...configFromEnv(), contentDir: source, contentCacheDir: cache, contentRefreshMs: 60000 });
  try {
    await app.ready();
    await rename(source, source + '-offline');
    for (const url of ['/', '/example', '/healthz']) assert.equal((await app.inject(url)).statusCode, 200);
    const response = await app.inject({ url: '/example', headers: { accept: 'application/vnd.karui.page+json' } });
    assert.equal(response.statusCode, 200);
    assert.match(response.json().content, /Original content/);
  } finally { await app.close(); }
});
