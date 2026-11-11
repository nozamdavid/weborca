// Run against the combined candidate: ORCA_APP_URL=http://127.0.0.1:PORT node wasm/tests/app/background-engine.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { chromium } from '../node_modules/playwright/index.mjs';

const upstream = new URL(process.env.ORCA_APP_URL || 'http://127.0.0.1:5396');
const width = Number(process.env.ORCA_QA_WIDTH || 1280);
let mode = 'hold', release, successfulRequests = 0;
const proxy = http.createServer((req, res) => {
  const engine = req.url.split('?')[0] === '/engine/orca_engine.wasm';
  if (engine) {
    if (mode === 'fail') { res.writeHead(503); res.end('synthetic engine outage'); return; }
  }
  const request = http.request(new URL(req.url, upstream), { method: req.method, headers: { ...req.headers, host: upstream.host,
    ...req.headers.origin === origin && { origin: upstream.origin } } }, response => {
    res.writeHead(response.statusCode, { ...response.headers, 'cache-control': 'no-store' });
    if (engine && response.statusCode === 200) successfulRequests++;
    if (engine && response.statusCode === 200 && mode === 'hold') {
      response.pause();
      release = () => response.pipe(res);
    } else response.pipe(res);
    res.on('close', () => response.destroy());
  });
  request.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(request);
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${proxy.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--renderer-process-limit=2'] });
try {
  for (const failFirst of [false, true]) {
    mode = failFirst ? 'fail' : 'hold'; release = undefined; successfulRequests = 0;
    const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
      localStorage.setItem('orcaslicer_preferences_v1', JSON.stringify({ general: { slicingThreads: 1, autosave: false, autoSliceAfterChange: false, language: 'en' } }));
      window.__engineWorkers = 0;
      window.Worker = new Proxy(window.Worker, { construct(target, args) {
        if (String(args[0]).endsWith('/engine-worker.js')) window.__engineWorkers++;
        return Reflect.construct(target, args);
      } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // A production gated build always requires a session, including when the
    // focused viewer proxy is the consumer. Use synthetic local state only.
    if (process.env.ORCA_QA_PASSWORD) {
      const api = async (route, body, token) => {
        const response = await fetch(new URL('/_alpha' + route, upstream), {
          method: 'POST', headers: { Origin: upstream.origin, 'Content-Type': 'application/json',
            ...token && { Authorization: 'Bearer ' + token } }, body: JSON.stringify(body)
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      const admin = await api('/admin/login', { password: process.env.ORCA_QA_PASSWORD });
      const app = await api('/admin/open-slicer', {}, admin.token);
      await context.addCookies([{ name: 'orca_alpha', value: app.token, url: origin, httpOnly: true, sameSite: 'Strict' }]);
    }
    await page.goto(origin + '/prepare');
    await page.waitForFunction(() => window.__plateScene && window.__appStore);
    if (failFirst) await page.waitForFunction(() => !!window.__appStore.getState().engineError);
    else {
      for (let i = 0; !release && i < 100; i++) await page.waitForTimeout(50);
      assert.ok(release, 'actual engine WASM response is held');
    }
    await page.evaluate(() => {
      window.__earlyScene = window.__plateScene;
      window.__earlyCanvas = window.__plateScene.renderer.domElement;
      window.__earlyControls = window.__plateScene.orbitControls;
    });
    const checkViewer = async () => {
      assert.equal(await page.locator('#plate-canvas-container canvas').count(), 1);
      assert.equal(await page.locator('#plate-canvas-container canvas').isVisible(), true);
      const scene = await page.evaluate(() => ({
        same: window.__plateScene === window.__earlyScene && window.__plateScene.renderer.domElement === window.__earlyCanvas && window.__plateScene.orbitControls === window.__earlyControls,
        bed: window.__plateScene.bedGroup.visible,
        grid: window.__plateScene.bedGroup.children.length,
        enabled: window.__plateScene.orbitControls.enabled,
      }));
      assert.equal(scene.same, true, 'startup/retry preserves scene, canvas/context and controls/listeners');
      assert.equal(scene.bed, true, 'Prepare build plate/grid visible before engine readiness');
      assert.ok(scene.grid > 0, 'JS bed contains geometry');
      assert.equal(scene.enabled, true);
      const camera = () => page.evaluate(() => ({ position: window.__plateScene.camera.position.toArray(), target: window.__plateScene.orbitControls.target.toArray() }));
      const box = await page.locator('#plate-canvas-container canvas').boundingBox();
      const x = box.x + box.width * .55, y = box.y + box.height * .55;
      for (const button of ['left', 'right']) {
        const before = await camera();
        await page.mouse.move(x, y); await page.mouse.down({ button });
        await page.mouse.move(x + 60, y + 35, { steps: 5 }); await page.mouse.up({ button });
        await page.waitForTimeout(150);
        assert.notDeepEqual(await camera(), before, button === 'left' ? 'orbit works' : 'pan works');
      }
      const before = await camera();
      await page.mouse.wheel(0, -200); await page.waitForTimeout(150);
      assert.notDeepEqual(await camera(), before, 'zoom works');
    };
    await checkViewer();
    assert.equal(await page.evaluate(() => window.__appStore.getState().isEngineReady), false);
    assert.equal(await page.locator('#slice-plate-btn').isDisabled(), true);
    if (width <= 800) {
      assert.equal(await page.getByRole('button', { name: 'Slice plate', exact: true }).last().isDisabled(), true);
      await page.getByRole('button', { name: 'Plate tools', exact: true }).click();
    }
    const textInOverflow = !await page.locator('#tool-text-btn').count();
    if (textInOverflow) await page.locator('#tool-more-btn').click();
    assert.equal(await page.locator('#tool-text-btn').isDisabled(), true);
    if (textInOverflow) await page.keyboard.press('Escape');
    if (failFirst) {
      mode = 'hold';
      await page.evaluate(() => { void window.__appStore.getState().initApp(); });
    }
    if (failFirst) {
      for (let i = 0; !release && i < 100; i++) await page.waitForTimeout(50);
      assert.ok(release, 'retry reaches real engine response');
      await checkViewer();
    }
    mode = 'send'; release();
    await page.waitForFunction(() => window.__appStore.getState().isEngineReady, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__plateScene.bedGroup.visible);
    await checkViewer();
    const cube = fs.readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
    await page.evaluate(async text => {
      await window.__appStore.getState().importModelFile(new File([text], 'early-viewer-cube.obj'));
    }, cube);
    await page.waitForFunction(() => window.__plateScene.objectMeshes.size > 0);
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 1, 'ready native geometry hydrates the existing viewer');
    assert.equal(await page.evaluate(() => window.__plateScene === window.__earlyScene), true);
    assert.equal(successfulRequests, 1, 'one successful WASM response per startup');
    assert.equal(await page.evaluate(() => window.__engineWorkers), failFirst ? 2 : 1, 'one worker per startup attempt');
    assert.deepEqual(errors, []);
    console.log(`PASS early Prepare viewer ${width}px, ${failFirst ? 'failed download/retry' : 'held download'}, eventual readiness, one scene/context/controls`);
    await context.close();
  }
} finally {
  await browser.close();
  proxy.closeAllConnections();
  await new Promise(resolve => proxy.close(resolve));
}
