import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

const PORT = 5057;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DEMO_URL = `${BASE_URL}/wasm/web/demo/index.html`;

const P6_CUBE_GCODE = path.resolve(repoRoot, 'wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode');
const COMPARE_SCRIPT = path.resolve(repoRoot, 'wasm/spike/compare_gcode.sh');
const TEST_OUT_DIR = path.resolve(repoRoot, 'wasm/build/tests-browser');

fs.mkdirSync(TEST_OUT_DIR, { recursive: true });

async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/wasm/web-smoke/serve.json`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let serverProcess = null;

async function startServer() {
  if (await isServerRunning()) {
    console.log(`[Server] Static server already running on port ${PORT}`);
    return;
  }

  console.log(`[Server] Starting static server on port ${PORT}...`);
  serverProcess = spawn(
    'npx',
    [
      '--prefix',
      'wasm/tests',
      'serve',
      '.',
      '-c',
      'wasm/web-smoke/serve.json',
      '-l',
      String(PORT),
      '--no-clipboard',
      '-L'
    ],
    {
      cwd: repoRoot,
      stdio: 'ignore',
      detached: true
    }
  );

  const ready = await waitForServer();
  if (!ready) {
    throw new Error(`Server failed to start on port ${PORT} within timeout`);
  }
  console.log(`[Server] Server ready at ${BASE_URL}`);
}

async function stopServer() {
  console.log('[Server] Stopping static server...');
  if (serverProcess && serverProcess.pid) {
    try {
      process.kill(-serverProcess.pid, 'SIGTERM');
    } catch (_) {}
  }

  for (let i = 0; i < 20; i++) {
    if (!(await isServerRunning())) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (await isServerRunning()) {
    if (serverProcess && serverProcess.pid) {
      try {
        process.kill(-serverProcess.pid, 'SIGKILL');
      } catch (_) {}
    }
    try {
      execSync(`fuser -k -TERM ${PORT}/tcp 2>/dev/null || true`);
    } catch (_) {}
  }
  console.log('[Server] Server stopped.');
}

process.on('SIGINT', async () => {
  await stopServer();
  process.exit(130);
});

process.on('SIGTERM', async () => {
  await stopServer();
  process.exit(143);
});

function compareGcode(referencePath, testPath) {
  try {
    const output = execSync(`bash "${COMPARE_SCRIPT}" "${referencePath}" "${testPath}"`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return { ok: true, output };
  } catch (err) {
    return {
      ok: false,
      output: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : err.message),
      exitCode: err.status
    };
  }
}

async function runBrowserTests(browserType, browserName) {
  const results = [];
  const metrics = {
    moduleLoadTimeMs: 0,
    cubeSliceTimeMs: 0,
    peakMemory: 'N/A',
    consoleErrors: []
  };

  let browser = null;

  try {
    browser = await browserType.launch({
      headless: true
    });

    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        metrics.consoleErrors.push(text);
        console.error(`[${browserName} Console Error]`, text);
      }
    });

    page.on('pageerror', (err) => {
      const errStr = err.stack || err.message || String(err);
      metrics.consoleErrors.push(errStr);
      console.error(`[${browserName} Page Error]`, errStr);
    });

    // -------------------------------------------------------------------------
    // Step 1: Open demo & assert crossOriginIsolated + no errors
    // -------------------------------------------------------------------------
    {
      const stepStart = Date.now();
      let stepPass = false;
      let details = '';
      try {
        await page.goto(DEMO_URL, { waitUntil: 'load' });
        // Allow demo initialization script to complete
        await page.waitForTimeout(2000);

        const isolated = await page.evaluate(() => window.crossOriginIsolated);
        if (!isolated) {
          throw new Error('window.crossOriginIsolated is false');
        }
        if (metrics.consoleErrors.length > 0) {
          throw new Error(`Page produced console/page errors: ${metrics.consoleErrors.join('; ')}`);
        }
        stepPass = true;
        details = `crossOriginIsolated: true, 0 page errors`;
      } catch (err) {
        details = err.message;
      }
      results.push({
        step: '1. Open demo & isolation',
        pass: stepPass,
        durationMs: Date.now() - stepStart,
        details
      });
    }

    // -------------------------------------------------------------------------
    // Step 2: API test via page.evaluate
    // -------------------------------------------------------------------------
    {
      const stepStart = Date.now();
      let stepPass = false;
      let details = '';
      try {
        const evalRes = await page.evaluate(async () => {
          const { OrcaEngine } = await import('/wasm/web/orca-engine.js');
          const t0 = performance.now();
          const engine = await OrcaEngine.create();
          const tModule = performance.now() - t0;

          await engine.loadVendors(['Voron']);
          await engine.selectPresets({
            printer: 'Voron 2.4 300 0.4 nozzle',
            process: '0.20mm Standard @Voron',
            filaments: ['Generic PLA @System']
          });

          const resp = await fetch('/tests/data/20mm_cube.obj');
          const buf = await resp.arrayBuffer();
          await engine.loadModel('20mm_cube.obj', buf);
          await engine.arrange();

          const progressEvents = [];
          const tSlice0 = performance.now();
          const sliceRes = await engine.slice({
            onProgress: (p) => progressEvents.push(p)
          });
          const tSlice = performance.now() - tSlice0;

          // Convert G-code bytes to base64
          let binary = '';
          const bytes = sliceRes.gcode;
          const len = bytes.byteLength;
          const chunkSize = 8192;
          for (let i = 0; i < len; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
          }
          const b64 = btoa(binary);

          let mem = null;
          if (typeof performance !== 'undefined' && performance.memory) {
            mem = {
              usedJSHeapSize: performance.memory.usedJSHeapSize,
              totalJSHeapSize: performance.memory.totalJSHeapSize
            };
          }

          engine.dispose();

          return {
            tModule,
            tSlice,
            progressCount: progressEvents.length,
            stats: {
              layers: sliceRes.layers,
              printTimeS: sliceRes.printTimeS,
              filamentMm: sliceRes.filamentMm,
              filamentG: sliceRes.filamentG
            },
            b64,
            mem
          };
        });

        metrics.moduleLoadTimeMs = Math.round(evalRes.tModule);
        metrics.cubeSliceTimeMs = Math.round(evalRes.tSlice);
        if (evalRes.mem) {
          metrics.peakMemory = `${(evalRes.mem.usedJSHeapSize / (1024 * 1024)).toFixed(1)} MB`;
        }

        if (evalRes.progressCount < 2) {
          throw new Error(`Expected at least 2 progress events, got ${evalRes.progressCount}`);
        }

        const outGcodePath = path.join(TEST_OUT_DIR, `${browserName}_cube.gcode`);
        fs.writeFileSync(outGcodePath, Buffer.from(evalRes.b64, 'base64'));

        const cmp = compareGcode(P6_CUBE_GCODE, outGcodePath);
        if (!cmp.ok) {
          throw new Error(`compare_gcode.sh failed (exit ${cmp.exitCode}):\n${cmp.output}`);
        }

        stepPass = true;
        details = `Slice: ${metrics.cubeSliceTimeMs}ms, ${evalRes.progressCount} progress events, G-code match`;
      } catch (err) {
        details = err.message;
      }
      results.push({
        step: '2. API Slice (Cube)',
        pass: stepPass,
        durationMs: Date.now() - stepStart,
        details
      });
    }

    // -------------------------------------------------------------------------
    // Step 3: Cancel test
    // -------------------------------------------------------------------------
    {
      const stepStart = Date.now();
      let stepPass = false;
      let details = '';
      try {
        const cancelRes = await page.evaluate(async () => {
          const { OrcaEngine } = await import('/wasm/web/orca-engine.js');
          const engine = await OrcaEngine.create();
          await engine.loadVendors(['Voron']);
          await engine.selectPresets({
            printer: 'Voron 2.4 300 0.4 nozzle',
            process: '0.20mm Standard @Voron',
            filaments: ['Generic PLA @System']
          });

          const benchyResp = await fetch('/wasm/build/models/3DBenchy.stl');
          const benchyBuf = await benchyResp.arrayBuffer();
          await engine.loadModel('3DBenchy.stl', benchyBuf);
          await engine.arrange();

          const controller = new AbortController();
          let abortTime = 0;
          const timer = setTimeout(() => {
            abortTime = performance.now();
            controller.abort();
          }, 300);

          let wasCanceled = false;
          let cancelDuration = 0;

          try {
            await engine.slice({ signal: controller.signal });
          } catch (err) {
            const end = performance.now();
            if (abortTime > 0) {
              cancelDuration = end - abortTime;
            }
            wasCanceled = !!(err.canceled || err.name === 'AbortError' || String(err.message).toLowerCase().includes('cancel'));
          } finally {
            clearTimeout(timer);
          }

          // Slice cube again to verify engine state recovery
          const cubeResp = await fetch('/tests/data/20mm_cube.obj');
          const cubeBuf = await cubeResp.arrayBuffer();
          await engine.loadModel('20mm_cube.obj', cubeBuf);
          await engine.arrange();
          const cubeRes = await engine.slice();

          let binary = '';
          const bytes = cubeRes.gcode;
          const len = bytes.byteLength;
          const chunkSize = 8192;
          for (let i = 0; i < len; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
          }
          const b64 = btoa(binary);

          engine.dispose();

          return {
            wasCanceled,
            cancelDuration,
            cubeB64: b64
          };
        });

        if (!cancelRes.wasCanceled) {
          throw new Error('Slicing was not marked as canceled');
        }
        if (cancelRes.cancelDuration > 1000) {
          throw new Error(`Cancel took longer than 1s: ${Math.round(cancelRes.cancelDuration)}ms`);
        }

        const cancelCubeGcode = path.join(TEST_OUT_DIR, `${browserName}_cancel_cube.gcode`);
        fs.writeFileSync(cancelCubeGcode, Buffer.from(cancelRes.cubeB64, 'base64'));

        const cmp = compareGcode(P6_CUBE_GCODE, cancelCubeGcode);
        if (!cmp.ok) {
          throw new Error(`Re-sliced cube compare failed after cancel:\n${cmp.output}`);
        }

        stepPass = true;
        details = `Canceled in ${Math.round(cancelRes.cancelDuration)}ms (< 1s), re-slice verified`;
      } catch (err) {
        details = err.message;
      }
      results.push({
        step: '3. Cancel (Benchy)',
        pass: stepPass,
        durationMs: Date.now() - stepStart,
        details
      });
    }

    // -------------------------------------------------------------------------
    // Step 4: Demo UI test
    // -------------------------------------------------------------------------
    {
      const stepStart = Date.now();
      let stepPass = false;
      let details = '';
      try {
        await page.goto(DEMO_URL, { waitUntil: 'load' });

        await page.waitForFunction(() => {
          const s = document.getElementById('vendor-select');
          return s && s.options.length > 1;
        });

        await page.selectOption('#vendor-select', 'Voron');

        await page.waitForFunction(() => {
          const p = document.getElementById('printer-select');
          const proc = document.getElementById('process-select');
          const fil = document.getElementById('filament-select');
          return p && !p.disabled && p.options.length > 0 &&
                 proc && !proc.disabled && proc.options.length > 0 &&
                 fil && !fil.disabled && fil.options.length > 0;
        });

        await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
        await page.waitForTimeout(500);
        await page.selectOption('#process-select', '0.20mm Standard @Voron');
        await page.selectOption('#filament-select', 'Generic PLA @System');
        await page.waitForFunction(() => {
          const proc = document.getElementById('process-select');
          return proc && proc.value === '0.20mm Standard @Voron';
        });

        const modelPath = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
        await page.setInputFiles('#model-file', modelPath);

        await page.waitForFunction(() => !document.getElementById('slice-btn').disabled);
        await page.click('#slice-btn');

        await page.waitForFunction(() => {
          const s = document.getElementById('stats-section');
          return s && s.style.display !== 'none' && !document.getElementById('slice-btn').disabled;
        }, null, { timeout: 60000 });

        const dlPath = path.join(TEST_OUT_DIR, `${browserName}_demo.gcode`);
        try {
          const [ download ] = await Promise.all([
            page.waitForEvent('download', { timeout: 10000 }),
            page.click('#download-link')
          ]);
          await download.saveAs(dlPath);
        } catch (_) {
          // Fallback: extract gcode blob from download link directly
          const b64 = await page.evaluate(async () => {
            const href = document.getElementById('download-link').href;
            const resp = await fetch(href);
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            const len = bytes.byteLength;
            const chunkSize = 8192;
            for (let i = 0; i < len; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
            }
            return btoa(binary);
          });
          fs.writeFileSync(dlPath, Buffer.from(b64, 'base64'));
        }

        const cmp = compareGcode(P6_CUBE_GCODE, dlPath);
        if (!cmp.ok) {
          throw new Error(`Demo G-code comparison failed:\n${cmp.output}`);
        }

        // Enter layer_height = 0.3 override
        await page.fill('#options-text', 'layer_height = 0.3');
        await page.$eval('#options-text', el => el.blur());

        await page.click('#slice-btn');
        await page.waitForFunction(() => {
          const btn = document.getElementById('slice-btn');
          const text = document.getElementById('status-text').textContent;
          return !btn.disabled && text.includes('complete');
        }, null, { timeout: 60000 });

        const layerCount = parseInt(await page.$eval('#stat-layers', el => el.textContent), 10);
        if (isNaN(layerCount) || layerCount >= 100) {
          throw new Error(`Expected layer count < 100 for layer_height=0.3, got ${layerCount}`);
        }

        stepPass = true;
        details = `UI G-code matched; layer_height=0.3 produced ${layerCount} layers (< 100)`;
      } catch (err) {
        details = err.message;
      }
      results.push({
        step: '4. Demo UI & Options',
        pass: stepPass,
        durationMs: Date.now() - stepStart,
        details
      });
    }

    // -------------------------------------------------------------------------
    // Step 5: Metrics & Resources
    // -------------------------------------------------------------------------
    {
      results.push({
        step: '5. Metrics & Resources',
        pass: metrics.consoleErrors.length === 0,
        durationMs: 0,
        details: `Module: ${metrics.moduleLoadTimeMs}ms, Slice: ${metrics.cubeSliceTimeMs}ms, Heap: ${metrics.peakMemory}, Errors: ${metrics.consoleErrors.length}`
      });
    }

  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return { browserName, results, metrics };
}

async function main() {
  console.log('================================================================================');
  console.log('Starting OrcaSlicer WebAssembly Browser Test Suite');
  console.log('Browsers: Chromium, Firefox');
  console.log('================================================================================\n');

  let allPassed = true;
  const suiteResults = [];

  try {
    await startServer();

    for (const [bType, bName] of [[chromium, 'chromium'], [firefox, 'firefox']]) {
      console.log(`\n>>> Running test suite for ${bName.toUpperCase()}...`);
      const browserRes = await runBrowserTests(bType, bName);
      suiteResults.push(browserRes);

      const hasFail = browserRes.results.some(r => !r.pass);
      if (hasFail) {
        allPassed = false;
      }
    }
  } finally {
    await stopServer();
  }

  // Print Summary Table
  console.log('\n====================================================================================================');
  console.log('BROWSER TEST SUITE SUMMARY');
  console.log('====================================================================================================');
  console.log(
    'Browser'.padEnd(10) + ' | ' +
    'Step'.padEnd(28) + ' | ' +
    'Status'.padEnd(8) + ' | ' +
    'Duration'.padEnd(10) + ' | ' +
    'Details'
  );
  console.log('-'.repeat(10) + '-+-' + '-'.repeat(28) + '-+-' + '-'.repeat(8) + '-+-' + '-'.repeat(10) + '-+-' + '-'.repeat(35));

  for (const { browserName, results } of suiteResults) {
    for (const r of results) {
      const dur = r.durationMs > 0 ? `${r.durationMs} ms` : '-';
      const status = r.pass ? 'PASS' : 'FAIL';
      console.log(
        browserName.padEnd(10) + ' | ' +
        r.step.padEnd(28) + ' | ' +
        status.padEnd(8) + ' | ' +
        dur.padEnd(10) + ' | ' +
        r.details
      );
    }
    console.log('-'.repeat(100));
  }

  // Print Metrics Table
  console.log('\n====================================================================================================');
  console.log('BROWSER PERFORMANCE & RESOURCE METRICS');
  console.log('====================================================================================================');
  for (const { browserName, metrics } of suiteResults) {
    console.log(`[${browserName.toUpperCase()}]`);
    console.log(`  - Engine Module Load Time : ${metrics.moduleLoadTimeMs} ms`);
    console.log(`  - 20mm Cube Slice Time    : ${metrics.cubeSliceTimeMs} ms`);
    console.log(`  - Peak JS Heap Memory     : ${metrics.peakMemory}`);
    console.log(`  - Console Errors Count    : ${metrics.consoleErrors.length}`);
    if (metrics.consoleErrors.length > 0) {
      for (const err of metrics.consoleErrors) {
        console.log(`      * ${err}`);
      }
    }
  }
  console.log('====================================================================================================\n');

  if (!allPassed) {
    console.error('FAILED: One or more browser test steps failed.');
    process.exit(1);
  }

  console.log('SUCCESS: All browser test steps passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
