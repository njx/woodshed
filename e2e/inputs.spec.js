import { test, expect } from './app.js';

// iOS zooms the page when a text field or menu with text under 16px is focused.
async function smallFields(page) {
  return page.evaluate(() => [...document.querySelectorAll('input, textarea, select')]
    .filter((el) => !['checkbox', 'radio', 'range', 'file', 'hidden'].includes(el.type))
    .filter((el) => el.offsetParent !== null) // visible
    .map((el) => ({ id: el.id || el.className || el.name || el.tagName, size: parseFloat(getComputedStyle(el).fontSize) }))
    .filter((f) => f.size < 16));
}

test('text fields and menus are at least 16px everywhere @narrow', async ({ page, ui }) => {
  const found = [];
  const check = async (where) => { for (const f of await smallFields(page)) found.push(`${where}: ${f.id} ${f.size}px`); };

  await ui.start({ instruments: ['bb'] });
  await check('today');
  await ui.tab('tunes');
  await check('library');
  await page.locator('.row').first().click();
  await check('tune');
  await page.click('#rec-add-toggle').catch(() => {});
  await check('tune recordings');
  await expect(page.locator('#chart-box')).not.toContainText('Loading');
  await check('tune chart');
  await ui.backdrop();
  await page.fill('#q', 'Autumn Leaves');
  await page.locator('.row', { hasText: 'Autumn Leaves' }).click();
  await page.click('#chart-edit');
  await check('chart editor');
  await ui.backdrop(); // back to the tune
  await ui.backdrop();
  await page.fill('#q', '');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Scales: major and minors' }).click();
  await check('exercise');
  await page.click('#x-to-pattern');
  await ui.backdrop();
  await page.locator('#tune-list .row', { hasText: 'Major scale' }).click();
  await page.click('#x-edit-abc');
  await check('notation editor');
  await ui.backdrop(); // back to the exercise
  await ui.backdrop();
  await ui.tab('today');
  await page.locator('.card .tempo-chip').first().click();
  await check('metronome');
  await ui.backdrop();
  await page.click('#today-note');
  await check('note');
  await ui.backdrop();
  await page.click('#today-rec');
  await page.click('#rec-go');
  await page.waitForTimeout(600);
  await page.click('#rec-go');
  await expect(page.locator('#rec-keep')).toBeVisible();
  await check('recorder');
  await page.click('#rec-discard');
  await page.click('#today-ask');
  await check('assistant key');
  await page.fill('#key-input', 'sk-ant-test');
  await page.click('#key-save');
  await expect(page.locator('#chat-text')).toBeVisible();
  await check('assistant');
  await ui.backdrop();
  for (const t of ['diary', 'progress', 'settings']) { await ui.tab(t); await check(t); }
  expect(found).toEqual([]);
});
