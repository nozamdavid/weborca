#!/usr/bin/env node
/**
 * Browser test of the empty-plate context menu, Chromium then Firefox: it opens on a right-click without a drag,
 * adds every primitive and the handy models as objects, and offers Add Models, Text, SVG and Show Labels.
 */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5113', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const objects = () => page.evaluate(() => window.__plateStore.getState().objects.map((o) => ({ name: o.name, size: o.size })));
  const openMenu = async () => {
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.waitForSelector('#plate-context-menu');
  };
  const addVia = async (submenuId, itemId, count, label) => {
    await openMenu();
    await page.hover(submenuId);
    await page.click(itemId);
    await page.waitForFunction(([n, l]) => { const o = window.__plateStore.getState().objects; return o.length === n && o[n - 1].name === l; }, [count, label], { timeout: 120000 });
  };

  try {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    log('a right-click on the empty plate opens the menu with its entries');
    await openMenu();
    await page.hover('#plate-menu-primitive');
    for (const label of ['Cube', 'Cylinder', 'Sphere', 'Cone', 'Disc', 'Torus', 'Text', 'SVG']) {
      assert.ok(await page.locator('#plate-submenu-primitive').getByText(label, { exact: true }).isVisible(), `${label} is listed`);
    }
    await page.hover('#plate-menu-handy');
    assert.equal(await page.locator('#plate-submenu-handy [role="menuitem"]').count(), 7);
    for (const label of ['Orca Cube', 'Orca Tolerance Test', '3DBenchy', 'Autodesk FDM Test', 'Voron Cube', 'Stanford Bunny', 'Orca String Hell']) {
      assert.ok(await page.locator('#plate-submenu-handy').getByText(label, { exact: true }).isVisible(), `${label} is listed`);
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('#plate-context-menu', { state: 'detached' });

    log('a drag with the right button pans instead of opening the menu');
    await page.mouse.move(1000, 300);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(1060, 340, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    assert.equal(await page.locator('#plate-context-menu').count(), 0);

    log('the empty plate shows no drop prompt');
    assert.equal(await page.locator('#empty-plate-prompt').count(), 0);

    log('every primitive becomes an object standing on the plate');
    let count = 0;
    for (const shape of ['cube', 'cylinder', 'sphere', 'cone', 'disc', 'torus']) {
      await addVia('#plate-menu-primitive', `#plate-menu-${shape}`, ++count, shape[0].toUpperCase() + shape.slice(1));
    }
    const added = await objects();
    assert.deepEqual(added.map((o) => o.name), ['Cube', 'Cylinder', 'Sphere', 'Cone', 'Disc', 'Torus']);
    const cube = added[0].size;
    assert.ok(cube.every((v) => Math.abs(v - cube[0]) < 0.1) && cube[0] > 5, `a cube has equal sides, got ${cube}`);
    assert.ok(added[4].size[2] < added[4].size[0] / 4, 'a disc is flat');

    log('a handy model is added');
    await addVia('#plate-menu-handy', '#plate-menu-handy-OrcaCube_v2', ++count, 'Orca Cube');
    assert.equal((await objects()).at(-1).name, 'Orca Cube');
    await addVia('#plate-menu-handy', '#plate-menu-handy-3DBenchy', ++count, '3DBenchy');

    // Standing on the plate: the lowest point of each object is at Z=0, and every triangle of a cube made it through
    const grounded = await page.evaluate(() => [...window.__plateScene.getObjectMeshes().values()].map((m) => {
      m.geometry.computeBoundingBox();
      return [m.userData.name, Math.round((m.geometry.boundingBox.min.z * m.scale.z + m.position.z) * 1000) / 1000];
    }));
    assert.ok(grounded.every(([, minZ]) => Math.abs(minZ) < 0.01), `every object stands on the plate: ${JSON.stringify(grounded)}`);
    assert.equal(await page.evaluate(() => [...window.__plateScene.getObjectMeshes().values()][0].geometry.index.count / 3), 12, 'a cube keeps all 12 triangles');

    log('Show Labels toggles the labels');
    const before = await page.evaluate(() => window.__prefsStore.getState().display.showLabels);
    await openMenu();
    await page.click('#plate-menu-labels');
    assert.equal(await page.evaluate(() => window.__prefsStore.getState().display.showLabels), !before);

    log('Text opens the text tool for a new object');
    await openMenu();
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-text');
    await page.waitForFunction(() => window.__textStore.getState().isOpen && window.__textStore.getState().volumeType === 'new_object');

    await page.click('#view-iso');
    await page.evaluate(() => window.__plateStore.getState().selectObject?.(null));
    await page.evaluate(() => { const s = window.__plateScene; s.camera.position.set(60, -60, 60); s.orbitControls.target.set(130, 110, 0); s.orbitControls.update(); });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `wasm/build/tests-app/platemenu-${name}.png` });

    log('all checks passed');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'platemenu');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All plate menu tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Plate menu tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
