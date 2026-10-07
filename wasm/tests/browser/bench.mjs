import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashGcodeFile } from '../lib/gcode_hash.mjs';

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

const EXPECTED_JSON = JSON.parse(fs.readFileSync(path.resolve(repoRoot, 'wasm/tests/data/expected.json'), 'utf8'));
const EXPECTED_BENCHY_HASH = EXPECTED_JSON['benchy-voron'];
const COMPARE_SCRIPT = path.resolve(repoRoot, 'wasm/spike/compare_gcode.sh');
const TEST_OUT_DIR = path.resolve(repoRoot, 'wasm/build/tests-browser');

fs.mkdirSync(TEST_OUT_DIR, { recursive: true });

if (process.argv[2] === '--node-worker') {
  const config = process.argv[3];
  const threadCount = config === 'default' ? undefined : parseInt(config, 10);
  await runNodeWorker(threadCount);
  process.exit(0);
}

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

function getBrowserPid(browser) {
  if (typeof browser.process === 'function') {
    const proc = browser.process();
    if (proc && proc.pid) return proc.pid;
  }
  if (browser.process && browser.process.pid) {
    return browser.process.pid;
  }
  const impl = browser._connection?.toImpl?.(browser);
  if (impl?.options?.browserProcess?.process?.pid) {
    return impl.options.browserProcess.process.pid;
  }
  return null;
}

function getProcessTreeRssKb(rootPid) {
  if (!rootPid) return 0;
  const pids = new Set([rootPid]);
  const queue = [rootPid];

  while (queue.length > 0) {
    const cur = queue.shift();
    try {
      const taskEntries = fs.readdirSync(`/proc/${cur}/task`);
      for (const t of taskEntries) {
        try {
          const ch = fs.readFileSync(`/proc/${cur}/task/${t}/children`, 'utf8').trim();
          if (ch) {
            for (const p of ch.split(/\s+/)) {
              const childPid = parseInt(p, 10);
              if (childPid && !pids.has(childPid)) {
                pids.add(childPid);
                queue.push(childPid);
              }
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  let totalRssKb = 0;
  for (const pid of pids) {
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
      if (match) {
        totalRssKb += parseInt(match[1], 10);
      }
    } catch (_) {}
  }
  return totalRssKb;
}

function verifyBenchyGcode(testPath) {
  try {
    const hash = hashGcodeFile(testPath);
    const ok = hash === EXPECTED_BENCHY_HASH;
    return {
      ok,
      exitCode: ok ? 0 : 1,
      output: `Normalized SHA-256: ${hash} (expected: ${EXPECTED_BENCHY_HASH})`
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: 1,
      output: err.message
    };
  }
}

function compareGcode(referencePath, testPath) {
  try {
    const output = execSync(`bash "${COMPARE_SCRIPT}" "${referencePath}" "${testPath}"`, {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return { ok: true, output, exitCode: 0 };
  } catch (err) {
    return {
      ok: false,
      output: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : err.message),
      exitCode: err.status ?? 1
    };
  }
}

async function runNodeWorker(threads) {
  const modulePath = path.resolve(repoRoot, 'wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs');
  const webBuildDir = path.resolve(repoRoot, 'wasm/build/web');
  const resPath = path.resolve(webBuildDir, 'resources.json');
  const voronPath = path.resolve(webBuildDir, 'profiles', 'Voron.json');
  const orcaFilamentPath = path.resolve(webBuildDir, 'profiles', 'OrcaFilamentLibrary.json');
  const benchyPath = path.resolve(repoRoot, 'wasm/build/models/3DBenchy.stl');

  const { createEngineCore } = await import('../../web/engine-core.js');
  const mod = await import(modulePath);
  const moduleFactory = mod.createOrcaEngine || mod.default;

  // Signal ready for baseline RSS measurement
  process.stdout.write('BASELINE_READY\n');
  await new Promise((r) => process.stdin.once('data', r));

  const tCreate0 = performance.now();
  const createOpts = threads !== undefined ? { threads } : {};
  const core = await createEngineCore({
    moduleFactory,
    ...createOpts
  });
  await core.call('init', { resourcesDir: '/resources', dataDir: '/data' });
  const createMs = performance.now() - tCreate0;

  const tVendors0 = performance.now();
  await core.addVendorBundle(JSON.parse(fs.readFileSync(resPath, 'utf8')));
  await core.addVendorBundle(JSON.parse(fs.readFileSync(orcaFilamentPath, 'utf8')));
  await core.addVendorBundle(JSON.parse(fs.readFileSync(voronPath, 'utf8')));
  await core.call('loadVendors', {});
  const loadVendorsMs = performance.now() - tVendors0;

  await core.call('selectPresets', {
    printer: 'Voron 2.4 300 0.4 nozzle',
    process: '0.20mm Standard @Voron',
    filaments: ['Generic PLA @System']
  });

  const benchyBytes = fs.readFileSync(benchyPath);
  await core.loadModel('3DBenchy.stl', benchyBytes);
  await core.call('arrange', {});

  const slices = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const res = await core.slice({ outPath: '/out/plate_1.gcode', threads });
    const sliceMs = performance.now() - t0;
    slices.push(sliceMs);

    if (i === 0) {
      const outGcodePath = path.join(TEST_OUT_DIR, 'node_benchy.gcode');
      if (!fs.existsSync(outGcodePath)) {
        fs.writeFileSync(outGcodePath, res.gcode);
      }
    }
  }

  core.dispose();

  const out = JSON.stringify({ createMs, loadVendorsMs, slices });
  process.stdout.write('\nRESULT:' + out + '\n', () => process.exit(0));
}

async function runNodeConfiguration(config) {
  return new Promise((resolve, reject) => {
    const configArg = String(config);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--node-worker', configArg], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'inherit']
    });

    const rootPid = child.pid;
    let baselineRssKb = 0;
    let peakRssKb = 0;
    let sampleTimer = null;
    let stdoutData = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutData += text;
      if (text.includes('BASELINE_READY') && baselineRssKb === 0) {
        baselineRssKb = getProcessTreeRssKb(rootPid);
        peakRssKb = baselineRssKb;
        sampleTimer = setInterval(() => {
          const current = getProcessTreeRssKb(rootPid);
          if (current > peakRssKb) peakRssKb = current;
        }, 100);
        child.stdin.write('GO\n');
      }
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (sampleTimer) clearInterval(sampleTimer);
      if (code !== 0) {
        return reject(new Error(`Node worker exited with code ${code}`));
      }
      const finalSample = getProcessTreeRssKb(rootPid);
      if (finalSample > peakRssKb) peakRssKb = finalSample;

      const idx = stdoutData.indexOf('RESULT:');
      if (idx === -1) {
        return reject(new Error(`Failed to find RESULT in Node worker stdout: ${stdoutData.slice(0, 500)}...`));
      }
      try {
        const parsed = JSON.parse(stdoutData.substring(idx + 7).trim());
        resolve({
          ...parsed,
          baselineRssKb,
          peakRssKb
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function runBenchmark() {
  console.log('================================================================================');
  console.log('3DBenchy Performance Benchmark (Node, Chromium & Firefox)');
  console.log('Configurations: 1 thread, 4 threads, 8 threads, default threads');
  console.log('================================================================================\n');

  const configs = [1, 4, 8, 'default'];
  const browserList = [
    { name: 'chromium', type: chromium },
    { name: 'firefox', type: firefox }
  ];

  const browserVersions = {
    node: process.version
  };
  const comparisonResults = {};
  const allResults = [];

  try {
    // -------------------------------------------------------------------------
    // Node row group
    // -------------------------------------------------------------------------
    console.log(`
================================================================================`);
    console.log(`Starting benchmark run for NODE...`);
    console.log(`================================================================================`);

    for (const config of configs) {
      console.log(`
[node] Running configuration: threads = ${config}...`);
      const nodeRes = await runNodeConfiguration(config);

      const baselineRssMb = nodeRes.baselineRssKb / 1024;
      console.log(`  Baseline RSS: ${baselineRssMb.toFixed(2)} MB`);
      console.log(`  Engine initialized in ${Math.round(nodeRes.createMs)} ms, loadVendors in ${Math.round(nodeRes.loadVendorsMs)} ms`);

      const firstSliceMs = nodeRes.slices[0];
      const sortedSlices = [...nodeRes.slices].sort((a, b) => a - b);
      const medianSliceMs = sortedSlices[1];
      const peakRssMb = nodeRes.peakRssKb / 1024;
      const peakRssDeltaMb = (nodeRes.peakRssKb - nodeRes.baselineRssKb) / 1024;

      console.log(`  Slices: [${nodeRes.slices.map((s) => Math.round(s) + 'ms').join(', ')}]`);
      console.log(`  First slice: ${Math.round(firstSliceMs)} ms | Median slice: ${Math.round(medianSliceMs)} ms`);
      console.log(`  Peak RSS: ${peakRssMb.toFixed(2)} MB (Delta: +${peakRssDeltaMb.toFixed(2)} MB)`);

      if (!comparisonResults['node']) {
        const outGcodePath = path.join(TEST_OUT_DIR, 'node_benchy.gcode');
        const cmp = verifyBenchyGcode(outGcodePath);
        comparisonResults['node'] = { ...cmp, path: outGcodePath };
        console.log(`  Saved G-code to ${outGcodePath} and compared with reference (exit code ${cmp.exitCode})`);
      }

      allResults.push({
        browser: 'node',
        threads: String(config),
        createMs: Math.round(nodeRes.createMs),
        loadVendorsMs: Math.round(nodeRes.loadVendorsMs),
        firstSliceMs: Math.round(firstSliceMs),
        medianSliceMs: Math.round(medianSliceMs),
        peakRssDeltaMb: Number(peakRssDeltaMb.toFixed(2)),
        peakRssMb: Number(peakRssMb.toFixed(2))
      });
    }

    // -------------------------------------------------------------------------
    // Browsers (Chromium & Firefox)
    // -------------------------------------------------------------------------
    await startServer();

    for (const { name: browserName, type: browserType } of browserList) {
      console.log(`
================================================================================`);
      console.log(`Starting benchmark run for ${browserName.toUpperCase()}...`);
      console.log(`================================================================================`);

      for (const config of configs) {
        console.log(`
[${browserName}] Running configuration: threads = ${config}...`);

        const browser = await browserType.launch({
          headless: true
        });

        if (!browserVersions[browserName]) {
          browserVersions[browserName] = browser.version();
        }

        const rootPid = getBrowserPid(browser);
        console.log(`  Browser launched (PID: ${rootPid}, Version: ${browserVersions[browserName]})`);

        const context = await browser.newContext();
        const page = await context.newPage();

        page.on('console', (msg) => {
          if (msg.type() === 'error') {
            console.error(`  [${browserName} Console Error] ${msg.text()}`);
          }
        });

        page.on('pageerror', (err) => {
          console.error(`  [${browserName} Page Error] ${err.message}`);
        });

        await page.goto(DEMO_URL, { waitUntil: 'load' });
        await page.waitForTimeout(500);

        // Baseline RSS right after page load and before engine creation
        const baselineRssKb = getProcessTreeRssKb(rootPid);
        const baselineRssMb = baselineRssKb / 1024;
        console.log(`  Baseline RSS: ${baselineRssMb.toFixed(2)} MB`);

        // Setup engine
        const threadArg = config === 'default' ? undefined : config;
        const setupRes = await page.evaluate(async (threads) => {
          const { OrcaEngine } = await import('/wasm/web/orca-engine.js');
          const tCreate0 = performance.now();
          const createOpts = threads !== undefined ? { threads } : {};
          const engine = await OrcaEngine.create(createOpts);
          const createMs = performance.now() - tCreate0;

          const tVendors0 = performance.now();
          await engine.loadVendors(['Voron']);
          const loadVendorsMs = performance.now() - tVendors0;

          await engine.selectPresets({
            printer: 'Voron 2.4 300 0.4 nozzle',
            process: '0.20mm Standard @Voron',
            filaments: ['Generic PLA @System']
          });

          const resp = await fetch('/wasm/build/models/3DBenchy.stl');
          const buf = await resp.arrayBuffer();
          await engine.loadModel('3DBenchy.stl', buf);
          await engine.arrange();

          window.__benchEngine = engine;
          return { createMs, loadVendorsMs };
        }, threadArg);

        console.log(`  Engine initialized in ${Math.round(setupRes.createMs)} ms, loadVendors in ${Math.round(setupRes.loadVendorsMs)} ms`);

        // Start memory sampling during slices
        let peakRssKb = baselineRssKb;
        const sampleTimer = setInterval(() => {
          const current = getProcessTreeRssKb(rootPid);
          if (current > peakRssKb) peakRssKb = current;
        }, 100);

        // Perform 3 slices
        const sliceEvalRes = await page.evaluate(async () => {
          const engine = window.__benchEngine;
          const slices = [];
          let gcodeB64 = null;

          for (let i = 0; i < 3; i++) {
            const t0 = performance.now();
            const res = await engine.slice();
            const sliceMs = performance.now() - t0;
            slices.push(sliceMs);

            if (i === 0 && !gcodeB64) {
              let binary = '';
              const bytes = res.gcode;
              const len = bytes.byteLength;
              const chunkSize = 8192;
              for (let j = 0; j < len; j += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(j, Math.min(j + chunkSize, len)));
              }
              gcodeB64 = btoa(binary);
            }
          }

          engine.dispose();
          delete window.__benchEngine;
          return { slices, gcodeB64 };
        });

        clearInterval(sampleTimer);
        const finalSample = getProcessTreeRssKb(rootPid);
        if (finalSample > peakRssKb) peakRssKb = finalSample;

        const firstSliceMs = sliceEvalRes.slices[0];
        const sortedSlices = [...sliceEvalRes.slices].sort((a, b) => a - b);
        const medianSliceMs = sortedSlices[1];
        const peakRssMb = peakRssKb / 1024;
        const peakRssDeltaMb = (peakRssKb - baselineRssKb) / 1024;

        console.log(`  Slices: [${sliceEvalRes.slices.map((s) => Math.round(s) + 'ms').join(', ')}]`);
        console.log(`  First slice: ${Math.round(firstSliceMs)} ms | Median slice: ${Math.round(medianSliceMs)} ms`);
        console.log(`  Peak RSS: ${peakRssMb.toFixed(2)} MB (Delta: +${peakRssDeltaMb.toFixed(2)} MB)`);

        // Save G-code from one slice per browser and compare
        if (!comparisonResults[browserName]) {
          const outGcodePath = path.join(TEST_OUT_DIR, `${browserName}_benchy.gcode`);
          fs.writeFileSync(outGcodePath, Buffer.from(sliceEvalRes.gcodeB64, 'base64'));
          const cmp = verifyBenchyGcode(outGcodePath);
          comparisonResults[browserName] = { ...cmp, path: outGcodePath };
          console.log(`  Saved G-code to ${outGcodePath} and compared with reference (exit code ${cmp.exitCode})`);
        }

        allResults.push({
          browser: browserName,
          threads: String(config),
          createMs: Math.round(setupRes.createMs),
          loadVendorsMs: Math.round(setupRes.loadVendorsMs),
          firstSliceMs: Math.round(firstSliceMs),
          medianSliceMs: Math.round(medianSliceMs),
          peakRssDeltaMb: Number(peakRssDeltaMb.toFixed(2)),
          peakRssMb: Number(peakRssMb.toFixed(2))
        });

        await browser.close();
      }
    }
  } finally {
    await stopServer();
  }

  // Print Summary Table
  console.log('\n========================================================================================================================');
  console.log('BENCHMARK RESULTS (3DBenchy: Node, Chromium & Firefox)');
  console.log('========================================================================================================================');
  console.log(`Environment Versions:`);
  for (const [bName, bVer] of Object.entries(browserVersions)) {
    console.log(`  - ${bName}: ${bVer}`);
  }
  console.log('------------------------------------------------------------------------------------------------------------------------');
  console.log(
    'Browser'.padEnd(10) + ' | ' +
    'Threads'.padEnd(8) + ' | ' +
    'Create ms'.padEnd(11) + ' | ' +
    'Vendors ms'.padEnd(12) + ' | ' +
    '1st Slice ms'.padEnd(14) + ' | ' +
    'Median ms'.padEnd(11) + ' | ' +
    'RSS Delta MB'.padEnd(14) + ' | ' +
    'Peak RSS MB'
  );
  console.log('-'.repeat(10) + '-+-' + '-'.repeat(8) + '-+-' + '-'.repeat(11) + '-+-' + '-'.repeat(12) + '-+-' + '-'.repeat(14) + '-+-' + '-'.repeat(11) + '-+-' + '-'.repeat(14) + '-+-' + '-'.repeat(12));

  for (const r of allResults) {
    console.log(
      r.browser.padEnd(10) + ' | ' +
      r.threads.padEnd(8) + ' | ' +
      String(r.createMs).padEnd(11) + ' | ' +
      String(r.loadVendorsMs).padEnd(12) + ' | ' +
      String(r.firstSliceMs).padEnd(14) + ' | ' +
      String(r.medianSliceMs).padEnd(11) + ' | ' +
      r.peakRssDeltaMb.toFixed(2).padEnd(14) + ' | ' +
      r.peakRssMb.toFixed(2)
    );
  }
  console.log('========================================================================================================================\n');

  console.log('========================================================================================================================');
  console.log('G-CODE PARITY VERIFICATION (compare_gcode.sh)');
  console.log('========================================================================================================================');
  let parityAllPass = true;
  for (const [bName, cmp] of Object.entries(comparisonResults)) {
    console.log(`[${bName.toUpperCase()}] Exit code: ${cmp.exitCode} (${cmp.ok ? 'PASS' : 'FAIL'})`);
    console.log(`  Output: ${cmp.output.trim()}`);
    if (cmp.exitCode !== 0) {
      parityAllPass = false;
    }
  }
  console.log('========================================================================================================================\n');

  if (!parityAllPass) {
    console.error('ERROR: G-code comparison failed for one or more environments!');
    process.exit(1);
  }

  return { browserVersions, comparisonResults, allResults };
}

runBenchmark().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
