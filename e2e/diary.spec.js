import { test, expect } from './app.js';

test('notes, to-dos and the diary @narrow', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card .check').first().click();

  // A note from Today, flagged Remember, saved by tapping outside.
  await page.click('#today-note');
  await page.fill('#n-text', 'Long tones before tunes — 5 min');
  await page.click('[data-flag="remember"]');
  await ui.backdrop();
  await expect(page.locator('.remember .note p')).toHaveText(['Long tones before tunes — 5 min']);

  // A note about a tune, from its details: comes back to the tune.
  await page.locator('.card:not(.b-exercise) h2').nth(1).click();
  const tune = await page.locator('#f-name').inputValue();
  await page.click('#add-tune-note');
  await expect(page.locator('#n-tune')).toHaveValue(tune);
  await page.fill('#n-text', 'Ask about the turnaround in bar 8');
  await page.click('[data-flag="teacher"]');
  await page.click('#n-save');
  await expect(page.locator('#f-name')).toHaveValue(tune);
  await expect(page.locator('.sheet .note p')).toContainText(['Ask about the turnaround in bar 8']);
  await ui.backdrop();

  // The diary: today's played items and notes; filter to teacher questions.
  await ui.tab('diary');
  await expect(page.locator('.played span').first()).toBeVisible();
  await page.click('[data-df="teacher"]');
  await expect(page.locator('#share-todos')).toHaveCount(1);
  await page.locator('.panel-list [data-done]').first().click();
  await expect(page.locator('.note.done p')).toContainText(['Ask about the turnaround in bar 8']);

  // Edit a note; closing saves it.
  await page.locator('.note.done').first().click();
  await page.fill('#n-text', 'Asked — use the side B♭ key');
  await ui.backdrop();
  await expect(page.locator('.note p', { hasText: 'side B♭ key' })).toHaveCount(1);

  // Tick off the Remember item from Today.
  await ui.tab('today');
  await page.locator('.remember [data-done]').click();
  await expect(page.locator('.remember')).toHaveCount(0);
  await ui.expectNoSideScroll();
});

test('notes made from an exercise stay linked to it', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card.b-exercise h2').first().click();
  const name = await page.locator('#x-name').inputValue();
  await page.click('#x-note');
  await expect(page.locator('#n-tune')).toHaveValue(name);
  await page.fill('#n-text', 'Even eighths');
  await page.click('#n-save');
  // Back on the exercise, with the note listed.
  await expect(page.locator('#x-name')).toHaveValue(name);
  await expect(page.locator('.sheet .note p')).toContainText(['Even eighths']);
  await expect.poll(async () => {
    const { state } = await ui.saved();
    return state.diary.find((e) => e.text === 'Even eighths')?.itemId === state.items.find((t) => t.name === name).id;
  }).toBe(true);
});
