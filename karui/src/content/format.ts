import MarkdownIt from 'markdown-it';

export const contentFormats = ['markdown', 'html'] as const;
export type ContentFormat = typeof contentFormats[number];
const markdown = new MarkdownIt({ html: true });

/** Keep storage/conversion free of presentation markup; page rendering can opt in. */
export function createContentRenderer(options: Partial<typeof markdown.options> = {}, configure?: (renderer: typeof markdown) => void) {
  const renderer = new MarkdownIt({ html: true, ...options });
  configure?.(renderer);
  return (body: string, format?: ContentFormat): string => format === 'html' ? body : renderer.render(body);
}
export const renderContent = createContentRenderer();

/** Infer an editor preference for legacy files without changing their source. */
export function editingFormat(body: string, format?: ContentFormat): ContentFormat {
  if (format) return format;
  const tokens = markdown.parse(body, {});
  return tokens.length > 0 && tokens.every(token => token.type === 'html_block') ? 'html' : 'markdown';
}
