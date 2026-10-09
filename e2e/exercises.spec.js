import { test, expect } from './app.js';

test('an exercise shows notation in today’s keys and plays', async ({ page, ui }) => {
  await ui.start({ instruments: ['bb'] });
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Major scale' }).click();
  await expect(page.locator('#x-name')).toHaveValue('Major scale');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  // Pick another key to preview.
  await page.locator('.key-strip button').nth(5).click();
  await expect(page.locator('.key-strip .on')).toHaveCount(1);
  await page.click('#x-play');
  await expect(page.locator('#x-play span')).toHaveText('Stop');
  await page.click('#x-play');
  await expect(page.locator('#x-play span')).toHaveText('Play');
});

test('write a new exercise with the keypad', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  const count = await page.locator('#tune-list .row').count();
  await page.click('#add');
  await page.fill('#x-name', 'Cannonball lick');
  await page.click('[data-cat="lick"]');
  await page.click('[data-mode="fixed"]');
  await page.click('[data-fixed="0"]');
  await page.click('[data-fixed="5"]');
  await page.click('#x-save');
  await expect(page.locator('#tune-list .row')).toHaveCount(count + 1);

  await page.locator('#tune-list .row', { hasText: 'Cannonball lick' }).click();
  await page.click('#x-add-abc');
  const tap = (sel) => page.click(`#ne-pad ${sel}`);
  await tap('[data-dur="quarter"]'); await tap('[data-note="G"]');
  await tap('[data-dur="eighth"]'); await tap('[data-acc="_"]'); await tap('[data-note="B"]'); await tap('[data-note="A"]');
  await tap('[data-oct="1"]'); await tap('[data-note="C"]');
  await tap('[data-ins=" | "]');
  await tap('[data-oct="-1"]'); await tap('[data-dur="half"]'); await tap('[data-dot]'); await tap('[data-note="G"]');
  await tap('[data-dur="quarter"]'); await tap('[data-rest]');
  await tap('[data-back]'); await tap('[data-rest]');
  // Quarter G, eighths B♭ A and high C; dotted half G, quarter rest (lengths in eighths).
  await expect(page.locator('#ne-abc')).toHaveValue('G2_BAc | G6z2');
  await expect(page.locator('#ne-preview svg').first()).toBeVisible();
  await page.click('#ne-save');
  // Back on the exercise, with its notation, saved with its two fixed keys.
  await expect(page.locator('#x-name')).toHaveValue('Cannonball lick');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await expect.poll(async () => {
    const ex = (await ui.saved()).state.items.find((t) => t.name === 'Cannonball lick');
    return { keyMode: ex.keyMode, keys: ex.keys, abc: ex.abc };
  }).toEqual({ keyMode: 'fixed', keys: [0, 5], abc: 'G2_BAc | G6z2' });
});

test('playing an exercise counts toward the keys chart', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card.b-exercise', { has: page.locator('.keychip') }).first().locator('.check').click();
  await ui.tab('progress');
  await expect(page.locator('.keybar')).toHaveCount(12);
  await expect.poll(() => page.$$eval('.kb-fill', (x) => x.filter((e) => parseFloat(e.style.height) > 5).length)).toBeGreaterThan(0);
});

test('delete an exercise from its details, and undo', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  const count = await page.locator('#tune-list .row').count();
  await page.locator('#tune-list .row', { hasText: 'Major scale' }).click();
  page.once('dialog', (d) => d.accept());
  await page.click('#x-delete');
  await expect(page.locator('#tune-list .row')).toHaveCount(count - 1);
  await expect(page.locator('#tune-list .row', { hasText: 'Major scale' })).toHaveCount(0);
  await page.click('#toast button'); // Undo
  await expect(page.locator('#tune-list .row')).toHaveCount(count);
});

test('notation is one bar per line, black on white even in dark mode @narrow', async ({ page, ui }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await ui.start({ instruments: ['bb'] });
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Scales: major and minors' }).click();
  const notation = page.locator('#x-notation');
  await expect(notation.locator('svg').first()).toBeVisible();
  // Up and down an octave is two bars: two staff lines.
  await expect(notation.locator('.abcjs-staff.abcjs-l1').first()).toBeAttached();
  await expect(notation.locator('.abcjs-l2')).toHaveCount(0);
  const colors = await notation.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  expect(colors).toEqual(['rgb(255, 255, 255)', 'rgb(17, 17, 17)']);
  await notation.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('dark.png') });
});

test('a new lick can get its notation straight away @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  const count = await page.locator('#tune-list .row').count();
  await page.click('#add');
  await page.click('[data-cat="lick"]');
  await page.click('#x-add-abc'); // no name yet
  await expect(page.locator('#ne-pad')).toBeVisible();
  await page.locator('.ne-opts').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('editor.png') });
  await page.click('#ne-pad [data-note="G"]');
  await page.click('#ne-save');
  // Back on the (now saved) exercise, which can be renamed.
  await expect(page.locator('#x-name')).toHaveValue('Untitled lick');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await page.fill('#x-name', 'Cannonball lick');
  await ui.backdrop();
  await expect(page.locator('#tune-list .row')).toHaveCount(count + 1);
  await expect(page.locator('#tune-list .row', { hasText: 'Cannonball lick' })).toHaveCount(1);
});

test('playback with recorded instruments, and swing @narrow', async ({ page, ui }) => {
  const fetched = [];
  page.on('request', (r) => { if (r.url().includes('/samples/')) fetched.push(r.url().split('/samples/')[1]); });
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Scales: major and minors' }).click();
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await expect(page.locator('[data-pb="sound"]')).toHaveValue('piano');

  await page.locator('.play-row').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('play-row.png') });
  await page.selectOption('[data-pb="sound"]', 'sax');
  await page.selectOption('[data-pb="swing"]', 'swing');
  await page.click('#x-play');
  await expect(page.locator('#x-play span')).toHaveText('Stop');
  expect(fetched.length).toBeGreaterThan(5);
  expect(fetched.every((f) => f.startsWith('sax/'))).toBe(true);
  await page.click('#x-play');
  await expect.poll(async () => (await ui.saved()).state.settings).toMatchObject({ sound: 'sax', swing: 'swing' });
  await ui.expectNoSideScroll();
});

test.describe('offline before a sound was ever used', () => {
  // Without the service worker in the way, the test can make sample downloads fail.
  test.use({ serviceWorkers: 'block' });
  test('the synth plays instead', async ({ page, ui }) => {
    await page.route('**/samples/**', (r) => r.abort());
    await ui.start();
    await ui.tab('tunes');
    await page.click('[data-lib="exercises"]');
    await page.locator('#tune-list .row', { hasText: 'Major scale' }).click();
    await page.selectOption('[data-pb="sound"]', 'trumpet');
    await page.click('#x-play');
    await expect(page.locator('#toast')).toContainText('playing the synth');
    await expect(page.locator('#x-play span')).toHaveText('Stop');
  });
});

test('notation saves as you write it; Undo changes puts it back', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Bebop dominant scale' }).click();
  const before = (await ui.saved()).state.items.find((t) => t.name === 'Bebop dominant scale').abc;
  await page.click('#x-edit-abc');
  await expect(page.locator('#ne-revert')).toBeHidden(); // nothing changed yet
  const abc = async () => (await ui.saved()).state.items.find((t) => t.name === 'Bebop dominant scale').abc;
  await page.click('#ne-pad [data-ins=" | "]');
  await page.click('#ne-pad [data-note="G"]');
  await expect.poll(abc).not.toBe(before); // saved already
  // Undo changes: back to how it was when the editor opened.
  await page.click('#ne-revert');
  await expect.poll(abc).toBe(before);
  await expect(page.locator('#ne-revert')).toBeHidden();
  // An edit, then closing without anything else: kept.
  await page.click('#ne-pad [data-note="A"]');
  await ui.backdrop();
  await expect.poll(abc).toMatch(/A$/);
});

test('add an exercise or tune to today’s set from its details', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Chromatic scale' }).click();
  await page.click('#x-today');
  await expect(page.locator('#toast')).toContainText('Added Chromatic scale to today’s set');
  await expect(page.locator('.in-today')).toHaveText('In today’s set');
  await ui.backdrop();
  await ui.tab('today');
  await expect(page.locator('.card h2', { hasText: 'Chromatic scale' })).toHaveCount(1);
});

test('a new tune is added when its sheet closes, if it has a name', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  const count = await page.locator('#tune-list .row').count();
  await page.click('#add');
  await page.fill('#f-name', 'Moanin’');
  await ui.backdrop();
  await expect(page.locator('#toast')).toContainText('Added Moanin’');
  await expect(page.locator('#tune-list .row')).toHaveCount(count + 1);
  await page.click('#toast button'); // Undo
  await expect(page.locator('#tune-list .row')).toHaveCount(count);
  // Without a name, nothing is added.
  await page.click('#add');
  await ui.backdrop();
  await expect(page.locator('#tune-list .row')).toHaveCount(count);
});

test('notation editor: arrows step through notes; Chord adds a symbol over the next note', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Bebop dominant scale' }).click();
  await page.click('#x-edit-abc');
  const area = page.locator('#ne-abc');
  await expect(area).toHaveValue('"C7"c B _B A G F E D | C8 |');
  const caret = () => area.evaluate((a) => a.selectionStart);
  await area.evaluate((a) => a.setSelectionRange(0, 0));
  await page.click('#ne-pad [data-move="1"]');
  expect(await caret()).toBe(5); // after "C7"c (a chord symbol goes with its note)
  await page.click('#ne-pad [data-move="1"]');
  expect(await caret()).toBe(7); // after B
  await page.click('#ne-pad [data-move="-1"]');
  expect(await caret()).toBe(5);
  page.once('dialog', (d) => d.accept('G7'));
  await page.click('#ne-pad [data-chord]');
  await expect(area).toHaveValue('"C7"c"G7" B _B A G F E D | C8 |');
  await expect(page.locator('#ne-preview .abcjs-chord')).toHaveText(['C7', 'G7']);
  await page.click('#ne-pad [data-back]'); // the symbol goes in one go
  await expect(area).toHaveValue('"C7"c B _B A G F E D | C8 |');
});

test('notation full screen, turned sideways on a phone held upright, plays, and closes @narrow', async ({ page, ui }) => {
  await page.addInitScript(() => {
    const session = { type: 'auto', log: [] };
    Object.defineProperty(navigator, 'audioSession', { value: new Proxy(session, { set: (o, k, v) => { o[k] = v; if (k === 'type') o.log.push(v); return true; } }) });
  });
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Seventh-chord arpeggios' }).click();
  await page.click('#x-full');
  const full = page.locator('.notation-full');
  await expect(full).toHaveClass(/\bturned\b/);
  await expect(full.locator('.abcjs-chord').first()).toBeVisible(); // with its chord symbol
  await full.locator('.nf-play').click();
  // Plays through the silent switch, like the metronome.
  await expect.poll(() => page.evaluate(() => navigator.audioSession.log)).toContain('playback');
  await full.locator('.nf-close').click();
  await expect(full).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => navigator.audioSession.type)).toBe('auto');
});

test('add a tune to today’s set from its details', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.fill('#q', 'Killer Joe');
  await page.locator('#tune-list .row').first().click();
  await page.click('#f-today');
  await expect(page.locator('.in-today')).toHaveText('In today’s set');
  await ui.backdrop();
  await ui.tab('today');
  await expect(page.locator('.card h2', { hasText: 'Killer Joe' })).toHaveCount(1);
});

test('a warm-up opened from today says what it’s for, and has full screen', async ({ page, ui }) => {
  await ui.start();
  const warm = page.locator('.card', { has: page.locator('.bucket', { hasText: 'Warm-up' }) }).first();
  const forTune = (await warm.locator('.style').textContent()).replace(/^for /, '');
  await warm.locator('h2').click();
  await expect(page.locator('.in-today')).toHaveText(`In today’s set, as a warm-up for ${forTune}`);
  await expect(page.locator('#x-today')).toHaveCount(0);
  await expect(page.locator('#x-full')).toBeVisible();
});
