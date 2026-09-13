import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContentRepository, localizedContent, siteSchema } from '../src/content.js';
import { PanelFiles } from '../src/admin/files.js';
import { PanelStore } from '../src/admin/store.js';
import { languageLinks, requestLanguage, Translations } from '../src/i18n.js';

const page = (title: string, body: string) => `---\ntitle: ${title}\nformat: markdown\n---\n${body}`;

test('localized files select exact languages and fall back to the configured default', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-languages-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'pages'));
  await writeFile(join(root, 'site.yml'), 'title: Test\nlanguage: pl\nlanguages: [pl, en, fr]\nmenu: []\n');
  await writeFile(join(root, 'pages/article.md'), page('Polski', 'Treść bazowa'));
  await writeFile(join(root, 'pages/article.en.md'), page('English', 'English content'));
  const content = await new ContentRepository(root).load();
  assert.equal(localizedContent(content, 'pl').pages.get('/article')!.title, 'Polski');
  assert.equal(localizedContent(content, 'en').pages.get('/article')!.title, 'English');
  assert.equal(localizedContent(content, 'fr').pages.get('/article')!.title, 'Polski');
});

test('the editor migrates neutral and localized filenames only when saving', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-language-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new PanelFiles(root);
  await files.write('site.yml', 'title: Test\nlanguage: pl\nlanguages: [pl, en]\nmenu: []\n');
  await files.write('pages/article.md', page('Polski', 'Przed migracją'));
  let store = new PanelStore(files);
  const multilingual = await store.page('/article');
  assert.equal(multilingual.file, 'pages/article.md');
  assert.equal(multilingual.targetFile, 'pages/article.pl.md');
  assert.equal(multilingual.migration, true);
  await store.savePage({ path: '/article', language: 'pl', revision: multilingual.revision, title: 'Polski', order: 0, body: 'Po migracji' });
  await assert.rejects(access(join(root, 'pages/article.md')));
  assert.match(await readFile(join(root, 'pages/article.pl.md'), 'utf8'), /Po migracji/);

  await files.write('site.yml', 'title: Test\nlanguage: pl\nlanguages: [pl]\nmenu: []\n');
  store = new PanelStore(files);
  const single = await store.page('/article');
  assert.equal(single.file, 'pages/article.pl.md');
  assert.equal(single.targetFile, 'pages/article.md');
  assert.equal(single.migration, true);
  await store.savePage({ path: '/article', language: 'pl', revision: single.revision, title: 'Polski', order: 0, body: 'Jeden język' });
  await assert.rejects(access(join(root, 'pages/article.pl.md')));
  assert.match(await readFile(join(root, 'pages/article.md'), 'utf8'), /Jeden język/);
});

test('language configuration and explicit query selection are validated', () => {
  assert.deepEqual(siteSchema.parse({ language: 'pl' }).languages, ['pl']);
  assert.equal(siteSchema.safeParse({ language: 'pl', languages: ['en'] }).success, false);
  assert.equal(siteSchema.parse({ language: 'PL' }).language, 'pl');
  for (const invalid of ['p', 'pl_PL', '../pl', 'pl, en']) assert.equal(siteSchema.safeParse({ language: invalid }).success, false, invalid);
  const site = siteSchema.parse({ language: 'en', languages: ['en', 'pl', 'fr'] });
  assert.deepEqual(requestLanguage(site, 'pl', 'karui-language=fr', 'en-US'), { language: 'pl', explicit: true });
  assert.deepEqual(requestLanguage(site, null, 'karui-language=fr', 'pl-PL'), { language: 'fr', explicit: false });
  assert.deepEqual(requestLanguage(site, null, undefined, 'fr-CA,fr;q=0.9,en;q=0.7'), { language: 'fr', explicit: false });
  assert.deepEqual(requestLanguage(site, null, undefined), { language: 'en', explicit: false });
  assert.deepEqual(languageLinks('/article?filter=new&lang=en', site.languages, 'pl'), [
    { code: 'en', current: false, href: '/article?filter=new&lang=en' },
    { code: 'pl', current: true, href: '/article?filter=new&lang=pl' },
    { code: 'fr', current: false, href: '/article?filter=new&lang=fr' },
  ]);
});

test('gettext catalogs use English source strings and Polish and French translations', async () => {
  const translations = await Translations.load(join(process.cwd(), 'karui/lang'));
  assert.equal(translations.translator('en')('Administration panel'), 'Administration panel');
  assert.equal(translations.translator('pl')('Administration panel'), 'Panel Administracyjny');
  assert.equal(translations.translator('fr')('Administration panel'), 'Panneau d’administration');
});

test('menu layout stays in site.yml while translated labels are stored in a content PO catalog', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-menu-languages-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new PanelFiles(root);
  await files.write('site.yml', 'title: Test\nlanguage: pl\nlanguages: [pl, en]\nmenu:\n  - title: Aktualności\n    href: /news\n    children:\n      - title: Archiwum\n        href: /news/archive\n');
  await files.write('pages/news/index.pl.md', page('Aktualności', 'Nowości'));
  await files.write('pages/news/archive.pl.md', page('Archiwum', 'Starsze wpisy'));
  const store = new PanelStore(files);
  const editor = await store.menu('en');
  assert.equal(editor.language, 'en');
  assert.equal(editor.defaultLanguage, 'pl');
  assert.deepEqual(editor.translations, [
    { source: 'Aktualności', translation: '' },
    { source: 'Archiwum', translation: '' },
  ]);
  await store.saveMenuTranslations({
    language: 'en',
    revision: editor.translationRevision,
    siteRevision: editor.revision,
    translations: [
      { source: 'Aktualności', translation: 'News' },
      { source: 'Archiwum', translation: 'Archive' },
    ],
  });
  const source = (await files.read('site.yml')).toString();
  assert.match(source, /title: Aktualności/);
  assert.doesNotMatch(source, /title: News/);
  assert.match((await files.read('lang/en.po')).toString(), /msgctxt "karui-menu"[\s\S]*msgid "Aktualności"[\s\S]*msgstr "News"/);
  const content = await new ContentRepository(root).load();
  assert.equal(localizedContent(content, 'pl').site.menu[0]!.title, 'Aktualności');
  assert.equal(localizedContent(content, 'en').site.menu[0]!.title, 'News');
  assert.equal(localizedContent(content, 'en').site.menu[0]!.children[0]!.title, 'Archive');
});

test('a gallery can be copied from an existing language into a missing language variant', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-gallery-language-copy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new PanelFiles(root);
  await files.write('site.yml', 'title: Test\nlanguage: pl\nlanguages: [pl, en, fr]\nmenu: []\n');
  await files.write('pages/article.pl.md', '---\ntitle: Artykuł\ngallery:\n  - src: /media/photo.png\n    thumbnail: /media/photo-small.png\n    alt: Zdjęcie\n---\nTreść');
  await files.write('pages/article.fr.md', page('Article', 'Contenu'));
  const store = new PanelStore(files);
  const target = await store.page('/article', 'en');
  assert.equal(target.inherited, true);
  await store.copyGallery({ path: '/article', language: 'en', sourceLanguage: 'pl', revision: target.revision });
  const copied = await store.page('/article', 'en');
  assert.equal(copied.inherited, false);
  assert.deepEqual(copied.page.gallery, [{ src: '/media/photo.png', thumbnail: '/media/photo-small.png', alt: 'Zdjęcie' }]);
  assert.match((await files.read('pages/article.en.md')).toString(), /gallery:[\s\S]*photo-small\.png/);
  await assert.rejects(
    store.copyGallery({ path: '/article', language: 'en', sourceLanguage: 'fr', revision: copied.revision }),
    /gallery is empty/,
  );
});

test('localized site settings overlay only translatable fields from the main site.yml', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-site-language-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = new PanelFiles(root);
  await files.write('site.yml', 'title: Polska strona\ndescription: Polski opis\nbrandName: Polska marka\ntagline: Polskie hasło\nfooter: Polska stopka\nfooterFormat: markdown\ntheme: default\nhome: /\nlanguage: pl\nlanguages: [pl, en]\nmenu: []\n');
  const store = new PanelStore(files);
  const inherited = await store.settings('en');
  assert.equal(inherited.inherited, true);
  assert.equal(inherited.site.title, 'Polska strona');
  await store.saveLocalizedSettings({
    language: 'en', revision: inherited.revision, siteRevision: inherited.siteRevision,
    title: 'English site', description: 'English description', brandName: 'English brand',
    tagline: 'English tagline', footer: 'English footer',
  });
  const localizedFile = (await files.read('site.en.yml')).toString();
  assert.match(localizedFile, /title: English site/);
  assert.doesNotMatch(localizedFile, /theme:|home:|language:|footerFormat:/);
  const content = await new ContentRepository(root).load();
  const english = localizedContent(content, 'en').site;
  assert.equal(english.title, 'English site');
  assert.equal(english.footer, 'English footer');
  assert.equal(english.theme, 'default');
  assert.equal(english.footerFormat, 'markdown');
  assert.equal(localizedContent(content, 'pl').site.title, 'Polska strona');
  await assert.rejects(store.saveLocalizedSettings({
    language: 'en', revision: inherited.revision, siteRevision: inherited.siteRevision,
    title: 'Stale', description: '', brandName: '', tagline: '', footer: '',
  }), { statusCode: 409 });
});
