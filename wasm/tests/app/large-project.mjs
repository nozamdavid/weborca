#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5164);
const model = fs.readFileSync(new URL('../../../tests/data/frog_legs.obj', import.meta.url));

async function run(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const started = Date.now();
  const ready = () => page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await ready();
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('autosave', false));
    await page.evaluate(async (bytes) => {
      await window.__appStore.getState().importModelFile(new File([new Uint8Array(bytes)], 'frog_legs.obj'));
      const engine = window.__orcaEngine;
      const [object] = await engine.call('listObjects', {});
      for (let i = 0; i < 55; i++) {
        await engine.call('duplicateInstance', { objectId: object.id, instanceId: object.instances[0].id });
      }
      await engine.call('arrange', { autoRotate: true });
      await window.__plateStore.getState().refreshObjects();
      await window.__platesStore.getState().fetchPlates();
      await window.__appStore.getState().applyOptionChange('notes', 'Recover all 56 frog instances', 'print');
    }, [...model]);
    const snapshot = () => page.evaluate(() => ({
      instances: window.__plateStore.getState().objects.reduce((count, object) => count + object.instances.length, 0),
      plates: window.__platesStore.getState().plates.map(plate => ({ index: plate.index, instances: plate.instances.length })),
      notes: window.__appStore.getState().currentConfig.notes,
      error: window.__appStore.getState().engineError
    }));
    const before = await snapshot();
    assert.equal(before.instances, 56);
    assert.equal(before.error, null);
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), true);
    const size = await page.evaluate(async () => (await window.__autosave.readAutosave()).bytes.length);
    assert.ok(size > 10000, 'backup contains the actual mesh');
    await page.reload();
    await ready();
    await page.waitForSelector('#recovery-dialog');
    await page.click('#recovery-restore');
    await page.waitForSelector('#recovery-dialog', { state: 'detached', timeout: 120000 });
    assert.deepEqual(await snapshot(), before, 'recovery preserves every instance, plate membership and notes');
    await page.evaluate(() => { void window.__appStore.getState().startSlice(); });
    await page.waitForFunction(() => !window.__appStore.getState().isSlicing, null, { timeout: 180000 });
    const sliced = await page.evaluate(() => ({
      error: window.__appStore.getState().engineError,
      layers: window.__appStore.getState().sliceResult?.layers,
      bytes: window.__appStore.getState().sliceResult?.gcode?.length
    }));
    assert.equal(sliced.error, null);
    assert.ok(sliced.layers > 0 && sliced.bytes > 100000, 'the recovered project produces substantive G-code');
    await page.waitForFunction(() => window.__previewStore?.getState().layersCount > 0, null, { timeout: 60000 });
    console.log(`[${name}] 56-instance project recovery, slicing and preview passed; backup ${size} bytes, G-code ${sliced.bytes} bytes, ${(Date.now() - started) / 1000}s`);
  } finally {
    await browser.close();
  }
}

await startServer(port, 'large-project');
try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopServer(port);
}
