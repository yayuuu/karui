import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build, version as esbuildVersion } from 'esbuild';
import { Edge } from 'edge.js';
import { z } from 'zod';

export const themeName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const manifestSchema = z.object({ name: z.string().min(1).max(100), version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/), description: z.string().max(500).default('') }).strict();
const pathSchema = z.string().max(240).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/);
const artifactSchema = z.object({ key: z.string().regex(/^[a-f0-9]{64}$/), name: themeName, label: z.string(), version: z.string(), templates: z.record(pathSchema, z.string()), assets: z.array(pathSchema).max(1024) });
type Artifact = z.infer<typeof artifactSchema>;
export type Theme = { name: string; key: string; label: string; version: string; assets: Record<string, string>; client: string };
export type ThemeView = { edge: Edge; theme: Theme; assetVersion: string };
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Only explicit template/asset trees are copied; client source is bundled, not imported by Node. */
async function tree(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  let size = 0, entries = 0;
  const visit = async (directory: string, prefix = '') => {
    let info;
    try { info = await lstat(directory); } catch (error) { if (missing(error) && !prefix) return; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Theme directory must not be a symbolic link');
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++entries > 2048) throw new Error('Theme contains too many entries');
      if (item.name.startsWith('.') || item.name === 'node_modules' || item.isSymbolicLink()) continue;
      const path = pathSchema.parse(prefix + item.name);
      if (item.isDirectory()) { await visit(join(directory, item.name), path + '/'); continue; }
      if (!item.isFile()) throw new Error('Unsupported theme file');
      const file = join(directory, item.name), info = await lstat(file);
      if (info.isSymbolicLink() || info.size > 32 * 1024 * 1024) throw new Error('Theme file exceeds 32 MiB or is a symbolic link');
      const data = await readFile(file);
      size += data.length;
      if (size > 128 * 1024 * 1024 || files.size >= 1024) throw new Error('Theme exceeds 128 MiB or 1024 files');
      files.set(path, data);
    }
  };
  await visit(root);
  return files;
}

export class Themes {
  private views = new Map<string, ThemeView>();
  private pending = new Map<string, Promise<ThemeView>>();
  private defaults?: Promise<{ templates: Record<string, string>; assets: Map<string, Buffer>; key: string }>;
  constructor(private readonly root: string, private readonly content: string, private readonly cache: string,
    private readonly engineVersion: string, private readonly warn: (error: unknown) => void = () => {}) {}

  private base() {
    return this.defaults ??= (async () => {
      const files = await tree(join(this.root, 'templates'));
      const templates = Object.fromEntries([...files].filter(([name]) => name.endsWith('.edge') && !name.startsWith('assets/')).map(([name, data]) => [name.slice(0, -5), data.toString()]));
      const assets = new Map([...files].filter(([name]) => name.startsWith('assets/')).map(([name, data]) => [name.slice(7), data]));
      const digest = createHash('sha256');
      for (const [name, data] of [...files].sort(([a], [b]) => a.localeCompare(b))) digest.update(name).update(data);
      return { templates, assets, key: digest.digest('hex') };
    })();
  }

  private async customDirectory(name: string) {
    const matches: string[] = [];
    for (const group of ['themes', 'templates']) {
      const root = join(this.content, group);
      let rootInfo;
      try { rootInfo = await lstat(root); } catch (error) { if (missing(error)) continue; throw error; }
      if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error(`Theme source ${group} must be a directory and must not be a symbolic link`);
      const directory = join(root, name);
      let info;
      try { info = await lstat(directory); } catch (error) { if (missing(error)) continue; throw error; }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Theme directory must be a directory and must not be a symbolic link');
      matches.push(directory);
    }
    if (matches.length > 1) throw new Error(`Theme ${name} exists in both content/themes and content/templates`);
    if (!matches.length) {
      const error = new Error(`Theme ${name} does not exist`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
    return matches[0]!;
  }

  async manifest(name: string) {
    themeName.parse(name);
    const directory = await this.customDirectory(name);
    if ((await lstat(join(directory, 'theme.json'))).isSymbolicLink()) throw new Error('Theme paths must not be symbolic links');
    const data = await readFile(join(directory, 'theme.json'), 'utf8');
    if (data.length > 4096) throw new Error('Theme manifest exceeds 4 KiB');
    return manifestSchema.parse(JSON.parse(data));
  }

  async list() {
    const result = [{ id: 'default', name: 'Default', version: '1', description: 'A simple, universal site theme.', error: '' }];
    const names = new Set<string>();
    for (const group of ['themes', 'templates']) {
      const root = join(this.content, group);
      let entries;
      try {
        if ((await lstat(root)).isSymbolicLink()) continue;
        entries = await readdir(root, { withFileTypes: true });
      } catch (error) { if (missing(error)) continue; throw error; }
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'default' && themeName.safeParse(entry.name).success) names.add(entry.name);
      }
    }
    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
      try { result.push({ id: name, ...await this.manifest(name), error: '' }); }
      catch { result.push({ id: name, name, version: '—', description: '', error: 'Invalid theme manifest or duplicate name.' }); }
    }
    return result;
  }

  async get(name = 'default'): Promise<ThemeView> {
    try { return await this.load(name); }
    catch (error) { if (name === 'default') throw error; this.warn(error); return this.load('default'); }
  }

  async validate(name: string) { return this.load(themeName.parse(name)); }

  private async load(name: string): Promise<ThemeView> {
    themeName.parse(name);
    const base = await this.base();
    const directory = name === 'default' ? '' : await this.customDirectory(name);
    const manifest = name === 'default' ? { name: 'Default', version: '1' } : await this.manifest(name);
    const key = hash(JSON.stringify([1, this.engineVersion, base.key, esbuildVersion, directory, name, manifest.version]));
    const saved = this.views.get(key);
    if (saved) return saved;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = (async () => {
      let artifact: Artifact | undefined;
      try {
        const value = artifactSchema.parse(JSON.parse(await readFile(join(this.cache, key, 'manifest.json'), 'utf8')));
        if (value.key === key && value.name === name) artifact = value;
      } catch (error) { if (!missing(error) && !(error instanceof SyntaxError || error instanceof z.ZodError)) throw error; }
      if (!artifact) {
        const templates = { ...base.templates }, assets = new Map(base.assets);
        if (name !== 'default') {
          for (const [path, data] of await tree(join(directory, 'templates'))) {
            if (path.endsWith('.edge')) templates[path.slice(0, -5)] = data.toString();
          }
          for (const [path, data] of await tree(join(directory, 'assets'))) assets.set(path, data);
          const source = await lstat(join(directory, 'client.ts')).catch(error => { if (missing(error)) return undefined; throw error; });
          if (source) {
            if (!source.isFile() || source.isSymbolicLink()) throw new Error('Invalid theme client entry');
            const built = await build({ entryPoints: [join(directory, 'client.ts')], bundle: true, write: false, minify: true,
              platform: 'browser', format: 'esm', target: 'es2022', nodePaths: [join(this.root, 'node_modules'), join(this.root, '..', 'node_modules')],
              tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'preact' } }, logLevel: 'silent' });
            if (built.outputFiles[0]!.contents.length > 4_000_000) throw new Error('Theme client exceeds 4 MB');
            assets.set('client.js', Buffer.from(built.outputFiles[0]!.contents));
          }
        }
        artifact = { key, name, label: manifest.name, version: manifest.version, templates, assets: [...assets.keys()] };
        artifactSchema.parse(artifact);
        await mkdir(this.cache, { recursive: true, mode: 0o700 });
        const staging = await mkdtemp(join(this.cache, '.pending-'));
        try {
          for (const [path, data] of assets) {
            await mkdir(dirname(join(staging, 'assets', path)), { recursive: true, mode: 0o700 });
            await writeFile(join(staging, 'assets', path), data, { flag: 'wx', mode: 0o600 });
          }
          await writeFile(join(staging, 'manifest.json'), JSON.stringify(artifact), { flag: 'wx', mode: 0o600 });
          try { await rename(staging, join(this.cache, key)); }
          catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
        } finally { await rm(staging, { recursive: true, force: true }); }
      }
      const theme: Theme = { name, key, label: artifact.label, version: artifact.version,
        assets: Object.fromEntries(artifact.assets.map(path => [path, `/assets/themes/${name}/${key}/${path}`])), client: '' };
      theme.client = theme.assets['client.js'] ?? '';
      const edge = Edge.create({ cache: true });
      for (const [path, template] of Object.entries(artifact.templates)) edge.registerTemplate(path, { template });
      edge.global('theme', theme);
      const view = { theme, edge, assetVersion: hash(this.engineVersion + key).slice(0, 16) };
      this.views.set(key, view);
      if (this.views.size > 16) this.views.delete(this.views.keys().next().value!);
      return view;
    })();
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }

  async asset(name: string, key: string, path: string) {
    if (!themeName.safeParse(name).success || !/^[a-f0-9]{64}$/.test(key) || !pathSchema.safeParse(path).success) return null;
    try {
      const artifact = artifactSchema.parse(JSON.parse(await readFile(join(this.cache, key, 'manifest.json'), 'utf8')));
      if (artifact.name !== name || artifact.key !== key || !artifact.assets.includes(path)) return null;
      return { root: join(this.cache, key, 'assets'), path };
    } catch (error) { if (missing(error) || error instanceof z.ZodError || error instanceof SyntaxError) return null; throw error; }
  }
}
