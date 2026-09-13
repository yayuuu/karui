import { build, version as esbuildVersion } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { containedFile } from '../content.js';
import { artifactSchema, manifestSchema, pluginAssetPath, type PluginArtifact } from './contracts.js';

/** Versioned executable assets. Never scans/compiles plugins during server startup. */
export class PluginCompiler {
  private memory = new Map<string, PluginArtifact>();
  private pending = new Map<string, Promise<PluginArtifact>>();
  constructor(private readonly directory: string) {}

  async manifest(pluginDir: string) {
    const path = await containedFile(pluginDir, 'plugin.json');
    if (!path) throw new Error('Plugin requires plugin.json with a version');
    const source = await readFile(path, 'utf8');
    if (source.length > 4096) throw new Error('Plugin manifest exceeds limit');
    return manifestSchema.parse(JSON.parse(source));
  }

  async get(pluginDir: string, pinnedKey?: string): Promise<PluginArtifact> {
    pluginDir = await realpath(pluginDir);
    if (pinnedKey) {
      if (!/^[a-f0-9]{64}$/.test(pinnedKey)) throw new Error('Invalid plugin version key');
      const artifact = await this.cached(pluginDir, pinnedKey);
      if (!artifact) throw new Error('Compiled plugin version is unavailable');
      return artifact;
    }
    const manifest = await this.manifest(pluginDir);
    const key = createHash('sha256').update(JSON.stringify([2, esbuildVersion, process.versions.node.split('.')[0], pluginDir, manifest.version])).digest('hex');
    const saved = await this.cached(pluginDir, key);
    if (saved) return saved;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.compile(pluginDir, key, manifest);
    this.pending.set(key, task);
    try { return await task; } finally { this.pending.delete(key); }
  }

  private remember(artifact: PluginArtifact) {
    this.memory.delete(artifact.key); this.memory.set(artifact.key, artifact);
    if (this.memory.size > 32) this.memory.delete(this.memory.keys().next().value!);
    return artifact;
  }

  private async cached(pluginDir: string, key: string) {
    const memory = this.memory.get(key);
    if (memory?.pluginDir === pluginDir) return this.remember(memory);
    try {
      const artifact = artifactSchema.parse(JSON.parse(await readFile(join(this.directory, key + '.json'), 'utf8')));
      const publicDirectory = await containedFile(join(this.directory, 'public'), artifact.assetDirectory);
      if (artifact.key === key && artifact.pluginDir === pluginDir && publicDirectory) return this.remember(artifact);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Missing/corrupted artifacts can be rebuilt from the explicitly selected version.
    }
    return undefined;
  }

  private async compile(pluginDir: string, key: string, manifest: { version: string; concurrent: boolean; admin: boolean }) {
    const entry = await containedFile(pluginDir, 'index.ts') ?? await containedFile(pluginDir, 'index.js');
    if (!entry) throw new Error('Plugin entrypoint is missing');
    const compiled = await build({ entryPoints: [entry], bundle: true, packages: 'external', write: false, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'silent' });
    const published = await this.collectAssets(pluginDir, key);
    try {
      const artifact: PluginArtifact = { format: 2, key, pluginDir, entry, ...manifest, code: compiled.outputFiles[0]!.text, templates: {}, ...published };
      for (const file of ['client.ts', 'client.js'] as const) {
        const path = await containedFile(pluginDir, file);
        if (!path) continue;
        if (Buffer.byteLength(await readFile(path)) > 256_000) throw new Error('Client script exceeds the size limit');
        const client = await build({ entryPoints: [path], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
        artifact.client = { file, code: `addEventListener('message', e => { if(e.data?.type === '__ping') postMessage({type:'__pong'}); });\n${client.outputFiles[0]!.text}` };
        break;
      }
      const styles = await containedFile(pluginDir, 'style.css');
      if (styles) artifact.styles = this.pinStyleAssets(await readFile(styles, 'utf8'), key, artifact.assets);
      if (manifest.admin) {
        for (const file of ['admin.ts', 'admin.js'] as const) {
          const path = await containedFile(pluginDir, file);
          if (!path) continue;
          if (Buffer.byteLength(await readFile(path)) > 256_000) throw new Error('Admin client script exceeds the size limit');
          const client = await build({ entryPoints: [path], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent' });
          artifact.adminClient = { file, code: `addEventListener('message', e => { if(e.data?.type === '__ping') postMessage({type:'__pong'}); });\n${client.outputFiles[0]!.text}` };
          break;
        }
        const path = await containedFile(pluginDir, 'admin.css');
        if (path) artifact.adminStyles = this.pinStyleAssets(await readFile(path, 'utf8'), key, artifact.assets);
      }
      const visit = async (directory: string, prefix = '') => {
        for (const file of await readdir(directory, { withFileTypes: true })) {
          if (file.name.startsWith('.') || file.name === 'node_modules' || (!prefix && file.name === 'assets') || file.isSymbolicLink()) continue;
          const relative = prefix + file.name;
          if (file.isDirectory()) await visit(join(directory, file.name), relative + '/');
          else if (file.isFile() && /^[a-zA-Z0-9_/-]+\.edge$/.test(relative)) artifact.templates[relative.slice(0, -5)] = await readFile(join(directory, file.name), 'utf8');
        }
      };
      await visit(pluginDir);
      const output = JSON.stringify(artifact);
      if (Buffer.byteLength(output) > 8_000_000) throw new Error('Compiled plugin exceeds 8 MB limit');
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = join(this.directory, key + '.' + randomUUID() + '.tmp');
      try { await writeFile(temporary, output, { mode: 0o600, flag: 'wx' }); await rename(temporary, join(this.directory, key + '.json')); }
      finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return this.remember(artifact);
    } catch (error) {
      await rm(join(this.directory, 'public', published.assetDirectory), { recursive: true, force: true });
      throw error;
    }
  }

  /** Resolve only files captured in the compiled asset manifest. */
  async publicAsset(artifact: PluginArtifact, path: string) {
    const metadata = artifact.assets.find(asset => asset.path === path);
    if (!metadata) return null;
    const root = await containedFile(join(this.directory, 'public'), artifact.assetDirectory);
    if (!root) return null;
    const file = await containedFile(root, path);
    return file ? { root, file, metadata } : null;
  }

  private pinStyleAssets(source: string, key: string, assets: PluginArtifact['assets']) {
    const available = new Set(assets.map(asset => asset.path));
    return source.replace(/url\(\s*(['"]?)(?:\.\/)?assets\/([a-zA-Z0-9][a-zA-Z0-9._/-]*)([?#][^'"()\s]*)?\1\s*\)/g, (_match, quote: string, path: string, suffix = '') => {
      if (!available.has(path)) throw new Error(`Stylesheet references a missing plugin asset: ${path}`);
      return `url(${quote}./assets/${key}/${path}${suffix}${quote})`;
    });
  }

  private async collectAssets(pluginDir: string, key: string): Promise<Pick<PluginArtifact, 'assetDirectory' | 'assets'>> {
    const assetDirectory = `${key}-${randomUUID()}`;
    const publicRoot = join(this.directory, 'public');
    const temporary = join(publicRoot, '.' + assetDirectory + '.tmp');
    const destination = join(publicRoot, assetDirectory);
    const assets: PluginArtifact['assets'] = [];
    let totalSize = 0;
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    try {
      const source = await containedFile(pluginDir, 'assets');
      const visit = async (directory: string, prefix = ''): Promise<void> => {
        const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
          const relative = prefix + entry.name;
          if (!pluginAssetPath.safeParse(relative).success) throw new Error(`Invalid plugin asset path: ${relative}`);
          if (entry.isDirectory()) {
            await mkdir(join(temporary, relative), { mode: 0o700 });
            await visit(join(directory, entry.name), relative + '/');
            continue;
          }
          if (!entry.isFile()) throw new Error(`Unsupported plugin asset: ${relative}`);
          if (assets.length >= 512) throw new Error('Plugin assets exceed the 512 file limit');
          const data = await readFile(join(directory, entry.name));
          if (data.byteLength > 32 * 1024 * 1024) throw new Error(`Plugin asset exceeds 32 MB: ${relative}`);
          totalSize += data.byteLength;
          if (totalSize > 128 * 1024 * 1024) throw new Error('Plugin assets exceed the 128 MB total limit');
          await writeFile(join(temporary, relative), data, { mode: 0o600, flag: 'wx' });
          assets.push({ path: relative, size: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') });
        }
      };
      if (source) await visit(source);
      await rename(temporary, destination);
      return { assetDirectory, assets };
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
}
