import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5281);
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');

async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const assignments = () => page.evaluate(() => window.__objectListStore.getState().objects.map(o => o.volumes.map(v => v.extruder)));
  const camera = () => page.evaluate(() => window.__plateScene.camera.quaternion.toArray());
  const cameraMatches = (actual, expected) => actual.every((value, index) => Math.abs(value - expected[index]) < 1e-6);
  const colors = () => page.evaluate(() => [...window.__plateScene.objectMeshes.values()].map(m => Array.from(m.geometry.attributes.color.array)));
  const select = index => page.evaluate(i => {
    const plate = window.__plateStore.getState();
    plate.selectObject(plate.objects[i].id);
    window.__objectListStore.getState().selectItem(plate.objects[i].id, null);
    document.activeElement?.blur();
  }, index);
  const assign = async (key, expected) => {
    const snapshot = await page.evaluate(() => window.__historyStore.getState().currentSnapshot?.id);
    if (key === 'Numpad1') {
      // Playwright's Numpad1 mapping sends End without Num Lock in headless browsers.
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Numpad1', location: 3, bubbles: true, cancelable: true })));
    } else {
      await page.keyboard.press(key);
    }
    await page.waitForFunction(({ expected, snapshot }) =>
      JSON.stringify(window.__objectListStore.getState().objects.map(o => o.volumes.map(v => v.extruder))) === JSON.stringify(expected) &&
      window.__historyStore.getState().currentSnapshot?.id !== snapshot,
    { expected, snapshot }, { timeout: 30000 });
    await page.waitForTimeout(150);
  };
  const unchanged = async (key, label) => {
    const before = await assignments();
    const view = await camera();
    const snapshot = await page.evaluate(() => window.__historyStore.getState().currentSnapshot?.id);
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
    assert.deepEqual(await assignments(), before, label);
    assert.ok(cameraMatches(await camera(), view), `${label}: camera unchanged`);
    assert.equal(await page.evaluate(() => window.__historyStore.getState().currentSnapshot?.id), snapshot, `${label}: no undo entry`);
  };
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async text => {
      const app = window.__appStore.getState();
      await app.chooseVendor('Snapmaker');
      await app.choosePrinter('Snapmaker U1 (0.4 nozzle)');
      const preset = window.__appStore.getState().filaments.find(p => p.isCompatible && p.name.startsWith('Generic PLA'));
      await app.chooseFilament(preset.name);
      await app.addFilamentSlot(preset.name);
      await app.setSlotColor(0, '#CC1122');
      await app.setSlotColor(1, '#0047BB');
      await app.importModelFile(new File([text], 'first.obj'));
      await app.importModelFile(new File([text], 'second.obj'));
    }, cube);
    await page.waitForFunction(() => window.__plateScene?.objectMeshes.size === 2);
    await select(0);
    const original = await assignments();
    const view = await camera();
    const beforeColors = await colors();
    await assign('2', [[2], original[1]]);
    assert.ok(cameraMatches(await camera(), view), 'filament shortcut preserves camera');
    assert.notDeepEqual(await colors(), beforeColors, 'assignment changes rendered vertex colors');
    await page.keyboard.press('Control+z');
    await page.waitForFunction(expected => !window.__historyStore.getState().isRestoring &&
      JSON.stringify(window.__objectListStore.getState().objects.map(o => o.volumes.map(v => v.extruder))) === JSON.stringify(expected), original);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(() => !window.__historyStore.getState().isRestoring && window.__objectListStore.getState().objects[0].volumes[0].extruder === 2);
    await select(0);
    await assign('Numpad1', [[1], original[1]]);
    for (const key of ['3', '6', '9', 'Control+2', 'Alt+2', 'Shift+2', 'Meta+2']) await unchanged(key, `ignored ${key}`);

    for (const tag of ['input', 'textarea', 'select', 'div']) {
      await page.evaluate(tag => {
        const element = document.createElement(tag);
        element.id = 'shortcut-test-input';
        if (tag === 'div') { element.contentEditable = 'true'; element.innerHTML = '<span>text</span>'; }
        document.body.append(element);
        element.focus();
      }, tag);
      await unchanged('2', `typing in ${tag}`);
      await page.evaluate(() => document.getElementById('shortcut-test-input').remove());
    }
    await page.evaluate(() => { const el = document.createElement('div'); el.id = 'shortcut-test-dialog'; el.setAttribute('role', 'dialog'); document.body.append(el); });
    await unchanged('2', 'open dialog even with focus outside');
    await page.evaluate(() => document.getElementById('shortcut-test-dialog').remove());
    for (const [store, flag] of [['__appStore', 'isSlicing'], ['__appStore', 'isModelLoading'], ['__appStore', 'isSelectingPreset'], ['__plateStore', 'measureActive'], ['__plateStore', 'explodeActive'], ['__cutStore', 'isCutting'], ['__repairStore', 'isRepairing']]) {
      await page.evaluate(([store, flag]) => window[store].setState({ [flag]: true }), [store, flag]);
      await unchanged('2', `${store}.${flag}`);
      await page.evaluate(([store, flag]) => window[store].setState({ [flag]: false }), [store, flag]);
    }
    await page.evaluate(() => document.querySelector('.prepare-page').hidden = true);
    await unchanged('2', 'Prepare hidden');
    await page.evaluate(() => document.querySelector('.prepare-page').hidden = false);

    await page.keyboard.press('Control+a');
    await assign('2', [[2], [2]]);
    await select(0);
    await page.evaluate(async () => {
      const tree = window.__objectListStore.getState();
      const objectId = tree.objects[0].id;
      const volumeId = await tree.addVolume({ objectId, type: 'part', shape: 'cube', size: [10, 10, 10], offset: [30, 0, 0] });
      await window.__objectListStore.getState().setVolumeExtruder(objectId, volumeId, 2);
      window.__objectListStore.getState().selectItem(objectId, volumeId);
    });
    await assign('1', [[2, 1], [2]]);
    await select(0);
    await assign('1', [[1, 1], [2]]);
    await page.keyboard.press('Escape');
    const noSelectionView = await camera();
    await page.keyboard.press('2');
    assert.ok(!cameraMatches(await camera(), noSelectionView), 'without a selection numeric camera shortcuts remain available');
    assert.deepEqual(await assignments(), [[1, 1], [2]], 'camera shortcut does not assign filament');
    console.log(`${browserType.name()}: filament shortcuts, colors, history, parts, multi-selection and guards passed`);
  } finally { await browser.close(); }
}
await startServer(port, 'filament-shortcuts');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
