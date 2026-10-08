import { test, expect } from './app.js';

async function record(page, ms) {
  await expect(page.locator('#rec-go')).toBeEnabled();
  await page.click('#rec-go');
  await page.waitForTimeout(ms);
  await page.click('#rec-go'); // stop
}

test('record audio, keep it with a note, and play it back', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-rec');
  await record(page, 1500);
  await expect(page.locator('.rec-stage.review audio')).toHaveCount(1);
  await page.fill('#rec-text', 'Bridge of Solar, slow');
  await page.fill('#rec-tune', 'Solar');
  await page.click('#rec-keep');
  await expect(page.locator('#toast')).toContainText('Recording saved');

  await expect.poll(async () => (await ui.saved()).state.diary.length).toBe(1);
  const { state, clipIds } = await ui.saved();
  const note = state.diary.find((e) => e.text === 'Bridge of Solar, slow');
  expect(note.itemId).toBe(state.items.find((t) => t.name === 'Solar').id);
  expect(note.media).toHaveLength(1);
  expect(note.media[0]).toMatchObject({ kind: 'audio' });
  expect(note.media[0].size).toBeGreaterThan(1000);
  expect(clipIds).toContain(note.media[0].id);

  // Play it inline in the diary, and in the note.
  await ui.tab('diary');
  const pill = page.locator('.clip-pill.audio').first();
  await pill.click();
  await expect(pill).toHaveClass(/playing/);
  await pill.click();
  await page.locator('.note', { hasText: 'Bridge of Solar' }).click();
  await expect(page.locator('.clip-player audio')).toHaveAttribute('src', /^blob:/);
});

test('discarding keeps nothing; closing mid-take keeps it', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-rec');
  await record(page, 800);
  await page.click('#rec-discard');
  expect((await ui.saved()).state.diary).toHaveLength(0);

  await page.click('#today-rec');
  await expect(page.locator('#rec-go')).toBeEnabled();
  await page.click('#rec-go');
  await page.waitForTimeout(1000);
  await ui.backdrop();
  await expect.poll(async () => (await ui.saved()).state.diary.length).toBe(1);
});

test('video from a tune’s details returns to the tune', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card:not(.b-exercise) h2').first().click();
  const tune = await page.locator('#f-name').inputValue();
  await page.click('#rec-tune');
  await page.click('[data-kind="video"]');
  await expect.poll(() => page.evaluate(() => document.querySelector('#rec-preview')?.videoWidth || 0)).toBeGreaterThan(0);
  await record(page, 1500);
  await expect(page.locator('.rec-stage.review video')).toHaveCount(1);
  await page.click('#rec-keep');
  await expect(page.locator('#f-name')).toHaveValue(tune);
  await expect(page.locator('.sheet .clip-pill.video')).toHaveCount(1);
});

test('add a second clip to a note, remove one; files are cleaned up', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-rec');
  await record(page, 900);
  await page.fill('#rec-text', 'Two takes');
  await page.click('#rec-keep');
  await ui.tab('diary');
  await page.locator('.note', { hasText: 'Two takes' }).click();
  await page.click('#n-record');
  await record(page, 900);
  await expect(page.locator('#rec-text')).toHaveCount(0); // the note's own fields aren't repeated
  await page.click('#rec-keep');
  await expect(page.locator('.clips li')).toHaveCount(2);

  page.once('dialog', (d) => d.accept());
  await page.click('[data-clip-rm="1"]');
  await expect(page.locator('.clips li')).toHaveCount(1);
  await ui.backdrop();

  await page.reload(); // startup removes files no note refers to
  await expect.poll(async () => (await ui.saved()).clipIds.length).toBe(1);
  await ui.tab('settings');
  await expect(page.locator('p.fine', { hasText: 'Recordings:' })).toContainText('Recordings: 1');
});

test('record an exercise from its details: the take is kept with it, labelled with what was played @narrow', async ({ page, ui }) => {
  await ui.start();
  await ui.tab('tunes');
  await page.click('[data-lib="exercises"]');
  await page.locator('#tune-list .row', { hasText: 'Major scale' }).click();
  await expect(page.locator('.sheet')).toContainText('Record yourself playing it');
  await page.click('#x-rec');
  await record(page, 1000);
  await expect(page.locator('#rec-text')).toHaveValue(/^In [A-G]/); // the key it's shown in
  await expect(page.locator('#rec-tune')).toHaveValue('Major scale');
  const label = await page.locator('#rec-text').inputValue();
  await page.click('#rec-keep');
  // Back in the exercise, the take is under Recordings (not in the notes below).
  const takes = page.locator('#x-takes .note');
  await expect(takes).toHaveCount(1);
  await expect(takes).toContainText(label);
  await expect(takes.locator('.clip-pill')).toHaveCount(1);
  await expect.poll(async () => {
    const { state } = await ui.saved();
    return state.diary[0]?.itemId === state.items.find((t) => t.name === 'Major scale').id;
  }).toBe(true);
  await ui.expectNoSideScroll();
});

test('record from a card in today’s set: the take goes with that exercise @narrow', async ({ page, ui }) => {
  await ui.start();
  const card = page.locator('.card.b-exercise', { has: page.locator('.keychip') }).first();
  const id = await card.getAttribute('data-item-id');
  await card.locator('.rec-chip').click();
  await record(page, 1000);
  await expect(page.locator('#rec-tune')).toHaveValue(await card.locator('h2').textContent());
  await expect(page.locator('#rec-text')).not.toHaveValue('');
  await page.click('#rec-keep');
  await expect(card.locator('.rec-chip')).toHaveText('1'); // one take today
  await expect.poll(async () => (await ui.saved()).state.diary[0]?.itemId).toBe(id);
  await page.screenshot({ path: test.info().outputPath('card.png') });
  await ui.expectNoSideScroll();
});

test('record while the metronome plays (Safari only allows the mic in a play-and-record session)', async ({ page, ui }) => {
  await page.addInitScript(() => {
    // Like Safari: an audio session, and no mic while it's set to playback only.
    const session = { type: 'auto', log: [] };
    Object.defineProperty(navigator, 'audioSession', { value: new Proxy(session, { set: (o, k, v) => { o[k] = v; if (k === 'type') o.log.push(v); return true; } }) });
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => (session.type === 'playback'
      ? Promise.reject(new DOMException('Not allowed in a playback session', 'NotAllowedError')) : gum(c));
  });
  await ui.start();
  await page.click('#today-metro');
  await page.click('#m-go');
  await ui.backdrop();
  await page.click('#today-rec');
  await record(page, 800);
  await expect(page.locator('.rec-stage.review audio')).toHaveCount(1);
  await page.click('#rec-discard');
  // Back to playback for the metronome alone once the recorder closes; still clicking.
  expect(await page.evaluate(() => navigator.audioSession.log)).toEqual(['playback', 'play-and-record', 'playback']);
  await expect(page.locator('#today-metro')).toHaveClass(/\blive\b/);
});

test('a recording can be deleted from the list it’s in, with undo', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-rec');
  await record(page, 800);
  await page.fill('#rec-text', 'Take one');
  await page.click('#rec-keep');
  await ui.tab('diary');
  const note = page.locator('.note', { hasText: 'Take one' });
  await expect(note).toHaveCount(1);
  await note.locator('.note-rm').click();
  await expect(note).toHaveCount(0);
  await expect.poll(async () => (await ui.saved()).state.diary.length).toBe(0);
  await page.click('#toast button'); // Undo
  await expect(note).toHaveCount(1);
  await expect.poll(async () => (await ui.saved()).state.diary.length).toBe(1);
});

test('a mic that gives two channels with sound only in the left still records a take for both ears', async ({ page, ui }) => {
  await page.addInitScript(() => {
    // Like an iPhone with voice processing off: stereo, the sound in the left channel only.
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const merge = ctx.createChannelMerger(2);
      osc.connect(merge, 0, 0); // left only
      const dest = ctx.createMediaStreamDestination();
      dest.channelCount = 2;
      merge.connect(dest);
      osc.start();
      return dest.stream;
    };
  });
  await ui.start();
  await page.click('#today-rec');
  await record(page, 1500);
  await page.click('#rec-keep');
  await expect.poll(async () => (await ui.saved()).clipIds.length).toBe(1);
  // Decode the saved take: one channel, with the sound in it.
  const { channels, peak } = await page.evaluate(() => new Promise((resolve) => {
    const q = indexedDB.open('woodshed');
    q.onsuccess = () => {
      const g = q.result.transaction('media').objectStore('media').getAll();
      g.onsuccess = async () => {
        const buf = await new AudioContext().decodeAudioData(await g.result[0].arrayBuffer());
        const data = buf.getChannelData(buf.numberOfChannels - 1); // the last channel too has sound
        resolve({ channels: buf.numberOfChannels, peak: Math.max(...data.slice(buf.sampleRate * 0.3).map(Math.abs)) });
      };
    };
  }));
  expect(channels).toBe(1);
  expect(peak).toBeGreaterThan(0.1);
});

test('deleting the recording on a note you wrote keeps the note', async ({ page, ui }) => {
  await ui.start();
  await page.click('#today-note');
  await page.fill('#n-text', 'Bridge is rushing — record it');
  await page.click('#n-record');
  await record(page, 800);
  await page.click('#rec-keep');
  await ui.backdrop(); // the note reopens after; close it
  await ui.tab('diary');
  const note = page.locator('.note', { hasText: 'Bridge is rushing' });
  await expect(note.locator('.clip-pill')).toHaveCount(1);
  await note.locator('.note-rm').click();
  await expect(note).toHaveCount(1); // still there, without the recording
  await expect(note.locator('.clip-pill')).toHaveCount(0);
  await expect(note.locator('.note-rm')).toHaveCount(0);
  await page.click('#toast button'); // Undo
  await expect(note.locator('.clip-pill')).toHaveCount(1);
});
