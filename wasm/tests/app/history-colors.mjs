import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5376);
const cube = fileURLToPath(new URL('../../../tests/data/20mm_cube.obj', import.meta.url));
await startServer(port, 'history-colors');
try {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await page.goto(`http://127.0.0.1:${port}/prepare`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__plateScene);
    await page.evaluate(async () => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
      await window.__appStore.getState().applyOptionChange('filament_colour', '#c22355', 'filament', undefined, 0);
      window.historyPart = () => [...window.__plateScene.volumeMeshes.values()]
        .map(mesh => ({ x: mesh.parent.position.x, color: mesh.material.color.getHexString() }))[0];
    });
    await page.setInputFiles('#model-file', cube);
    await page.waitForFunction(() => window.historyPart()?.color === 'c22355' && window.__historyStore.getState().canUndo);
    const before = await page.evaluate(() => window.historyPart());
    await page.evaluate(async () => {
      const plate = window.__plateStore.getState();
      plate.selectObject(plate.objects[0].id);
      await plate.moveSelection([30, 0, 0]);
    });
    await page.waitForFunction(x => window.historyPart()?.x === x, before.x + 30);
    const moved = await page.evaluate(() => window.historyPart());
    await page.evaluate(() => {
      const engine = window.__orcaEngine;
      const getObjectTree = engine.getObjectTree.bind(engine);
      engine.getObjectTree = async () => {
        await new Promise(resolve => { window.releaseHistoryTree = resolve; });
        engine.getObjectTree = getObjectTree;
        return getObjectTree();
      };
      window.pendingUndo = window.__historyStore.getState().undo();
    });
    await page.waitForFunction(() => window.releaseHistoryTree);
    const interim = await page.evaluate(async () => {
      const frames = [];
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(requestAnimationFrame);
        frames.push(window.historyPart());
      }
      return frames;
    });
    assert.ok(interim.every(part => part?.color === moved.color && part.x === moved.x),
      `Keep the previous colored frame until Undo can publish the restored scene: ${JSON.stringify(interim)}`);
    await page.evaluate(() => window.releaseHistoryTree());
    assert.equal(await page.evaluate(() => window.pendingUndo), true);
    await page.waitForFunction(expected => {
      const part = window.historyPart();
      return part?.x === expected.x && part.color === expected.color;
    }, before);
    console.log('Undo keeps the previous colored frame until the restored position and color are both ready');
  } finally {
    await browser.close();
  }
} finally {
  await stopServer(port);
}
