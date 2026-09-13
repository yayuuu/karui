import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { containedFile, type Page, type Photo } from './content.js';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

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

type Dimensions = { width: number; height: number };

/** Presentation metadata only: content and original image files are never rewritten. */
export class GalleryImages {
  private readonly cache = new Map<string, { signature: string; size: Dimensions }>();
  constructor(private readonly contentRoot: string) {}

  async describe(photos: Photo[]): Promise<(Photo & Dimensions)[]> {
    const result: (Photo & Dimensions)[] = [];
    for (const photo of photos) {
      let size: Dimensions = { width: 1, height: 1 };
      try {
        const path = await containedFile(join(this.contentRoot, 'media'), decodeURIComponent(photo.src.slice('/media/'.length)));
        if (path) {
          const info = await stat(path);
          const signature = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
          const cached = this.cache.get(path);
          if (cached?.signature === signature) size = cached.size;
          else {
            const metadata = await sharp(path, { limitInputPixels: 25_000_000 }).metadata();
            const dimensions = metadata.autoOrient ?? metadata;
            if (dimensions.width && dimensions.height) size = { width: dimensions.width, height: dimensions.height };
            if (this.cache.size >= 2000) this.cache.delete(this.cache.keys().next().value!);
            this.cache.set(path, { signature, size });
          }
        }
      } catch { /* One missing/corrupt image must not prevent rendering the gallery. */ }
      result.push({ ...photo, ...size });
    }
    return result;
  }
}
