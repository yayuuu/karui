import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { resultSchema, type PluginArtifact, type PluginContext, type PluginResult } from './contracts.js';
import { pluginMemoryLimits, type PluginMemoryLimits } from './memory-limits.js';

export type PoolOptions = { workers: number; maxWorkers: number; idleMs: number; timeoutMs: number; memoryLimits?: Partial<PluginMemoryLimits> };
type Job = { id: string; artifact: PluginArtifact; context: PluginContext; resolve: (value: PluginResult) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };
type Slot = { worker: Worker; permanent: boolean; ready: boolean; closing: boolean; binding?: string; job?: Job; startup?: ReturnType<typeof setTimeout>; idle?: ReturnType<typeof setTimeout>; loaded: boolean; readyPromise: Promise<void>; readyResolve: () => void; readyReject: (error: Error) => void };

/** Threads stay bound to one plugin/version; reassignment replaces the thread. */
export class PluginPool {
  private readonly memoryLimits: PluginMemoryLimits;
  private slots = new Set<Slot>();
  private queue: Job[] = [];
  private active = new Map<string, { count: number; serial: boolean }>();
  private stopping = false;
  private startPromise?: Promise<void>;
  private retiring = new Set<Promise<void>>();
  constructor(private readonly options: PoolOptions) {
    this.memoryLimits = pluginMemoryLimits.parse(options.memoryLimits ?? {});
    if (!Number.isInteger(options.workers) || options.workers < 1 || !Number.isInteger(options.maxWorkers) || options.maxWorkers < options.workers || options.idleMs < 1 || options.timeoutMs < 1) throw new Error('Invalid plugin pool limits');
  }

  start() {
    if (this.stopping) return Promise.reject(new Error('Plugin pool is closed'));
    if (!this.startPromise) {
      for (let i = 0; i < this.options.workers; i++) this.spawn(true);
      this.startPromise = Promise.all([...this.slots].map(slot => slot.readyPromise)).then(() => {}).catch(async error => { await this.close(); throw error; });
    }
    return this.startPromise;
  }

  stats() {
    const slots = [...this.slots].filter(slot => !slot.closing);
    return { total: slots.length, permanent: slots.filter(slot => slot.permanent).length, ephemeral: slots.filter(slot => !slot.permanent).length, busy: slots.filter(slot => slot.job).length, queued: this.queue.length, ready: slots.filter(slot => slot.ready).length };
  }

  async run(artifact: PluginArtifact, context: PluginContext): Promise<PluginResult> {
    await this.start();
    if (this.stopping) throw new Error('Plugin pool is closed');
    if (this.queue.length >= 128 || this.queue.filter(job => job.artifact.pluginDir === artifact.pluginDir).length >= 48) throw new Error('Plugin request queue is full');
    return new Promise((resolve, reject) => {
      const job: Job = { id: randomUUID(), artifact, context, resolve, reject };
      job.timer = setTimeout(() => {
        const index = this.queue.indexOf(job);
        if (index < 0) return;
        this.queue.splice(index, 1); reject(new Error('Plugin queue timed out')); this.pump();
      }, 10000 + this.options.timeoutMs);
      this.queue.push(job); this.pump();
    });
  }

  private spawn(permanent: boolean): Slot {
    const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    const workerUrl = new URL(`../plugin-worker.${extension}`, import.meta.url);
    const workerOptions = { resourceLimits: { ...this.memoryLimits } };
    // Node does not apply a parent's TS loader to a Worker entrypoint. Register tsx
    // inside an eval worker only in source-mode; production always loads the JS file.
    const worker = extension === 'ts'
      ? new Worker(`(async () => { const { register } = await import('tsx/esm/api'); register(); await import(${JSON.stringify(workerUrl.href)}); })().catch(error => { throw error; });`, { ...workerOptions, eval: true })
      : new Worker(workerUrl, workerOptions);
    let readyResolve!: () => void, readyReject!: (error: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    void readyPromise.catch(() => {});
    const slot: Slot = { worker, permanent, ready: false, closing: false, loaded: false, readyPromise, readyResolve, readyReject };
    this.slots.add(slot);
    slot.startup = setTimeout(() => this.retire(slot, new Error('Plugin worker startup timed out')), 10000);
    worker.on('error', error => this.retire(slot, error));
    worker.on('exit', code => { if (!slot.closing) this.retire(slot, new Error(`Plugin worker exited (${code})`)); });
    worker.on('message', (message: { type?: string; id?: string; ok?: boolean; value?: unknown; error?: string }) => {
      if (slot.closing) return;
      if (message?.type === 'ready' && !slot.ready) {
        clearTimeout(slot.startup); slot.ready = true; slot.readyResolve();
        if (slot.job) this.send(slot); else this.armIdle(slot);
        this.pump(); return;
      }
      const job = slot.job;
      if (!job || message?.id !== job.id || message.type !== 'result') { this.retire(slot, new Error('Invalid plugin worker response')); return; }
      try {
        if (!message.ok) throw new Error(message.error ?? 'Plugin failed');
        const result = resultSchema.parse(message.value);
        this.release(slot); job.resolve(result); this.armIdle(slot); this.pump();
      } catch (error) { this.retire(slot, error instanceof Error ? error : new Error(String(error))); }
    });
    return slot;
  }

  private pump() {
    if (this.stopping) return;
    for (;;) {
      const index = this.queue.findIndex((job, index) => {
        if (this.queue.slice(0, index).some(earlier => earlier.artifact.pluginDir === job.artifact.pluginDir)) return false;
        const active = this.active.get(job.artifact.pluginDir);
        return !active || (job.artifact.concurrent && !active.serial);
      });
      if (index < 0) return;
      const job = this.queue[index]!;
      const idle = [...this.slots].filter(slot => !slot.closing && !slot.job);
      let slot = idle.find(slot => slot.binding === job.artifact.key) ?? idle.find(slot => !slot.binding);
      if (!slot && idle.length) { this.retire(idle[0]!); return; }
      if (!slot && this.slots.size < this.options.maxWorkers) slot = this.spawn(false);
      if (!slot) return;
      this.queue.splice(index, 1); clearTimeout(job.timer); clearTimeout(slot.idle);
      slot.job = job; slot.binding = job.artifact.key;
      const active = this.active.get(job.artifact.pluginDir) ?? { count: 0, serial: false };
      active.count++; active.serial ||= !job.artifact.concurrent; this.active.set(job.artifact.pluginDir, active);
      if (slot.ready) this.send(slot);
    }
  }

  private send(slot: Slot) {
    const job = slot.job!;
    job.timer = setTimeout(() => this.retire(slot, new Error('Plugin timed out')), this.options.timeoutMs);
    try {
      slot.worker.postMessage({ type: 'run', id: job.id, context: job.context, ...(slot.loaded ? {} : { artifact: job.artifact }) });
      slot.loaded = true;
    } catch (error) { this.retire(slot, error instanceof Error ? error : new Error(String(error))); }
  }

  private release(slot: Slot) {
    const job = slot.job;
    if (!job) return;
    clearTimeout(job.timer); slot.job = undefined;
    const active = this.active.get(job.artifact.pluginDir)!;
    if (--active.count === 0) this.active.delete(job.artifact.pluginDir);
  }

  private armIdle(slot: Slot) {
    clearTimeout(slot.idle);
    if (!slot.permanent && !slot.job && !slot.closing) slot.idle = setTimeout(() => this.retire(slot), this.options.idleMs);
  }

  private retire(slot: Slot, error = new Error('Plugin worker retired')) {
    if (slot.closing) return;
    slot.closing = true; clearTimeout(slot.startup); clearTimeout(slot.idle); clearTimeout(slot.job?.timer);
    slot.readyReject(error);
    const task = slot.worker.terminate().then(() => {}, () => {}).then(() => {
      // Keep the serial lock until a failed thread has actually terminated.
      const job = slot.job; this.release(slot); job?.reject(error);
      this.slots.delete(slot);
      if (!this.stopping) { if (slot.permanent) this.spawn(true); this.pump(); }
    });
    this.retiring.add(task); void task.finally(() => this.retiring.delete(task));
  }

  async close() {
    this.stopping = true;
    for (const job of this.queue.splice(0)) { clearTimeout(job.timer); job.reject(new Error('Plugin pool is closed')); }
    for (const slot of this.slots) this.retire(slot, new Error('Plugin pool is closed'));
    await Promise.all(this.retiring);
  }
}
