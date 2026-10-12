import { test, expect } from './app.js';

// Screenshots of the main screens, compared with the saved ones (e2e/visual.spec.js-snapshots), to
// catch layout changes the other tests can't see — for refactors that shouldn't change the look.
// Local only: the app uses the system's fonts, which differ on the CI machine. After a change
// that's meant to look different: npx playwright test visual --update-snapshots, and check them.
test.skip(!!process.env.CI, 'screenshots are compared locally (system fonts differ in CI)');

const DAY = new Date('2026-10-06T09:00:00');
const shot = (name, opts = {}) => [`${name}.png`, { fullPage: false, maxDiffPixelRatio: 0.002, ...opts }];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAY);
});

async function settle(page) {
  await page.waitForTimeout(400); // sheets slide in; notation draws
}

test('welcome @visual @narrow', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#ins-done')).toBeVisible();
  await expect(page).toHaveScreenshot(...shot('welcome'));
});

test('today: the set, a played card, the hint @visual @narrow', async ({ page, ui }) => {
  await ui.start();
  await expect(page).toHaveScreenshot(...shot('today', { fullPage: true }));
  await ui.swipe(page.locator('.card').first(), 160);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot(...shot('today-played'));
});

test('library: tunes and exercises @visual @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await expect(page).toHaveScreenshot(...shot('tunes'));
  await page.click('[data-lib="exercises"]');
  await expect(page).toHaveScreenshot(...shot('exercises'));
});

test('a tune’s details: chart, settings, a panel @visual @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.fill('#q', 'Autumn Leaves');
  await page.locator('.row', { hasText: 'Autumn Leaves' }).first().click();
  await settle(page);
  await expect(page).toHaveScreenshot(...shot('tune'));
  await page.locator('.sheet .set-list').scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot(...shot('tune-settings'));
  await ui.setting('keys');
  await settle(page);
  await expect(page).toHaveScreenshot(...shot('tune-keys'));
});

test('an exercise’s details: notation, settings, panels @visual @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Scales: major and minors' }).click();
  await settle(page);
  await expect(page).toHaveScreenshot(...shot('exercise'));
  await page.locator('.sheet .set-list').scrollIntoViewIfNeeded();
  await expect(page).toHaveScreenshot(...shot('exercise-settings'));
  await ui.setting('vary');
  await settle(page);
  await expect(page).toHaveScreenshot(...shot('exercise-vary'));
  await ui.panelDone();
  await ui.setting('keys');
  await settle(page);
  await expect(page).toHaveScreenshot(...shot('exercise-keys'));
});

test('settings, and a choice @visual @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('settings');
  await expect(page).toHaveScreenshot(...shot('settings', { fullPage: true }));
  await page.click('[data-open="exerciseFocus"]');
  await settle(page);
  await expect(page).toHaveScreenshot(...shot('settings-choice'));
});

test('diary and progress, after some practice @visual @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.swipe(page.locator('.card').first(), 160);
  await ui.swipe(page.locator('.card').nth(1), 160);
  await ui.tab('diary');
  await expect(page).toHaveScreenshot(...shot('diary', { fullPage: true }));
  await ui.tab('progress');
  await expect(page).toHaveScreenshot(...shot('progress', { fullPage: true }));
});

test('metronome and a note @visual @narrow', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-metro');
  await settle(page);
  await expect(page).toHaveScreenshot(...shot('metronome'));
  await ui.backdrop();
  await page.click('#today-note');
  await settle(page);
  await expect(page).toHaveScreenshot(...shot('note'));
});
