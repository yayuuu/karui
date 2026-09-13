import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { GalleryImages } from '../src/gallery.js';

test('gallery dimensions follow files, refresh after replacement and isolate broken/escaping files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'karui-gallery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'media'));
  const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#123456' } }).png().toBuffer();
  await writeFile(join(root, 'media/photo.png'), await png(120, 80));
  await writeFile(join(root, 'media/broken.png'), 'not an image');
  await writeFile(join(root, 'private.png'), await png(30, 60));
  await symlink(join(root, 'private.png'), join(root, 'media/link.png'));
  const images = new GalleryImages(root);
  const photos = ['photo.png', 'broken.png', 'missing.png', 'link.png', '../private.png'].map(file => ({ src: '/media/' + file, thumbnail: '/media/' + file, alt: file }));
  const sizes = (values: Awaited<ReturnType<GalleryImages['describe']>>) => values.map(({ width, height }) => [width, height]);
  assert.deepEqual(sizes(await images.describe(photos)), [[120, 80], [1, 1], [1, 1], [1, 1], [1, 1]]);
  await writeFile(join(root, 'media/photo.png'), await png(40, 100));
  assert.deepEqual(sizes(await images.describe(photos))[0], [40, 100]);
  assert.deepEqual(await images.describe([]), []);
});
