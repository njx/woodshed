import { test, expect } from './app.js';

test('metronome runs, shows in its circle on Today and a pill elsewhere, and stops @narrow', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-metro');
  await page.click('[data-step="5"]');
  await page.click('[data-beats="3"]');
  await expect(page.locator('#m-bpm')).toHaveText('105');
  await page.click('#m-go');
  await expect(page.locator('#m-go span')).toHaveText('Stop');
  await expect(page.locator('#m-dots i.on')).toHaveCount(1); // the beat lights up
  await ui.expectNoSideScroll();
  await ui.backdrop();
  await expect(page.locator('#today-metro .hd-live')).toHaveText('105');
  await ui.tab('diary');
  await expect(page.locator('.metro-pill:not([hidden]) b')).toHaveText('105');
  await page.click('.mp-stop');
  await expect(page.locator('.metro-pill')).toBeHidden();
});

test('working tempo, and suggestions to speed up or slow down', async ({ page, ui }) => {
  await ui.start();
  // Set a tune's tempo from its card.
  const card = page.locator('.card:not(.b-exercise)').first();
  const id = await card.getAttribute('data-item-id');
  await card.locator('.tempo-chip').click();
  await expect(page.locator('.sheet .eyebrow')).toContainText(await card.locator('h2').textContent());
  for (let i = 0; i < 4; i++) await page.click('[data-step="5"]'); // 100 → 120
  await ui.backdrop();
  await expect(card.locator('.tempo-chip')).toContainText('120');

  // Solid yesterday at 120; solid again today → suggest 126.
  await page.waitForTimeout(400); // let the tempo save
  await ui.editSaved(`(s) => {
    const d = new Date(s.plan.date + 'T12:00:00'); d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);
    const t = s.items.find((x) => x.id === '${id}');
    // Counts toward the suggestion only if it's after the tempo was set.
    s.log.push({ id: 'y1', date: yesterday, itemId: t.id, at: (t.tempoSetAt || 0) + 1, key: null, rating: 'solid', bpm: 120, prev: {} });
  }`);
  await page.reload();
  const c = page.locator(`.card[data-item-id="${id}"]`);
  await c.locator('.check').click();
  await c.locator('.rating button[data-v="solid"]').click();
  await expect(c.locator('.suggest.tempo')).toContainText('126');
  await c.locator('[data-tempo-to]').click();
  await expect(c.locator('.tempo-chip')).toContainText('126');

  // Rough on another tune → suggest slowing down.
  const other = page.locator('.card:not(.b-exercise):not(.done)').first();
  const oid = await other.getAttribute('data-item-id');
  await other.locator('.tempo-chip').click();
  await page.click('[data-step="-5"]');
  await ui.backdrop();
  const o = page.locator(`.card[data-item-id="${oid}"]`);
  await o.locator('.check').click();
  await o.locator('.rating button[data-v="rough"]').click();
  await expect(o.locator('.suggest.tempo')).toContainText(/slow/i);

  // The tune's details show its tempo and history; a goal tempo set from there sticks.
  await c.locator('h2').click();
  await expect(page.locator('.history-list li').first()).toContainText('bpm');
  await page.click('.tempo-row');
  await page.fill('#m-goal', '140');
  await page.locator('#m-goal').dispatchEvent('change');
  await ui.backdrop();
  await expect(page.locator('.tempo-row')).toContainText('140');
});

test('started from a card, the metronome can be stopped from the Today circle', async ({ page, ui }) => {
  await ui.start();
  const card = page.locator('.card:not(.b-exercise)').first();
  const name = await card.locator('h2').textContent();
  await card.locator('.tempo-chip').click();
  await page.click('#m-go');
  await ui.backdrop();
  await expect(page.locator('#today-metro')).toHaveClass(/\blive\b/);
  // The circle opens the metronome that's on: this tune's, with Stop.
  await page.click('#today-metro');
  await expect(page.locator('.sheet .eyebrow')).toContainText(name);
  await expect(page.locator('#m-go span')).toHaveText('Stop');
  await page.click('#m-go');
  await expect(page.locator('#m-go span')).toHaveText('Start');
  await ui.backdrop();
  await expect(page.locator('#today-metro')).not.toHaveClass(/\blive\b/);
});
