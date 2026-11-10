import test from 'node:test';
import assert from 'node:assert/strict';
import { attachHtmlPlateTitle } from '../../app/src/plate/htmlPlateTitle.ts';
import { plateTitle } from '../../app/src/plates/plateName.ts';

function setup({ supported = true, throws = false } = {}) {
  const events = new Map();
  const calls = [];
  const ctx = { measureText: text => ({ width: text.length * 18 }), clearRect() {}, drawImage() {}, drawElementImage(...args) {
    calls.push(args); if (throws) throw Error('unsupported draw');
  } };
  const canvas = { style: {}, width: 0, height: 0, setAttribute(k,v) { if (supported && k === 'content') this.content = v; },
    children: [], getContext: () => ctx, append(el) { this.child ??= el; this.children.push(el); this.lastElementChild = el; }, addEventListener(k,fn) { events.set(k,fn); },
    removeEventListener(k) { events.delete(k); }, remove() { this.removed = true; }, requestPaint() { this.requested = true; } };
  globalThis.document = { createElement(tag) { return tag === 'canvas' ? canvas : { style: {}, setAttribute() {} }; }, body: { append(el) { el.connected = true; } } };
  const fallback = { width: 240, height: 90 };
  const published = [];
  const attach = (status) => attachHtmlPlateTitle(fallback, '<Plate>', 'bold 64px sans-serif', 'orange', 140, image => published.push(image), status);
  return { canvas, events, calls, fallback, published, attach };
}

test('automatic enable does not read the URL', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, get() { throw Error('URL must not be read'); } });
  try {
    const f = setup(); const dispose = f.attach();
    assert.equal(f.canvas.connected, true); assert.equal(f.canvas.requested, true);
    dispose();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else delete globalThis.location;
  }
});
test('each unsupported API gate retains legacy canvas', () => {
  const f = setup({ supported: false }); f.attach()(); assert.equal(f.canvas.connected, undefined);
  const g = setup(); g.canvas.requestPaint = undefined; g.attach()(); assert.equal(g.canvas.connected, undefined);
  const h = setup(); h.canvas.getContext().drawElementImage = undefined; h.attach()(); assert.equal(h.canvas.connected, undefined);
  const i = setup(); i.canvas.getContext = () => null; i.attach()(); assert.equal(i.canvas.connected, undefined);
});
test('badge uses passed active state and safe localized text within extended canvas', () => {
  for (const active of [true, false]) {
    const f = setup();
    const dispose = f.attach({ active, activeLabel: '<Activo>', inactiveLabel: '<Inactivo>' });
    const badge = f.canvas.lastElementChild;
    assert.equal(badge.textContent, active ? '<Activo>' : '<Inactivo>');
    assert.equal(badge.innerHTML, undefined);
    assert.equal(f.canvas.child.textContent, '<Plate>');
    assert.equal(f.canvas.style.left, '0'); assert.equal(f.canvas.style.top, '0');
    assert.equal(f.canvas.style.opacity, '0');
    assert.ok(parseFloat(badge.style.left) + parseFloat(badge.style.width) <= f.canvas.width);
    assert.ok(parseFloat(badge.style.top) + 48 <= f.canvas.height);
    assert.equal(f.published.length, 0);
    f.events.get('paint')(); assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[1].slice(1), [256, 21, { preserveElementGeometry: true }]);
    assert.equal(f.published[0], f.canvas);
    dispose(); assert.equal(f.canvas.removed, true); assert.equal(f.events.size, 0);
  }
});
test('extended layout falls back and disposes if badge drawing fails', () => {
  const f = setup();
  f.attach({ active: false, activeLabel: 'Active', inactiveLabel: 'Inactive' });
  f.canvas.getContext().drawElementImage = el => { if (el === f.canvas.lastElementChild) throw Error('badge draw'); };
  f.events.get('paint')();
  assert.deepEqual(f.published, [f.fallback]);
  assert.equal(f.fallback.width, 240);
  assert.equal(f.canvas.removed, true); assert.equal(f.events.size, 0);
});
test('connected source paints only on paint, preserves geometry, and disposes', () => {
  const f = setup(); const dispose = f.attach();
  assert.equal(f.canvas.connected, true); assert.equal(f.canvas.requested, true);
  assert.equal(f.published.length, 0); assert.equal(f.canvas.child.textContent, '<Plate>');
  f.events.get('paint')(); assert.equal(f.published[0], f.canvas);
  assert.deepEqual(f.calls[0].slice(1), [8, 0, { preserveElementGeometry: true }]);
  dispose(); assert.equal(f.canvas.removed, true); assert.equal(f.events.size, 0);
});
test('first or later throwing paint restores legacy and stops', () => {
  const f = setup({ throws: true }); f.attach(); f.events.get('paint')();
  assert.equal(f.published[0], f.fallback); assert.equal(f.canvas.removed, true); assert.equal(f.events.size, 0);
  const g = setup(); g.attach(); g.events.get('paint')();
  g.canvas.getContext().drawElementImage = () => { throw Error('later failure'); };
  g.events.get('paint')(); assert.deepEqual(g.published, [g.canvas, g.fallback]);
});
test('title naming preserves custom text and numbered unnamed plates', () => {
  assert.equal(plateTitle('  Custom plate  ', 1), 'Custom plate');
  assert.equal(plateTitle('', 0), 'Plate 1');
  assert.equal(plateTitle(undefined, 2), 'Plate 3');
});
