#!/usr/bin/env node
/**
 * Targeted browser test: Verify Send to printer dialog is portaled to document.body,
 * rendered centered in viewport outside the transformed/clipped SliceStatsPanel,
 * properly manages focus, and supports dismissal (outside click, Escape, Close button).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5192', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE = fs.readFileSync(path.resolve(__dirname, '../../../tests/data/20mm_cube.obj'));

async function runSuite(browserType, browserName) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${browserName} pageerror]`, err));
  const log = (msg) => console.log(`[${browserName}] ${msg}`);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    log('set up presets and slice cube');
    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');

    // Add a local mock printer to connectionStore (DO NOT contact real printers)
    await page.evaluate(() => {
      window.__printerStore.getState().savePrinter({
        id: 'mock-printer-portal-test',
        name: 'Mock Test Printer',
        host_type: 'moonraker',
        print_host: '127.0.0.1:9999',
        use_gateway: false
      });
    });

    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj'));
    }, Array.from(CUBE));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
    await page.waitForFunction(() => !document.getElementById('slice-btn')?.disabled);
    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const s = window.__appStore.getState();
      return !s.isSlicing && s.sliceResult;
    }, null, { timeout: 180000 });

    log('switch to Preview tab and find SliceStatsPanel');
    await page.click('#tab-preview');
    const statsPanel = page.locator('.slice-stats-panel');
    await statsPanel.waitFor({ state: 'visible' });
    const statsBox = await statsPanel.boundingBox();
    assert.ok(statsBox, 'SliceStatsPanel should be visible');
    log(`SliceStatsPanel bounding box: x=${statsBox.x}, y=${statsBox.y}, width=${statsBox.width}, height=${statsBox.height}`);

    log('click Send to Printer button inside SliceStatsPanel');
    await page.getByRole('button', { name: /Send to Printer/ }).click();
    const dlg = page.locator('#send-to-printer-dialog');
    await dlg.waitFor({ state: 'visible' });

    log('verify dialog DOM location: direct child of document.body via Portal');
    const isDirectBodyChild = await page.evaluate(() => {
      const el = document.getElementById('send-to-printer-dialog');
      return el?.parentElement === document.body;
    });
    assert.equal(isDirectBodyChild, true, 'Dialog backdrop must be rendered as direct child of document.body');

    log('verify dialog backdrop covers full viewport');
    const viewport = page.viewportSize();
    const backdropBox = await dlg.boundingBox();
    assert.equal(backdropBox.x, 0);
    assert.equal(backdropBox.y, 0);
    assert.equal(backdropBox.width, viewport.width);
    assert.equal(backdropBox.height, viewport.height);

    log('verify modal content is centered in screen and outside stats box bounds');
    const modalContent = dlg.locator('.modal-content');
    const modalBox = await modalContent.boundingBox();
    assert.ok(modalBox, 'modal content bounding box must exist');
    log(`modalContent bounding box: x=${modalBox.x}, y=${modalBox.y}, width=${modalBox.width}, height=${modalBox.height}`);

    const modalCenterX = modalBox.x + modalBox.width / 2;
    assert.ok(
      Math.abs(modalCenterX - viewport.width / 2) < 15,
      `Modal should be centered horizontally: got center ${modalCenterX}, expected ~${viewport.width / 2}`
    );
    assert.ok(
      modalBox.width >= 380,
      `Modal width ${modalBox.width} should be at least 380px (minWidth)`
    );
    assert.ok(
      modalBox.x < statsBox.x,
      `Modal left edge (${modalBox.x}) must extend beyond stats box left edge (${statsBox.x}), proving no parent clipping`
    );

    log('verify focus is in dialog input');
    const activeId = await page.evaluate(() => document.activeElement?.id);
    assert.equal(activeId, 'send-filename', 'Filename input should have active focus on open');

    const screenshotDir = path.resolve(__dirname, 'screenshots');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.resolve(screenshotDir, `send-to-printer-${browserName}.png`);
    await page.screenshot({ path: screenshotPath });
    log(`saved screenshot to ${screenshotPath}`);

    log('verify dismissal: click inside modal content does not close dialog');
    await modalContent.locator('h3').click();
    assert.equal(await dlg.count(), 1, 'Clicking inside must not dismiss');

    log('verify dismissal: click outside (on backdrop) closes dialog');
    await page.mouse.click(10, 10);
    await dlg.waitFor({ state: 'detached' });
    log('dialog dismissed via outside click');

    log('verify dismissal: Escape key closes dialog');
    await page.evaluate(() => window.__printerStore.getState().openSendDialog());
    await dlg.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
    log('dialog dismissed via Escape key');

    log('verify dismissal: Close button closes dialog');
    await page.evaluate(() => window.__printerStore.getState().openSendDialog());
    await dlg.waitFor({ state: 'visible' });
    await page.click('#send-close');
    await dlg.waitFor({ state: 'detached' });
    log('dialog dismissed via Close button');

    log('all checks passed successfully');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'send-to-printer-dialog');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('Send to printer dialog portal and dismissal tests PASSED on Chromium and Firefox.');
} catch (err) {
  console.error('Send to printer dialog tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
