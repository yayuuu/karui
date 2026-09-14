import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { buildApp } from '../src/app.js';
import { configFromEnv } from '../src/config.js';
import { hashPassword } from '../src/admin/password.js';
import { PanelFiles } from '../src/admin/files.js';
import { PanelStore } from '../src/admin/store.js';
import { CachedContentRepository } from '../src/content/cache.js';
import { parsePage } from '../src/content.js';
import { fragmentType } from '../src/page-fragment.js';

test('panel shell localizes site branding and navigation independently of panel content', async t => {
  const content = await mkdtemp(join(tmpdir(), 'karui-panel-shell-language-'));
  const files = new PanelFiles(content);
  await files.write('site.yml', 'title: English site\nbrandName: English brand\nlanguage: en\nlanguages: [en, pl]\nmenu:\n  - title: English menu\n    href: /\n');
  await files.write('site.pl.yml', 'title: Polska strona\nbrandName: Polska marka\n');
  await files.write('lang/pl.po', 'msgid ""\nmsgstr ""\n"Language: pl\\n"\n\nmsgctxt "karui-menu"\nmsgid "English menu"\nmsgstr "Polskie menu"\n');
  const app = await buildApp({ ...configFromEnv(), contentDir: content, panelSecureCookie: false });
  t.after(async () => { await app.close(); await rm(content, { recursive: true, force: true }); });

  const view = await app.inject('/panel?lang=pl');
  assert.equal(view.statusCode, 200, view.body);
  assert.match(view.body, /Polska marka/);
  assert.match(view.body, /Polskie menu/);
  assert.doesNotMatch(view.body, /English brand|English menu/);
});

test('integrated panel: authentication, files, galleries and tree menu', async t => {
  const content = await mkdtemp(join(tmpdir(), 'karui-panel-'));
  const cache = content + '-cache';
  await mkdir(join(content, 'pages/section'), { recursive: true });
  await writeFile(join(content, 'pages/section/index.md'), '---\ntitle: Section\n---\n');
  await writeFile(join(content, 'pages/section/article.md'), '---\ntitle: Article\n---\n');
  await writeFile(join(content, 'pages/other.md'), '---\ntitle: Other\n---\n');
  await writeFile(join(content, 'site.yml'), 'title: Test\nlanguage: pl\nlanguages: [pl]\nmenu: []\n');
  await mkdir(join(content, 'plugins/example'), { recursive: true });
  const files = new PanelFiles(content); const store = new PanelStore(files);
  await files.write('themes/sample/theme.json', JSON.stringify({ name: 'Sample theme', version: '1' }));
  await files.write('state/panel/accounts.json', JSON.stringify([{ login: 'owner', password: await hashPassword('test-password-123'), role: 'owner', version: 1 }]));
  const app = await buildApp({ ...configFromEnv(), contentDir: content, contentCacheDir: cache, panelSecureCookie: false });
  t.after(async () => { await app.close(); await rm(content, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); });
  const client = () => {
    let cookie = '', csrf = '';
    const get = async (url: string) => { const response = await app.inject({ url, headers: { cookie } }); for (const value of response.cookies) if (value.name === 'karui-panel') cookie = value.name + '=' + value.value; csrf = /data-csrf="([a-f0-9]+)"/.exec(response.body)?.[1] ?? csrf; return response; };
    const post = async (url: string, payload: object, headers: Record<string, string> = {}) => {
      const response = await app.inject({ method: 'POST', url, payload, headers: { cookie, 'x-csrf-token': csrf, ...headers } });
      for (const value of response.cookies) if (value.name === 'karui-panel') cookie = value.name + '=' + value.value;
      return response;
    };
    const login = async (name = 'owner', password = 'test-password-123') => { await get('/panel'); const response = await post('/panel/login', { login: name, password }); assert.equal(response.statusCode, 303, response.body); await get('/panel'); };
    return { get, post, login, cookie: () => cookie, csrf: () => csrf };
  };
  const admin = client();
  await t.test('login is protected, sessions rotate, and panel is not a content plugin', async () => {
    const home = await admin.get('/panel'); assert.equal(home.statusCode, 200, home.body);
    assert.match(home.body, /Logowanie|Zaloguj/); assert.match(home.headers['cache-control']!, /no-store/);
    assert.match(home.headers['set-cookie']!.toString(), /HttpOnly/); assert.match(home.headers['set-cookie']!.toString(), /SameSite=Strict/);
    assert.equal((await admin.post('/panel/api/menu', {})).statusCode, 401);
    const expiredDocument = await app.inject({ url: '/panel/pages', headers: { accept: 'text/html', 'sec-fetch-dest': 'document' } });
    assert.equal(expiredDocument.statusCode, 303); assert.equal(expiredDocument.headers.location, '/panel');
    assert.equal((await admin.get('/panel/pages')).statusCode, 303);
    assert.equal((await admin.post('/panel/login', { login: 'owner', password: 'test-password-123' }, { 'x-csrf-token': 'bad' })).statusCode, 403);
    assert.equal((await admin.post('/panel/login', { login: 'owner', password: 'wrong' })).statusCode, 401);
    const before = admin.cookie(); await admin.login(); assert.notEqual(admin.cookie(), before);
    for (const path of ['/panel', '/panel/pages', '/panel/new', '/panel/menu', '/panel/accounts', '/panel/plugins', '/panel/settings', '/panel/page?path=/section']) {
      const response = await admin.get(path); assert.equal(response.statusCode, 200, path + ': ' + response.body); assert.doesNotMatch(response.body, /@if|@end|plugin-assets\/panel/);
    }
    const oldThemeRoute = await admin.get('/panel/themes'); assert.equal(oldThemeRoute.statusCode, 303); assert.equal(oldThemeRoute.headers.location, '/panel/settings');
    assert.equal((await admin.post('/panel/api/pages/create', {}, { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
    for (const path of ['/state/panel/accounts.json', '/media/../state/panel/accounts.json', '/plugin-assets/panel/index.ts']) assert.ok((await app.inject(path)).statusCode >= 400);
  });
  await t.test('site settings require authentication, CSRF and a current revision', async () => {
    const view = await admin.get('/panel/settings');
    assert.equal(view.statusCode, 200, view.body);
    assert.match(view.body, /Ustawienia strony/); assert.match(view.body, /Sample theme/);
    assert.doesNotMatch(view.body, /@if|@end/);
    const initial = await store.menu();
    const before = (await app.inject({ url: '/section', headers: { accept: fragmentType } })).json();
    const payload = { theme: 'sample', revision: initial.revision, title: 'Configured site', home: '/section', language: 'pl', languages: 'pl', description: 'Opis strony', brandName: 'Configured', tagline: 'Tagline', logo: '', favicon: '', showBrandName: true, footer: '**Stopka testowa**', footerFormat: 'markdown' };
    assert.equal((await admin.post('/panel/api/settings', payload, { 'x-csrf-token': 'bad' })).statusCode, 403);
    assert.equal((await admin.post('/panel/api/settings', { ...payload, theme: 'missing' })).statusCode, 400);
    const saved = await admin.post('/panel/api/settings', payload);
    assert.equal(saved.statusCode, 200, saved.body);
    const selected = await store.menu();
    assert.equal(selected.site.theme, 'sample');
    assert.equal(selected.site.title, 'Configured site');
    assert.equal(selected.site.home, '/section');
    assert.equal(selected.site.brandName, 'Configured');
    assert.deepEqual(selected.site.menu, initial.site.menu);
    const after = (await app.inject({ url: '/section', headers: { accept: fragmentType } })).json();
    assert.notEqual(after.assetVersion, before.assetVersion);
    const publicPage = await app.inject('/section'); assert.match(publicPage.body, /data-theme="sample"/); assert.match(publicPage.body, /<strong>Stopka testowa<\/strong>/);
    assert.equal((await admin.post('/panel/api/settings', payload)).statusCode, 409);
    assert.equal((await admin.post('/panel/api/settings', { ...payload, theme: 'default', revision: selected.revision })).statusCode, 200);
  });
  await t.test('page creation, rich/source content, revisions, safe deletion and symlinks', async () => {
    const created = await admin.post('/panel/api/pages/create', { title: 'Testowa strona', slug: 'panel-test', parent: '/' });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal((await admin.post('/panel/api/pages/create', { title: 'Duplicate', slug: 'panel-test', parent: '/' })).statusCode, 409);
    assert.equal((await admin.post('/panel/api/pages/create', { title: 'Reserved', slug: 'panel', parent: '/' })).statusCode, 400);
    assert.equal((await admin.post('/panel/api/pages/create', { title: 'Traversal', slug: '../oops', parent: '/' })).statusCode, 400);
    const page = await store.page('/panel-test');
    const payload = { path: '/panel-test', revision: page.revision, title: 'Tytuł', keywords: 'test', order: 2, plugin: '', body: '## Treść\n\n<strong>Nowa treść</strong>' };
    const saved = await admin.post('/panel/api/pages/save', payload); assert.equal(saved.statusCode, 200, saved.body);
    assert.equal((await admin.post('/panel/api/pages/save', payload)).statusCode, 409);
    assert.match((await app.inject('/panel-test')).body, /<strong>Nowa treść<\/strong>/);
    const revision = (await store.page('/panel-test')).revision;
    const concurrent = await Promise.all(['Pierwsza', 'Druga'].map(title => admin.post('/panel/api/pages/save', { ...payload, revision, title })));
    assert.deepEqual(concurrent.map(response => response.statusCode).sort(), [200, 409]);
    assert.equal((await admin.post('/panel/api/pages/create', { title: 'Podstrona', slug: 'dziecko', parent: '/panel-test' })).statusCode, 200);
    assert.equal((await admin.post('/panel/api/pages/delete', { path: '/panel-test', revision: (await store.page('/panel-test')).revision })).statusCode, 409);
    const child = await store.page('/panel-test/dziecko');
    const removed = await admin.post('/panel/api/pages/delete', { path: child.page.href, revision: child.revision });
    assert.equal(removed.statusCode, 200, removed.body); assert.equal(JSON.parse((await files.read(removed.json().backup)).toString()).source, child.source);
    assert.equal((await app.inject(child.page.href)).statusCode, 404);
    await symlink('/tmp', join(content, 'pages/outside'));
    assert.equal((await admin.post('/panel/api/pages/create', { title: 'Link', slug: 'outside', parent: '/' })).statusCode, 400);
  });
  await t.test('print and PDF header actions are independent opt-in settings stored in page files', async () => {
    const existing = await store.repository.load();
    for (const page of existing.pages.values()) {
      assert.equal(page.showPrint, false, page.href);
      assert.equal(page.showPdf, false, page.href);
    }
    assert.doesNotMatch((await app.inject('/section/article')).body, /id="(?:print|pdf)"/);
    assert.equal((await admin.post('/panel/api/pages/create', { title: 'Przyciski', slug: 'header-options', parent: '/' })).statusCode, 200);
    const initial = await store.page('/header-options');
    assert.equal(initial.document.get('showPrint'), false);
    assert.equal(initial.document.get('showPdf'), false);
    for (const [showPrint, showPdf] of [[true, false], [false, true], [true, true], [false, false]]) {
      const original = await store.page('/header-options');
      const input = { path: '/header-options', revision: original.revision, title: 'Przyciski', order: 0, body: '', showPrint, showPdf };
      const response = await admin.post('/panel/api/pages/save', input);
      assert.equal(response.statusCode, 200, response.body);
      const saved = await store.page('/header-options');
      assert.equal(saved.document.get('showPrint'), showPrint);
      assert.equal(saved.document.get('showPdf'), showPdf);
      const rendered = (await app.inject('/header-options')).body;
      assert.equal(rendered.includes('id="print"'), showPrint);
      assert.equal(rendered.includes('id="pdf"'), showPdf);
      assert.equal(rendered.includes('class="page-title-actions"'), showPrint || showPdf);
      assert.equal((await admin.post('/panel/api/pages/save', { ...input, revision: saved.revision, showPrint: 'false' })).statusCode, 400);
    }
  });
  await t.test('subpage list visibility defaults on and does not change child access or navigation', async () => {
    assert.equal(parsePage('---\ntitle: Legacy\n---\nText', '/legacy').showSubpages, true);
    for (const [slug, parent] of [['child-list', '/'], ['child', '/child-list']]) {
      assert.equal((await admin.post('/panel/api/pages/create', { title: slug, slug, parent })).statusCode, 200);
    }
    assert.equal((await store.page('/child-list')).document.get('showSubpages'), true);
    const before = (await app.inject({ url: '/child-list', headers: { accept: fragmentType } })).json();
    for (const showSubpages of [false, true, false]) {
      const original = await store.page('/child-list');
      const input = { path: '/child-list', revision: original.revision, title: 'Child list', order: 0, body: 'Parent text', showSubpages };
      const response = await admin.post('/panel/api/pages/save', input);
      assert.equal(response.statusCode, 200, response.body);
      const saved = await store.page('/child-list');
      assert.equal(saved.document.get('showSubpages'), showSubpages);
      assert.equal((await app.inject('/child-list')).body.includes('class="pagemenu"'), showSubpages);
      const fragment = (await app.inject({ url: '/child-list', headers: { accept: fragmentType } })).json();
      assert.equal(fragment.content.includes('class="pagemenu"'), showSubpages);
      assert.equal(fragment.menu, before.menu);
      assert.equal(fragment.submenu, before.submenu);
      assert.equal((await app.inject('/child-list/child')).statusCode, 200);
      assert.equal((await admin.post('/panel/api/pages/save', { ...input, revision: saved.revision, showSubpages: 'false' })).statusCode, 400);
    }
    const saved = await store.page('/child-list');
    assert.equal((await admin.post('/panel/api/pages/save', { path: '/child-list', revision: saved.revision, title: 'Text-only save', order: 0, body: 'Updated' })).statusCode, 200);
    assert.equal((await store.page('/child-list')).page.showSubpages, false);
  });
  await t.test('subpage sort keys can be changed together while displayed numbers stay sequential', async () => {
    assert.equal((await admin.post('/panel/api/pages/create', { title: 'Kolejność', slug: 'subpage-order', parent: '/' })).statusCode, 200);
    for (const [title, slug] of [['Alfa', 'alfa'], ['Beta', 'beta'], ['Gamma', 'gamma']]) {
      assert.equal((await admin.post('/panel/api/pages/create', { title, slug, parent: '/subpage-order' })).statusCode, 200);
    }
    const children = await Promise.all(['alfa', 'beta', 'gamma'].map(slug => store.page('/subpage-order/' + slug)));
    const changed = await admin.post('/panel/api/pages/subpage-order', {
      parent: '/subpage-order',
      children: children.map((child, index) => ({ path: child.page.href, revision: child.revision, order: [225, 250, 100][index] })),
    });
    assert.equal(changed.statusCode, 200, changed.body);
    assert.deepEqual((await Promise.all(['alfa', 'beta', 'gamma'].map(slug => store.page('/subpage-order/' + slug)))).map(child => child.page.order), [225, 250, 100]);

    const publicPage = (await app.inject('/subpage-order')).body;
    assert.ok(publicPage.indexOf('Gamma') < publicPage.indexOf('Alfa'));
    assert.ok(publicPage.indexOf('Alfa') < publicPage.indexOf('Beta'));
    assert.match(publicPage, /class="pagenr">1<\/div>[\s\S]*Gamma/);
    assert.match(publicPage, /class="pagenr">2<\/div>[\s\S]*Alfa/);
    assert.match(publicPage, /class="pagenr">3<\/div>[\s\S]*Beta/);
    assert.doesNotMatch(publicPage, /class="pagenr">(?:100|225|250)<\/div>/);

    const editor = await admin.get('/panel/page?path=/subpage-order');
    assert.equal(editor.statusCode, 200, editor.body);
    assert.match(editor.body, /data-subpage-number>1\.<\/span>[\s\S]*Gamma/);
    assert.match(editor.body, /value="100"[^>]*aria-label="Kolejność: Gamma"/);

    const stale = await Promise.all(['gamma', 'alfa', 'beta'].map(slug => store.page('/subpage-order/' + slug)));
    const externallyChanged = stale[2]!;
    await store.savePage({ path: externallyChanged.page.href, revision: externallyChanged.revision, title: externallyChanged.page.title, order: 250, body: 'Zmiana równoległa' });
    const conflict = await admin.post('/panel/api/pages/subpage-order', {
      parent: '/subpage-order',
      children: stale.map(child => ({ path: child.page.href, revision: child.revision, order: child.page.order + 1 })),
    });
    assert.equal(conflict.statusCode, 409, conflict.body);
    assert.equal((await store.page('/subpage-order/gamma')).page.order, 100, 'No child is written before every revision has been checked');
  });
  await t.test('nested menu edits are validated and do not silently overwrite changes', async () => {
    const menu = await store.menu();
    const items = [{ title: 'Root', href: '/section', children: [{ title: 'Child', href: '/other', children: [{ title: 'Grandchild', href: '/panel-test', children: [] }] }] }];
    assert.equal((await admin.post('/panel/api/menu', { revision: menu.revision, menu: items })).statusCode, 200);
    const current = await store.menu(); assert.deepEqual(current.site.menu, items);
    assert.equal((await admin.post('/panel/api/menu', { revision: menu.revision, menu: [] })).statusCode, 409);
    assert.equal((await admin.post('/panel/api/menu', { revision: current.revision, menu: [{ title: 'Missing', href: '/missing' }] })).statusCode, 400);
    assert.equal((await admin.post('/panel/api/pages/delete', { path: '/panel-test', revision: (await store.page('/panel-test')).revision })).statusCode, 409);
    assert.match((await app.inject('/panel-test')).body, /Grandchild/);
    assert.equal((await app.inject('/healthz')).statusCode, 200);
  });
  await t.test('gallery uploads create real thumbnails and are rendered by the engine on any page', async () => {
    const png = new PNG({ width: 20, height: 10 }); png.data.fill(255); const image = PNG.sync.write(png);
    const upload = async (buffer: Buffer, mime = 'image/png') => {
      const page = await store.page('/panel-test');
      const boundary = 'karui-test-boundary';
      const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="../../bad.php"\r\nContent-Type: ${mime}\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      return app.inject({ method: 'POST', url: '/panel/api/photos/upload?' + new URLSearchParams({ path: page.page.href, revision: page.revision, alt: 'Testowy obraz' }), headers: { cookie: admin.cookie(), 'x-csrf-token': admin.csrf(), 'content-type': 'multipart/form-data; boundary=' + boundary }, payload });
    };
    assert.equal((await upload(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/svg+xml')).statusCode, 400);
    const response = await upload(image); assert.equal(response.statusCode, 200, response.body);
    const photo = response.json().photo;
    assert.match(photo.src, /^\/media\/gallery\/[a-f0-9-]+\.large\.png$/);
    assert.match(photo.thumbnail, /^\/media\/gallery\/[a-f0-9-]+\.small\.webp$/);
    for (const url of [photo.src, photo.thumbnail, photo.download]) {
      const image = await app.inject(url); assert.equal(image.statusCode, 200);
      assert.equal((await sharp(image.rawPayload).metadata()).width, 20);
    }
    assert.equal((await sharp((await app.inject(photo.thumbnail)).rawPayload).metadata()).format, 'webp');
    const page = await store.page('/panel-test'); assert.equal(page.page.gallery.length, 1); assert.match(page.body, /Nowa treść/);
    const publicPage = await app.inject('/panel-test'); assert.match(publicPage.body, /data-gallery/); assert.doesNotMatch(publicPage.body, /plugin-assets\/gallery/);
    assert.equal((await readdir(join(cache, 'galleries'))).filter(file => file.endsWith('.json')).length, 1);
    const removed = await admin.post('/panel/api/photos/change', { path: page.page.href, revision: page.revision, index: 0, action: 'delete' }); assert.equal(removed.statusCode, 200, removed.body);
    assert.equal((await readdir(join(cache, 'galleries'))).filter(file => file.endsWith('.json')).length, 0);
    assert.equal((await store.page('/panel-test')).page.gallery.length, 0);
    assert.equal((await app.inject(photo.src)).statusCode, 200, 'Shared media must not be deleted');
  });
  await t.test('photo responses describe the committed file even if cache refresh is unavailable afterwards', async t => {
    assert.equal((await admin.post('/panel/api/pages/create', { title: 'Upload commit', slug: 'upload-commit', parent: '/' })).statusCode, 200);
    const original = await store.page('/upload-commit');
    assert.equal((await admin.post('/panel/api/pages/save', { path: '/upload-commit', revision: original.revision, title: 'Edited', order: 0, body: 'Saved text before upload' })).statusCode, 200);
    const before = await store.page('/upload-commit');
    const png = new PNG({ width: 20, height: 10 }); png.data.fill(255);
    const boundary = 'upload-commit-boundary';
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`), PNG.sync.write(png), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const withoutPostCommitRead = async (operation: () => Promise<unknown>) => {
      let committed = false;
      const load = CachedContentRepository.prototype.load, invalidate = CachedContentRepository.prototype.invalidate;
      const invalidation = t.mock.method(CachedContentRepository.prototype, 'invalidate', function (this: CachedContentRepository) { invalidate.call(this); committed = true; });
      const reading = t.mock.method(CachedContentRepository.prototype, 'load', function (this: CachedContentRepository) {
        if (committed) return Promise.reject(new Error('Cache unavailable after successful commit'));
        return load.call(this);
      });
      try { await operation(); } finally { invalidation.mock.restore(); reading.mock.restore(); }
    };
    let revision = '';
    await withoutPostCommitRead(async () => {
      const response = await app.inject({ method: 'POST', url: '/panel/api/photos/upload?' + new URLSearchParams({ path: before.page.href, revision: before.revision, alt: 'Uploaded' }),
        headers: { cookie: admin.cookie(), 'x-csrf-token': admin.csrf(), 'content-type': 'multipart/form-data; boundary=' + boundary }, payload });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().gallery.length, 1);
      assert.deepEqual(response.json().photo, response.json().gallery[0]);
      revision = response.json().revision;
      assert.equal(revision, (await store.page('/upload-commit')).revision);
    });
    await withoutPostCommitRead(async () => {
      const response = await admin.post('/panel/api/photos/change', { path: '/upload-commit', revision, index: 0, action: 'alt', alt: 'Updated description' });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().gallery[0].alt, 'Updated description');
      revision = response.json().revision;
    });
    assert.equal((await admin.post('/panel/api/pages/save', { path: '/upload-commit', revision, title: 'Edited again', order: 0, body: 'Unsaved text after upload' })).statusCode, 200);
    const saved = await store.page('/upload-commit');
    assert.equal(saved.page.gallery.length, 1); assert.equal(saved.body, 'Unsaved text after upload');
  });
  await t.test('only owner manages accounts; password changes and logout revoke sessions', async () => {
    const added = await admin.post('/panel/api/accounts/save', { login: 'editor', password: 'editor-password-123', confirmation: 'editor-password-123', create: true }); assert.equal(added.statusCode, 200, added.body);
    const editor = client(); await editor.login('editor', 'editor-password-123');
    assert.equal((await editor.post('/panel/api/accounts/save', { login: 'intruder', password: 'long-password', confirmation: 'long-password', create: true })).statusCode, 403);
    assert.equal((await editor.post('/panel/api/accounts/delete', { login: 'owner' })).statusCode, 403);
    assert.equal((await admin.post('/panel/api/accounts/delete', { login: 'owner' })).statusCode, 400);
    assert.equal((await admin.post('/panel/api/accounts/save', { login: 'editor', password: 'new-password-123', confirmation: 'new-password-123', create: false })).statusCode, 200);
    assert.equal((await editor.post('/panel/api/menu', {})).statusCode, 401);
    await editor.login('editor', 'new-password-123');
    const stolenCookie = editor.cookie(); assert.equal((await editor.post('/panel/logout', {})).statusCode, 303);
    assert.equal((await app.inject({ url: '/panel/accounts', headers: { cookie: stolenCookie } })).statusCode, 303);
    assert.equal((await admin.post('/panel/api/accounts/delete', { login: 'editor' })).statusCode, 200);
    assert.doesNotMatch(await readFile(join(content, 'state/panel/accounts.json'), 'utf8'), /test-password-123|new-password-123/);
  });
});
