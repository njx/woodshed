import { test, expect } from './app.js';

test('first run picks instruments and builds a set @narrow', async ({ page, ui }) => {
  await page.goto('./');
  await expect(page.locator('.welcome')).toBeVisible();
  await page.click('.welcome .chip[data-ins="bb"]');
  await page.click('#ins-done');
  await expect(page.locator('.welcome')).toHaveCount(0);
  // Two exercises up top, then the tunes (1 hone, 2 learn, 1 new, mixed up); no warm-ups till asked for.
  await expect(page.locator('.card:not(.b-exercise)')).toHaveCount(4);
  const buckets = await page.$$eval('.card .bucket', (bs) => bs.map((b) => b.textContent));
  expect(buckets).toHaveLength(6);
  expect(buckets.slice(0, 2)).toEqual(['Exercise', 'Exercise']);
  expect(buckets).not.toContain('Warm-up');
  await expect(page.locator('#transpose')).toContainText('B♭');
  await ui.expectNoSideScroll();
});

test('swipe right marks played; swipe left to swap @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.swipe(page.locator('.card').first(), 160);
  await expect(page.locator('.card.done')).toHaveCount(1);
  await expect(page.locator('.ring')).toHaveAttribute('aria-label', /^1 of \d+ played/);

  const before = (await ui.cardTitles())[1];
  await ui.swipe(page.locator('.card').nth(1), -120);
  await page.locator('.card-wrap').nth(1).locator('.sa-swap').click();
  await expect.poll(async () => (await ui.cardTitles())[1]).not.toBe(before);
  // Undo puts it back.
  await page.click('#toast button');
  await expect.poll(async () => (await ui.cardTitles())[1]).toBe(before);
});

test('a short swipe left shows Swap and Remove on every card; a long one removes @narrow', async ({ page, ui }) => {
  await ui.start();
  // An exercise: take it out for today.
  const first = page.locator('.card').first();
  const name = await first.locator('h2').textContent();
  await ui.swipe(first, -120);
  const wrap = page.locator('.card-wrap').first();
  await expect(wrap).toHaveClass(/\bopen\b/);
  await expect(wrap.locator('.swipe-actions button')).toHaveText(['Swap', 'Remove']);
  await page.screenshot({ path: test.info().outputPath('actions.png') });
  // Tapping the card closes it again.
  const box = await wrap.boundingBox();
  await page.mouse.click(box.x + 30, box.y + 40); // the part of the card still showing
  await expect(wrap).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('.sheet')).toHaveCount(0);
  await ui.swipe(first, -120);
  await wrap.locator('.sa-remove').click();
  await expect(page.locator('.card h2', { hasText: name })).toHaveCount(0);

  // A warm-up: swap it for another, or remove it.
  await page.locator('[data-add-warm]').first().click();
  const warm = page.locator('.card', { has: page.locator('.bucket', { hasText: 'Warm-up' }) }).first();
  const forTune = await warm.locator('.style').textContent();
  const was = `${await warm.locator('h2').textContent()}|${await warm.locator('.keychip').textContent()}`;
  await ui.swipe(warm, -120);
  const wwrap = warm.locator('xpath=..');
  await expect(wwrap.locator('.swipe-actions button')).toHaveText(['Swap', 'Remove']);
  await wwrap.locator('.sa-swap').click();
  const now = page.locator('.card').filter({ hasText: forTune }).first();
  await expect.poll(async () => `${await now.locator('h2').textContent()}|${await now.locator('.keychip').textContent()}`).not.toBe(was);
  const count = await page.locator('.card').filter({ hasText: forTune }).count();
  await ui.swipe(page.locator('.card').filter({ hasText: forTune }).first(), -280); // a long swipe removes
  await expect(page.locator('.card').filter({ hasText: forTune })).toHaveCount(count - 1);
  await expect(page.locator('#toast')).toContainText('Took out');
  await ui.expectNoSideScroll();
});

test('rating a played tune is saved', async ({ page, ui }) => {
  await ui.start();
  const card = page.locator('.card:not(.b-exercise)').first();
  const id = await card.getAttribute('data-item-id');
  await card.locator('.check').click();
  await card.locator('.rating button[data-v="solid"]').click();
  await expect.poll(async () => (await ui.saved()).state.log.find((e) => e.itemId === id)?.rating).toBe('solid');
});

test('focus tunes lead the set; recordings and listening links', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.fill('#q', 'giant steps');
  await page.locator('.row').first().click();
  await page.click('.focus-toggle');
  // Add a recording, then remove it.
  await page.click('#rec-add-toggle');
  await page.fill('#rec-form input[name=artist]', 'Tommy Flanagan');
  await page.fill('#rec-form input[name=album]', 'Giant Steps');
  await page.click('#rec-form button');
  await expect(page.locator('.recordings li:not(.rec-more) b')).toContainText(['Tommy Flanagan']);
  const count = await page.locator('.recordings li:not(.rec-more)').count();
  await page.click('.recordings [data-rm="0"]');
  await expect(page.locator('.recordings li:not(.rec-more)')).toHaveCount(count - 1);
  // The listening service is chosen in Settings.
  await page.click('#listen-service');
  await expect(page.locator('.tab[data-tab="settings"]')).toHaveClass(/\bon\b/);
  await page.click('.seg[data-setting="listen"] button[data-v="spotify"]');

  await ui.tab('today');
  await expect(page.locator('.card:not(.b-exercise) .bucket').first()).toHaveText('Focus');
  await page.locator('.card h2', { hasText: 'Giant Steps' }).click();
  await expect(page.locator('.recordings a').first()).toHaveAttribute('href', /spotify\.com/);
});

test('every tab fits the screen @narrow', async ({ page, ui }) => {
  await ui.start({ instruments: ['bb'] });
  for (const t of ['today', 'tunes', 'diary', 'progress', 'settings']) {
    await ui.tab(t);
    await ui.expectNoSideScroll();
  }
});

test('works offline once loaded', async ({ page, context, ui }) => {
  await ui.start();
  const titles = await ui.cardTitles();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // now controlled by the service worker
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(titles.length);
  await context.setOffline(false);
});

test('picks up data from the first version of the app', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('woodshed.v1') || sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('woodshed.v1', JSON.stringify({
      version: 1,
      tunes: [{ id: 'a', name: 'Solar', style: 'Jazz Standard', priority: 1, level: 2, keys: [12], notes: 'watch the bridge', focus: true, ivl: 4, due: '2026-10-08' }],
      log: [{ id: 'e1', date: '2026-10-04', tuneId: 'a', key: 12, rating: 'solid', prev: {} }],
      plan: null,
      settings: { instruments: ['bb', 'c'], view: 'bb', instrumentsChosen: true },
    }));
  });
  await page.goto('./');
  await expect(page.locator('.welcome')).toHaveCount(0);
  // A returning player: today's welcome, with the focus tune.
  await expect(page.locator('.greet-plan')).toContainText('Focus on Solar');
  await page.click('#greet-skip');
  await expect(page.locator('.card h2', { hasText: 'Solar' })).toBeVisible();
  await page.locator('.card h2', { hasText: 'Solar' }).click();
  await expect(page.locator('#f-notes')).toHaveValue('watch the bridge');
  await expect(page.locator('#f-focus')).toBeChecked();
});

test('tune order: mixed by default, or by group from Settings (applies to today)', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('settings');
  await expect(page.locator('.seg[data-setting="tuneOrder"] .on')).toHaveText('Mixed');
  await page.click('.seg[data-setting="tuneOrder"] [data-v="group"]');
  await ui.tab('today');
  const buckets = await page.$$eval('.card:not(.b-exercise) .bucket', (b) => b.map((x) => x.textContent));
  const rank = { Focus: 0, Hone: 1, Learn: 2, New: 3 };
  expect(buckets.map((b) => rank[b])).toEqual([...buckets.map((b) => rank[b])].sort());
});
