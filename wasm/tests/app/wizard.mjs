#!/usr/bin/env node
/**
 * Browser test of Configuration Wizard dialog:
 * opens via File > Configuration wizard, picks Voron + a printer + two filaments,
 * Finishes, and asserts that the selected printer in __appStore changed and
 * localStorage has the chosen printers and filaments.
 */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5142', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    const initialPrinter = await page.evaluate(() => window.__appStore.getState().selectedPrinter);
    log(`initial selectedPrinter: "${initialPrinter}"`);

    // Ensure dialog does not auto-open when navigator.webdriver is true
    const autoDialog = await page.$('#wizard-dialog');
    assert.equal(autoDialog, null, 'wizard dialog should not auto-open when navigator.webdriver is true');

    log('File > Configuration wizard opens the wizard dialog');
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Configuration wizard' }).first().click();
    await page.waitForSelector('#wizard-dialog');

    log('pick Voron vendor and a printer');
    await page.selectOption('#wizard-vendor-select', 'Voron');
    await page.waitForSelector('.wizard-model-card');

    const targetPrinter = 'Voron 2.4 250 0.4 nozzle';
    assert.notEqual(targetPrinter, initialPrinter, 'target printer should differ from initial printer');

    const printerInput = page.locator(`input[value="${targetPrinter}"]`).first();
    await printerInput.waitFor({ state: 'attached' });
    await printerInput.check();

    log('proceed to Step 2');
    await page.click('#wizard-next-btn');
    await page.waitForSelector('#wizard-step-2');

    log('pick two filaments');
    await page.waitForSelector('.wizard-filament-item');
    await page.click('#wizard-filament-select-none');

    const fil1 = 'Generic PLA @System';
    const fil2 = 'Generic PETG @System';
    await page.locator(`input[value="${fil1}"]`).first().check();
    await page.locator(`input[value="${fil2}"]`).first().check();

    log('proceed to Step 3');
    await page.click('#wizard-next-btn');
    await page.waitForSelector('#wizard-step-3');

    log('click Finish');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-dialog', { state: 'detached' });

    log('assert selected printer in __appStore changed');
    await page.waitForFunction(
      (expected) => window.__appStore.getState().selectedPrinter === expected,
      targetPrinter,
      { timeout: 15000 }
    );
    const currentPrinter = await page.evaluate(() => window.__appStore.getState().selectedPrinter);
    assert.equal(currentPrinter, targetPrinter, `selectedPrinter should be "${targetPrinter}"`);

    log('assert localStorage has choices');
    const wizardChoices = await page.evaluate(() => {
      const raw = localStorage.getItem('orca.wizard');
      return raw ? JSON.parse(raw) : null;
    });
    assert.ok(wizardChoices, 'localStorage should have "orca.wizard" entry');
    assert.ok(Array.isArray(wizardChoices.printers), 'orca.wizard.printers should be an array');
    assert.ok(wizardChoices.printers.includes(targetPrinter), `printers should contain "${targetPrinter}"`);
    assert.ok(Array.isArray(wizardChoices.filaments), 'orca.wizard.filaments should be an array');
    assert.ok(wizardChoices.filaments.includes(fil1), `filaments should contain "${fil1}"`);
    assert.ok(wizardChoices.filaments.includes(fil2), `filaments should contain "${fil2}"`);

    const filamentOptions = await page.locator('#filament-select option').evaluateAll(options => options.map(o => o.value));
    assert.ok(filamentOptions.includes(fil1));
    assert.ok(filamentOptions.includes(fil2));
    assert.ok(!filamentOptions.includes('Generic ABS @System'), 'wizard excludes unselected filaments');

    log('create a custom printer with bed dimensions and nozzle size');
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Configuration wizard' }).first().click();
    await page.check('#wizard-custom-printer');
    await page.fill('#wizard-custom-name', 'My custom printer');
    await page.fill('#wizard-custom-x', '220');
    await page.fill('#wizard-custom-y', '180');
    await page.fill('#wizard-custom-z', '240');
    await page.fill('#wizard-custom-nozzle', '0.6');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-dialog', { state: 'detached' });
    const custom = await page.evaluate(() => {
      const app = window.__appStore.getState();
      return { name: app.activeUserPreset.printer, config: app.currentConfig, error: app.engineError };
    });
    assert.equal(custom.error, null);
    assert.equal(custom.name, 'My custom printer');
    assert.equal(custom.config.printable_area, '0x0,220x0,220x180,0x180');
    assert.equal(Number(custom.config.printable_height), 240);
    assert.equal(Number(custom.config.nozzle_diameter), 0.6);
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'wizard');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All wizard tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Wizard tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
