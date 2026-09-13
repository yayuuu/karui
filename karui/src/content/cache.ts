import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ContentRepository, type Content } from '../content.js';

class SupersededRefresh extends Error {
  constructor() { super('Content changed during refresh; retaining the previous snapshot until retry.'); }
}

/** Derived public content only. Accounts, sessions, media and plugin state are never cached here. */
export class CachedContentRepository extends ContentRepository {
  private snapshot?: Content;
  private signature = '';
  private revision = 0;
  private publishedRevision = -1;
  private pending?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private cacheDirectory?: string;
  private stopped = false;

  constructor(
    private readonly sourceDirectory: string,
    private readonly cacheRoot: string,
    private readonly refreshMs = 1000,
    private readonly reportError: (error: unknown) => void = () => {},
  ) { super(sourceDirectory); }

  override invalidate(): void { this.revision++; }

  override async load(): Promise<Content> {
    // The HTTP hot path performs no filesystem access, not even a stat on CephFS.
    let retries = 0;
    while (!this.snapshot || this.publishedRevision !== this.revision) {
      try { await this.refresh(); }
      catch (error) {
        // A poll may have started before the panel committed its write. Discard
        // that result and read the new revision, without masking real I/O errors.
        if (!(error instanceof SupersededRefresh) || ++retries > 3) throw error;
      }
    }
    return this.snapshot;
  }

  /** Serialize polling and post-edit refreshes so an older read cannot overwrite a newer one. */
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const task = this.rebuild();
    this.pending = task;
    void task.then(() => { this.pending = undefined; }, () => { this.pending = undefined; });
    return task;
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(async () => {
      try { await this.refresh(); } catch (error) { this.reportError(error); }
      this.timer = undefined;
      this.start();
    }, this.refreshMs);
    this.timer.unref();
  }

  async close(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending?.catch(() => {});
    if (this.cacheDirectory) await rm(this.cacheDirectory, { recursive: true, force: true });
  }

  private async rebuild(): Promise<void> {
    if (this.stopped) return;
    const revision = this.revision;
    const signature = await this.fingerprint();
    if (this.snapshot && signature === this.signature && revision === this.publishedRevision) return;

    const next = await super.load();
    // Never publish a mix of files that changed while the snapshot was being built.
    if (signature !== await this.fingerprint() || revision !== this.revision) {
      throw new SupersededRefresh();
    }
    if (!this.cacheDirectory) {
      await mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
      this.cacheDirectory = await mkdtemp(join(this.cacheRoot, 'snapshot-'));
    }
    const temporary = join(this.cacheDirectory, 'content.json.pending');
    try {
      await writeFile(temporary, JSON.stringify({
        version: 4,
        site: next.site,
        pages: [...next.pages],
        translations: [...(next.translations ?? [])].map(([href, variants]) => [href, [...variants]]),
        menuTranslations: [...(next.menuTranslations ?? [])].map(([language, messages]) => [language, [...messages]]),
        siteTranslations: [...(next.siteTranslations ?? [])],
      }), { mode: 0o600 });
      await rename(temporary, join(this.cacheDirectory, 'content.json'));
    } finally {
      await rm(temporary, { force: true });
    }
    this.snapshot = next;
    this.signature = signature;
    this.publishedRevision = revision;
  }

  private async fingerprint(): Promise<string> {
    // An empty mounted directory is valid; a disappearing mount is an I/O failure.
    await lstat(this.sourceDirectory);
    const hash = createHash('sha256');
    const file = async (path: string) => {
      const info = await lstat(path, { bigint: true });
      hash.update(`${path}\0${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}\0`);
    };
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory() && /^[a-z0-9-]+$/.test(entry.name)) await visit(path);
        else if (entry.isFile() && /^[a-z0-9-]+(?:\.[a-z]{2,3}(?:-[a-z0-9]{2,8})*)?\.md$/.test(entry.name)) await file(path);
      }
    };
    await file(join(this.sourceDirectory, 'site.yml')).catch(error => { if (error.code !== 'ENOENT') throw error; hash.update('no-site'); });
    const rootEntries = await readdir(this.sourceDirectory, { withFileTypes: true });
    rootEntries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of rootEntries) if (entry.isFile() && /^site\.[a-z]{2,3}(?:-[a-z0-9]{2,8})*\.yml$/.test(entry.name)) await file(join(this.sourceDirectory, entry.name));
    await visit(join(this.sourceDirectory, 'pages')).catch(error => { if (error.code !== 'ENOENT') throw error; hash.update('no-pages'); });
    const languages = join(this.sourceDirectory, 'lang');
    const catalogs = await readdir(languages, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    catalogs.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of catalogs) if (entry.isFile() && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*\.po$/.test(entry.name)) await file(join(languages, entry.name));
    return hash.digest('hex');
  }
}
