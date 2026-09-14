import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { GalleryImages } from '../src/gallery.js';

test('gallery dimensions follow files and intentional symlinks, refresh after replacement and isolate invalid paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-gallery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'media'));
  const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#123456' } }).png().toBuffer();
  await writeFile(join(root, 'media/photo.png'), await png(120, 80));
  await writeFile(join(root, 'media/broken.png'), 'not an image');
  await writeFile(join(root, 'private.png'), await png(30, 60));
  await symlink(join(root, 'private.png'), join(root, 'media/link.png'));
  const cache = join(root, 'cache');
  const images = new GalleryImages(root, cache);
  const photos = ['photo.png', 'broken.png', 'missing.png', 'link.png', '../private.png'].map(file => ({ src: '/media/' + file, thumbnail: '/media/' + file, alt: file }));
  const page = { href: '/gallery', gallery: photos };
  const sizes = (values: Awaited<ReturnType<GalleryImages['describe']>>) => values.map(({ width, height }) => [width, height]);
  assert.deepEqual(sizes(await images.describe(page, 'en')), [[120, 80], [1, 1], [1, 1], [30, 60], [1, 1]]);
  assert.equal((await readdir(cache)).filter(file => file.endsWith('.json')).length, 1);

  // A fresh process needs one cache-file read, but no metadata reads for every source image.
  await writeFile(join(root, 'media/photo.png'), await png(40, 100));
  const restarted = new GalleryImages(root, cache);
  assert.deepEqual(sizes(await restarted.describe(page, 'en'))[0], [120, 80]);
  await restarted.invalidate(page.href, 'en');
  assert.deepEqual(sizes(await restarted.describe(page, 'en'))[0], [40, 100]);

  const polish = await restarted.describe(page, 'pl');
  assert.deepEqual(sizes(polish)[0], [40, 100]);
  assert.equal((await readdir(cache)).filter(file => file.endsWith('.json')).length, 2);
  assert.deepEqual(await images.describe({ href: '/empty', gallery: [] }, 'en'), []);
});
