import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { Edge } from 'edge.js';
import type { PluginArtifact, PluginContext } from './plugins/contracts.js';

// Preload Edge once. Plugin code/dependencies load only on the first job.
let artifact: PluginArtifact | undefined;
let handler: ((context: PluginContext) => Promise<any>) | undefined;
let edge: Edge | undefined;
let busy = false;
parentPort!.on('message', async (message: { type: string; id: string; artifact?: PluginArtifact; context: PluginContext }) => {
  if (message.type !== 'run' || busy) throw new Error('Invalid plugin worker request');
  busy = true;
  try {
    if (!artifact) {
      artifact = message.artifact;
      if (!artifact) throw new Error('Missing compiled plugin');
      const module = { exports: {} as { default: typeof handler } };
      new Function('require', 'module', 'exports', artifact.code)(createRequire(artifact.entry), module, module.exports);
      handler = module.exports.default;
      if (typeof handler !== 'function') throw new Error('Plugin must export a default handler');
      edge = Edge.create({ cache: true });
      for (const [name, template] of Object.entries(artifact.templates)) edge.registerTemplate(name, { template });
    }
    const result = await handler!(message.context);
    let value;
    if (result.type === 'view') {
      if (typeof result.template !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.edge$/.test(result.template) || !Object.hasOwn(artifact.templates, result.template.slice(0, -5))) throw new Error('Invalid plugin template');
      // pluginAssets is reserved engine data and cannot be replaced by handler output.
      const html = await edge!.render(result.template.slice(0, -5), { ...(result.data ?? {}), pluginAssets: message.context.assets });
      if (Buffer.byteLength(html) > 2_000_000) throw new Error('Plugin output exceeds limit');
      value = { type: 'view', html, status: result.status ?? 200, client: result.client, styles: result.styles };
    } else {
      if (Buffer.byteLength(JSON.stringify(result)) > 4_000_000) throw new Error('Plugin output exceeds limit');
      value = result;
    }
    parentPort!.postMessage({ type: 'result', id: message.id, ok: true, value });
  } catch (error) {
    parentPort!.postMessage({ type: 'result', id: message.id, ok: false, error: String(error) });
  } finally { busy = false; }
});
parentPort!.postMessage({ type: 'ready' });
