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

test('a note ticked Done stays done when its flag changes @narrow', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-note');
  await page.fill('#n-text', 'Learn the bridge of Stella');
  await page.click('[data-flag="remember"]');
  await page.click('#n-save');
  await page.locator('.remember .note').first().click();
  await page.check('#n-done');
  await page.click('[data-flag="teacher"]');
  await expect(page.locator('#n-done')).toBeChecked();
  await page.click('#n-save');
  await expect.poll(async () => (await ui.saved()).state.diary.find((e) => e.text === 'Learn the bridge of Stella')).toMatchObject({ flag: 'teacher', done: true });
});

test('a lesson: logged for a day, with its time; the day counts toward the streak and in Progress @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('diary');
  await page.click('[data-df="lesson"]');
  await expect(page.locator('.empty')).toContainText('counts as a practice day');
  await page.click('#add-lesson');
  await expect(page.locator('#n-lesson')).toHaveAttribute('aria-pressed', 'true');
  const yesterday = await page.evaluate(() => { const d = new Date(Date.now() - 864e5 - 4 * 36e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.fill('#n-day', yesterday);
  await page.fill('#n-minutes', '45');
  await page.fill('#n-text', 'ii–V licks in all keys; Body and Soul bridge');
  await ui.expectNoSideScroll();
  await page.click('#n-save');
  const row = page.locator('.note.lesson');
  await expect(row).toContainText('Lesson · 45 min');
  await expect.poll(async () => (await ui.saved()).state.diary[0]).toMatchObject({ date: yesterday, lesson: true, lessonMs: 45 * 60000 });

  // A lesson with nothing written is fine too.
  await page.click('#add-lesson');
  await page.click('#n-save');
  await expect(page.locator('.note.lesson')).toHaveCount(2);
  await expect(page.locator('.note.lesson').first()).toContainText('A lesson');

  await ui.tab('progress');
  await expect(page.locator('.tile').first()).toContainText('2'); // yesterday and today: two days in a row
  await expect(page.locator(`.cell[data-d="${yesterday}"]`)).toHaveClass(/\blesson\b/);
  await expect(page.locator('.sessions')).toContainText('Lesson (45 min)');
});
