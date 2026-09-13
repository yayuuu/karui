import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { parsePage } from '../src/content.js';
import { renderContent } from '../src/content/format.js';
import { renderPageContent } from '../src/content/code.js';

const codeText = (html: string) => {
  const text = (node: DefaultTreeAdapterMap['node']): string => 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';
  return text(parseFragment(html));
};
const fence = (source: string, language = '') => '```' + language + '\n' + source + '```\n';

test('Markdown fences are highlighted on the server without changing source or editor conversion', () => {
  const source = 'const answer = "hello"; // comment\n';
  const body = fence(source, 'ts');
  const page = parsePage('---\ntitle: Code\nformat: markdown\n---\n' + body, '/code');
  assert.match(page.html, /class="code-block"/);
  assert.match(page.html, /hljs-keyword/); assert.match(page.html, /hljs-string/);
  assert.match(page.html, /language-ts/);
  assert.equal(codeText(page.html), source + '\n');
  assert.equal(page.source, body);
  assert.doesNotMatch(renderContent(body, 'markdown'), /hljs|code-block/);
});

test('common aliases, explicit plaintext, unknown languages and unlabeled blocks remain readable', () => {
  for (const [language, code] of [['TS', 'const n = 42;'], ['json', '{"foo":true}'], ['sh', 'echo "$HOME"'], ['yaml', 'name: value'], ['edge', '<p>{{ title }}</p>'], ['python', 'def hello(): pass']]) {
    const result = renderPageContent(fence(code + '\n', language));
    assert.match(result, /class="hljs-/);
    assert.equal(codeText(result), code + '\n\n');
  }
  for (const language of ['', 'text', 'plaintext', 'not-a-language', '"><img']) {
    const result = renderPageContent(fence('<img src="x" onerror="alert(1)">\n', language));
    assert.match(result, /code-block/);
    assert.doesNotMatch(result, /<img|onerror="/);
    assert.equal(codeText(result), '<img src="x" onerror="alert(1)">\n\n');
  }
});

test('HTML-looking code is escaped even for known grammars; HTML pages and inline code are unchanged', () => {
  const source = '</code><script>alert("x")</script>&\n';
  const highlighted = renderPageContent(fence(source, 'html'));
  assert.doesNotMatch(highlighted, /<script>|<\/code><script>/);
  assert.equal(codeText(highlighted), source + '\n');
  const html = '<pre><code class="custom">raw &amp; HTML</code></pre>';
  assert.equal(renderPageContent(html, 'html'), html);
  assert.equal(renderPageContent('Inline `const n = 1`'), '<p>Inline <code>const n = 1</code></p>\n');
});

test('large snippets keep their content and frame without expensive syntax parsing', () => {
  const source = 'x'.repeat(50_001) + '<script>\n';
  const result = renderPageContent(fence(source, 'ts'));
  assert.match(result, /code-block/);
  assert.doesNotMatch(result, /<span|<script>/);
  assert.equal(codeText(result), source + '\n');
});
