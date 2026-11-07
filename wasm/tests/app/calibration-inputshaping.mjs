#!/usr/bin/env node
/**
 * Browser test of the input shaping (frequency, damping) and cornering calibrations, Chromium then Firefox:
 * the dialogs' defaults and validation (desktop's calib_dlg.cpp), the G-code ramps they produce, cancel,
 * and undo back to the original project.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5112', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE = fs.readFileSync(path.resolve(__dirname, '../../../tests/data/20mm_cube.obj'));

const series = (gcode, pattern) => {
  const values = [...gcode.matchAll(pattern)].map((m) => +m[1]);
  return values.filter((v, i) => i === 0 || v !== values[i - 1]);
};
const assertRamp = (values, start, end, tolerance, what) => {
  assert.ok(values.length > 20, `${what}: expected a ramp, got ${values.length} values`);
  assert.ok(Math.abs(values[0] - start) < 1e-6, `${what} starts at ${start}, got ${values[0]}`);
  assert.ok(Math.abs(values.at(-1) - end) <= tolerance, `${what} ends near ${end}, got ${values.at(-1)}`);
  values.slice(1).forEach((v, i) => assert.ok(v >= values[i], `${what} never goes down`));
};

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  const dialog = page.locator('.modal-content');
  const field = (label) => dialog.locator(`input[aria-label="${label}"]`);
  const value = (label) => field(label).inputValue();
  const open = (mode) => page.evaluate((m) => window.__inputShapingStore.getState().openDialog(m), mode);
  const objectNames = () => page.evaluate(() => window.__plateStore.getState().objects.map((o) => o.name));
  const pressOk = () => dialog.locator('.btn-primary').click();
  const cancel = () => dialog.locator('.btn-secondary').click();

  async function runAndSlice() {
    await pressOk();
    await page.waitForFunction(() => !document.querySelector('.modal-content .btn-primary') || document.querySelector('.modal-content .error-message'), null, { timeout: 120000 });
    assert.equal(await dialog.count(), 0, 'the dialog closes when the calibration is set up');
    await page.click('#tab-prepare'); // the Slice button lives in the Prepare sidebar
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
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');
    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj'));
    }, Array.from(CUBE));
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
    const original = await objectNames();

    log('frequency test: defaults, validation and cancel');
    await open('freq');
    assert.equal(await dialog.locator('h2').innerText(), 'Input shaping Frequency test');
    assert.deepEqual(await Promise.all(['X start', 'X end', 'Y start', 'Y end', 'Damp'].map(value)), ['15', '110', '15', '110', '0.150']);
    assert.equal(await dialog.getByRole('radio', { name: 'Ringing Tower' }).isChecked(), true);
    assert.deepEqual(await dialog.getByRole('radiogroup', { name: 'Input shaper type' }).getByRole('radio').count(), 7, 'Klipper offers seven shaper types');
    assert.match(await dialog.innerText(), /Klipper version => 0\.9\.0/);

    await field('X end').fill('600');
    await pressOk();
    assert.match(await dialog.locator('.error-message').innerText(), /0 < FreqStart < FreqEnd < 500/);
    await field('X end').fill('110');
    await field('Damp').fill('1');
    await pressOk();
    assert.match(await dialog.locator('.error-message').innerText(), /valid damping factor/);
    assert.deepEqual(await objectNames(), original, 'invalid input changes nothing');
    await cancel();
    assert.equal(await dialog.count(), 0);
    assert.deepEqual(await objectNames(), original);

    log('frequency test: the G-code ramps from the start to the end frequency');
    await open('freq');
    await field('X end').fill('60');
    await field('Y end').fill('60');
    const freq = await runAndSlice();
    assertRamp(series(freq, /SHAPER_FREQ_X=([0-9.]+) SHAPER_FREQ_Y=[0-9.]+/g), 15, 60, 0.7, 'shaper frequency');
    assert.deepEqual(series(freq, /SET_INPUT_SHAPER DAMPING_RATIO_X=([0-9.]+)/g), [0.15]);

    log('undo returns to the original project');
    await page.evaluate(() => window.__historyStore.getState().undo());
    await page.waitForFunction((names) => JSON.stringify(window.__plateStore.getState().objects.map((o) => o.name)) === JSON.stringify(names), original, { timeout: 30000 });

    log('damping test: defaults, validation and ramp');
    await open('damp');
    assert.equal(await dialog.locator('h2').innerText(), 'Input shaping Damp test');
    assert.deepEqual(await Promise.all(['Frequency X', 'Frequency Y', 'Damp start', 'Damp end'].map(value)), ['30', '30', '0.000', '0.400']);
    await field('Damp end').fill('1.5');
    await pressOk();
    assert.match(await dialog.locator('.error-message').innerText(), /0 <= DampingStart < DampingEnd <= 1/);
    await field('Damp end').fill('0.15');
    await field('Damp start').fill('0.05');
    await dialog.getByRole('radio', { name: 'MZV', exact: true }).check();
    const damp = await runAndSlice();
    assert.ok(damp.includes('SET_INPUT_SHAPER SHAPER_TYPE=MZV SHAPER_FREQ_X=30.00'));
    assertRamp(series(damp, /SET_INPUT_SHAPER DAMPING_RATIO_X=([0-9.]+) DAMPING_RATIO_Y=[0-9.]+/g), 0.05, 0.15, 0.003, 'damping ratio');
    await page.evaluate(() => window.__historyStore.getState().undo());
    await page.waitForFunction((names) => JSON.stringify(window.__plateStore.getState().objects.map((o) => o.name)) === JSON.stringify(names), original, { timeout: 30000 });

    log('cornering test: defaults, validation and ramp');
    await open('cornering');
    assert.equal(await dialog.locator('h2').innerText(), 'Cornering test');
    assert.deepEqual(await Promise.all(['Start', 'End'].map(value)), ['1.000', '15.000']);
    assert.equal(await dialog.getByRole('radio').count(), 3, 'Ringing Tower, Fast Tower and SCV-V2');
    await field('End').fill('150');
    await pressOk();
    assert.match(await dialog.locator('.error-message').innerText(), /0 <= Cornering <= 100\.000/);
    await field('End').fill('10');
    await dialog.getByRole('radio', { name: 'SCV-V2' }).check();
    const corner = await runAndSlice();
    assertRamp(series(corner, /SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=([0-9.]+)/g), 1, 10, 0.3, 'square corner velocity');

    log('a normal slice afterwards has no calibration ramp');
    await page.evaluate(() => window.__historyStore.getState().undo());
    await page.waitForFunction((names) => JSON.stringify(window.__plateStore.getState().objects.map((o) => o.name)) === JSON.stringify(names), original, { timeout: 30000 });
    await page.click('#tab-prepare');
    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const s = window.__appStore.getState();
      return !s.isSlicing && s.sliceResult;
    }, null, { timeout: 180000 });
    const clean = await page.evaluate(() => new TextDecoder().decode(window.__appStore.getState().sliceResult.gcode));
    assert.ok(series(clean, /SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=([0-9.]+)/g).length <= 1);
    assert.ok(series(clean, /SHAPER_FREQ_X=([0-9.]+)/g).length <= 1);

    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'calibration-inputshaping');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All input shaping and cornering tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Input shaping tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
