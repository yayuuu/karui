import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { PluginRunner, type PluginContext, type PluginResult } from '../src/plugins.js';
import { PluginCompiler } from '../src/plugins/compiler.js';
import { configFromEnv } from '../src/config.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }, concurrent = true) {
  const root = await mkdtemp(join(tmpdir(), 'karui-pool-'));
  const pluginDir = join(root, 'plugin'), cacheDir = join(root, 'cache');
  await mkdir(pluginDir);
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(pluginDir, 'plugin.json'), JSON.stringify({ version: '1', concurrent }));
  await writeFile(join(pluginDir, 'index.ts'), `import { threadId, resourceLimits } from 'node:worker_threads';
    let calls = 0;
    export default async context => {
      const call = ++calls, body = context.body ?? {};
      if (body.crash) process.exit(0);
      if (body.hang) while(true) {}
      if (body.fail) throw new Error('intentional');
      if (body.delay) await new Promise(resolve => setTimeout(resolve, body.delay));
      return {type:'json', data:{threadId, call, echo:body.echo, resourceLimits}};
    }`);
  const context: PluginContext = { url: '/test', method: 'GET', body: null, suffix: '', basePath: '/test', mode: 'public', admin: null, assets: {}, language: 'en', defaultLanguage: 'en', content: { source: '', html: '', format: 'markdown' }, page: { href: '/test', title: 'Test', html: '', keywords: '', order: 0, gallery: [] }, pluginDir, contentRoot: root, storageDir: root, cacheDir: join(root, 'plugin-data', 'test') };
  return { root, pluginDir, cacheDir, context };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 300; i++) { if (check()) return; await delay(10); }
  assert.ok(check(), 'Condition did not become true');
}

function details(result: PluginResult) {
  assert.equal(result.type, 'json');
  assert.ok(result.type === 'json' && result.data && typeof result.data === 'object');
  const data = result.data as { threadId: number; call: number };
  assert.equal(typeof data.threadId, 'number'); assert.equal(typeof data.call, 'number');
  return data;
}

test('worker memory environment validates defaults, overrides and unsafe input', () => {
  assert.deepEqual(configFromEnv({}).pluginMemoryLimits, { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 });
  assert.deepEqual(configFromEnv({ PLUGIN_WORKER_OLD_GENERATION_MB: '128', PLUGIN_WORKER_YOUNG_GENERATION_MB: '32', PLUGIN_WORKER_STACK_MB: '8' }).pluginMemoryLimits,
    { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 8 });
  for (const [name, min, max] of [['PLUGIN_WORKER_OLD_GENERATION_MB', 16, 4096], ['PLUGIN_WORKER_YOUNG_GENERATION_MB', 4, 1024], ['PLUGIN_WORKER_STACK_MB', 1, 64]] as const) {
    for (const value of ['', 'NaN', 'Infinity', '-1', '0', '1.5', String(min - 1), String(max + 1)]) {
      assert.throws(() => configFromEnv({ [name]: value }), /PLUGIN_WORKER_/, `${name}=${value}`);
    }
    assert.doesNotThrow(() => configFromEnv({ [name]: String(min) }));
    assert.doesNotThrow(() => configFromEnv({ [name]: String(max) }));
  }
  assert.throws(() => new PluginRunner({ memoryLimits: { stackSizeMb: 0 } }));
});

test('configured V8 limits reach permanent, overflow and replacement workers', async t => {
  const f = await fixture(t);
  const memoryLimits = configFromEnv({ PLUGIN_WORKER_OLD_GENERATION_MB: '96', PLUGIN_WORKER_YOUNG_GENERATION_MB: '24', PLUGIN_WORKER_STACK_MB: '6' }).pluginMemoryLimits;
  const runner = new PluginRunner({ cacheDir: f.cacheDir, workers: 1, maxWorkers: 2, memoryLimits });
  t.after(() => runner.close());
  const check = (result: PluginResult) => {
    assert.equal(result.type, 'json');
    const actual = (result as { data: { resourceLimits: Record<string, number> } }).data.resourceLimits;
    for (const [key, value] of Object.entries(memoryLimits)) assert.equal(actual[key], value, key);
  };
  const results = await Promise.all([1, 2].map(() => runner.run({ ...f.context, body: { delay: 150 } })));
  assert.equal(new Set(results.map(result => details(result).threadId)).size, 2);
  results.forEach(check);
  await assert.rejects(runner.run({ ...f.context, body: { fail: true } }));
  const replacements = await Promise.all([1, 2].map(() => runner.run({ ...f.context, body: { delay: 150 } })));
  replacements.forEach(check);
  assert.ok(replacements.some(result => !results.some(old => details(old).threadId === details(result).threadId)));
});

test('default pool prewarms eight threads without compiling external plugins', async t => {
  const f = await fixture(t);
  const config = configFromEnv({});
  assert.equal(config.pluginWorkers, 8); assert.equal(config.pluginWorkerIdleMs, 10000);
  assert.throws(() => configFromEnv({ PLUGIN_WORKERS: '8', PLUGIN_MAX_WORKERS: '7' }));
  const runner = new PluginRunner({ cacheDir: f.cacheDir });
  t.after(() => runner.close());
  await writeFile(join(f.pluginDir, 'index.ts'), 'this is not valid typescript');
  await runner.start();
  assert.equal(runner.pool.stats().permanent, 8); assert.equal(runner.pool.stats().ready, 8);
  await assert.rejects(readdir(f.cacheDir), { code: 'ENOENT' });
});

test('only a version bump or missing artifact recompiles; disk cache survives restart and pins assets', async t => {
  const f = await fixture(t);
  await writeFile(join(f.pluginDir, 'client.ts'), 'postMessage("old")');
  await writeFile(join(f.pluginDir, 'view.edge'), '<p>old</p>');
  await writeFile(join(f.pluginDir, 'style.css'), '.old {}');
  const compiler = new PluginCompiler(f.cacheDir);
  const builds = await Promise.all(Array.from({ length: 8 }, () => compiler.get(f.pluginDir)));
  assert.equal(new Set(builds.map(value => value)).size, 1);
  const old = builds[0]!;
  assert.deepEqual((await readdir(f.cacheDir)).sort(), [old.key + '.json', 'public']);
  await writeFile(join(f.pluginDir, 'index.ts'), 'invalid typescript @');
  await writeFile(join(f.pluginDir, 'client.ts'), 'postMessage("new")');
  assert.equal((await compiler.get(f.pluginDir)).code, old.code);
  assert.deepEqual(await new PluginCompiler(f.cacheDir).get(f.pluginDir), old);
  await writeFile(join(f.pluginDir, 'plugin.json'), '{"version":"2","concurrent":true}');
  await assert.rejects(compiler.get(f.pluginDir));
  assert.equal((await compiler.get(f.pluginDir, old.key)).client!.code, old.client!.code);
  await writeFile(join(f.pluginDir, 'index.ts'), 'export default () => ({type:"view",template:"view.edge"})');
  await writeFile(join(f.pluginDir, 'view.edge'), '<p>new</p>');
  const updated = await compiler.get(f.pluginDir);
  assert.notEqual(updated.key, old.key); assert.equal(updated.templates.view, '<p>new</p>');
  assert.match(updated.client!.code, /new/);
  await rm(join(f.cacheDir, updated.key + '.json'));
  await writeFile(join(f.pluginDir, 'view.edge'), '<p>rebuilt missing cache</p>');
  assert.equal((await new PluginCompiler(f.cacheDir).get(f.pluginDir)).templates.view, '<p>rebuilt missing cache</p>');
  await assert.rejects(compiler.get(f.pluginDir, 'not-a-key'));
});

test('concurrent traffic expands to the cap, reuses workers, renews ephemeral TTL and returns to baseline', async t => {
  const f = await fixture(t);
  const runner = new PluginRunner({ cacheDir: f.cacheDir, workers: 2, maxWorkers: 3, idleMs: 750 });
  t.after(() => runner.close());
  await runner.start();
  const batch = () => Promise.all(Array.from({ length: 3 }, (_, echo) => runner.run({ ...f.context, body: { echo, delay: 100 } })));
  const first = await batch();
  assert.equal(new Set(first.map(result => details(result).threadId)).size, 3);
  assert.equal(runner.pool.stats().ephemeral, 1);
  await delay(450);
  const second = await batch();
  assert.equal(new Set(second.map(result => details(result).threadId)).size, 3);
  assert.ok(second.every(result => details(result).call > 1));
  await delay(400); assert.equal(runner.pool.stats().ephemeral, 1, 'A reused overflow worker gets a fresh idle deadline');
  await until(() => runner.pool.stats().total === 2);
  const load = Promise.all(Array.from({ length: 8 }, () => runner.run({ ...f.context, body: { delay: 200 } })));
  await until(() => runner.pool.stats().queued > 0);
  assert.equal(runner.pool.stats().total, 3);
  await load;
});

test('serial plugins preserve file updates while parallel plugins use other threads', async t => {
  const f = await fixture(t, false);
  await writeFile(join(f.root, 'counter'), '0');
  await writeFile(join(f.pluginDir, 'index.ts'), `import {readFile,writeFile} from 'node:fs/promises'; import {join} from 'node:path';
    export default async context => { const path=join(context.storageDir,'counter'); const count=Number(await readFile(path,'utf8'));
      await new Promise(resolve=>setTimeout(resolve,20)); await writeFile(path,String(count+1)); return {type:'json',data:count+1}; }`);
  const runner = new PluginRunner({ cacheDir: f.cacheDir, workers: 2, maxWorkers: 4 });
  t.after(() => runner.close());
  const results = await Promise.all(Array.from({ length: 12 }, () => runner.run(f.context)));
  // Compilation/cache lookup precedes the pool, so caller order is not queue order.
  // Every update must still be applied exactly once, without lost increments.
  assert.deepEqual(results.map(result => {
    assert.equal(result.type, 'json');
    return result.type === 'json' ? Number(result.data) : NaN;
  }).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(await readFile(join(f.root, 'counter'), 'utf8'), '12');
  assert.equal(runner.pool.stats().total, 2);
});

test('timeouts, exits and exceptions retire only the affected thread; version updates reset globals', async t => {
  const f = await fixture(t);
  const runner = new PluginRunner({ cacheDir: f.cacheDir, workers: 2, maxWorkers: 3, timeoutMs: 200 });
  t.after(() => runner.close());
  await runner.start();
  const first = await runner.run(f.context), second = await runner.run(f.context);
  assert.equal(first.type, 'json'); assert.equal(second.type, 'json');
  if (first.type !== 'json' || second.type !== 'json') return;
  assert.equal(details(first).threadId, details(second).threadId); assert.equal(details(second).call, 2);
  for (const body of [{ fail: true }, { hang: true }, { crash: true }]) {
    const broken = assert.rejects(runner.run({ ...f.context, body }));
    const good = await runner.run({ ...f.context, body: { echo: 'alive' } });
    assert.equal(good.type, 'json'); await broken;
    await until(() => runner.pool.stats().permanent === 2 && runner.pool.stats().ready >= 2);
  }
  await writeFile(join(f.pluginDir, 'plugin.json'), '{"version":"2","concurrent":true}');
  const changed = await runner.run(f.context);
  assert.equal(details(changed).call, 1);
});

test('shutdown settles both queued and running requests and does not respawn workers', async t => {
  const f = await fixture(t, false);
  const runner = new PluginRunner({ cacheDir: f.cacheDir, workers: 1, maxWorkers: 1 });
  t.after(() => runner.close());
  await runner.start(); await runner.compiler.get(f.pluginDir);
  const pending = Promise.allSettled(Array.from({ length: 3 }, () => runner.run({ ...f.context, body: { delay: 2000 } })));
  await until(() => runner.pool.stats().queued === 2);
  await runner.close();
  assert.ok((await pending).every(result => result.status === 'rejected'));
  assert.equal(runner.pool.stats().total, 0);
  await assert.rejects(runner.run(f.context), /closed/);
});
