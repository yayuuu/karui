import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { PNG } from 'pngjs';

let sessionCookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
async function login(page: Page) {
  if (sessionCookies) {
    await page.context().addCookies(sessionCookies); await page.goto('/panel');
    await expect(page.getByRole('heading', { name: 'Twoja strona, pod kontrolą' })).toBeVisible();
    return;
  }
  await page.goto('/panel');
  await page.getByLabel('Login', { exact: true }).fill('owner');
  await page.getByLabel('Hasło', { exact: true }).fill('browser-password-123');
  await page.getByRole('button', { name: 'Zaloguj', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Twoja strona, pod kontrolą' })).toBeVisible();
  sessionCookies = await page.context().cookies();
}

async function create(page: Page, title: string) {
  await login(page); await page.goto('/panel/new');
  await page.getByLabel('Tytuł strony', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Utwórz i przejdź do edycji' }).click();
  await expect(page.locator('.tiptap')).toBeVisible();
}

test('Markdown is the default, visual edits serialize Markdown and preserve manual HTML', async ({ page }) => {
  await create(page, 'Markdown roundtrip');
  await expect(page.getByLabel('Format treści')).toHaveValue('markdown');
  await page.getByRole('button', { name: 'Źródło Markdown', exact: true }).click();
  const raw = '<section class="custom"><iframe src="https://example.org/embed"></iframe></section>';
  await page.locator('[data-source]').fill(`## Heading\n\n**Bold**\n\n${raw}\n\nText <span style="color:red">inline</span>.`);
  await page.getByRole('button', { name: 'Edytor wizualny', exact: true }).click();
  await expect(page.locator('.tiptap [data-preserved-html]')).toHaveCount(1);
  await expect(page.locator('.tiptap iframe')).toHaveCount(0);
  await page.locator('.tiptap h2').click(); await page.keyboard.press('End'); await page.keyboard.type(' edited');
  await page.getByRole('button', { name: 'Źródło Markdown', exact: true }).click();
  const source = await page.locator('[data-source]').inputValue();
  expect(source).toContain('## Heading edited'); expect(source).toContain('**Bold**');
  expect(source).toContain(raw); expect(source).toContain('Text <span style="color:red">inline</span>.');
  expect(source).not.toContain('data-preserved');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()]);
  await page.getByRole('button', { name: 'Źródło Markdown', exact: true }).click();
  await expect(page.locator('[data-source]')).toHaveValue(source);
  await page.getByLabel('Format treści').selectOption('html');
  await expect(page.locator('[data-source]')).toHaveValue(/<h2>Heading edited<\/h2>/);
  await page.getByLabel('Format treści').selectOption('markdown');
  await expect(page.locator('[data-source]')).toHaveValue(/## Heading edited/);
  await expect(page.locator('[data-source]')).toHaveValue(/<section class="custom">/);
});

test('page save bar stays at the top while editing long content', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto('/panel/page?path=/second');
  const scroller = page.locator('#page'), bar = page.locator('.page-savebar');
  await expect(bar).toHaveCSS('position', 'sticky');
  await expect(page.locator('[data-edit-page] > .page-savebar')).toHaveCount(1);
  await expect(page.locator('[data-save-page] > .page-savebar')).toHaveCount(0);
  await scroller.evaluate(element => { element.scrollTop = 500; });
  await expect.poll(async () => {
    const surface = (await scroller.boundingBox())!, savebar = (await bar.boundingBox())!;
    return Math.round(savebar.y - surface.y);
  }).toBeGreaterThanOrEqual(0);
  expect(Math.round((await bar.boundingBox())!.y - (await scroller.boundingBox())!.y)).toBeLessThan(30);
});


test('background upload queue preserves unsaved text, updates revisions and supports retry', async ({ page }) => {
  await create(page, 'Background uploads');
  await page.getByRole('button', { name: 'Źródło Markdown', exact: true }).click();
  await page.locator('[data-source]').fill('## Unsaved before upload');
  await page.evaluate(() => { (window as unknown as { uploadMarker: number }).uploadMarker = 1; });
  const png = new PNG({ width: 40, height: 30 }); png.data.fill(255);
  const file = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG.sync.write(png) });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/panel/api/photos/upload?**', async route => { await gate; await route.continue(); });
  await page.locator('input[type=file]').setInputFiles([file('first.png'), file('second.png')]);
  await page.getByRole('button', { name: 'Dodaj zdjęcie', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zapisz zmiany', exact: true })).toBeDisabled();
  await page.locator('[data-source]').fill('## Edited during upload');
  release();
  await expect(page.locator('[data-upload-state=done]')).toHaveCount(2);
  await expect(page.locator('.panel-photo')).toHaveCount(2);
  await expect(page.locator('[data-source]')).toHaveValue('## Edited during upload');
  expect(await page.evaluate(() => (window as unknown as { uploadMarker?: number }).uploadMarker)).toBe(1);
  await page.unroute('**/panel/api/photos/upload?**');
  let fail = true;
  await page.route('**/panel/api/photos/upload?**', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Test retry"}' }); }
    else await route.continue();
  });
  await page.locator('input[type=file]').setInputFiles(file('retry.png'));
  await page.getByRole('button', { name: 'Dodaj zdjęcie', exact: true }).click();
  await expect(page.locator('[data-upload-state=error]')).toContainText('Test retry');
  await page.getByRole('button', { name: 'Ponów', exact: true }).click();
  await expect(page.locator('.panel-photo')).toHaveCount(3);
  await expect(page.locator('[data-upload-state=done]')).toHaveCount(1);
  await page.locator('.panel-photo').first().getByRole('button', { name: 'Wstaw do treści' }).click();
  await page.getByLabel('Widoczność galerii').selectOption('unused');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()]);
  await expect(page.locator('.panel-photo')).toHaveCount(3);
  await page.evaluate(() => { (window as unknown as { uploadMarker: number }).uploadMarker = 2; });
  await page.locator('input[type=file]').setInputFiles(file('after-save.png'));
  await page.getByRole('button', { name: 'Dodaj zdjęcie', exact: true }).click();
  await expect(page.locator('.panel-photo')).toHaveCount(4);
  await expect(page.locator('[data-upload-state=done]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { uploadMarker?: number }).uploadMarker)).toBe(2);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.panel-photo').last().getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(page.locator('.panel-photo')).toHaveCount(3);
  await page.goto('/background-uploads');
  await expect(page.getByRole('heading', { name: 'Edited during upload' })).toBeVisible();
  await expect(page.locator('.imgframe')).toHaveCount(2);
  await page.goto('/panel/page?path=/background-uploads');
  await page.getByLabel('Widoczność galerii').selectOption('hidden');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()]);
  await page.goto('/background-uploads');
  await expect(page.locator('[data-gallery]')).toHaveCount(0);
  await expect(page.locator('#page img')).toHaveCount(1);
  await page.goto('/panel/page?path=/background-uploads');
  await page.getByLabel('Strona opublikowana').uncheck();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()]);
  expect((await page.goto('/background-uploads'))!.status()).toBe(404);
  await page.goto('/panel/page?path=/background-uploads');
  await expect(page.getByLabel('Strona opublikowana')).not.toBeChecked();
  await expect(page.locator('.panel-photo')).toHaveCount(3);
});

test('panel keeps legacy HTML, supports rich text and source editing', async ({ page }) => {
  await login(page);
  await page.goto('/panel/page?path=/example');
  await expect(page.locator('.tiptap')).toBeVisible();
  await expect(page.locator('.tiptap [data-preserved-html]')).toHaveCount(1);
  await expect(page.locator('.tiptap iframe')).toHaveCount(0);
  await page.locator('.tiptap p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Dopisane w edytorze.');
  await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
  await expect(page.locator('.tiptap')).toContainText('Dopisane w edytorze.');
  await page.getByRole('button', { name: 'Źródło HTML', exact: true }).click();
  await expect(page.locator('[data-source]')).toHaveValue(/class="legacy-layout"/);
  await expect(page.locator('[data-source]')).toHaveValue(/youtube.com\/embed\/test/);
  await page.getByLabel('Format treści').selectOption('markdown');
  await page.locator('[data-source]').fill('## Nowy nagłówek\n\n**Treść Markdown**\n\n<script>window.badPreview=true</script>');
  await page.getByRole('button', { name: 'Podgląd', exact: true }).click();
  await expect(page.frameLocator('[data-editor-preview]').getByRole('heading', { name: 'Nowy nagłówek' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { badPreview?: boolean }).badPreview)).toBeUndefined();
  await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
  await expect(page.locator('[data-dirty-status]')).toHaveText('Brak niezapisanych zmian');
  await page.goto('/example');
  await expect(page.getByRole('heading', { name: 'Nowy nagłówek' })).toBeVisible();
  await expect(page.locator('#page strong')).toHaveText('Treść Markdown');
});

test('page editor independently toggles print and PDF buttons and remembers unchecked values', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/panel/page?path=/second');
  await expect(page.getByLabel('Pokaż przycisk Drukuj')).not.toBeChecked();
  await expect(page.getByLabel('Pokaż przycisk PDF')).not.toBeChecked();
  expect(await page.getByLabel('Pokaż przycisk PDF').evaluate(input => input.getBoundingClientRect().width)).toBe(18);
  for (const [showPrint, showPdf] of [[true, false], [false, true], [true, true], [false, false]]) {
    await page.getByLabel('Pokaż przycisk Drukuj').setChecked(showPrint!);
    await page.getByLabel('Pokaż przycisk PDF').setChecked(showPdf!);
    await expect(page.locator('[data-dirty-status]')).toHaveText('Niezapisane zmiany');
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()]);
    await expect(page.getByLabel('Pokaż przycisk Drukuj')).toBeChecked({ checked: showPrint });
    await expect(page.getByLabel('Pokaż przycisk PDF')).toBeChecked({ checked: showPdf });
    await page.goto('/second');
    await expect(page.locator('#print')).toHaveCount(showPrint ? 1 : 0);
    await expect(page.locator('#pdf')).toHaveCount(showPdf ? 1 : 0);
    await expect(page.locator('.page-title-actions')).toHaveCount(showPrint || showPdf ? 1 : 0);
    await page.goto('/panel/page?path=/second');
  }
  await page.goto('/example');
  await expect(page.locator('#print, #pdf')).toHaveCount(0);
});

test('plugin placement is editable and the private plugin worker can save behind panel authentication', async ({ page }) => {
  await login(page);
  await page.goto('/panel/page?path=/plugin-demo');
  for (const placement of ['before', 'after', 'content']) {
    await page.getByLabel('Położenie wtyczki względem treści').selectOption(placement);
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()]);
    await expect(page.getByLabel('Położenie wtyczki względem treści')).toHaveValue(placement);
  }
  await page.getByRole('link', { name: 'Administracja wtyczki' }).click();
  await expect(page.locator('.example-admin')).toBeVisible();
  await page.getByRole('button', { name: 'Zwiększ licznik w tle' }).click();
  await expect(page.locator('[data-count]')).toHaveText('1');
  await expect(page.locator('[data-save-status]')).toHaveText('Zapisano licznik.');
  await page.getByLabel('Wiadomość przykładu').fill('Wiadomość zapisana w panelu');
  await page.getByRole('button', { name: 'Zapisz wiadomość', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zapisano wiadomość.' })).toBeVisible();
  await page.goto('/plugin-demo');
  await expect(page.locator('[data-example-content]')).toContainText('Wiadomość zapisana w panelu');
  await expect(page.locator('[data-count]')).toHaveText('1');
  await page.getByRole('button', { name: 'Przetestuj klienta' }).click();
  await expect(page.locator('[data-local-count]')).toHaveText('Kliknięcia w bieżącym widoku: 1');
});

test('page editor remembers subpage list visibility without unpublishing children', async ({ page }) => {
  await login(page);
  await page.goto('/panel/page?path=/appearance-menu');
  const subpages = page.locator('details.panel-section').filter({ has: page.locator('summary', { hasText: 'Podstrony' }) });
  await expect(subpages.getByLabel('Pokaż listę podstron')).toHaveCount(1);
  await expect(page.getByLabel('Pokaż listę podstron')).toBeChecked();
  for (const visible of [false, true]) {
    await page.getByLabel('Pokaż listę podstron').setChecked(visible);
    await expect(page.locator('[data-dirty-status]')).toHaveText('Niezapisane zmiany');
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()]);
    await expect(page.getByLabel('Pokaż listę podstron')).toBeChecked({ checked: visible });
    await page.goto('/appearance-menu');
    await expect(page.locator('#page .pagemenu li')).toHaveCount(visible ? 2 : 0);
    expect((await page.goto('/appearance-menu/one'))!.status()).toBe(200);
    await page.goto('/panel/page?path=/appearance-menu');
  }
});

test('page editor changes child sort keys without using them as displayed numbers', async ({ page }) => {
  await login(page);
  await page.goto('/panel/page?path=/appearance-menu');
  const first = page.getByLabel('Kolejność: Pierwsza pozycja');
  const second = page.getByLabel('Kolejność: Druga pozycja');
  await first.fill('250');
  await second.fill('100');
  await expect(page.locator('[data-subpage-order-status]')).toHaveText('Niezapisana kolejność');
  await page.getByRole('button', { name: 'Zapisz kolejność', exact: true }).click();
  await expect(page.locator('[data-subpage-order-status]')).toHaveText('Kolejność zapisana');
  const rows = page.locator('[data-subpage-row]');
  await expect(rows.nth(0)).toContainText('1. Druga pozycja');
  await expect(rows.nth(1)).toContainText('2. Pierwsza pozycja');
  await expect(second).toHaveValue('100');
  await expect(first).toHaveValue('250');

  await page.goto('/appearance-menu');
  const items = page.locator('#page .pagemenu li');
  await expect(items.nth(0).locator('.pagenr')).toHaveText('1');
  await expect(items.nth(0)).toContainText('Druga pozycja');
  await expect(items.nth(1).locator('.pagenr')).toHaveText('2');
  await expect(items.nth(1)).toContainText('Pierwsza pozycja');
});

test('pages, subpages and photo uploads work through the integrated panel', async ({ page }) => {
  await login(page);
  await page.goto('/panel/new');
  await page.getByLabel('Tytuł strony', { exact: true }).fill('Nowa galeria');
  await expect(page.getByLabel('Adres (slug)')).toHaveValue('nowa-galeria');
  await page.getByRole('button', { name: 'Utwórz i przejdź do edycji' }).click();
  await expect(page).toHaveURL(/panel\/page\?path=%2Fnowa-galeria/);
  const gallery = page.locator('details.panel-section').filter({ has: page.locator('summary', { hasText: 'Galeria' }) });
  await gallery.getByLabel('Widoczność galerii').selectOption('unused');
  await expect(page.locator('[data-dirty-status]')).toHaveText('Niezapisane zmiany');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()]);
  await expect(gallery.getByLabel('Widoczność galerii')).toHaveValue('unused');
  const png = new PNG({ width: 40, height: 30 }); png.data.fill(255);
  await page.locator('input[type=file]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: PNG.sync.write(png) });
  await page.locator('[data-upload-photo] input[name=alt]').fill('Zdjęcie testowe');
  await page.getByRole('button', { name: 'Dodaj zdjęcie', exact: true }).click();
  await expect(page.locator('.panel-photo')).toHaveCount(1);
  await expect(page.locator('.panel-photo img')).toHaveAttribute('alt', 'Zdjęcie testowe');
  await page.goto('/nowa-galeria');
  await page.locator('.imgframe').click(); await expect(page.locator('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/panel/page?path=/nowa-galeria');
  await page.getByText('Podstrony', { exact: false }).filter({ has: page.locator('span') }).first().click();
  await page.getByRole('link', { name: 'Dodaj podstronę' }).click();
  await page.getByLabel('Tytuł strony', { exact: true }).fill('Podstrona');
  await page.getByRole('button', { name: 'Utwórz i przejdź do edycji' }).click();
  await expect(page).toHaveURL(/%2Fnowa-galeria%2Fpodstrona/);
});

test('gallery can be copied from a non-empty language version without replacing gallery editing', async ({ page }) => {
  await login(page);
  await page.goto('/panel/page?path=%2Fappearance-preview&language=en');
  const copy = page.locator('details.panel-gallery-copy');
  await expect(copy).not.toHaveAttribute('open', '');
  await copy.getByText('Skopiuj galerię z innego języka').click();
  await expect(copy.getByRole('option')).toHaveCount(1);
  await expect(copy.getByRole('option')).toHaveText(/PL/);
  await expect(page.getByRole('button', { name: 'Dodaj zdjęcie', exact: true })).toBeVisible();
  const response = page.waitForResponse(value => value.url().endsWith('/panel/api/photos/copy'));
  await copy.getByRole('button', { name: 'Skopiuj galerię', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('.panel-photo')).toHaveCount(8);
  await page.reload();
  await expect(page.getByText('Ten język nie ma jeszcze własnego pliku.', { exact: false })).toHaveCount(0);
});

test('localized site settings edit text while shared controls stay disabled', async ({ page }) => {
  await login(page);
  await page.goto('/panel/settings');
  await page.getByLabel('Wersja językowa ustawień strony').selectOption('en');
  await expect(page).toHaveURL(/panel\/settings\?language=en/);
  await expect(page.getByLabel('Wersja językowa ustawień strony')).toHaveValue('en');
  await expect(page.locator('[name="title"]')).toBeEnabled();
  await expect(page.locator('[name="language"]')).toBeDisabled();
  await expect(page.locator('[name="theme"]')).toBeDisabled();
  await expect(page.locator('[name="footerFormat"]')).toBeDisabled();
  await expect(page.locator('[name="footer"]')).toBeEnabled();
  await page.locator('[name="title"]').fill('Test site in English');
  await page.locator('[name="description"]').fill('English site description');
  await page.locator('[name="footer"]').fill('**English footer**');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Zapisz ustawienia' }).click()]);
  await page.goto('/example?lang=en');
  await expect(page).toHaveTitle(/Test site in English/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'English site description');
  await expect(page.locator('.site-footer strong')).toHaveText('English footer');
  await page.goto('/example?lang=pl');
  await expect(page).not.toHaveTitle(/Test site in English/);
});

test('menu uses nested drag and drop and persists order without arrow buttons', async ({ page }) => {
  await login(page); await page.goto('/panel/menu');
  const roots = page.locator('[data-menu-root] > .menu-node');
  await expect(roots).toHaveCount(2);
  const first = await roots.nth(0).locator(':scope > .menu-item .menu-handle').boundingBox();
  const second = await roots.nth(1).locator(':scope > .menu-item').boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down(); await page.mouse.move(second!.x + 50, second!.y + second!.height - 3, { steps: 15 }); await page.waitForTimeout(250); await page.mouse.up();
  await expect(roots.nth(0).locator(':scope > .menu-item > input')).toHaveValue('Druga');
  const source = await roots.nth(1).locator(':scope > .menu-item .menu-handle').boundingBox();
  const target = await roots.nth(0).locator(':scope > .menu-children').boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down(); await page.mouse.move(target!.x + 80, target!.y + target!.height / 2, { steps: 15 }); await page.waitForTimeout(250); await page.mouse.up();
  await expect(roots).toHaveCount(1);
  await expect(roots.first().locator(':scope > ul > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Zapisz menu', exact: true }).click();
  await expect(page.locator('[data-menu-status]')).toHaveText('Brak niezapisanych zmian');
  await expect(roots).toHaveCount(1);
  await expect(roots.first().locator(':scope > ul > li > .menu-item > input')).toHaveValue('Pierwsza');
  await expect(page.getByRole('button', { name: /Przenieś|Zagnieźdź|Dodaj podprzycisk/ })).toHaveCount(0);
  await page.goto('/'); await expect(page.locator('#menu li').first()).toHaveText('Druga');
});

test('TSX menu keeps edited values through rerenders, adding and removing branches', async ({ page }) => {
  await login(page);
  await page.goto('/panel/menu');
  const roots = page.locator('[data-menu-root] > .menu-node');
  const count = await roots.count();
  await page.getByRole('button', { name: '＋ Dodaj element menu', exact: true }).click();
  await expect(roots).toHaveCount(count + 1);
  const added = roots.last();
  const row = added.locator(':scope > .menu-item');
  await expect(row.locator('input')).toBeFocused();
  await row.locator('input').fill('<img src=x onerror=alert(1)> & test');
  await row.getByLabel('Strona docelowa').selectOption('/example');
  await expect(row.getByLabel('Otwórz link')).toHaveCount(0);
  await row.getByLabel('Strona docelowa').selectOption('__external__');
  await row.getByLabel('Adres zewnętrzny').fill('https://example.org/photos?view=all&sort=date');
  await expect(row.getByLabel('Otwórz link')).toHaveValue('_self');
  await row.getByLabel('Otwórz link').selectOption('_blank');
  await expect(row.locator('input').first()).toHaveValue('<img src=x onerror=alert(1)> & test');
  await expect(row.getByLabel('Strona docelowa')).toHaveValue('__external__');
  await expect(added.locator('img')).toHaveCount(0);
  await row.getByRole('button', { name: 'Dodaj element podmenu', exact: true }).click();
  const child = added.locator(':scope > .menu-children > .menu-node');
  await expect(child).toHaveCount(1);
  await expect(child.locator(':scope > .menu-item > input')).toBeFocused();
  await child.locator(':scope > .menu-item > input').fill('Nowy element submenu');
  await expect(row.locator('input').first()).toHaveValue('<img src=x onerror=alert(1)> & test');
  await page.getByRole('button', { name: 'Zapisz menu', exact: true }).click();
  await expect(page.locator('[data-menu-status]')).toHaveText('Brak niezapisanych zmian');
  await expect(roots.last().locator(':scope > .menu-item > input').first()).toHaveValue('<img src=x onerror=alert(1)> & test');
  await expect(roots.last().getByLabel('Adres zewnętrzny')).toHaveValue('https://example.org/photos?view=all&sort=date');
  await expect(roots.last().getByLabel('Otwórz link')).toHaveValue('_blank');
  await expect(roots.last().locator(':scope > .menu-children > .menu-node > .menu-item > input')).toHaveValue('Nowy element submenu');
  // Stub the destination: verify real tab behavior without contacting another site.
  await page.context().route('https://example.org/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>External destination</h1>' }));
  await page.goto('/');
  const external = page.locator('#menu a[href^="https://example.org/photos"]');
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', 'noopener noreferrer');
  const [popup] = await Promise.all([page.waitForEvent('popup'), external.click()]);
  await expect(popup.getByRole('heading')).toHaveText('External destination');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await expect(page).toHaveURL('http://127.0.0.1:3012/');
  await popup.close();
  await page.goto('/panel/menu');
  await roots.last().getByLabel('Otwórz link').selectOption('_self');
  await page.getByRole('button', { name: 'Zapisz menu', exact: true }).click();
  await expect(page.locator('[data-menu-status]')).toHaveText('Brak niezapisanych zmian');
  await expect(roots.last().getByLabel('Otwórz link')).toHaveValue('_self');
  await page.goto('/');
  await expect(external).not.toHaveAttribute('target', '_blank');
  await external.click();
  await expect(page).toHaveURL('https://example.org/photos?view=all&sort=date');
  await page.goto('http://127.0.0.1:3012/panel/menu');
  page.once('dialog', dialog => dialog.accept());
  await roots.last().locator(':scope > .menu-item').getByRole('button', { name: 'Usuń element menu', exact: true }).click();
  await expect(roots).toHaveCount(count);
  await page.getByRole('button', { name: 'Zapisz menu', exact: true }).click();
  await expect(page.locator('[data-menu-status]')).toHaveText('Brak niezapisanych zmian');
});

test('menu translations change labels without exposing structure or link controls', async ({ page }) => {
  await login(page);
  await page.goto('/panel/menu?language=en');
  await expect(page.getByLabel('Wersja językowa menu')).toHaveValue('en');
  await expect(page.locator('[data-menu-root]')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Nazwa domyślna' })).toBeVisible();
  await page.getByLabel('Tłumaczenie: Pierwsza').fill('First');
  await expect(page.locator('[data-menu-status]')).toHaveText('Niezapisane zmiany');
  await page.getByRole('button', { name: 'Zapisz tłumaczenia' }).click();
  await expect(page.locator('[data-menu-status]')).toHaveText('Brak niezapisanych zmian');
  await page.goto('/example?lang=en');
  await expect(page.getByRole('link', { name: 'First', exact: true })).toBeVisible();
  await page.goto('/example?lang=pl');
  await expect(page.getByRole('link', { name: 'Pierwsza', exact: true })).toBeVisible();
});

test('panel fits a mobile viewport and logout protects private screens', async ({ page }) => {
  await login(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/panel/menu');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Wyloguj' }).click();
  await expect(page.getByRole('button', { name: 'Zaloguj', exact: true })).toBeVisible();
  await page.goto('/panel/accounts'); await expect(page).toHaveURL(/\/panel$/);
});
