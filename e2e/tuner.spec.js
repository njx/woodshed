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

test('the mini tuner: its circle on Today shows the note; a pill elsewhere; × stops it @narrow', async ({ page, ui }) => {
  await ui.start({ instruments: ['bb'] });
  await page.click('#today-tuner');
  await page.click('#t-mini');
  await expect(page.locator('.sheet')).toHaveCount(0);
  // On Today, the tuner's circle keeps listening: a written C (concert B♭) or E (concert D).
  const circle = page.locator('#today-tuner');
  await expect(circle).toHaveClass(/\blive\b/);
  await expect(circle.locator('.hd-live')).toHaveText(/^[CE]$/, { timeout: 10000 });
  await expect(page.locator('.tuner-pill')).toBeHidden();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  await expect(circle).toBeInViewport(); // the header stays
  await page.screenshot({ path: test.info().outputPath('mini.png') });
  // Elsewhere, a pill.
  await ui.tab('progress');
  const pill = page.locator('.tuner-pill');
  await expect(pill.locator('.tp-note')).toHaveText(/^[CE]$/, { timeout: 10000 });
  // Tap for the full tuner (still listening); Mini again, then × stops it.
  await pill.locator('.tp-open').click();
  await expect(page.locator('#t-dial')).toBeVisible();
  await expect(pill).toBeHidden();
  await page.click('#t-mini');
  await pill.locator('.tp-stop').click();
  await expect(pill).toBeHidden();
  await ui.tab('today');
  await expect(circle).not.toHaveClass(/\blive\b/);
  await ui.expectNoSideScroll();
});

test('the metronome’s circle shows the tempo while it runs', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-metro');
  await page.click('#m-go');
  await ui.backdrop();
  await expect(page.locator('#today-metro .hd-live')).toHaveText(/^\d+$/);
  await expect(page.locator('.metro-pill')).toBeHidden();
  // It flashes on the beat (briefly: watch it for a couple of seconds).
  const flashed = await page.evaluate(() => new Promise((resolve) => {
    const end = performance.now() + 2500;
    const look = () => {
      if (document.getElementById('today-metro')?.classList.contains('beat')) return resolve(true);
      if (performance.now() > end) return resolve(false);
      requestAnimationFrame(look);
    };
    look();
  }));
  expect(flashed).toBe(true);
});

test('the tuner circle shows sharp (an arc on top) and flat (underneath)', async ({ page, ui }) => {
  await ui.start({ instruments: ['bb'] });
  await page.click('#today-tuner');
  await page.click('#t-mini');
  const circle = page.locator('#today-tuner');
  // The fake mic: B♭ 8 cents sharp, then a D sagging to 25 cents flat.
  const shot = async (cls, name) => {
    await expect(circle).toHaveClass(new RegExp(`\\b${cls}\\b`), { timeout: 10000 });
    const b = await circle.boundingBox();
    await page.screenshot({ path: test.info().outputPath(`${name}.png`), clip: { x: b.x - 14, y: b.y - 14, width: b.width + 28, height: b.height + 28 } });
    return circle.getAttribute('aria-label');
  };
  expect(await shot('sharp', 'sharp')).toMatch(/cents sharp$/);
  expect(await shot('flat', 'flat')).toMatch(/cents flat$/);
  await page.click('#today-tuner'); // the full tuner; closing it stops listening
  await ui.backdrop();
});
