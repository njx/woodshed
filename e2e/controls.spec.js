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
  // What was there before is kept, and can be put back.
  await expect(page.locator('#copies li').first()).toContainText('Before reset');
  await expect(page.locator('#copies li')).toContainText(['Before reset', 'Before restoring a backup']);
  await page.locator('#copies li', { hasText: 'Before reset' }).locator('[data-copy]').click();
  await expect(page.locator('#toast')).toContainText('Earlier copy put back');
  await expect.poll(async () => (await ui.saved()).state.log.length).toBe(1);
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
  await ui.editSavedClosed(`(s) => {
    const t = s.items.find((x) => x.name === ${JSON.stringify(name)});
    t.level = 1;
    t.levelSetAt = 0;
    for (const d of ['2026-01-01', '2026-01-02']) s.log.push({ id: d, date: d, itemId: t.id, at: Date.parse(d), key: null, rating: 'solid', prev: {} });
  }`);
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
  const card = page.locator('.card:has(.keychip)').first(); // (one with a key)
  const name = await card.locator('h2').textContent();
  await card.locator('.check').click();
  await ui.tab('progress');
  await page.locator('.keybar').first().click();
  await expect(page.locator('#key-readout')).toContainText(/sessions? in the last 30 days/);
  await page.locator('.heat .cell.today').click();
  await expect(page.locator('#heat-readout')).toContainText(name);
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

test('add a tune: its name, then its settings all at once; Add tune adds it @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('#add');
  await page.click('#save-new'); // no name yet: stays open
  await expect(page.locator('#toast')).toContainText('Give the tune a name');
  await page.fill('#f-name', 'A Tune Of My Own');
  // Its settings as rows, as in a tune's details.
  await ui.setting('level');
  await page.locator('[data-field="level"] button').nth(1).click();
  await ui.panelDone();
  await ui.setting('keys');
  await page.locator('#keygrids [data-k]').nth(3).click();
  await ui.panelDone();
  await ui.setting('style');
  await page.fill('#f-style', 'Hard bop');
  await page.locator('#f-style').blur();
  await ui.panelDone();
  await expect(page.locator('.sheet [data-open="style"] .set-value')).toHaveText('Hard bop');
  await page.click('#save-new');
  await expect(page.locator('#toast')).toContainText('Added A Tune Of My Own');
  await expect.poll(async () => (await ui.saved()).state.items.find((t) => t.name === 'A Tune Of My Own'))
    .toMatchObject({ type: 'tune', level: 1, style: 'Hard bop', mine: true, focus: false });
  expect((await ui.saved()).state.items.find((t) => t.name === 'A Tune Of My Own').keys).toHaveLength(1);
});

test('a hint goes once it’s dismissed, or once the thing it explains is done @narrow', async ({ page, ui }) => {
  await ui.start();
  const hint = page.locator('[data-hint="swipe"]');
  await expect(hint).toBeVisible();
  await ui.swipe(page.locator('.card').first(), 160); // swiping a card: the swipe hint has done its job
  await expect(hint).toHaveCount(0);
  await expect.poll(async () => (await ui.saved()).state.hintsSeen).toContain('swipe');
  // In the metronome sheet: dismissed with ×, and not shown again.
  await page.click('#today-metro');
  const tip = page.locator('[data-hint="metro-tip"]');
  await tip.locator('.hint-x').click();
  await expect(tip).toHaveCount(0);
  await ui.backdrop();
  await page.click('#today-metro');
  await expect(page.locator('#m-go')).toBeVisible();
  await expect(tip).toHaveCount(0);
});

test('an exercise in today’s set changed to No key: its card and notation lose their keys; Key only picks keys again @narrow', async ({ page, ui }) => {
  await ui.start();
  const card = page.locator('.card.b-exercise:has(.keychip)').first();
  const name = await card.locator('h2').textContent();
  await card.locator('h2').click();
  await expect(page.locator('.key-strip')).toHaveCount(1);
  await ui.setting('vary');
  await page.click('#x-vary [data-vary="none"]');
  await expect(page.locator('#x-vary [data-vary="none"]')).toHaveClass(/\bon\b/);
  await ui.panelDone();
  await expect(page.locator('.sheet [data-open="vary"] .set-value')).toHaveText('No key');
  await expect(page.locator('.sheet [data-open="keys"]')).toHaveCount(0); // (no keys to pick)
  await expect(page.locator('.key-strip')).toHaveCount(0); // shown as written
  await ui.backdrop();
  const again = page.locator('.card', { has: page.locator('h2', { hasText: name }) });
  await expect(again.locator('.keychip')).toHaveCount(0);
  const planKeys = async () => {
    const { state } = await ui.saved();
    const x = state.items.find((t) => t.name === name);
    return { mode: x.keyMode, keys: state.plan.items.find((i) => i.itemId === x.id && !i.warmup).keys };
  };
  await expect.poll(planKeys).toEqual({ mode: 'none', keys: [] });
  // Back to keys: today gets some again.
  await again.locator('h2').click();
  await ui.setting('vary');
  await page.click('#x-vary [data-vary=""]');
  await ui.panelDone();
  await ui.backdrop();
  await expect(again.locator('.keychip')).toHaveCount(1);
  await expect.poll(async () => (await planKeys()).keys.length).toBeGreaterThan(0);
});

test('a warm-up for a tune: Pick for me adds the next one @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.fill('#q', 'Autumn Leaves');
  await page.locator('.row', { hasText: 'Autumn Leaves' }).first().click();
  await ui.menu('Add to today’s set');
  await ui.backdrop();
  await ui.tab('today');
  const tune = page.locator('.card', { has: page.locator('h2', { hasText: /^Autumn Leaves$/ }) });
  await tune.locator('[data-add-warm]').click();
  await page.click('#pick-for-me');
  await expect(page.locator('#toast')).toContainText(/Added .+ before Autumn Leaves/);
  await expect(page.locator('.card', { hasText: 'for Autumn Leaves' })).toHaveCount(1);
  await expect.poll(async () => {
    const { state } = await ui.saved();
    const t = state.items.find((x) => x.name === 'Autumn Leaves');
    return state.plan.items.filter((i) => i.warmup === t.id).length;
  }).toBe(1);
});
