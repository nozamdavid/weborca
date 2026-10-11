import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = 5276;
async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.mouse.click(900, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForSelector('[id^=object-row-]');
    for (const type of ['part', 'negative', 'modifier', 'support_blocker', 'support_enforcer', 'extruder']) {
      await page.locator('[id^=object-row-]').first().click({ button: 'right' });
      await page.hover(`#menu-item-${type}`);
      const action = type === 'extruder' ? '#menu-action-extruder-1' : `#menu-action-${type}-cube`;
      await page.waitForSelector(action);
      assert.equal(await page.locator(action).evaluate(e => {
        const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return e === hit || e.contains(hit);
      }), true, `${type} submenu is visible and receives pointer input`);
      const before = await page.evaluate(() => window.__objectListStore.getState().objects[0].volumes.length);
      await page.locator(action).click({ timeout: 3000 });
      await page.waitForSelector('#object-list-context-menu', { state: 'detached' });
      if (type !== 'extruder') await page.waitForFunction(n => window.__objectListStore.getState().objects[0].volumes.length === n + 1, before);
    }
    // The menu must flip left at the right edge and remain inside a short viewport.
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.locator('[id^=object-row-]').first().evaluate(e => e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1260, clientY: 390 })));
    await page.hover('#menu-item-part');
    const rect = await page.locator('#submenu-part').boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 1280 && rect.y >= 0 && rect.y + rect.height <= 400, 'flyout fits viewport');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#submenu-part', { state: 'detached' });
    console.log(`${browserType.name()}: all six flyouts open, actions work, edge positioning and Escape pass`);
  } finally { await browser.close(); }
}
await startServer(port, 'object-submenus');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
