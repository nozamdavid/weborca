import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

let playwright;
try {
  playwright = await import(path.resolve(repoRoot, 'wasm/tests/node_modules/playwright/index.mjs'));
} catch (e1) {
  try {
    playwright = await import('playwright');
  } catch (e2) {
    console.error('Failed to import playwright');
    process.exit(1);
  }
}
const { chromium } = playwright;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let p = path.join(repoRoot, req.url.split('?')[0]);
        if (p.endsWith('/')) {
            p = path.join(p, 'index.html');
        }
        if (fs.existsSync(p)) {
          let contentType = 'text/html';
          if (p.endsWith('.js') || p.endsWith('.mjs')) contentType = 'application/javascript';
          else if (p.endsWith('.wasm')) contentType = 'application/wasm';
          else if (p.endsWith('.gcode')) contentType = 'text/plain';
          
          res.writeHead(200, { 'Content-Type': contentType, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
          res.end(fs.readFileSync(p));
        } else {
          res.writeHead(404);
          res.end('Not Found: ' + req.url);
        }
      } catch (e) {
        res.writeHead(500);
        res.end(e.toString());
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

describe('Orca Preview Value Correctness', () => {
  let browser;
  let page;
  let server;
  let port;

  before(async () => {
    server = await startServer();
    port = server.address().port;
    
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    
    page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
    
    await page.route('**/cube-voron.gcode', route => route.fulfill({
      contentType: 'text/plain', body: fs.readFileSync(path.resolve(__dirname, 'fixture.gcode'), 'utf8')
    }));
    await page.goto(`http://127.0.0.1:${port}/wasm/preview/demo/index.html`);
    await page.waitForFunction(() => window.previewLoaded === true, null, { timeout: 10000 });
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) server.close();
  });

  test('correctly parses speed, temp, fan, width, height, flow, PA from G-code', async () => {
    const fixturePath = path.resolve(__dirname, 'fixture.gcode');
    const gcode = fs.readFileSync(fixturePath, 'utf8');

    const result = await page.evaluate(async (gcodeStr) => {
      window.previewModule.FS.writeFile('/test.gcode', new TextEncoder().encode(gcodeStr));
      const resJson = window.preview.loadGcode('/test.gcode');
      const stats = JSON.parse(resJson);
      
      const count = window.preview.getMovesCount();
      const movesMap = new Map();
      for (let i = 0; i < count; i++) {
        const infoStr = window.preview.getMoveInfo(i);
        const info = JSON.parse(infoStr);
        if (info.type === 10 && info.volumetric_rate > 0) {
            movesMap.set(info.gcode_id, info);
        }
      }
      return { stats, moves: Array.from(movesMap.values()) };
    }, gcode);

    assert.ok(result.stats.moves > 0, 'Should have parsed moves');
    
    // Independent geometry: 1.75 mm filament volume divided by XY path length,
    // then multiplied by requested speed. The desktop viewer uses a rectangle with
    // a 1.05 radius factor for outer walls, and a rounded bead for the other roles.
    const area = Math.PI * (1.75 / 2) ** 2;
    const expectations = [
      { role: 10, gcode_id: 12, position: [10, 10, 0.2], length: Math.sqrt(200), extrusion: 1.0, speed: 25 },
      { role: 2, gcode_id: 15, position: [20, 10, 0.2], length: 10, extrusion: 1.2, speed: 20 },
      { role: 1, gcode_id: 18, position: [20, 20, 0.2], length: 10, extrusion: 1.4, speed: 40 },
      { role: 4, gcode_id: 21, position: [10, 20, 0.2], length: 10, extrusion: 1.5, speed: 60 },
      { role: 5, gcode_id: 24, position: [10, 10, 0.2], length: 10, extrusion: 1.3, speed: 30 }
    ].map(move => ({ ...move, height: 0.2, feedrate: move.speed, actual_feedrate: move.speed,
      temp: 210, fan: 100, pa: 0.08,
      flow: area * move.extrusion / move.length * move.speed,
      width: move.role === 2
        ? area * 1.05 ** 2 * move.extrusion / move.length / 0.2
        : area * move.extrusion / move.length / 0.2 + 0.2 * (1 - Math.PI / 4)
    }));

    assert.equal(result.moves.length, expectations.length, `Should have EXACTLY ${expectations.length} extrusion moves matching our fixture`);

    for (let i = 0; i < expectations.length; i++) {
        const expected = expectations[i];
        const actual = result.moves[i];
        
        for (const [axis, position] of expected.position.entries()) {
          assert.ok(Math.abs(actual.position[axis] - position) < 0.001, `Move ${i} position axis ${axis}`);
        }
        assert.equal(actual.role, expected.role, `Move ${i} role expected ${expected.role} got ${actual.role}`);
        assert.equal(actual.gcode_id, expected.gcode_id, `Move ${i} gcode_id expected ${expected.gcode_id} got ${actual.gcode_id}`);
        assert.ok(Math.abs(actual.width - expected.width) < 0.001, `Move ${i} width expected ${expected.width} got ${actual.width}`);
        assert.ok(Math.abs(actual.height - expected.height) < 0.001, `Move ${i} height expected ${expected.height} got ${actual.height}`);
        assert.ok(Math.abs(actual.feedrate - expected.feedrate) < 1.0, `Move ${i} feedrate expected ${expected.feedrate} got ${actual.feedrate}`);
        assert.ok(Math.abs(actual.actual_feedrate - expected.actual_feedrate) < 1.0, `Move ${i} actual_feedrate expected ${expected.actual_feedrate} got ${actual.actual_feedrate}`);
        assert.ok(Math.abs(actual.temperature - expected.temp) < 1.0, `Move ${i} temp expected ${expected.temp} got ${actual.temperature}`);
        assert.ok(Math.abs(actual.fan_speed - expected.fan) < 1.0, `Move ${i} fan expected ${expected.fan} got ${actual.fan_speed}`);
        assert.ok(Math.abs(actual.pressure_advance - expected.pa) < 0.001, `Move ${i} pa expected ${expected.pa} got ${actual.pressure_advance}`);
        assert.ok(Math.abs(actual.volumetric_rate - expected.flow) < 0.001, `Move ${i} flow expected ${expected.flow} got ${actual.volumetric_rate}`);
    }
  });

  test('tracks changing fan, temperature, pressure advance and extrusion modes', async () => {
    const lines = [
      'G21', 'G90', 'M83', 'M104 S200', 'M106 S128', 'M900 K0.03',
      'G1 Z0.2 F3000', '; FEATURE: Inner wall', 'G1 X10 Y10 E0.4 F600',
      'M104 S230', 'M107', 'M900 K0.12', 'G1 X20 E0.6 F1800',
      'G1 X30 F6000', 'G1 X40 E0.8 F1200',
      'M82', 'G92 E0', 'G1 X50 E1 F1500', 'G1 X60 E2',
      'G1 E1 F1200', 'G1 E2'
    ];
    const moves = await page.evaluate(gcode => {
      window.previewModule.FS.writeFile('/states.gcode', new TextEncoder().encode(gcode));
      window.preview.loadGcode('/states.gcode');
      const result = new Map();
      for (let index = 0; index < window.preview.getMovesCount(); index++) {
        const move = JSON.parse(window.preview.getMoveInfo(index));
        if (move.type === 10 && move.volumetric_rate > 0) result.set(move.gcode_id, move);
      }
      return Array.from(result.values());
    }, lines.join('\n') + '\n');
    const expectations = [
      { line: 9, x: 10, e: 0.4, length: Math.sqrt(200), speed: 10, temperature: 200, fan: 128 / 255 * 100, pa: 0.03 },
      { line: 13, x: 20, e: 0.6, speed: 30, temperature: 230, fan: 0, pa: 0.12 },
      { line: 15, x: 40, e: 0.8, speed: 20, temperature: 230, fan: 0, pa: 0.12 },
      { line: 18, x: 50, e: 1, speed: 25, temperature: 230, fan: 0, pa: 0.12 },
      { line: 19, x: 60, e: 1, speed: 25, temperature: 230, fan: 0, pa: 0.12 }
    ];
    assert.equal(moves.length, expectations.length, 'travel, retraction and unretraction are excluded');
    for (const [index, expected] of expectations.entries()) {
      const actual = moves[index];
      const close = (value, target, label) => assert.ok(Math.abs(value - target) < 0.005,
        `move ${index} ${label}: expected ${target}, got ${value}`);
      assert.equal(actual.gcode_id, expected.line);
      assert.equal(actual.role, 1);
      close(actual.position[0], expected.x, 'X');
      close(actual.feedrate, expected.speed, 'speed');
      close(actual.temperature, expected.temperature, 'temperature');
      close(actual.fan_speed, expected.fan, 'fan');
      close(actual.pressure_advance, expected.pa, 'PA');
      close(actual.volumetric_rate, Math.PI * (1.75 / 2) ** 2 * expected.e / (expected.length || 10) * expected.speed, 'flow');
    }
  });

});
