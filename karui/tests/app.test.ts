import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.js';
import { configFromEnv } from '../src/config.js';
import { fragmentType } from '../src/page-fragment.js';

test('SSR, fragment navigation, menu hierarchy, redirects and safe error pages use independent file fixtures', async t => {
  const root = await mkdtemp(join(tmpdir(), 'engine-http-'));
  const content = join(root, 'content');
  await mkdir(join(content, 'pages/section'), { recursive: true });
  await writeFile(join(content, 'site.yml'), 'title: Test\nlanguage: en\nlanguages: [en, pl, fr]\nmenu:\n  - title: Section\n    href: /section\n    children:\n      - title: Article\n        href: /section/article\nredirects:\n  /old/: /section/\n');
  await writeFile(join(content, 'site.pl.yml'), 'title: Polska witryna\ndescription: Polski opis witryny\nfooter: Polska stopka\n');
  await writeFile(join(content, 'pages/section/index.md'), '---\ntitle: Section\n---\nSection text');
  await writeFile(join(content, 'pages/section/article.md'), '---\ntitle: Article\nformat: markdown\n---\n**Hello**');
  await writeFile(join(content, 'pages/section/article.pl.md'), '---\ntitle: Artykuł\nformat: markdown\n---\n**Witaj**');
  const app = await buildApp({ ...configFromEnv(), contentDir: content, contentCacheDir: join(root, 'cache'), contentRefreshMs: 50 });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  for (const url of ['/', '/section', '/section/article', '/missing']) {
    const full = await app.inject(url), fragment = await app.inject({ url, headers: { accept: fragmentType } });
    assert.equal(full.statusCode, url === '/missing' ? 404 : 200, full.body);
    assert.equal(fragment.statusCode, full.statusCode);
    assert.match(full.body, /<!doctype html>/);
    assert.match(fragment.headers['content-type']!, /application\/vnd.karui.page\+json/);
    assert.equal(fragment.headers.vary, 'Accept, Accept-Language, Cookie');
    const data = fragment.json();
    assert.equal(data.version, 1); assert.equal(data.href, url);
    assert.equal(data.home, url === '/');
    assert.doesNotMatch(data.content, /<!doctype|<body|main\.js/);
    assert.equal(typeof data.menu, 'string');
    if (url === '/section/article') {
      assert.match(data.content, /<strong>Hello<\/strong>/);
      assert.equal(data.back, '/section'); assert.match(data.submenu, /Article/);
      assert.match(data.menu, /data-active="ancestor"/);
    }
  }
  assert.equal((await app.inject('/old/article')).headers.location, '/section/article');
  const polish = await app.inject('/section/article?lang=pl');
  assert.match(polish.body, /<strong>Witaj<\/strong>/);
  assert.match(polish.body, /Polska witryna/);
  assert.match(polish.body, /<meta name="description" content="Polski opis witryny">/);
  assert.match(polish.body, /Polska stopka/);
  assert.match(String(polish.headers['set-cookie']), /karui-language=pl/);
  assert.match(polish.body, /<select name="lang" data-language-select/);
  const remembered = await app.inject({ url: '/section/article', headers: { cookie: 'karui-language=pl' } });
  assert.match(remembered.body, /<strong>Witaj<\/strong>/);
  assert.match((await app.inject('/section/article?lang=fr')).body, /<strong>Hello<\/strong>/, 'Missing translations fall back to the default language');
  assert.equal((await app.inject('/index.php?p=section&s=article')).headers.location, '/section/article');
  for (const url of ['/content/site.yml', '/templates/page.edge', '/themes/sample/client.ts', '/assets/themes/default/bad/site.css']) {
    assert.equal((await app.inject(url)).statusCode, 404, url);
  }
  for (let index = 0; index < 305; index++) assert.equal((await app.inject('/')).statusCode, 200);
  assert.equal((await app.inject('/')).headers['x-ratelimit-limit'], '100000');
});
