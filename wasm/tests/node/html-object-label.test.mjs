import test from 'node:test';
import assert from 'node:assert/strict';
import { attachHtmlObjectLabel } from '../../app/src/plate/htmlObjectLabel.ts';

function setup() {
  const events = new Map();
  const calls = [];
  const ctx = { clearRect() {}, drawElementImage(...args) { calls.push(args); } };
  const canvas = { style: {}, setAttribute(k, v) { if (k === 'content') this.content = v; },
    getContext: () => ctx, append(el) { this.firstElementChild = el; },
    addEventListener(k, fn) { events.set(k, fn); }, removeEventListener(k) { events.delete(k); },
    remove() { this.removes = (this.removes ?? 0) + 1; }, requestPaint() { this.requests = (this.requests ?? 0) + 1; } };
  globalThis.document = { createElement: tag => tag === 'canvas' ? canvas : { style: {}, setAttribute() {} },
    body: { append(el) { el.connected = true; } } };
  const fallback = { width: 256, height: 64 };
  const published = [];
  const text = '<img> 日本語\nالعربية 😀'.repeat(30);
  return { canvas, ctx, events, calls, published, fallback, text,
    attach: () => attachHtmlObjectLabel(fallback, text, image => published.push(image)) };
}

test('automatic capability gate requires every API and never reads URL', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, get() { throw Error('URL read'); } });
  try {
    for (const missing of ['content', 'requestPaint', 'drawElementImage', 'context']) {
      const f = setup();
      if (missing === 'content') f.canvas.setAttribute = () => {};
      if (missing === 'requestPaint') f.canvas.requestPaint = undefined;
      if (missing === 'drawElementImage') f.ctx.drawElementImage = undefined;
      if (missing === 'context') f.canvas.getContext = () => null;
      f.attach()(); assert.equal(f.canvas.connected, undefined); assert.deepEqual(f.published, []);
    }
    const f = setup(); f.attach()(); assert.equal(f.canvas.connected, true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor); else delete globalThis.location;
  }
});
test('safe full text, CSS bounds, explicit raster destination and event-only publication', () => {
  const f = setup(); const dispose = f.attach();
  const label = f.canvas.firstElementChild;
  assert.equal(label.textContent, f.text); assert.equal(label.innerHTML, undefined);
  assert.equal(label.style.width, '240px'); assert.equal(label.style.height, '48px');
  assert.equal(label.style.overflow, 'hidden'); assert.equal(label.style.textOverflow, 'ellipsis');
  assert.equal(label.style.whiteSpace, 'nowrap');
  assert.equal(f.canvas.style.left, '0'); assert.equal(f.canvas.style.top, '0');
  assert.equal(f.canvas.style.opacity, '0'); assert.equal(f.canvas.style.pointerEvents, 'none');
  assert.equal(f.canvas.width, 256); assert.equal(f.canvas.height, 64);
  assert.deepEqual(f.published, []);
  const paint = f.events.get('paint'); paint(); paint();
  assert.deepEqual(f.calls[0].slice(1), [8, 8, { preserveElementGeometry: true }]);
  assert.deepEqual(f.published, [f.canvas, f.canvas]); assert.equal(f.canvas.requests, 1);
  dispose(); dispose(); paint();
  assert.equal(f.canvas.removes, 1); assert.equal(f.events.size, 0); assert.equal(f.published.length, 2);
});
test('first and later paint errors restore fallback and stop source lifetime', () => {
  for (const later of [false, true]) {
    const f = setup(); f.attach();
    if (later) f.events.get('paint')();
    f.ctx.drawElementImage = () => { throw Error('paint failed'); };
    f.events.get('paint')();
    assert.equal(f.published.at(-1), f.fallback); assert.equal(f.events.size, 0); assert.equal(f.canvas.removes, 1);
  }
});
test('request failure retains fallback and cleans up', () => {
  const f = setup(); f.canvas.requestPaint = () => { throw Error('request failed'); };
  f.attach()(); assert.deepEqual(f.published, [f.fallback]); assert.equal(f.canvas.removes, 1);
});
