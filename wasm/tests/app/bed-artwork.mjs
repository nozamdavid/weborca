#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = Number(process.env.PORT || 5188);
async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (/WebGL.*(?:INVALID|bad image)|GL_INVALID/.test(message.text())) errors.push(message.text()); });
  try {
    await page.addInitScript(() => {
      window.__earlyBedFrames = [];
      function observe() {
        const scene = window.__plateScene;
        if (scene?.bedGroup.visible && !window.__appStore?.getState().isEngineReady) {
          window.__earlyBedFrames.push(scene.bedOutline().length);
        }
        if (!window.__stopBedFrames) requestAnimationFrame(observe);
      }
      requestAnimationFrame(observe);
    });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    });
    await page.waitForFunction(() => window.__plateScene?.bedTexture?.image?.tagName === 'CANVAS');
    assert.deepEqual(await page.evaluate(() => { window.__stopBedFrames = true; return window.__earlyBedFrames; }), [],
      'the startup bed must stay hidden until the printer configuration and its custom artwork are ready');
    const profile = await page.evaluate(() => {
      const scene = window.__plateScene;
      const floor = scene.bedGroup.children.find(c => c.isMesh);
      const p = floor.geometry.attributes.position, idx = floor.geometry.index;
      let floorArea = 0;
      for (let i = 0; i < idx.count; i += 3) {
        const [a, b, c] = [0, 1, 2].map(j => idx.getX(i + j));
        floorArea += Math.abs((p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
          (p.getY(b) - p.getY(a)) * (p.getX(c) - p.getX(a))) / 2;
      }
      return { width: scene.bedTexture.image.width, model: !!scene.bedModelPoints,
        printableVertices: scene.bedConfig.points.length, outlineVertices: scene.bedOutline().length, floorArea };
    });
    assert.ok(profile.width > 0);
    assert.equal(profile.model, true);
    assert.equal(profile.printableVertices, 4, 'exercise the real rectangular printer area with a nonrectangular bed STL');
    assert.equal(profile.outlineVertices, 44, 'Voron bed overlay must include the front tab and rounded corners');
    assert.ok(Math.abs(profile.floorArea - 93916.95246338472) < 0.01, 'floor must follow the STL top face, not the 90000 mm² printable square');
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Snapmaker');
      await window.__appStore.getState().choosePrinter('Snapmaker U1 (0.4 nozzle)');
    });
    await page.waitForFunction(() => window.__plateScene?.bedModelPoints?.length === 80);
    const snapmaker = await page.evaluate(() => {
      const scene = window.__plateScene;
      const border = scene.bedGroup.children.find(c => c.material?.color?.getHex() === 0x38bdf8);
      return { borderVertices: border.geometry.attributes.position.count, separateBedMesh: scene.scene.children.some(c => c.isMesh && c.material?.color?.getHex() === 0x777c84) };
    });
    assert.equal(snapmaker.borderVertices, 81, 'U1 blue grid border must follow the bed notches and tab, not a square');
    assert.equal(snapmaker.separateBedMesh, false, 'bed STL must not add a pale overlay underneath the grid');
    const labelMargins = await page.evaluate(() => {
      const scene = window.__plateScene;
      const points = scene.bedOutline();
      const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
      const title = scene.plateLabelGroup.children.find(c => c.name === 'plate-title');
      const number = scene.plateLabelGroup.children.find(c => c.name === 'plate-label');
      return { title: title.position.y - title.geometry.parameters.height / 2 - maxY,
        number: minY - number.position.y - number.geometry.parameters.height / 2 };
    });
    assert.ok(labelMargins.title > 0, 'title must have a margin above the entire custom outline');
    assert.ok(labelMargins.number > 0, 'number must have a margin below the entire custom outline');
    await page.waitForFunction(() => window.__plateScene.towerPreview === null);
    const tower = await page.evaluate(() => {
      const scene = window.__plateScene;
      scene.setWipeTowerPreview({ enabled: true, width: 40, depth: 30, height: 20, x: 20, y: 200 });
      const material = scene.towerPreview.material;
      scene.setCameraView(1);
      const fromAbove = { transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite };
      scene.setCameraView(2);
      const fromBelow = { transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite };
      scene.setWipeTowerPreview({ enabled: false });
      scene.setCameraView(0);
      return { fromAbove, fromBelow };
    });
    assert.equal(tower.fromAbove.transparent, true);
    assert.ok(tower.fromAbove.opacity > 0 && tower.fromAbove.opacity < 1, 'the tower is translucent');
    assert.equal(tower.fromAbove.depthWrite, false);
    assert.deepEqual(tower.fromBelow, tower.fromAbove, 'the tower is also translucent from the opposite side');

    let releaseModel;
    const modelGate = new Promise(resolve => { releaseModel = resolve; });
    await page.route('**/Snapmaker%20U1_bed.stl?loading-test', async route => {
      await modelGate;
      await route.continue();
    });
    await page.evaluate(() => {
      window.__bedLoadTest = window.__plateScene.setBedAssets({
        model: '/profiles/assets/Snapmaker/Snapmaker%20U1_bed.stl?loading-test',
        texture: '/profiles/assets/Snapmaker/Snapmaker%20U1_bed.svg'
      });
    });
    const hidden = await page.evaluate(() => {
      const scene = window.__plateScene;
      return [scene.bedGroup, scene.extraBedsGroup, scene.plateLabelGroup].every(group => !group.visible);
    });
    assert.equal(hidden, true, 'no square grid or plate labels may appear while custom artwork is loading');
    releaseModel();
    await page.evaluate(async () => { await window.__bedLoadTest; delete window.__bedLoadTest; });
    await page.unroute('**/Snapmaker%20U1_bed.stl?loading-test');
    assert.equal(await page.evaluate(() => {
      const scene = window.__plateScene;
      return scene.bedGroup.visible && scene.extraBedsGroup.visible && scene.plateLabelGroup.visible &&
        scene.bedOutline().length === 80;
    }), true, 'finished U1 plate must appear with its custom outline');

    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    });
    await page.waitForFunction(() => window.__plateScene?.bedModelPoints?.length === 44);
    const footprints = await page.evaluate(() => {
      const scene = window.__plateScene;
      const originalBed = scene.bedConfig, originalPlates = scene.plates, originalActive = scene.activePlateIndex;
      const polygons = [
        [[0, 0], [100, 0], [70, 100], [30, 100]],
        [[-40, -20], [80, -20], [80, 20], [0, 20], [0, 90], [-40, 90]],
        [[0, 0], [0, 50], [120, 50], [120, 5], [115, 0]],
        Array.from({ length: 64 }, (_, i) => [50 * Math.cos(i * Math.PI / 32), 50 * Math.sin(i * Math.PI / 32)])
      ];
      function inside(x, y, points) {
        let result = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [ax, ay] = points[j], [bx, by] = points[i];
          const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
          if (Math.abs(cross) < 0.002 && x >= Math.min(ax, bx) - 0.0001 && x <= Math.max(ax, bx) + 0.0001 &&
            y >= Math.min(ay, by) - 0.0001 && y <= Math.max(ay, by) + 0.0001) return true;
          if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
        }
        return result;
      }
      function area(mesh) {
        const p = mesh.geometry.attributes.position, idx = mesh.geometry.index;
        let total = 0;
        for (let i = 0; i < (idx ? idx.count : p.count); i += 3) {
          const [a, b, c] = [0, 1, 2].map(j => idx ? idx.getX(i + j) : i + j);
          total += Math.abs((p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
            (p.getY(b) - p.getY(a)) * (p.getX(c) - p.getX(a))) / 2;
        }
        return total;
      }
      try {
        return polygons.map(points => {
          const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
          const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
          scene.updateBedConfig({ points, width: maxX - minX, depth: maxY - minY, height: 150, center: [(minX + maxX) / 2, (minY + maxY) / 2] });
          scene.setPlates([{ index: 0, name: '', origin: [0, 0, 0] }, { index: 1, name: '', origin: [200, 0, 0] }], 0);
          const floor = scene.bedGroup.children.find(c => c.isMesh);
          const extraFloor = scene.extraBedsGroup.children.find(c => c.isMesh);
          const outline = scene.bedGroup.children.find(c => c.isLine && !c.isLineSegments);
          const p = scene.bedGridHelper.geometry.attributes.position;
          let gridInside = p.count > 0;
          for (let i = 0; i < p.count; i += 2) {
            for (const t of [0, 0.25, 0.5, 0.75, 1]) {
              gridInside &&= inside(scene.bedConfig.center[0] + p.getX(i) * (1 - t) + p.getX(i + 1) * t,
                scene.bedConfig.center[1] + p.getY(i) * (1 - t) + p.getY(i + 1) * t, points);
            }
          }
          let polygonArea = 0;
          for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            polygonArea += a[0] * b[1] - b[0] * a[1];
          }
          scene.setShowGrid(false);
          const extraGrid = scene.extraBedsGroup.children.find(c => c.userData.bedGrid);
          const gridsHidden = !scene.bedGridHelper.visible && !extraGrid.visible;
          scene.setShowGrid(true);
          return { expectedArea: Math.abs(polygonArea) / 2, floorArea: area(floor), extraArea: area(extraFloor),
            gridInside, gridsHidden, outlineVertices: outline.geometry.attributes.position.count, polygonVertices: points.length,
            doubleSided: floor.material.side === 2, texturePreserved: floor.material.map === scene.bedTexture };
        });
      } finally { scene.updateBedConfig(originalBed); scene.setPlates(originalPlates, originalActive); }
    });
    for (const footprint of footprints) {
      assert.ok(Math.abs(footprint.floorArea - footprint.expectedArea) < 0.01, 'main bed must follow the polygon');
      assert.ok(Math.abs(footprint.extraArea - footprint.expectedArea) < 0.01, 'additional plates must follow the polygon');
      assert.equal(footprint.outlineVertices, footprint.polygonVertices + 1);
      assert.ok(footprint.gridInside, 'grid must stay inside the printable polygon, including concave cutouts');
      assert.ok(footprint.gridsHidden);
      assert.ok(footprint.doubleSided);
      assert.ok(footprint.texturePreserved);
    }
    const custom = await page.evaluate(async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#ff0000"/></svg>';
      await window.__plateScene.setBedAssets({ texture: 'data:image/svg+xml;base64,' + btoa(svg) });
      const canvas = window.__plateScene.bedTexture.image;
      return { tag: canvas.tagName, pixel: Array.from(canvas.getContext('2d').getImageData(16, 16, 1, 1).data) };
    });
    assert.equal(custom.tag, 'CANVAS');
    assert.deepEqual(custom.pixel, [255, 0, 0, 255]);
    await page.evaluate(async () => {
      await window.__appStore.getState().chooseVendor('Snapmaker');
      await window.__appStore.getState().choosePrinter('Snapmaker U1 (0.4 nozzle)');
    });
    await page.waitForFunction(() => window.__plateScene?.bedModelPoints?.length === 80);
    const prepareOutline = await page.evaluate(() => window.__plateScene.bedOutline());
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    await page.waitForFunction(() => window.preview?.getBedPolygon?.().length === 80);
    const previewOutline = await page.evaluate(() => window.preview.getBedPolygon());
    for (let i = 0; i < prepareOutline.length; i++) {
      assert.ok(Math.abs(prepareOutline[i][0] - previewOutline[i][0]) < 0.0001);
      assert.ok(Math.abs(prepareOutline[i][1] - previewOutline[i][1]) < 0.0001);
    }
    const gcode = readFileSync(new URL('../parity/refs-macos-x86_64/cube-voron.gcode', import.meta.url), 'utf8');
    await page.evaluate(async gcode => {
      await window.__previewStore.getState().loadGcodeBytes(gcode);
    }, gcode);
    assert.equal(await page.evaluate(() => window.preview.getBedPolygon().length), 80,
      'loading G-code must preserve the custom preview bed outline');
    await page.waitForTimeout(300);
    assert.deepEqual(errors, []);
    console.log(`${browserType.name()}: profile/custom SVG bed artwork uploads without WebGL errors`);
  } finally { await browser.close(); }
}
await startServer(port, 'bed-artwork');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
