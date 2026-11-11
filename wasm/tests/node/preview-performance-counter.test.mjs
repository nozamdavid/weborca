import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../../app/node_modules/typescript/lib/typescript.js';

test('performance observes completed draws, bounds publications and cleans up without rendering', async () => {
  const keys = ['performance', 'document', 'window', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', '__fpsRenderer', '__fpsModule'];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  let now = 0, nextId = 0, draws = 0, fail = false, cpuMs = 0.4;
  const timers = new Map(), frames = new Map();
  const renderer = { render() { if (fail) throw new Error('failed draw'); draws++; now += cpuMs; },
    setLightTheme() {}, clearGcode() {}, delete() {}, init: () => true, resize() {}, setLightingEnabled() {} };
  const globals = {
    performance: { now: () => now }, document: { documentElement: { dataset: {} } }, window: {},
    setTimeout: (callback, delay) => { timers.set(++nextId, { callback, at: now + delay }); return nextId; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => frames.delete(id), __fpsRenderer: renderer,
    __fpsModule: { OrcaPreview: function () { return renderer; } },
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const advance = duration => {
    const target = now + duration;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > target) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].callback();
    }
    now = target;
  };
  try {
    const source = fs.readFileSync(new URL('../../app/src/preview/orcaPreviewModule.ts', import.meta.url), 'utf8')
      .replace("import { preparePreview, cancelPreviewWorker } from './previewWorkerClient';", "const cancelPreviewWorker = () => {}; const preparePreview = async bytes => ({ packet: bytes.slice(), stats: { layers: 1, moves: 2 } });")
  .replace('let previewInstance: any = null;', 'let previewInstance: any = globalThis.__fpsRenderer;')
      .replace('let previewModule: any = null;', 'let previewModule: any = globalThis.__fpsModule;');
    const js = ts.transpile(source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
    mod.render();
    assert.equal(timers.size, 0, 'default-off performs no observation work');
    const samples = [];
    let unsubscribe = mod.subscribePerformance(sample => samples.push(sample));
    assert.deepEqual(samples.at(-1), { idle: true, fps: null, cpuMs: null });
    fail = true;
    assert.throws(() => mod.render(), /failed draw/);
    assert.equal(samples.length, 1, 'a failed draw is not counted');
    fail = false;
    for (let i = 0; i < 100; i++) mod.requestRender();
    assert.equal(samples.length, 1, 'queued requests are not draws');
    assert.equal(frames.size, 1);
    const callback = [...frames.values()][0]; frames.clear(); callback();
    assert.equal(samples.at(-1).fps, null, 'one completed draw cannot estimate cadence');
    assert.ok(Math.abs(samples.at(-1).cpuMs - 0.4) < 0.001);
    assert.equal(timers.size, 1);
    for (let i = 0; i < 180; i++) { advance(1000 / 60 - 0.4); mod.render(); }
    assert.equal(draws, 182, 'observation adds no renders');
    assert.ok(samples.length >= 4 && samples.length <= 5, 'only about one publication per active second');
    assert.ok(Math.abs(samples.at(-1).fps - 60) < 0.1);
    const activeCount = samples.length;
    advance(1201);
    assert.equal(samples.length, activeCount + 1);
    assert.equal(samples.at(-1).idle, true);
    assert.equal(timers.size, 0, 'idle has no recurring polling');
    advance(10000);
    assert.equal(samples.length, activeCount + 1);
    mod.render();
    assert.equal(samples.at(-1).fps, null, 'an idle gap resets cadence');
    for (let i = 0; i < 4; i++) { advance(1100); mod.render(); }
    assert.equal(samples.at(-1).fps, null, 'sparse draws never reuse the previous 60 FPS burst');
    for (let i = 0; i < 4; i++) { advance(400 - 0.4); mod.render(); }
    assert.ok(Math.abs(samples.at(-1).fps - 2.5) < 0.01, 'steady slow draws still report their measured cadence');
    advance(1100);
    cpuMs = 4;
    mod.render();
    advance(1201);
    assert.equal(samples.at(-1).cpuMs, 4, 'Idle includes the final short burst, even before another active publication');
    cpuMs = 0.4;
    unsubscribe();
    assert.equal(timers.size, 0);
    const disabledCount = samples.length;
    mod.render(); advance(2000);
    assert.equal(samples.length, disabledCount, 'disabled / hidden / unmounted observer receives nothing');
    unsubscribe = mod.subscribePerformance(sample => samples.push(sample));
    assert.deepEqual(samples.at(-1), { idle: true, fps: null, cpuMs: null });
    mod.render();
    mod.clearGcode();
    assert.equal(timers.size, 0);
    assert.equal(samples.at(-1).idle, true);
    mod.render();
    await mod.initPreview({ id: 'canvas', width: 400, height: 300 });
    assert.equal(timers.size, 0, 'reinitialization clears the old timer and burst');
    assert.equal(samples.at(-1).cpuMs, null);
    mod.render();
    const beforeDispose = draws;
    mod.disposePreview();
    assert.equal(timers.size, 0);
    assert.equal(frames.size, 0);
    assert.equal(samples.at(-1).idle, true);
    mod.render();
    assert.equal(draws, beforeDispose, 'a missing native instance contributes no completed draw');
    unsubscribe();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
