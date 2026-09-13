import { test, expect } from '@playwright/test';

test('lightbox dismisses on backdrop clicks, not on controls, borders or drags from inside', async ({ page }) => {
  await page.goto('/appearance-preview');
  const tile = page.locator('.imgframe').first(), dialog = page.locator('dialog.lightbox');
  await tile.click(); await expect(dialog).toBeVisible();
  const transition = await page.locator('[data-action=next]').evaluate(async button => {
    const root = button.closest('[data-gallery]')!;
    const image = root.querySelector<HTMLImageElement>('[data-gallery-image]')!;
    const initialSource = image.src;
    const started = performance.now();
    const swapped = new Promise<number>(resolve => {
      const observer = new MutationObserver(() => {
        if (image.src === initialSource) return;
        observer.disconnect(); resolve(performance.now());
      });
      observer.observe(image, { attributes: true, attributeFilter: ['src'] });
    });
    (button as HTMLButtonElement).click();
    const changed = await swapped;
    const fadeIn = image.getAnimations().at(-1);
    await fadeIn?.finished.catch(() => undefined);
    return { fadeOut: changed - started, fadeIn: performance.now() - changed };
  });
  expect(transition.fadeOut).toBeGreaterThanOrEqual(120);
  expect(transition.fadeIn).toBeGreaterThanOrEqual(120);
  await expect(page.locator('[data-gallery-counter]')).toHaveText('Zdjęcie 2 z 8');
  const title = dialog.locator('.lightbox-title');
  const download = title.getByRole('link', { name: 'Pobierz', exact: true });
  await expect(title.locator(':scope > span')).toHaveText('Zdjęcie 2 z 8 (Pobierz)');
  await expect(title).toHaveCSS('border-width', '0px');
  await expect(download).toHaveAttribute('href', '/media/appearance-1.png');
  expect(await download.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeLessThan(await title.locator('[data-gallery-counter]').evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize)));
  const downloading = page.waitForEvent('download');
  await download.click(); await downloading;
  await expect(dialog.locator('.lightbox-controls')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + 2);
  await expect(dialog).toBeVisible();
  await page.mouse.move(box.x + 2, box.y + 2); await page.mouse.down();
  await page.mouse.move(4, 4); await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden(); await expect(tile).toBeFocused();
  await tile.click(); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await tile.click(); await page.locator('[data-action=close]').click(); await expect(dialog).toBeHidden();
  // Repeat after a partial navigation to exercise listener cleanup and remounting.
  await page.locator('#page').getByRole('link', { name: 'link', exact: true }).click();
  await expect(page).toHaveURL('/second');
  await page.goBack(); await expect(tile).toBeVisible();
  await tile.click(); await page.mouse.click(4, 4); await expect(dialog).toBeHidden();
});

test.describe('touch', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('tap outside the lightbox closes it on mobile', async ({ page }) => {
    await page.goto('/appearance-preview');
    await page.locator('.imgframe').first().tap();
    await expect(page.locator('dialog.lightbox')).toBeVisible();
    await expect(page.locator('.lightbox-title > span')).toHaveText('Zdjęcie 1 z 8 (Pobierz)');
    await expect(page.locator('.lightbox-title')).toHaveCSS('border-width', '0px');
    await page.touchscreen.tap(4, 4);
    await expect(page.locator('dialog.lightbox')).toBeHidden();
  });
});
