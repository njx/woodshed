import fs from 'node:fs';
import { test, expect } from './app.js';

// Chord charts are downloaded from GitHub; tests serve a few tunes from a local copy.
const STANDARDS = fs.readFileSync(new URL('./fixtures/standards.json', import.meta.url));
async function serveCharts(page, { fail = false } = {}) {
  let requests = 0;
  await page.unroute('https://raw.githubusercontent.com/**');
  await page.route('https://raw.githubusercontent.com/**', (r) => {
    requests++;
    return fail ? r.abort() : r.fulfill({ status: 200, contentType: 'application/json', body: STANDARDS });
  });
  return () => requests;
}
async function openTune(page, ui, name) {
  await ui.tab('tunes');
  await page.fill('#q', name);
  await page.locator('.row', { hasText: name }).first().click();
  await expect(page.locator('#f-name')).toHaveValue(name);
}

test('a tune shows its chords, written for the instrument, in any key @narrow', async ({ page, ui }) => {
  const requests = await serveCharts(page);
  await ui.start({ instruments: ['bb'] });
  await openTune(page, ui, 'Autumn Leaves');
  const chart = page.locator('.chart');
  await expect(chart).toBeVisible();
  // In G minor concert (its usual key), written a step up for B♭: Dm7 | G7 | Cmaj7 …
  await page.selectOption('#chart-key', '19');
  await expect(chart.locator('.bar').first()).toHaveText('Dm7');
  await expect(chart.locator('.bar').nth(2)).toHaveText('Cmaj7');
  await expect(chart.locator('.chart-label').first()).toHaveText('A');
  // Another key: E minor concert, written F♯ minor.
  await page.selectOption('#chart-key', '16');
  await expect(chart.locator('.bar').first()).toHaveText('Bm7');
  await expect(page.locator('.chart-foot .fine')).toContainText('iReal Pro');
  await ui.expectNoSideScroll();
  await page.screenshot({ path: test.info().outputPath('chart.png') });
  // Downloaded once, then kept.
  await ui.backdrop();
  await openTune(page, ui, 'Solar');
  await expect(page.locator('.chart')).toBeVisible();
  expect(requests()).toBe(1);
});

test('charts can be edited, and put back', async ({ page, ui }) => {
  await serveCharts(page);
  await ui.start();
  await openTune(page, ui, 'Autumn Leaves');
  await page.selectOption('#chart-key', '19');
  await page.click('#chart-edit');
  const text = page.locator('#ce-text');
  await expect(text).toHaveValue(/^A: Cm7 \| F7 \| Bbmaj7/);
  await text.fill((await text.inputValue()).replace(/^A: Cm7/, 'A: Cm9'));
  await page.click('#ce-save');
  await expect(page.locator('#f-name')).toHaveValue('Autumn Leaves');
  await expect(page.locator('.chart .bar').first()).toHaveText('Cm9');
  await expect(page.locator('.chart-foot .fine')).toHaveText('Your chart');
  await page.click('#chart-edit');
  await page.fill('#ce-text', 'A: Cm7 | Xyz');
  await page.click('#ce-save');
  await expect(page.locator('#ce-msg')).toContainText('Xyz');
  await page.click('#ce-reset');
  await expect(page.locator('.chart .bar').first()).toHaveText('Cm7');
});

test('a tune without a chart can get one; a failed download can be retried', async ({ page, ui }) => {
  await serveCharts(page, { fail: true });
  await ui.start();
  await openTune(page, ui, 'Killer Joe');
  await expect(page.locator('#chart-box')).toContainText('Couldn’t download');
  await serveCharts(page);
  await page.click('#chart-retry');
  await expect(page.locator('#chart-box')).toContainText('no chart for this tune');
  await page.click('#chart-add');
  await page.fill('#ce-text', 'A: C7 | % | Bb7 | % \nB: Ab7 | G7');
  await page.click('#ce-save');
  await expect(page.locator('.chart .bar')).toHaveCount(6);
  await expect(page.locator('.chart .bar.same')).toHaveCount(2);
});

test('warm up for a tune from its chart', async ({ page, ui }) => {
  await serveCharts(page);
  await ui.start();
  await openTune(page, ui, 'Autumn Leaves');
  await expect(page.locator('.chart')).toBeVisible();
  await page.click('#chart-warmup');
  await expect(page.locator('#toast')).toContainText('warm-ups for Autumn Leaves');
  await ui.backdrop();
  await ui.tab('today');
  const warm = page.locator('.card', { hasText: 'for Autumn Leaves' });
  await expect(warm).toHaveCount(3);
  await expect(warm.first().locator('.bucket')).toHaveText('Warm-up');
  await expect(warm.first().locator('.keychip')).toContainText(/m6|m7|ø7|7/);
  // The exercise shows today's chords, even ones not turned on for it.
  await warm.first().locator('h2').click();
  await expect(page.locator('.sheet .fine', { hasText: 'Today:' })).toContainText(/m6/);
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
});

test('exercises on a day: key of the day, or warm-ups for today’s tunes @narrow', async ({ page, ui }) => {
  await serveCharts(page);
  await ui.start();
  await ui.tab('settings');
  await page.click('#ex-focus [data-v="day"]');
  await ui.tab('today');
  await expect(page.locator('.day-note')).toContainText('of the day');
  const dayKeys = (await page.locator('.day-note b').textContent()).split(' · ');
  expect(dayKeys.length).toBeGreaterThan(0);
  // Weak-key exercises use only the keys of the day (others, like cycle of 4ths, keep theirs).
  await expect.poll(async () => (await ui.saved()).state.plan?.dayKeys?.length).toBeGreaterThan(0);
  const { state } = await ui.saved();
  for (const it of state.plan.items.filter((i) => i.bucket === 'exercise')) {
    const ex = state.items.find((x) => x.id === it.itemId);
    if (['weak', 'random'].includes(ex.keyMode)) expect(state.plan.dayKeys).toEqual(expect.arrayContaining(it.keys));
  }

  await ui.tab('settings');
  await page.click('#ex-focus [data-v="tunes"]');
  await ui.tab('today');
  // None of today's tunes is among the few charts served here.
  await expect(page.locator('.day-note')).toContainText('picked as usual');
  // A focus tune with a chart gets the warm-ups.
  await openTune(page, ui, 'Autumn Leaves');
  await page.click('.focus-toggle');
  await ui.backdrop();
  await ui.tab('settings');
  await page.click('#ex-focus [data-v="own"]');
  await page.click('#ex-focus [data-v="tunes"]');
  await ui.tab('today');
  await expect(page.locator('.day-note')).toContainText('warm up for Autumn Leaves');
  await expect(page.locator('.card .bucket', { hasText: 'Warm-up' }).first()).toBeVisible();
  await ui.expectNoSideScroll();
});
