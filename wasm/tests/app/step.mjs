import { chromium, firefox } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'node:fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const ISOLATED_BUILD_DIR = path.resolve(repoRoot, 'wasm/build/ui-step-dist');
const PORT = 5081;

let serverProcess;

async function startServer() {
  console.log(`[Server] Launching 'vite preview' from ${ISOLATED_BUILD_DIR} on port ${PORT}...`);
  serverProcess = spawn(
    'npx',
    [
      'vite',
      'preview',
      '--outDir',
      ISOLATED_BUILD_DIR,
      '--port',
      String(PORT),
      '--host',
      '127.0.0.1'
    ],
    {
      cwd: path.resolve(repoRoot, 'wasm/app'),
      stdio: 'ignore',
      detached: true
    }
  );
  
  // Wait a moment for server to start
  await new Promise(resolve => setTimeout(resolve, 3000));
}

async function stopServer() {
  if (serverProcess) {
    process.kill(-serverProcess.pid);
    serverProcess = null;
    console.log(`[Server] Stopped.`);
  }
}

async function runStepSuite(browserType, browserName) {
  const results = [];
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon.ico')) {
      console.log(`[${browserName} PAGE ERR]`, msg.text());
    }
  });

  try {
    console.log(`[${browserName}] Navigating to app...`);
    await page.goto(`http://127.0.0.1:${PORT}`);
    
    // Wait for engine and UI ready
    await page.waitForFunction(() => {
      const ps = document.getElementById('printer-select'); return window.__appStore && window.__appStore.getState().isEngineReady && ps && !ps.disabled;
    }, null, { timeout: 30000 });
    console.log(`[${browserName}] App and engine ready.`);
    
    // Select default printer and filament for slicing
    await page.selectOption('#vendor-select', 'Voron');
    await page.selectOption('#printer-select', 'Voron 2.4 300 0.4 nozzle');
    await page.selectOption('#filament-select', 'Generic PLA @System');
    await page.selectOption('#process-select', '0.20mm Standard @Voron');

    const importStep = async (bytes, name) => {
      await page.evaluate(async ({ data, name }) => {
        const file = new File([new Uint8Array(data)], name);
        window.__appStore.getState().requestImportFile(file);
      }, { data: Array.from(bytes), name });
      await page.waitForSelector('[data-testid="step-import-modal"]', { state: 'visible', timeout: 5000 });
    };
    const plateObjects = () => page.evaluate(() => window.__plateStore.getState().objects.map((o) => o.name));

    // 1. Valid STEP import; out-of-range deflection blocks the import as on desktop
    console.log(`[${browserName}] Importing valid STEP fixture...`);
    const validStepPath = path.resolve(__dirname, '../../../tests/data/utf8_part_names.step');
    await importStep(fs.readFileSync(validStepPath), 'test_part.step');
    const linearInput = page.locator('[data-testid="step-import-modal"] input[type="number"]').first();
    await linearInput.fill('0.5');
    if (await page.isEnabled('[data-testid="step-import-modal"] .btn-primary')) {
      throw new Error('Import must be disabled for out-of-range linear deflection');
    }
    await linearInput.fill('0.005');
    await page.click('[data-testid="step-import-modal"] .btn-primary');
    await page.waitForFunction(() => window.__plateStore?.getState().objects.length > 0, null, { timeout: 30000 });
    const before = await plateObjects();
    if (before.length !== 1 || !before[0]) throw new Error(`Expected 1 named object, got ${JSON.stringify(before)}`);
    results.push({ name: 'Valid STEP imported successfully', pass: true });

    // 2. Malformed STEP is rejected and leaves the existing project intact
    console.log(`[${browserName}] Importing malformed STEP...`);
    await importStep(Buffer.from('NOT A STEP FILE'), 'malformed.step');
    await page.click('[data-testid="step-import-modal"] .btn-primary');
    await page.waitForSelector('#error-banner', { state: 'visible', timeout: 10000 });
    console.log(`[${browserName}] Got error banner: ${await page.innerText('#error-banner')}`);
    const after = await plateObjects();
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error(`Project changed after failed import: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }
    await page.click('#dismiss-error-btn');
    results.push({ name: 'Malformed STEP import rejected safely', pass: true });

    // 3. Slice the imported STEP file
    console.log(`[${browserName}] Slicing imported STEP...`);
    await page.click('#slice-btn');
    
    await page.waitForFunction(() => {
      const sliceBtn = document.getElementById('slice-btn');
      return sliceBtn && !sliceBtn.disabled && sliceBtn.innerText.includes('Slice');
    }, null, { timeout: 60000 });

    const sliceResult = await page.evaluate(() => window.__appStore?.getState().sliceResult);
    if (!sliceResult || sliceResult.gcodeBytes === 0) throw new Error("G-code should be generated and non-empty");
    console.log(`[${browserName}] Sliced successfully: ${sliceResult.layers} layers, ${sliceResult.gcodeBytes} bytes.`);
    
    results.push({ name: 'STEP model sliced successfully', pass: true });

    console.log(`\nAll checks passed on ${browserName.toUpperCase()}!`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`Starting STEP import end-to-end tests...`);
  await startServer();

  try {
    for (const [name, browserType] of [
      ['chromium', chromium],
      ['firefox', firefox]
    ]) {
      await runStepSuite(browserType, name);
    }
    console.log(`\n==================================================`);
    console.log(`All STEP import tests passed on all browsers!`);
    console.log(`==================================================`);
  } finally {
    await stopServer();
  }
}

main().catch((err) => {
  console.error('\nFatal test failure:', err);
  process.exit(1);
});
