import { join } from 'node:path';
import type { Page } from '../content.js';
import type { PluginContext } from './contracts.js';

export function createPluginContext(input: {
  url: string; method: string; body?: unknown; suffix: string; page: Page; contentRoot: string;
  language?: string; defaultLanguage?: string; admin?: NonNullable<PluginContext['admin']>; basePath?: string;
}): PluginContext {
  const { page, contentRoot, admin } = input;
  if (!page.plugin) throw new Error('Page has no plugin');
  return {
    url: input.url, method: input.method, body: input.body ?? null, suffix: input.suffix,
    basePath: input.basePath ?? page.href, page,
    language: input.language ?? page.language ?? input.defaultLanguage ?? 'en', defaultLanguage: input.defaultLanguage ?? 'en',
    content: { source: page.source ?? '', html: page.html, format: page.format ?? 'markdown' },
    mode: admin ? 'admin' : 'public', admin: admin ?? null,
    assets: {},
    contentRoot, pluginDir: join(contentRoot, 'plugins', page.plugin), storageDir: join(contentRoot, 'state', page.plugin),
  };
}
