/** Run against a served app: ORCA_APP_URL=http://127.0.0.1:5076 node <this file>. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '../node_modules/playwright/index.mjs';

const baseUrl = process.env.ORCA_APP_URL || 'http://127.0.0.1:5076';
const cube = fs.readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--enable-features=SharedArrayBuffer'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}/prepare`);
  await page.waitForFunction(() => window.__plateScene && window.__appStore?.getState().isEngineReady);
  await page.evaluate(async text => window.__appStore.getState().importModelFile(new File([text], 'visibility-cube.obj')), cube);
  await page.waitForFunction(() => window.__plateScene.objectMeshes.size > 0);
  const result = await page.evaluate(async () => {
    const scene = window.__plateScene;
    const renderer = scene.renderer;
    const render = renderer.render.bind(renderer);
    const update = scene.orbitControls.update.bind(scene.orbitControls);
    let renders = 0, updates = 0;
    renderer.render = (...args) => { renders++; return render(...args); };
    scene.orbitControls.update = (...args) => { updates++; return update(...args); };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const sample = async () => {
      await wait(150); // Allow ResizeObserver / IntersectionObserver to deliver the transition.
      renders = updates = 0;
      await wait(400);
      return { renders, updates, frame: scene.animationFrameId };
    };
    try {
      const visible = await sample();
      document.getElementById('tab-preview').click();
      const hidden = await sample();
      const thumbnail = scene.renderThumbnail({ width: 64, height: 64, format: 'PNG' });
      const thumbnailRenders = renders;
      document.getElementById('tab-prepare').click();
      const resumed = await sample();
      const container = scene.container;
      container.style.transform = 'translateY(10000px)';
      const offscreen = await sample();
      container.style.transform = '';
      const returned = await sample();
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      const background = await sample();
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      document.documentElement.dataset.theme = 'light';
      const foreground = await sample();
      const themeApplied = scene.scene.userData.lightTheme;
      return { visible, hidden, thumbnail: thumbnail?.startsWith('data:image/png;base64,'), thumbnailRenders, resumed, offscreen, returned, background, foreground, themeApplied };
    } finally {
      renderer.render = render;
      scene.orbitControls.update = update;
      scene.container.style.transform = '';
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });
  for (const state of ['visible', 'resumed', 'returned', 'foreground']) {
    assert.ok(result[state].renders >= 2, `${state} must resume drawing`);
    assert.equal(result[state].renders, result[state].updates);
  }
  for (const state of ['hidden', 'offscreen', 'background']) {
    assert.equal(result[state].renders, 0, `${state} must not draw`);
    assert.equal(result[state].updates, 0, `${state} must not update orbit controls`);
    assert.equal(result[state].frame, null, `${state} must cancel its frame loop`);
  }
  assert.equal(result.thumbnail, true, 'hidden Prepare must still export a thumbnail');
  assert.equal(result.thumbnailRenders, 1, 'thumbnail must explicitly render once');
  assert.equal(result.themeApplied, true, 'theme must update after visibility resumes');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, ...result }, null, 2));
} finally {
  await browser.close();
}
