import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PluginCompiler } from './plugins/compiler.js';
import { PluginPool, type PoolOptions } from './plugins/pool.js';
import type { PluginContext } from './plugins/contracts.js';
export type { PluginContext, PluginResult, PluginResponse } from './plugins/contracts.js';

export class PluginRunner {
  private pending = 0;
  readonly compiler: PluginCompiler;
  readonly pool: PluginPool;
  constructor(options: Partial<PoolOptions> & { cacheDir?: string } = {}) {
    this.compiler = new PluginCompiler(options.cacheDir ?? join(tmpdir(), 'karui-cache/plugins'));
    this.pool = new PluginPool({ workers: 8, maxWorkers: 16, idleMs: 10000, timeoutMs: 5000, ...options });
  }
  start() { return this.pool.start(); }
  async run(context: PluginContext) {
    if (this.pending >= 128) throw new Error('Plugin request queue is full');
    this.pending++;
    try {
      const artifact = await this.compiler.get(context.pluginDir);
      if (context.mode === 'admin' && !artifact.admin) throw new Error('Plugin has no administrative view');
      const route = context.mode === 'admin' ? '/panel/plugin-assets' : '/plugin-assets';
      const name = context.page.plugin ?? basename(context.pluginDir);
      if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Plugin context has no valid plugin name');
      const assets = Object.fromEntries(artifact.assets.map(asset => [asset.path, `${route}/${name}/assets/${artifact.key}/${asset.path}`]));
      const result = await this.pool.run(artifact, { ...context, assets });
      if (context.mode !== 'admin' && result.type === 'view' && (result.client?.startsWith('admin.') || result.styles === 'admin.css')) throw new Error('Administrative assets cannot be used in public views');
      return { ...result, versionKey: artifact.key };
    } finally { this.pending--; }
  }
  close() { return this.pool.close(); }
}
