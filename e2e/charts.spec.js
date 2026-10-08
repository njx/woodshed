import { test, expect } from './app.js';

async function openTune(page, ui, name) {
  await ui.tab('tunes');
  await page.fill('#q', name);
  await page.locator('.row', { hasText: name }).first().click();
  await expect(page.locator('#f-name')).toHaveValue(name);
}

test('a tune shows its chords, written for the instrument, in any key @narrow', async ({ page, ui }) => {
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
  await expect(page.locator('.progs')).toContainText('iiø–V7–i');
  await ui.expectNoSideScroll();
  await page.screenshot({ path: test.info().outputPath('chart.png') });
  // Charts come with the app: no downloads.
  await ui.backdrop();
  await openTune(page, ui, 'Solar');
  await expect(page.locator('.chart')).toBeVisible();
});

test('charts can be edited, and put back', async ({ page, ui }) => {
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
  await expect.poll(async () => (await ui.saved()).state.items.find((t) => t.name === 'Autumn Leaves').chartEdited).toBe(true);
  await page.click('#chart-edit');
  await page.fill('#ce-text', 'A: Cm7 | Xyz');
  await page.click('#ce-save');
  await expect(page.locator('#ce-msg')).toContainText('Xyz');
  await page.click('#ce-reset');
  await expect(page.locator('.chart .bar').first()).toHaveText('Cm7');
  await expect(page.locator('.chart-foot .fine')).toContainText('iReal Pro');
});

test('a tune without a chart can get one', async ({ page, ui }) => {
  await ui.start();
  await openTune(page, ui, 'Killer Joe');
  await expect(page.locator('#chart-box')).toContainText('No chord chart');
  await page.click('#chart-add');
  await page.fill('#ce-text', 'A: C7 | % | Bb7 | % \nB: Ab7 | G7');
  await page.click('#ce-save');
  await expect(page.locator('.chart .bar')).toHaveCount(6);
  await expect(page.locator('.chart .bar.same')).toHaveCount(2);
  await expect(page.locator('.chart-foot .fine')).toHaveText('Your chart');
});

test('warm up for a tune from its chart', async ({ page, ui }) => {
  await ui.start();
  await openTune(page, ui, 'Autumn Leaves');
  await expect(page.locator('.chart')).toBeVisible();
  await page.click('#chart-warmup');
  await expect(page.locator('#toast')).toContainText('warm-ups for Autumn Leaves');
  await ui.backdrop();
  await ui.tab('today');
  const warm = page.locator('.card', { hasText: 'for Autumn Leaves' });
  await expect(warm).toHaveCount(4);
  await expect(warm.first().locator('.bucket')).toHaveText('Warm-up');
  // First, its main progression through the changes: the minor ii–V–i into G.
  await expect(warm.first().locator('h2')).toHaveText('Through the changes');
  await expect(warm.first().locator('.keychip')).toContainText('iiø–V7–i in G');
  await warm.first().locator('h2').click();
  await expect(page.locator('.sheet .fine', { hasText: 'Today:' })).toContainText('Aø7 · D7 · Gm6');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await expect(page.locator('.sheet #x-vary')).toHaveCount(0); // its chords come from the tune
  await ui.backdrop();
  // Then arpeggios: the exercise shows today's chords, even ones not turned on for it.
  await expect(warm.nth(1).locator('.keychip')).toContainText(/m6|m7|ø7|7/);
  await warm.nth(1).locator('h2').click();
  await expect(page.locator('.sheet .fine', { hasText: 'Today:' })).toContainText(/m6/);
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
});

test('exercises on a day: key of the day, or warm-ups for today’s tunes @narrow', async ({ page, ui }) => {
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
  await expect(page.locator('.day-note')).toContainText('warm-ups from its chords, just before it');
  // A tune made a focus tune gets its warm-ups too, just before it.
  await openTune(page, ui, 'Autumn Leaves');
  await page.click('.focus-toggle');
  await ui.backdrop();
  await ui.tab('today');
  const names = await page.$$eval('.card', (cs) => cs.map((c) => `${c.querySelector('.style').textContent}|${c.querySelector('h2').textContent}`));
  const at = names.findIndex((n) => n.endsWith('|Autumn Leaves'));
  expect(names.slice(at - 2, at)).toEqual([
    expect.stringMatching(/^for Autumn Leaves\|(Seventh-chord arpeggios|Scales: major and minors)$/),
    'for Autumn Leaves|Through the changes',
  ]);
  await ui.expectNoSideScroll();
});

test('“Through the changes” opened on its own explains where its chords come from', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Through the changes' }).click();
  await expect(page.locator('.sheet')).toContainText('takes its chords from a tune');
  await expect(page.locator('#x-notation')).toHaveCount(0);
});

test('chart edits save as you type; Undo changes puts it back', async ({ page, ui }) => {
  await ui.start();
  await openTune(page, ui, 'Autumn Leaves');
  await page.click('#chart-edit');
  const text = page.locator('#ce-text');
  await text.fill((await text.inputValue()).replace(/^A: (\w+)/, 'A: Cm9'));
  await expect.poll(async () => (await ui.saved()).state.items.find((t) => t.name === 'Autumn Leaves').chartEdited).toBe(true);
  await ui.backdrop(); // closing keeps it
  await expect(page.locator('.chart .bar').first()).toHaveText(/m9/);
  await page.click('#chart-edit');
  await page.fill('#ce-text', 'A: Cm7 | Xyz');
  await expect(page.locator('#ce-msg')).toContainText('Xyz');
  await page.click('#ce-revert');
  await expect(page.locator('.chart .bar').first()).toHaveText(/m9/); // as it was when opened
});
