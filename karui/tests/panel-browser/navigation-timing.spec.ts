import { test, expect, type Page } from '@playwright/test';

async function clickURL(page: Page, href: string) {
  return page.evaluate(href => {
    const link = document.createElement('a'); link.href = href; document.body.append(link);
    link.click(); link.remove();
    const element = document.querySelector<HTMLElement>('#page');
    return { phase: element?.dataset.transition, duration: element?.getAnimations()[0]?.effect?.getTiming().duration };
  }, href);
}

async function hold(page: Page, url: string) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(url, async route => {
    await gate;
    await route.continue().catch(() => {});
  });
  return release;
}

test('exit starts inside the click, waits invisibly for content, and keeps the menu', async ({ page }) => {
  await page.goto('/second');
  await page.evaluate(() => {
    for (const selector of ['#page', '#menu']) document.querySelector<HTMLElement>(selector)!.dataset.identity = 'kept';
  });
  const release = await hold(page, '**/appearance-preview');
  expect(await clickURL(page, '/appearance-preview')).toEqual({ phase: 'leave', duration: 125 });
  await expect(page.locator('#page')).toBeHidden();
  await expect(page.locator('#page')).toContainText('Treść drugiej strony.');
  await expect(page).toHaveURL('/second');
  await expect(page.locator('#page')).toBeHidden();
  expect(await page.locator('#page').evaluate(element => (element as HTMLElement).inert)).toBe(true);
  for (const selector of ['#menu']) {
    await expect(page.locator(selector)).toHaveAttribute('data-identity', 'kept');
    await expect(page.locator(selector)).toBeVisible();
    expect(await page.locator(selector).evaluate(element => element.getAnimations().length)).toBe(0);
  }
  release();
  await expect(page).toHaveURL('/appearance-preview');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#page')).toBeVisible();
  await expect(page.locator('#page')).toHaveAttribute('data-identity', 'kept');
  await expect(page.locator('[data-ui-island="navigation-waiting"]')).toHaveCount(0);
  expect(await page.locator('#page').evaluate(element => (element as HTMLElement).inert)).toBe(false);
});

test('even a ready response cannot interrupt the 125ms exit; entry waits for its end', async ({ page, request }) => {
  await page.goto('/second');
  const response = await request.get('/appearance-preview', { headers: { Accept: 'application/vnd.karui.page+json' } });
  const data = await response.json(); data.styles = [];
  await page.route('**/appearance-preview', route => route.fulfill({ status: 200, contentType: 'application/vnd.karui.page+json', body: JSON.stringify(data) }));
  await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('#page')!;
    new MutationObserver(() => {
      const phase = element.dataset.transition;
      if (phase !== 'enter' && phase !== 'leave') return;
      const animation = element.getAnimations()[0];
      if (animation) { animation.pause(); animation.currentTime = phase === 'leave' ? 124 : 0; }
    }).observe(element, { attributes: true, attributeFilter: ['data-transition'] });
  });
  const received = page.waitForResponse('**/appearance-preview');
  expect(await clickURL(page, '/appearance-preview')).toEqual({ phase: 'leave', duration: 125 });
  await received;
  await expect(page.locator('#page')).toHaveAttribute('data-transition', 'leave');
  await expect(page).toHaveURL('/second');
  await expect(page.locator('#page')).toContainText('Treść drugiej strony.');
  await page.locator('#page').evaluate(element => element.getAnimations()[0]!.finish());
  await expect(page).toHaveURL('/appearance-preview');
  await expect(page.locator('#page')).toHaveAttribute('data-transition', 'enter');
  await expect(page.locator('.navigation-waiting')).toHaveCount(0);
  await expect(page.locator('#page')).toHaveCSS('opacity', '0');
  await page.locator('#page').evaluate(element => element.getAnimations()[0]!.finish());
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#page')).toHaveCSS('opacity', '1');
});

test('a failed pending request restores the old interactive page and removes waiting effects', async ({ page }) => {
  await page.goto('/second');
  let fail!: () => void;
  const gate = new Promise<void>(resolve => { fail = resolve; });
  await page.route('**/appearance-preview', async route => { await gate; await route.abort(); });
  await clickURL(page, '/appearance-preview');
  await expect(page.locator('#page')).toBeHidden();
  fail();
  await expect(page.locator('.navigation-notice')).toBeVisible();
  await expect(page.locator('#page')).toBeVisible();
  await expect(page.locator('#page')).toContainText('Treść drugiej strony.');
  await expect(page.locator('.navigation-waiting')).toHaveCount(0);
  expect(await page.locator('#page').evaluate(element => ({ inert: (element as HTMLElement).inert, animations: element.getAnimations().length }))).toEqual({ inert: false, animations: 0 });
  await page.unroute('**/appearance-preview');
  await page.getByRole('button', { name: 'Spróbuj ponownie' }).click();
  await expect(page).toHaveURL('/appearance-preview');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
});

test('a newer click and a same-page cancellation clean up the old departure synchronously', async ({ page }) => {
  await page.goto('/second');
  const release = await hold(page, '**/appearance-preview');
  await clickURL(page, '/appearance-preview');
  await expect(page.locator('#page')).toBeHidden();
  await clickURL(page, '/second');
  await expect(page.locator('#page')).toBeVisible();
  await expect(page.locator('.navigation-waiting')).toHaveCount(0);
  // Supersede an exit before it finishes; the cancelled promise must not clear the new phase.
  expect(await page.evaluate(() => {
    const link = document.createElement('a'); document.body.append(link);
    link.href = '/appearance-preview'; link.click(); link.href = '/'; link.click(); link.remove();
    return document.querySelector<HTMLElement>('#page')!.dataset.transition;
  })).toBe('leave');
  await expect(page).toHaveURL('/');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#page')).toBeVisible();
  await expect(page.locator('.navigation-waiting')).toHaveCount(0);
  release();
  await clickURL(page, '/second');
  await expect(page).toHaveURL('/second');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#page')).toBeVisible();
});

test('reduced motion skips both transition phases and pending pulses', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/second');
  const release = await hold(page, '**/appearance-preview');
  expect((await clickURL(page, '/appearance-preview')).phase).toBeUndefined();
  await expect(page.locator('#page')).toBeHidden();
  await expect(page.locator('.navigation-waiting')).toHaveCount(0);
  release();
  await expect(page).toHaveURL('/appearance-preview');
  await expect(page.locator('.site-shell')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#page')).toBeVisible();
  expect(await page.locator('#page').evaluate(element => element.getAnimations().length)).toBe(0);
});
