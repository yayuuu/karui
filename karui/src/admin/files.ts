import { link, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class PanelError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Serializes panel writes, confines every path, and publishes complete files. */
export class PanelFiles {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.catch(() => undefined).then(operation);
    this.queue = task;
    return task;
  }
  async path(relative: string, createParents = false) {
    if (!relative || relative.split('/').some(part => !part || part === '.' || part === '..') || relative.includes('\\') || relative.includes('\0')) throw new PanelError('Invalid path.');
    const root = resolve(this.root);
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) throw new PanelError('The path is outside the content directory.');
    let current = root;
    const parts = relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]!);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new PanelError('Symbolic links are not supported.');
      } catch (error) {
        if (!isMissing(error)) throw error;
        if (createParents && i < parts.length - 1) await mkdir(current, { mode: 0o700 });
      }
    }
    return path;
  }
  async read(relative: string) { return readFile(await this.path(relative)); }
  async write(relative: string, data: string | Buffer, exclusive = false) {
    const target = await this.path(relative, true);
    const temporary = join(dirname(target), '.' + randomUUID() + '.tmp');
    try {
      await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      if (exclusive) await link(temporary, target);
      else await rename(temporary, target);
    } finally { await unlink(temporary).catch(error => { if (!isMissing(error)) throw error; }); }
  }
  async remove(relative: string) { await unlink(await this.path(relative)); }
  async checkRevision(relative: string, expected: unknown) {
    const source = await this.read(relative);
    if (typeof expected !== 'string' || expected !== digest(source)) throw new PanelError('The file changed after opening the form. Refresh the page before saving; your changes were not overwritten.', 409);
    return source.toString('utf8');
  }
}
