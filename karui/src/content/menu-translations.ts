import { po } from 'gettext-parser';
import type { MenuItem } from '../content.js';

const context = 'karui-menu';

export function menuMessageIds(items: MenuItem[]): string[] {
  const messages = new Set<string>();
  const visit = (entries: MenuItem[]) => {
    for (const item of entries) {
      messages.add(item.title);
      visit(item.children);
    }
  };
  visit(items);
  return [...messages];
}

export function parseMenuTranslations(source: string | Buffer): Map<string, string> {
  if (!source.length) return new Map();
  const catalog = po.parse(source);
  const translations = catalog.translations[context] ?? {};
  return new Map(Object.values(translations)
    .filter(message => message.msgid && message.msgstr[0])
    .map(message => [message.msgid, message.msgstr[0]!]));
}

export function updateMenuCatalog(source: string | Buffer, language: string, values: Map<string, string>): Buffer {
  const catalog = source.length ? po.parse(source) : {
    charset: 'utf-8',
    headers: {
      'Project-Id-Version': 'Karui content',
      'Content-Type': 'text/plain; charset=UTF-8',
      'Content-Transfer-Encoding': '8bit',
    },
    translations: {},
  };
  catalog.charset = 'utf-8';
  catalog.headers.Language = language;
  catalog.translations[context] = Object.fromEntries([...values].map(([msgid, translation]) => [msgid, {
    msgctxt: context,
    msgid,
    msgstr: [translation],
  }]));
  return po.compile(catalog);
}

export function translateMenu(items: MenuItem[], translations: Map<string, string> | undefined): MenuItem[] {
  if (!translations?.size) return items;
  return items.map(item => ({
    ...item,
    title: translations.get(item.title) || item.title,
    children: translateMenu(item.children, translations),
  }));
}
