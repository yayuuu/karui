import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.js';
import { configFromEnv } from '../src/config.js';
import { PanelFiles } from '../src/admin/files.js';
import { PanelStore } from '../src/admin/store.js';
import { hashPassword } from '../src/admin/password.js';
import { ContentRepository, parsePage } from '../src/content.js';
import { fragmentType } from '../src/page-fragment.js';

test('plugin composition, private administration and runnable documentation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-plugin-admin-'));
  await cp('docs', root, { recursive: true, filter: path => !path.includes('/state/') });
  const files = new PanelFiles(root), store = new PanelStore(files);
  await files.write('state/panel/accounts.json', JSON.stringify([{ login: 'owner', password: await hashPassword('plugin-test-password'), role: 'owner', version: 1 }]));
  const pluginDir = join(root, 'plugins/example');
  await writeFile(join(pluginDir, 'implementation.ts'), await readFile(join(pluginDir, 'index.ts')));
  await writeFile(join(pluginDir, 'index.ts'), `import render from './implementation.js';
    export default c => {
      if(c.suffix === '/context') return {type:'json',data:c};
      if(c.mode === 'admin' && c.suffix === '/fail') throw new Error('intentional');
      if(c.mode === 'admin' && c.suffix === '/invalid-template') return {type:'view',template:'../outside.edge'};
      return render(c);
    }`);
  await mkdir(join(root, 'plugins/legacy'));
  await files.write('plugins/legacy/plugin.json', '{"version":"1"}');
  await files.write('plugins/legacy/index.ts', 'export default () => ({type:"json",data:{legacy:true}})');
  await files.write('pages/legacy.md', '---\ntitle: Legacy\nplugin: legacy\n---\n');
  const app = await buildApp({ ...configFromEnv(), contentDir: root, contentCacheDir: join(root, 'cache'), panelSecureCookie: false, pluginWorkers: 1, pluginMaxWorkers: 2 });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  let cookie = '', csrf = '';
  const get = async (url: string) => {
    const response = await app.inject({ url, headers: { cookie } });
    for (const value of response.cookies) if (value.name === 'karui-panel') cookie = value.name + '=' + value.value;
    csrf = /data-csrf="([a-f0-9]+)"/.exec(response.body)?.[1] ?? csrf;
    return response;
  };
  const post = async (url: string, payload: object, headers: Record<string, string> = {}) => {
    const response = await app.inject({ method: 'POST', url, payload, headers: { cookie, 'x-csrf-token': csrf, ...headers } });
    for (const value of response.cookies) if (value.name === 'karui-panel') cookie = value.name + '=' + value.value;
    return response;
  };
  const endpoint = '/panel/plugins/example?path=%2Fplugins%2Fexample';
  await t.test('all documentation pages render and nested plugin views work', async () => {
    const content = await new ContentRepository(root).load();
    assert.equal((await app.inject('/')).headers.location, '/start');
    for (const page of content.pages.values()) {
      const response = await app.inject(page.href);
      assert.equal(response.statusCode, 200, page.href + ': ' + response.body);
    }
    const html = (await app.inject('/plugins/example')).body;
    assert.match(html, /Treść zastąpiona przez wtyczkę!/);
    assert.match(html, /Licznik zapisany przez administratora/);
    assert.doesNotMatch(html, /\[\[notice\]\]/);
    assert.equal(parsePage('---\ntitle: Legacy\n---\n', '/legacy').pluginPlacement, 'after');
    const guide = (await app.inject({ url: '/plugins', headers: { accept: fragmentType } })).json();
    assert.match(guide.content, /hljs-keyword/);
    assert.doesNotMatch(guide.content, /class="pagemenu"/);
    for (const path of ['/plugins/context', '/plugins/views', '/plugins/client', '/plugins/admin', '/plugins/runtime', '/plugins/example']) {
      assert.match(guide.submenu, new RegExp(`href="${path}"`));
    }
  });
  await t.test('private views and assets require a session and cannot be activated by public query parameters', async () => {
    assert.equal((await app.inject(endpoint)).statusCode, 401);
    const expiredDocument = await app.inject({ url: endpoint, headers: { accept: 'text/html', 'sec-fetch-dest': 'document' } });
    assert.equal(expiredDocument.statusCode, 303); assert.equal(expiredDocument.headers.location, '/panel');
    assert.equal((await app.inject('/panel/plugin-assets/example/admin.ts')).statusCode, 401);
    for (const file of ['admin.ts', 'admin.js', 'admin.css', 'index.ts', 'views/admin.edge']) assert.equal((await app.inject('/plugin-assets/example/' + file)).statusCode, 404);
    await get('/panel');
    assert.equal((await post('/panel/login', { login: 'owner', password: 'plugin-test-password' })).statusCode, 303);
    await get('/panel');
    const pluginList = await get('/panel/plugins');
    assert.equal(pluginList.statusCode, 200, pluginList.body);
    assert.match(pluginList.body, /href="\/panel\/plugins" aria-current="page">Plugins/);
    assert.match(pluginList.body, /<span class="panel-plugin-name">example<\/span>/);
    assert.match(pluginList.body, /version 2/);
    assert.match(pluginList.body, /concurrency: false/);
    assert.match(pluginList.body, /href="\/panel\/page\?path=%2Fplugins%2Fexample"/);
    assert.match(pluginList.body, />Example plugin with administration<\/strong>/);
    const publicContext = (await get('/plugins/example/context?mode=admin&admin=true')).json();
    assert.equal(publicContext.mode, 'public'); assert.equal(publicContext.admin, null);
    assert.match(publicContext.assets['example.txt'], /^\/plugin-assets\/example\/assets\/[a-f0-9]{64}\/example\.txt$/);
    assert.equal((await app.inject(publicContext.assets['example.txt'])).body, 'Przykładowy publiczny zasób wtyczki.\n');
    assert.equal(publicContext.basePath, '/plugins/example'); assert.equal(publicContext.suffix, '/context');
    assert.match(publicContext.content.source, /\*\*plugin renders it\*\*/);
    assert.match(publicContext.content.html, /<strong>plugin renders it<\/strong>/);
    const adminContext = (await get('/panel/plugins/example/context?path=%2Fplugins%2Fexample')).json();
    assert.equal(adminContext.mode, 'admin'); assert.equal(adminContext.admin.role, 'owner');
    assert.match(adminContext.assets['example.txt'], /^\/panel\/plugin-assets\/example\/assets\/[a-f0-9]{64}\/example\.txt$/);
    assert.equal(adminContext.admin.login, 'owner'); assert.equal(adminContext.admin.csrf, csrf);
    assert.equal(adminContext.admin.password, undefined);
    assert.equal(adminContext.basePath, '/panel/plugins/example'); assert.equal(adminContext.page.href, '/plugins/example');
    assert.equal(adminContext.suffix, '/context'); assert.equal(adminContext.content.format, 'markdown');
    assert.equal((await get('/plugins/example/context')).json().admin, null, 'Reused workers must not retain the previous session context');
    assert.equal((await get('/panel/plugins/legacy?path=%2Flegacy')).statusCode, 404);
    assert.equal((await get('/panel/plugins/example?path=%2Fstart')).statusCode, 404);
    assert.equal((await get('/panel/plugins/example?path=../../etc/passwd')).statusCode, 400);
    assert.equal((await get('/panel/plugins/example')).statusCode, 400);
    const edit = await get('/panel/page?path=%2Fplugins%2Fexample');
    assert.match(edit.body, /Plugin administration/);
    const admin = await get(endpoint); assert.equal(admin.statusCode, 200, admin.body);
    assert.equal(admin.headers['cache-control'], 'no-store'); assert.match(admin.body, /Zapisz wiadomość/);
    const asset = /data-script="([^"]+)"/.exec(admin.body)![1]!;
    const script = await get(asset); assert.equal(script.statusCode, 200); assert.equal(script.headers['cache-control'], 'no-store');
    assert.match(script.body, /X-CSRF-Token/);
    assert.equal((await app.inject(asset)).statusCode, 401);
    assert.equal((await get('/panel/plugin-assets/example/admin.css')).statusCode, 200);
    assert.equal((await get(adminContext.assets['example.txt'])).body, 'Przykładowy publiczny zasób wtyczki.\n');
    assert.equal((await app.inject(adminContext.assets['example.txt'])).statusCode, 401);
    assert.equal((await get('/panel/plugin-assets/example/index.ts')).statusCode, 404);
  });
  await t.test('admin forms and worker JSON actions validate CSRF and persist isolated plugin state', async () => {
    const increment = '/panel/plugins/example/increment?path=%2Fplugins%2Fexample';
    assert.equal((await post(increment, {}, { 'x-csrf-token': 'bad' })).statusCode, 403);
    assert.equal((await post(increment, {}, { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: increment, payload: {} })).statusCode, 401);
    assert.equal((await post(increment, {})).json().count, 1);
    const form = await app.inject({ method: 'POST', url: endpoint, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ _csrf: csrf, notice: '<script>not executable</script>' }).toString() });
    assert.equal(form.statusCode, 200, form.body); assert.match(form.body, /Zapisano wiadomość/);
    const settings = JSON.parse(await readFile(join(root, 'state/example/settings.json'), 'utf8'));
    assert.deepEqual(settings, { notice: '<script>not executable</script>', count: 1 });
    const publicHtml = (await app.inject('/plugins/example')).body;
    assert.match(publicHtml, /&lt;script&gt;not executable&lt;\/script&gt;/);
    assert.doesNotMatch(publicHtml, /<script>not executable/);
    assert.equal((await app.inject('/state/example/settings.json')).statusCode, 404);
    assert.equal((await post('/plugins/example', { notice: 'hack', mode: 'admin' })).statusCode, 405);
  });
  await t.test('all placements persist, affect SSR and fragments, and content survives removing the plugin', async () => {
    for (const placement of ['before', 'after', 'content']) {
      const original = await store.page('/plugins/example');
      const saved = await post('/panel/api/pages/save', { path: '/plugins/example', revision: original.revision, title: 'Demo', order: 0, body: 'STATIC-MARKER **bold** [[notice]]', format: 'markdown', plugin: 'example', pluginPlacement: placement });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal((await store.page('/plugins/example')).document.get('pluginPlacement'), placement);
      const fragment = await app.inject({ url: '/plugins/example', headers: { accept: fragmentType } });
      for (const html of [(await app.inject('/plugins/example')).body, fragment.json().content]) {
        assert.equal((html.match(/STATIC-MARKER/g) ?? []).length, 1);
        assert.equal(html.indexOf('Działająca wtyczka') < html.indexOf('STATIC-MARKER'), placement !== 'after');
        assert.equal(html.includes('[[notice]]'), placement !== 'content');
        assert.match(html, /<strong>bold<\/strong>/);
      }
    }
    const original = await store.page('/plugins/example');
    const input = { path: '/plugins/example', revision: original.revision, title: 'Demo', order: 0, body: 'STATIC-MARKER', pluginPlacement: 'invalid' };
    assert.equal((await post('/panel/api/pages/save', input)).statusCode, 400);
    assert.equal((await post('/panel/api/pages/save', { ...input, pluginPlacement: 'content', plugin: '' })).statusCode, 200);
    assert.match((await app.inject('/plugins/example')).body, /STATIC-MARKER/);
    assert.equal((await get(endpoint)).statusCode, 404);
    const current = await store.page('/plugins/example');
    assert.equal((await post('/panel/api/pages/save', { ...input, revision: current.revision, pluginPlacement: 'content', plugin: 'example', published: false })).statusCode, 200);
    assert.equal((await app.inject('/plugins/example')).statusCode, 404);
    assert.equal((await get(endpoint)).statusCode, 200, 'Unpublished pages remain administrable');
  });
  await t.test('bad templates and handler failures are isolated, and logout revokes admin access', async () => {
    for (const suffix of ['fail', 'invalid-template']) {
      assert.equal((await get(`/panel/plugins/example/${suffix}?path=%2Fplugins%2Fexample`)).statusCode, 503);
      assert.equal((await get('/panel')).statusCode, 200);
      assert.equal((await app.inject('/start')).statusCode, 200);
    }
    assert.equal((await post('/panel/logout', {})).statusCode, 303);
    assert.equal((await get(endpoint)).statusCode, 401);
  });
});
