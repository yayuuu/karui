import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { parsePage } from '../src/content.js';
import { renderContent } from '../src/content/format.js';
import { renderPageContent } from '../src/content/code.js';

const source = '| Name | State | Count |\n| :--- | :---: | ---: |\n| `cache` | **On** | 8 |\n| A \\| B | [Link](/start) | 16 |\n';
function elements(html: string, tag: string) {
  const result: DefaultTreeAdapterMap['element'][] = [];
  const visit = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node && node.tagName === tag) result.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(parseFragment(html)); return result;
}

test('Markdown tables gain one accessible scroll wrapper and scoped table styling', () => {
  const body = parsePage('---\ntitle: Table\nformat: markdown\n---\n' + source, '/table');
  assert.equal(body.source, source);
  assert.equal(elements(body.html, 'table').length, 1);
  const wrapper = elements(body.html, 'div')[0]!;
  assert.equal(wrapper.attrs.find(attr => attr.name === 'class')?.value, 'markdown-table-scroll');
  assert.equal(wrapper.attrs.find(attr => attr.name === 'role')?.value, 'region');
  assert.equal(wrapper.attrs.find(attr => attr.name === 'tabindex')?.value, '0');
  assert.equal(elements(body.html, 'thead').length, 1);
  assert.equal(elements(body.html, 'tbody').length, 1);
  const headings = elements(body.html, 'th');
  assert.deepEqual(headings.map(node => node.attrs.find(attr => attr.name === 'scope')?.value), ['col', 'col', 'col']);
  assert.deepEqual(headings.map(node => node.attrs.find(attr => attr.name === 'style')?.value), ['text-align:left', 'text-align:center', 'text-align:right']);
  assert.match(body.html, /<code>cache<\/code>/); assert.match(body.html, /<strong>On<\/strong>/);
  assert.match(body.html, /A \| B/); assert.match(body.html, /href="\/start"/);
  assert.equal(elements(body.html, 'td').length, 6);
});

test('stored/editor HTML, raw tables and fenced table examples are not decorated as Markdown tables', () => {
  assert.doesNotMatch(renderContent(source), /markdown-table/);
  const raw = '<table class="custom"><tr><td>Original</td></tr></table>\n';
  assert.equal(renderPageContent(raw, 'html'), raw);
  assert.equal(renderPageContent(raw, 'markdown'), raw);
  const fenced = renderPageContent('```markdown\n' + source + '```\n');
  assert.equal(elements(fenced, 'table').length, 0);
  assert.match(fenced, /code-block/);
  assert.equal(elements(renderPageContent(source + '\n' + source), 'div').length, 2);
});

test('code inside cells stays escaped and repeated rendering does not duplicate wrapper attributes', () => {
  const source = '| Code |\n| --- |\n| `<script>alert(1)</script>` |\n';
  const first = renderPageContent(source);
  assert.equal(elements(first, 'script').length, 0);
  assert.match(first, /&lt;script&gt;/);
  assert.equal(renderPageContent(source), first);
});
