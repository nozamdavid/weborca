// PREVIEW_LIGHTING_BASE_URL=http://127.0.0.1:5371 node wasm/preview/test_lighting.mjs
// Optional PREVIEW_LIGHTING_BROWSERS=chromium (default: chromium,firefox).
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '../tests/node_modules/playwright/index.mjs';

const base = process.env.PREVIEW_LIGHTING_BASE_URL;
assert(base, 'Set PREVIEW_LIGHTING_BASE_URL to the packaged candidate server');
const browsers = (process.env.PREVIEW_LIGHTING_BROWSERS || 'chromium,firefox').split(',');
const bytes = [...await readFile(new URL('../tests/parity/refs-macos-x86_64/cube-voron.gcode', import.meta.url))];
const output = process.env.PREVIEW_LIGHTING_OUTPUT || fileURLToPath(new URL('../build/tests-preview-lighting/', import.meta.url));
await mkdir(output, { recursive: true });
// Compile the production sampling helpers directly, so this catches filtering depth before comparison.
const helpers = await Promise.all(['../../src/libvgcode/src/ShadersES.hpp', './preview.cpp'].map(async path => {
  const lines = (await readFile(new URL(path, import.meta.url), 'utf8')).split('\n');
  const start = lines.findIndex(line => line.includes('"float shadow_sample('));
  const end = lines.findIndex((line, i) => i > start && /"float shadow(?:_shade)?\(/.test(line));
  assert(start >= 0 && end > start, `Missing production shadow helper: ${path}`);
  return lines.slice(start, end).map(line => JSON.parse(line.trim())).join('').replaceAll('u_shadow_map', 'shadow_map');
}));

for (const name of browsers) {
  assert(['chromium', 'firefox'].includes(name), `Unknown browser: ${name}`);
  const browser = await ({ chromium, firefox })[name].launch({
    headless: process.env.PREVIEW_LIGHTING_HEADED !== '1' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    if (process.env.PREVIEW_LIGHTING_MODULE_DIR) {
      for (const extension of ['js', 'wasm']) await page.context().route(`**/orca_preview.${extension}*`, route => route.fulfill({
        path: `${process.env.PREVIEW_LIGHTING_MODULE_DIR}/orca_preview.${extension}`,
        headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' },
        contentType: extension === 'wasm' ? 'application/wasm' : 'text/javascript'
      }));
    }
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    const url = new URL('/__preview_lighting_test__.html', base).href;
    await page.route(url, async route => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers['content-length'];
      delete headers['content-encoding'];
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-type': 'text/html',
          'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' },
        body: '<!doctype html><style>body{margin:0}canvas{display:block}</style><canvas id="canvas" width="800" height="600"></canvas>',
      });
    });
    await page.goto(url);
    await page.evaluate(sources => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) throw new Error('Numerical test requires WebGL2');
      const shader = (type, source) => {
        const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 2, 2, 0, gl.RED, gl.FLOAT, new Float32Array([0.2, 1, 0.2, 1]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.viewport(0, 0, 1, 1);
      for (const helper of sources) {
        const p = gl.createProgram();
        gl.attachShader(p, shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}'));
        gl.attachShader(p, shader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;uniform sampler2D shadow_map;out vec4 result;\n' + helper + '\nvoid main(){result=vec4(filtered_shadow(vec2(0.5),0.4),filtered_shadow(vec2(-1.0),0.4),0,1);}'));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        gl.useProgram(p); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixel = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (Math.abs(pixel[0] - 127.5) > 1 || pixel[1] !== 0 || gl.getError() !== gl.NO_ERROR)
          throw new Error(`Production shadow filtering: expected half shadow and outside lit, got ${pixel}`);
        gl.deleteProgram(p);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }, helpers);
    console.log(`${name}: both production helpers give 50% thin-edge shadow and fully lit outside footprint`);
    const initial = await page.evaluate(async data => {
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      check(crossOriginIsolated, 'Test page must retain COOP/COEP isolation');
      const canvas = document.querySelector('#canvas');
      canvas.addEventListener('webglcontextlost', () => console.error('WebGL context lost'));
      const create = (await import('/preview/orca_preview.js')).default;
      const module = await create({ canvas, locateFile: path => `/preview/${path}`,
        printErr: message => console.error(message) });
      const preview = new module.OrcaPreview();
      preview.setLightingEnabled(false);
      check(preview.init('#canvas'), 'Preview init failed');
      preview.resize(canvas.width, canvas.height);
      const gl = canvas.getContext('webgl2');
      check(gl, 'WebGL2 unavailable');
      let shadowPasses = 0;
      const lightingUniforms = [];
      const bindFramebuffer = gl.bindFramebuffer.bind(gl);
      gl.bindFramebuffer = (target, framebuffer) => {
        if (framebuffer && target === gl.FRAMEBUFFER) ++shadowPasses;
        return bindFramebuffer(target, framebuffer);
      };
      for (const method of ['drawArrays', 'drawArraysInstanced', 'drawElements', 'drawElementsInstanced']) {
        const draw = gl[method].bind(gl);
        gl[method] = (...args) => {
          const program = gl.getParameter(gl.CURRENT_PROGRAM);
          const uniform = gl.getUniformLocation(program, 'enhanced_lighting');
          if (uniform !== null) lightingUniforms.push(gl.getUniform(program, uniform));
          return draw(...args);
        };
      }
      const noError = phase => {
        check(!gl.isContextLost(), `${phase}: context lost`);
        const error = gl.getError();
        check(error === gl.NO_ERROR, `${phase}: WebGL error ${error}`);
      };
      const capture = phase => {
        shadowPasses = 0;
        lightingUniforms.length = 0;
        preview.render();
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        noError(phase);
        capture.state = { shadowPasses, lightingUniforms: [...lightingUniforms] };
        check(pixels.some((value, i) => i % 4 !== 3 && value !== pixels[i % 4]), `${phase}: blank pixels`);
        return pixels;
      };
      const equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
      const metadata = () => JSON.stringify({ moves: preview.getMovesCount(), layers: preview.getLayersCount(),
        zs: preview.getLayersZs(), range: preview.getMoveRange(), stats: preview.getSliceStatistics(),
        move: preview.getMoveInfo(Math.floor(Number(preview.getMovesCount()) / 2)) },
        (_key, value) => typeof value === 'bigint' ? value.toString() : value);
      preview.render(); noError('lighting disabled before loading');
      module.FS.writeFile('/lighting.gcode', new Uint8Array(data));
      const stats = JSON.parse(preview.loadGcode('/lighting.gcode'));
      check(!stats.error && preview.getLayersCount() > 1 && preview.getMovesCount() > 0, 'G-code load failed');
      preview.setViewType('Tool');
      const toolColors = JSON.parse(preview.getLegendData()).items.map(item => item.color);
      for (const view of ['ColorPrint', 'Summary']) {
        preview.setViewType(view);
        check(JSON.stringify(JSON.parse(preview.getLegendData()).items.map(item => item.color)) === JSON.stringify(toolColors),
          `${view} must preserve empty color-print palette fallback to tool colors`);
      }
      preview.setViewType('FeatureType');
      preview.resetCamera();
      const before = metadata();
      const initialOff = capture('lighting disabled before init and load');
      check(capture.state.shadowPasses === 0, 'Initial disabled lighting rendered shadows');
      check(capture.state.lightingUniforms.every(value => !value), 'Initial enhanced lighting active');
      preview.setLightingEnabled(true);
      const on = capture('default shadows');
      check(capture.state.shadowPasses > 0, 'Enabled lighting must render shadow depth');
      preview.setLightingEnabled(false);
      check(equal(initialOff, capture('lighting off')), 'Initial lighting preference changed on load');
      check(capture.state.shadowPasses === 0, 'Disabled lighting rendered shadows');
      check(capture.state.lightingUniforms.length > 0 && capture.state.lightingUniforms.every(value => !value), 'Disabled mode used enhanced lighting');
      check(!equal(on, initialOff), 'Lighting on/off must change pixels');
      preview.setShadowsEnabled(false);
      check(equal(initialOff, capture('lighting off without shadow hook')), 'Disabled lighting still sampled shadows');
      preview.setLightingEnabled(true);
      check(!equal(initialOff, capture('enhanced lighting without shadows')), 'Disabled lighting only removed shadows');
      preview.setShadowsEnabled(true);
      check(equal(on, capture('lighting restored')), 'Lighting roundtrip must restore exact pixels');
      preview.setShadowsEnabled(false);
      const off = capture('shadows off');
      check(!equal(on, off), 'Normal shadows must change pixels');
      check(metadata() === before, 'Shadow toggle changed moves/layers metadata');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      window.lighting = { preview, module, canvas, gl, check, noError, capture, equal, metadata, before, on, off };
      return { moves: Number(preview.getMovesCount()), layers: Number(preview.getLayersCount()),
        renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
    }, bytes);
    await page.locator('#canvas').screenshot({ path: `${output}/${name}-before-shadows-off.png` });
    await page.evaluate(() => {
      const { preview: p, capture, equal, check, on, off, metadata, before } = window.lighting;
      p.setShadowsEnabled(true);
      check(equal(on, capture('shadows restored')), 'Off/on must restore exact pixels');
      p.setShadowsEnabled(false);
      check(equal(off, capture('shadows off repeated')), 'Shadows off must be reproducible');
      p.setShadowsEnabled(true);
      check(equal(on, capture('shadows on repeated')), 'Shadows on must be reproducible');
      check(metadata() === before, 'Repeated shadows changed metadata');
    });
    await page.locator('#canvas').screenshot({ path: `${output}/${name}-after-shadows-on.png` });
    const results = await page.evaluate(() => {
      const { preview: p, module, canvas, gl, check, noError, capture, equal, metadata, before, on } = window.lighting;
      module.FS.writeFile('/empty.gcode', '');
      for (const path of ['/missing.gcode', '/empty.gcode']) {
        check(Boolean(JSON.parse(p.loadGcode(path)).error), 'Replacement must be rejected');
        check(metadata() === before, 'Rejected replacement changed metadata');
        check(equal(on, capture('rejected replacement')), 'Rejected replacement changed shaded pixels');
      }
      p.setLowQuality(true);
      const low = capture('low shadows on');
      p.setShadowsEnabled(false);
      check(equal(low, capture('low shadows off')), 'Low quality must skip shadow pass');
      p.setShadowsEnabled(true);
      check(equal(low, capture('low shadows restored')), 'Low quality toggle changed pixels');
      check(metadata() === before, 'Low quality changed metadata');
      p.setLowQuality(false);
      check(equal(on, capture('normal restored')), 'Quality roundtrip changed pixels');
      for (const lowQuality of [false, true]) {
      for (const lighting of [false, true]) {
        p.setLowQuality(lowQuality);
        p.setLightingEnabled(lighting);
        const full = capture('full range');
        check(capture.state.shadowPasses === (lowQuality || !lighting ? 0 : 1), 'Quality/lighting shadow independence');
        check(capture.state.lightingUniforms.every(value => !!value === lighting), 'Quality overwrote lighting uniform');
        check(metadata() === before, 'Lighting/quality changed metadata');
        const middle = Math.floor(Number(p.getLayersCount()) / 2);
        p.setLayerRange(0, middle);
        check(!equal(full, capture('layer scrub')), 'Layer scrub did not change pixels');
        const range = JSON.parse(p.getMoveRange());
        const move = Math.floor((range.min + range.max) / 2);
        p.setMove(move);
        check(JSON.parse(p.getMoveRange()).current === move, 'Move scrub did not update range');
        capture('move scrub');
        p.setLayerRange(0, Number(p.getLayersCount()) - 1);
        check(equal(full, capture('range restored')), 'Layer/move roundtrip changed pixels');
        p.setViewType('Speed');
        check(!equal(full, capture('speed view')), 'View type did not change pixels');
        p.setViewType('FeatureType');
        check(equal(full, capture('view restored')), 'View roundtrip changed pixels');
        p.setClippingPlane(1, 0, 0, -1000000);
        check(!equal(full, capture('clipped')), 'Clipping plane did not change pixels');
        p.setClippingPlane(0, 0, 0, 1);
        check(equal(full, capture('clipping restored')), 'Clipping roundtrip changed pixels');
      }
      }
      p.setLowQuality(false);
      canvas.width = 360; canvas.height = 640;
      p.resize(canvas.width, canvas.height);
      capture('mobile resize');
      const viewport = gl.getParameter(gl.VIEWPORT);
      check(viewport[2] === 360 && viewport[3] === 640, 'Mobile viewport mismatch');
      p.setLightTheme(true);
      const light = capture('light theme');
      p.setLightTheme(false);
      check(!equal(light, capture('dark theme')), 'Theme did not change pixels');
      p.setLightingEnabled(false);
      p.clearGcode();
      p.render(); noError('empty clear');
      check(Number(p.getMovesCount()) === 0 && Number(p.getLayersCount()) === 0, 'Clear retained geometry metadata');
      const reloaded = JSON.parse(p.loadGcode('/lighting.gcode'));
      check(!reloaded.error && p.getMovesCount() > 0, 'Reload failed');
      p.resetCamera(); capture('reload');
      check(capture.state.shadowPasses === 0 && capture.state.lightingUniforms.every(value => !value), 'Replacement load lost disabled lighting');
      p.setLightingEnabled(true);
      capture('reload shaded');
      check(capture.state.shadowPasses > 0, 'Reload did not restore shaded geometry');

      // Audit every preserved numeric palette against its low-quality legend path.
      for (const view of ['Height', 'Width', 'Speed', 'ActualSpeed', 'FanSpeed', 'Temperature',
        'PressureAdvance', 'Acceleration', 'Jerk', 'VolumetricFlowRate', 'ActualVolumetricFlowRate',
        'LayerTimeLinear', 'LayerTimeLogarithmic']) {
        p.setViewType(view);
        const normalLegend = JSON.parse(p.getLegendData());
        const normal = capture(`${view} normal`);
        p.setLowQuality(true);
        const lowLegend = JSON.parse(p.getLegendData());
        check(normalLegend.viewType === view && lowLegend.viewType === view, `${view} legend route changed`);
        check(JSON.stringify(normalLegend.ranges.map(item => item.value)) === JSON.stringify(lowLegend.ranges.map(item => item.value)),
          `${view} quality changed numeric range values`);
        check(lowLegend.ranges.every(item => Number.isFinite(item.value) && /^#[0-9a-f]{6}$/.test(item.color)),
          `${view} has invalid range colors or values`);
        capture(`${view} low`);
        p.setLowQuality(false);
        check(equal(normal, capture(`${view} normal restored`)), `${view} quality roundtrip changed pixels`);
        check(metadata() === before, `${view} quality changed metadata or ranges`);
      }

      // Exercise RGBA storage through the unchanged RGB legend and opaque ES path.
      p.setViewType('Tool');
      const toolLegend = () => JSON.parse(p.getLegendData()).items;
      const tool = toolLegend()[0].id;
      const colors = Array(tool + 1).fill('');
      for (const color of ['#000000', '#ff0000', '#00ff00', '#0000ff']) {
        colors[tool] = color;
        p.setToolColors(colors);
        check(toolLegend()[0].color === color, `Opaque palette changed ${color}`);
        capture(`palette ${color}`);
      }
      colors[tool] = '#123456ff'; p.setToolColors(colors);
      const opaque = capture('opaque RGBA');
      for (const alpha of ['00', '80']) {
        colors[tool] = `#123456${alpha}`; p.setToolColors(colors);
        check(toolLegend()[0].color === '#123456', 'Legend must retain RGB schema');
        check(equal(opaque, capture(`deferred alpha ${alpha}`)), 'ES alpha changed opaque rendering');
      }
      colors[tool] = ''; p.setToolColors(colors);
      p.setToolColors([]);
      check(toolLegend()[0].color === '#123456', 'Empty palette entries must preserve previous colors');
      colors[tool] = 'invalid'; p.setToolColors(colors);
      check(toolLegend()[0].color === '#404040', 'Invalid palette must use opaque dummy RGB');
      check(metadata() === before, 'Palette edits changed ranges or move metadata');
      for (const view of ['ColorPrint', 'Summary']) {
        p.setViewType(view);
        check(JSON.parse(p.getLegendData()).items.every(item => /^#[0-9a-f]{6}$/.test(item.color)),
          `${view} must retain RGB legend schema`);
        capture(`${view} RGBA legend`);
      }

      // A large total exposes float narrowing while each parser dwell stays exactly representable.
      const source = new TextDecoder().decode(module.FS.readFile('/lighting.gcode'));
      const longSource = 'G4 S16777216\n' + source + '\n';
      module.FS.writeFile('/long-time.gcode', longSource);
      const longTime = JSON.parse(p.loadGcode('/long-time.gcode'));
      module.FS.writeFile('/long-time.gcode', longSource + 'G4 S1\n');
      const plusOne = JSON.parse(p.loadGcode('/long-time.gcode'));
      check(!longTime.error && !plusOne.error, 'Long total-time fixture failed');
      check(Math.abs(plusOne.timeS - longTime.timeS - 1) < 0.02, 'Processor total time lost double precision in JSON');
      p.delete();
      return { lightingDifferenceAndExactRoundtrip: true, fourIndependentModes: true,
        normalShadowDifference: true, exactShadowRoundtrip: true, lowQualitySkipsShadows: true,
        scrubsAndViews: true, clippingRoundtrip: true, mobileAndThemes: true, clearAndReload: true,
        rgbaPalettesAndRgbLegends: true, doubleTotalTime: true };
    });
    assert.deepEqual(errors, [], `${name}: browser/module errors`);
    console.log(JSON.stringify({ browser: name, ...initial, ...results, errors }));
  } catch (error) {
    console.error(`${name}: browser/module errors`, errors);
    throw error;
  } finally {
    await browser.close();
  }
}
