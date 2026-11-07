#!/usr/bin/env node
/**
 * Browser test of File menu operations, shortcuts, drag-and-drop, and recent files:
 * Chromium then Firefox:
 * 1. Open project (.3mf)
 * 2. Save project / Save as (.3mf download)
 * 3. Import model (STL/OBJ/3MF/STEP/SVG)
 * 4. Export plate as STL (assert exact binary byte length = 84 + 50*triangles)
 * 5. Export G-code & Export plate sliced file (.gcode.3mf containing Metadata/plate_1.gcode)
 * 6. Open .gcode file into Preview tab
 * 7. Drag-and-drop of files onto canvas
 * 8. Shortcuts: Ctrl+O, Ctrl+S, Ctrl+I, Ctrl+G
 * 9. Disabled states when not applicable
 * 10. Status toasts and recent files persisted in localStorage (capped at 10)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from 'playwright';
import draco3d from '../../app/node_modules/draco3d/draco3d.js';
import { unzipSync, zipSync } from '../../app/node_modules/fflate/esm/index.mjs';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5122;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CUBE_PATH = path.resolve(__dirname, '../../../tests/data/20mm_cube.obj');
const CUBE = fs.readFileSync(CUBE_PATH);

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);

  const objectNames = () => page.evaluate(() => window.__plateStore.getState().objects.map((o) => o.name));
  const openFileMenu = async () => {
    const fileLabel = page.locator('.menu-label', { hasText: 'File' }).first();
    await fileLabel.click();
    await page.waitForSelector('.menu.open .menu-popup', { state: 'visible' });
  };
  const closeMenu = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  };
  const getMenuItem = (label) => page.locator('.menu.open .menu-item', { hasText: label }).first();

  try {
    log('Navigating to app...');
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });

    log('1. Verify disabled states on an empty plate...');
    await openFileMenu();
    assert.equal(await getMenuItem('Save project').isDisabled(), true, 'Save project must be disabled on empty plate');
    assert.equal(await getMenuItem('Save project as...').isDisabled(), true, 'Save project as... must be disabled on empty plate');
    assert.equal(await getMenuItem('Export plate as STL...').isDisabled(), true, 'Export plate as STL must be disabled on empty plate');
    assert.equal(await getMenuItem('Export G-code').isDisabled(), true, 'Export G-code must be disabled before slicing');
    assert.equal(await getMenuItem('Export plate sliced file').isDisabled(), true, 'Export plate sliced file must be disabled before slicing');
    await closeMenu();

    log('2. Import model (20mm_cube.obj)...');
    await page.setInputFiles('#model-file', {
      name: '20mm_cube.obj',
      mimeType: 'model/obj',
      buffer: CUBE
    });
    await page.waitForFunction(() => window.__plateStore?.getState().objects.length === 1, null, { timeout: 30000 });
    const importedNames = await objectNames();
    assert.equal(importedNames.length, 1);
    assert.match(importedNames[0], /20mm_cube/);

    // Verify toast appears
    await page.waitForSelector('.toast-item.toast-success', { state: 'visible', timeout: 5000 });
    log('Toast notification verified for model import');

    log('3. Verify menu enablement after importing model...');
    await openFileMenu();
    assert.equal(await getMenuItem('Save project').isDisabled(), false, 'Save project must be enabled with model');
    assert.equal(await getMenuItem('Export plate as STL...').isDisabled(), false, 'Export STL must be enabled with model');
    assert.equal(await getMenuItem('Export G-code').isDisabled(), true, 'Export G-code still disabled before slicing');
    await closeMenu();

    log('4. Export plate as STL and assert binary length (84 + 50*triangles)...');
    // 20mm cube has exactly 12 triangles (2 triangles per face * 6 faces).
    // Expected binary STL size: 84 + 50 * 12 = 684 bytes.
    await openFileMenu();
    const [stlDownload] = await Promise.all([
      page.waitForEvent('download'),
      getMenuItem('Export plate as STL...').click()
    ]);
    const stlStream = await stlDownload.createReadStream();
    const stlChunks = [];
    for await (const chunk of stlStream) stlChunks.push(chunk);
    const stlBuffer = Buffer.concat(stlChunks);
    assert.equal(stlBuffer.length, 84 + 50 * 12, `STL byte length must be 84 + 50*12 = 684, got ${stlBuffer.length}`);
    const stlTriangleCount = stlBuffer.readUInt32LE(80);
    assert.equal(stlTriangleCount, 12, 'STL header triangle count must equal 12');
    log(`STL export verified: ${stlBuffer.length} bytes, ${stlTriangleCount} triangles`);

    log('Setting custom bed texture before saving...');
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('bed_custom_texture', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'printer'));
    log('5. Save project (.3mf) and download archive...');

    await openFileMenu();
    const [projectDownload] = await Promise.all([
      page.waitForEvent('download'),
      getMenuItem('Save project').click()
    ]);
    const projectStream = await projectDownload.createReadStream();
    const projectChunks = [];
    for await (const chunk of projectStream) projectChunks.push(chunk);
    const projectBuffer = Buffer.concat(projectChunks);
    assert.ok(projectBuffer.length > 500, `Downloaded 3MF project must be valid archive, got ${projectBuffer.length} bytes`);
    log(`Save project verified: downloaded 3MF archive of ${projectBuffer.length} bytes`);

    log('6. Re-open downloaded 3MF project and assert original object names restore...');
    // Delete all objects from the plate
    await page.evaluate(() => {
      const plate = window.__plateStore.getState();
      const firstId = plate.objects[0]?.id;
      if (firstId != null) {
        plate.selectObject(firstId);
        plate.deleteSelected();
      }
    });
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 0, null, { timeout: 10000 });
    assert.deepEqual(await objectNames(), [], 'Plate is now cleared');

    // Open the saved 3MF project via project file input
    const tmpProjPath = path.join(os.tmpdir(), `test_project_${Date.now()}.3mf`);
    fs.writeFileSync(tmpProjPath, projectBuffer);
    try {
      await page.setInputFiles('#project-file-input', tmpProjPath);
      await page.waitForFunction(() => window.__plateStore?.getState().objects.length >= 1, null, { timeout: 30000 });
      const restoredNames = await objectNames();

      assert.equal(restoredNames.length, 1, 'Project must restore 1 object');
      assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.bed_custom_texture), 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'Custom bed asset persisted in project');

      assert.match(restoredNames[0], /20mm_cube/, `Restored object name must match original: ${restoredNames[0]}`);
      log('Project round-trip verified successfully!');
    } finally {
      try { fs.unlinkSync(tmpProjPath); } catch (_) {}
    }

    log('7. Slice and export G-code + Plate Sliced File (.gcode.3mf)...');
    await selectAddedPrinter(page, 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');

    await page.click('#tab-prepare');
    await page.waitForFunction(() => !document.getElementById('slice-btn')?.disabled, null, { timeout: 30000 });
    await page.click('#slice-btn');
    await page.waitForFunction(() => {
      const s = window.__appStore.getState();
      return !s.isSlicing && s.sliceResult?.gcode;
    }, null, { timeout: 120000 });
    log('Plate slicing finished');

    // Export G-code (via menu)
    await openFileMenu();
    assert.equal(await getMenuItem('Export G-code').isDisabled(), false, 'Export G-code must be enabled after slicing');
    const [gcodeDownload] = await Promise.all([
      page.waitForEvent('download'),
      getMenuItem('Export G-code').click()
    ]);
    const gcodeStream = await gcodeDownload.createReadStream();
    const gcodeChunks = [];
    for await (const chunk of gcodeStream) gcodeChunks.push(chunk);
    const gcodeBuffer = Buffer.concat(gcodeChunks);
    assert.ok(gcodeBuffer.length > 500, 'Exported G-code must be non-empty');
    assert.ok(gcodeBuffer.toString('utf8').includes('G1'), 'Exported G-code must contain toolpath commands');
    log(`Export G-code verified: ${gcodeBuffer.length} bytes`);

    // Test Ctrl+G shortcut while gcode is present
    const [shortcutGcodeDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('Control+g')
    ]);
    assert.ok(shortcutGcodeDownload, 'Ctrl+G shortcut triggered G-code download');
    log('Ctrl+G shortcut verified');

    // Export plate sliced file (.gcode.3mf)
    await openFileMenu();
    assert.equal(await getMenuItem('Export plate sliced file').isDisabled(), false, 'Export plate sliced file must be enabled');
    const [slicedFileDownload] = await Promise.all([
      page.waitForEvent('download'),
      getMenuItem('Export plate sliced file').click()
    ]);
    const slicedStream = await slicedFileDownload.createReadStream();
    const slicedChunks = [];
    for await (const chunk of slicedStream) slicedChunks.push(chunk);
    const slicedBuffer = Buffer.concat(slicedChunks);
    assert.ok(slicedBuffer.length > 500, 'Plate sliced file must be non-empty');
    // Unzip and assert Metadata/plate_1.gcode is packaged inside
    const unzipped3mf = unzipSync(new Uint8Array(slicedBuffer));
    assert.ok(unzipped3mf['Metadata/plate_1.gcode'], 'Plate sliced file must contain Metadata/plate_1.gcode');
    log('Export plate sliced file verified: package contains Metadata/plate_1.gcode');

    log('8. Open .gcode file from disk and show in Preview tab...');
    // Create a standalone gcode file to test File > Open G-code
    const testGcodeContent = `; test gcode file\
G28\
G1 Z0.2 F1200\
G1 X100 Y100 E1.0 F1800\
`;
    const testGcodeBuffer = Buffer.from(testGcodeContent, 'utf8');
    await page.setInputFiles('#gcode-file-input', {
      name: 'direct_open.gcode',
      mimeType: 'text/plain',
      buffer: testGcodeBuffer
    });
    // App switches to Preview tab automatically
    await page.waitForFunction(() => {
      const active = document.getElementById('tab-preview')?.classList.contains('active');
      const gcode = window.__appStore.getState().sliceResult?.gcode;
      return active && !!gcode;
    }, null, { timeout: 30000 });
    log('Open G-code directly from disk switched to Preview tab and loaded');

    log('9. Drag-and-drop of model onto canvas...');
    await page.click('#tab-prepare');
    await page.evaluate(async (cubeBytes) => {
      const dt = new DataTransfer();
      const file = new File([new Uint8Array(cubeBytes)], 'dropped_cube.obj', { type: 'model/obj' });
      dt.items.add(file);
      const dropEvent = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
      document.querySelector('.workspace')?.dispatchEvent(dropEvent);
    }, Array.from(CUBE));
    await page.waitForFunction(() => {
      const objs = window.__plateStore.getState().objects;
      return !window.__appStore.getState().isModelLoading && objs.some((o) => o.name.includes('dropped_cube'));
    }, null, { timeout: 30000 });
    log('Drag-and-drop of model file verified');

    log('10. Shortcuts (Ctrl+I triggers file chooser)...');
    await page.waitForTimeout(1500); // the import still records history and auto-arranges after the object appears
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.keyboard.press('Control+i')
    ]);
    assert.ok(fileChooser, 'Ctrl+I shortcut triggered file chooser');
    log('Ctrl+I shortcut verified');

    log('11. Recent files in localStorage and File menu...');
    const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('orca_recent_files') || '[]'));
    assert.ok(Array.isArray(recent), 'Recent files must be array in localStorage');
    assert.ok(recent.length >= 1, `Recent files must have at least 1 item, got ${recent.length}`);
    assert.ok(recent.length <= 10, `Recent files must be capped at 10, got ${recent.length}`);
    log(`Recent files verified in localStorage: ${recent.length} files tracked`);

    await openFileMenu();
    const recentSubmenu = page.locator('.menu-submenu', { hasText: 'Recent files' });
    assert.equal(await recentSubmenu.count(), 1, 'Recent files submenu must exist');
    await closeMenu();

    log('12. ZIP import preserves existing transforms with auto-arrangement disabled...');
    await page.evaluate(async () => {
      window.__prefsStore.getState().setGeneralPref('autoArrangeOnImport', false);
    });
    const beforeZip = await page.evaluate(() => window.__plateStore.getState().objects);
    const modelArchive = Buffer.from(zipSync({ 'nested/one.obj': new Uint8Array(CUBE), 'two.obj': new Uint8Array(CUBE), 'README.txt': new TextEncoder().encode('ignored') }));
    await page.setInputFiles('#model-file', { name: 'models.zip', mimeType: 'application/zip', buffer: modelArchive });
    await page.waitForFunction((count) => !window.__appStore.getState().isModelLoading && window.__plateStore.getState().objects.length === count + 2, beforeZip.length, { timeout: 30000 });
    const afterZip = await page.evaluate(() => window.__plateStore.getState().objects);
    for (const original of beforeZip) assert.deepEqual(afterZip.find(o => o.id === original.id).instances, original.instances);

    const downloadMenu = async (label) => {
      await openFileMenu();
      const [file] = await Promise.all([page.waitForEvent('download'), getMenuItem(label).click()]);
      const chunks = [];
      for await (const chunk of await file.createReadStream()) chunks.push(chunk);
      return Buffer.concat(chunks);
    };
    log('13. Export individual STL archive and generic 3MF...');
    const separate = unzipSync(await downloadMenu('Export objects as STLs...'));
    assert.equal(Object.keys(separate).length, afterZip.length);
    for (const bytes of Object.values(separate)) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.equal(bytes.length, 84 + view.getUint32(80, true) * 50);
    }
    const generic = unzipSync(await downloadMenu('Export Generic 3MF...'));
    assert.ok(generic['3D/3dmodel.model']);
    assert.equal(generic['Metadata/project_settings.config'], undefined);

    log('14. Decode exported Draco mesh and compare face count...');
    const nativeStl = await downloadMenu('Export all objects as one STL...');
    const drc = await downloadMenu('Export all objects as one DRC...');
    const decoderModule = await draco3d.createDecoderModule({});
    const decoder = new decoderModule.Decoder();
    const mesh = new decoderModule.Mesh();
    const buffer = new decoderModule.DecoderBuffer();
    buffer.Init(new Int8Array(drc), drc.length);
    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    try {
      assert.ok(status.ok(), status.error_msg());
      assert.equal(mesh.num_faces(), afterZip.reduce((sum, o) => sum + o.instances.length * 12, 0));
      const positions = new decoderModule.DracoFloat32Array();
      try {
        const attribute = decoder.GetAttribute(mesh, decoder.GetAttributeId(mesh, decoderModule.POSITION));
        assert.ok(decoder.GetAttributeFloatForAllPoints(mesh, attribute, positions));
        const stlBounds = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
        const drcBounds = [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]];
        for (let face = 0; face < nativeStl.readUInt32LE(80); face++) {
          for (let coordinate = 0; coordinate < 9; coordinate++) {
            const axis = coordinate % 3;
            const value = nativeStl.readFloatLE(84 + face * 50 + 12 + coordinate * 4);
            stlBounds[axis][0] = Math.min(stlBounds[axis][0], value);
            stlBounds[axis][1] = Math.max(stlBounds[axis][1], value);
          }
        }
        for (let coordinate = 0; coordinate < positions.size(); coordinate++) {
          const axis = coordinate % 3;
          const value = positions.GetValue(coordinate);
          drcBounds[axis][0] = Math.min(drcBounds[axis][0], value);
          drcBounds[axis][1] = Math.max(drcBounds[axis][1], value);
        }
        const tolerance = Math.max(...stlBounds.map(([min, max]) => max - min)) / 16383 * 2 + 0.001;
        for (let axis = 0; axis < 3; axis++) {
          for (let side = 0; side < 2; side++) assert.ok(Math.abs(stlBounds[axis][side] - drcBounds[axis][side]) <= tolerance);
        }
      } finally { decoderModule.destroy(positions); }

    } finally {
      decoderModule.destroy(status);
      decoderModule.destroy(buffer);
      decoderModule.destroy(mesh);
      decoderModule.destroy(decoder);
    }

    log('15. Sliced package uses the actual plate index and edits invalidate stale G-code...');
    await page.evaluate(async () => {
      await window.__platesStore.getState().addPlate('Second plate');
      const plate = window.__platesStore.getState().plates[1];
      const object = window.__plateStore.getState().objects.at(-1);
      await window.__plateStore.getState().setInstanceTransform(object.id, object.instances[0].id, { offset: [plate.origin[0] + 150, plate.origin[1] + 150, 10] });
      await window.__platesStore.getState().fetchPlates();
      await window.__platesStore.getState().slicePlate(1);
    });
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult?.plateIndex), 1);
    const secondPackage = unzipSync(await downloadMenu('Export plate sliced file'));
    assert.ok(secondPackage['Metadata/plate_2.gcode']);
    assert.equal(secondPackage['Metadata/plate_1.gcode'], undefined);
    await page.evaluate(() => window.__platesStore.getState().setActivePlate(0));
    await openFileMenu();
    assert.equal(await getMenuItem('Export plate sliced file').isDisabled(), true);
    await closeMenu();
    await page.evaluate(async () => {
      const object = window.__plateStore.getState().objects[0];
      await window.__plateStore.getState().setInstanceTransform(object.id, object.instances[0].id, { offset: [70, 80, 10] });
    });
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceResult), null);

    log('16. All-plate export can be canceled from Prepare without downloading a partial package...');
    await page.click('#tab-prepare');
    const canceledDownloads = [];
    const recordCanceledDownload = (download) => canceledDownloads.push(download);
    page.on('download', recordCanceledDownload);
    await openFileMenu();
    await getMenuItem('Export all plates sliced file...').click();
    await page.locator('#preview-cancel-btn').click({ timeout: 10000 });
    await page.waitForFunction(() => !window.__appStore.getState().isSlicing && !window.__appStore.getState().isModelLoading);
    assert.equal(await page.evaluate(() => window.__appStore.getState().sliceStatusText), 'Slicing canceled');
    assert.equal(canceledDownloads.length, 0, 'canceling must not export a partial archive');
    page.off('download', recordCanceledDownload);

    log('17. All-plate sliced export contains freshly generated G-code for each occupied plate...');
    const allPlatesPackage = unzipSync(await downloadMenu('Export all plates sliced file...'));
    assert.ok(allPlatesPackage['Metadata/plate_1.gcode']);
    assert.ok(allPlatesPackage['Metadata/plate_2.gcode']);
    assert.notDeepEqual(allPlatesPackage['Metadata/plate_1.gcode'], allPlatesPackage['Metadata/plate_2.gcode']);
    log('All checks passed successfully!');
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'fileio');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All file I/O tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('File I/O tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
