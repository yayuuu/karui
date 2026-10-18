import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.js';
import { configFromEnv } from '../src/config.js';
import { resultSchema } from '../src/plugins/contracts.js';

test('plugin file responses stream attachments, HEAD and ranges without buffering in workers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-file-download-'));
  await mkdir(join(root, 'plugins/downloads'), { recursive: true });
  await mkdir(join(root, 'pages'));
  await mkdir(join(root, 'media/files'), { recursive: true });
  await writeFile(join(root, 'site.yml'), 'title: Test\nhome: /\nlanguage: en\nmenu: []\n');
  await writeFile(join(root, 'pages/downloads.md'), '---\ntitle: Downloads\nplugin: downloads\n---\n');
  await writeFile(join(root, 'plugins/downloads/plugin.json'), '{"version":"1","concurrent":true}');
  await writeFile(join(root, 'plugins/downloads/index.ts'), `export default context => ({type:'file',name:context.suffix.slice(1)})`);
  const data = Buffer.alloc(5_000_001, 0x61);
  await writeFile(join(root, 'media/files/Carbonyl-x86_64.AppImage'), data);
  await writeFile(join(root, 'media/files/empty.txt'), '');
  await writeFile(join(root, 'outside.txt'), 'private');
  await symlink(join(root, 'outside.txt'), join(root, 'media/files/leak.txt'));
  await mkdir(join(root, 'media/files/directory'));
  const app = await buildApp({ ...configFromEnv({}), contentDir: root, contentCacheDir: join(root, 'cache'), pluginWorkers: 1, pluginMaxWorkers: 2 });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const url = '/downloads/Carbonyl-x86_64.AppImage';
  const response = await app.inject(url);
  assert.equal(response.statusCode, 200, response.body.slice(0, 100));
  assert.deepEqual(response.rawPayload, data);
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.equal(response.headers['content-disposition'], 'attachment; filename="Carbonyl-x86_64.AppImage"');
  assert.equal(response.headers['content-length'], String(data.length));
  const head = await app.inject({ method: 'HEAD', url });
  assert.equal(head.statusCode, 200); assert.equal(head.rawPayload.length, 0);
  assert.equal(head.headers['content-length'], String(data.length));
  const part = await app.inject({ url, headers: { range: 'bytes=100-199' } });
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers['content-range'], `bytes 100-199/${data.length}`);
  assert.deepEqual(part.rawPayload, data.subarray(100, 200));
  assert.equal((await app.inject({ url, headers: { range: 'bytes=99999999-' } })).statusCode, 416);
  assert.equal((await app.inject('/downloads/empty.txt')).rawPayload.length, 0);
  for (const name of ['missing.txt', 'leak.txt', 'directory']) {
    assert.equal((await app.inject('/downloads/' + name)).statusCode, 404, name);
  }
  assert.equal((await app.inject({ method: 'POST', url })).statusCode, 405);
  for (const name of ['../outside.txt', '/etc/passwd', '.hidden', 'a/b', 'a\\b', 'x\r\nInjected: true']) {
    assert.equal(resultSchema.safeParse({ type: 'file', name }).success, false, name);
  }
});
