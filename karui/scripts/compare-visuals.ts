import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('artifacts/visual', { recursive: true });
const browser = await chromium.launch({ headless: true });
const measurements: unknown[] = [];
const targets = [
  ...(process.env.BASELINE_URL ? [['baseline', process.env.BASELINE_URL] as const] : []),
  ['candidate', process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'] as const,
];
for (const route of process.argv.length > 2 ? process.argv.slice(2) : ['/']) {
  const slug = route === '/' ? 'home' : route.slice(1);
  for (const [label, origin] of targets) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/www.youtube.com/**', (route) => route.abort());
    await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    measurements.push({ route, label, info: await page.evaluate(() => ({ mode: document.compatMode, page: document.querySelector('#page')?.getBoundingClientRect().toJSON(), menu: document.querySelector('#menu')?.getBoundingClientRect().toJSON(), font: getComputedStyle(document.documentElement).fontFamily, scroll: document.documentElement.scrollHeight })) });
    await page.screenshot({ path: `artifacts/visual/${slug}-${label}.png` });
    await page.close();
  }
}
await writeFile('artifacts/visual/measurements.json', JSON.stringify(measurements, null, 2));
console.log(JSON.stringify(measurements, null, 2));
await browser.close();
