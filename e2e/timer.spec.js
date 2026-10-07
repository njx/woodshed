import { test, expect } from './app.js';

test('practice timer: start, end with undo, and it shows on Progress', async ({ page, ui }) => {
  await ui.start();
  const bar = page.locator('.ptimer');
  await expect(bar).toContainText('Practice timer');
  await page.click('#pt-start');
  await expect(bar).toContainText('Practicing');
  await expect(page.locator('#pt-clock')).toHaveText(/^0:0[1-9]$/); // it ticks
  await page.click('#pt-end');
  await expect(bar).toContainText(/Practiced <1 min today/);
  await page.click('#toast button'); // Undo
  await expect(bar).toContainText('Practicing');
  await expect.poll(async () => (await ui.saved()).state.timing).not.toBe(null);
  await ui.tab('progress');
  await expect(page.locator('.tile', { hasText: 'in last 7 days' })).toContainText('0 min');
  await expect(page.locator('.sessions li').first()).toContainText('<1 min');
});

test('marking something played starts the timer', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card .check').first().click();
  await expect(page.locator('.ptimer')).toContainText('Practicing');
});

test('after the app was closed a while, the timer has stopped, and the time away can be counted @narrow', async ({ page, ui }) => {
  await ui.start();
  await page.click('#pt-start');
  await expect.poll(async () => (await ui.saved()).state.timing).not.toBe(null);
  // As if the app was last seen 40 minutes ago, 10 minutes into practice.
  await ui.editSaved((s) => {
    const x = s.sessions[0];
    x.end = Date.now() - 40 * 60000;
    x.start = x.end - 10 * 60000;
  });
  await page.reload();
  const bar = page.locator('.ptimer');
  await expect(bar).toContainText(/10 min today\. The timer stopped at .*, when the app was closed/);
  await ui.expectNoSideScroll();
  await page.click('#pt-away');
  await expect(bar).toContainText('Practicing');
  await expect(page.locator('#pt-clock')).toHaveText(/^50:/);
});
