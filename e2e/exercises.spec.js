import { test, expect } from './app.js';

test('an exercise shows notation in today’s keys and plays', async ({ page, ui }) => {
  await ui.start({ instruments: ['bb'] });
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Major scale' }).click();
  await expect(page.locator('#x-name')).toHaveValue('Major scale');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  // Pick another key to preview.
  await page.locator('.key-strip button').nth(5).click();
  await expect(page.locator('.key-strip .on')).toHaveCount(1);
  await page.click('#x-play');
  await expect(page.locator('#x-play span')).toHaveText('Stop');
  await page.click('#x-play');
  await expect(page.locator('#x-play span')).toHaveText('Play');
});

test('write a new exercise with the keypad', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  const count = await page.locator('#tune-list .row').count();
  await page.click('#add');
  await page.fill('#x-name', 'Cannonball lick');
  await page.click('[data-cat="lick"]');
  await page.click('[data-mode="fixed"]');
  await page.click('[data-fixed="0"]');
  await page.click('[data-fixed="5"]');
  await page.click('#x-save');
  await expect(page.locator('#tune-list .row')).toHaveCount(count + 1);

  await page.locator('#tune-list .row', { hasText: 'Cannonball lick' }).click();
  await page.click('#x-add-abc');
  const tap = (sel) => page.click(`#ne-pad ${sel}`);
  await tap('[data-dur="quarter"]'); await tap('[data-note="G"]');
  await tap('[data-dur="eighth"]'); await tap('[data-acc="_"]'); await tap('[data-note="B"]'); await tap('[data-note="A"]');
  await tap('[data-oct="1"]'); await tap('[data-note="C"]');
  await tap('[data-ins=" | "]');
  await tap('[data-oct="-1"]'); await tap('[data-dur="half"]'); await tap('[data-dot]'); await tap('[data-note="G"]');
  await tap('[data-dur="quarter"]'); await tap('[data-rest]');
  await tap('[data-back]'); await tap('[data-rest]');
  // Quarter G, eighths B♭ A and high C; dotted half G, quarter rest (lengths in eighths).
  await expect(page.locator('#ne-abc')).toHaveValue('G2_BAc | G6z2');
  await expect(page.locator('#ne-preview svg').first()).toBeVisible();
  await page.click('#ne-save');
  // Back on the exercise, with its notation, saved with its two fixed keys.
  await expect(page.locator('#x-name')).toHaveValue('Cannonball lick');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await expect.poll(async () => {
    const ex = (await ui.saved()).state.items.find((t) => t.name === 'Cannonball lick');
    return { keyMode: ex.keyMode, keys: ex.keys, abc: ex.abc };
  }).toEqual({ keyMode: 'fixed', keys: [0, 5], abc: 'G2_BAc | G6z2' });
});

test('playing an exercise counts toward the keys chart', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card.b-exercise .check').first().click();
  await ui.tab('progress');
  await expect(page.locator('.keybar')).toHaveCount(12);
  await expect.poll(() => page.$$eval('.kb-fill', (x) => x.filter((e) => parseFloat(e.style.height) > 5).length)).toBeGreaterThan(0);
});
