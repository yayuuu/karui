import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const origins = process.argv.slice(2).length ? process.argv.slice(2) : ['http://127.0.0.1:3000'];
for (const origin of origins) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const path of ['/']) {
    await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.fonts.ready);
    console.log(origin + path, await page.evaluate(() => [...document.querySelectorAll('#page, #page > *, .animation, .showroom-stage, #rotator, .buttons, .showroom-buttons, video')].map((element) => ({ element: element.tagName + '.' + element.className + '#' + element.id, box: element.getBoundingClientRect().toJSON(), margin: getComputedStyle(element).margin, display: getComputedStyle(element).display }))));
  }
  await page.close();
}
await browser.close();
