import hljs from 'highlight.js';
import MarkdownIt from 'markdown-it';
import { createContentRenderer } from './format.js';
import { styleTables } from './tables.js';

const escape = new MarkdownIt().utils.escapeHtml;
// Edge combines HTML with {{ expressions }}. Handlebars also highlights both.
hljs.registerAliases('edge', { languageName: 'handlebars' });

/** Server-side only: visitors receive cached HTML/CSS, never the language bundle. */
function highlight(code: string, requested: string): string {
  const name = requested.toLowerCase();
  const language = /^[a-z0-9_+#.-]{1,64}$/.test(name) && hljs.getLanguage(name) ? name : 'plaintext';
  let html = escape(code);
  // Explicit languages avoid expensive/ambiguous autodetection. Large snippets
  // and parser failures remain readable, escaped text without blocking the page.
  if (code.length <= 50_000 && language !== 'plaintext') {
    try { html = hljs.highlight(code, { language, ignoreIllegals: true }).value; }
    catch { /* Preserve the code even if a grammar cannot parse it. */ }
  }
  const label = language === 'plaintext' ? 'Kod' : language;
  return `<pre class="code-block" data-language="${escape(label)}"><code class="hljs language-${escape(language)}" tabindex="0" aria-label="${escape('Kod: ' + label)}">${html}</code></pre>`;
}

export const renderPageContent = createContentRenderer({ highlight }, styleTables);
