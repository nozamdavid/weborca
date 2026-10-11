#!/usr/bin/env node
/**
 * Browser test of Configuration Wizard dialog:
 * - opens via File > Configuration wizard, picks Voron + a printer + two filaments,
 *   Finishes, and asserts that the selected printer in __appStore changed and
 *   localStorage has the chosen printers and filaments.
 * - creates custom printer with rectangular bed.
 * - creates custom printer with circular 72-point bed and validates geometry.
 * - creates custom printer with valid polygonal bed.
 * - tests rejected inputs: self-intersection, zero area, non-finite, <3 distinct points,
 *   empty coordinates, max point count, invalid diameter.
 * - tests BedAssetsSettings resetOption behavior.
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

    // 1. Standard vendor wizard flow
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

    // 2. Custom printer: rectangular
    log('create a custom printer with rectangular bed dimensions and nozzle size');
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Configuration wizard' }).first().click();
    await page.waitForSelector('#wizard-dialog');
    await page.check('#wizard-custom-printer');
    await page.waitForSelector('#wizard-custom-shape');
    await page.fill('#wizard-custom-name', 'My custom printer');
    await page.selectOption('#wizard-custom-shape', 'rectangular');
    await page.fill('#wizard-custom-x', '220');
    await page.fill('#wizard-custom-y', '180');
    await page.fill('#wizard-custom-z', '240');
    await page.fill('#wizard-custom-nozzle', '0.6');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-dialog', { state: 'detached' });
    const customRect = await page.evaluate(() => {
      const app = window.__appStore.getState();
      return { name: app.activeUserPreset.printer, config: app.currentConfig, error: app.engineError };
    });
    assert.equal(customRect.error, null);
    assert.equal(customRect.name, 'My custom printer');
    assert.equal(customRect.config.printable_area, '0x0,220x0,220x180,0x180');
    assert.equal(Number(customRect.config.printable_height), 240);
    assert.equal(Number(customRect.config.nozzle_diameter), 0.6);

    // 3. Custom printer: circular bed
    log('create a custom printer with circular 72-point bed');
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Configuration wizard' }).first().click();
    await page.waitForSelector('#wizard-dialog');
    await page.check('#wizard-custom-printer');
    await page.waitForSelector('#wizard-custom-shape');
    await page.fill('#wizard-custom-name', 'My Circular Delta');
    await page.selectOption('#wizard-custom-shape', 'circular');
    await page.fill('#wizard-custom-diameter', '200');
    await page.fill('#wizard-custom-z', '260');
    await page.fill('#wizard-custom-nozzle', '0.4');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-dialog', { state: 'detached' });

    const customCirc = await page.evaluate(() => {
      const app = window.__appStore.getState();
      return { name: app.activeUserPreset.printer, config: app.currentConfig, error: app.engineError };
    });
    assert.equal(customCirc.error, null);
    assert.equal(customCirc.name, 'My Circular Delta');
    assert.equal(Number(customCirc.config.printable_height), 260);

    const circPoints = customCirc.config.printable_area.split(',');
    assert.equal(circPoints.length, 72, 'circular printable_area must contain exactly 72 points');
    for (const pt of circPoints) {
      const [x, y] = pt.split('x').map(Number);
      assert.ok(Number.isFinite(x) && Number.isFinite(y), 'all circular coordinates must be finite');
      const dist = Math.hypot(x, y);
      assert.ok(Math.abs(dist - 100) < 0.05, `point radius must be ~100 mm, got ${dist}`);
    }

    // 4. Custom printer: valid polygonal bed
    log('create a custom printer with valid polygonal bed');
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Configuration wizard' }).first().click();
    await page.waitForSelector('#wizard-dialog');
    await page.check('#wizard-custom-printer');
    await page.waitForSelector('#wizard-custom-shape');
    await page.fill('#wizard-custom-name', 'My Hexagon Printer');
    await page.selectOption('#wizard-custom-shape', 'polygonal');
    const validPoly = '0x0,150x0,200x100,100x200,0x150';
    await page.fill('#wizard-custom-polygon', validPoly);
    await page.fill('#wizard-custom-z', '280');
    await page.fill('#wizard-custom-nozzle', '0.4');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-dialog', { state: 'detached' });

    const customPoly = await page.evaluate(() => {
      const app = window.__appStore.getState();
      return { name: app.activeUserPreset.printer, config: app.currentConfig, error: app.engineError };
    });
    assert.equal(customPoly.error, null);
    assert.equal(customPoly.name, 'My Hexagon Printer');
    assert.equal(customPoly.config.printable_area, validPoly);

    // 5. Targeted rejected inputs testing
    log('testing rejected inputs for custom bed wizard');
    await page.locator('.menu-label', { hasText: 'File' }).first().click();
    await page.locator('.menu.open .menu-item', { hasText: 'Configuration wizard' }).first().click();
    await page.waitForSelector('#wizard-dialog');
    await page.check('#wizard-custom-printer');
    await page.waitForSelector('#wizard-custom-shape');

    // 5a. Self-intersecting polygon (bowtie)
    log('testing rejection of self-intersecting polygon (bowtie)');
    await page.selectOption('#wizard-custom-shape', 'polygonal');
    await page.fill('#wizard-custom-polygon', '0x0,100x100,100x0,0x100');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    const bowtieErr = await page.textContent('#wizard-error');
    assert.match(bowtieErr, /intersect/i, 'should reject self-intersecting polygon');
    assert.ok(await page.isVisible('#wizard-dialog'), 'dialog must remain open on error');

    // 5b. Collinear zero-area polygon
    log('testing rejection of zero-area collinear polygon');
    await page.click('#wizard-back-btn');
    await page.click('#wizard-back-btn');
    await page.fill('#wizard-custom-polygon', '0x0,50x0,100x0');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    const areaErr = await page.textContent('#wizard-error');
    assert.match(areaErr, /area/i, 'should reject zero-area polygon');

    // 5c. Fewer than 3 distinct points
    log('testing rejection of < 3 distinct points');
    await page.click('#wizard-back-btn');
    await page.click('#wizard-back-btn');
    await page.fill('#wizard-custom-polygon', '0x0,100x100,0x0');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    const distinctErr = await page.textContent('#wizard-error');
    assert.match(distinctErr, /distinct|3 points/i, 'should reject < 3 distinct points');

    // 5d. Non-finite / invalid format
    log('testing rejection of non-finite coordinates');
    await page.click('#wizard-back-btn');
    await page.click('#wizard-back-btn');
    await page.fill('#wizard-custom-polygon', '0x0,Infinityx100,100x100');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    const finiteErr = await page.textContent('#wizard-error');
    assert.match(finiteErr, /finite|valid/i, 'should reject non-finite coordinates');

    log('testing rejection of finite coordinates that overflow geometry calculations');
    await page.click('#wizard-back-btn');
    await page.click('#wizard-back-btn');
    await page.fill('#wizard-custom-polygon', '0x0,1e308x0,0x1e308');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    assert.match(await page.textContent('#wizard-error'), /between.*mm/i);

    // 5e. Empty coordinates
    log('testing rejection of empty coordinate chunks');
    await page.click('#wizard-back-btn');
    await page.click('#wizard-back-btn');
    await page.fill('#wizard-custom-polygon', '0x0,,100x100');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    const emptyErr = await page.textContent('#wizard-error');
    assert.match(emptyErr, /empty/i, 'should reject empty points');

    // 5f. Backtracking adjacent edges
    log('testing rejection of backtracking adjacent edges');
    await page.click('#wizard-back-btn');
    await page.click('#wizard-back-btn');
    await page.fill('#wizard-custom-polygon', '0x0,100x0,50x0');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    const backtrackErr = await page.textContent('#wizard-error');
    assert.match(backtrackErr, /intersect|area/i, 'should reject backtracking adjacent edges');

    // 5g. Too many points (> 200 points)
    log('testing rejection of > 200 points');
    await page.click('#wizard-back-btn');
    await page.click('#wizard-back-btn');
    const tooMany = Array.from({ length: 205 }, (_, i) => `${i}x${i}`).join(',');
    await page.fill('#wizard-custom-polygon', tooMany);
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    const maxErr = await page.textContent('#wizard-error');
    assert.match(maxErr, /exceed|200 points/i, 'should reject > 200 points');

    // 5h. Negative diameter for circular bed
    log('testing rejection of negative circular diameter');
    await page.click('#wizard-back-btn');
    await page.click('#wizard-back-btn');
    await page.selectOption('#wizard-custom-shape', 'circular');
    await page.fill('#wizard-custom-diameter', '-50');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-next-btn');
    await page.click('#wizard-finish-btn');
    await page.waitForSelector('#wizard-error');
    const diamErr = await page.textContent('#wizard-error');
    assert.match(diamErr, /diameter/i, 'should reject non-positive diameter');

    // Close wizard
    await page.click('#wizard-close-x');
    await page.waitForSelector('#wizard-dialog', { state: 'detached' });

    // 6. BedAssetsSettings resetOption check
    log('testing BedAssetsSettings resetOption check');
    await page.evaluate(async () => {
      const app = window.__appStore.getState();
      await app.applyOptionChange('bed_custom_texture', 'data:image/svg+xml;base64,PHN2Zy8+', 'printer');
      await app.openDialog('printer');
    });
    await page.waitForSelector('[data-testid=\"printer-dialog\"]');
    await page.waitForSelector('#reset-bed_custom_texture');
    log('clicking reset option for bed_custom_texture');
    await page.click('#reset-bed_custom_texture');

    await page.waitForFunction(() => {
      const cfg = window.__appStore.getState().currentConfig;
      const presetCfg = window.__appStore.getState().presetConfig;
      return (cfg.bed_custom_texture || '') === (presetCfg.bed_custom_texture || '');
    }, null, { timeout: 10000 });

    const isResetGone = await page.$('#reset-bed_custom_texture');
    assert.equal(isResetGone, null, 'reset button should disappear once restored to preset default');

    await page.evaluate(() => window.__appStore.getState().closeDialog());
    await page.waitForSelector('[data-testid=\"printer-dialog\"]', { state: 'detached' });

    log('all checks passed successfully');
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
