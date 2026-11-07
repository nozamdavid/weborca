#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { controlValue, controlOptions, selectControl } from './mobile-setting-coverage.mjs';

const root = process.cwd();
const screenshots = path.resolve(root, process.env.APP_TEST_OUTPUT ?? 'wasm/build/tests-app/mobile-controls-final');
const port = 5172;
const origin = `http://127.0.0.1:${port}`;
fs.mkdirSync(screenshots, { recursive: true });
let browser;
const errors = [];
// Whole-vector and nullable fallbacks must never inherit a decimal-only hint.
const mobileInputSource = fs.readFileSync(path.join(root, 'wasm/app/src/mobile/MobileInput.tsx'), 'utf8');
const settingInputSource = fs.readFileSync(path.join(root, 'wasm/app/src/settings/SettingInput.tsx'), 'utf8');
assert.doesNotMatch(mobileInputSource, /inputMode=/, 'MobileInput does not assign a global keyboard hint');
assert.match(settingInputSource, /type="text"\s+aria-label=[^\n]+\s+inputMode="text"/, 'text fallback keeps full grammar');

async function grammar(page, key, value, hint, kind = 'print') {
  const input = page.locator(`#setting-input-${key}`).first();
  const target = await page.evaluate(({ key, kind }) => ({ key,
    ...(kind === 'filament' ? { filamentIndex: window.__appStore.getState().activeFilamentSlot ?? 0, layoutIndex: 0 } : {}) }), { key, kind });
  try {
    await input.waitFor();
    await page.waitForFunction(key => !document.querySelector(`#setting-input-${key}`)?.disabled, key);
    assert.equal(await input.getAttribute('inputmode'), hint, `${key}: keyboard hint`);
    const nativeValue = () => page.evaluate(async target => (await window.__orcaEngine.call('getOption', target)).value, target);
    const waitValue = value => page.waitForFunction(({ target, value }) =>
      !Object.keys(window.__appStore.getState().pendingOptions).length &&
      window.__appStore.getState().currentConfig[target.key] === value, { target, value });
    const baseline = await page.evaluate(async target => {
      const s = window.__appStore.getState();
      const preset = s.presetConfig[target.key] ?? s.configDefs[target.key].default;
      const serializedValue = preset?.trim() ? preset : s.configDefs[target.key].default;
      return (await window.__orcaEngine.call('getOption', { ...target, serializedValue })).value;
    }, target);
    await input.fill(value); await input.blur();
    await waitValue(value);
    assert.equal(await nativeValue(), value, `${key}: exact native value`);
    if (value === baseline) {
      await page.getByTestId(`reset-btn-${key}`).first().waitFor({ state: 'detached' });
      assert.equal(await page.getByTestId(`reset-btn-${key}`).count(), 0, `${key}: baseline has no reset arrow`);
      return;
    }
    await page.getByTestId(`reset-btn-${key}`).first().click();
    await page.waitForFunction(({ target, baseline }) =>
      !Object.keys(window.__appStore.getState().pendingOptions).length &&
      window.__appStore.getState().currentConfig[target.key] === baseline, { target, baseline });
    assert.equal(await nativeValue(), baseline, `${key}: native reset`);
  } catch (error) {
    if (error.name === 'TimeoutError') console.error('Grammar timeout', await page.evaluate(async target => {
      const s = window.__appStore.getState();
      return { target, config: s.currentConfig[target.key], preset: s.presetConfig[target.key],
        default: s.configDefs[target.key].default, native: (await window.__orcaEngine.call('getOption', target)).value,
        draft: document.querySelector(`#setting-input-${target.key}`)?.value, pending: s.pendingOptions };
    }, target));
    throw error;
  }
}
async function selector(page, id, screenshot) {
  const trigger = page.locator(id);
  const before = await controlValue(trigger);
  await trigger.click();
  const modal = page.locator('.mobile-selector');
  const box = await modal.boundingBox();
  assert.deepEqual(box, { x: 0, y: 0, ...page.viewportSize() }, 'selector covers whole viewport');
  assert.equal(await page.locator('#root').evaluate(node => node.inert), true);
  assert.equal(await modal.getAttribute('aria-modal'), 'true');
  assert.ok(await modal.locator('[aria-selected=true]').count(), 'current option marked');
  const search = modal.getByRole('searchbox');
  if (await search.count()) {
    await search.fill('no-match-xyz');
    assert.match(await modal.innerText(), /No matching options/);
    await search.fill('');
  }
  await page.keyboard.press('Shift+Tab');
  assert.equal(await modal.evaluate(node => node.contains(document.activeElement)), true);
  await page.keyboard.press('Tab');
  assert.equal(await modal.evaluate(node => node.contains(document.activeElement)), true);
  assert.equal(await modal.evaluate(node => node.scrollWidth <= node.clientWidth), true);
  if (screenshot) await page.screenshot({ path: path.join(screenshots, screenshot) });
  await page.keyboard.press('Escape');
  assert.equal(await modal.count(), 0);
  assert.equal(await controlValue(trigger), before);
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator('.mobile-flow').count(), 1, 'cancel keeps underlying flow');
  await trigger.click();
  await page.locator('.mobile-selector-close').click();
  assert.equal(await controlValue(trigger), before);
}
async function buttonGeometry(page, selector) {
  const geometry = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { text: node.textContent, x: box.x, right: box.right, width: box.width, height: box.height,
      radius: style.borderRadius, clipped: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight };
  }));
  assert.ok(geometry.length);
  for (const button of geometry) {
    assert.ok(button.width >= 44 && button.height >= 44, `${button.text}: touch target`);
    assert.ok(button.x >= 0 && button.right <= page.viewportSize().width, `${button.text}: viewport bounds`);
    assert.equal(button.clipped, false, `${button.text}: readable text`);
    assert.equal(button.radius, '12px');
  }
}
async function settleSheet(page, selector) {
  await page.waitForFunction(selector => {
    const node = document.querySelector(selector);
    if (!node) return false;
    const style = getComputedStyle(node);
    return style.opacity === '1' && style.transform === 'none';
  }, selector);
}
try {
  await startServer(port, 'mobile-controls', { frozenDist: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Only this frozen static site is reachable. Gateway/device/cloud calls never leave the fixture.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || /^\/(api|gateway|printer|cloud|device|_printer|_gw|_cloud|_orca-cloud)(\/|$)/.test(url.pathname)) return route.abort();
    if (url.pathname === '/app-config.json') return route.fulfill({ json: { mobileSliceSteps: 'layer_height,enable_support,support_type,z_offset,line_width,filament_retraction_length' } });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 120000 });
  await page.evaluate(async () => {
    window.__prefsStore.getState().setGeneralPref('autosave', false);
    window.__prefsStore.getState().setGeneralPref('autoSliceAfterChange', false);
    await window.__appStore.getState().chooseVendor('Voron');
    await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
    const state = window.__appStore.getState();
    window.__appStore.setState({ userPresets: [...state.userPresets, { kind: 'printer', name: 'Phone saved profile', config: {} }] });
  });
  await page.setInputFiles('#mobile-import', path.join(root, 'tests/data/20mm_cube.obj'));
  await page.waitForFunction(() => window.__appStore.getState().modelFile && !window.__appStore.getState().isModelLoading);
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    for (const font of [100, 150]) for (const theme of ['light', 'dark']) {
      await page.evaluate(({ font, theme }) => {
        document.documentElement.style.setProperty('--ui-font-scale', String(font / 100));
        document.documentElement.dataset.theme = theme;
      }, { font, theme });
      const suffix = `${viewport.width}-${font}-${theme}.png`;
      await buttonGeometry(page, '.mobile-view-tabs > button, .mobile-import-bar > .ds-btn, #mobile-choose-settings');
      assert.equal(await page.getByRole('button', { name: 'Preview', exact: true }).isDisabled(), true);
      await page.screenshot({ path: path.join(screenshots, `buttons-prepare-${suffix}`) });
      await page.click('#mobile-choose-settings');
      await buttonGeometry(page, '.mobile-flow > footer > button');
      await selector(page, '#mobile-printer-select', `printer-${suffix}`);
      await page.click('#mobile-printer-select');
      assert.equal(await page.locator('.mobile-selector-group').innerText(), 'User presets');
      assert.equal(await page.locator('.mobile-selector [data-value="__add_printer__"]').evaluate(node => node.previousElementSibling?.getAttribute('role')), 'separator');
      await page.keyboard.press('Escape');
      await page.click('#mobile-next'); await page.click('#mobile-advanced-mode'); await page.click('#mobile-next');
      await selector(page, '#mobile-process', `process-${suffix}`);
      const process = await controlValue(page.locator('#mobile-process'));
      await selectControl(page.locator('#mobile-process'), process);
      await page.waitForFunction(() => !window.__appStore.getState().isSelectingPreset && !document.querySelector('#mobile-next').disabled);
      assert.equal(await page.evaluate(() => window.__appStore.getState().selectedProcess), process);
      await selector(page, '#mobile-filament', `filament-${suffix}`);
      assert.equal(await page.locator('.ds-steps [aria-current=step]').count(), 1);
      const filament = await controlValue(page.locator('#mobile-filament'));
      await selectControl(page.locator('#mobile-filament'), filament);
      await page.waitForFunction(() => !document.querySelector('#mobile-next').disabled);
      assert.equal(await page.evaluate(() => window.__appStore.getState().selectedFilament), filament);
      await page.click('#mobile-next');
      const numeric = page.locator('#setting-input-layer_height');
      assert.equal(await numeric.getAttribute('inputmode'), 'decimal');
      assert.equal(await numeric.evaluate(node => getComputedStyle(node).borderRadius), '12px');
      if (viewport.width === 390 && font === 100 && theme === 'light') {
        await numeric.fill('0.25'); await numeric.blur();
        await page.waitForFunction(() => window.__appStore.getState().currentConfig.layer_height === '0.25' &&
          !Object.keys(window.__appStore.getState().pendingOptions).length);
        const snapshot = () => page.evaluate(async () => {
          const s = window.__appStore.getState();
          return { currentConfig: s.currentConfig, processOverrides: s.processOverrides,
            nativeConfig: await window.__orcaEngine.getConfig() };
        });
        const edited = await snapshot();
        assert.equal(edited.processOverrides.layer_height, '0.25');
        assert.equal(edited.nativeConfig.layer_height, '0.25');
        await page.click('#mobile-back');
        const trigger = page.locator('#mobile-process');
        await trigger.click();
        assert.equal(await page.locator('#root').evaluate(node => node.inert), true);
        await page.locator('.mobile-selector [role=option][aria-selected=true]').click();
        await page.locator('.mobile-selector').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#root').evaluate(node => node.inert), false);
        assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
        assert.deepEqual(await snapshot(), edited, 'current process selection preserves edited config and overrides');
        await page.click('#mobile-next');
        await numeric.waitFor();
        assert.equal(await numeric.inputValue(), '0.25', 'Next preserves edited layer height');
        assert.deepEqual(await snapshot(), edited, 'Next preserves native config and overrides');
        await page.getByTestId('reset-btn-layer_height').first().click();
        await page.waitForFunction(() => !Object.keys(window.__appStore.getState().pendingOptions).length &&
          !('layer_height' in window.__appStore.getState().processOverrides));
        console.log('PASS current process selection preserves edited layer height, overrides and native config through Back/Next; closes, releases inert and returns focus');
      }
      await grammar(page, 'layer_height', '0.25', 'decimal');
      await page.screenshot({ path: path.join(screenshots, `numeric-${suffix}`) });
      await page.click('#mobile-next');
      await page.check('#setting-input-enable_support');
      await page.waitForFunction(() => window.__appStore.getState().currentConfig.enable_support === '1' && !Object.keys(window.__appStore.getState().pendingOptions).length);
      await page.click('#mobile-next');
      await selector(page, '#setting-input-support_type', `enum-${suffix}`);
      const original = await controlValue(page.locator('#setting-input-support_type'));
      const replacement = (await controlOptions(page.locator('#setting-input-support_type'))).find(value => value !== original);
      await selectControl(page.locator('#setting-input-support_type'), replacement);
      await page.waitForFunction(value => window.__appStore.getState().currentConfig.support_type === value && !Object.keys(window.__appStore.getState().pendingOptions).length, replacement);
      await page.click('#mobile-next');
      await grammar(page, 'z_offset', '-0.2', 'text', 'printer');
      await page.click('#mobile-next');
      await grammar(page, 'line_width', '100%', 'text');
      await page.click('#mobile-next');
      assert.equal(await page.evaluate(() => window.__appStore.getState().configDefs.filament_retraction_length.nullable), true);
      // Clear the inherited draft so typing nil exercises ordinary text entry.
      const nullable = page.locator('#setting-input-filament_retraction_length').first();
      await nullable.fill('');
      await grammar(page, 'filament_retraction_length', 'nil', 'text', 'filament');
      await page.locator('.mobile-flow header button').click();
    }
  }
  await page.click('#mobile-choose-settings');
  await selectControl(page.locator('#mobile-printer-select'), '__add_printer__');
  await page.waitForSelector('#wizard-dialog');
  assert.equal(await page.locator('.mobile-selector').count(), 0, 'selector closes before wizard');
  await page.check('#wizard-custom-printer');
  await page.fill('#wizard-custom-name', 'Draft phone printer');
  for (const id of ['#wizard-custom-shape', '#wizard-custom-firmware', '#wizard-vendor-select']) {
    const before = await controlValue(page.locator(id));
    await page.locator(id).click();
    await page.keyboard.press('Escape');
    assert.equal(await controlValue(page.locator(id)), before);
    assert.equal(await page.locator('#wizard-dialog').count(), 1);
    assert.equal(await page.getByTestId('confirm-dialog').count(), 0, 'Escape does not ask to discard parent draft');
  }
  await page.screenshot({ path: path.join(screenshots, 'wizard-320-150-dark.png') });
  await page.click('#wizard-close-x');
  await page.locator('.mobile-flow header button').click();
  await page.evaluate(() => window.__appStore.getState().startSlice());
  await page.waitForSelector('#mobile-preview-stats', { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#canvas')?.dataset.previewReady === 'true');
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    for (const font of [100, 150]) for (const theme of ['light', 'dark']) {
      await page.evaluate(({ font, theme }) => {
        document.documentElement.style.setProperty('--ui-font-scale', String(font / 100));
        document.documentElement.dataset.theme = theme;
      }, { font, theme });
      await buttonGeometry(page, '.mobile-view-tabs > button, .mobile-preview-actions > button');
      assert.equal(await page.getByRole('button', { name: 'Preview', exact: true }).getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('#mobile-download').isEnabled(), true);
      assert.equal(await page.locator('#mobile-send').isEnabled(), true);
      assert.notEqual(await page.locator('#mobile-download').evaluate(node => getComputedStyle(node).backgroundColor),
        await page.locator('#mobile-send').evaluate(node => getComputedStyle(node).backgroundColor));
      assert.equal(await page.locator('#mobile-download').evaluate(node => getComputedStyle(node).overflowWrap), 'normal', 'Download wraps between words');
      await page.screenshot({ path: path.join(screenshots, `buttons-preview-${viewport.width}-${font}-${theme}.png`) });
    }
  }
  console.log('PASS mobile tabs and actions: 390/320, 100/150% font, light/dark, >=44px targets, no clipping, active/disabled and primary/secondary states');
  await page.evaluate(() => {
    window.__printerStore.setState({ printers: [{ id: 'fixture', name: 'Phone fixture', host_type: 'moonraker', print_host: 'blocked.invalid', use_gateway: true }], selectedPrinterId: 'fixture' });
    window.__printerStore.getState().openSendDialog();
  });
  await page.waitForSelector('#send-printer');
  await settleSheet(page, '#send-to-printer-dialog .ds-dialog');
  assert.equal(await page.locator('#send-filename').evaluate(node => node === document.activeElement), false, 'mobile filename does not summon keyboard');
  await page.fill('#send-filename', 'draft.gcode');
  await page.click('#send-printer'); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#send-to-printer-dialog').count(), 1);
  assert.equal(await page.locator('#send-filename').inputValue(), 'draft.gcode');
  await page.screenshot({ path: path.join(screenshots, 'send-320-150-dark.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__printerStore.getState().openDialog(null));
  await page.waitForSelector('#pc-name');
  await settleSheet(page, '#printer-connection-dialog .ds-dialog');
  await page.waitForFunction(() => document.querySelector('#pc-brand')?.dataset.value === window.__appStore.getState().selectedVendor);
  await page.fill('#pc-name', 'Unsaved phone connection');
  for (const id of ['#pc-brand', '#pc-preset', '#pc-host-type']) {
    const before = await controlValue(page.locator(id));
    await page.locator(id).click(); await page.keyboard.press('Escape');
    assert.equal(await controlValue(page.locator(id)), before);
    assert.equal(await page.locator('#printer-connection-dialog').count(), 1);
    assert.equal(await page.getByTestId('confirm-dialog').count(), 0);
  }
  await page.screenshot({ path: path.join(screenshots, 'connection-320-150-dark.png') });
  await page.click('#pc-cancel');
  // Migration review: retain the focused behavior checks above and capture the
  // newly tokenized sheets and Spanish flow at the design's review sizes.
  for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.setProperty('--ui-font-scale', '1');
      window.__prefsStore.getState().setGeneralPref('language', 'es');
      window.__printerStore.getState().openSendDialog();
    }, theme);
    await page.waitForSelector('#send-filename');
    await settleSheet(page, '#send-to-printer-dialog .ds-dialog');
    await buttonGeometry(page, '#send-to-printer-dialog .ds-btn');
    await page.screenshot({ path: path.join(screenshots, `send-390-es-${theme}.png`) });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__printerStore.getState().openDialog(null));
    await page.waitForSelector('#pc-name');
    await settleSheet(page, '#printer-connection-dialog .ds-dialog');
    await page.locator('#printer-connection-dialog .ds-dialog__body').evaluate(node => node.scrollTop = 0);
    await page.screenshot({ path: path.join(screenshots, `connection-390-es-${theme}.png`) });
    await page.click('#pc-cancel');
    await page.getByRole('button', { name: 'Preparar', exact: true }).click();
    await page.click('#mobile-choose-settings');
    await page.click('#mobile-next');
    await page.click('#mobile-preset-mode');
    assert.equal(await page.locator('#mobile-preset-mode').evaluate(node => getComputedStyle(node).color), 'rgb(255, 255, 255)', 'selected mode keeps readable text while hovered');
    await buttonGeometry(page, '.mobile-flow > footer > .ds-btn, .mobile-mode > .ds-btn');
    await page.screenshot({ path: path.join(screenshots, `flow-390-es-${theme}.png`) });
    await page.locator('.mobile-flow header button').click();
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', '1.5'));
    await buttonGeometry(page, '.mobile-view-tabs > button, .mobile-import-bar > .ds-btn');
    await page.screenshot({ path: path.join(screenshots, `prepare-320-150-es-${theme}.png`) });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-font-scale', '1'));
    await page.screenshot({ path: path.join(screenshots, `prepare-1280-es-${theme}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'en'));
  await page.getByRole('button', { name: 'Prepare', exact: true }).click();
  await page.click('#mobile-choose-settings');
  // The placeholder is unavailable and cannot be selected.
  await page.evaluate(() => window.__appStore.setState({ selectedPrinter: '' }));
  await page.click('#mobile-printer-select');
  assert.equal(await page.locator('.mobile-selector [role=option][data-value=""]').isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS mobile full-screen selectors, search/groups/disabled/current, exact native writes/reset, focus/cancel, wizard Escape at 390x844 and 320x568, 100/150 font, light/dark');
} finally { await browser?.close(); await stopServer(port); }
