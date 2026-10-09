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

test('warm up for a tune from its chart, or with + Warm-up on its card', async ({ page, ui }) => {
  await ui.start();
  await expect(page.locator('.card .bucket', { hasText: 'Warm-up' })).toHaveCount(0); // none by itself
  await openTune(page, ui, 'Autumn Leaves');
  await expect(page.locator('.chart')).toBeVisible();
  await page.click('#chart-warmup');
  await expect(page.locator('#toast')).toContainText('warm-up for Autumn Leaves');
  await ui.backdrop();
  await ui.tab('today');
  const warm = page.locator('.card', { hasText: 'for Autumn Leaves' });
  await expect(warm).toHaveCount(1);
  await expect(warm.first().locator('.bucket')).toHaveText('Warm-up');
  // First, the written ii–V–I pattern over the tune's major ii–V–I, in B♭.
  await expect(warm.first().locator('h2')).toHaveText('ii–V–I, 1-2-3-5');
  await expect(warm.first().locator('.keychip')).toContainText('ii–V7–I in B♭');
  await warm.first().locator('h2').click();
  await expect(page.locator('.sheet .fine', { hasText: 'Today:' })).toContainText('over ii–V7–I in B♭');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await ui.backdrop();
  // + Warm-up on the tune's card adds the next: arpeggios on its chords, just before the tune.
  await page.locator('.card', { has: page.locator('h2', { hasText: /^Autumn Leaves$/ }) }).locator('[data-add-warm]').click();
  await expect(warm).toHaveCount(2);
  await expect(warm.nth(1).locator('h2')).toHaveText('Seventh-chord arpeggios');
  await expect(warm.nth(1).locator('.keychip')).toContainText(/m6|m7|ø7|7/);
  await warm.nth(1).locator('h2').click();
  await expect(page.locator('.sheet .fine', { hasText: 'Today:' })).toContainText(/m6/);
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await ui.backdrop();
  // A third: through its changes, with a walking bass to play against.
  await page.locator('.card', { has: page.locator('h2', { hasText: /^Autumn Leaves$/ }) }).locator('[data-add-warm]').click();
  const changes = warm.filter({ hasText: 'Through the changes' });
  await changes.locator('h2').click();
  await page.click('#x-bass');
  await expect(page.locator('#x-bass')).toHaveClass(/\bon\b/);
  await page.click('#x-bass');
  await expect(page.locator('#x-bass')).not.toHaveClass(/\bon\b/);
});

test('a walking bass loops through the chart, lighting up the bar it’s on, and stops when the sheet closes', async ({ page, ui }) => {
  await ui.start();
  await openTune(page, ui, 'Autumn Leaves');
  await page.click('#chart-bass');
  await expect(page.locator('#chart-bass')).toHaveClass(/\bon\b/);
  await expect(page.locator('.chart .bar.now')).toHaveCount(1);
  const first = await page.locator('.chart .bar.now').getAttribute('data-b');
  await expect.poll(async () => page.locator('.chart .bar.now').getAttribute('data-b'), { timeout: 8000 }).not.toBe(first); // moves on
  await page.click('#chart-bass');
  await expect(page.locator('.chart .bar.now')).toHaveCount(0);
  await page.click('#chart-bass');
  await ui.backdrop();
  await openTune(page, ui, 'Autumn Leaves');
  await expect(page.locator('#chart-bass')).not.toHaveClass(/\bon\b/);
});

test('exercises on a day: each its own, or key of the day @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('settings');
  await expect(page.locator('#ex-focus button')).toHaveCount(2);
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
