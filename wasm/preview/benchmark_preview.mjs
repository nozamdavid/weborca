// Run against a static repository server (with wasm/web-smoke/serve.json headers).
// PREVIEW_URL=http://localhost:5059/wasm/preview/demo/ node wasm/preview/benchmark_preview.mjs
// Optional PREVIEW_BASELINE_DIR compares normal-quality pixel hashes and move mapping.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '../tests/node_modules/playwright/index.mjs';
import { detailedGcode } from '../tests/lib/preview-performance-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const url = process.env.PREVIEW_URL || 'http://localhost:5059/wasm/preview/demo/';
let fixture;
if (process.env.PREVIEW_LAYERS) {
  const reference = await fs.readFile(path.join(root, 'wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode'), 'utf8');
  const config = Object.fromEntries(reference.split('; CONFIG_BLOCK_START')[1].split('; CONFIG_BLOCK_END')[0]
    .split('\n').map(line => /^; ([^=]+) = (.*)$/.exec(line)).filter(Boolean).map(([, key, value]) => [key.trim(), value]));
  fixture = detailedGcode({ layers: Number(process.env.PREVIEW_LAYERS), segments: Number(process.env.PREVIEW_SEGMENTS || 1024), config });
}
const browserType = process.env.PREVIEW_BROWSER === 'firefox' ? firefox : chromium;
const browser = await browserType.launch({ headless: true, args: browserType === chromium ? ['--enable-unsafe-swiftshader'] : [], dumpio: Boolean(process.env.PREVIEW_VERBOSE) });
async function run(baseline, regressionOnly = false) {
  const page = await browser.newPage({ viewport: { width: Number(process.env.PREVIEW_WIDTH || 1024), height: Number(process.env.PREVIEW_HEIGHT || 768) } });
  const errors = [];
  await page.addInitScript(() => {
    window.__previewWorkerCount = 0;
    window.__previewPthreadRuns = 0;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) { super(...args); ++window.__previewWorkerCount; }
      postMessage(message, ...args) {
        // The installed SDK uses numeric CMD_RUN=2; older SDKs used "run".
        if (message?.cmd === 2 || message?.cmd === 'run') ++window.__previewPthreadRuns;
        return super.postMessage(message, ...args);
      }
    };
    const original = WebAssembly.Memory.prototype.grow;
    WebAssembly.Memory.prototype.grow = function(...args) { const result = original.apply(this, args); window.__previewHeapMemory = this; window.__previewHeapPeak = Math.max(window.__previewHeapPeak || 0, this.buffer.byteLength); (window.__previewHeapGrowth ||= []).push(this.buffer.byteLength); return result; };
  });
  const textureSize = baseline ? process.env.PREVIEW_BASELINE_TEXTURE_SIZE : process.env.PREVIEW_TEXTURE_SIZE;
  if (textureSize) await page.addInitScript(size => {
    const original = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) { return parameter === this.MAX_TEXTURE_SIZE ? size : original.call(this, parameter); };
  }, Number(textureSize));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || process.env.PREVIEW_VERBOSE) console.error(message.text()); });
  page.on('crash', () => console.error('Preview renderer process crashed'));
  const moduleDir = baseline || process.env.PREVIEW_MODULE_DIR;
  if (moduleDir) {
    for (const extension of ['js', 'wasm']) await page.context().route(`**/orca_preview.${extension}*`, route => route.fulfill({
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' }, path: path.join(moduleDir, `orca_preview.${extension}`), contentType: extension === 'wasm' ? 'application/wasm' : 'text/javascript'
    }));
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.previewLoaded, null, { timeout: 120000 });
  const moduleReadyMs = await page.evaluate(() => performance.now());
  if (process.env.PREVIEW_INITIAL_LOW) await page.evaluate(() => window.preview.setLowQuality(true));
  await page.evaluate(({ layers, parseOnly, compareClipping, repeats, simpleRepeats }) => { window.__benchmarkRenderLayers = layers; window.__benchmarkParseOnly = parseOnly; window.__benchmarkCompareClipping = compareClipping; window.__benchmarkRepeats = repeats; window.__benchmarkSimpleRepeats = simpleRepeats; }, { layers: Number(process.env.PREVIEW_RENDER_LAYERS || 0), parseOnly: Boolean(process.env.PREVIEW_PARSE_ONLY), compareClipping: Boolean(process.env.PREVIEW_COMPARE_CLIPPING), repeats: Number(process.env.PREVIEW_RELOADS || 0), simpleRepeats: Boolean(process.env.PREVIEW_SIMPLE_RELOADS) });
  let loadMs = null;
  if (process.env.PREVIEW_GCODE) {
    const file = path.resolve(process.env.PREVIEW_GCODE);
    const relative = path.relative(root, file);
    let fixtureUrl = `/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
    if (relative.startsWith('..')) {
      fixtureUrl = '/benchmark-gcode';
      await page.route('**/benchmark-gcode', route => route.fulfill({ path: file, contentType: 'application/octet-stream' }));
    }
    loadMs = await page.evaluate(async fixtureUrl => {
      const response = await fetch(fixtureUrl);
      if (!response.ok) throw new Error(`Fixture HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      window.previewModule.FS.writeFile('/benchmark.gcode', bytes);
      console.log(`Preview benchmark loading ${bytes.length} bytes`);
      const start = performance.now();
      window.previewStats = JSON.parse(window.preview.loadGcode('/benchmark.gcode'));
      if (window.previewStats.error) throw new Error(window.previewStats.error);
      const elapsed = performance.now() - start;
      console.log(`Preview benchmark parsed ${window.previewStats.moves} moves in ${elapsed}ms`);
      window.__benchmarkReloads = [];
      if (window.__benchmarkRepeats) {
        const preview = window.preview;
        if (!window.__benchmarkSimpleRepeats) { preview.setLowQuality(true); preview.setViewType('Speed'); }
        if (window.__benchmarkRenderLayers) preview.setLayerRange(Math.max(0, window.previewStats.layers - window.__benchmarkRenderLayers), window.previewStats.layers - 1);
        preview.render();
        const expected = { stats: preview.getSliceStatistics(), legend: preview.getLegendData(), layers: preview.getLayersZs(), line: preview.getMoveGcodeLine(Math.floor(Number(preview.getMovesCount()) / 2)) };
        for (let i = 0; i < window.__benchmarkRepeats; ++i) {
          const start = performance.now();
          console.log(JSON.stringify({ stage: 'before-repeat-load', repeat: i, heapBytes: window.__previewHeapMemory?.buffer.byteLength }));
          let stats;
          try { stats = JSON.parse(preview.loadGcode('/benchmark.gcode')); }
          catch (error) {
            console.error(JSON.stringify({ stage: 'repeat-load', repeat: i, heapPeakBytes: window.__previewHeapPeak, heapBytes: window.__previewHeapMemory?.buffer.byteLength, heapGrowth: window.__previewHeapGrowth }));
            throw error;
          }
          const elapsed = performance.now() - start;
          if (stats.error) throw new Error(`Repeat load ${i} failed: ${stats.error}`);
          const actual = { stats: preview.getSliceStatistics(), legend: preview.getLegendData(), layers: preview.getLayersZs(), line: preview.getMoveGcodeLine(Math.floor(Number(preview.getMovesCount()) / 2)) };
          if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Repeat load changed statistics, quality/view legend, or line mapping');
          window.__benchmarkReloads.push({ loadMs: elapsed, stats, heapPeakBytes: window.__previewHeapPeak || null });
          console.log(JSON.stringify({ stage: 'after-repeat-load', repeat: i, heapBytes: window.__previewHeapMemory?.buffer.byteLength }));
        }
        const failed = JSON.parse(preview.loadGcode('/missing-preview-benchmark.gcode'));
        if (!failed.error || preview.getSliceStatistics() !== expected.stats || preview.getLegendData() !== expected.legend) throw new Error('Failed parse changed previous preview');
        if (!window.__benchmarkSimpleRepeats) { preview.setLowQuality(false); preview.setViewType('FeatureType'); }
      }
      window.previewModule.FS.unlink('/benchmark.gcode');
      if (window.__benchmarkRenderLayers) window.preview.setLayerRange(Math.max(0, window.previewStats.layers - window.__benchmarkRenderLayers), window.previewStats.layers - 1);
      if (!window.__benchmarkParseOnly) window.preview.render();
      window.__benchmarkInitialGlError = document.querySelector('#canvas').getContext('webgl2').getError();
      return elapsed;
    }, fixtureUrl);
  }
  if (fixture) loadMs = await page.evaluate(gcode => {
    window.previewModule.FS.writeFile('/benchmark.gcode', gcode);
    const start = performance.now();
    window.previewStats = JSON.parse(window.preview.loadGcode('/benchmark.gcode'));
    const elapsed = performance.now() - start;
    if (window.previewStats.error) throw new Error(window.previewStats.error);
    window.preview.render();
    return elapsed;
  }, fixture);
  if (process.env.PREVIEW_PARSE_ONLY) {
    const loaded = await page.evaluate(({ metadata, checkFailures }) => {
      const start = performance.now();
      const metadataDiagnostics = metadata ? JSON.parse(window.preview.getMetadataStorageDiagnostics()) : null;
      const failureChecks = [];
      if (checkFailures) {
        const preview = window.preview;
        const canvas = document.querySelector('#canvas');
        const gl = canvas.getContext('webgl2');
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        const state = () => {
          preview.render();
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let hash = 2166136261;
          for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
          const last = Number(preview.getMovesCount()) - 1;
          return { stats: preview.getSliceStatistics(), legend: preview.getLegendData(), layers: preview.getLayersZs(), memory: preview.getRenderMemoryUsage(),
            range: preview.getMoveRange(), source: [0, Math.floor(last / 2), last].map(i => [preview.getMoveInfo(i), preview.getMoveGcodeLine(i)]), pixels: hash >>> 0 };
        };
        window.previewModule.FS.writeFile('/empty-preview-benchmark.gcode', new Uint8Array());
        for (const low of [false, true]) {
          preview.setLowQuality(low); preview.setViewType('Width');
          preview.orbit(13, -7);
          preview.setLayerRange(0, Math.min(1, Number(preview.getLayersCount()) - 1));
          const range = JSON.parse(preview.getMoveRange());
          preview.setMove(Math.floor((range.min + range.max) / 2));
          const expected = JSON.stringify(state());
          for (const filename of ['/missing-preview-benchmark.gcode', '/missing-\"quoted\"\n.gcode', `/missing-${'x'.repeat(700)}.gcode`, '/empty-preview-benchmark.gcode']) {
            const result = JSON.parse(preview.loadGcode(filename));
            if (!result.error) throw new Error(`Expected load failure for ${filename}`);
            if (JSON.stringify(state()) !== expected) throw new Error(`Failed load changed statistics/source/view/pixels: ${filename}, low=${low}`);
            failureChecks.push({ filename, low, preserved: true });
          }
        }
        window.previewModule.FS.unlink('/empty-preview-benchmark.gcode');
      }

      return { stats: window.previewStats, reloads: window.__benchmarkReloads || [], memory: window.preview.getRenderMemoryUsage ? JSON.parse(window.preview.getRenderMemoryUsage()) : null, metadataDiagnostics, failureChecks, metadataDiagnosticMs: metadata ? performance.now() - start : null, heapPeakBytes: window.__previewHeapPeak || null, glError: document.querySelector('#canvas').getContext('webgl2').getError() };
    }, { metadata: Boolean(process.env.PREVIEW_METADATA_DIAGNOSTIC), checkFailures: Boolean(process.env.PREVIEW_CHECK_FAILURES) });
    assert.deepEqual(errors, []); assert.equal(loaded.glError, 0);
    const threads = await page.evaluate(() => ({ workers: window.__previewWorkerCount, pthreadRuns: window.__previewPthreadRuns }));
    await page.close();
    return { loadMs, moduleReadyMs, threads, ...loaded, snapshots: [], mapping: [], measurements: [] };
  }
  const initialLowHash = process.env.PREVIEW_INITIAL_LOW ? await page.evaluate(() => {
    const canvas = document.querySelector('#canvas');
    const gl = canvas.getContext('webgl2');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    window.preview.render();
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
    window.preview.setLowQuality(false); window.preview.render();
    return hash >>> 0;
  }) : null;
  const result = await page.evaluate(({ regressionOnly, sampleCount, fast, renderLayers, syncMode, toggleSamples }) => {
    const preview = window.preview;
    const canvas = document.querySelector('#canvas');
    const gl = canvas.getContext('webgl2');
    const viewport = Array.from(gl.getParameter(gl.VIEWPORT));
    if (viewport[2] !== canvas.width || viewport[3] !== canvas.height) throw new Error('Native viewport does not match canvas');
    const glErrors = [];
    if (window.__benchmarkInitialGlError) glErrors.push({ phase: 'load', error: window.__benchmarkInitialGlError });
    const checkError = phase => { const error = gl.getError(); if (error) glErrors.push({ phase, error }); };
    let captureColors = false;
    let capturedColors = new Set();
    const counts = { uploads: 0, uploadedBytes: 0, triangles: 0 };
    for (const name of ['texImage2D', 'texSubImage2D', 'bufferData', 'bufferSubData']) {
      const original = gl[name].bind(gl);
      gl[name] = (...args) => { counts.uploads++;
        const data = args[args.length - 1];
        if (captureColors && data instanceof Float32Array &&
          ((name === 'texImage2D' && args[2] === gl.R32F) || (name === 'texSubImage2D' && args[6] === gl.RED))) {
          for (const color of data) capturedColors.add(color);
        }
        counts.uploadedBytes += args.reduce((sum, arg) => sum + (ArrayBuffer.isView(arg) ? arg.byteLength : 0), 0); return original(...args); };
    }
    const draw = gl.drawElementsInstanced.bind(gl);
    gl.drawElementsInstanced = (...args) => { counts.triangles += args[1] / 3 * args[4]; return draw(...args); };
    const drawArrays = gl.drawArrays.bind(gl);
    gl.drawArrays = (...args) => { if (args[0] === gl.TRIANGLES) counts.triangles += args[2] / 3; return drawArrays(...args); };
    const drawArraysInstanced = gl.drawArraysInstanced.bind(gl);
    gl.drawArraysInstanced = (...args) => { if (args[0] === gl.TRIANGLES) counts.triangles += args[2] / 3 * args[3]; return drawArraysInstanced(...args); };
    const read = new Uint8Array(4);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    const sync = () => {
      if (syncMode === 'finish') gl.finish();
      else if (syncMode === 'full') gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      else gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, read);
    };
    function imageHash() {
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 2166136261;
      for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
      return hash >>> 0;
    }
    const layers = Number(preview.getLayersCount());
    const firstLayer = renderLayers ? Math.max(0, layers - renderLayers) : 0;
    const snapshots = [];
    function snapshot(name, fn) { if (fast && !['all', 'slice', 'move', 'all-again'].includes(name)) return; fn(); preview.render(); snapshots.push({ name, hash: imageHash(), range: preview.getMoveRange(), legend: preview.getLegendData() }); checkError(name); }
    const middle = firstLayer + Math.floor((layers - firstLayer) / 2);
    snapshot('all', () => preview.setLayerRange(firstLayer, layers - 1));
    snapshot('middle', () => preview.setLayerRange(firstLayer, middle));
    snapshot('slice', () => preview.setLayerRange(Math.max(0, middle - 3), middle));
    snapshot('move', () => { const range = JSON.parse(preview.getMoveRange()); preview.setMove(Math.floor((range.min + range.max) / 2)); });
    snapshot('same-layer-reset', () => preview.setLayerRange(Math.max(0, middle - 3), middle));
    snapshot('travel', () => preview.setOptionVisible(0, true));
    snapshot('seams-hidden', () => preview.setOptionVisible(4, false));
    snapshot('role-hidden', () => preview.setExtrusionRoleVisible(2, false));
    snapshot('speed', () => preview.setViewType('Speed'));
    snapshot('all-again', () => { preview.setOptionVisible(0, false); preview.setOptionVisible(4, true); preview.setExtrusionRoleVisible(2, true); preview.setViewType('FeatureType'); preview.setLayerRange(firstLayer, layers - 1); });
    snapshot('orbit', () => preview.orbit(13, -7));
    snapshot('pan', () => preview.pan(3, 2));
    snapshot('zoom', () => preview.zoom(-1));
    preview.resetCamera(); preview.render();
    if (snapshots.find(item => item.name === 'all').hash !== snapshots.find(item => item.name === 'all-again').hash) throw new Error('Visibility roundtrip changed all-layer rendering');
    if (snapshots.find(item => item.name === 'all').range !== snapshots.find(item => item.name === 'all-again').range) throw new Error('Visibility roundtrip changed move range');
    const mapping = [0, 1, Math.floor(Number(preview.getMovesCount()) / 2), Number(preview.getMovesCount()) - 1].map(i => [i, preview.getMoveInfo(i), preview.getMoveGcodeLine(i)]);
    const measurements = [];
    function measure(name, fn, render = false) {
      const samples = []; const before = { ...counts };
      for (let i = 0; i < sampleCount + 2; i++) {
        const start = performance.now(); fn(i); if (render) { preview.render(); sync(); }
        if (i >= 2) samples.push(performance.now() - start);
      }
      checkError(name);
      samples.sort((a, b) => a - b);
      measurements.push({ name, medianMs: samples[Math.floor(samples.length / 2)], maxMs: samples[samples.length - 1], uploads: counts.uploads - before.uploads, uploadedBytes: counts.uploadedBytes - before.uploadedBytes, triangles: counts.triangles - before.triangles });
    }
    if (!regressionOnly) {
      measure('same-layers-cpu', () => preview.setLayerRange(firstLayer, layers - 1));
      measure('layer-scrub-cpu', i => { preview.setLayerRange(firstLayer, Math.max(firstLayer, layers - 2 - i % 3)); preview.render(); });
      measure('move-scrub-cpu', i => { const range = JSON.parse(preview.getMoveRange()); preview.setMove(range.max - i - 1); });
      measure('same-view-cpu', () => preview.setViewType('FeatureType'));
      preview.setLayerRange(firstLayer, layers - 1);
      measure('normal-render-gpu', () => {}, true);
    }
    let lowFeatureHash = null;
    const lowSnapshots = [];
    if (typeof preview.setLowQuality === 'function') {
      const before = { stats: preview.getSliceStatistics(), layers: preview.getLayersZs(), mapping, range: preview.getMoveRange() };
      const normalHash = imageHash();
      preview.setLowQuality(true);
      if (!regressionOnly) measure('low-render-gpu', () => {}, true);
      preview.render(); const lowHash = imageHash();
      lowFeatureHash = lowHash;
      lowSnapshots.push({ name: 'all', hash: lowHash });
      preview.setLayerRange(Math.max(0, middle - 3), middle); preview.render();
      lowSnapshots.push({ name: 'slice', hash: imageHash() });
      const lowRange = JSON.parse(preview.getMoveRange());
      preview.setMove(Math.floor((lowRange.min + lowRange.max) / 2)); preview.render();
      lowSnapshots.push({ name: 'move', hash: imageHash() });
      preview.setLayerRange(firstLayer, layers - 1); preview.render();
      lowSnapshots.push({ name: 'all-again', hash: imageHash() });
      if (lowSnapshots[0].hash !== lowSnapshots[3].hash) throw new Error('Low slider roundtrip changed rendering');
      preview.setLowQuality(false); preview.render();
      const after = { stats: preview.getSliceStatistics(), layers: preview.getLayersZs(), mapping: mapping.map(([i]) => [i, preview.getMoveInfo(i), preview.getMoveGcodeLine(i)]), range: preview.getMoveRange() };
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Quality changed statistics or exact move mapping');
      if (normalHash !== imageHash()) throw new Error('Quality roundtrip changed normal render');
      if (normalHash === lowHash) throw new Error('Low-quality switch did not change rendering');
      preview.setViewType('Speed');
      const speedHash = imageHash();
      const speedLegend = preview.getLegendData();
      captureColors = true;
      preview.setLowQuality(true); preview.render();
      if (JSON.stringify(JSON.parse(speedLegend).ranges.map(item => item.value)) !== JSON.stringify(JSON.parse(preview.getLegendData()).ranges.map(item => item.value))) throw new Error('Low numeric legend changed values');
      // Eight numeric colors, plus the fixed option and dummy colors stored in the same texture.
      if (capturedColors.size > 18) throw new Error(`Low numeric palette has ${capturedColors.size} colors`);
      const lowColorCount = capturedColors.size;
      capturedColors = new Set();
      preview.setLowQuality(false); preview.render();
      captureColors = false;
      if (speedHash !== imageHash()) throw new Error('Numeric quality roundtrip changed normal render');
      if (speedLegend !== preview.getLegendData()) throw new Error('Numeric quality changed legend values');
      measurements.push({ name: 'numeric-palette', lowColorCount, normalColorCount: capturedColors.size });

    }
    let clippingVerified = false;
    const qualityMemory = {};
    if (typeof preview.setClippingPlane === 'function') {
      for (const low of [false, true]) {
        preview.setLowQuality(low); preview.render(); const unclipped = imageHash();
        if (preview.getRenderMemoryUsage) qualityMemory[low ? 'low' : 'normal'] = JSON.parse(preview.getRenderMemoryUsage());
        if (!regressionOnly && window.__benchmarkCompareClipping) measure(`${low ? 'low' : 'normal'}-no-clip-gpu`, () => {}, true);
        preview.setClippingPlane(1, 0, 0, 1000000); preview.render();
        if (unclipped !== imageHash()) throw new Error('Specialized shader changed pixels versus unclipped original');
        if (!regressionOnly && window.__benchmarkCompareClipping) measure(`${low ? 'low' : 'normal'}-clipped-gpu`, () => {}, true);
        preview.setClippingPlane(0, 0, 0, -1); preview.render();
        if (unclipped === imageHash()) throw new Error('Clipped fallback did not hide geometry');
        preview.setClippingPlane(0, 0, 0, 1); preview.render();
        if (unclipped !== imageHash()) throw new Error('Clipping roundtrip changed pixels');
      }
      preview.setLowQuality(false); preview.render(); clippingVerified = true;
    }
    const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info');
    const toggleMeasurements = [];
    if (toggleSamples && typeof preview.setLowQuality === 'function') {
      preview.setViewType('FeatureType');
      for (const low of [true, false]) {
        const apiSamples = [], submitSamples = [], totalSamples = [];
        for (let i = 0; i < toggleSamples + 2; ++i) {
          preview.setLowQuality(!low); preview.render(); sync();
          const start = performance.now();
          preview.setLowQuality(low);
          const apiEnd = performance.now();
          preview.render();
          const submitEnd = performance.now();
          sync();
          if (i >= 2) {
            apiSamples.push(apiEnd - start);
            submitSamples.push(submitEnd - start);
            totalSamples.push(performance.now() - start);
          }
        }
        const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
        toggleMeasurements.push({ low, apiMedianMs: median(apiSamples), blockingMedianMs: median(submitSamples), synchronizedMedianMs: median(totalSamples) });
      }
      preview.setLowQuality(false); preview.render(); checkError('quality-toggle-timing');
    }
    return { browser: navigator.userAgent, renderer: debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), viewport, syncMode, clippingVerified, lowFeatureHash, lowSnapshots, toggleMeasurements, qualityMemory, heapPeakBytes: window.__previewHeapPeak || null, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), canvas: { width: canvas.width, height: canvas.height }, memory: preview.getRenderMemoryUsage ? JSON.parse(preview.getRenderMemoryUsage()) : null, stats: window.previewStats, snapshots, mapping, measurements, glErrors, glError: gl.getError() || glErrors[0]?.error || 0 };
  }, { regressionOnly, sampleCount: Number(process.env.PREVIEW_SAMPLES || 6), fast: Boolean(process.env.PREVIEW_FAST), renderLayers: Number(process.env.PREVIEW_RENDER_LAYERS || 0), syncMode: process.env.PREVIEW_SYNC || 'pixel', toggleSamples: Number(process.env.PREVIEW_TOGGLE_SAMPLES || 0) });
  assert.deepEqual(errors, []);
  if (result.glError) console.error(JSON.stringify({ renderer: result.renderer, memory: result.memory, qualityMemory: result.qualityMemory, glErrors: result.glErrors, measurements: result.measurements }));
  assert.equal(result.glError, 0);
  const threads = await page.evaluate(() => ({ workers: window.__previewWorkerCount, pthreadRuns: window.__previewPthreadRuns }));
  await page.close();
  return { loadMs, moduleReadyMs, threads, initialLowHash, ...result };
}
try {
  const baseline = process.env.PREVIEW_BASELINE_DIR ? await run(process.env.PREVIEW_BASELINE_DIR, !process.env.PREVIEW_COMPARE_TIMINGS) : null;
  const result = await run(null);
  if (baseline) {
    assert.equal(result.initialLowHash, baseline.initialLowHash, 'Initially-low rendering changed');
    assert.deepEqual(result.stats, baseline.stats, 'Statistics changed');
    assert.deepEqual(result.mapping, baseline.mapping, 'Exact move mapping changed');
    assert.deepEqual(result.snapshots, baseline.snapshots, 'Normal-quality rendering changed');
    if (baseline.lowFeatureHash !== null) {
      assert.equal(result.lowFeatureHash, baseline.lowFeatureHash, 'Low-quality rendering changed');
      assert.deepEqual(result.lowSnapshots, baseline.lowSnapshots, 'Low-quality slider rendering changed');
    }
  }
  if (process.env.PREVIEW_ASSERT_UPLOADS) for (const name of ['same-layers-cpu', 'layer-scrub-cpu', 'move-scrub-cpu', 'same-view-cpu']) {
    assert.equal(result.measurements.find(item => item.name === name).uploads, 0, `${name} uploaded geometry/colors/indices`);
  }
  console.log(JSON.stringify({ baselineMatched: Boolean(baseline), baselineThreads: baseline?.threads, baselineModuleReadyMs: baseline?.moduleReadyMs, baselineMeasurements: baseline?.measurements, baselineToggleMeasurements: baseline?.toggleMeasurements, baselineQualityMemory: baseline?.qualityMemory, baselineLoadMs: baseline?.loadMs, baselineHeapPeakBytes: baseline?.heapPeakBytes, ...result }, null, 2));
} finally {
  await browser.close();
}
