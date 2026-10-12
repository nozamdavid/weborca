/** Large-toolpath performance measurements and display-only quality regressions. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
import { detailedGcode } from '../lib/preview-performance-fixtures.mjs';
const port = Number(process.env.PORT || 5296);
const baseline = process.env.PREVIEW_PERF_BASELINE === '1';
const autosaveEnabled = process.env.PREVIEW_PERF_AUTOSAVE === '1';
const reports = [];
async function suite(browserType) {
  const browser = await browserType.launch({ args: browserType === chromium ? ['--enable-unsafe-swiftshader'] : [] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    // The preview grows on the main thread; the engine has a separate worker realm.
    const Memory = WebAssembly.Memory;
    WebAssembly.Memory = new Proxy(Memory, {
      construct(target, args, newTarget) {
        const memory = Reflect.construct(target, args, newTarget);
        window.__previewHeapMemory = memory;
        window.__previewHeapPeak = Math.max(window.__previewHeapPeak || 0, memory.buffer.byteLength);
        return memory;
      }
    });
    const grow = WebAssembly.Memory.prototype.grow;
    WebAssembly.Memory.prototype.grow = function (...args) {
      const result = grow.apply(this, args);
      window.__previewHeapMemory = this;
      window.__previewHeapPeak = Math.max(window.__previewHeapPeak || 0, this.buffer.byteLength);
      return result;
    };
  });
  const errors = [];
  const workflowStart = Date.now();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && message.text().startsWith('[OrcaPreview]')) {
      errors.push(message.text());
      console.error(message.text());
    }
  });
  if (process.env.PREVIEW_PERF_PROJECT) {
    page.on('console', message => {
      if (message.text().startsWith('[preview-perf-stage] ')) {
        console.log(JSON.stringify({ browser: browserType.name(), elapsedMs: Date.now() - workflowStart, stage: message.text().slice(21) }));
      }
    });
  }
  async function waitForPreviewReady() {
    await page.waitForFunction(() => document.getElementById('preview-error-overlay') ||
      (window.__previewStore.getState().layersCount > 0 && document.getElementById('canvas')?.dataset.previewReady === 'true'),
    null, { timeout: 180000 });
    const error = page.locator('#preview-error-overlay');
    if (await error.count()) {
      const message = await error.innerText();
      if (process.env.PREVIEW_PERF_OUTPUT) {
        await page.screenshot({ path: process.env.PREVIEW_PERF_OUTPUT.replace(/\.json$/, '') + '-failure.png' });
      }
      assert.fail(`Preview failed: ${message}`);
    }
  }
  try {
    await page.goto(`http://127.0.0.1:${port}/preview`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__previewStore?.getState().isInitialized, null, { timeout: 90000 });
    const startupMs = Date.now() - workflowStart;
    if (!baseline) {
      const initialViewport = await page.evaluate(() => {
        const canvas = document.getElementById('canvas'), gl = canvas.getContext('webgl2');
        window.preview.render();
        return { actual: Array.from(gl.getParameter(gl.VIEWPORT)), expected: [0, 0, canvas.width, canvas.height] };
      });
      assert.deepEqual(initialViewport.actual, initialViewport.expected, 'initial native viewport fills the already-sized canvas');
    } else {
      // Match framing when comparing an older build with the initialization bug.
      await page.evaluate(() => {
        const canvas = document.getElementById('canvas');
        window.preview.resize(canvas.width, canvas.height);
      });
    }
    await page.evaluate(({ project, autosave }) => {
      window.__prefsStore.getState().setGeneralPref('autosave', autosave);
      const prototype = window.previewModule.OrcaPreview.prototype, original = prototype.loadGcode;
      window.__nativeLoadCount = 0;
      prototype.loadGcode = function (...args) {
        window.__nativeLoadCount++;
        if (project) console.log('[preview-perf-stage] native-preview-begin heapBytes=' + (window.__previewHeapMemory?.buffer.byteLength ?? 'unavailable'));
        const result = original.apply(this, args);
        if (project) console.log('[preview-perf-stage] native-preview-end heapBytes=' + (window.__previewHeapMemory?.buffer.byteLength ?? 'unavailable'));
        return result;
      };
      if (project) {
        let percent = -10, status = '';
        window.__appStore.subscribe(state => {
          if (state.slicePercent >= percent + 10 || (!state.isSlicing && state.sliceStatusText !== status)) {
            percent = state.slicePercent;
            status = state.sliceStatusText;
            console.log('[preview-perf-stage] ' + JSON.stringify({ percent, status, gcodeBytes: state.sliceResult?.gcode.length ?? 0 }));
          }
        });
      }
    }, { project: !!process.env.PREVIEW_PERF_PROJECT, autosave: autosaveEnabled });
    if (process.env.PREVIEW_PERF_INITIAL_LOW === '1') {
      await page.evaluate(() => window.__prefsStore.getState().setDisplayPref('previewLowQuality', true));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const start = Date.now();
    let projectTimings;
    if (process.env.PREVIEW_PERF_PROJECT) {
      // Load the project's system preset dependency for the same setup as engine benchmarks.
      if (process.env.PREVIEW_PERF_PROJECT_VENDOR) {
        await page.evaluate(vendor => window.__appStore.getState().chooseVendor(vendor), process.env.PREVIEW_PERF_PROJECT_VENDOR);
      }
      await page.setInputFiles('#project-file-input', process.env.PREVIEW_PERF_PROJECT);
      await page.waitForFunction(() => {
        const state = window.__appStore.getState();
        return state.engineError || (!state.isModelLoading && state.modelFile && state.modelObjects.length);
      }, null, { timeout: 180000 });
      assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null, 'the project opens successfully');
      // Include the real import/history backup before measuring the slice and preview together.
      await page.waitForFunction(() => window.__historyStore.getState().currentSnapshot?.modelFileName === window.__appStore.getState().modelFile.name,
        null, { timeout: 180000 });
      const importMs = Date.now() - start;
      console.log(JSON.stringify({ browser: browserType.name(), stage: 'project-import', importMs }));
      const sliceTimings = await page.evaluate(async () => {
        const started = performance.now();
        await window.__appStore.getState().startSlice();
        const ended = performance.getEntriesByName('orca-slice-end').at(-1);
        // React can synchronously load Preview before the action's promise resumes.
        return { sliceMs: ended ? ended.startTime - started : null, sliceActionMs: performance.now() - started };
      });
      assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null, 'the project slices successfully');
      assert.ok(await page.evaluate(() => window.__appStore.getState().sliceResult?.gcode.length > 0), 'the slice produces G-code');
      projectTimings = { importMs, ...sliceTimings };
      console.log(JSON.stringify({ browser: browserType.name(), stage: 'project-slice', ...projectTimings }));
    } else if (process.env.PREVIEW_PERF_HTTP_GCODE) {
      await page.evaluate(async path => {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`G-code fixture HTTP ${response.status}`);
        await window.__appStore.getState().openGcodeFile(new File([await response.arrayBuffer()], 'detailed.gcode'));
      }, process.env.PREVIEW_PERF_HTTP_GCODE);
    } else if (process.env.PREVIEW_PERF_GCODE) {
      await page.setInputFiles('#gcode-file-input', process.env.PREVIEW_PERF_GCODE);
    } else {
      const config = await page.evaluate(() => window.__appStore.getState().currentConfig);
      const code = detailedGcode({ layers: Number(process.env.PREVIEW_PERF_LAYERS || 120), segments: Number(process.env.PREVIEW_PERF_SEGMENTS || 1024), tools: 4, config });
      await page.evaluate(text => window.__appStore.getState().openGcodeFile(new File([text], 'detailed.gcode')), code);
    }
    await waitForPreviewReady();
    const initialLoadMs = Date.now() - start;
    if (projectTimings) projectTimings.sliceToFrameMs = await page.evaluate(() => Number(document.getElementById('canvas').dataset.sliceToFrameMs));
    const initialMemory = await page.evaluate(() => ({
      heapBytes: window.__previewHeapMemory?.buffer.byteLength ?? null,
      renderMemory: window.preview.getRenderMemoryUsage ? JSON.parse(window.preview.getRenderMemoryUsage()) : null
    }));
    assert.ok(Number.isInteger(initialMemory.heapBytes) && initialMemory.heapBytes >= 65536,
      'the memory probe captures the preview heap before or during loading');
    console.log(JSON.stringify({ browser: browserType.name(), stage: 'preview-ready', ...initialMemory }));
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    if (process.env.PREVIEW_PERF_INITIAL_LOW === '1') {
      await page.uncheck('#preview-low-quality');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const reslices = [];
    const repeatCount = Number(process.env.PREVIEW_PERF_RESLICES || 0);
    if (repeatCount) {
      assert.ok(process.env.PREVIEW_PERF_PROJECT, 'reslicing requires a project fixture');
      assert.ok(Number.isInteger(repeatCount) && repeatCount > 0);
      const expectedStats = await page.evaluate(() => window.__previewStore.getState().stats);
      for (let i = 0; i < repeatCount; i++) {
        const timing = await page.evaluate(async () => {
          delete document.getElementById('canvas').dataset.previewReady;
          const started = performance.now();
          await window.__appStore.getState().startSlice();
          const ended = performance.getEntriesByName('orca-slice-end').at(-1);
          return { sliceMs: ended ? ended.startTime - started : null, sliceActionMs: performance.now() - started };
        });
        assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null, 'reslicing succeeds');
        await waitForPreviewReady();
        assert.deepEqual(await page.evaluate(() => window.__previewStore.getState().stats), expectedStats, 'reslicing preserves exact preview statistics');
        reslices.push(timing);
        console.log(JSON.stringify({ browser: browserType.name(), stage: 'reslice', repeat: i + 1, ...timing }));
      }
    }
    const synthetic = !process.env.PREVIEW_PERF_PROJECT && !process.env.PREVIEW_PERF_HTTP_GCODE && !process.env.PREVIEW_PERF_GCODE;
    async function checkToolColors() {
      await page.selectOption('#view-type-select', 'Tool');
      assert.deepEqual(await page.evaluate(() => window.__previewStore.getState().legend.items.map(item => item.color.toUpperCase())),
        ['#0088FF', '#FF3300', '#FFD000', '#22CC66'], 'the four real tool IDs retain their exact filament colors');
      await page.selectOption('#view-type-select', 'Speed');
    }
    if (synthetic) await checkToolColors();
    const loadMs = Date.now() - start;
    await page.waitForTimeout(100);
    const loads = await page.evaluate(() => window.__nativeLoadCount);
    if (!baseline) assert.equal(loads, 1 + repeatCount, 'each new G-code result parses only once');
    await page.evaluate(() => {
      const button = document.getElementById('btn-toggle-gcode-window');
      window.__textWindowReadyMs = null;
      // Exclude browser automation actionability/retry time from UI latency.
      button.addEventListener('click', () => {
        const started = performance.now();
        const observer = new MutationObserver(() => {
          if (!document.getElementById('gcode-current-line')) return;
          window.__textWindowReadyMs = performance.now() - started;
          observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }, { once: true, capture: true });
    });
    const textWindowStart = Date.now();
    await page.click('#btn-toggle-gcode-window');
    await page.waitForSelector('#gcode-current-line');
    const textWindow = await page.evaluate(() => ({
      rows: document.querySelectorAll('#gcode-window [data-line-number]').length,
      line: Number(document.getElementById('gcode-current-line').dataset.lineNumber),
      expectedLine: Number(window.preview.getMoveGcodeLine(window.__previewStore.getState().currentMove))
    }));
    const textWindowOpenMs = Date.now() - textWindowStart;
    const textWindowReadyMs = await page.evaluate(() => window.__textWindowReadyMs);
    assert.equal(typeof textWindowReadyMs, 'number');
    assert.equal(textWindow.line, textWindow.expectedLine, 'the text window highlights the exact move source line');
    if (!baseline) assert.ok(textWindow.rows <= 81, 'the text window renders only the nearby source lines');
    await page.click('#btn-close-gcode-window');
    if (!baseline) {
      await page.evaluate(() => {
        const state = window.__previewStore.getState();
        state.setMoveAction(Math.floor((state.minMove + state.maxMove) / 2));
        state.setLayerRangeAction(state.minLayer, state.maxLayer);
      });
      assert.equal(await page.evaluate(() => window.__previewStore.getState().currentMove === window.__previewStore.getState().maxMove), true, 'reselecting the current layers restores the complete top layer');
    }
    const before = await page.evaluate(async () => {
      const bytes = window.__appStore.getState().sliceResult.gcode;
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const p = window.preview, moves = Number(p.getMovesCount());
      return { hash: Array.from(new Uint8Array(hash)).join(','), stats: window.__previewStore.getState().stats,
        zs: p.getLayersZs(), moveSamples: [0, 1, Math.floor(moves / 2), moves - 1].map(i => [i, p.getMoveInfo(i), Number(p.getMoveGcodeLine(i))]),
        config: { ...window.__appStore.getState().currentConfig } };
    });
    await page.selectOption('#view-type-select', 'Speed');
    async function measureUiScrubbing() {
      const result = await page.evaluate(async () => {
        const p = window.preview, state = window.__previewStore.getState();
        const gl = document.getElementById('canvas').getContext('webgl2');
        const methods = ['texImage2D', 'texSubImage2D', 'bufferData', 'bufferSubData'];
        const originals = Object.fromEntries(methods.map(name => [name, gl[name]]));
        let uploads = 0;
        for (const name of methods) gl[name] = function (...args) { uploads++; return originals[name].apply(this, args); };
        const started = performance.now();
        try {
          // Drive the same actions as the React slider, including subscribed UI updates.
          for (let i = 0; i < 16; i++) state.setMoveAction(Math.max(state.minMove, state.maxMove - i - 1));
          const actionMs = performance.now() - started;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return { actionMs, frameReadyMs: performance.now() - started, uploads, glError: gl.getError() };
        } finally {
          for (const name of methods) gl[name] = originals[name];
          state.setLayerRangeAction(state.minLayer, state.maxLayer);
        }
      });
      assert.equal(result.glError, 0);
      if (!baseline) assert.equal(result.uploads, 0, 'React slider actions upload no per-print buffers');
      return result;
    }
    async function measure(label) {
      return page.evaluate(label => {
        const p = window.preview, canvas = document.getElementById('canvas'), gl = canvas.getContext('webgl2');
        const pixel = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        p.setLayerRange(0, Number(p.getLayersCount()) - 1);
        p.render(); sync();
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let frameHash = 2166136261;
        const pixelColors = new Set();
        for (let i = 0; i < pixels.length; i += 4) {
          frameHash = Math.imul(frameHash ^ pixels[i], 16777619);
          frameHash = Math.imul(frameHash ^ pixels[i + 1], 16777619);
          frameHash = Math.imul(frameHash ^ pixels[i + 2], 16777619);
          frameHash = Math.imul(frameHash ^ pixels[i + 3], 16777619);
          if (i % 256 === 0) pixelColors.add(pixels[i] << 16 | pixels[i + 1] << 8 | pixels[i + 2]);
        }
        const frames = [];
        for (let i = 0; i < 3; i++) { const t = performance.now(); p.render(); sync(); frames.push(performance.now() - t); }
        const range = JSON.parse(p.getMoveRange());
        let uploads = 0;
        const methods = ['texImage2D', 'texSubImage2D', 'bufferData', 'bufferSubData'], original = {};
        for (const name of methods) { original[name] = gl[name]; gl[name] = function (...args) { uploads++; return original[name].apply(this, args); }; }
        const t = performance.now();
        const scrubOperations = 4;
        try { for (let i = 0; i < scrubOperations; i++) { p.setMove(Math.max(range.min, range.max - i - 1)); p.render(); } }
        finally { for (const name of methods) gl[name] = original[name]; }
        const scrubCpuMs = performance.now() - t;
        sync();
        return { label, frameHash: frameHash >>> 0, sampledPixelColors: pixelColors.size, framesMs: frames, scrubCpuMs, scrubOperations, scrubUploads: uploads, canvas: [canvas.width, canvas.height], viewport: Array.from(gl.getParameter(gl.VIEWPORT)), moves: Number(p.getMovesCount()),
          heapBytes: window.__previewHeapMemory?.buffer.byteLength ?? null, heapPeakBytes: window.__previewHeapPeak ?? null,
          renderMemory: p.getRenderMemoryUsage ? JSON.parse(p.getRenderMemoryUsage()) : null,
          cssCanvas: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height], devicePixelRatio: window.devicePixelRatio,
          driver: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), glError: gl.getError() };
      }, label);
    }
    const normal = await measure('normal');
    normal.uiScrubbing = await measureUiScrubbing();
    const normalLegend = await page.evaluate(() => window.__previewStore.getState().legend);
    let autosave = null;
    assert.equal(normal.glError, 0);
    assert.ok(normal.sampledPixelColors > 1, 'the preview readback contains rendered pixels');
    let low;
    if (!baseline) {
      await page.check('#preview-low-quality');
      await page.waitForFunction(() => document.getElementById('canvas').width < 2000);
      assert.equal(await page.evaluate(() => window.__prefsStore.getState().display.previewLowQuality), true);
      const lowLegend = await page.evaluate(() => window.__previewStore.getState().legend);
      assert.deepEqual(lowLegend.ranges.map(row => row.value), normalLegend.ranges.map(row => row.value), 'quality preserves exact legend values');
      assert.ok(new Set(lowLegend.ranges.map(row => row.color)).size <= 8, 'low quality uses at most eight numeric gradient colors');
      low = await measure('low');
      low.uiScrubbing = await measureUiScrubbing();
      assert.deepEqual(low.canvas, normal.cssCanvas.map(Math.floor), 'low quality uses DPR 1 even when the browser ignores the requested DPR');
      assert.equal(low.scrubUploads, 0, 'move scrubbing uploads no per-print GPU buffers');
      assert.equal(low.glError, 0);
      assert.ok(low.sampledPixelColors > 1, 'low quality contains rendered pixels');
      if (synthetic) await checkToolColors();
      const after = await page.evaluate(async () => {
        const bytes = window.__appStore.getState().sliceResult.gcode;
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        const p = window.preview, moves = Number(p.getMovesCount());
        return { hash: Array.from(new Uint8Array(hash)).join(','), stats: window.__previewStore.getState().stats,
          zs: p.getLayersZs(), moveSamples: [0, 1, Math.floor(moves / 2), moves - 1].map(i => [i, p.getMoveInfo(i), Number(p.getMoveGcodeLine(i))]),
          config: { ...window.__appStore.getState().currentConfig } };
      });
      assert.deepEqual(after, before, 'low quality changes neither G-code bytes, statistics, move source lines nor slicing configuration');
      await page.uncheck('#preview-low-quality');
      await page.waitForFunction(size => document.getElementById('canvas').width === size, normal.canvas[0]);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.check('#preview-low-quality');
      if (autosaveEnabled && process.env.PREVIEW_PERF_PROJECT) {
        autosave = await page.evaluate(async () => {
          const started = performance.now();
          const saved = await window.__autosave.writeAutosave();
          const writeMs = performance.now() - started;
          const record = await window.__autosave.readAutosave();
          return { saved, writeMs, bytes: record?.bytes?.length ?? 0, objects: record?.objects ?? 0,
            expectedObjects: window.__plateStore.getState().objects.length };
        });
        assert.equal(autosave.saved, true, 'the full project autosave completes');
        assert.ok(autosave.bytes > 0);
        assert.equal(autosave.objects, autosave.expectedObjects);
        // Clear this test context's backup so the refresh preference check needs no recovery choice.
        await page.evaluate(() => window.__autosave.clearAutosave());
      }
      await page.reload();
      await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && window.__previewStore?.getState().isInitialized, null, { timeout: 90000 });
      await page.getByRole('tab', { name: 'Preview', exact: true }).click();
      assert.equal(await page.isChecked('#preview-low-quality'), true, 'quality choice survives refresh');
      assert.equal(await page.evaluate(() => window.__previewStore.getState().viewType), 'Speed', 'quality preserves the chosen color scheme');
    }
    assert.deepEqual(errors, []);
    let scopeMemory;
    if (process.platform === 'linux') {
      try {
        const group = fs.readFileSync('/proc/self/cgroup', 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3);
        const base = `/sys/fs/cgroup${group}`;
        scopeMemory = {
          peakBytes: Number(fs.readFileSync(`${base}/memory.peak`, 'utf8')),
          swapPeakBytes: Number(fs.readFileSync(`${base}/memory.swap.peak`, 'utf8')),
          events: fs.readFileSync(`${base}/memory.events`, 'utf8').trim()
        };
      } catch (_) { /* Cgroup accounting may be unavailable outside the bounded Linux runner. */ }
    }
    reports.push({ browser: browserType.name(), baseline, autosaveEnabled, autosave, startupMs, initialLoadMs, projectTimings, reslices, initialMemory, scopeMemory, textWindowOpenMs, textWindowReadyMs, loadMs, nativeLoads: loads, normal, low });
    console.log(JSON.stringify(reports.at(-1)));
  } finally { await browser.close(); }
}
await startServer(port, 'preview-performance', { frozenDist: baseline || process.env.PREVIEW_PERF_FROZEN_DIST === '1' });
try {
  if (process.env.PREVIEW_PERF_BROWSER !== 'firefox') await suite(chromium);
  if (process.env.PREVIEW_PERF_BROWSER === 'firefox' || process.env.PREVIEW_PERF_FIREFOX !== '0') await suite(firefox);
} finally { await stopServer(port); }
if (process.env.PREVIEW_PERF_OUTPUT) fs.writeFileSync(process.env.PREVIEW_PERF_OUTPUT, JSON.stringify(reports, null, 2));
