import type { MarkdownIt } from 'markdown-it';

/** Presentation for parsed Markdown tables only, never raw HTML/editor storage. */
export function styleTables(markdown: MarkdownIt): void {
  markdown.renderer.rules.table_open = (tokens, index, options, _env, renderer) => {
    tokens[index]!.attrJoin('class', 'markdown-table');
    return '<div class="markdown-table-scroll" role="region" aria-label="Tabela — przewijana poziomo w razie potrzeby" tabindex="0">\n'
      + renderer.renderToken(tokens, index, options);
  };
  markdown.renderer.rules.table_close = (tokens, index, options, _env, renderer) => renderer.renderToken(tokens, index, options) + '</div>\n';
  markdown.renderer.rules.th_open = (tokens, index, options, _env, renderer) => {
    tokens[index]!.attrSet('scope', 'col');
    return renderer.renderToken(tokens, index, options);
  };
}
