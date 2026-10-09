#!/usr/bin/env node
/**
 * Browser test for the desktop calibration tools (PA, temperature tower, VFA, ...),
 * Chromium then Firefox: dialog defaults from calib_dlg.cpp, calibration G-code values,
 * cancel, rollback on failure, and undo back to a clean project.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const PORT = parseInt(process.env.PORT || '5092', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE = fs.readFileSync(path.join(repoRoot, 'tests/data/20mm_cube.obj'));

const range = (start, end, step) => {
  const n = Math.round(Math.abs(end - start) / step);
  return Array.from({ length: n + 1 }, (_, i) => +(start + Math.sign(end - start) * i * step).toFixed(4));
};
const paValues = (g) => [...new Set([...g.matchAll(/(?:SET_PRESSURE_ADVANCE ADVANCE=|M900 K)([0-9.]+)/g)].map((m) => +m[1]))];
const temps = (g) => [...new Set([...g.matchAll(/M104 S([0-9]+)/g)].map((m) => +m[1]))];
const feedrates = (g) => new Set([...g.matchAll(/ F([0-9.]+)/g)].map((m) => +m[1]));

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  const objectNames = () => page.evaluate(() => window.__plateStore.getState().objects.map((o) => o.name));
  const config = () => page.evaluate(() => window.__appStore.getState().currentConfig);
  const field = (label) => page.locator(`.modal-content input[aria-label="${label}"]`).inputValue();

  async function importCube() {
    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj'));
    }, Array.from(CUBE));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
  }

  async function openDialog(item) {
    await page.click('#other-calibration-btn');
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await page.waitForSelector('.modal-content .btn-primary');
  }

  // Runs the open dialog and waits for it to close (success) or show an error.
  async function confirm() {
    await page.click('.modal-content .btn-primary');
    await page.waitForFunction(
      () => !document.querySelector('.modal-content .btn-primary') || document.querySelector('.modal-content .error-message'),
      null,
      { timeout: 120000 }
    );
  }

  async function slice() {
    await page.waitForFunction(() => !document.getElementById('slice-btn')?.disabled);
    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const s = window.__appStore.getState();
      return !s.isSlicing && s.sliceResult;
    }, null, { timeout: 180000 });
    return page.evaluate(() => new TextDecoder().decode(window.__appStore.getState().sliceResult.gcode));
  }

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 60000 });
    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await importCube();
    const original = { names: await objectNames(), config: await config() };

    log('Cancel leaves the project untouched');
    await openDialog('Temp Tower');
    assert.equal(await field('Start Temperature'), '230');
    assert.equal(await field('End Temperature'), '190');
    await page.click('.modal-content .btn-secondary');
    assert.deepEqual(await objectNames(), original.names);
    assert.deepEqual(await config(), original.config);

    log('A failure after the plate was replaced rolls back');
    await page.evaluate(() => {
      const engine = window.__orcaEngine;
      const getConfig = engine.getConfig.bind(engine);
      engine.getConfig = async () => {
        engine.getConfig = getConfig;
        throw new Error('Simulated failure after setupCalibration');
      };
    });
    await openDialog('VFA');
    await confirm();
    assert.ok(await page.locator('.modal-content .error-message').isVisible(), 'failure must be reported');
    await page.click('.modal-content .btn-secondary');
    assert.deepEqual(await objectNames(), original.names);
    assert.equal((await config()).layer_height, original.config.layer_height);

    log('PA tower');
    await openDialog('PA Line');
    assert.equal(await field('Start PA'), '0');
    assert.equal(await field('End PA'), '0.1');
    assert.equal(await field('PA step'), '0.002');
    await page.selectOption('.modal-content select >> nth=0', 'tower');
    await confirm();
    assert.deepEqual(paValues(await slice()), range(0, 0.1, 0.002));

    log('Undo returns to the cube and a clean slice');
    await page.evaluate(() => window.__historyStore.getState().undo());
    await page.waitForFunction((names) => {
      const now = window.__plateStore.getState().objects.map((o) => o.name);
      return JSON.stringify(now) === JSON.stringify(names);
    }, original.names, { timeout: 30000 });
    assert.ok(paValues(await slice()).length <= 1, 'PA ramp must be gone after undo');

    log('Temperature tower');
    await openDialog('Temp Tower');
    await confirm();
    assert.deepEqual(temps(await slice()), range(230, 190, 5));

    log('VFA');
    await openDialog('VFA');
    assert.equal(await field('Start Speed'), '40');
    assert.equal(await field('End Speed'), '200');
    assert.equal(await field('Step'), '10');
    await confirm();
    const vfa = feedrates(await slice());
    // Generic PLA caps flow at 12 mm³/s, so (as on desktop) the 180-200 mm/s steps are slowed down.
    for (const speed of range(40, 170, 10)) assert.ok(vfa.has(speed * 60), `VFA ${speed} mm/s missing`);

    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'calibration-tools');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All calibration tool tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Calibration tool tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
