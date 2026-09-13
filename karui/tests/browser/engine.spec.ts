import { test, expect } from '@playwright/test';

test('default home renders without a custom theme and all styles are available', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const failedAssets: string[] = [];
  page.on('response', response => { if (response.url().includes('/assets/') && response.status() >= 400) failedAssets.push(response.url()); });
  await page.goto('/');
  await expect(page.locator('#page h1')).toHaveText('Welcome to Test site');
  await expect(page.getByText('Bring speed back to the web.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the administration panel' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/default-theme-home.png' });
  expect(failures).toEqual([]); expect(failedAssets).toEqual([]);
});

test('default theme follows the operating system light and dark preference without JavaScript', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const colors = () => page.locator('html').evaluate(element => {
    const root = getComputedStyle(element);
    const page = getComputedStyle(document.querySelector('#page')!);
    return { scheme: root.colorScheme, site: root.backgroundColor, text: root.color, page: page.backgroundColor };
  });
  const light = await colors();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await colors()).site).not.toBe(light.site);
  const dark = await colors();
  expect(dark.scheme).toContain('dark');
  expect(dark.text).not.toBe(light.text);
  expect(dark.page).not.toBe(light.page);
  await page.screenshot({ path: 'artifacts/default-theme-dark.png' });
  await page.goto('/panel');
  await expect(page.locator('html')).toHaveCSS('background-color', dark.site);
  await expect(page.locator('#page')).toHaveCSS('background-color', dark.page);
  await expect(page.getByLabel('Login', { exact: true })).toBeVisible();
});

test('the language selector changes the query parameter and remembers the selection', async ({ page }) => {
  await page.goto('/second?filter=recent');
  await page.locator('.language-switcher select').selectOption('fr');
  await expect(page).toHaveURL('/second?filter=recent&lang=fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.locator('.language-switcher select')).toHaveAttribute('aria-label', 'Langue');
  await page.goto('/second');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});

test('default SSR, fragments and history keep the mounted shell and menu', async ({ page }) => {
  await page.goto('/second');
  await expect(page.locator('body')).toHaveAttribute('data-theme', 'default');
  await page.locator('#menu').evaluate(el => { (el as HTMLElement).dataset.identity = 'original'; });
  const response = page.waitForResponse(r => r.url().endsWith('/example') && !!r.headers()['content-type']?.includes('vnd.karui.page+json'));
  await page.locator('#menu a[href="/example"]').click();
  await response;
  await expect(page.locator('#page')).toContainText('Początkowa treść.');
  await expect(page.locator('.submenu')).toBeVisible();
  await expect(page.locator('#menu')).toHaveAttribute('data-identity', 'original');
  await page.goBack();
  await expect(page).toHaveURL('/second');
  await expect(page.locator('#page')).toContainText('Treść drugiej strony.');
  await expect(page.locator('#menu')).toHaveAttribute('data-identity', 'original');
});

test('gallery retains decoded images through resizing and supports keyboard navigation', async ({ page }) => {
  await page.goto('/appearance-preview');
  const images = page.locator('.imgframe img');
  expect(await images.count()).toBeGreaterThan(1);
  for (const width of [1440, 1100, 700, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => images.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await images.first().click();
  await expect(page.locator('dialog')).toBeVisible();
  const label = await page.locator('[data-gallery-counter]').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-gallery-counter]')).not.toHaveText(label!);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toBeHidden();
});
