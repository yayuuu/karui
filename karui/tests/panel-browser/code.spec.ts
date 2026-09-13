import { test, expect } from '@playwright/test';

test('highlighted Markdown survives soft navigation and preserves highlighting', async ({ page }) => {
  await page.goto('/code-preview');
  const code = page.locator('.code-block code').first();
  await expect(code.locator('.hljs-keyword').first()).toHaveText('const');
  await expect(page.locator('.code-block')).toHaveCount(2);
  await expect(page.locator('link[href$="/code.css"]')).toHaveCount(1);
  await page.getByRole('link', { name: 'Druga', exact: true }).click();
  await expect(page).toHaveURL('/second');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await page.goBack();
  await expect(code.locator('.hljs-keyword').first()).toHaveText('const');
  await expect(page.locator('link[href$="/code.css"]')).toHaveCount(1);
  await page.screenshot({ path: 'artifacts/code-dark.png' });
});

test.describe('SSR and mobile', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  test('code is already colored without JS and long lines scroll inside the block, not the page', async ({ page }) => {
    await page.goto('/code-preview');
    const code = page.locator('.code-block code').first();
    const bounds = await code.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, page: document.querySelector('#page')!.clientWidth, pageScroll: document.querySelector('#page')!.scrollWidth }));
    expect(bounds.scroll).toBeGreaterThan(bounds.width);
    expect(bounds.pageScroll).toBe(bounds.page);
    await expect(code).toHaveAttribute('tabindex', '0');
    await expect(page.locator('.code-block').nth(1)).toContainText('Plain code <script> is text');
    await expect(page.locator('.code-block script')).toHaveCount(0);
    await page.screenshot({ path: 'artifacts/code-mobile.png' });
    await page.emulateMedia({ media: 'print' });
    await expect(code).toHaveCSS('white-space', 'pre-wrap');
  });
});
