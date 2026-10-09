#!/usr/bin/env node
/**
 * @file wasm/tests/stress/browser-recovery.mjs
 * Bounded browser reliability and recovery harness for OrcaSlicer WebAssembly engine.
 *
 * Runs against verified ui-recovery-final-dist in Chromium and Firefox:
 * 1. Serves ui-recovery-final-dist with COOP/COEP isolation on a dedicated ephemeral port.
 * 2. Establishes baseline 20mm cube slice (Voron 2.4 300, 0.20mm Standard, Generic PLA).
 * 3. Loads a configurable repeated-model larger project (default Benchy or STRESS_MODEL override).
 * 4. Cancels an in-flight slice during active computation (verified via streaming onProgress events).
 * 5. Proves worker/client recovery with successful subsequent cube slice matching baseline.
 * 6. Repeats the cancellation/recovery lifecycle across configurable cycles with explicit timeouts.
 * 7. Measures and attributes memory honestly:
 *    - Browser Process Tree RSS (recursive VmRSS of browser root process and all descendants).
 *    - JS Heap (available in Chromium via performance.memory, marked unavailable in Firefox).
 *    - WASM Heap (unexposed across worker boundary).
 *    - Scope: Same-worker recovery normalized G-code parity only, not native parity.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Import Playwright
let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const { chromium, firefox } = playwright;

// Paths & Model Setup
const distDir = path.resolve(repoRoot, 'wasm/build/ui-recovery-final-dist');
const scratchDir = path.resolve(repoRoot, 'wasm/build/browser-recovery');
const cubePath = path.resolve(repoRoot, 'tests/data/20mm_cube.obj');
const defaultModelPath = path.resolve(repoRoot, 'wasm/build/models/3DBenchy.stl');

const stressModelPath = process.env.STRESS_MODEL
  ? path.resolve(process.cwd(), process.env.STRESS_MODEL)
  : defaultModelPath;

if (!fs.existsSync(stressModelPath)) {
  console.error(`ERROR: Stress model not found at ${stressModelPath}`);
  process.exit(1);
}
const stressModelName = path.basename(stressModelPath);

// Configuration options
const CYCLES = Math.max(1, parseInt(process.env.STRESS_CYCLES || '2', 10));
const INSTANCES = Math.max(1, parseInt(process.env.STRESS_INSTANCES || '2', 10));
const TIMEOUT_PER_BROWSER_MS = parseInt(process.env.STRESS_TIMEOUT_MS || '120000', 10);

const SUPPORTED_BROWSERS = ['chromium', 'firefox'];
const browserEnv = process.env.BROWSERS;
const rawBrowsers = (browserEnv !== undefined ? browserEnv : 'chromium,firefox')
  .split(',')
  .map((b) => b.trim().toLowerCase())
  .filter(Boolean);

if (rawBrowsers.length === 0) {
  console.error('ERROR: No valid browsers specified in BROWSERS environment variable.');
  process.exit(1);
}

const invalidBrowsers = rawBrowsers.filter((b) => !SUPPORTED_BROWSERS.includes(b));
if (invalidBrowsers.length > 0) {
  console.error(`ERROR: Unsupported browser(s) specified: ${invalidBrowsers.join(', ')}. Supported browsers: ${SUPPORTED_BROWSERS.join(', ')}.`);
  process.exit(1);
}

const TARGET_BROWSERS = rawBrowsers;

fs.mkdirSync(scratchDir, { recursive: true });

/**
 * Normalizes G-code according to wasm/spike/compare_gcode.sh rules:
 * Strips comments, thumbnails, EXCLUDE_OBJECT, M73, and collapses whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalizeGcode(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out = [];
  let inThumb = false;
  let inBtt = false;

  for (const line of lines) {
    if (/;[ \t]*(THUMBNAIL_BLOCK_START|thumbnail.*begin)/.test(line)) {
      inThumb = true;
      continue;
    }
    if (inThumb) {
      if (/;[ \t]*(THUMBNAIL_BLOCK_END|thumbnail.*end)/.test(line)) {
        inThumb = false;
      }
      continue;
    }
    if (/^[ \t]*;[0-9a-fA-F]{8}[ \t]*$/.test(line)) {
      inBtt = true;
      continue;
    }
    if (inBtt) {
      if (/;[ \t]*bigtree thumbnail end/.test(line)) {
        inBtt = false;
      }
      continue;
    }

    let s = line.replace(/[ \t]*;.*$/, '').trim();
    if (!s) continue;
    if (/^EXCLUDE_OBJECT/.test(s)) continue;
    if (/^M73([ \t]|$)/.test(s)) continue;
    s = s.replace(/[ \t]+/g, ' ');
    out.push(s);
  }

  return out.join('\n');
}

/**
 * Compares two normalized G-code texts and returns line difference count.
 * @param {string} normA
 * @param {string} normB
 * @returns {number}
 */
function countNormalizedDifferences(normA, normB) {
  if (normA === normB) return 0;
  const linesA = normA.split('\n');
  const linesB = normB.split('\n');
  let diffs = 0;
  const maxLen = Math.max(linesA.length, linesB.length);
  for (let i = 0; i < maxLen; i++) {
    if (linesA[i] !== linesB[i]) diffs++;
  }
  return diffs;
}

/**
 * Maps file extensions to MIME types.
 * @param {string} filePath
 * @returns {string}
 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html';
    case '.js':
    case '.mjs': return 'application/javascript';
    case '.wasm': return 'application/wasm';
    case '.json': return 'application/json';
    case '.css': return 'text/css';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.stl':
    case '.obj': return 'application/octet-stream';
    case '.ttf': return 'font/ttf';
    default: return 'application/octet-stream';
  }
}

/**
 * Launches an internal HTTP server serving ui-recovery-final-dist with COOP/COEP headers.
 * Uses an ephemeral port to avoid collisions with any running services.
 * @returns {Promise<{ server: http.Server, port: number, url: string, close: () => Promise<void> }>}
 */
async function startStaticServer() {
  if (!fs.existsSync(distDir)) {
    throw new Error(`ui-recovery-final-dist directory not found at ${distDir}`);
  }

  const server = http.createServer((req, res) => {
    const rawPath = req.url.split('?')[0];
    let filePath = '';

    if (rawPath === '/' || rawPath === '/index.html') {
      filePath = path.join(distDir, 'index.html');
    } else if (rawPath === `/models/${encodeURIComponent(stressModelName)}` || rawPath === `/models/${stressModelName}` || rawPath.startsWith('/models/3DBenchy.stl')) {
      filePath = stressModelPath;
    } else if (rawPath.startsWith('/models/20mm_cube.obj') || rawPath.startsWith('/tests/data/20mm_cube.obj')) {
      filePath = cubePath;
    } else {
      filePath = path.join(distDir, rawPath.replace(/^\//, ''));
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.statusCode = 404;
      res.end(`Not found: ${rawPath}`);
      return;
    }

    const mime = getMimeType(filePath);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr.port;
      const url = `http://127.0.0.1:${port}`;
      resolve({
        server,
        port,
        url,
        close: () => new Promise((res) => server.close(res))
      });
    });
    server.on('error', reject);
  });
}

/**
 * Finds direct child PIDs of a given parent process via /proc.
 * Reads directly without spawning subshells or polluting process trees.
 * @param {number} [parentPid=process.pid]
 * @returns {number[]}
 */
function getDirectChildPids(parentPid = process.pid) {
  try {
    return fs.readdirSync('/proc')
      .filter((entry) => /^\d+$/.test(entry))
      .map((entry) => {
        try {
          const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
          const ppidMatch = status.match(/PPid:\s+(\d+)/);
          return ppidMatch && parseInt(ppidMatch[1], 10) === parentPid ? parseInt(entry, 10) : null;
        } catch (_) {
          return null;
        }
      })
      .filter((pid) => pid !== null);
  } catch (_) {
    return [];
  }
}

/**
 * Recursively attributes the entire browser process tree starting from a root PID.
 * Traverses all descendant levels (zygotes, GPU, network, renderers, worker pthreads)
 * directly via /proc inspection and sums their VmRSS.
 * @param {number|null} rootPid
 * @returns {{ totalRssMiB: number|null, pids: number[] }}
 */
function getBrowserProcessTreeInfo(rootPid) {
  if (!rootPid) return { totalRssMiB: null, pids: [] };
  try {
    const childrenMap = new Map();
    const rssMap = new Map();

    const entries = fs.readdirSync('/proc');
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = parseInt(entry, 10);
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const ppidMatch = status.match(/PPid:\s+(\d+)/);
        const rssMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
        if (ppidMatch) {
          const ppid = parseInt(ppidMatch[1], 10);
          if (!childrenMap.has(ppid)) childrenMap.set(ppid, []);
          childrenMap.get(ppid).push(pid);
        }
        if (rssMatch) {
          rssMap.set(pid, parseInt(rssMatch[1], 10));
        }
      } catch (_) {
        // Process may terminate during scan
      }
    }

    const allPids = [rootPid];
    const queue = [rootPid];
    while (queue.length > 0) {
      const curr = queue.shift();
      const children = childrenMap.get(curr) || [];
      for (const child of children) {
        allPids.push(child);
        queue.push(child);
      }
    }

    let totalKiB = 0;
    for (const pid of allPids) {
      totalKiB += rssMap.get(pid) || 0;
    }
    return {
      totalRssMiB: Number((totalKiB / 1024).toFixed(2)),
      pids: allPids
    };
  } catch (_) {
    return { totalRssMiB: null, pids: [] };
  }
}

/**
 * Forcibly terminates a process tree via SIGKILL.
 * @param {number} rootPid
 */
function killProcessTree(rootPid) {
  if (!rootPid) return;
  const { pids } = getBrowserProcessTreeInfo(rootPid);
  for (const pid of pids.reverse()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (_) {}
  }
}

/**
 * Executes the bounded reliability and recovery test suite for a given browser.
 * @param {any} browserType - Playwright browser launcher (chromium or firefox)
 * @param {string} browserName - 'chromium' or 'firefox'
 * @param {string} baseUrl - Server URL
 * @param {{ isTimedOut: () => boolean, registerCleanup: (fn: () => void) => void }} lifecycle
 * @returns {Promise<{ browserName: string, pass: boolean, baselineLayers: number, cycles: any[], error?: string }>}
 */
async function runBrowserRecovery(browserType, browserName, baseUrl, lifecycle) {
  console.log(`\n================================================================================`);
  console.log(`RUNNING BROWSER RECOVERY SUITE: ${browserName.toUpperCase()}`);
  console.log(`Target Dist: ${distDir}`);
  console.log(`Stress Model: ${stressModelPath} (${stressModelName})`);
  console.log(`Configuration: ${CYCLES} cycles, ${INSTANCES} model instances per cycle`);
  console.log(`================================================================================`);

  let browser = null;
  let browserRootPid = null;
  const cycleRecords = [];

  // Register cleanup handler with timeout guard
  const beforePids = new Set(getDirectChildPids());
  lifecycle.registerCleanup(() => {
    if (browser) {
      try { browser.close().catch(() => {}); } catch (_) {}
    }
    const currentChildren = getDirectChildPids();
    const newRoots = currentChildren.filter((p) => !beforePids.has(p));
    const toKill = new Set([...(browserRootPid ? [browserRootPid] : []), ...newRoots]);
    for (const p of toKill) {
      killProcessTree(p);
    }
  });

  try {
    if (lifecycle.isTimedOut()) {
      throw new Error(`Timeout occurred before launching ${browserName}`);
    }

    browser = await browserType.launch({
      headless: true,
      args: ['--enable-features=SharedArrayBuffer']
    });

    const launchedPids = getDirectChildPids().filter((p) => !beforePids.has(p));
    browserRootPid = launchedPids[0] || null;

    if (lifecycle.isTimedOut()) {
      await browser.close().catch(() => {});
      throw new Error(`Timeout occurred immediately after launching ${browserName}`);
    }

    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (err) => {
      const msg = err.stack || err.message || String(err);
      console.error(`[${browserName} Page Error]`, msg);
      pageErrors.push(msg);
    });

    console.log(`[${browserName}] Step 1: Navigating to ${baseUrl}/index.html...`);
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load', timeout: 30000 });

    const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
    console.log(`[${browserName}] window.crossOriginIsolated = ${isIsolated}`);
    if (!isIsolated) {
      throw new Error(`Browser environment lacks crossOriginIsolated (SharedArrayBuffer disabled)`);
    }

    // Step 2: Establish baseline 20mm cube slice on Voron presets
    console.log(`[${browserName}] Step 2: Slicing baseline 20mm cube...`);
    const baselineRes = await page.evaluate(async () => {
      const { OrcaEngine } = await import('/orca-engine.js');
      const engine = await OrcaEngine.create({
        workerUrl: '/engine-worker.js',
        moduleUrl: '/engine/orca_engine.mjs',
        profilesUrl: '/profiles/',
        threads: 4
      });

      await engine.loadVendors(['Voron']);
      await engine.selectPresets({
        printer: 'Voron 2.4 300 0.4 nozzle',
        process: '0.20mm Standard @Voron',
        filaments: ['Generic PLA @System']
      });

      const resp = await fetch('/models/20mm_cube.obj');
      const buf = await resp.arrayBuffer();
      await engine.loadModel('20mm_cube.obj', buf);
      await engine.arrange({ useBed: true });

      const t0 = performance.now();
      const sliceRes = await engine.slice();
      const durationMs = performance.now() - t0;

      const decoder = new TextDecoder();
      const gcodeText = decoder.decode(sliceRes.gcode);

      let jsHeap = null;
      if (typeof performance !== 'undefined' && performance.memory) {
        jsHeap = {
          usedBytes: performance.memory.usedJSHeapSize,
          totalBytes: performance.memory.totalJSHeapSize
        };
      }

      window.__testEngine = engine;

      return {
        layers: sliceRes.layers,
        bytes: sliceRes.gcode.byteLength,
        durationMs: Math.round(durationMs),
        gcodeText,
        jsHeap
      };
    });

    if (baselineRes.layers !== 100) {
      throw new Error(`Baseline cube slice expected 100 layers, got ${baselineRes.layers}`);
    }
    const baselineGcodeNorm = normalizeGcode(baselineRes.gcodeText);
    const baselineOutPath = path.join(scratchDir, `baseline_${browserName}.gcode`);
    fs.writeFileSync(baselineOutPath, baselineRes.gcodeText);
    console.log(`[${browserName}] Baseline cube slice verified (100 layers, ${baselineRes.bytes} bytes, ${baselineRes.durationMs} ms).`);

    // Step 3: Run repeated cancellation and recovery cycles
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      if (lifecycle.isTimedOut()) {
        throw new Error(`Timeout occurred before cycle ${cycle}`);
      }

      console.log(`\n[${browserName}] --- Cycle ${cycle} of ${CYCLES} ---`);
      const cycleStart = Date.now();

      const cycleEvalRes = await page.evaluate(
        async ({ cycleNum, numInstances, modelUrl, modelName }) => {
          const engine = window.__testEngine;
          if (!engine) throw new Error('Engine instance not found on window');

          // 1. Load stress model
          const modelResp = await fetch(modelUrl);
          if (!modelResp.ok) throw new Error(`Failed to fetch stress model from ${modelUrl}`);
          const modelBuf = await modelResp.arrayBuffer();
          const loadRes = await engine.loadModel(modelName, modelBuf);
          const objId = loadRes.objects[0].id;

          const initObjs = await engine.listObjects();
          const baseInstId = initObjs[0].instances[0].id;

          for (let i = 1; i < numInstances; i++) {
            await engine.duplicateInstance(objId, baseInstId);
          }

          await engine.arrange({ useBed: true });
          const arrangedObjs = await engine.listObjects();
          const totalInstances = arrangedObjs[0].instances.length;

          // 2. In-flight slice cancellation via public engine API
          const controller = new AbortController();
          const tSliceStart = performance.now();
          let wasCanceled = false;
          let cancelElapsedMs = 0;
          const progressEvents = [];

          // Signal cancellation after 250ms of active slicing computation
          const cancelTimer = setTimeout(() => {
            controller.abort();
          }, 250);

          try {
            await engine.slice({
              signal: controller.signal,
              onProgress: (prog) => {
                progressEvents.push({
                  jobId: prog.jobId,
                  percent: prog.percent,
                  text: prog.text,
                  ms: Math.round(performance.now() - tSliceStart)
                });
              }
            });
          } catch (err) {
            const tEnd = performance.now();
            cancelElapsedMs = Math.round(tEnd - tSliceStart);
            wasCanceled = !!(
              err.canceled ||
              err.name === 'AbortError' ||
              String(err.message).toLowerCase().includes('cancel')
            );
          } finally {
            clearTimeout(cancelTimer);
          }

          if (!wasCanceled) {
            throw new Error(`Cycle ${cycleNum}: Slice operation was not marked as canceled`);
          }

          // Confirm cancellation occurred during active slice computation rather than rejecting before start
          if (progressEvents.length === 0) {
            throw new Error(`Cycle ${cycleNum}: Cancellation occurred before slice started (0 progress events received)`);
          }
          if (cancelElapsedMs < 200) {
            throw new Error(`Cycle ${cycleNum}: Slice ended too fast (${cancelElapsedMs}ms < 200ms), expected in-flight cancellation`);
          }

          // 3. Worker/client recovery: subsequent 20mm cube slice on same worker
          const cubeResp = await fetch('/models/20mm_cube.obj');
          const cubeBuf = await cubeResp.arrayBuffer();
          await engine.loadModel('20mm_cube.obj', cubeBuf);
          await engine.arrange({ useBed: true });

          const tRecStart = performance.now();
          const recSlice = await engine.slice();
          const recDurationMs = Math.round(performance.now() - tRecStart);

          const decoder = new TextDecoder();
          const recGcodeText = decoder.decode(recSlice.gcode);

          let jsHeap = null;
          if (typeof performance !== 'undefined' && performance.memory) {
            jsHeap = {
              usedBytes: performance.memory.usedJSHeapSize,
              totalBytes: performance.memory.totalJSHeapSize
            };
          }

          return {
            cycleNum,
            instances: totalInstances,
            wasCanceled,
            cancelElapsedMs,
            progressCount: progressEvents.length,
            lastProgressText: progressEvents[progressEvents.length - 1]?.text || 'N/A',
            recLayers: recSlice.layers,
            recBytes: recSlice.gcode.byteLength,
            recDurationMs,
            recGcodeText,
            jsHeap
          };
        },
        {
          cycleNum: cycle,
          numInstances: INSTANCES,
          modelUrl: `/models/${encodeURIComponent(stressModelName)}`,
          modelName: stressModelName
        }
      );

      const cycleElapsedMs = Date.now() - cycleStart;

      // Parity check against baseline normalized G-code (same-worker recovery parity)
      const recGcodeNorm = normalizeGcode(cycleEvalRes.recGcodeText);
      const diffLines = countNormalizedDifferences(baselineGcodeNorm, recGcodeNorm);

      if (cycleEvalRes.recLayers !== 100) {
        throw new Error(`Cycle ${cycle}: Recovery cube slice produced ${cycleEvalRes.recLayers} layers (expected 100)`);
      }
      if (diffLines > 0) {
        throw new Error(`Cycle ${cycle}: Recovery cube G-code differed by ${diffLines} lines from baseline`);
      }

      // Save recovery G-code artifact to scratch
      const recGcodePath = path.join(scratchDir, `recovery_${browserName}_c${cycle}.gcode`);
      fs.writeFileSync(recGcodePath, cycleEvalRes.recGcodeText);

      // Measure OS browser process tree RSS recursively starting from browser root PID
      const treeInfo = getBrowserProcessTreeInfo(browserRootPid);
      const processRssMiB = treeInfo.totalRssMiB !== null ? treeInfo.totalRssMiB : 'N/A';

      // Record honest metrics
      const jsHeapMiB = cycleEvalRes.jsHeap
        ? Number((cycleEvalRes.jsHeap.usedBytes / (1024 * 1024)).toFixed(2))
        : null;

      const record = {
        browser: browserName,
        cycle,
        instances: cycleEvalRes.instances,
        cancelElapsedMs: cycleEvalRes.cancelElapsedMs,
        progressCount: cycleEvalRes.progressCount,
        lastProgressText: cycleEvalRes.lastProgressText,
        recDurationMs: cycleEvalRes.recDurationMs,
        recLayers: cycleEvalRes.recLayers,
        diffLines,
        processRssMiB: typeof processRssMiB === 'number' ? `${processRssMiB}` : 'unavailable',
        jsHeapMiB: jsHeapMiB !== null ? `${jsHeapMiB} MiB` : 'unavailable (Firefox unsupported)',
        wasmHeap: 'unexposed across worker boundary',
        cycleElapsedMs,
        pass: true
      };

      cycleRecords.push(record);
      console.log(`[${browserName}] Cycle ${cycle} PASSED: Cancelled in ${cycleEvalRes.cancelElapsedMs} ms (${cycleEvalRes.progressCount} progress events, stage: "${cycleEvalRes.lastProgressText}"), recovered cube in ${cycleEvalRes.recDurationMs} ms (100 layers, 0 diff lines).`);
      console.log(`[${browserName}] Cycle ${cycle} Memory: Browser Tree RSS=${record.processRssMiB} MiB, JS Heap=${record.jsHeapMiB}, WASM Heap=${record.wasmHeap}`);
    }

    // Step 4: Engine disposal
    console.log(`\n[${browserName}] Step 4: Disposing engine instance...`);
    await page.evaluate(() => {
      if (window.__testEngine) {
        window.__testEngine.dispose();
        delete window.__testEngine;
      }
    });

    if (pageErrors.length > 0) {
      throw new Error(`Page errors recorded during test: ${pageErrors.join('; ')}`);
    }

    await browser.close();
    browser = null;
    browserRootPid = null;

    return {
      browserName,
      pass: true,
      baselineLayers: baselineRes.layers,
      cycles: cycleRecords
    };
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
      browser = null;
    }
    if (browserRootPid) {
      killProcessTree(browserRootPid);
      browserRootPid = null;
    }
    console.error(`[${browserName}] FAILURE:`, err.message);
    return {
      browserName,
      pass: false,
      baselineLayers: 0,
      cycles: cycleRecords,
      error: err.message
    };
  }
}

async function main() {
  console.log('================================================================================');
  console.log('OrcaSlicer WebAssembly Bounded Browser Recovery Harness');
  console.log(`Test Directory: ${distDir}`);
  console.log(`Stress Model: ${stressModelPath} (${stressModelName})`);
  console.log(`Target Browsers: ${TARGET_BROWSERS.join(', ')}`);
  console.log(`Timeout per browser: ${TIMEOUT_PER_BROWSER_MS} ms`);
  console.log('================================================================================\n');

  let serverInfo = null;
  const suiteResults = [];
  let allPass = true;

  try {
    serverInfo = await startStaticServer();
    console.log(`Static test server ready at ${serverInfo.url}\n`);

    for (const bName of TARGET_BROWSERS) {
      const bType = bName === 'chromium' ? chromium : firefox;

      let timerId = null;
      let timedOut = false;
      let cleanupFn = null;

      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => {
          timedOut = true;
          if (cleanupFn) {
            try { cleanupFn(); } catch (_) {}
          }
          reject(new Error(`Browser ${bName} exceeded timeout of ${TIMEOUT_PER_BROWSER_MS}ms`));
        }, TIMEOUT_PER_BROWSER_MS);
      });

      const runPromise = runBrowserRecovery(bType, bName, serverInfo.url, {
        isTimedOut: () => timedOut,
        registerCleanup: (fn) => { cleanupFn = fn; }
      });

      let res;
      try {
        res = await Promise.race([runPromise, timeoutPromise]);
      } catch (err) {
        if (serverInfo) {
          console.log('\nClosing static test server after timeout/error...');
          await serverInfo.close().catch(() => {});
          serverInfo = null;
        }
        console.error(`\nFATAL RUNNER TIMEOUT/ERROR: ${err.message}`);
        process.exit(1);
      } finally {
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      }

      suiteResults.push(res);
      if (!res.pass) {
        allPass = false;
      }
    }
  } finally {
    if (serverInfo) {
      console.log('\nClosing static test server...');
      await serverInfo.close().catch(() => {});
      serverInfo = null;
    }
  }

  // Final Summary Output
  console.log('\n====================================================================================================');
  console.log('BROWSER RELIABILITY & RECOVERY SUMMARY');
  console.log('====================================================================================================');
  console.log(
    'Browser'.padEnd(10) + ' | ' +
    'Cycle'.padEnd(6) + ' | ' +
    'Instances'.padEnd(10) + ' | ' +
    'Cancel (ms)'.padEnd(12) + ' | ' +
    'Recovery (ms)'.padEnd(14) + ' | ' +
    'Layers'.padEnd(8) + ' | ' +
    'Parity'.padEnd(12) + ' | ' +
    'Status'
  );
  console.log('-'.repeat(10) + '-+-' + '-'.repeat(6) + '-+-' + '-'.repeat(10) + '-+-' + '-'.repeat(12) + '-+-' + '-'.repeat(14) + '-+-' + '-'.repeat(8) + '-+-' + '-'.repeat(12) + '-+-' + '-'.repeat(8));

  for (const suite of suiteResults) {
    if (suite.cycles.length === 0) {
      console.log(
        suite.browserName.padEnd(10) + ' | ' +
        '-'.padEnd(6) + ' | ' +
        '-'.padEnd(10) + ' | ' +
        '-'.padEnd(12) + ' | ' +
        '-'.padEnd(14) + ' | ' +
        '-'.padEnd(8) + ' | ' +
        '-'.padEnd(12) + ' | ' +
        'FAIL'
      );
    } else {
      for (const c of suite.cycles) {
        console.log(
          c.browser.padEnd(10) + ' | ' +
          String(c.cycle).padEnd(6) + ' | ' +
          String(c.instances).padEnd(10) + ' | ' +
          String(c.cancelElapsedMs).padEnd(12) + ' | ' +
          String(c.recDurationMs).padEnd(14) + ' | ' +
          String(c.recLayers).padEnd(8) + ' | ' +
          (c.diffLines === 0 ? '0 diff lines' : `${c.diffLines} diff lines`).padEnd(12) + ' | ' +
          (c.pass ? 'PASS' : 'FAIL')
        );
      }
    }
  }

  // Memory Metrics Reporting
  console.log('\n====================================================================================================');
  console.log('HONEST BROWSER MEMORY METRICS');
  console.log('====================================================================================================');
  console.log(
    'Browser'.padEnd(10) + ' | ' +
    'Cycle'.padEnd(6) + ' | ' +
    'Browser Tree RSS (MiB)'.padEnd(24) + ' | ' +
    'Client JS Heap'.padEnd(30) + ' | ' +
    'WASM Linear Heap'
  );
  console.log('-'.repeat(10) + '-+-' + '-'.repeat(6) + '-+-' + '-'.repeat(24) + '-+-' + '-'.repeat(30) + '-+-' + '-'.repeat(32));

  for (const suite of suiteResults) {
    for (const c of suite.cycles) {
      console.log(
        c.browser.padEnd(10) + ' | ' +
        String(c.cycle).padEnd(6) + ' | ' +
        String(c.processRssMiB).padEnd(24) + ' | ' +
        String(c.jsHeapMiB).padEnd(30) + ' | ' +
        String(c.wasmHeap)
      );
    }
  }

  console.log('\n--- Architecture, Attribution & Verification Notes ---');
  console.log('1. Browser Process Tree RSS: Recursively measures total host OS resident set size (VmRSS)');
  console.log('   attributed to the browser root process and all descendants (main, zygote, GPU, network, renderers).');
  console.log('   Computed via direct /proc inspection, excluding Node runner and unrelated processes.');
  console.log('2. Client JS Heap: Measured via window.performance.memory. Supported only on Chromium;');
  console.log('   unsupported and marked unavailable on Firefox.');
  console.log('3. WASM Linear Heap: WebAssembly memory is isolated inside the background Web Worker and pthreads.');
  console.log('   It is not queryable from the client window DOM context without specialized worker instrumentation.');
  console.log('4. In-Flight Cancellation: Verified active by asserting streaming onProgress events (e.g. "Slicing mesh",');
  console.log('   "Generating walls") were received prior to AbortController abort signal receipt.');
  console.log('5. Recovery Parity Scope: Evaluated by comparing normalized G-code (stripping comments, thumbnails,');
  console.log('   EXCLUDE_OBJECT, and M73 per compare_gcode.sh) of a 20mm cube before cancellation against a 20mm cube');
  console.log('   sliced on the SAME recovered Web Worker instance. Proves same-worker recovery parity only, not native parity.');
  console.log('6. Browser Heap Enforcement Disclaimer: Neither browser JavaScript nor WebAssembly provides deterministic hard');
  console.log('   browser heap enforcement from script. Dynamic allocations are governed by the browser engine and underlying OS.');
  console.log('   WebAssembly memory allocators retain expanded memory pages in arena free-lists and do not immediately return physical pages.');
  console.log('====================================================================================================\n');

  if (suiteResults.length === 0 || !allPass) {
    console.error('FAILED: One or more browser recovery steps failed.');
    process.exit(1);
  }

  console.log('SUCCESS: All browser reliability and recovery cycles passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
