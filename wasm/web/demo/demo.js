/**
 * @file demo.js
 * Test page application driving OrcaEngine.
 */

import { OrcaEngine } from '../orca-engine.js';

const vendorSelect = document.getElementById('vendor-select');
const printerSelect = document.getElementById('printer-select');
const processSelect = document.getElementById('process-select');
const filamentSelect = document.getElementById('filament-select');
const threadsInput = document.getElementById('threads-input');
const modelFileInput = document.getElementById('model-file');
const optionsText = document.getElementById('options-text');
const optionsErrors = document.getElementById('options-errors');
const sliceBtn = document.getElementById('slice-btn');
const cancelBtn = document.getElementById('cancel-btn');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const statsSection = document.getElementById('stats-section');
const statLayers = document.getElementById('stat-layers');
const statTime = document.getElementById('stat-time');
const statFilamentMm = document.getElementById('stat-filament-mm');
const statFilamentG = document.getElementById('stat-filament-g');
const downloadLink = document.getElementById('download-link');
const logPanel = document.getElementById('log-panel');
const isolationBanner = document.getElementById('isolation-banner');

let engine = null;
let currentAbortController = null;
let loadedModel = false;
let gcodeBlobUrl = null;

function log(msg) {
  const time = new Date().toISOString().substring(11, 19);
  logPanel.textContent += `[${time}] ${msg}\n`;
  logPanel.scrollTop = logPanel.scrollHeight;
}

// 1. Check crossOriginIsolated
function checkIsolation() {
  if (window.crossOriginIsolated) {
    isolationBanner.className = 'banner success';
    isolationBanner.textContent = '✓ crossOriginIsolated: true (COOP/COEP headers present; WebAssembly threads supported)';
  } else {
    isolationBanner.className = 'banner error';
    isolationBanner.textContent = '✗ crossOriginIsolated: false! WebAssembly multi-threading requires COOP/COEP headers (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp). Slicing cannot run without them.';
  }
}

// 2. Format print time in hours/mins/secs
function formatPrintTime(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

// 3. Populate preset select
function fillSelect(selectElement, items, defaultVal) {
  selectElement.innerHTML = '';
  if (items.length === 0) {
    selectElement.disabled = true;
    selectElement.innerHTML = '<option value="">No presets found</option>';
    return;
  }
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.name;
    opt.textContent = item.name;
    selectElement.appendChild(opt);
  }
  selectElement.disabled = false;
  if (defaultVal && items.some((i) => i.name === defaultVal)) {
    selectElement.value = defaultVal;
  }
}

// 4. Update preset lists
async function refreshPresetLists() {
  try {
    const printer = printerSelect.value;
    const process = processSelect.value;
    const filament = filamentSelect.value;

    if (printer && process && filament) {
      await engine.selectPresets({
        printer,
        process,
        filaments: [filament]
      });
    }

    const printers = await engine.listPresets('printer', { compatibleOnly: false });
    fillSelect(printerSelect, printers, printer || printers[0]?.name);

    let processes = await engine.listPresets('process', { compatibleOnly: true });
    if (processes.length === 0) {
      processes = await engine.listPresets('process', { compatibleOnly: false });
    }
    fillSelect(processSelect, processes, process || processes[0]?.name);

    let filaments = await engine.listPresets('filament', { compatibleOnly: true });
    if (filaments.length === 0) {
      filaments = await engine.listPresets('filament', { compatibleOnly: false });
    }
    fillSelect(filamentSelect, filaments, filament || filaments[0]?.name);

    if (printerSelect.value && processSelect.value && filamentSelect.value) {
      await engine.selectPresets({
        printer: printerSelect.value,
        process: processSelect.value,
        filaments: [filamentSelect.value]
      });
    }

    updateSliceButtonState();
  } catch (err) {
    log(`Preset refresh error: ${err.message}`);
  }
}

function updateSliceButtonState() {
  const ready =
    engine &&
    vendorSelect.value &&
    printerSelect.value &&
    processSelect.value &&
    filamentSelect.value &&
    loadedModel;
  sliceBtn.disabled = !ready;
}

// 5. Apply options textarea
async function applyOptions() {
  if (!engine) return;
  optionsErrors.textContent = '';
  const lines = optionsText.value.split('\n');
  const options = {};

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const k = line.substring(0, eqIdx).trim();
      const v = line.substring(eqIdx + 1).trim();
      options[k] = v;
    }
  }

  if (Object.keys(options).length === 0) {
    await engine.resetOptions();
    return;
  }

  const res = await engine.setOptions(options);
  if (res && res.errors && res.errors.length > 0) {
    optionsErrors.textContent = res.errors.map((e) => `${e.key}: ${e.error}`).join('; ');
  }
}

// Event Listeners
vendorSelect.addEventListener('change', async () => {
  const vendor = vendorSelect.value;
  if (!vendor) return;

  statusText.textContent = `Loading vendor ${vendor}...`;
  log(`Loading vendor ${vendor}...`);
  try {
    await engine.loadVendors([vendor]);
    log(`Vendor ${vendor} loaded.`);
    statusText.textContent = `Vendor ${vendor} loaded.`;
    await refreshPresetLists();
  } catch (err) {
    statusText.textContent = `Error loading vendor: ${err.message}`;
    log(`Error: ${err.message}`);
  }
});

printerSelect.addEventListener('change', refreshPresetLists);
processSelect.addEventListener('change', refreshPresetLists);
filamentSelect.addEventListener('change', refreshPresetLists);

optionsText.addEventListener('blur', applyOptions);

modelFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  statusText.textContent = `Loading model ${file.name}...`;
  log(`Loading model file ${file.name} (${file.size} bytes)...`);

  try {
    const buffer = await file.arrayBuffer();
    const result = await engine.loadModel(file.name, new Uint8Array(buffer));
    loadedModel = true;
    log(`Model loaded successfully: ${result.objects?.length || 0} object(s).`);
    statusText.textContent = `Loaded ${file.name}`;
    updateSliceButtonState();
  } catch (err) {
    loadedModel = false;
    log(`Error loading model: ${err.message}`);
    statusText.textContent = `Failed to load model: ${err.message}`;
    updateSliceButtonState();
  }
});

sliceBtn.addEventListener('click', async () => {
  if (!engine) return;

  sliceBtn.disabled = true;
  cancelBtn.disabled = false;
  progressBar.style.width = '0%';
  statusText.textContent = 'Arranging print bed...';
  statsSection.style.display = 'none';

  currentAbortController = new AbortController();

  try {
    await applyOptions();

    log('Arranging objects on bed...');
    await engine.arrange();

    log('Starting slice...');
    statusText.textContent = 'Slicing...';

    const threads = parseInt(threadsInput.value, 10) || 4;

    const result = await engine.slice({
      threads,
      signal: currentAbortController.signal,
      onProgress: (prog) => {
        const pct = prog.percent ?? 0;
        progressBar.style.width = `${pct}%`;
        statusText.textContent = `Slicing: ${prog.text || ''} (${pct}%)`;
      }
    });

    progressBar.style.width = '100%';
    statusText.textContent = 'Slicing complete!';
    log(`Slice finished. Layers: ${result.layers}, Print time: ${result.printTimeS}s`);

    // Show stats
    statLayers.textContent = result.layers ?? '-';
    statTime.textContent = formatPrintTime(result.printTimeS);
    statFilamentMm.textContent = result.filamentMm ? `${result.filamentMm.toFixed(1)} mm` : '-';
    statFilamentG.textContent = result.filamentG ? `${result.filamentG.toFixed(2)} g` : '-';

    if (gcodeBlobUrl) {
      URL.revokeObjectURL(gcodeBlobUrl);
    }
    const blob = new Blob([result.gcode], { type: 'text/plain' });
    gcodeBlobUrl = URL.createObjectURL(blob);
    downloadLink.href = gcodeBlobUrl;
    downloadLink.download = 'sliced_plate.gcode';
    statsSection.style.display = 'block';

  } catch (err) {
    if (err.name === 'AbortError' || err.canceled) {
      statusText.textContent = 'Slicing was canceled.';
      log('Slicing canceled by user.');
    } else {
      statusText.textContent = `Slicing failed: ${err.message}`;
      log(`Slice error: ${err.message}`);
    }
  } finally {
    sliceBtn.disabled = false;
    cancelBtn.disabled = true;
    currentAbortController = null;
  }
});

cancelBtn.addEventListener('click', () => {
  if (currentAbortController) {
    log('Canceling slicing...');
    currentAbortController.abort();
  }
});

// Main initialization
async function init() {
  checkIsolation();
  threadsInput.value = Math.min(navigator.hardwareConcurrency || 4, 8);

  try {
    statusText.textContent = 'Initializing WebAssembly engine...';
    log('Creating OrcaEngine instance...');

    engine = await OrcaEngine.create({
      workerUrl: new URL('../engine-worker.js', import.meta.url).href,
      moduleUrl: '/wasm/build/orca-wasm64/wasm/engine/orca_engine.mjs',
      profilesUrl: '/wasm/build/web/profiles/',
      threads: parseInt(threadsInput.value, 10) || 4
    });

    log('Engine worker connected.');
    statusText.textContent = 'Fetching available vendors...';

    const indexRes = await fetch('/wasm/build/web/profiles/index.json');
    if (!indexRes.ok) {
      throw new Error(`Failed to load index.json: ${indexRes.status}`);
    }
    const indexData = await indexRes.json();

    vendorSelect.innerHTML = '<option value="">Select a vendor...</option>';
    for (const v of indexData) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${Math.round(v.bytes / 1024)} KB)`;
      vendorSelect.appendChild(opt);
    }

    statusText.textContent = 'Engine ready. Select a vendor to begin.';
    log(`Loaded index with ${indexData.length} vendor(s).`);

    // Auto-select Voron if present
    if (indexData.some((v) => v.name === 'Voron')) {
      vendorSelect.value = 'Voron';
      vendorSelect.dispatchEvent(new Event('change'));
    }
  } catch (err) {
    statusText.textContent = `Initialization failed: ${err.message}`;
    log(`Initialization error: ${err.message}`);
  }
}

init();
