import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../src/app.js';
import { configFromEnv } from '../src/config.js';
import { PanelFiles } from '../src/admin/files.js';
import { hashPassword } from '../src/admin/password.js';
import { PNG } from 'pngjs';

const content = await mkdtemp(join(tmpdir(), 'karui-panel-browser-'));
const files = new PanelFiles(content);
await files.write('site.yml', 'title: Test site\nhome: /\nlanguage: pl\nlanguages: [pl, en, fr]\nmenu:\n  - title: Pierwsza\n    href: /example\n    children:\n      - title: Sekcja\n        href: /example/section\n        children:\n          - title: Płaski adres\n            href: /navigation-flat\n      - title: Inna\n        href: /example/other\n      - title: Zewnętrzny\n        href: https://example.org/example/section\n  - title: Druga\n    href: /second\n');
await files.write('pages/example/index.md', '---\ntitle: Pierwsza\n---\n<p>Początkowa treść.</p>\n<div class="legacy-layout"><iframe src="https://www.youtube.com/embed/test"></iframe></div>\n');
await files.write('pages/second.md', '---\ntitle: Druga\n---\nTreść drugiej strony.\n');
for (const path of ['example/section/index', 'example/section/deep', 'example/other', 'navigation-flat', 'example-other']) {
  await files.write(`pages/${path}.md`, '---\ntitle: Navigation preview\n---\nTest podświetlenia.\n');
}
await files.write('pages/controls-preview.md', '---\ntitle: Controls\nformat: html\n---\n<label for="plain-select">Przykładowy wybór</label><select id="plain-select"><option value="one">Pierwsza</option><option value="two">Druga</option></select><br><label for="disabled-select">Wyłączony wybór</label><select id="disabled-select" disabled><option>Brak</option></select>\n');
await files.write('pages/example/section/mobile-preview.md', '---\ntitle: Długa strona do sprawdzenia mobilnej nawigacji\nformat: html\n---\n<input aria-label="Zachowane pole" value="Początek">' + '<p>Długa treść strony do sprawdzenia przewijania i nawigacji.</p>'.repeat(60));
const previewPng = new PNG({ width: 80, height: 80 }); previewPng.data.fill(200);
await files.write('pages/appearance-menu/index.md', '---\ntitle: Lista podstron\n---\n');
await files.write('pages/appearance-menu/one.md', '---\ntitle: Pierwsza pozycja\n---\nPierwsza treść.\n');
await files.write('pages/appearance-menu/two.md', '---\ntitle: Druga pozycja\n---\nDruga treść.\n');
const previewGallery = [];
for (let i = 0; i < 8; i++) {
  await files.write(`media/appearance-${i}.png`, PNG.sync.write(previewPng));
  previewGallery.push(`  - src: /media/appearance-${i}.png\n    thumbnail: /media/appearance-${i}.png`);
}
await files.write('pages/appearance-preview.md', `---\ntitle: Wygląd\ngallery:\n${previewGallery.join('\n')}\n---\nPrzykładowa treść i [link](/second).\n`);
await files.write('state/panel/accounts.json', JSON.stringify([{ login: 'owner', password: await hashPassword('browser-password-123'), role: 'owner', version: 1 }]));
await mkdir(join(content, 'plugins'));
await cp('docs/plugins/example', join(content, 'plugins/example'), { recursive: true });
await files.write('themes/example/theme.json', '{"name":"Example theme","version":"1"}');
await files.write('themes/example/client.ts', 'export default () => { document.body.dataset.exampleTheme = "ready"; };');
await files.write('pages/plugin-demo.md', '---\ntitle: Plugin demo\nplugin: example\npluginPlacement: content\n---\nPLUGIN-TEXT [[notice]]\n');
await files.write('pages/code-preview.md', '---\ntitle: Code preview\nformat: markdown\n---\n```ts\nconst answer = "hello"; // comment\n' + 'const long = "' + 'x'.repeat(300) + '";\n```\n\n```\nPlain code <script> is text\n```\n');
await files.write('pages/table-preview.md', '---\ntitle: Tabele Markdown\nformat: markdown\n---\n| Ustawienie | Stan | Liczba |\n| :--- | :---: | ---: |\n| `cache` | **Aktywny** | 8 |\n| [Wtyczki](/second) | Dostępne | 16 |\n| Serwer | Uruchomiony | 1 |\n\n## Szeroka tabela\n\n| A | B | C | D | E | F | G | H |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |\n');
const app = await buildApp({ ...configFromEnv(), contentDir: content, panelSecureCookie: false, pluginWorkers: 1, pluginMaxWorkers: 4 });
await app.listen({ port: 3012, host: '127.0.0.1' });
let stopping = false;
const close = async () => { if (stopping) return; stopping = true; await app.close(); await rm(content, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
