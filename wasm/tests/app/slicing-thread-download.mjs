#!/usr/bin/env node
/** One frozen-artifact large UI download diagnosis; uses the maintained app harness. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { chromium } from '../node_modules/playwright/index.mjs';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5318);
const url = process.env.APP_TEST_BASE_URL || `http://127.0.0.1:${port}`;
const output = process.env.APP_TEST_OUTPUT;
const downloadSelector = '.slice-stats-panel #download-link';
assert.ok(output && process.env.APP_TEST_PRIVATE_PROJECT);
assert.equal(process.env.APP_TEST_FROZEN_DIST, '1');
const evidence = { checks: [], stages: [], console: [], network: [], errors: [], blocked: [] };
const save = () => fs.writeFileSync(`${output}/results.json`, JSON.stringify(evidence, null, 2));
const record = entry => { evidence.stages.push(entry); console.log('STAGE', JSON.stringify(entry)); save(); };
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const pass = name => { evidence.checks.push(name); console.log('PASS', name); save(); };
const browser = await chromium.launch({ args: ['--enable-features=SharedArrayBuffer', '--enable-unsafe-swiftshader'] });
let page;
async function snapshot(name) {
  const state = await page.evaluate(downloadSelector => {
    const describe = e => {
      if (!e) return null;
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { tag: e.tagName, id: e.id, class: e.className, rect: r.toJSON(), display: s.display,
        visibility: s.visibility, pointerEvents: s.pointerEvents, overflow: s.overflow, overflowY: s.overflowY,
        minHeight: s.minHeight, flex: s.flex, scrollTop: e.scrollTop, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight };
    };
    const anchor = document.querySelector(downloadSelector), parents = [];
    for (let e = anchor; e; e = e.parentElement) parents.push(describe(e));
    const r = anchor?.getBoundingClientRect();
    const a = window.__appStore.getState(), p = window.__platesStore.getState();
    return { parents, hit: r && describe(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      overlays: [...document.querySelectorAll('[role="dialog"], [id*="overlay"], .modal-overlay')].map(describe),
      exportState: { hasUrl: !!a.gcodeUrl, bytes: a.sliceResult?.gcode?.length, plateIndex: a.sliceResult?.plateIndex,
        activePlate: p.activePlateIndex, isSlicing: a.isSlicing, plateLoading: p.isLoading, plateError: p.error,
        thumbnails: a.currentConfig.thumbnails, thumbnailsFormat: a.currentConfig.thumbnails_format },
      anchors: [...document.querySelectorAll('[id="download-link"]')].map(describe),
      panel: document.querySelector('.slice-stats-panel')?.outerHTML };
  }, downloadSelector);
  fs.writeFileSync(`${output}/${name}.json`, JSON.stringify(state, null, 2));
  await page.screenshot({ path: `${output}/${name}.png` });
}
try {
  if (!process.env.APP_TEST_BASE_URL) await startServer(port, 'thread-download');
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const target = new URL(route.request().url());
    if (!['blob:', 'data:'].includes(target.protocol) && (target.origin !== url || /^\/(?:_printer|_cloud|api|orca-cloud)\//.test(target.pathname))) {
      evidence.blocked.push(route.request().url()); save(); await route.abort();
    } else await route.continue();
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 32 });
    localStorage.setItem('orca.wizard', JSON.stringify({ printers: ['Voron 2.4 300 0.4 nozzle'], filaments: [], completedAt: '2026-10-13' }));
    localStorage.setItem('orcaslicer_preferences_v1', JSON.stringify({ general: { slicingThreads: 16, language: 'en' } }));
    const log = (stage, details = {}) => console.log('[download-test] ' + JSON.stringify({ stage, time: performance.now(), ...details }));
    window.__downloadTrace = log;
    const Worker = window.Worker;
    window.Worker = new Proxy(Worker, { construct(target, args) {
      const worker = Reflect.construct(target, args), original = worker.postMessage, calls = new Map();
      worker.postMessage = function (...parameters) {
        const m = parameters[0];
        if (m?.method) { calls.set(m.id, m.method); log('worker-request', { method: m.method, threads: m.args?.threads, id: m.id }); }
        return original.apply(this, parameters);
      };
      worker.addEventListener('message', event => {
        const m = event.data;
        if (m?.progress === undefined && calls.has(m?.id)) { log('worker-response', { method: calls.get(m.id), id: m.id, error: m.error }); calls.delete(m.id); }
      });
      return worker;
    } });
    addEventListener('unhandledrejection', event => log('unhandled-rejection', { error: String(event.reason), stack: event.reason?.stack }));
  });
  page = await context.newPage();
  page.on('console', message => {
    if (message.text().startsWith('[download-test] ')) record(JSON.parse(message.text().slice(16)));
    else { evidence.console.push({ type: message.type(), text: message.text() }); save(); }
  });
  page.on('pageerror', error => { evidence.errors.push(error.stack || error.message); save(); });
  page.on('requestfailed', r => { evidence.network.push({ url: r.url(), failure: r.failure() }); save(); });
  page.on('response', r => { if (r.status() >= 400) { evidence.errors.push(`HTTP ${r.status()} ${r.url()}`); save(); } });
  await page.goto(url);
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady || window.__appStore?.getState().engineError, null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { window.__prefsStore.getState().setGeneralPref('autosave', false); await window.__appStore.getState().chooseVendor('BBL'); });
  await page.setInputFiles('#project-file-input', process.env.APP_TEST_PRIVATE_PROJECT);
  await page.waitForFunction(() => window.__appStore.getState().engineError || (!window.__appStore.getState().isModelLoading && window.__appStore.getState().modelObjects?.length), null, { timeout: 180000 });
  assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
  await page.waitForFunction(() => window.__historyStore.getState().currentSnapshot?.modelFileName === window.__appStore.getState().modelFile.name, null, { timeout: 180000 });
  await page.click('#slice-btn');
  await page.waitForFunction(() => !window.__appStore.getState().isSlicing && (window.__appStore.getState().sliceResult || window.__appStore.getState().engineError), null, { timeout: 240000 });
  assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
  evidence.slice = await page.evaluate(async () => {
    const a = window.__appStore.getState(), engine = window.__orcaEngine;
    const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    const config = await engine.getConfig();
    const engineHash = await digest(await engine.readFile(a.sliceResult.gcodePath));
    const urlHash = await digest(await (await fetch(a.gcodeUrl)).arrayBuffer());
    return { config, engineHash, urlHash, stats: { ...a.sliceResult, gcode: undefined } };
  });
  evidence.slice.configHash = hash(JSON.stringify(evidence.slice.config));
  assert.equal(evidence.slice.configHash, 'bc7eed7e1e5b4bebc802184fe6a935d5ccb990e7d59e1ee7772d23005764ced9');
  assert.deepEqual(evidence.slice.urlHash, evidence.slice.engineHash);
  const old = JSON.parse(fs.readFileSync('docs/superpowers/performance-20261013/resumed-sol/slicing-thread-browser/results-4.json'));
  for (const field of ['filamentG', 'filamentMm', 'layers', 'printTimeS', 'warnings']) assert.deepEqual(evidence.slice.stats[field], old.privateProject.stats[field]);
  assert.equal(evidence.stages.filter(s => s.stage === 'worker-request' && s.method === 'slice').at(-1).threads, 16);
  pass('exact config, semantic stats, slice16 and engine file/UI URL readback');
  await page.waitForFunction(() => document.querySelector('#preview-error-overlay') || (window.__previewStore?.getState().layersCount > 0 && document.querySelector('#canvas')?.dataset.previewReady === 'true'), null, { timeout: 180000 });
  assert.equal(await page.locator('#preview-error-overlay').count(), 0);
  evidence.preview = await page.evaluate(() => ({ layers: window.__previewStore.getState().layersCount, before: window.__previewStore.getState().maxLayer }));
  await page.locator('#layer-slider-max').fill('1', { force: true });
  await page.locator('#layer-slider-max').dispatchEvent('input');
  assert.equal(await page.evaluate(() => window.__previewStore.getState().maxLayer), 1);
  pass('preview ready and layer slider responds');
  await page.evaluate(() => {
    const log = window.__downloadTrace;
    for (const [target, method, label] of [[window.__platesStore.getState(), 'fetchPlates', 'fetch-plates'], [window.__plateScene, 'renderThumbnail', 'thumbnail']]) {
      if (!target?.[method]) { log('missing-stage-hook', { label }); continue; }
      const original = target[method];
      target[method] = function (...args) {
        log(label + '-start', { args });
        try {
          const result = original.apply(this, args);
          const done = value => { log(label + '-end', { length: value?.length }); return value; };
          if (result?.then) return result.then(done, error => { log(label + '-error', { error: String(error) }); throw error; });
          return done(result);
        } catch (error) { log(label + '-error', { error: String(error) }); throw error; }
      };
    }
    document.addEventListener('click', event => {
      if (event.target.closest?.('#download-link')) log('ui-click-arrived', { trusted: event.isTrusted, x: event.clientX, y: event.clientY });
    }, true);
    const create = URL.createObjectURL;
    URL.createObjectURL = function (blob) { const result = create.call(this, blob); log('blob-url-created', { bytes: blob.size, type: blob.type }); return result; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (...args) { log('anchor-native-click', { download: this.download, blob: this.href.startsWith('blob:') }); return click.apply(this, args); };
  });
  await snapshot('before-click');
  record({ stage: 'click-and-listener-start', time: Date.now() });
  // Retain both errors and wait for actionability to finish even if the listener expires first.
  assert.equal(await page.locator(downloadSelector).count(), 1);
  const outcomes = await Promise.allSettled([
    page.waitForEvent('download', { timeout: 30000 }),
    page.locator(downloadSelector).click({ timeout: 30000 }).then(() => record({ stage: 'click-resolved', time: Date.now() }))
  ]);
  evidence.clickOutcomes = outcomes.map(result => ({ status: result.status, error: result.status === 'rejected' ? result.reason.stack : undefined }));
  save();
  await snapshot('after-click');
  assert.equal(outcomes[1].status, 'fulfilled', evidence.clickOutcomes[1].error);
  assert.equal(outcomes[0].status, 'fulfilled', evidence.clickOutcomes[0].error);
  const download = outcomes[0].value;
  await download.saveAs(`${output}/ui-export.gcode`);
  evidence.download = { bytes: fs.statSync(`${output}/ui-export.gcode`).size, suggestedFilename: download.suggestedFilename(), failure: await download.failure() };
  const commands = crypto.createHash('sha256'), normalized = crypto.createHash('sha256'), full = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(`${output}/ui-export.gcode`)) full.update(chunk);
  // Compare commands without retaining another 129 MB copy while the browser is alive.
  let firstCommand = true, thumbnail = null;
  const thumbnails = [];
  for await (const line of readline.createInterface({ input: fs.createReadStream(`${output}/ui-export.gcode`), crlfDelay: Infinity })) {
    if (line.trim() && !line.trimStart().startsWith(';')) { if (!firstCommand) commands.update('\n'); commands.update(line); firstCommand = false; }
    const begin = line.match(/^; (thumbnail\S*) begin (\d+)x(\d+) (\d+)/);
    if (begin) thumbnail = { format: begin[1], width: +begin[2], height: +begin[3], expected: +begin[4], base64: '' };
    else if (thumbnail && /^; thumbnail\S* end/.test(line)) {
      const bytes = Buffer.from(thumbnail.base64, 'base64');
      assert.equal(thumbnail.base64.length, thumbnail.expected);
      assert.ok(bytes.length > 0);
      if (thumbnail.format === 'thumbnail') {
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(bytes.readUInt32BE(16), thumbnail.width);
        assert.equal(bytes.readUInt32BE(20), thumbnail.height);
      }
      thumbnails.push({ ...thumbnail, base64: undefined, bytes: bytes.length, sha256: hash(bytes) }); thumbnail = null;
    } else if (thumbnail) thumbnail.base64 += line.replace(/^; ?/, '');
    // Export thumbnails are additional comments; command comparison remains exact.
  }
  evidence.download.sha256 = full.digest('hex');
  evidence.download.canonicalHash = commands.digest('hex');
  evidence.download.thumbnails = thumbnails;
  assert.equal(thumbnail, null);
  assert.equal(evidence.download.canonicalHash, '8eb4e6d6c2d1022bb81168b4d073ea3215b3bf7c2490b34e969137ffa627958c');
  // Complete narrow full-output parity separately from the thumbnail-enriched download.
  const raw = await page.evaluate(async () => (await fetch(window.__appStore.getState().gcodeUrl)).text());
  normalized.update(raw.replace(/^; generated by .*$/m, '').replace(/^(; (?:stop )?printing object .* id:)\d+(?= copy \d+$)/gm, '$1<ID>'));
  evidence.slice.normalizedHash = normalized.digest('hex');
  assert.equal(evidence.slice.normalizedHash, '1b1751ff43fe7cded5d8716e42dfbd5f47ce37bafdd8d35586763bba6f067376');
  pass('actual UI download saved/read back, canonical commands and narrow raw output match, produced thumbnails valid');
  await page.keyboard.press('Control+p');
  await page.waitForSelector('#pref-slicing-threads');
  assert.equal(await page.locator('#pref-slicing-threads').inputValue(), '16');
  await page.click('#pref-close-btn');
  await page.waitForSelector('#pref-slicing-threads', { state: 'hidden' });
  await page.screenshot({ path: `${output}/completed-ui.png` });
  pass('Preferences opens, retains16 and closes after download');
  assert.deepEqual(evidence.errors, []);
  assert.deepEqual(evidence.blocked, []);
} catch (error) {
  evidence.failure = error.stack; save(); console.error(error); process.exitCode = 1;
  if (page && !page.isClosed()) await snapshot('failure').catch(error => { evidence.captureError = String(error); });
} finally {
  await browser.close();
  if (!process.env.APP_TEST_BASE_URL) await stopServer(port);
  save();
}
