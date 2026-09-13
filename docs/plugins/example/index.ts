import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PluginContext, PluginResponse } from '../../../karui/src/plugins/contracts.js';

type Settings = { notice: string; count: number };
const defaults: Settings = { notice: 'Treść zastąpiona przez wtyczkę!', count: 0 };
const escape = (text: string) => text.replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

async function readSettings(directory: string): Promise<Settings> {
  try {
    const value = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'));
    if (typeof value.notice !== 'string' || value.notice.length > 200 || !Number.isSafeInteger(value.count) || value.count < 0) throw new Error('Invalid settings');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults };
    throw error; // Do not overwrite a corrupt file with defaults.
  }
}

async function saveSettings(directory: string, value: Settings) {
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(directory, 'settings.json'));
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export default async function render(context: PluginContext): Promise<PluginResponse> {
  const settings = await readSettings(context.storageDir);
  if (context.mode === 'admin' && context.admin) {
    const endpoint = context.basePath + '?path=' + encodeURIComponent(context.page.href);
    let saved = false;
    if (context.method === 'POST') {
      if (context.suffix === '/increment') {
        if (settings.count >= Number.MAX_SAFE_INTEGER) return { type: 'json', status: 409, data: { error: 'Limit licznika' } };
        settings.count++;
        await saveSettings(context.storageDir, settings);
        return { type: 'json', data: { count: settings.count } };
      }
      if (context.suffix) return { type: 'json', status: 404, data: { error: 'Nieznana akcja' } };
      const body = context.body as { notice?: unknown } | null;
      if (typeof body?.notice !== 'string' || body.notice.length > 200) return { type: 'json', status: 400, data: { error: 'Wiadomość: maksymalnie 200 znaków' } };
      settings.notice = body.notice;
      await saveSettings(context.storageDir, settings); saved = true;
    } else if (!['GET', 'HEAD'].includes(context.method) || context.suffix) {
      return { type: 'json', status: 404, data: { error: 'Nieznana akcja' } };
    }
    return {
      type: 'view', template: 'views/admin.edge', client: 'admin.ts', styles: 'admin.css',
      data: { settings, saved, action: endpoint, csrf: context.admin.csrf,
        clientContext: { endpoint: context.basePath + '/increment?path=' + encodeURIComponent(context.page.href), csrf: context.admin.csrf } },
    };
  }
  if (!['GET', 'HEAD'].includes(context.method)) return { type: 'json', status: 405, data: { error: 'Tylko odczyt' } };
  if (context.suffix === '/api/status') return { type: 'json', data: { mode: context.mode, count: settings.count } };
  if (context.suffix) return { type: 'json', status: 404, data: { error: 'Nieznana trasa' } };
  return {
    type: 'view', template: 'views/public.edge', client: 'client.ts', styles: 'style.css',
    data: { html: context.content.html.replaceAll('[[notice]]', escape(settings.notice)),
      useContent: context.page.pluginPlacement === 'content', count: settings.count,
      clientContext: { label: 'Kliknięcia w bieżącym widoku' } },
  };
}
