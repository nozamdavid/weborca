let createOrcaPreview;
try {
  createOrcaPreview = (await import('./orca_preview.js')).default;
} catch (e1) {
  try {
    createOrcaPreview = (await import('/wasm/build/orca-wasm64-preview/wasm/preview/orca_preview.js')).default;
  } catch (e2) {
    console.error('Failed to import createOrcaPreview:', e1, e2);
  }
}

const statusEl = document.getElementById('status');
const canvas = document.getElementById('canvas');
const viewTypeSelect = document.getElementById('view-type');
const layerMin = document.getElementById('layer-min');
const layerMax = document.getElementById('layer-max');
const layerRangeText = document.getElementById('layer-range-text');
const btnResetLayers = document.getElementById('btn-reset-layers');
const btnResetCamera = document.getElementById('btn-reset-camera');
const btnLoadVoron = document.getElementById('btn-load-voron');
const fileInput = document.getElementById('file-input');

const infoLayers = document.getElementById('info-layers');
const infoMoves = document.getElementById('info-moves');
const infoTime = document.getElementById('info-time');
const infoFile = document.getElementById('info-file');

let Module = null;
let preview = null;
let currentLayersCount = 0;

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function updateCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    if (preview) {
      preview.resize(w, h);
      preview.render();
    }
  }
}

async function loadGcode(data, name) {
  statusEl.textContent = `Loading ${name}...`;
  try {
    // Write data to virtual filesystem
    Module.FS.writeFile('/current.gcode', new Uint8Array(data));

    const resultJson = preview.loadGcode('/current.gcode');
    const stats = JSON.parse(resultJson);

    if (stats.error) {
      throw new Error(stats.error);
    }

    currentLayersCount = stats.layers;
    layerMin.min = 0;
    layerMin.max = Math.max(0, stats.layers - 1);
    layerMin.value = 0;

    layerMax.min = 0;
    layerMax.max = Math.max(0, stats.layers - 1);
    layerMax.value = Math.max(0, stats.layers - 1);

    layerRangeText.textContent = `0 - ${Math.max(0, stats.layers - 1)}`;

    infoLayers.textContent = stats.layers;
    infoMoves.textContent = Number(stats.moves).toLocaleString();
    infoTime.textContent = formatTime(stats.timeS);
    infoFile.textContent = name;

    preview.render();

    statusEl.textContent = `Loaded ${name} (${stats.layers} layers, ${stats.moves} moves)`;
    window.previewStats = stats;
    window.previewLoaded = true;
    console.log('[OrcaPreview] Loaded:', stats);
    return stats;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    console.error('[OrcaPreview] Load failed:', err);
    throw err;
  }
}

async function loadFromUrl(url, name) {
  statusEl.textContent = `Fetching ${name}...`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const buf = await resp.arrayBuffer();
  return loadGcode(buf, name);
}

async function init() {
  try {
    statusEl.textContent = 'Initializing WebAssembly module...';
    Module = await createOrcaPreview({
      canvas: canvas,
      locateFile: (path) => {
        if (path.endsWith('.wasm')) {
          // Check if local or build path
          return './orca_preview.wasm';
        }
        return path;
      }
    });

    preview = new Module.OrcaPreview();
    const ok = preview.init('#canvas');
    if (!ok) {
      throw new Error('Failed to initialize WebGL2 preview context');
    }

    window.preview = preview;
    window.previewModule = Module;

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    // Setup mouse interaction
    let isDragging = false;
    let dragButton = 0;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      isDragging = true;
      dragButton = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragButton === 0 && !e.shiftKey) {
        // Orbit
        preview.orbit(dx, dy);
      } else {
        // Pan (right-click or shift+left-click)
        preview.pan(dx, dy);
      }
      preview.render();
    });

    canvas.addEventListener('pointerup', (e) => {
      isDragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    canvas.addEventListener('pointercancel', (e) => {
      isDragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      preview.zoom(e.deltaY);
      preview.render();
    }, { passive: false });

    // UI events
    viewTypeSelect.addEventListener('change', () => {
      preview.setViewType(viewTypeSelect.value);
      preview.render();
    });

    function handleLayerChange() {
      let minVal = parseInt(layerMin.value, 10);
      let maxVal = parseInt(layerMax.value, 10);
      if (minVal > maxVal) {
        if (this === layerMin) maxVal = minVal;
        else minVal = maxVal;
        layerMin.value = minVal;
        layerMax.value = maxVal;
      }
      layerRangeText.textContent = `${minVal} - ${maxVal}`;
      preview.setLayerRange(minVal, maxVal);
      preview.render();
    }

    layerMin.addEventListener('input', handleLayerChange);
    layerMax.addEventListener('input', handleLayerChange);

    btnResetLayers.addEventListener('click', () => {
      layerMin.value = 0;
      layerMax.value = Math.max(0, currentLayersCount - 1);
      layerRangeText.textContent = `0 - ${Math.max(0, currentLayersCount - 1)}`;
      preview.setLayerRange(0, Math.max(0, currentLayersCount - 1));
      preview.render();
    });

    btnResetCamera.addEventListener('click', () => {
      preview.resetCamera();
      preview.render();
    });

    btnLoadVoron.addEventListener('click', () => {
      loadFromUrl('/wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode', 'cube-voron.gcode');
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      loadGcode(buf, file.name);
    });

    statusEl.textContent = 'Module ready. Loading default demo...';
    // Auto-load Voron Cube demo
    await loadFromUrl('/wasm/tests/parity/refs-macos-x86_64/cube-voron.gcode', 'cube-voron.gcode');
  } catch (err) {
    statusEl.textContent = `Initialization error: ${err.message}`;
    console.error('[OrcaPreview] Init error:', err);
  }
}

init();
