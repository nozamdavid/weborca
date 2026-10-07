import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

let playwright;
try {
  playwright = await import(path.resolve(repoRoot, 'wasm/tests/node_modules/playwright/index.mjs'));
} catch (e1) {
  try {
    playwright = await import('playwright');
  } catch (e2) {
    console.error('Failed to import playwright:', e1, e2);
    process.exit(1);
  }
}

const { chromium, firefox } = playwright;

const PORT = 5059;
const BASE_URL = `http://localhost:${PORT}`;
const DEMO_URL = `${BASE_URL}/wasm/preview/demo/`;
const TEST_OUT_DIR = path.resolve(repoRoot, 'wasm/build/tests-preview');

fs.mkdirSync(TEST_OUT_DIR, { recursive: true });

async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/wasm/preview/demo/`, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
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
    ],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    }
  );

  serverProcess.stdout.on('data', (d) => {
    const msg = d.toString();
    if (msg.includes('Accepting connections')) {
      console.log(`[Server] ${msg.trim()}`);
    }
  });

  serverProcess.stderr.on('data', (d) => {
    console.error(`[Server stderr] ${d.toString().trim()}`);
  });

  const ok = await waitForServer();
  if (!ok) {
    throw new Error('Static server failed to start within timeout');
  }
  console.log('[Server] Static server is ready.');
}

function stopServer() {
  console.log('[Server] Stopping static server on port 5059...');
  try {
    execSync('fuser -k 5059/tcp', { stdio: 'ignore' });
  } catch (_) {}
  if (serverProcess) {
    try {
      process.kill(-serverProcess.pid, 'SIGKILL');
    } catch (_) {}
    serverProcess = null;
  }
}

async function testBrowser(browserType, name) {
  console.log(`\n========================================`);
  console.log(`Testing Browser: ${name}`);
  console.log(`========================================`);

  const consoleLogs = [];

  const browser = await browserType.launch({
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      const txt = msg.text();
      consoleLogs.push(`[${msg.type()}] ${txt}`);
      console.log(`  [Console ${name}] ${msg.type()}: ${txt}`);
    });

    page.on('pageerror', (err) => {
      consoleLogs.push(`[PAGEERROR] ${err.message}`);
      console.error(`  [PageError ${name}] ${err.message}`);
    });

    console.log(`Navigating to ${DEMO_URL}...`);
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });

    console.log(`Waiting for preview to load Voron cube...`);
    await page.waitForFunction(() => window.previewLoaded === true, { timeout: 45000 });

    const stats = await page.evaluate(() => window.previewStats);
    console.log(`[Result ${name}] Loaded stats:`, JSON.stringify(stats));

    // Check canvas pixel info and WebGL errors
    const canvasCheck = await page.evaluate(() => {
      const canvas = document.querySelector('#canvas');
      const gl = canvas.getContext('webgl2');
      const err = gl ? gl.getError() : -1;

      // Copy to 2D canvas to inspect pixels
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(canvas, 0, 0);
      const img = ctx2.getImageData(0, 0, c2.width, c2.height);
      const data = img.data;

      let rSum = 0, gSum = 0, bSum = 0;
      let nonBgCount = 0;
      const totalPixels = c2.width * c2.height;

      // Background color is ~(33, 36, 41)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        rSum += r;
        gSum += g;
        bSum += b;
        if (Math.abs(r - 33) > 10 || Math.abs(g - 36) > 10 || Math.abs(b - 41) > 10) {
          nonBgCount++;
        }
      }

      return {
        width: canvas.width,
        height: canvas.height,
        glError: err,
        avgR: (rSum / totalPixels).toFixed(2),
        avgG: (gSum / totalPixels).toFixed(2),
        avgB: (bSum / totalPixels).toFixed(2),
        nonBgPixelCount: nonBgCount,
        nonBgPercentage: ((nonBgCount / totalPixels) * 100).toFixed(2),
        isBlank: nonBgCount === 0,
      };
    });

    console.log(`[Result ${name}] Canvas check (all layers):`, JSON.stringify(canvasCheck));

    // Save full preview screenshot
    const screenshotPath = path.resolve(TEST_OUT_DIR, `${name}.png`);
    await page.screenshot({ path: screenshotPath });
    console.log(`[Result ${name}] Saved screenshot to ${screenshotPath}`);

    // Now test changing layer range to verify image changes
    console.log(`Testing layer range slider change (layers 0 to 10)...`);
    const layerChangeResult = await page.evaluate(() => {
      window.preview.setLayerRange(0, 10);
      window.preview.render();

      const canvas = document.querySelector('#canvas');
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx2 = c2.getContext('2d');
      ctx2.drawImage(canvas, 0, 0);
      const img = ctx2.getImageData(0, 0, c2.width, c2.height);
      const data = img.data;

      let nonBgCount = 0;
      const totalPixels = c2.width * c2.height;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (Math.abs(r - 33) > 10 || Math.abs(g - 36) > 10 || Math.abs(b - 41) > 10) {
          nonBgCount++;
        }
      }
      return {
        nonBgPixelCount10Layers: nonBgCount,
        nonBgPercentage10Layers: ((nonBgCount / totalPixels) * 100).toFixed(2),
      };
    });

    console.log(`[Result ${name}] Canvas check (10 layers):`, JSON.stringify(layerChangeResult));
    const screenshot10Path = path.resolve(TEST_OUT_DIR, `${name}_10layers.png`);
    await page.screenshot({ path: screenshot10Path });

    // Restore full layers and render for final screenshot
    await page.evaluate(() => {
      window.preview.setLayerRange(0, window.previewStats.layers - 1);
      window.preview.render();
    });
    await page.screenshot({ path: screenshotPath });

    return {
      name,
      stats,
      canvasCheck,
      layerChangeResult,
      screenshotPath,
      consoleLogs,
    };
  } finally {
    await browser.close();
  }
}

async function run() {
  const results = [];
  try {
    await startServer();

    // 1. Test Chromium
    const chromeRes = await testBrowser(chromium, 'chromium');
    results.push(chromeRes);

    // 2. Test Firefox
    const ffRes = await testBrowser(firefox, 'firefox');
    results.push(ffRes);

    console.log('\n========================================');
    console.log('SUMMARY OF RESULTS');
    console.log('========================================');
    for (const r of results) {
      console.log(`\nBrowser: ${r.name}`);
      console.log(`  Layers reported: ${r.stats.layers} (expected: 100)`);
      console.log(`  Moves reported: ${r.stats.moves}`);
      console.log(`  Est. time: ${r.stats.timeS}s`);
      console.log(`  Canvas is blank: ${r.canvasCheck.isBlank}`);
      console.log(`  Non-background pixels (full): ${r.canvasCheck.nonBgPixelCount} (${r.canvasCheck.nonBgPercentage}%)`);
      console.log(`  Non-background pixels (10 layers): ${r.layerChangeResult.nonBgPixelCount10Layers} (${r.layerChangeResult.nonBgPercentage10Layers}%)`);
      console.log(`  Layer change modified pixel count: ${r.canvasCheck.nonBgPixelCount !== r.layerChangeResult.nonBgPixelCount10Layers}`);
      console.log(`  WebGL getError: ${r.canvasCheck.glError} (0 is GL_NO_ERROR)`);
      console.log(`  Screenshot: ${r.screenshotPath}`);
    }

  } catch (err) {
    console.error('Fatal error during test run:', err);
    process.exitCode = 1;
  } finally {
    stopServer();
  }
}

run();
