#!/usr/bin/env node
/** Browser test: objects take the colour of the filament they are assigned to, and follow it when it changes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CUBE = fs.readFileSync(path.resolve(repoRoot, 'tests/data/20mm_cube.obj'));
const PORT = parseInt(process.env.PORT || '5135', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  /** The first vertex colour of the object's mesh, and the colour the slot `slot` should give it. */
  const meshColour = () => page.evaluate(() => {
    const scene = window.__plateScene;
    const geo = [...scene.geometries.values()][0];
    return [...geo.attributes.color.array.slice(0, 3)];
  });
  const slotColour = (slot) => page.evaluate((i) => {
    const css = window.__appStore.getState().currentConfig['filament_colour'].split(';')[i].trim().slice(0, 7);
    return new window.__plateScene.defaultMaterial.color.constructor(css).toArray();
  }, slot);
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.waitForTimeout(2000);
    await page.evaluate(async (bytes) => window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'cube.obj')), Array.from(CUBE));
    await page.waitForFunction(() => window.__objectListStore?.getState().objects.length === 1, null, { timeout: 60000 });

    log('a new object has the colour of the first filament');
    await page.waitForFunction(() => window.__plateScene && [...window.__plateScene.geometries.values()][0]?.attributes.color);
    await page.waitForTimeout(500);
    assert.ok(close(await meshColour(), await slotColour(0)), `${await meshColour()} vs ${await slotColour(0)}`);

    log('assigning it to filament 2 recolours it with that filament');
    await page.click('#add-filament-btn');
    await page.waitForFunction(() => window.__appStore.getState().selectedFilaments.length === 2 && window.__appStore.getState().currentConfig['filament_colour'].includes(';'));
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('filament_colour', '#009688;#e53935', 'filament'));
    await page.waitForFunction(() => window.__appStore.getState().currentConfig['filament_colour'] === '#009688;#e53935');
    const objectId = await page.evaluate(() => window.__objectListStore.getState().objects[0].id);
    await page.evaluate((id) => window.__objectListStore.getState().setObjectExtruder(id, 2), objectId);
    await page.waitForFunction(([want]) => {
      const a = [...window.__plateScene.geometries.values()][0].attributes.color.array;
      return Math.abs(a[0] - want[0]) < 0.01 && Math.abs(a[1] - want[1]) < 0.01 && Math.abs(a[2] - want[2]) < 0.01;
    }, [await slotColour(1)], { timeout: 20000 });
    assert.ok(!close(await slotColour(0), await slotColour(1)));

    log('changing that filament colour repaints the object');
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('filament_colour', '#009688;#1e88e5', 'filament'));
    await page.waitForFunction(([want]) => {
      const a = [...window.__plateScene.geometries.values()][0].attributes.color.array;
      return Math.abs(a[0] - want[0]) < 0.01 && Math.abs(a[2] - want[2]) < 0.01;
    }, [await slotColour(1)], { timeout: 20000 });
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'filamentcolors');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All filament colour tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Filament colour tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
