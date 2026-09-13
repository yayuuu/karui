import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Gettext from 'node-gettext';
import { po } from 'gettext-parser';
import { languageCode, type Site } from './content.js';

const domain = 'karui';
export type Translate = (message: string, values?: Record<string, string | number>) => string;

export const clientMessageIds = [
  'Back', 'Back to content', 'Parent page', 'Navigation', 'Site navigation', 'Mobile navigation', 'Language',
  'Open navigation', 'Close navigation', 'Expand: {title}', 'Collapse: {title}', 'Home page',
  'Loading page…', 'The page could not be loaded.', 'Try again', 'Open the full page',
  'Photo {current} of {total}', 'Unsaved changes', 'Changes could not be saved.',
  'Switch language and discard unsaved changes?', 'Wait for the gallery operation to finish. Your content will not be lost.',
  'Wait for saving to finish.', 'Delete this page? A copy of its content will be stored in the private trash.',
  '{count} photos', 'Unsaved order', 'Order saved', 'Delete account {login}?',
  'Delete this menu item and its submenu? The change will be published after saving.',
  'Main page', 'The menu may have at most 9 levels.', 'Every menu item must have a name.',
  'Network error while uploading the photo.', 'The upload timed out. Check the gallery before trying again.',
  'Upload cancelled.', 'The photo could not be uploaded.', 'The maximum photo size is 10 MB.',
  'Remove the photo from this gallery? The file will be retained.', 'Photo description', 'Move photo earlier',
  'Move photo later', 'Save description', 'Delete', 'Insert into content', 'Photo files', 'Photo descriptions',
  'Up to 10 MB and 25 megapixels per photo. Uploads run in the background, so you can keep editing.',
  'Uploading…', 'Add photo', 'Uploading {file}', 'Done', 'Creating thumbnails…', 'Queued', 'Retry',
  'Copy gallery from another language', 'Copy gallery from', 'Copy gallery',
  'Copying replaces this language version’s gallery. The image files are shared, not duplicated.',
  'Submenu', 'Drag menu item', 'Menu item name', 'Target page', 'Custom external link', 'External address',
  'Open link', 'In the same tab', 'In a new tab', 'Add submenu item', 'Delete menu item',
  'Link address (https://… or /subpage)', 'Image address (/media/… or https://…)', 'Undo', 'Redo', 'Bold',
  'Italic', 'Underline', 'Strikethrough', 'Bulleted list', 'Numbered list', 'Quote', 'Horizontal rule',
  'Insert link', 'Insert image from address', 'Insert table', 'Add table row', 'Add table column', 'Delete table',
  'Paragraph style', 'Paragraph', 'Heading 1', 'Heading 2', 'Heading 3', 'Alignment', 'Left', 'Center', 'Right', 'Source',
  'Justify', 'Font size', 'Text color', 'Page content — visual editor', 'HTML block — preserved unchanged. Edit in source mode.',
  'HTML fragment — edit in source',
  'This part of the page could not be started. Refresh the page to try again.',
  'This part of the page encountered an error. The rest of the site is still available.',
  'The script response could not be read.', 'A script sending too many messages was stopped.',
  'A script returning invalid data was stopped.', 'The script stopped responding and was terminated. Navigation is still available.',
  'This browser does not support this part of the page.', 'Invalid plugin configuration.',
  'Download gallery diagnostics',
] as const;

export function clientMessages(t: Translate) {
  return Object.fromEntries(clientMessageIds.map(message => [message, t(message)]));
}

function interpolate(message: string, values?: Record<string, string | number>) {
  if (!values) return message;
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key]));
}

export class Translations {
  private constructor(private readonly catalogs: Map<string, Gettext>) {}

  static async load(directory: string) {
    const catalogs = new Map<string, Gettext>();
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const match = /^([a-z]{2,3}(?:-[a-z0-9]{2,8})*)\.po$/.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      const locale = languageCode.parse(match[1]);
      const gettext = new Gettext({ sourceLocale: 'en' });
      gettext.addTranslations(locale, domain, po.parse(await readFile(join(directory, entry.name))));
      gettext.setLocale(locale);
      gettext.setTextDomain(domain);
      catalogs.set(locale, gettext);
    }
    return new Translations(catalogs);
  }

  translator(language: string): Translate {
    const locale = language.toLowerCase();
    const gettext = this.catalogs.get(locale) ?? this.catalogs.get(locale.split('-')[0]!);
    return (message, values) => interpolate(gettext?.gettext(message) ?? message, values);
  }
}

function supportedLanguage(value: string | undefined, supported: string[]) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!languageCode.safeParse(normalized).success) return undefined;
  return supported.find(language => language === normalized)
    ?? supported.find(language => language.split('-')[0] === normalized.split('-')[0]);
}

function cookieValue(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function requestLanguage(site: Site, query: string | null, cookie: string | undefined, acceptLanguage?: string) {
  const supported = site.languages;
  const explicit = supportedLanguage(query ?? undefined, supported);
  if (explicit) return { language: explicit, explicit: true };
  const saved = supportedLanguage(cookieValue(cookie, 'karui-language'), supported);
  if (saved) return { language: saved, explicit: false };
  const accepted = (acceptLanguage ?? '').split(',')
    .map(part => {
      const [code, ...parameters] = part.trim().split(';');
      const quality = Number(parameters.find(value => value.trim().startsWith('q='))?.split('=')[1] ?? 1);
      return { code, quality: Number.isFinite(quality) ? quality : 0 };
    })
    .sort((a, b) => b.quality - a.quality);
  for (const candidate of accepted) {
    const language = supportedLanguage(candidate.code, supported);
    if (language) return { language, explicit: false };
  }
  return { language: site.language, explicit: false };
}

export function languageLinks(requestUrl: string, languages: string[], current: string) {
  const url = new URL(requestUrl, 'http://karui.local');
  return languages.map(code => {
    url.searchParams.set('lang', code);
    return { code, current: code === current, href: url.pathname + url.search };
  });
}
