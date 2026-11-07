/**
 * @file text-surface.mjs
 * End-to-end browser integration tests for curved-surface text wrapping in OrcaSlicer Web.
 * Exercises:
 *  1. Error validation on unattached/standalone target models (no silent planar fallback)
 *  2. Side placement on cylinder with radial normal [1, 0, 0]
 *  3. Verification that stored native useSurface is true in TextConfiguration/EmbossShape
 *  4. Focused geometry proof: actual text-volume vertices hug the curved cylinder surface
 *     (radial distances r = sqrt(x^2 + y^2) bounded within [R - 0.1, R + depth + 0.1]),
 *     demonstrating true conformal wrap and differing from planar tangent projection
 *  5. Edit roundtrip preserves useSurface true
 *  6. Cancellation rollback restores previous configuration on uncommitted panel close
 *  7. 3MF save and reopen roundtrip persists useSurface setting
 */

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const PORT = parseInt(process.env.PORT || '5139', 10);
const BASE_URL = `http://127.0.0.1:${PORT}/`;

// Cylinder fixture: Radius = 40 mm, Height = 60 mm, centered at origin
const CYLINDER_RADIUS = 40;
const CYLINDER_HEIGHT = 60;
const CYLINDER_MODEL_PATH = path.join(os.tmpdir(), 'orca-text-surface-cylinder.obj');

if (!fs.existsSync(CYLINDER_MODEL_PATH)) {
  const R = CYLINDER_RADIUS;
  const H = CYLINDER_HEIGHT;
  const N = 96;
  let obj = `v 0 0 0\nv 0 0 ${H}\n`;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI;
    obj += `v ${Math.cos(a) * R} ${Math.sin(a) * R} 0\nv ${Math.cos(a) * R} ${Math.sin(a) * R} ${H}\n`;
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const b1 = 3 + 2 * i;
    const t1 = 4 + 2 * i;
    const b2 = 3 + 2 * j;
    const t2 = 4 + 2 * j;
    obj += `f ${b1} ${b2} ${t2}\nf ${b1} ${t2} ${t1}\nf 1 ${b2} ${b1}\nf 2 ${t1} ${t2}\n`;
  }
  fs.writeFileSync(CYLINDER_MODEL_PATH, obj);
}

const SCREENSHOT_DIR = path.join(REPO_ROOT, 'wasm/tests/app/screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runTextSurfaceSuite() {
  console.log('\n==================================================');
  console.log('Running Curved-Surface Text Wrapping Suite');
  console.log('==================================================\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--no-sandbox']
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('Failed to load resource') && !text.includes('404') && !text.includes('favicon')) {
        pageErrors.push(`[Console Error] ${text}`);
      }
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  try {
    // 1. Navigate to app and initialize printer
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'load' });

    await selectAddedPrinter(page, 'Voron');
    await page.waitForFunction(() => {
      const p = document.getElementById('printer-select');
      return p && !p.disabled && Array.from(p.options).some((o) => o.value === 'Voron 2.4 300 0.4 nozzle');
    }, null, { timeout: 15000 });
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');

    // 2. Verification 1: Unattached model validation (no target model selected)
    console.log('Verifying actionable error when enabling wrapping without target model...');
    const textToolBtn = await page.waitForSelector('#tool-text-btn', { timeout: 5000 });
    await textToolBtn.click();
    await page.waitForSelector('#text-emboss-panel', { timeout: 5000 });

    const panelMetrics = await page.evaluate(() => {
      const p = document.getElementById('text-emboss-panel');
      const inp = document.getElementById('text-input');
      return {
        panelHeight: p ? p.getBoundingClientRect().height : 0,
        inputVisible: inp ? inp.getBoundingClientRect().height > 0 : false
      };
    });
    assert.ok(panelMetrics.panelHeight > 100, `Text panel must be fully expanded, got ${panelMetrics.panelHeight}px`);
    assert.ok(panelMetrics.inputVisible, 'Text input must be visibly drawn');

    // Without an object selected, surface toggle must be disabled or show actionable error
    const surfaceCheckbox = await page.waitForSelector('#use-surface-checkbox', { timeout: 5000 });
    assert.equal(await surfaceCheckbox.isDisabled(), true, 'useSurface checkbox must be disabled when unattached');

    // Attempting to force enable useSurface via store when unattached must set actionable error
    await page.evaluate(() => {
      window.__textStore.getState().setUseSurface(true);
    });
    const errorState = await page.evaluate(() => {
      const ts = window.__textStore.getState();
      return { error: ts.error, useSurface: ts.useSurface };
    });
    assert.equal(errorState.useSurface, false, 'useSurface must remain false when unattached');
    assert.ok(
      errorState.error && errorState.error.includes('Select a model'),
      `Actionable error required on unattached surface wrap attempt, got: ${errorState.error}`
    );
    results.push({ name: 'Unattached target model validation prevents silent planar fallback', pass: true });

    // Close text panel
    const closeBtn = await page.waitForSelector('#close-text-btn', { timeout: 5000 });
    await closeBtn.click();
    await page.waitForFunction(() => document.getElementById('text-emboss-panel') === null, null, { timeout: 5000 });

    // 3. Import Cylinder Model
    console.log('Importing cylinder model...');
    await page.setInputFiles('#model-file', CYLINDER_MODEL_PATH);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    const cylinderObj = await page.evaluate(() => {
      const store = window.__plateStore?.getState();
      const obj = store.objects[0];
      return { id: obj.id, volumes: obj.volumes, offset: obj.instances[0].offset };
    });
    console.log('Imported cylinder:', cylinderObj);
    assert.equal(cylinderObj.volumes, 1, 'Cylinder must initially have 1 volume');

    // Select the cylinder object
    await page.evaluate((id) => {
      window.__plateStore.getState().selectObject(id);
    }, cylinderObj.id);
    await page.waitForTimeout(200);

    // 4. Verification 2: Place text on the SIDE of the cylinder with radial normal
    console.log('Placing text on cylinder SIDE with radial normal [1, 0, 0]...');
    const sidePos = [cylinderObj.offset[0] + CYLINDER_RADIUS, cylinderObj.offset[1], cylinderObj.offset[2]];
    const radialNorm = [1, 0, 0];
    const textDepth = 1.5;

    await page.evaluate(({ objId, pos, norm, depth }) => {
      const ts = window.__textStore.getState();
      ts.openForAdd(objId, { position: pos, normal: norm });
      ts.setText('CurvedWrap');
      ts.setSize(7.0);
      ts.setDepth(depth);
      ts.setUseSurface(true);
    }, { objId: cylinderObj.id, pos: sidePos, norm: radialNorm, depth: textDepth });

    await page.waitForSelector('#text-emboss-panel', { timeout: 5000 });

    const surfaceChecked = await page.isChecked('#use-surface-checkbox');
    assert.equal(surfaceChecked, true, 'useSurface checkbox must be checked');

    // Click Add Text
    console.log('Adding curved text volume to cylinder...');
    const addBtn = await page.waitForSelector('#add-text-btn', { timeout: 5000 });
    await addBtn.click();

    // Wait for text volume to be created on the cylinder
    await page.waitForFunction((objId) => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects.find((o) => o.id === objId);
      return obj && obj.volumes.length >= 2;
    }, cylinderObj.id, { timeout: 15000 });

    const treeAfterAdd = await page.evaluate((objId) => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects.find((o) => o.id === objId);
      return obj ? obj.volumes.map((v) => ({ id: v.id, name: v.name, type: v.type })) : [];
    }, cylinderObj.id);

    const textVol = treeAfterAdd.find((v) => v.name === 'CurvedWrap');
    assert.ok(textVol, 'Must find text volume named CurvedWrap');
    results.push({ name: 'Curved text volume added to cylinder side', pass: true });

    // 5. Verification 3: Verify stored native useSurface in engine
    console.log('Verifying stored native useSurface via getText...');
    const nativeTextInfo = await page.evaluate(async ({ objId, volId }) => {
      const engine = window.__orcaEngine;
      if (typeof engine.getText === 'function') {
        return await engine.getText({ objectId: objId, volumeId: volId });
      }
      return await engine.call('getText', { objectId: objId, volumeId: volId });
    }, { objId: cylinderObj.id, volId: textVol.id });

    console.log('Native getText result:', nativeTextInfo);
    assert.equal(nativeTextInfo.useSurface, true, 'Stored native useSurface must be true in EmbossShape');
    results.push({ name: 'Native engine reports useSurface === true', pass: true });

    // ContextMenu Edit 3D Text verification: normal mesh omits, created text exposes & opens editor
    console.log('Verifying ContextMenu Edit 3D Text item presence/absence...');
    const normalVol = treeAfterAdd.find((v) => v.id !== textVol.id);
    assert.ok(normalVol, 'Must find normal cylinder mesh volume');

    const normalMoreBtn = page.locator(`[data-testid="volume-more-btn-${normalVol.id}"]`).first();
    await normalMoreBtn.click();
    await page.locator('#object-list-context-menu').waitFor({ timeout: 5000 });
    await page.waitForTimeout(100);
    const normalEditText = await page.$('#menu-action-edit-text');
    assert.equal(normalEditText, null, 'Normal mesh menu must omit Edit 3D Text');
    await page.keyboard.press('Escape');
    await page.locator('#object-list-context-menu').waitFor({ state: 'detached', timeout: 5000 });

    const textMoreBtn = page.locator(`[data-testid="volume-more-btn-${textVol.id}"]`).first();
    await textMoreBtn.click();
    await page.locator('#object-list-context-menu').waitFor({ timeout: 5000 });
    const textEditAction = page.locator('#menu-action-edit-text');
    await textEditAction.waitFor({ timeout: 5000 });
    await textEditAction.click();
    await page.waitForSelector('#text-emboss-panel', { timeout: 5000 });
    const isTextPanelOpen = await page.evaluate(() => window.__textStore?.getState().isOpen);
    assert.equal(isTextPanelOpen, true, 'Clicking Edit 3D Text must open text panel editor');
    const closeEditBtn = await page.waitForSelector('#close-text-btn', { timeout: 5000 });
    await closeEditBtn.click();
    await page.waitForFunction(() => document.getElementById('text-emboss-panel') === null, null, { timeout: 5000 });
    results.push({ name: 'ContextMenu omits Edit 3D Text for normal mesh and opens editor for text volume', pass: true });
    // 6. Verification 4: Focused Geometry Proof (Conforming Curvature vs Planar)
    console.log('Computing radial geometry proof for curved text volume...');
    const curvedGeometry = await page.evaluate(async ({ objId, volId }) => {
      const store = window.__plateStore.getState();
      const m = await store.getMesh(objId);
      const volMeta = m.volumes?.find((v) => v.volumeId === volId);
      const vertices = Array.from(m.positions || m.vertices);
      const indices = Array.from(m.indices);

      // Extract unique 3D vertices belonging to the text volume
      const textVertices = [];
      const seen = new Set();
      const start = volMeta ? (volMeta.firstFacet !== undefined ? volMeta.firstFacet * 3 : (volMeta.startIndex || 0)) : 0;
      const count = volMeta ? (volMeta.facetCount !== undefined ? volMeta.facetCount * 3 : (volMeta.indexCount || indices.length)) : indices.length;

      for (let i = start; i < start + count; i++) {
        const vIdx = indices[i];
        if (!seen.has(vIdx)) {
          seen.add(vIdx);
          const x = vertices[vIdx * 3];
          const y = vertices[vIdx * 3 + 1];
          const z = vertices[vIdx * 3 + 2];
          textVertices.push({ x, y, z });
        }
      }

      // Compute radial distance r = sqrt(x^2 + y^2) for each vertex
      let minR = Infinity;
      let maxR = -Infinity;
      for (const v of textVertices) {
        const r = Math.hypot(v.x, v.y);
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }

      return {
        facetCount: volMeta ? volMeta.facetCount : m.triangleCount,
        vertexCount: textVertices.length,
        minR,
        maxR
      };
    }, { objId: cylinderObj.id, volId: textVol.id });

    console.log('Curved text volume geometry analysis:', curvedGeometry);
    // Cylinder radius is 40mm, depth is 1.5mm.
    // Wrapped vertices must strictly hug the surface between R - 0.1 (base offset) and R + depth + 0.15
    assert.ok(
      curvedGeometry.minR >= CYLINDER_RADIUS - 0.1,
      `Curved min radial distance ${curvedGeometry.minR} must be close to cylinder radius ${CYLINDER_RADIUS}`
    );
    assert.ok(
      curvedGeometry.maxR <= CYLINDER_RADIUS + textDepth + 0.15,
      `Curved max radial distance ${curvedGeometry.maxR} must not exceed cylinder radius + depth (${CYLINDER_RADIUS + textDepth})`
    );

    // Toggle useSurface OFF to compare with planar geometry
    console.log('Toggling useSurface OFF to compare with planar extrusion...');
    await page.evaluate(async (data) => {
      await window.__textStore.getState().openForEdit(data.objId, data.volId);
    }, { objId: cylinderObj.id, volId: textVol.id });
    await page.waitForTimeout(300);

    await page.uncheck('#use-surface-checkbox');
    // Wait for debounced update to complete
    await page.waitForTimeout(800);
    await page.waitForFunction(() => !window.__textStore?.getState()?.isLoading, null, { timeout: 10000 });

    const planarGeometry = await page.evaluate(async ({ objId, volId }) => {
      const store = window.__plateStore.getState();
      const m = await store.getMesh(objId);
      const volMeta = m.volumes?.find((v) => v.volumeId === volId);
      const vertices = Array.from(m.positions || m.vertices);
      const indices = Array.from(m.indices);

      const textVertices = [];
      const seen = new Set();
      const start = volMeta ? (volMeta.firstFacet !== undefined ? volMeta.firstFacet * 3 : (volMeta.startIndex || 0)) : 0;
      const count = volMeta ? (volMeta.facetCount !== undefined ? volMeta.facetCount * 3 : (volMeta.indexCount || indices.length)) : indices.length;

      for (let i = start; i < start + count; i++) {
        const vIdx = indices[i];
        if (!seen.has(vIdx)) {
          seen.add(vIdx);
          const x = vertices[vIdx * 3];
          const y = vertices[vIdx * 3 + 1];
          const z = vertices[vIdx * 3 + 2];
          textVertices.push({ x, y, z });
        }
      }

      let maxR = -Infinity;
      for (const v of textVertices) {
        const r = Math.hypot(v.x, v.y);
        if (r > maxR) maxR = r;
      }

      return {
        facetCount: volMeta ? volMeta.facetCount : m.triangleCount,
        maxR
      };
    }, { objId: cylinderObj.id, volId: textVol.id });

    console.log('Planar text volume geometry analysis:', planarGeometry);
    // Planar text on tangent plane sticks out past R + depth at the text edges
    assert.ok(
      planarGeometry.maxR > CYLINDER_RADIUS + textDepth + 0.5,
      `Planar text max radial distance ${planarGeometry.maxR} must stick out beyond cylinder surface curvature`
    );
    assert.ok(
      curvedGeometry.facetCount !== planarGeometry.facetCount,
      `Curved facet count (${curvedGeometry.facetCount}) must differ from planar facet count (${planarGeometry.facetCount})`
    );
    results.push({ name: 'Geometry proof: vertices follow curved cylinder surface and differ from planar', pass: true });

    // 7. Verification 5: Edit roundtrip preserves useSurface true
    console.log('Toggling useSurface back to TRUE and updating text in edit mode...');
    await page.check('#use-surface-checkbox');
    await page.fill('#text-input', 'CurvedEdit');
    await page.waitForTimeout(400);

    const updateBtn = await page.waitForSelector('#update-text-btn', { timeout: 5000 });
    await updateBtn.click();
    await page.waitForTimeout(600);
    await page.waitForFunction(() => !window.__textStore?.getState()?.isLoading, null, { timeout: 10000 });

    const editedNativeInfo = await page.evaluate(async ({ objId, volId }) => {
      const engine = window.__orcaEngine;
      if (typeof engine.getText === 'function') {
        return await engine.getText({ objectId: objId, volumeId: volId });
      }
      return await engine.call('getText', { objectId: objId, volumeId: volId });
    }, { objId: cylinderObj.id, volId: textVol.id });

    assert.equal(editedNativeInfo.useSurface, true, 'Edit roundtrip must preserve useSurface === true');
    assert.equal(editedNativeInfo.text, 'CurvedEdit', 'Updated text string must be CurvedEdit');
    results.push({ name: 'Edit roundtrip preserves useSurface === true', pass: true });

    // 8. Verification 6: Cancellation rollback restores previous config
    console.log('Testing cancellation rollback on panel close...');
    await page.evaluate(async (data) => {
      await window.__textStore.getState().openForEdit(data.objId, data.volId);
    }, { objId: cylinderObj.id, volId: textVol.id });
    await page.waitForTimeout(300);

    // Make live uncommitted change: turn off surface and change text
    await page.fill('#text-input', 'UncommittedChange');
    await page.uncheck('#use-surface-checkbox');
    await page.waitForTimeout(600);

    // Close panel without committing
    const finalCloseBtn = await page.waitForSelector('#close-text-btn', { timeout: 5000 });
    await finalCloseBtn.click();
    await page.waitForFunction(() => document.getElementById('text-emboss-panel') === null, null, { timeout: 5000 });

    // Stored config must have rolled back to committed CurvedEdit with useSurface true
    const rolledBackInfo = await page.evaluate(async ({ objId, volId }) => {
      const engine = window.__orcaEngine;
      if (typeof engine.getText === 'function') {
        return await engine.getText({ objectId: objId, volumeId: volId });
      }
      return await engine.call('getText', { objectId: objId, volumeId: volId });
    }, { objId: cylinderObj.id, volId: textVol.id });

    assert.equal(rolledBackInfo.text, 'CurvedEdit', 'Rollback must restore committed text CurvedEdit');
    assert.equal(rolledBackInfo.useSurface, true, 'Rollback must restore useSurface true');
    results.push({ name: 'Cancellation rollback restores committed configuration and useSurface', pass: true });

    // 9. Verification 7: Save to 3MF and reopen preserves setting
    console.log('Testing 3MF project save and reload persistence...');
    const projectBytes = await page.evaluate(async () => {
      const app = window.__appStore.getState();
      return Array.from(await app.saveProjectFile('curved-surface-project.3mf'));
    });
    assert.ok(projectBytes.length > 0, 'Saved 3MF project bytes must not be empty');

    // Reopen 3MF project
    await page.evaluate(async (bytes) => {
      const app = window.__appStore.getState();
      const file = new File([new Uint8Array(bytes)], 'curved-surface-project.3mf', {
        type: 'application/vnd.ms-3mfdocument'
      });
      await app.openProjectFile(file);
    }, projectBytes);

    await page.waitForFunction(() => {
      const store = window.__plateStore?.getState();
      return store && store.objects.length >= 1;
    }, null, { timeout: 15000 });

    const reloadedInfo = await page.evaluate(async () => {
      const tree = window.__objectListStore?.getState();
      const obj = tree?.objects[0];
      const vol = obj?.volumes.find((v) => v.name === 'CurvedEdit');
      if (!obj || !vol) return null;
      const engine = window.__orcaEngine;
      if (typeof engine.getText === 'function') {
        return await engine.getText({ objectId: obj.id, volumeId: vol.id });
      }
      return await engine.call('getText', { objectId: obj.id, volumeId: vol.id });
    });

    console.log('Reloaded project text configuration:', reloadedInfo);
    assert.ok(reloadedInfo, 'Must find reloaded text volume in 3MF project');
    assert.equal(reloadedInfo.useSurface, true, '3MF reload must preserve useSurface === true');
    results.push({ name: '3MF project save and reopen preserves useSurface === true', pass: true });

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'text-surface-chromium.png') });

    await context.close();
    await browser.close();

    console.log('\nAll Curved-Surface Text Wrapping Tests Passed!');
    for (const r of results) {
      console.log(`  ✓ ${r.name}`);
    }

    assert.equal(pageErrors.length, 0, `Page errors occurred: ${pageErrors.join(', ')}`);
  } catch (err) {
    await browser.close();
    throw err;
  }
}

async function main() {
  try {
    await startServer(PORT, 'text-surface');
    await runTextSurfaceSuite();
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nCurved surface test suite failed:', err);
  process.exit(1);
});
