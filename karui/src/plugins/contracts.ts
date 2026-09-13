import { z } from 'zod';
import type { Page } from '../content.js';

export const resultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('view'), html: z.string().max(2_000_000), status: z.number().int().min(200).max(599).default(200), client: z.enum(['client.ts', 'client.js', 'admin.ts', 'admin.js']).optional(), styles: z.enum(['style.css', 'admin.css']).optional() }),
  z.object({ type: z.literal('json'), data: z.unknown(), status: z.number().int().min(200).max(599).default(200) }),
]);
export type PluginResult = z.infer<typeof resultSchema>;
/** Server-only context. Nothing here is automatically sent to the browser. */
export type PluginContext = {
  url: string; method: string; body: unknown; suffix: string; basePath: string;
  /** Language requested for this response and the site's configured default. */
  language: string; defaultLanguage: string;
  page: Page;
  content: { source: string; html: string; format: 'markdown' | 'html' };
  mode: 'public' | 'admin';
  admin: { login: string; role: 'owner' | 'admin'; csrf: string } | null;
  /** Version-pinned public URLs, keyed by paths relative to the plugin's assets directory. */
  assets: Readonly<Record<string, string>>;
  pluginDir: string; contentRoot: string;
  /** Durable, content-mounted state owned by this plugin. */
  storageDir: string;
  /** Re-creatable plugin cache under CONTENT_CACHE_DIR; it may be tmpfs and disappear after restart. */
  cacheDir: string;
};
/** Return a template name, not HTML. The engine renders it inside the worker. */
export type PluginResponse =
  | { type: 'view'; template: string; status?: number; data?: Record<string, unknown>; client?: 'client.ts' | 'client.js' | 'admin.ts' | 'admin.js'; styles?: 'style.css' | 'admin.css' }
  | { type: 'json'; data: unknown; status?: number };
export const manifestSchema = z.object({ version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/), concurrent: z.boolean().default(false), admin: z.boolean().default(false) }).strict();
export const pluginAssetPath = z.string().max(240).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,127})*$/);
export const artifactSchema = z.object({
  format: z.literal(2), key: z.string().regex(/^[a-f0-9]{64}$/), pluginDir: z.string(), entry: z.string(),
  version: z.string(), concurrent: z.boolean(), code: z.string(),
  client: z.object({ file: z.enum(['client.ts', 'client.js']), code: z.string() }).optional(),
  styles: z.string().optional(), templates: z.record(z.string(), z.string()),
  assetDirectory: z.string().regex(/^[a-f0-9]{64}-[a-f0-9-]{36}$/),
  assets: z.array(z.object({ path: pluginAssetPath, size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(512),
  admin: z.boolean().default(false),
  adminClient: z.object({ file: z.enum(['admin.ts', 'admin.js']), code: z.string() }).optional(),
  adminStyles: z.string().optional(),
});
export type PluginArtifact = z.infer<typeof artifactSchema>;
