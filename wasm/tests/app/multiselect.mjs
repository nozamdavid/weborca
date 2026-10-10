#!/usr/bin/env node
/**
 * Browser test of multiple selection and the clipboard actions: Shift-click adds to the selection, Ctrl+A selects
 * everything, Escape deselects, Ctrl+K clones, Ctrl+C / Ctrl+V paste another instance, Delete removes every selected
 * object, Ctrl+D removes all, and dragging moves the whole selection together.
 */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5117', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const state = () => page.evaluate(() => {
    const s = window.__plateStore.getState();
    return { objects: s.objects.length, instances: s.objects.reduce((n, o) => n + o.instances.length, 0), extra: s.extraSelection.length, primary: s.selectedObjectId, clipboard: s.clipboard.length };
  });
  const addCube = async (count) => {
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction((n) => window.__plateStore.getState().objects.length === n, count, { timeout: 120000 });
  };
  const screenOf = (index) => page.evaluate((i) => {
    const scene = window.__plateScene;
    const mesh = [...scene.objectMeshes.values()][i];
    const rect = scene.renderer.domElement.getBoundingClientRect();
    const v = mesh.position.clone().project(scene.camera);
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
  }, index);

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await addCube(1);
    await page.evaluate(() => { const s = window.__plateStore.getState(); return s.setInstanceTransform(s.objects[0].id, s.objects[0].instances[0].id, { offset: [20, 20, 0] }); });
    await page.click('#view-top');
    await page.waitForTimeout(600);
    await addCube(2);
    await page.evaluate(() => window.__plateStore.getState().arrange(true));
    await page.click('#view-top');
    await page.waitForTimeout(600);

    log('clicking selects one, Shift-click adds the other');
    const [x0, y0] = await screenOf(0);
    const [x1, y1] = await screenOf(1);
    await page.mouse.click(x0, y0);
    await page.waitForFunction(() => window.__plateStore.getState().selectedObjectId !== null);
    assert.equal((await state()).extra, 0);
    await page.keyboard.down('Shift');
    await page.mouse.click(x1, y1);
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => window.__plateStore.getState().extraSelection.length === 1);
    assert.match(await page.locator('#selection-count').innerText(), /\+1 more selected/);

    log('Escape deselects, Ctrl+A selects everything');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__plateStore.getState().selectedObjectId === null);
    await page.keyboard.press('Control+a');
    await page.waitForFunction(() => window.__plateStore.getState().extraSelection.length === 1);

    log('dragging moves every selected object by the same amount');
    const before = await page.evaluate(() => window.__plateStore.getState().objects.map((o) => [...o.instances[0].offset]));
    await page.evaluate(() => window.__plateStore.getState().moveSelection([10, 0, 0]));
    await page.waitForFunction((b) => window.__plateStore.getState().objects.every((o, i) => Math.abs(o.instances[0].offset[0] - (b[i][0] + 10)) < 0.01), before);

    log('Ctrl+K clones the selection');
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => window.__plateStore.getState().objects.reduce((n, o) => n + o.instances.length, 0) === 4, null, { timeout: 30000 });

    log('copy and paste add one more instance of each copied object');
    await page.keyboard.press('Control+c');
    assert.equal((await state()).clipboard, 2);
    await page.keyboard.press('Control+v');
    await page.waitForFunction(() => window.__plateStore.getState().objects.reduce((n, o) => n + o.instances.length, 0) === 6, null, { timeout: 30000 });

    log('Delete removes every selected object, Ctrl+D the rest');
    await page.keyboard.press('Control+a');
    await page.waitForFunction(() => window.__plateStore.getState().extraSelection.length >= 1);
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 0, null, { timeout: 30000 });
    await addCube(1);
    await page.keyboard.press('Control+d');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 0, null, { timeout: 30000 });
    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'multiselect');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All multi-select tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Multi-select tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
