import { test, expect } from './app.js';

// The fake microphone plays concert B♭3 8 cents sharp, then a D4 sagging from in tune to 25 cents
// flat (see tone.js).
test('the tuner names notes as written and follows the pitch @narrow', async ({ page, ui }) => {
  await ui.start({ instruments: ['bb'] });
  await page.click('#today-tuner');
  await expect(page.locator('.sheet .eyebrow')).toContainText('B♭ instrument');

  const seen = new Set();
  for (let i = 0; i < 45; i++) {
    seen.add(`${await page.locator('#t-note').innerText()} | ${await page.locator('#t-cents').textContent()}`.replace(/\s+/g, ' '));
    await page.waitForTimeout(150);
  }
  const readings = [...seen];
  // B♭ concert is a written C on a B♭ instrument; 8 cents sharp (±2).
  expect(readings.some((r) => /^C concert B♭3 \| \+([6-9]|10) cents sharp$/.test(r))).toBe(true);
  // D concert is a written E; it starts in tune and goes flat.
  expect(readings.some((r) => /^E concert D4 \| In tune$/.test(r))).toBe(true);
  expect(readings.some((r) => /^E concert D4 \| −(1[5-9]|2\d) cents flat$/.test(r))).toBe(true);
  await ui.expectNoSideScroll();

  // Reference pitch is adjustable and remembered.
  await page.click('[data-a4="1"]');
  await expect(page.locator('#t-a4')).toHaveText('441');
  await ui.backdrop();
  await expect.poll(async () => (await ui.saved()).state.settings.a4).toBe(441);
});

test('concert view shows octaves', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-tuner');
  await expect(page.locator('#t-note')).toHaveText(/^(B♭3|D4)$/, { timeout: 10_000 });
});
