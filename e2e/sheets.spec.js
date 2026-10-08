import { test, expect } from './app.js';

// A finger drag on an element: touchstart, moves over `ms`, touchend.
async function touchDrag(page, selector, dy, { ms = 300, steps = 8, at = 0.5 } = {}) {
  await page.evaluate(async ({ selector, dy, ms, steps, at }) => {
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y0 = r.top + Math.min(r.height * at, 60);
    const touch = (y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    const fire = (type, y) => el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [touch(y)], changedTouches: [touch(y)],
    }));
    fire('touchstart', y0);
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, ms / steps));
      fire('touchmove', y0 + (dy * i) / steps);
    }
    fire('touchend', y0 + dy);
  }, { selector, dy, ms, steps, at });
  await page.waitForTimeout(350);
}

test('a sheet closes with its ×, by pulling it down from anywhere at its top, or a flick @narrow', async ({ page, ui }) => {
  await ui.start();
  const open = async () => {
    await page.locator('.card h2').first().click();
    await page.waitForTimeout(350); // sliding up
  };
  const sheet = page.locator('#sheet-root.open .sheet');

  await open();
  await expect(sheet).toBeVisible();
  await page.click('.sheet-x');
  await expect(sheet).toHaveCount(0);

  // Pulled down from the middle of its content (scrolled to the top): far enough closes it.
  await open();
  await touchDrag(page, '.sheet-body .field-label', 200);
  await expect(sheet).toHaveCount(0);

  // Not far, slowly: it springs back.
  await open();
  await touchDrag(page, '.sheet-body .field-label', 60, { ms: 600 });
  await expect(sheet).toBeVisible();
  await expect.poll(() => sheet.evaluate((s) => s.style.transform)).toBe('');

  // A quick flick closes it.
  await touchDrag(page, '.sheet-grab', 70, { ms: 60, steps: 3 });
  await expect(sheet).toHaveCount(0);
});

test('pulling down inside scrolled content scrolls it rather than closing the sheet', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card h2').first().click();
  const body = page.locator('.sheet-body');
  await page.waitForTimeout(350);
  await body.evaluate((b) => { b.scrollTop = 200; });
  await touchDrag(page, '.sheet-body .field-label', 200);
  await expect(page.locator('#sheet-root.open .sheet')).toBeVisible();
  // And typing in a field never drags the sheet.
  await body.evaluate((b) => { b.scrollTop = 0; });
  await touchDrag(page, '.sheet-body textarea', 200);
  await expect(page.locator('#sheet-root.open .sheet')).toBeVisible();
});

test('dragging the handle with a mouse closes it', async ({ page, ui }) => {
  await ui.start();
  await page.locator('.card h2').first().click();
  await page.waitForTimeout(350);
  const box = await page.locator('.sheet-grab').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2, box.y + 10 + i * 25);
  await page.mouse.up();
  await expect(page.locator('#sheet-root.open .sheet')).toHaveCount(0);
});
