import { test, expect } from '@playwright/test';

test('Markdown tables preserve alignment and work after soft navigation', async ({ page }) => {
  await page.goto('/table-preview');
  const wrapper = page.locator('.markdown-table-scroll').first();
  const table = wrapper.locator('table');
  await expect(page.locator('.markdown-table-scroll')).toHaveCount(2);
  await expect(table.locator('th').nth(1)).toHaveCSS('text-align', 'center');
  await expect(table.locator('td').nth(2)).toHaveCSS('text-align', 'right');
  await expect(table.locator('th').first()).toHaveAttribute('scope', 'col');
  await page.screenshot({ path: 'artifacts/tables-light.png' });
  await page.screenshot({ path: 'artifacts/tables-dark.png' });
  await table.getByRole('link', { name: 'Wtyczki' }).click();
  await expect(page).toHaveURL('/second');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await page.goBack();
  await expect(page.locator('.markdown-table')).toHaveCount(2);
  await expect(page.locator('link[href$="/tables.css"]')).toHaveCount(1);
});

test.describe('touch and SSR', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  test('wide tables scroll independently on mobile, without sticky hover, and print without clipping', async ({ page }) => {
    await page.goto('/table-preview');
    const wrapper = page.locator('.markdown-table-scroll').last();
    const size = await wrapper.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, page: document.querySelector('#page')!.clientWidth, pageScroll: document.querySelector('#page')!.scrollWidth }));
    expect(size.scroll).toBeGreaterThan(size.width);
    expect(size.pageScroll).toBe(size.page);
    await wrapper.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => wrapper.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    const row = page.locator('.markdown-table tbody tr').nth(1);
    const background = await row.evaluate(el => getComputedStyle(el).backgroundColor);
    await row.hover();
    await page.screenshot({ path: 'artifacts/tables-mobile.png' });
    await page.emulateMedia({ media: 'print' });
    await expect(wrapper).toHaveCSS('overflow-x', 'visible');
    await expect(wrapper.locator('table')).toHaveCSS('table-layout', 'fixed');
  });
});
