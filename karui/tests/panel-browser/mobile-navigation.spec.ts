import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });
const longPage = '/example/section/mobile-preview';

test.describe('touch navigation', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('title toggles the same animated menu, retains scroll and does not stick touch hover', async ({ page }) => {
    await page.goto(longPage);
    const title = page.locator('.mobile-page-title'), content = page.locator('#page'), tree = page.locator('#mobile-navigation');
    await content.evaluate(el => { el.scrollTop = 350; });
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(false);
    await title.tap();
    await expect(title).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.mobile-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(tree).toBeVisible();
    await expect(tree).not.toHaveAttribute('data-transition');
    const inactive = tree.locator('a[href="/second"]');
    const normal = await inactive.evaluate(el => getComputedStyle(el).color);
    await inactive.hover(); // Emulate a sticky :hover without following the link.
    expect(await tree.locator('a[data-active=ancestor]').first().evaluate(el => getComputedStyle(el).color)).not.toBe(normal);
    await title.tap();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await expect(content).toBeVisible(); await expect(tree).toBeHidden();
    await expect(content).not.toHaveAttribute('data-transition');
    expect(await content.evaluate(el => el.scrollTop)).toBe(350);
  });
});

test('one bottom bar replaces both menus without overlapping content; closing preserves page state', async ({ page }) => {
  await page.goto(longPage);
  const bar = page.getByRole('navigation', { name: 'Nawigacja mobilna', exact: true });
  const panel = page.getByRole('navigation', { name: 'Nawigacja strony', exact: true });
  const content = page.locator('#page');
  await expect(bar).toBeVisible();
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('.submenu')).toBeHidden();
  await expect(panel).toBeHidden();
  const box = (await bar.boundingBox())!, article = (await content.boundingBox())!;
  await expect(bar.locator('.mobile-back')).toHaveText('');
  await expect(bar.locator('.mobile-back svg')).toBeVisible();
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.getByLabel('Zachowane pole').fill('Niezapisany tekst');
  await content.evaluate(el => { el.dataset.identity = 'original'; el.scrollTop = 400; });
  const scroll = await content.evaluate(el => el.scrollTop);
  await page.getByRole('button', { name: 'Otwórz nawigację', exact: true }).click();
  await expect(panel).toBeVisible(); await expect(content).toBeHidden();
  await expect(panel).not.toHaveAttribute('data-transition');
  const navigationBox = (await panel.boundingBox())!;
  const selected = panel.locator('a[href="/example/section"]');
  expect((await panel.boundingBox())!.y + (await panel.boundingBox())!.height).toBeLessThan(box.y);
  await expect(page.getByRole('button', { name: 'Zamknij nawigację', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.locator('a[href="/example/section"]')).toHaveAttribute('data-active', 'ancestor');
  await expect(panel.locator('a[href="/navigation-flat"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/mobile-navigation-open.png' });
  await page.keyboard.press('Escape');
  await expect(content).toBeVisible(); await expect(panel).toBeHidden();
  await expect(content).toHaveAttribute('data-identity', 'original');
  await expect(page.getByLabel('Zachowane pole')).toHaveValue('Niezapisany tekst');
  expect(await content.evaluate(el => el.scrollTop)).toBe(scroll);
  await expect(page.getByRole('button', { name: 'Otwórz nawigację', exact: true })).toBeFocused();
  await page.screenshot({ path: 'artifacts/mobile-navigation-closed.png' });
  for (const width of [320, 600, 899]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(bar).toBeVisible();
    const bounds = (await bar.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
});

test('opening and closing use the shared out/in transition, preserving scroll and reduced-motion support', async ({ page }) => {
  await page.goto(longPage);
  const content = page.locator('#page'), tree = page.locator('#mobile-navigation');
  await content.evaluate(el => { el.scrollTop = 350; });
  await page.evaluate(() => {
    const records: string[] = [];
    (window as typeof window & { phases: string[] }).phases = records;
    new MutationObserver(changes => {
      for (const change of changes) {
        const el = change.target as HTMLElement;
        if (el.dataset.transition) records.push(`${el.id}:${el.dataset.transition}`);
      }
    }).observe(document.querySelector('.site-shell')!, { subtree: true, attributes: true, attributeFilter: ['data-transition'] });
  });
  const phase = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.mobile-menu-toggle')!.click();
    const el = document.querySelector<HTMLElement>('#page')!;
    return { phase: el.dataset.transition, duration: el.getAnimations()[0]?.effect?.getTiming().duration };
  });
  expect(phase).toEqual({ phase: 'leave', duration: 125 });
  await expect(tree).toBeVisible();
  await expect(tree).not.toHaveAttribute('data-transition');
  await page.getByRole('button', { name: 'Zamknij nawigację', exact: true }).click();
  await expect(content).toBeVisible(); await expect(tree).toBeHidden();
  await expect(content).not.toHaveAttribute('data-transition');
  expect(await content.evaluate(el => el.scrollTop)).toBe(350);
  const phases = await page.evaluate(() => (window as typeof window & { phases: string[] }).phases);
  for (const step of ['page:leave', 'mobile-navigation:enter', 'mobile-navigation:leave', 'page:enter']) expect(phases).toContain(step);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Otwórz nawigację', exact: true }).click();
  await expect(tree).toBeVisible();
  expect(await tree.evaluate(el => el.getAnimations().length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(tree).toBeHidden(); await expect(content).toBeVisible();
});

test('choosing a page transitions the visible menu out immediately while fetching in parallel', async ({ page }) => {
  await page.goto(longPage);
  await page.getByRole('button', { name: 'Otwórz nawigację', exact: true }).click();
  const tree = page.locator('#mobile-navigation'), content = page.locator('#page');
  await expect(tree).toBeVisible(); await expect(tree).not.toHaveAttribute('data-transition');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/second', async route => { await gate; await route.continue(); });
  const requested = page.waitForRequest('**/second');
  const phase = await tree.locator('a[href="/second"]').evaluate(el => {
    (el as HTMLAnchorElement).click();
    return document.querySelector<HTMLElement>('#mobile-navigation')!.dataset.transition;
  });
  expect(phase).toBe('leave');
  await requested;
  await expect(content).toBeHidden();
  await expect(tree).toBeHidden();
  await expect(page.locator('.site-shell')).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(page).toHaveURL('/second');
  await expect(content).toBeVisible();
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  expect(await content.evaluate(el => (el as HTMLElement).inert)).toBe(false);
  await expect(tree).toBeHidden();
  await expect(page.locator('.navigation-waiting')).toHaveCount(0);
});

test('rapid toggles and desktop resize cancel animations without leaving content inert', async ({ page }) => {
  await page.goto(longPage);
  const content = page.locator('#page'), tree = page.locator('#mobile-navigation');
  const stableToggle = await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.mobile-menu-toggle')!;
    button.click();
    const same = button === document.querySelector('.mobile-menu-toggle');
    button.click();
    return same;
  });
  expect(stableToggle).toBe(true);
  await expect(content).toBeVisible(); await expect(tree).toBeHidden();
  expect(await content.evaluate(el => (el as HTMLElement).inert)).toBe(false);
  await page.getByRole('button', { name: 'Otwórz nawigację', exact: true }).click();
  await expect(tree).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(content).toBeVisible(); await expect(tree).toBeHidden();
  await expect(content).not.toHaveAttribute('data-transition');
  expect(await content.evaluate(el => (el as HTMLElement).inert)).toBe(false);
});

test('tree navigation, back hierarchy, home and browser history use existing fragment navigation', async ({ page }) => {
  await page.goto(longPage);
  await page.evaluate(() => { document.body.dataset.identity = 'original'; });
  const open = () => page.getByRole('button', { name: 'Otwórz nawigację', exact: true }).click();
  const tree = page.locator('#mobile-navigation');
  await open();
  await tree.locator('a[href="/navigation-flat"]').click();
  await expect(page).toHaveURL('/navigation-flat');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#page')).toBeVisible(); await expect(tree).toBeHidden();
  await expect(page.locator('.mobile-page-title')).toHaveText('Navigation preview');
  await open();
  await expect(tree.locator('a[href="/navigation-flat"]')).toHaveAttribute('aria-current', 'page');
  await tree.locator('a[href="/navigation-flat"]').click(); // same page also closes the tree
  await expect(tree).toBeHidden();
  await page.getByRole('link', { name: 'Strona nadrzędna', exact: true }).click();
  await expect(page).toHaveURL('/example/section');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await page.getByRole('link', { name: 'Strona nadrzędna', exact: true }).click();
  await expect(page).toHaveURL('/example');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await page.getByRole('link', { name: 'Strona nadrzędna', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('#page')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Strona nadrzędna', exact: true })).toHaveCount(0);
  await expect(page.locator('.mobile-page-title')).toHaveText('Test site');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await open(); await tree.locator('a[href="/second"]').click();
  await expect(page).toHaveURL('/second');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await page.goBack(); await expect(page).toHaveURL('/');
  await expect(page.locator('#page')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-identity', 'original');
});

test('resizing to desktop restores content and existing menus, and reopening preserves gallery image nodes', async ({ page }) => {
  await page.goto('/appearance-preview');
  const image = page.locator('.imgframe img').first();
  await image.evaluate(el => { el.dataset.identity = 'kept'; });
  await page.getByRole('button', { name: 'Otwórz nawigację', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#page')).toBeVisible();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('.mobile-bar')).toBeHidden();
  await expect(page.locator('.mobile-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#mobile-navigation')).toBeHidden();
  await expect(image).toHaveAttribute('data-identity', 'kept');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Otwórz nawigację', exact: true }).click();
  await page.getByRole('button', { name: 'Wróć do treści', exact: true }).click();
  await expect(image).toBeVisible(); await expect(image).toHaveAttribute('data-identity', 'kept');
});

test('failed navigation restores content, while an external link retains its configured address', async ({ page }) => {
  await page.goto(longPage);
  await page.route('**/second', route => route.abort());
  await page.getByRole('button', { name: 'Otwórz nawigację', exact: true }).click();
  await expect(page.locator('#mobile-navigation a[href^="https:"]')).toHaveAttribute('href', 'https://example.org/example/section');
  await page.locator('#mobile-navigation a[href="/second"]').click();
  await expect(page.locator('.navigation-notice')).toBeVisible();
  await expect(page.locator('#page')).toBeVisible();
  await expect(page.locator('#mobile-navigation')).toBeHidden();
  await expect(page).toHaveURL(longPage);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('server-rendered menu and submenu remain usable', async ({ page }) => {
    await page.goto(longPage);
    await expect(page.locator('#menu')).toBeVisible();
    await expect(page.locator('.submenu')).toBeVisible();
    await expect(page.locator('.submenu a[href="/navigation-flat"]')).toBeVisible();
  });
});
