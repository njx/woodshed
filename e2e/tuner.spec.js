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

test('the mini tuner stays on screen while you go through the set, and stops with × @narrow', async ({ page, ui }) => {
  await ui.start({ instruments: ['bb'] });
  await page.click('#today-tuner');
  await page.click('#t-mini');
  const pill = page.locator('.tuner-pill');
  await expect(pill).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(0);
  // It keeps listening: a written C (concert B♭) or E (concert D) from the fake mic.
  await expect(pill.locator('.tp-note')).toHaveText(/^[CE]$/, { timeout: 10000 });
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath('mini.png') });
  // The header and the tools stay put, above the tab bar; the pill sits above the tools.
  await expect(page.locator('.today-top h1')).toBeInViewport();
  const tools = await page.locator('.today-tools').boundingBox();
  const p = await pill.boundingBox();
  expect(p.y + p.height).toBeLessThanOrEqual(tools.y);
  // Tap for the full tuner (still listening); close it to stop.
  await pill.locator('.tp-open').click();
  await expect(page.locator('#t-dial')).toBeVisible();
  await expect(pill).toBeHidden();
  await page.click('#t-mini');
  await pill.locator('.tp-stop').click();
  await expect(pill).toBeHidden();
  await ui.expectNoSideScroll();
});
