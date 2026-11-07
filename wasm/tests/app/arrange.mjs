#!/usr/bin/env node
/** Browser test of the arrange options dialog: spacing and rotation are saved and used by Arrange. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const PORT = parseInt(process.env.PORT || '5126', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const gap = () => page.evaluate(() => {
    const [a, b] = window.__plateStore.getState().objects;
    return Math.max(Math.abs(a.instances[0].offset[0] - b.instances[0].offset[0]) - a.size[0], Math.abs(a.instances[0].offset[1] - b.instances[0].offset[1]) - a.size[1]);
  });
  const addCube = async (count) => {
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction((n) => window.__plateStore.getState().objects.length === n, count, { timeout: 120000 });
  };

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.waitForTimeout(2000);
    await addCube(1);
    await page.evaluate(() => { const s = window.__plateStore.getState(); return s.setInstanceTransform(s.objects[0].id, s.objects[0].instances[0].id, { offset: [20, 20, 0] }); });
    await addCube(2);

    log('Arrange options opens from the Edit menu and Arrange uses the spacing');
    await page.locator('.menu-label', { hasText: 'Edit' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Arrange options' }).first().click();
    await page.waitForSelector('#arrange-dialog');
    await page.fill('#arrange-spacing', '35');
    await page.click('#arrange-run');
    await page.waitForSelector('#arrange-dialog', { state: 'detached' });
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 2);
    await page.waitForTimeout(1500);
    assert.ok((await gap()) >= 34, `gap ${await gap()}`);

    log('the settings are remembered, and an invalid spacing is refused');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('orca.arrange'))), { spacing: 35, allowRotations: false });
    await page.locator('.menu-label', { hasText: 'Edit' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Arrange options' }).first().click();
    assert.equal(await page.inputValue('#arrange-spacing'), '35');
    await page.fill('#arrange-spacing', 'abc');
    assert.equal(await page.locator('#arrange-run').isDisabled(), true);
    await page.click('#arrange-cancel');
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'arrange');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All arrange tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Arrange tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
