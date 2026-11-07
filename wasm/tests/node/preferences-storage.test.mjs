import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

test('denied storage getter allows preference defaults and in-memory edits', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.defineProperty({}, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }) });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  const result = await build({ entryPoints: ['wasm/app/src/prefs/prefsStore.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
  const { usePrefsStore } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  assert.equal(usePrefsStore.getState().display.theme, 'dark');
  usePrefsStore.getState().setDisplayPref('theme', 'light');
  assert.equal(usePrefsStore.getState().display.theme, 'light');
  assert.equal(warnings.length, 2);
});
