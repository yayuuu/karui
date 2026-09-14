import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { type Page, type Photo } from './content.js';
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

const usedImages = new WeakMap<Page, string[]>();
export function visibleGallery(page: Page, origin: string): Photo[] {
  if (page.galleryVisibility === 'hidden') return [];
  if (page.galleryVisibility !== 'unused') return page.gallery;
  let images = usedImages.get(page);
  if (!images) {
    images = [];
    const visit = (node: DefaultTreeAdapterMap['node']) => {
      if ('tagName' in node && ['img', 'source'].includes(node.tagName)) {
        for (const attribute of node.attrs) {
          if (attribute.name === 'src') images!.push(attribute.value);
          if (attribute.name === 'srcset') images!.push(...attribute.value.split(',').map(item => item.trim().split(/\s+/)[0]!));
        }
      }
      if ('childNodes' in node) node.childNodes.forEach(visit);
    };
    visit(parseFragment(page.html)); usedImages.set(page, images);
  }
  const normalize = (src: string) => {
    try {
      const url = new URL(src, new URL(page.href, origin));
      return url.host === new URL(origin).host && ['http:', 'https:'].includes(url.protocol) ? decodeURIComponent(url.pathname) : undefined;
    } catch { return undefined; }
  };
  const used = new Set(images.map(normalize).filter(Boolean));
  return page.gallery.filter(photo => ![photo.src, photo.thumbnail, photo.download].some(src => src && used.has(normalize(src))));
}

type Element = DefaultTreeAdapterMap['element'];
const attribute = (element: Element, name: string) => element.attrs.find(item => item.name === name)?.value;
const setAttribute = (element: Element, name: string, value: string) => {
  const existing = element.attrs.find(item => item.name === name);
  if (existing) existing.value = value;
  else element.attrs.push({ name, value });
};
const mediaPath = (value: string, href: string, origin: string) => {
  try {
    const base = new URL(href, origin), url = new URL(value, base);
    return url.origin === base.origin ? decodeURIComponent(url.pathname) : '';
  }
  catch { return ''; }
};

/** Turn gallery photos embedded in page content into lightweight, accessible lightbox triggers. */
export function inlineGallery(html: string, href: string, photos: Photo[], origin = 'http://karui.invalid'): { html: string; count: number } {
  if (!photos.length || !html.includes('<img')) return { html, count: 0 };
  const bySource = new Map(photos.map(photo => [mediaPath(photo.src, href, origin), photo]));
  const byThumbnail = new Map(photos.map(photo => [mediaPath(photo.thumbnail, href, origin), photo]));
  const fragment = parseFragment(html);
  let count = 0;
  const visit = (node: DefaultTreeAdapterMap['node'], parent?: DefaultTreeAdapterMap['parentNode']) => {
    if ('tagName' in node && node.tagName === 'img') {
      const link = parent && 'tagName' in parent && parent.tagName === 'a' ? parent : undefined;
      const preview = byThumbnail.get(mediaPath(attribute(node, 'src') ?? '', href, origin));
      const target = link ? bySource.get(mediaPath(attribute(link, 'href') ?? '', href, origin)) : undefined;
      if (link && preview && target?.src === preview.src) {
        if (!attribute(node, 'loading')) setAttribute(node, 'loading', 'lazy');
        if (!attribute(node, 'decoding')) setAttribute(node, 'decoding', 'async');
        setAttribute(link, 'href', preview.src);
        setAttribute(link, 'data-gallery-src', preview.src);
        const classes = new Set((attribute(link, 'class') ?? '').split(/\s+/).filter(Boolean));
        classes.add('inline-gallery-photo'); setAttribute(link, 'class', [...classes].join(' '));
        count++;
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, node);
  };
  visit(fragment);
  return count ? { html: serialize(fragment), count } : { html, count: 0 };
}

type ImageMetadata = { width: number; height: number; bytes?: number; mtimeMs?: number };
type CachedGallery = {
  version: 1;
  href: string;
  language: string;
  digest: string;
  images: ImageMetadata[];
};

/** Resolve a canonical URL path without touching the filesystem. Symlinks are intentional content. */
export function mediaFilePath(mediaRoot: string, path: string): string | null {
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/')) return null;
  const segments = path.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
  return resolve(mediaRoot, ...segments);
}

/** Presentation metadata only: content and original image files are never rewritten. */
export class GalleryImages {
  private readonly memory = new Map<string, { digest: string; images: ImageMetadata[] }>();
  private readonly pending = new Map<string, { digest: string; promise: Promise<ImageMetadata[]> }>();
  private readonly generations = new Map<string, number>();

  constructor(private readonly contentRoot: string, private readonly cacheRoot: string) {}

  async describe(page: Pick<Page, 'href' | 'gallery'>, language: string): Promise<(Photo & ImageMetadata)[]> {
    if (!page.gallery.length) return [];
    const key = this.key(page.href, language);
    const digest = createHash('sha256').update(JSON.stringify(page.gallery)).digest('hex');
    const cached = this.memory.get(key);
    if (cached?.digest === digest) return this.combine(page.gallery, cached.images);

    const active = this.pending.get(key);
    if (active) {
      if (active.digest === digest) return this.combine(page.gallery, await active.promise);
      await active.promise.catch(() => {});
      return this.describe(page, language);
    }

    const generation = this.generations.get(key) ?? 0;
    const promise = this.loadOrCreate(page, language, key, digest, generation);
    this.pending.set(key, { digest, promise });
    try {
      const images = await promise;
      if ((this.generations.get(key) ?? 0) === generation) {
        this.memory.delete(key);
        this.memory.set(key, { digest, images });
        if (this.memory.size > 2000) this.memory.delete(this.memory.keys().next().value!);
      }
      return this.combine(page.gallery, images);
    } finally {
      if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
    }
  }

  async invalidate(href: string, language: string): Promise<void> {
    const key = this.key(href, language);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    this.memory.delete(key);
    await rm(this.file(key), { force: true }).catch(() => {});
  }

  private combine(photos: Photo[], images: ImageMetadata[]) {
    return photos.map((photo, index) => ({ ...photo, ...(images[index] ?? { width: 1, height: 1 }) }));
  }

  private key(href: string, language: string) {
    return createHash('sha256').update(`${href}\0${language}`).digest('hex');
  }

  private file(key: string) {
    return join(this.cacheRoot, key + '.json');
  }

  private valid(value: unknown, page: Pick<Page, 'href' | 'gallery'>, language: string, digest: string): value is CachedGallery {
    if (!value || typeof value !== 'object') return false;
    const cache = value as Partial<CachedGallery>;
    return cache.version === 1 && cache.href === page.href && cache.language === language && cache.digest === digest
      && Array.isArray(cache.images) && cache.images.length === page.gallery.length
      && cache.images.every(image => Number.isFinite(image?.width) && image.width > 0 && Number.isFinite(image?.height) && image.height > 0);
  }

  private async loadOrCreate(page: Pick<Page, 'href' | 'gallery'>, language: string, key: string, digest: string, generation: number) {
    try {
      const cached: unknown = JSON.parse(await readFile(this.file(key), 'utf8'));
      if (this.valid(cached, page, language, digest)) return cached.images;
    } catch { /* A missing or damaged derived cache is rebuilt from source images. */ }

    const images: ImageMetadata[] = [];
    for (let offset = 0; offset < page.gallery.length; offset += 16) {
      images.push(...await Promise.all(page.gallery.slice(offset, offset + 16).map(photo => this.inspect(photo))));
    }
    if ((this.generations.get(key) ?? 0) === generation) {
      const cache: CachedGallery = { version: 1, href: page.href, language, digest, images };
      const temporary = this.file(key) + '.' + randomUUID() + '.pending';
      try {
        await mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
        await writeFile(temporary, JSON.stringify(cache), { mode: 0o600 });
        if ((this.generations.get(key) ?? 0) === generation) await rename(temporary, this.file(key));
      } catch { /* Cache persistence must never make a page unavailable. */ }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
    }
    return images;
  }

  private async inspect(photo: Photo): Promise<ImageMetadata> {
    const fallback: ImageMetadata = { width: 1, height: 1 };
    try {
      const path = mediaFilePath(join(this.contentRoot, 'media'), decodeURIComponent(photo.src.slice('/media/'.length)));
      if (!path) return fallback;
      const [info, metadata] = await Promise.all([
        stat(path),
        sharp(path, { limitInputPixels: 25_000_000 }).metadata(),
      ]);
      const dimensions = metadata.autoOrient ?? metadata;
      if (!dimensions.width || !dimensions.height) return fallback;
      return { width: dimensions.width, height: dimensions.height, bytes: info.size, mtimeMs: info.mtimeMs };
    } catch { return fallback; }
  }
}
