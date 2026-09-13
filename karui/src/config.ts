import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { pluginMemoryLimits } from './plugins/memory-limits.js';

const environment = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  CONTENT_DIR: z.string().default('./content'),
  CONTENT_CACHE_DIR: z.string().default(resolve(tmpdir(), 'karui-cache')),
  CONTENT_REFRESH_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  PLUGIN_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  PLUGIN_WORKERS: z.coerce.number().int().min(1).max(64).default(8),
  PLUGIN_MAX_WORKERS: z.coerce.number().int().min(1).max(128).optional(),
  PLUGIN_WORKER_IDLE_MS: z.coerce.number().int().min(100).max(300000).default(10000),
  PLUGIN_WORKER_OLD_GENERATION_MB: pluginMemoryLimits.shape.maxOldGenerationSizeMb,
  PLUGIN_WORKER_YOUNG_GENERATION_MB: pluginMemoryLimits.shape.maxYoungGenerationSizeMb,
  PLUGIN_WORKER_STACK_MB: pluginMemoryLimits.shape.stackSizeMb,
  NODE_ENV: z.string().default('development'),
  PANEL_SECURE_COOKIE: z.enum(['true', 'false']).optional(),
  PANEL_ORIGIN: z.string().url().optional(),
}).refine(value => value.PLUGIN_MAX_WORKERS === undefined || value.PLUGIN_MAX_WORKERS >= value.PLUGIN_WORKERS, { message: 'PLUGIN_MAX_WORKERS must be at least PLUGIN_WORKERS' });
export function configFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const value = environment.parse(env);
  return {
    port: value.PORT,
    host: value.HOST,
    contentDir: resolve(value.CONTENT_DIR),
    contentCacheDir: resolve(value.CONTENT_CACHE_DIR),
    contentRefreshMs: value.CONTENT_REFRESH_MS,
    pluginTimeoutMs: value.PLUGIN_TIMEOUT_MS,
    pluginWorkers: value.PLUGIN_WORKERS,
    pluginMaxWorkers: value.PLUGIN_MAX_WORKERS ?? Math.max(16, value.PLUGIN_WORKERS),
    pluginWorkerIdleMs: value.PLUGIN_WORKER_IDLE_MS,
    pluginMemoryLimits: {
      maxOldGenerationSizeMb: value.PLUGIN_WORKER_OLD_GENERATION_MB,
      maxYoungGenerationSizeMb: value.PLUGIN_WORKER_YOUNG_GENERATION_MB,
      stackSizeMb: value.PLUGIN_WORKER_STACK_MB,
    },
    production: value.NODE_ENV === 'production',
    panelSecureCookie: value.PANEL_SECURE_COOKIE ? value.PANEL_SECURE_COOKIE === 'true' : value.NODE_ENV === 'production',
    panelOrigin: value.PANEL_ORIGIN,
  };
}
export type Config = ReturnType<typeof configFromEnv>;
