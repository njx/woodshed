import { test, expect } from './app.js';

// A stand-in for the browser's speech recognition: `stuck` never starts (like iOS after its
// permission prompt); otherwise it starts and hears a phrase.
function fakeRecognition(page, { stuck }) {
  return page.addInitScript((stuck) => {
    window.SpeechRecognition = class {
      start() {
        if (stuck) return;
        setTimeout(() => this.onstart?.(), 50);
        setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'bridge is rushing' }], { isFinal: true })] }), 150);
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    };
  }, stuck);
}

test('dictating into a note', async ({ page, ui }) => {
  await fakeRecognition(page, { stuck: false });
  await ui.start();
  await page.click('#today-note');
  await page.click('#n-mic');
  await expect(page.locator('#n-text')).toHaveValue('bridge is rushing');
  await expect(page.locator('#n-mic')).toHaveClass(/\bon\b/); // still listening
  await page.click('#n-mic');
  await expect(page.locator('#n-mic')).not.toHaveClass(/\bon\b/);
});

test('dictation that never starts gives up rather than leave the note stuck', async ({ page, ui }) => {
  await fakeRecognition(page, { stuck: true });
  await ui.start();
  await page.click('#today-note');
  await page.click('#n-mic');
  await expect(page.locator('#n-mic')).toHaveClass(/\bon\b/);
  await expect(page.locator('#toast')).toContainText('Dictation didn’t start', { timeout: 9000 });
  await expect(page.locator('#n-mic')).not.toHaveClass(/\bon\b/);
  await page.fill('#n-text', 'typed instead'); // the note still works
  await page.click('#n-save');
  await expect.poll(async () => (await ui.saved()).state.diary[0]?.text).toBe('typed instead');
});
