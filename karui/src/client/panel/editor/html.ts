import { Node, type Editor } from '@tiptap/core';
import MarkdownIt from 'markdown-it';
import type { ContentFormat } from '../../../content/format.js';
import { t } from '../../i18n.js';

const markdown = new MarkdownIt({ html: true });
const blockAttribute = 'data-preserved-html';
const inlineAttribute = 'data-preserved-inline-html';
const placeholder = (html: string, inline = false) => {
  const tag = inline ? 'span' : 'div';
  return `<${tag} ${inline ? inlineAttribute : blockAttribute}="${markdown.utils.escapeHtml(html)}"></${tag}>`;
};
// Protect raw HTML before a DOM parser can normalize it or lose attributes.
markdown.renderer.rules.html_block = (tokens, index) => placeholder(tokens[index]!.content);
markdown.core.ruler.after('inline', 'preserve_inline_html', state => {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.children?.some(child => child.type === 'html_inline')) continue;
    const protectedToken = new state.Token('html_inline', '', 0);
    protectedToken.content = placeholder(token.content, true);
    token.children = [protectedToken];
  }
});

export const PreservedHtml = Node.create({
  name: 'preservedHtml', group: 'block', atom: true,
  addAttributes: () => ({ html: { default: '', parseHTML: element => element.getAttribute(blockAttribute) } }),
  parseHTML: () => [{ tag: `div[${blockAttribute}]` }],
  renderHTML: ({ node }) => ['div', { [blockAttribute]: node.attrs.html }, `◇ ${t('HTML block — preserved unchanged. Edit in source mode.')}`],
  renderMarkdown: node => node.attrs?.html ?? '',
});
export const PreservedInlineHtml = PreservedHtml.extend({
  name: 'preservedInlineHtml', group: 'inline', inline: true,
  addAttributes: () => ({ html: { default: '', parseHTML: element => element.getAttribute(inlineAttribute) } }),
  parseHTML: () => [{ tag: `span[${inlineAttribute}]` }],
  renderHTML: ({ node }) => ['span', { [inlineAttribute]: node.attrs.html }, `◇ ${t('HTML fragment — edit in source')}`],
});

export function editableHtml(source: string, format: ContentFormat, convertingToMarkdown = false): string {
  if (format === 'markdown') return markdown.render(source);
  const template = document.createElement('template');
  template.innerHTML = source;
  for (const element of [...template.content.children]) {
    const descendants = [element, ...element.querySelectorAll('*')];
    const unsupported = descendants.some(node => !['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'BR', 'HR', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SPAN'].includes(node.tagName)
      || [...node.attributes].some(attribute => !['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'style', 'start'].includes(attribute.name))
      || (node.hasAttribute('style') && /(?:position|display|background-image|url\s*\()/i.test(node.getAttribute('style')!))
      || (convertingToMarkdown && (node.hasAttribute('style') || node.tagName === 'U' || Number(node.getAttribute('colspan') ?? 1) > 1 || Number(node.getAttribute('rowspan') ?? 1) > 1)));
    if (unsupported) {
      const replacement = document.createElement('div');
      replacement.setAttribute(blockAttribute, element.outerHTML); element.replaceWith(replacement);
    }
  }
  for (const node of [...template.content.childNodes]) {
    if (node.nodeType !== globalThis.Node.COMMENT_NODE) continue;
    const replacement = document.createElement('div');
    replacement.setAttribute(blockAttribute, `<!--${node.textContent}-->`); node.replaceWith(replacement);
  }
  return template.innerHTML;
}

export function editorHtml(editor: Editor): string {
  const template = document.createElement('template'); template.innerHTML = editor.getHTML();
  let html = template.innerHTML;
  for (const element of template.content.querySelectorAll(`[${blockAttribute}], [${inlineAttribute}]`)) {
    html = html.replace(element.outerHTML, () => element.getAttribute(blockAttribute) ?? element.getAttribute(inlineAttribute) ?? '');
  }
  return html;
}
