import { chromium, firefox } from 'playwright';
import { fileURLToPath } from 'url';
import fs from 'node:fs';
import path from 'path';
import { startServer, stopServer } from './lib/dist.mjs';
import { selectAddedPrinter } from './lib/printer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const PORT = 5081;

// STEP import runs through the lazily loaded STEP module (engine/step/*) in its own
// worker; the main engine has no OCCT. Set SKIP_FIREFOX=1 to run Chromium only.
async function runStepSuite(browserType, browserName) {
  const results = [];
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon.ico') && !msg.text().includes('ERR_FAILED')) {
      console.log(`[${browserName} PAGE ERR]`, msg.text());
    }
  });

  // Every STEP worker the page starts; each must be terminated once its import is over.
  const stepWorkers = [];
  page.on('worker', (worker) => {
    if (!worker.url().endsWith('/step-worker.js')) return;
    const entry = { worker, closed: false };
    worker.on('close', () => { entry.closed = true; });
    stepWorkers.push(entry);
  });

  try {
    console.log(`[${browserName}] Navigating to app...`);
    await page.goto(`http://127.0.0.1:${PORT}`);
    
    // Wait for engine and UI ready
    await page.waitForFunction(() => {
      const ps = document.getElementById('printer-select'); return window.__appStore && window.__appStore.getState().isEngineReady && ps && !ps.disabled;
    }, null, { timeout: 30000 });
    console.log(`[${browserName}] App and engine ready.`);
    
    // The engine ships without OCCT: the 28 MB STEP-enabled engine is gone.
    const engineBytes = await page.evaluate(async () => (await (await fetch('/engine/orca_engine.wasm')).arrayBuffer()).byteLength);
    if (engineBytes > 20_000_000) throw new Error(`Main engine is ${engineBytes} bytes; OCCT should not be linked in`);
    console.log(`[${browserName}] Main engine wasm: ${engineBytes} bytes.`);
    results.push({ name: 'Main engine is OCCT-free', pass: true });

    // Select default printer and filament for slicing
    await selectAddedPrinter(page, 'Voron');
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
    if (await page.isEnabled('[data-testid="step-import-modal"] .ds-btn--primary')) {
      throw new Error('Import must be disabled for out-of-range linear deflection');
    }
    await linearInput.fill('0.005');
    await page.click('[data-testid="step-import-modal"] .ds-btn--primary');
    await page.waitForFunction(() => window.__plateStore?.getState().objects.length > 0, null, { timeout: 30000 });
    const before = await plateObjects();
    if (before.length !== 1 || !before[0]) throw new Error(`Expected 1 named object, got ${JSON.stringify(before)}`);
    results.push({ name: 'Valid STEP imported successfully', pass: true });

    if (stepWorkers.length !== 1) throw new Error(`Expected one STEP worker for one import, saw ${stepWorkers.length}`);
    for (let i = 0; i < 50 && !stepWorkers.every((entry) => entry.closed); i++) await page.waitForTimeout(100);
    if (!stepWorkers.every((entry) => entry.closed)) throw new Error('STEP worker was not terminated after the import');
    const importedName = (await page.evaluate(() => window.__plateStore.getState().objects.map((o) => o.name)))[0];
    if (importedName !== 'test_part.step') throw new Error(`Imported object should be named after the file, got ${importedName}`);
    results.push({ name: 'STEP worker terminated after the import', pass: true });

    // 2. Malformed STEP is rejected and leaves the existing project intact
    console.log(`[${browserName}] Importing malformed STEP...`);
    await importStep(Buffer.from('NOT A STEP FILE'), 'malformed.step');
    await page.click('[data-testid="step-import-modal"] .ds-btn--primary');
    await page.waitForSelector('#error-banner', { state: 'visible', timeout: 10000 });
    console.log(`[${browserName}] Got error banner: ${await page.innerText('#error-banner')}`);
    const after = await plateObjects();
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error(`Project changed after failed import: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }
    await page.click('#dismiss-error-btn');
    results.push({ name: 'Malformed STEP import rejected safely', pass: true });

    // 2b. A STEP module that cannot be downloaded fails with a clear error and leaves the project intact
    console.log(`[${browserName}] Importing STEP with the module download blocked...`);
    await context.route('**/engine/step/step_tessellate.wasm', (route) => route.abort());
    await importStep(fs.readFileSync(validStepPath), 'offline_part.step');
    await page.click('[data-testid="step-import-modal"] .ds-btn--primary');
    await page.waitForSelector('#error-banner', { state: 'visible', timeout: 15000 });
    const offlineError = await page.innerText('#error-banner');
    console.log(`[${browserName}] Got error banner: ${offlineError}`);
    if (!/STEP module/i.test(offlineError)) throw new Error(`Module load failure must name the STEP module: ${offlineError}`);
    if (JSON.stringify(await plateObjects()) !== JSON.stringify(before)) throw new Error('Project changed after the STEP module failed to load');
    await page.click('#dismiss-error-btn');
    await context.unroute('**/engine/step/step_tessellate.wasm');
    for (let i = 0; i < 50 && !stepWorkers.every((entry) => entry.closed); i++) await page.waitForTimeout(100);
    if (!stepWorkers.every((entry) => entry.closed)) throw new Error('Failed STEP worker was not terminated');
    results.push({ name: 'Module load failure reported, project intact', pass: true });

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

    // 4. The plate store's own import path goes through the STEP module too
    console.log(`[${browserName}] Importing STEP through the plate store...`);
    await page.evaluate(async (data) => {
      const file = new File([new Uint8Array(data)], 'plate_part.step');
      await window.__plateStore.getState().importFile(file, { linearDeflection: 0.005, angleDeflection: 0.5 });
    }, Array.from(fs.readFileSync(validStepPath)));
    const plateNames = await plateObjects();
    if (plateNames.length !== before.length + 1) throw new Error(`Plate import should add one object, got ${JSON.stringify(plateNames)}`);
    results.push({ name: 'Plate store STEP import adds an object', pass: true });

    console.log(`\nAll checks passed on ${browserName.toUpperCase()}!`);
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log(`Starting STEP import end-to-end tests...`);
  await startServer(PORT, 'step');

  try {
    for (const [name, browserType] of [
      ['chromium', chromium],
      ...(process.env.SKIP_FIREFOX === '1' ? [] : [['firefox', firefox]])
    ]) {
      await runStepSuite(browserType, name);
    }
    console.log(`\n==================================================`);
    console.log(`All STEP import tests passed on all browsers!`);
    console.log(`==================================================`);
  } finally {
    await stopServer(PORT);
  }
}

main().catch((err) => {
  console.error('\nFatal test failure:', err);
  process.exit(1);
});
