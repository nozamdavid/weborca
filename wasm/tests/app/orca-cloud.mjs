#!/usr/bin/env node
/** Actual gateway protocol mocks and native configuration preservation; no upstream/printer requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = 5174;
const origin = `http://127.0.0.1:${port}`;
const screenshots = path.resolve('wasm/build/tests-app/orca-cloud');
fs.mkdirSync(screenshots, { recursive: true });
await startServer(port, 'orca-cloud', { frozenDist: true });
const browserType = process.env.APP_TEST_BROWSER === 'firefox' ? firefox : chromium;
const browser = await browserType.launch({
  headless: process.env.APP_TEST_HEADED !== '1',
  // Keep intercepted OAuth popups within the QA cgroup's 256-task limit.
  ...(browserType === firefox ? { firefoxUserPrefs: {
    'dom.ipc.processCount': 1,
    'dom.ipc.processCount.webIsolated': 1,
    'dom.ipc.processPrelaunch.enabled': false,
    'dom.maxHardwareConcurrency': 2,
    'fission.autostart': false,
  } } : {}),
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const existingSession = 'ab'.repeat(32);
await context.addInitScript(({ origin, existingSession }) => {
  localStorage.setItem('orca-cloud-gateway', 'https://stale-gateway.invalid');
  localStorage.setItem(`orca-cloud-session:${origin}`, existingSession);
}, { origin, existingSession });
let accountId = null, pending = false, outcome = null, writes = false, setup = 'callback-required', offline = false;
let callbackBase = 'http://localhost:41172/callback';
let cursor = 1, conflictPush = true, pulls = 0, pushes = 0, completes = 0;
const requests = [];
const profiles = ['printer', 'filament', 'print'].map((type, i) => ({
  id: `remote-${type}`, name: `Cloud ${type}`, updated_time: 10 + i,
  content: { type, name: `Cloud ${type}`, inherits: type === 'printer' ? 'Voron 2.4 300 0.4 nozzle' : '',
    ...(type === 'printer' ? { printable_area: '0x0,300x0,300x300,0x300', printable_height: '300', nozzle_diameter: ['0.4'], print_host: 'http://192.168.1.100', print_host_webui: 'http://192.168.1.100/ui', host_type: 'flashforge' } : type === 'print' ? { layer_height: '0.2' } : { filament_type: ['PLA'] }) }
}));
const status = () => ({ accountId, pending, outcome, callback: setup === 'callback-required' ? null : callbackBase, callbackConfirmed: setup === 'configured', setup, presetWrites: writes });
await context.route('https://auth.orcaslicer.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Mock official provider navigation</p>' }));
await context.route('**/_orca-cloud/**', async route => {
  const req = route.request();
  assert.equal(new URL(req.url()).origin, origin, 'legacy gateway address cannot redirect account requests');
  assert.equal(req.headers()['x-orca-cloud'], '1');
  assert.equal(req.headers()['x-orca-cloud-session'], existingSession, 'existing same-origin browser identity is retained');
  if (offline) return route.abort('failed');
  const action = new URL(req.url()).pathname.split('/').at(-1);
  const body = req.postDataJSON();
  requests.push({ action, body });
  let data = status(), code = 200;
  if (action === 'begin') {
    if (setup === 'callback-required') code = 409;
    else {
      assert.ok(['google', 'apple', 'github'].includes(body.provider));
      pending = true; outcome = null;
      const url = new URL('https://auth.orcaslicer.com/auth/v1/authorize');
      url.search = new URLSearchParams({ provider: body.provider, code_challenge: 'mock-S256-challenge', code_challenge_method: 'S256', redirect_to: `${callbackBase}?orca_state=mock-state` }).toString();
      data = { url: url.href, expiresAt: Date.now() + 300000, callbackConfirmed: setup === 'configured' };
    }
  } else if (action === 'complete') {
    completes++;
    const callback = new URL(body.callbackUrl);
    if (!pending || `${callback.origin}${callback.pathname}` !== callbackBase || callback.searchParams.get('code') !== 'mock-code' || callback.searchParams.get('orca_state') !== 'mock-state') { code = 409; data = { error: 'mock-code must never be displayed' }; }
    else { accountId = 'alice'; pending = false; outcome = 'complete'; data = status(); }
  } else if (action === 'logout') { accountId = null; pending = false; outcome = null; data = status(); }
  else if (action === 'api') {
    assert.equal(body.accountId, accountId, 'requests use current account only');
    if (body.method === 'GET') { pulls++; data = { status: 200, data: { next_cursor: cursor++, upserts: profiles, deletes: [] } }; }
    else if (body.method === 'POST') {
      pushes++;
      if (!writes) data = { status: 403, data: null };
      else if (conflictPush && body.path.endsWith('/push') && body.body.name.startsWith('Local ')) data = { status: 409, data: { server_profile: { ...body.body, updated_time: 42, content: { ...body.body.content, layer_height: '0.3' } } } };
      else data = { status: 200, data: { updated_time: 43 } };
    } else data = { status: 204, data: null };
  }
  await route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(data) });
});
const page = await context.newPage();
const ready = () => page.waitForFunction(() => window.__appStore?.getState().isEngineReady && !window.__appStore.getState().isSelectingPreset, null, { timeout: 120000 });
const idle = () => page.waitForFunction(() => !document.querySelector('.cloud-session-check') && !document.querySelector('#cloud-message')?.textContent.includes('Working'), null, { timeout: 30000 });
const open = async () => {
  if (!await page.locator('#wizard-dialog').isVisible()) await page.selectOption('#printer-select', '__add_printer__');
  assert.equal(await page.locator('#wizard-step-1 > :first-child').getAttribute('id'), 'wizard-orca-cloud');
  await page.click('#wizard-orca-cloud'); await idle();
};
const confirm = async () => { await page.getByTestId('confirm-ok').click(); await idle(); };
const fingerprint = () => page.evaluate(async () => {
  const s = window.__appStore.getState();
  return { config: s.currentConfig, native: await window.__orcaEngine.getConfig(), printer: s.selectedPrinter, process: s.selectedProcess, filaments: s.selectedFilaments, active: s.activeUserPreset,
    overrides: { printer: s.printerOverrides, process: s.processOverrides, filament: s.filamentOverrides } };
});
const journal = () => page.evaluate(() => JSON.parse(localStorage.getItem('orca_user_presets')));
try {
  console.log('Automatic same-origin account connection ignores legacy gateway configuration');
  await page.goto(origin); await ready();
  await page.evaluate(async () => {
    window.__prefsStore.getState().setGeneralPref('autosave', false);
    window.__prefsStore.getState().setGeneralPref('autoSliceAfterChange', false);
    const app = window.__appStore.getState();
    await app.chooseVendor('Voron'); await app.choosePrinter('Voron 2.4 300 0.4 nozzle');
    for (const kind of ['printer', 'filament', 'process']) await window.__appStore.getState().saveCurrentUserPreset(kind, `Local ${kind}`);
  });
  await open();
  assert.equal(await page.locator('#cloud-gateway, #cloud-connect').count(), 0);
  assert.equal(await page.locator('#cloud-manual-url').count(), 0, 'manual field appears only for a pending sign-in');
  assert.ok(requests.some(r => r.action === 'status'), 'status is requested without manual connection');
  assert.equal(await page.locator('#cloud-login-google').isDisabled(), true);
  setup = 'callback-allowlist-unverified';
  await page.click('#cloud-close'); await open();
  assert.equal(await page.locator('#cloud-login-google').isEnabled(), true, 'operator confirmation is not required for native localhost completion');
  assert.doesNotMatch(await page.locator('#orca-cloud-dialog').textContent(), /gateway|allowlist|ORCA_CLOUD_/i);
  console.log('Official provider PKCE URL, manual callback, sanitized failure and status');
  const popupPromise = page.waitForEvent('popup');
  await page.click('#cloud-login-google');
  const popup = await popupPromise;
  await popup.waitForURL('https://auth.orcaslicer.com/**');
  const auth = new URL(popup.url());
  assert.equal(auth.searchParams.get('provider'), 'google');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(new URL(auth.searchParams.get('redirect_to')).origin, 'http://localhost:41172');
  assert.equal(new URL(auth.searchParams.get('redirect_to')).searchParams.get('orca_state'), 'mock-state');
  await popup.close(); await idle();
  assert.equal(await page.locator('#cloud-manual-url').isVisible(), true);
  assert.match(await page.locator('#orca-cloud-dialog').textContent(), /COMPLETE URL/);
  assert.match(await page.locator('#orca-cloud-dialog').textContent(), /localhost page may fail to load/);
  const beforeFailedLogin = await journal();
  const beforeFailedConfig = await fingerprint();
  await page.fill('#cloud-manual-url', `${callbackBase}?code=bad-secret&orca_state=wrong-state`);
  await page.click('#cloud-complete'); await idle();
  assert.equal(await page.inputValue('#cloud-manual-url'), '');
  assert.ok(!(await page.locator('#orca-cloud-dialog').textContent()).includes('bad-secret'));
  assert.ok(!(await page.locator('#orca-cloud-dialog').textContent()).includes('mock-code'));
  assert.equal(page.url(), `${origin}/`, 'pasted callback never enters app navigation history');
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('bad-secret')), false, 'callback code is not persisted');
  const afterFailedLogin = await journal();
  assert.deepEqual(afterFailedLogin.presets, beforeFailedLogin.presets, 'failed completion preserves local presets');
  assert.deepEqual(afterFailedLogin.cloud, beforeFailedLogin.cloud, 'failed completion preserves account journals');
  assert.deepEqual(await fingerprint(), beforeFailedConfig, 'failed completion preserves the open project');
  await page.fill('#cloud-manual-url', `${callbackBase}?code=mock-code&orca_state=mock-state`);
  const completesBeforeSuccess = completes;
  await page.click('#cloud-complete'); await idle();
  assert.equal(completes, completesBeforeSuccess + 1, 'manual callback is submitted once');
  assert.match(await page.locator('#cloud-account-status').textContent(), /Signed in/);
  assert.equal(await page.locator('#cloud-manual-url').count(), 0, 'completion field is removed after successful sign-in');
  assert.equal(await page.evaluate(() => localStorage.getItem('orca-cloud-gateway')), 'https://stale-gateway.invalid', 'legacy setting is ignored without deleting stored data');
  assert.equal(await page.locator('#cloud-push').isDisabled(), true);
  await page.click('#cloud-close');
  await page.evaluate(async () => {
    await window.__appStore.getState().applyOptionChange('sparse_infill_density', '23%', 'print');
  });
  const before = await fingerprint();
  await open(); await page.click('#cloud-pull'); await idle();
  assert.deepEqual(await fingerprint(), before, 'pull preserves native config, selected presets and unsaved project overrides');
  const saved = await page.evaluate(() => window.__appStore.getState().userPresets);
  for (const kind of ['printer', 'filament', 'process']) assert.ok(saved.some(p => p.kind === kind && p.name.startsWith('Cloud ')));
  const savedPrinter = saved.find(p => p.kind === 'printer' && p.name === 'Cloud printer');
  for (const key of ['print_host', 'print_host_webui', 'host_type']) assert.equal(savedPrinter.values[key], profiles[0].content[key], `native ${key} survives Sync/Pull`);
  assert.equal(await page.locator('#cloud-message').textContent(), 'Operation completed. Review pending changes and conflicts below.', 'Sync/Pull completes');
  assert.ok(await page.locator('#cloud-printer-select option[value="user:Cloud printer"]').count(), 'imported printer is a normal saved choice');
  await page.locator('summary').filter({ hasText: 'Offline profile' }).click();
  await page.setInputFiles('#cloud-import', { name: 'profiles.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profiles)) });
  await idle();
  assert.deepEqual(await fingerprint(), before, 'offline import also preserves the selected native project');
  console.log('Write policy, backup consent and all explicit conflict choices');
  writes = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await idle();
  assert.equal(await page.locator('#cloud-backup').isDisabled(), true);
  await page.check('#cloud-backup-consent'); await page.click('#cloud-backup'); await idle();
  await page.click('#cloud-push'); await confirm();
  const conflicts = page.locator('#cloud-records li').filter({ hasText: 'Conflict:' });
  assert.equal(await conflicts.count(), 3);
  const printerRecord = page.locator('#cloud-records li').filter({ hasText: 'Local printer' });
  await printerRecord.getByRole('button', { name: 'Use cloud', exact: true }).click(); await confirm();
  const filamentRecord = page.locator('#cloud-records li').filter({ hasText: 'Local filament' });
  await filamentRecord.getByRole('button', { name: 'Use local', exact: true }).click(); await confirm();
  const processRecord = page.locator('#cloud-records li').filter({ hasText: 'Local process' });
  await processRecord.locator('input').fill('Local process copy');
  await processRecord.getByRole('button', { name: 'Keep local copy and use cloud' }).click(); await confirm();
  conflictPush = false;
  await page.click('#cloud-push'); await confirm();
  assert.ok(requests.some(r => r.body?.path === '/api/v1/sync/force-push'), 'force is only after explicit use-local');
  console.log('Opt-in background sync survives modal close; focus sync edits and logout stops it');
  await page.click('#cloud-auto-sync'); await confirm();
  assert.equal(await page.locator('#cloud-auto-sync').isChecked(), true);
  assert.equal(await page.evaluate(origin => localStorage.getItem(`orca-cloud-auto:${origin}:alice`), origin), '60', 'automatic sync retains its same-origin opt-in key');
  await page.click('#cloud-close');
  await page.reload(); await ready(); await open();
  assert.equal(await page.locator('#cloud-auto-sync').isChecked(), true, 'automatic opt-in persists across reload');
  await page.click('#cloud-close');
  await page.evaluate(async () => {
    await window.__appStore.getState().selectUserPreset('process', 'Local process copy');
    await window.__appStore.getState().applyOptionChange('layer_height', '0.24', 'print');
    await window.__appStore.getState().saveCurrentUserPreset('process', 'Local process copy');
  });
  assert.ok(Object.values((await journal()).cloud.accounts.alice.records).some(r => r.preset.name === 'Local process copy' && r.dirty), 'enrolled edit is dirty before automatic sync');
  const autoBefore = await fingerprint();
  const pushCount = pushes;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('orca_user_presets')).cloud.accounts.alice.records).some(r => r.preset.name === 'Local process copy' && !r.dirty), null, { timeout: 30000 });
  assert.ok(pushes > pushCount);
  assert.deepEqual(await fingerprint(), autoBefore, 'background pull preserves open native project');
  await open();
  console.log('Dialog reachability at 320/390/1280 and 100/150% text');
  for (const width of [320, 390, 1280]) for (const scale of [100, 150]) {
    const height = width === 320 ? 568 : width === 1280 ? 900 : 844;
    await page.setViewportSize({ width, height });
    await page.evaluate(scale => window.__prefsStore.getState().setDisplayPref('fontScale', scale), scale);
    for (const id of ['cloud-pull', 'cloud-logout', 'cloud-backup', 'cloud-push', 'cloud-auto-sync']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const action = await page.locator(`#${id}`).boundingBox();
      assert.ok(action && action.x >= 0 && action.x + action.width <= width + 1 && action.y >= 0 && action.y + action.height <= height + 1, `${id} reachable at ${width}/${scale}`);
    }
    await page.locator('#cloud-close').scrollIntoViewIfNeeded();
    const box = await page.locator('.cloud-dialog').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    assert.ok(await page.locator('#cloud-close').isVisible());
    assert.ok(await page.locator('.cloud-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no horizontal dialog overflow');
    await page.screenshot({ path: path.join(screenshots, `dialog-${width}-${scale}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('#cloud-logout'); await idle();
  const stoppedPushes = pushes, stoppedPulls = pulls;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await idle();
  assert.equal(pushes, stoppedPushes); assert.equal(pulls, stoppedPulls);
  assert.ok((await journal()).presets.length, 'logout retains presets');
  assert.equal((await journal()).cloud.activeAccount, undefined);
  console.log('Apple polling and account switch journals stay isolated');
  const applePopup = page.waitForEvent('popup'); await page.click('#cloud-login-apple'); const apple = await applePopup;
  await apple.waitForURL('https://auth.orcaslicer.com/**'); assert.equal(new URL(apple.url()).searchParams.get('provider'), 'apple'); await apple.close();
  accountId = 'bob'; pending = false; outcome = 'complete';
  await page.waitForFunction(() => document.querySelector('#cloud-account-status')?.textContent.includes('Signed in'), null, { timeout: 15000 });
  await idle();
  await page.check('#cloud-backup-consent'); await page.click('#cloud-backup'); await idle();
  const state = await journal();
  assert.ok(state.cloud.accounts.alice.records);
  assert.equal(Object.keys(state.cloud.accounts.bob.records).length, 0, 'other account profiles are not enrolled');
  await page.click('#cloud-logout'); await idle();
  console.log('GitHub HTTPS callback clears URL before assets and never initializes engine');
  callbackBase = `${origin}/orca-cloud/callback`; setup = 'configured';
  const githubPopup = page.waitForEvent('popup'); await page.click('#cloud-login-github'); const github = await githubPopup;
  await github.waitForURL('https://auth.orcaslicer.com/**'); assert.equal(new URL(github.url()).searchParams.get('provider'), 'github'); await github.close();
  const callbackPage = await context.newPage();
  let engineLoads = 0;
  callbackPage.on('request', req => { if (/engine-worker|orca_engine/.test(req.url())) engineLoads++; });
  const response = await callbackPage.goto(`${origin}/orca-cloud/callback?code=mock-code&orca_state=mock-state#private`);
  assert.equal(response.headers()['referrer-policy'], 'no-referrer');
  assert.equal(response.headers()['cache-control'], 'no-store');
  await callbackPage.getByText('Sign-in complete.', { exact: false }).waitFor();
  assert.equal(callbackPage.url(), `${origin}/orca-cloud/callback`);
  assert.equal(engineLoads, 0);
  assert.equal(await callbackPage.evaluate(() => typeof window.__appStore), 'undefined');
  assert.ok(completes >= 3); await callbackPage.close();
  console.log('Startup/focus gateway reset deactivates stale account; offline preserves edits');
  await page.click('#cloud-close');
  await page.reload(); await ready();
  assert.equal((await journal()).cloud.activeAccount, 'alice');
  offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await idle();
  assert.equal((await journal()).cloud.activeAccount, 'alice');
  await page.evaluate(async () => { await window.__appStore.getState().saveCurrentUserPreset('process', 'Offline process'); });
  assert.ok(Object.values((await journal()).cloud.accounts.alice.records).some(r => r.preset.name === 'Offline process' && r.dirty));
  offline = false; accountId = null;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await idle();
  assert.equal((await journal()).cloud.activeAccount, undefined, 'focus detects gateway logout before further edits');
  await page.evaluate(async () => { await window.__appStore.getState().saveCurrentUserPreset('process', 'Unlinked after focus'); });
  assert.ok(!(await journal()).presets.find(p => p.name === 'Unlinked after focus').cloudRef);
  accountId = 'alice';
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await idle();
  assert.equal((await journal()).cloud.activeAccount, 'alice');
  accountId = null;
  await page.reload(); await ready();
  assert.equal((await journal()).cloud.activeAccount, undefined);
  await page.evaluate(async () => { await window.__appStore.getState().saveCurrentUserPreset('process', 'Unlinked after reset'); });
  assert.ok(!(await journal()).presets.find(p => p.name === 'Unlinked after reset').cloudRef);
  await open();
  await page.selectOption('#cloud-printer-select', 'user:Cloud printer');
  await page.waitForFunction(() => window.__appStore.getState().selectedPrinter === 'Cloud printer' && !window.__appStore.getState().isSelectingPreset, null, { timeout: 60000 });
  assert.equal(await page.locator('#wizard-dialog').count(), 0, 'cloud setup leads to a usable saved printer choice');
  assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
  console.log('Cloud parent/child selection uses its account parent through a local name collision');
  await page.evaluate(async () => {
    await window.__appStore.getState().chooseProcess('0.20mm Standard @Voron');
    await window.__appStore.getState().applyOptionChange('layer_height', '0.8', 'print');
    await window.__appStore.getState().saveCurrentUserPreset('process', 'Cloud inherited parent');
  });
  const cloudParent = { id: 'inherit-parent', name: 'Cloud inherited parent', updated_time: 80,
    content: { type: 'print', name: 'Cloud inherited parent', inherits: '0.20mm Standard @Voron', layer_height: '0.12', wall_loops: '2' } };
  profiles.push(cloudParent, { id: 'inherit-child', name: 'Cloud inherited child', updated_time: 81,
    content: { type: 'print', name: 'Cloud inherited child', inherits: 'Cloud inherited parent', wall_loops: '7' } });
  accountId = 'alice';
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await idle();
  await open(); await page.click('#cloud-pull'); await idle();
  const parentChoices = await page.evaluate(() => window.__appStore.getState().userPresets);
  assert.ok(parentChoices.some(p => p.name === 'Cloud inherited parent' && !p.cloudRef && Number(p.values.layer_height) === 0.8));
  assert.ok(parentChoices.some(p => p.cloudRef?.id === 'inherit-parent' && p.name !== 'Cloud inherited parent'), 'cloud parent has a distinct local alias');
  await page.click('#cloud-close'); await page.click('#wizard-close-x');
  await page.selectOption('#process-select', 'user:Cloud inherited child');
  await page.waitForFunction(() => window.__appStore.getState().selectedProcess === 'Cloud inherited child' && !window.__appStore.getState().isSelectingPreset, null, { timeout: 60000 });
  const selectedChild = await fingerprint();
  assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
  assert.equal(Number(selectedChild.native.layer_height), 0.12, 'native config inherits cloud parent rather than colliding local 0.8');
  assert.equal(Number(selectedChild.native.wall_loops), 7, 'leaf overrides parent and native root');
  await page.evaluate(async () => { await window.__appStore.getState().applyOptionChange('sparse_infill_density', '29%', 'print'); });
  const activeChild = await fingerprint();
  cloudParent.updated_time = 99; cloudParent.content.layer_height = '0.14';
  await open(); await page.click('#cloud-pull'); await idle();
  assert.deepEqual(await fingerprint(), activeChild, 'pull of a changed cloud parent preserves selected native child and unsaved project overrides');
  console.log('Orca Cloud browser checks passed');
} finally { await browser.close(); await stopServer(port); }
