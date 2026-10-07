import { test, expect } from './app.js';

test('a practice day runs until 4am', async ({ page, ui }) => {
  // Fixed wall-clock time; timers (the save delay) keep running.
  await page.clock.setFixedTime(new Date(2026, 9, 7, 23, 50));
  await ui.start();
  const evening = await ui.cardTitles();
  await page.locator('.card .check').first().click();
  await expect.poll(async () => (await ui.saved()).state.log.length).toBe(1);

  // Half past midnight: still the same set, and what was played is still played.
  await page.clock.setFixedTime(new Date(2026, 9, 8, 0, 30));
  await page.reload();
  expect(await ui.cardTitles()).toEqual(evening);
  await expect(page.locator('.card.done')).toHaveCount(1);

  // After 4am: a new day's set.
  await page.clock.setFixedTime(new Date(2026, 9, 8, 4, 30));
  await page.reload();
  await expect(page.locator('.card.done')).toHaveCount(0);
  expect(await ui.cardTitles()).not.toEqual(evening);
});

test('if saved data can’t be read, it offers to retry instead of starting over', async ({ page, ui, pageErrors }) => {
  pageErrors.allow(/Could not load saved data|boom/);
  await ui.start();
  await page.locator('.card .check').first().click();
  await expect.poll(async () => (await ui.saved()).state.log.length).toBe(1);

  await page.addInitScript(() => { IDBObjectStore.prototype.get = () => { throw new Error('boom'); }; });
  await page.reload();
  await expect(page.locator('.load-error')).toContainText('Couldn’t open your practice data');

  // A fresh page (without the failure) still has the data.
  const fresh = await page.context().newPage();
  await fresh.goto('./');
  await expect(fresh.locator('.card.done')).toHaveCount(1);
});

test('the 5-second Undo doesn’t apply once something else has changed', async ({ page, ui }) => {
  await ui.start();
  const before = (await ui.cardTitles())[1];
  await ui.swipe(page.locator('.card').nth(1), -160); // swap, with Undo offered
  const swapped = (await ui.cardTitles())[1];
  expect(swapped).not.toBe(before);
  await page.locator('.card .check').first().click(); // then practice something
  await page.click('#toast button');
  await expect(page.locator('#toast')).toContainText('Can’t undo');
  expect((await ui.cardTitles())[1]).toBe(swapped);
  await expect(page.locator('.card.done')).toHaveCount(1);
});
