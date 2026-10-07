import { test as base, expect } from '@playwright/test';

export { expect };

// Shared setup for every test:
// - errors in the page (uncaught exceptions, console errors) fail the test;
// - Math.random is seeded, so the daily set and key picks are the same on every run.
export const test = base.extend({
  pageErrors: [async ({ page }, use) => {
    const errors = [];
    const allowed = [/Failed to load resource/];
    errors.allow = (re) => allowed.push(re);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !allowed.some((re) => re.test(m.text()))) errors.push(m.text());
    });
    await use(errors);
    expect(errors.filter((e) => !allowed.some((re) => re.test(e))), 'errors on the page').toEqual([]);
  }, { auto: true }],

  seededRandom: [async ({ page }, use) => {
    await page.addInitScript(() => {
      let s = 20261006;
      Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    });
    await use();
  }, { auto: true }],

  ui: async ({ page }, use) => {
    await use(helpers(page));
  },
});

function helpers(page) {
  const ui = {
    // Open the app and get past the first-run instrument picker.
    async start({ instruments = [] } = {}) {
      await page.goto('./');
      for (const i of instruments) await page.click(`.welcome .chip[data-ins="${i}"]`);
      await page.click('#ins-done');
      await expect(page.locator('.card').first()).toBeVisible();
    },
    async tab(name) {
      await page.locator(`.tab[data-tab="${name}"]`).click();
      await expect(page.locator(`.tab[data-tab="${name}"]`)).toHaveClass(/\bon\b/);
    },
    // Close the open sheet by tapping outside it.
    async backdrop() {
      await page.evaluate(() => document.querySelector('.sheet-backdrop').click());
      await page.waitForTimeout(350); // closing animation, and any sheet it returns to
    },
    async swipe(locator, dx) {
      await locator.evaluate((el) => el.scrollIntoView({ block: 'center' })); // clear of the sticky header and tools
      await page.waitForTimeout(100);
      const box = await locator.boundingBox();
      // Start near the edge it moves away from, so a long swipe stays on screen.
      const x = box.x + box.width * (dx < 0 ? 0.92 : 0.08), y = box.y + 40;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + i * 0.5);
      await page.mouse.up();
      await page.waitForTimeout(400);
    },
    cardTitles: () => page.locator('.card h2').allTextContents(),
    // The page never scrolls sideways.
    async expectNoSideScroll() {
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
    },
    // Saved state and recorded clip ids, straight from IndexedDB.
    saved: () => page.evaluate(() => new Promise((resolve) => {
      const q = indexedDB.open('woodshed');
      q.onsuccess = () => {
        const t = q.result.transaction(['kv', 'media']);
        const s = t.objectStore('kv').get('state');
        const k = t.objectStore('media').getAllKeys();
        t.oncomplete = () => { resolve({ state: s.result, clipIds: k.result }); q.result.close(); };
      };
    })),
    // Change saved state directly (then reload to see it): fn(state) runs in the page.
    editSaved: (fn) => page.evaluate((src) => new Promise((resolve) => {
      const q = indexedDB.open('woodshed');
      q.onsuccess = () => {
        const t = q.result.transaction('kv', 'readwrite');
        const store = t.objectStore('kv');
        const g = store.get('state');
        g.onsuccess = () => { const s = g.result; new Function('s', src)(s); store.put(s, 'state'); };
        t.oncomplete = () => { resolve(); q.result.close(); };
      };
    }), `(${fn})(s)`),
  };
  return ui;
}
