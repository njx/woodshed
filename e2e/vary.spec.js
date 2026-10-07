import { test, expect } from './app.js';

async function openExercise(page, ui, name) {
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: name }).click();
  await expect(page.locator('#x-name')).toHaveValue(name);
}

test('a scale exercise shows each scale type, and settings change what comes up @narrow', async ({ page, ui }) => {
  await ui.start({ instruments: ['bb'] });
  await openExercise(page, ui, 'Scales: major and minors');
  await expect(page.locator('#x-vary [data-vary="scale"]')).toHaveClass(/on/);
  await expect(page.locator('.type-strip button')).toHaveText(['maj', 'dor', 'aeol', 'harm min', 'mel min', 'dim H/W']);
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await page.locator('.type-strip button', { hasText: 'harm min' }).click();
  await expect(page.locator('.type-strip button.on')).toHaveText('harm min');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await page.locator('.pattern-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('scales.png') });
  await ui.expectNoSideScroll();

  // Turn off aeolian; turn on lydian.
  await page.locator('[data-vtype="aeolian"]').click();
  await page.locator('[data-vtype="lydian"]').click();
  await expect(page.locator('.type-strip button')).toHaveText(['maj', 'dor', 'harm min', 'mel min', 'dim H/W', 'lyd']);
  await expect.poll(async () => (await ui.saved()).state.items.find((t) => t.name === 'Scales: major and minors').vary.types)
    .toEqual(['major', 'dorian', 'harmonic', 'melodic', 'dimHW', 'lydian']);

  // Patterns: presets show their numbers; changing them makes the pattern your own.
  await page.locator('[data-shape="thirds"]').click();
  await expect(page.locator('#x-pattern')).toHaveText('1 3 2 4 3 5 4 6 5 7 6 8 7 9 8');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await page.locator('[data-shape="updown"]').click();
  for (let i = 0; i < 7; i++) await page.click('[data-pn="back"]'); // drop the way down
  await expect(page.locator('#x-pattern')).toHaveText('1 2 3 4 5 6 7 8');
  await expect(page.locator('[data-shape="custom"]')).toHaveClass(/on/);
  await page.click('[data-pn="clear"]');
  await expect(page.locator('#x-pattern-msg')).toHaveText('Tap some numbers.');
  for (const n of ['1', '2', '3', '5', '8']) await page.click(`[data-pn="${n}"]`);
  await expect(page.locator('#x-pattern')).toHaveText('1 2 3 5 8');
  await expect(page.locator('#x-pattern-msg')).not.toHaveClass(/error/);
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await ui.expectNoSideScroll();
  await expect.poll(async () => (await ui.saved()).state.items.find((t) => t.name === 'Scales: major and minors').vary)
    .toMatchObject({ shape: 'custom', pattern: '1 2 3 5 8' });
});

test('chord types; a written exercise can be switched to vary @narrow', async ({ page, ui }) => {
  await ui.start();
  await openExercise(page, ui, 'Seventh-chord arpeggios');
  await expect(page.locator('.type-strip button')).toHaveText(['maj7', 'm7', '7', 'ø7', '°7']);
  await expect(page.locator('[data-shape]')).toHaveText(['Up and down', 'Two octaves', 'Inversions', 'My own']);
  await expect(page.locator('#x-pattern')).toHaveText('1 3 5 7 8 7 5 3 1');
  await expect(page.locator('[data-pn]')).toHaveText(['1', '3', '5', '7', '8', '10', '12', '14', '15', '⌫', 'Clear']);
  await page.locator('.type-strip button', { hasText: '°7' }).click();
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('chords.png') });
  await ui.backdrop();

  // "Major scale" is written out; switching it to vary by scale uses generated notation.
  await page.locator('#tune-list .row', { hasText: 'Major scale' }).click();
  await expect(page.locator('#x-edit-abc')).toHaveCount(1);
  await page.click('#x-vary [data-vary="scale"]');
  await expect(page.locator('#x-edit-abc')).toHaveCount(0);
  await page.click('#x-to-pattern');
  await expect(page.locator('.pattern-card')).toBeInViewport();
  await expect(page.locator('.type-strip button')).toHaveCount(6);
  await page.click('#x-vary [data-vary=""]');
  await expect(page.locator('.type-strip')).toHaveCount(0);
  await expect(page.locator('#x-edit-abc')).toHaveCount(1); // its own notation is still there
});

test('today’s card names the scale or chord for each key, and the log keeps it @narrow', async ({ page, ui }) => {
  await ui.start();
  // Put the scales exercise in today's set as a focus item.
  await openExercise(page, ui, 'Scales: major and minors');
  await page.click('.focus-toggle');
  await ui.backdrop();
  await ui.tab('today');
  const card = page.locator('.card', { hasText: 'Scales: major and minors' });
  await expect(card.locator('.keychip')).toContainText(/In [A-G][♭♯]? (maj|dor|aeol|harm min|mel min|dim H\/W) · /);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('card.png') });
  const chip = await card.locator('.keychip span').first().textContent();
  await card.locator('.check').click();
  await expect.poll(async () => (await ui.saved()).state.log.find((e) => e.types)?.types.length).toBe(3);
  await card.locator('h2').click();
  await expect(page.locator('.sheet .fine', { hasText: 'Today:' })).toContainText(chip.replace(/^In /, ''));
  await expect(page.locator('.history-list li').first()).toContainText(chip.replace(/^In /, ''));
  await ui.expectNoSideScroll();
});
