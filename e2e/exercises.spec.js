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
  await tap('[data-note="C"]'); // up from A: the nearest C
  await tap('[data-ins=" | "]');
  await tap('[data-dur="half"]'); await tap('[data-dot]'); await tap('[data-note="G"]'); // down from C
  await tap('[data-dur="quarter"]'); await tap('[data-rest]');
  await tap('[data-back]'); await tap('[data-rest]');
  // Quarter G, eighths B♭ A and high C; dotted half G, quarter rest (lengths in eighths).
  await expect(page.locator('#ne-abc')).toHaveValue('G2_BAc | G6z2');
  await expect(page.locator('#ne-oct')).toHaveText('G4'); // the last note
  await tap('[data-oct="1"]'); // moved up an octave
  await expect(page.locator('#ne-abc')).toHaveValue('G2_BAc | g6z2');
  await tap('[data-oct="-1"]');
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
  await ui.menu('Delete exercise');
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

test('a lick’s chords: guessed from its chord symbols, or typed; then it comes up as a warm-up', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'ii–V–I, 1-2-3-5' }).click();
  await ui.setting('harmony');
  await expect(page.locator('#x-harmony')).toHaveValue('Dm7 G7 Cmaj7'); // from its notation
  await page.fill('#x-harmony', 'Dm7 G7 Cmaj7 nonsense');
  await expect(page.locator('#x-harmony-msg')).toHaveClass(/\berror\b/);
  await page.fill('#x-harmony', 'Dm7 G7');
  await expect(page.locator('#x-harmony-msg')).toContainText('As typed');
  await expect.poll(async () => (await ui.saved()).state.items.find((x) => x.name === 'ii–V–I, 1-2-3-5').harmony).toBe('Dm7 G7');
  await page.fill('#x-harmony', '');
  await expect.poll(async () => (await ui.saved()).state.items.find((x) => x.name === 'ii–V–I, 1-2-3-5').harmony).toBeUndefined();
});

test('a lick can be shown only as written, in C, to transpose in your head', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'ii–V–I, 1-2-3-5' }).click();
  await expect(page.locator('.key-strip')).toBeVisible();
  await page.check('#x-as-written');
  await expect(page.locator('.key-strip')).toHaveCount(0);
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  await expect.poll(async () => (await ui.saved()).state.items.find((x) => x.name === 'ii–V–I, 1-2-3-5').asWritten).toBe(true);
  await page.uncheck('#x-as-written');
  await expect(page.locator('.key-strip')).toBeVisible();
});

test('an exercise can be focus, on, or off (left out of the pool) @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  const row = page.locator('#tune-list .row', { hasText: 'Long tones' });
  await row.click();
  await expect(page.locator('#item-status .on')).toHaveText('On'); // the default
  await page.click('#item-status [data-v="off"]');
  await expect(page.locator('#item-status-hint')).toContainText('Left out');
  await ui.backdrop();
  await expect(row).toHaveClass(/\boff\b/);
  await page.click('.chip[data-f="off"]');
  await expect(page.locator('#tune-list .row')).toHaveCount(1);
  await expect.poll(async () => (await ui.saved()).state.items.find((x) => x.name === 'Long tones').off).toBe(true);
  // Focus puts it back, in every day's set.
  await row.click();
  await page.click('#item-status [data-v="focus"]');
  await ui.backdrop();
  await expect.poll(async () => (await ui.saved()).state.items.find((x) => x.name === 'Long tones')).toMatchObject({ focus: true });
  expect((await ui.saved()).state.items.find((x) => x.name === 'Long tones').off).toBeUndefined();
  await ui.expectNoSideScroll();
});

test('try an exercise through a tune: it goes before the tune, with the tune’s chart and a bass @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  // Technical ones aren't for tunes.
  await page.locator('#tune-list .row', { hasText: 'Long tones' }).click();
  await expect(page.locator('#x-tunes')).not.toBeChecked();
  await page.click('#item-menu');
  await expect(page.locator('.menu-pop button', { hasText: 'Try it through a tune' })).toHaveCount(0);
  await page.mouse.click(5, 5); // (closes the menu)
  await ui.backdrop();
  await page.locator('#tune-list .row', { hasText: 'Cross-arpeggios' }).click();
  await expect(page.locator('#x-tunes')).toBeChecked();
  await ui.menu('Try it through a tune');
  // Pick the tune: today's first, or search.
  await expect(page.locator('.sheet .section-label').first()).toHaveText('In today’s set');
  await page.fill('#pick-q', 'blue bossa');
  await expect(page.locator('.pick-list [data-pick]:visible')).toHaveCount(1);
  await page.locator('.pick-list [data-pick]:visible').click();
  await expect(page.locator('#toast')).toContainText('with Cross-arpeggios before it');
  const tune = (await page.locator('#toast').textContent()).match(/^Added (.+) to today’s set/)[1];
  await ui.backdrop();
  await ui.tab('today');
  const card = page.locator('.card', { hasText: `for ${tune}` }).filter({ hasText: 'Cross-arpeggios' });
  await expect(card).toHaveCount(1);
  await card.locator('h2').click();
  await expect(page.locator('.in-today')).toContainText(`as a warm-up for ${tune}`);
  await expect(page.locator('#x-tune-chart .chart')).toBeVisible();
  await expect(page.locator('#x-tune-chart #chart-edit')).toHaveCount(0);
  await page.click('#x-tune-chart #chart-bass');
  await expect(page.locator('#x-tune-chart .bar.now')).toHaveCount(1);
  await page.click('#x-tune-chart #chart-bass');
  await ui.expectNoSideScroll();
});

test('a lick can be written in any key (A minor, say), keeping its notes when the key changes @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'ii–V–I, 1-2-3-5' }).click();
  await page.click('#x-edit-abc');
  await expect(page.locator('#ne-home')).toHaveValue('0');
  await page.selectOption('#ne-home', '5'); // F: its Bs stay B natural
  await expect(page.locator('#ne-abc')).toHaveValue(/=B/);
  await expect.poll(async () => (await ui.saved()).state.items.find((x) => x.name === 'ii–V–I, 1-2-3-5').home).toBe(5);
  await page.click('#ne-save');
  await expect(page.locator('#x-as-written + span')).toContainText('Only as written, in F');
  await expect(page.locator('#x-notation svg').first()).toBeVisible();
  // A new lick, written in A minor: its keys read as minor.
  await ui.backdrop();
  await page.click('#add');
  await page.click('[data-cat="lick"]');
  await page.click('#x-add-abc');
  await page.selectOption('#ne-home', '21');
  await page.click('#ne-pad [data-note="A"]');
  await page.click('#ne-save');
  await expect(page.locator('.key-strip button').first()).toHaveText(/m$/);
  await ui.expectNoSideScroll();
});

test('an exercise with chords has a walking bass through them, looping @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Long tones' }).click();
  await expect(page.locator('#x-bass')).toHaveCount(0); // no chords
  await ui.backdrop();
  await page.locator('#tune-list .row', { hasText: 'ii–V–I, 1-2-3-5' }).click();
  await page.click('#x-bass');
  await expect(page.locator('#x-bass')).toHaveClass(/\bon\b/);
  await page.locator('.key-strip [data-root]').nth(5).click(); // another key: still on, in that key
  await expect(page.locator('#x-bass')).toHaveClass(/\bon\b/);
  await ui.backdrop();
  await expect(page.locator('.metro-pill')).toContainText('Bass · ii–V–I, 1-2-3-5');
  await page.click('.metro-pill .mp-stop');
  await expect(page.locator('.metro-pill')).toBeHidden();
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
  await expect.poll(abc).toMatch(/A,$/); // the A nearest the C before it
});

test('add an exercise or tune to today’s set from its details', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Chromatic scale' }).click();
  await ui.menu('Add to today’s set');
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
  // A chord symbol: its root, then its type.
  await page.click('#ne-pad [data-chord]');
  await expect(page.locator('#ne-chord')).toBeVisible();
  await page.click('#ne-pad [data-croot="G"]');
  await page.click('#ne-pad [data-cq="7"]');
  await expect(page.locator('#ne-chord')).toBeHidden();
  await expect(area).toHaveValue('"C7"c"G7" B _B A G F E D | C8 |');
  await expect(page.locator('#ne-preview .abcjs-chord')).toHaveText(['C7', 'G7']);
  await page.click('#ne-pad [data-back]'); // the symbol goes in one go
  await expect(area).toHaveValue('"C7"c B _B A G F E D | C8 |');
  // B♭ half-diminished; and one typed (Δ for maj).
  await page.click('#ne-pad [data-chord]');
  await page.click('#ne-pad [data-croot="B"]');
  await page.click('#ne-pad [data-cacc="b"]');
  await page.click('#ne-pad [data-cq="m7b5"]');
  await expect(area).toHaveValue('"C7"c"Bbm7b5" B _B A G F E D | C8 |');
  page.once('dialog', (d) => d.accept('EbΔ7'));
  await page.click('#ne-pad [data-chord]');
  await page.click('#ne-pad [data-cother]');
  await expect(area).toHaveValue('"C7"c"Bbm7b5""EbΔ7" B _B A G F E D | C8 |');
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
  await ui.menu('Add to today’s set');
  await expect(page.locator('.in-today')).toHaveText('In today’s set');
  await ui.backdrop();
  await ui.tab('today');
  await expect(page.locator('.card h2', { hasText: 'Killer Joe' })).toHaveCount(1);
});

test('a warm-up opened from today says what it’s for, and has full screen', async ({ page, ui }) => {
  await ui.start();
  await page.locator('[data-add-warm]').first().click();
  await page.locator('.pick-list [data-pick]').first().click();
  const warm = page.locator('.card', { has: page.locator('.bucket', { hasText: 'Warm-up' }) }).first();
  const forTune = (await warm.locator('.style').textContent()).replace(/^for /, '');
  await warm.locator('h2').click();
  await expect(page.locator('.in-today')).toHaveText(`In today’s set, as a warm-up for ${forTune}`);
  // Off to the metronome (the warm-up's) and back: still the warm-up, and still today's.

  await page.click('.sheet .tempo-row');
  await expect(page.locator('.sheet .eyebrow')).toContainText(`warm-up for ${forTune}`);
  await ui.backdrop();
  await expect(page.locator('.in-today')).toHaveText(`In today’s set, as a warm-up for ${forTune}`);
  await page.click('#item-menu'); // (no Add to today for a warm-up)
  await expect(page.locator('.menu-pop button', { hasText: 'Add to today’s set' })).toHaveCount(0);
  await expect(page.locator('.menu-pop button', { hasText: 'Take out of today’s set' })).toHaveCount(1);
  await page.mouse.click(5, 5);
  await expect(page.locator('#x-full')).toBeVisible();
});
