#!/usr/bin/env node
/** Browser test of reordering objects by dragging their rows in the Objects list. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5131', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const order = () => page.evaluate(() => window.__plateStore.getState().objects.map((o) => o.id));

  const expectList = (want) => page.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('[data-testid^="object-row-"]')].map((e) => Number(e.dataset.testid.replace('object-row-', '')))) === JSON.stringify(w), want, { timeout: 20000 });

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.waitForTimeout(2000);
    for (let n = 1; n <= 3; n++) {
      log('add cube ' + n);
      await page.mouse.click(1000, 300, { button: 'right' });
      await page.hover('#plate-menu-primitive');
      await page.click('#plate-menu-cube');
      await page.waitForFunction((c) => window.__plateStore.getState().objects.length === c, n, { timeout: 120000 });
      await page.evaluate((i) => { const s = window.__plateStore.getState(); const o = s.objects[i]; return s.setInstanceTransform(o.id, o.instances[0].id, { offset: [-100 + i * 60, -100, 0] }); }, n - 1);
      await page.waitForTimeout(500);
    }
    const [a, b, c] = await order();
    // Undo reloads the model with new ids, so tell the cubes apart by name.
    await page.evaluate(async ([ids]) => {
      for (const [i, id] of ids.entries()) await window.__orcaEngine.call('renameObject', { objectId: id, name: `cube-${'ABC'[i]}` });
      await window.__plateStore.getState().refreshObjects();
    }, [[a, b, c]]);

    await expectList([a, b, c]);

    log('dragging the last row onto the top half of the first moves it to the front');
    await page.locator(`#object-row-${c}`).dragTo(page.locator(`#object-row-${a}`), { targetPosition: { x: 40, y: 2 } });
    await page.waitForFunction((want) => JSON.stringify(window.__plateStore.getState().objects.map((o) => o.id)) === JSON.stringify(want), [c, a, b]);
    await expectList([c, a, b]);

    log('dropping on the lower half puts it after the target');
    await page.locator(`#object-row-${c}`).dragTo(page.locator(`#object-row-${b}`), { targetPosition: { x: 40, y: 22 } });
    await page.waitForFunction((want) => JSON.stringify(window.__plateStore.getState().objects.map((o) => o.id)) === JSON.stringify(want), [a, b, c]);
    await expectList([a, b, c]);

    log('the reorder is an undoable step');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__plateStore.getState().objects.map((o) => o.name).join() === 'cube-C,cube-A,cube-B', null, { timeout: 20000 });
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'reorder');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All reorder tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Reorder tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
