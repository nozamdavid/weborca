// Focused built-UI regression. Native cube setup and store selection use the existing app seams.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const { hostedFixture } = await import(path.resolve('wasm/build/tests-selection-panel-collapse/qa/hosted-fixture.mjs'));

const output = path.resolve(process.env.SELECTION_QA_DIR || 'wasm/build/tests-selection-panel-collapse/qa');
const root = process.env.QA_ROOT || fs.readFileSync(path.join(output, 'candidate-path.txt'), 'utf8').trim();
const red = process.argv.includes('--red');
const fixture = await hostedFixture(root);
let browser;
try {
  browser = await chromium.launch({ headless: false, args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const errors = [], expected = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const item = { url: m.location().url, text: m.text() };
    if (item.url === fixture.origin + '/vite.svg' && item.text.includes('404')) expected.push(item);
    else errors.push(item);
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
    localStorage.setItem('orcaslicer_preferences_v1', JSON.stringify({ general: { slicingThreads: 1, autosave: false, autoSliceAfterChange: false, language: 'en' } }));
  });
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin !== fixture.origin) return r.abort();
    if (/^\/(_orca-cloud|orca-cloud)\/status$/.test(u.pathname)) return r.fulfill({ json: { enabled: false, signedIn: false } });
    return r.continue();
  });
  await page.goto(fixture.origin + '/prepare');
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  await page.mouse.click(950, 300, { button: 'right' });
  await page.hover('#plate-menu-primitive');
  await page.click('#plate-menu-cube');
  await page.waitForFunction(() => __plateStore.getState().objects.length === 1);
  const idle = async () => {
    await page.waitForFunction(() => !__plateStore.getState().isLoading && !__objectListStore.getState().isLoading && !__historyStore.getState().isRestoring);
    await page.waitForTimeout(150);
  };
  const select = async index => {
    await page.evaluate(index => { const s = __plateStore.getState(), o = s.objects[index]; s.selectObject(o.id, o.instances[0].id); }, index);
    await idle();
  };
  await select(0);
  const panel = page.locator('#selection-panel'), toggle = page.locator('#selection-panel-toggle');
  const measure = () => panel.evaluate(e => {
    const r = e.getBoundingClientRect(), v = e.parentElement.getBoundingClientRect(), s = getComputedStyle(e);
    return { panel: r.toJSON(), viewer: v.toJSON(), right: s.right, left: s.left, bottom: parseFloat(s.bottom), overflow: e.scrollWidth > e.clientWidth + 1 };
  });
  if (red) {
    const m = await measure();
    console.log('INCUMBENT', JSON.stringify(m), 'toggle count', await toggle.count());
    assert.equal(await toggle.count(), 1, 'incumbent missing collapse/expand button; right offset also must be 16px');
    assert.equal(m.right, '16px');
  }
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true', 'default expanded');
  assert.equal(await toggle.getAttribute('aria-controls'), 'selection-panel-body');
  assert.equal(await toggle.getAttribute('title'), 'Collapse');
  const expanded = async () => {
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    for (const selector of ['#selected-object-size', '#numeric-transform', '#nt-lock', '.selection-panel-health']) assert.ok(await page.locator(selector).isVisible(), selector);
  };
  const collapsed = async () => {
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(await page.locator('#selected-object-name').isVisible());
    assert.ok(await page.locator('#selection-count').isVisible());
    assert.equal(await page.locator('#selection-panel-body').isVisible(), false);
    assert.equal(await page.locator('#selection-panel-body input:visible, #selection-panel-body button:visible').count(), 0, 'all body focusables hidden');
    const h = await panel.boundingBox(), row = await page.locator('.selection-panel-header').boundingBox();
    assert.ok(h.height <= row.height + 2, 'collapsed panel is one compact row');
  };
  const fits = async label => {
    const m = await measure(), r = m.panel, v = m.viewer;
    assert.equal(m.right, '16px');
    assert.ok(Math.abs(v.right - r.right - 16) <= 1, 'bottom right viewer placement');
    assert.ok(Math.abs(v.bottom - r.bottom - m.bottom) <= 1, 'inherited action clearance');
    assert.ok(r.top >= v.top && r.bottom <= v.bottom && r.left >= v.left && !m.overflow, 'panel fits viewer');
    const actions = await page.locator('#plate-selector-bar').boundingBox();
    if (actions) assert.ok(r.bottom <= actions.y, 'panel clears bottom actions');
    console.log('MEASUREMENT', label, JSON.stringify(m));
  };
  await expanded();
  for (const theme of ['dark', 'light']) for (const scale of [100, 125]) for (const width of [1280, 820]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(({ theme, scale }) => {
      __prefsStore.getState().setDisplayPref('theme', theme);
      __prefsStore.getState().setDisplayPref('fontScale', scale);
    }, { theme, scale });
    await idle();
    await fits(`${width}-${scale}-${theme}-expanded`);
    await toggle.click(); await collapsed(); await fits(`${width}-${scale}-${theme}-collapsed`);
    await page.screenshot({ path: path.join(output, `selection-${width}-${scale}-${theme}-collapsed.png`) });
    await toggle.focus(); await page.keyboard.press('Enter'); await expanded();
    assert.equal(await toggle.evaluate(e => getComputedStyle(e).outlineStyle), 'solid', 'visible keyboard focus');
    await page.screenshot({ path: path.join(output, `selection-${width}-${scale}-${theme}-expanded.png`) });
    await page.keyboard.press('Space'); await collapsed();
    await page.keyboard.press('Space'); await expanded();
  }
  console.log('PASS pointer, Enter/Space, focus, expanded/collapsed desktop matrix');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => __prefsStore.getState().setDisplayPref('fontScale', 100));
  // Create another native cube through the established primitive action.
  await page.mouse.click(950, 300, { button: 'right' });
  await page.hover('#plate-menu-primitive'); await page.click('#plate-menu-cube');
  await page.waitForFunction(() => __plateStore.getState().objects.length === 2);
  await select(0); await toggle.click(); await collapsed();
  await select(1); await collapsed();
  const id = await page.evaluate(() => __plateStore.getState().objects[1].id);
  assert.equal(await page.locator('#selection-count').textContent(), `ID: ${id}`);
  const longName = 'Long selected object name '.repeat(12) + '.stl';
  await page.evaluate(name => __plateStore.setState(s => ({ objects: s.objects.map((o, i) => i === 1 ? { ...o, name } : o) })), longName);
  assert.equal(await page.locator('#selected-object-name').getAttribute('title'), longName);
  assert.ok(await page.locator('#selected-object-name').evaluate(e => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === 'ellipsis'));
  await toggle.click({ trial: true });
  await page.evaluate(() => { const s = __plateStore.getState(), o = s.objects[0]; s.toggleSelect(o.id, o.instances[0].id); });
  assert.equal(await page.locator('#selection-count').textContent(), '+1 more selected');
  await collapsed(); await toggle.click();
  assert.equal(await page.locator('#numeric-transform').count(), 0, 'multi selection keeps existing transform suppression');
  assert.ok(await page.locator('.selection-panel-health').isVisible());
  await page.screenshot({ path: path.join(output, 'selection-long-multi.png') });
  await select(1);
  await expanded();
  // Body scrolls independently; its header remains reachable in a short viewer.
  await page.setViewportSize({ width: 820, height: 430 });
  await page.evaluate(() => __prefsStore.getState().setDisplayPref('fontScale', 125));
  await idle(); await fits('short-viewer');
  assert.ok(await page.locator('#selection-panel-body').evaluate(e => e.scrollHeight > e.clientHeight));
  await page.locator('#nt-lock').scrollIntoViewIfNeeded();
  await toggle.click({ trial: true });
  await page.screenshot({ path: path.join(output, 'selection-short-scrolled.png') });
  await toggle.click(); await collapsed(); await toggle.click(); await expanded();
  console.log('PASS long name, ID/count, selection-switch state and short-viewer scrolling');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => __prefsStore.getState().setDisplayPref('fontScale', 100));
  await select(0);
  const before = await page.evaluate(() => __plateStore.getState().objects[0].instances[0].offset[0]);
  await page.fill('#nt-pos-x', String(before + 7)); await page.press('#nt-pos-x', 'Enter');
  await page.waitForFunction(x => Math.abs(__plateStore.getState().objects[0].instances[0].offset[0] - x) < 0.01, before + 7);
  await page.click('#tool-undo-btn'); await idle();
  await page.waitForFunction(x => Math.abs(__plateStore.getState().objects[0].instances[0].offset[0] - x) < 0.01, before);
  console.log('PASS numeric transform and native Undo after expand');
  for (const width of [320, 390]) for (const theme of ['dark', 'light']) for (const scale of [100, 125]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(({ theme, scale }) => { __prefsStore.getState().setDisplayPref('theme', theme); __prefsStore.getState().setDisplayPref('fontScale', scale); }, { theme, scale });
    await select(0); await idle();
    assert.equal(await panel.isVisible(), false, 'inherited mobile overlay hidden');
    const tools = page.getByRole('button', { name: 'Plate tools', exact: true });
    if (await tools.getAttribute('aria-expanded') === 'false') await tools.click();
    for (const [mode, input] of [['translate', '#mobile-nt-pos-x'], ['scale', '#mobile-nt-scale-x']]) {
      // Mode setup uses the existing store; field interaction and placement are real rendered UI.
      await page.evaluate(mode => __plateStore.getState().setGizmoMode(mode), mode);
      await page.locator(input).scrollIntoViewIfNeeded();
      assert.ok(await page.locator(input).isVisible());
      assert.equal(await page.locator(input).evaluate(e => !!e.closest('.wm-viewport')), false, 'mobile numeric transforms stay outside viewer');
      await page.locator(input).click({ trial: true });
    }
    await page.screenshot({ path: path.join(output, `selection-mobile-${width}-${scale}-${theme}.png`) });
    console.log('PASS mobile overlay and Move/Scale', width, scale, theme);
  }
  assert.deepEqual(errors, []);
  console.log('EXPECTED_INHERITED_FAVICON_404', JSON.stringify(expected));
  console.log('PASS selection-panel built UI; physical Mac/Safari/Firefox unverified');
} finally { await browser?.close(); await fixture.close(); }
