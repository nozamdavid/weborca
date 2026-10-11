#!/usr/bin/env node
/** Plate switching clears old toolpaths, and New Project starts a fresh Undo history. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5211);
const cube = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/data/20mm_cube.obj');

async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    console.log(`${browserType.name()}: initialize`);
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('#vendor-select')?.options.length > 1);
    console.log(`${browserType.name()}: prepare model`);
    await page.selectOption('#vendor-select', 'Voron');
    await page.waitForFunction(() => Array.from(document.querySelector('#printer-select')?.options || []).some(o => o.value === 'Voron 2.4 300 0.4 nozzle'));
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.setInputFiles('#model-file', cube);
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
    await page.evaluate(() => window.__platesStore.getState().addPlate());
    await page.click('#plate-tab-0');
    console.log(`${browserType.name()}: slice and switch plate`);
    await page.click('#slice-btn');
    await page.waitForFunction(() => !!window.__appStore.getState().sliceResult && !window.__appStore.getState().isSlicing, null, { timeout: 180000 });
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult.plateIndex), 0);
    await page.click('#tab-prepare');
    await page.click('#plate-tab-1');
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult), null);
    assert.equal(await page.evaluate(() => window.__appStore.getState().gcodeUrl), null);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: /^Export G-code\s*Ctrl\+G$/ }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#undo-btn').isDisabled(), false);
    await page.evaluate(async () => {
      await window.__platesStore.getState().setPlateConfig(0, { curr_bed_type: 'Textured PEI Plate' }, 'Old plate', true);
      await window.__appStore.getState().applyOptionChange('notes', 'Old project notes', 'print');
    });
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.locator('.menu-item').filter({ hasText: /^New project$/ }).click();
    await page.locator('[data-testid=confirm-ok]').click();
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 0 && !window.__historyStore.getState().canUndo);
    assert.equal(await page.locator('#undo-btn').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__platesStore.getState().plates.length), 1);
    const plate = await page.evaluate(() => window.__platesStore.getState().plates[0]);
    assert.equal(plate.locked, false);
    assert.notEqual(plate.name, 'Old plate');
    assert.deepEqual(plate.config, {});
    assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.notes), '');
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined, 'a cleared session is not recreated by a queued flush');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 0);
    const standaloneGcode = '; standalone\nG28\nG1 X10 Y10 Z0.2 E1 F1200\n';
    await page.setInputFiles('#gcode-file-input', { name: 'standalone.gcode', mimeType: 'text/plain', buffer: Buffer.from(standaloneGcode) });
    await page.waitForFunction(() => window.__appStore.getState().sliceResult?.gcodePath === 'standalone.gcode');
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult.plateIndex), 0);
    assert.equal(await page.evaluate(async () => await (await fetch(window.__appStore.getState().gcodeUrl)).text()), standaloneGcode);
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+g')]);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), standaloneGcode, 'export uses the imported file bytes');
    await page.evaluate(async () => {
      await window.__appStore.getState().applyOptionChange('notes', 'Empty project notes', 'print');
      await window.__platesStore.getState().addPlate('Empty custom plate');
    });
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
    await page.locator('[data-testid=confirm-ok]').click();
    await page.waitForFunction(() => window.__platesStore.getState().plates.length === 1 && window.__appStore.getState().currentConfig.notes === '' && !window.__historyStore.getState().canUndo);
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult), null);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined, 'an empty project can be closed without recreating its backup');
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: plate toolpath invalidation and fresh project history passed`);
  } catch (error) {
    console.error(await page.evaluate(() => ({ ready: window.__appStore?.getState().isEngineReady, error: window.__appStore?.getState().engineError, isolated: crossOriginIsolated, text: document.body.innerText.slice(0, 500) })), errors);
    throw error;
  } finally { await browser.close(); }
}

await startServer(port, 'project-boundaries');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
