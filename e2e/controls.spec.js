import { readFileSync } from 'node:fs';
import { test, expect } from './app.js';

// The everyday controls the other specs pass by: settings, backups, a tune's and an exercise's
// settings, and the smaller things on Today, Progress and in a note.

const accept = (page) => page.on('dialog', (d) => d.accept());

test('settings: instruments, the daily mix, tune order, picking, recordings service @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('settings');
  // Instruments: at least one stays on.
  await page.check('[data-ins="bb"]');
  await page.uncheck('[data-ins="c"]');
  await page.click('[data-ins="bb"]'); // (the last one: stays on)
  await expect(page.locator('#toast')).toContainText('Pick at least one');
  await expect(page.locator('[data-ins="bb"]')).toBeChecked();
  await expect.poll(async () => (await ui.saved()).state.settings.instruments).toEqual(['bb']);
  // The daily mix: steppers, then rebuild.
  const before = (await ui.saved()).state.settings;
  await page.locator('.stepper[data-key="exercises"] [data-d="-1"]').click();
  await page.locator('.stepper[data-key="fresh"] [data-d="1"]').click();
  await expect(page.locator('.stepper[data-key="exercises"] output')).toHaveText(String(before.exercises - 1));
  await page.click('[data-setting="tuneOrder"] [data-v="group"]');
  await expect(page.locator('[data-setting="tuneOrder"] [data-v="group"]')).toHaveClass(/\bon\b/);
  await page.click('[data-setting="listen"] [data-v="spotify"]');
  await expect.poll(async () => {
    const s = (await ui.saved()).state.settings;
    return [s.exercises, s.fresh, s.tuneOrder, s.listen];
  }).toEqual([before.exercises - 1, before.fresh + 1, 'group', 'spotify']);
  // A picking choice: its row shows what it's set to.
  await page.click('[data-open="priority"]');
  const pick = page.locator('.choice-list [data-pick]').last();
  const label = (await pick.locator('.set-label b, .set-label').first().innerText()).split('\n')[0];
  await pick.click();
  await expect(page.locator('[data-open="priority"] .set-value')).toHaveText(label);
  await page.click('#rebuild');
  await expect(page.locator('#toast')).toContainText('Today’s set rebuilt');
  await expect(page.locator('.tab[data-tab="today"]')).toHaveClass(/\bon\b/);
});

test('a backup: export, change something, import it back; reset everything', async ({ page, ui }) => {
  accept(page);
  await ui.start();
  await ui.tab('settings');
  const download = page.waitForEvent('download');
  await page.click('#export');
  const file = await (await download).path();
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup.app).toBe('woodshed');
  const count = backup.items.length;
  // Delete a tune, then bring the backup back.
  await ui.tab('tunes');
  await page.fill('#q', 'Autumn Leaves');
  await page.locator('.row', { hasText: 'Autumn Leaves' }).first().click();
  await ui.menu('Delete tune');
  await expect.poll(async () => (await ui.saved()).state.items.length).toBe(count - 1);
  await ui.tab('settings');
  await page.setInputFiles('#import', file);
  await expect(page.locator('#toast')).toContainText('Backup restored');
  await expect.poll(async () => (await ui.saved()).state.items.length).toBe(count);
  // Not a backup.
  await page.setInputFiles('#import', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.locator('#toast')).toContainText('doesn’t look like a Woodshed backup');
  // Reset (two confirms).
  await ui.tab('today');
  await page.locator('.card .check').first().click();
  await expect.poll(async () => (await ui.saved()).state.log.length).toBe(1);
  await ui.tab('settings');
  await page.click('#reset');
  await expect(page.locator('#toast')).toContainText('Reset to the original list');
  await expect.poll(async () => (await ui.saved()).state.log.length).toBe(0);
});

test('a tune’s settings: usual keys, level, priority; today’s key; log it; delete it @narrow', async ({ page, ui }) => {
  accept(page);
  await ui.start();
  // From today's set: its key today.
  await page.locator('.card:not(.b-exercise) h2').first().click();
  const name = await page.locator('#f-name').inputValue();
  const tune = async () => (await ui.saved()).state.items.find((t) => t.name === name);
  const sel = page.locator('#f-todaykey');
  const other = await sel.locator('option').evaluateAll((os) => os.find((o) => !o.selected && o.value !== '')?.value);
  await sel.selectOption(other);
  await expect.poll(async () => {
    const { state } = await ui.saved();
    return state.plan.items.find((i) => i.itemId === state.items.find((t) => t.name === name).id).key;
  }).toBe(Number(other));
  // Its usual keys: add one.
  const keys = (await tune()).keys;
  await ui.setting('keys');
  const add = await page.locator('.sub-panel .keygrid [data-k]').evaluateAll((bs, ks) => bs.map((b) => Number(b.dataset.k)).find((k) => !ks.includes(k)), keys);
  await page.click(`.sub-panel .keygrid [data-k="${add}"]`);
  await expect.poll(async () => (await tune()).keys).toContain(add);
  await ui.panelDone();
  // Level and priority, each in its panel; the row shows the choice.
  await ui.setting('level');
  await page.locator('.sub-panel [data-field="level"] button').nth(2).click();
  const level = await page.locator('.sub-panel [data-field="level"] button').nth(2).textContent();
  await ui.panelDone();
  await expect(page.locator('[data-open="level"] .set-value')).toHaveText(level);
  await ui.setting('priority');
  await page.locator('.sub-panel [data-field="priority"] button').first().click();
  await expect.poll(async () => (await tune()).priority).toBe(1);
  await ui.panelDone();
  // Log it for today, and take it back.
  await page.click('#log-today');
  await expect(page.locator('#log-today')).toHaveText(/Played today/);
  await page.click('#log-today');
  await expect(page.locator('#log-today')).toHaveText(/Log for today/);
  // Delete it (with Undo).
  await ui.menu('Delete tune');
  await expect(page.locator('#toast')).toContainText(`Deleted ${name}`);
  await expect.poll(async () => !!(await tune())).toBe(false);
  await page.click('#toast button');
  await expect.poll(async () => !!(await tune())).toBe(true);
});

test('an exercise’s settings: keys per session, level, priority, use with tunes; log it @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Cross-arpeggios' }).click();
  const ex = async () => (await ui.saved()).state.items.find((t) => t.name === 'Cross-arpeggios');
  const kps = (await ex()).keysPerSession;
  await ui.setting('keys');
  await page.locator('#x-kps [data-d="1"]').click();
  await expect(page.locator('#x-kps output')).toHaveText(String(kps + 1));
  await ui.panelDone();
  await expect(page.locator('[data-open="keys"] .set-value')).toContainText(String(kps + 1));
  await ui.setting('level');
  await page.locator('.sub-panel [data-field="level"] button').nth(1).click();
  await ui.panelDone();
  await ui.setting('priority');
  await page.locator('.sub-panel [data-field="priority"] button').nth(3).click();
  await ui.panelDone();
  await page.uncheck('#x-tunes');
  await expect.poll(async () => {
    const x = await ex();
    return [x.keysPerSession, x.level, x.priority, !!x.solo];
  }).toEqual([kps + 1, 1, 4, true]);
  await page.check('#x-tunes');
  await expect.poll(async () => !!(await ex()).solo).toBe(false);
  await page.click('#x-log');
  await expect(page.locator('#x-log')).toHaveText(/Played today/);
  await expect.poll(async () => (await ui.saved()).state.log.length).toBe(1);
});

test('today: one more tune; a run of solid sessions suggests the next level @narrow', async ({ page, ui }) => {
  await ui.start();
  const n = await page.locator('.card').count();
  await page.click('#more');
  await expect(page.locator('.card')).toHaveCount(n + 1);
  // Two solid sessions on earlier days for the first tune card's tune…
  const card = page.locator('.card:not(.b-exercise)').first();
  const name = await card.locator('h2').textContent();
  await ui.editSaved(`(s) => {
    const t = s.items.find((x) => x.name === ${JSON.stringify(name)});
    t.level = 1;
    t.levelSetAt = 0;
    for (const d of ['2026-01-01', '2026-01-02']) s.log.push({ id: d, date: d, itemId: t.id, at: Date.parse(d), key: null, rating: 'solid', prev: {} });
  }`);
  await page.reload();
  // …and a third today.
  const again = page.locator('.card', { has: page.locator('h2', { hasText: name }) });
  await again.locator('.check').click();
  await again.locator('.rating [data-v="solid"]').click();
  const sug = again.locator('.suggest [data-level]');
  await expect(sug).toBeVisible();
  await sug.click();
  await expect(page.locator('#toast')).toContainText(`${name} is now`);
  await expect.poll(async () => (await ui.saved()).state.items.find((x) => x.name === name).level).toBe(2);
});

test('progress: tap a key’s bar, or a day @narrow', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card:has(.keychip) .check').first().click(); // (one with a key)
  await ui.tab('progress');
  await page.locator('.keybar').first().click();
  await expect(page.locator('#key-readout')).toContainText(/sessions? in the last 30 days/);
  await page.locator('.heat .cell.today').click();
  await expect(page.locator('#heat-readout')).toContainText(/Major scale/);
});

test('a note: saving needs some text; delete it, and undo @narrow', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-note');
  await page.click('#n-save'); // nothing in it: stays open
  await expect(page.locator('#n-text')).toBeFocused();
  await page.fill('#n-text', 'Slow practice on the bridge');
  await page.click('#n-save');
  await ui.tab('diary');
  const note = page.locator('.note', { hasText: 'Slow practice on the bridge' });
  await expect(note).toHaveCount(1);
  await note.click();
  await page.fill('#n-text', '');
  await page.click('#n-save'); // emptied: say so, rather than save an empty note
  await expect(page.locator('#toast')).toContainText('A note needs some text');
  await page.fill('#n-text', 'Slow practice on the bridge');
  await page.click('#n-delete');
  await expect(note).toHaveCount(0);
  await page.click('#toast button');
  await expect(note).toHaveCount(1);
});
