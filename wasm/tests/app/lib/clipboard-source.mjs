// Run the actual PlateView handler/container and store clipboard actions with a native snapshot double.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from '../../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

export async function clipboardSourceTest() {
  const view = readFileSync(new URL('../../../app/src/plate/PlateView.tsx', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../../../app/src/plate/plateStore.ts', import.meta.url), 'utf8');
  const compile = async text => (await transform(text, { loader: 'tsx' })).code;
  const handler = await compile(`const handler = ${view.split('const handleKeyDown = useCallback(')[1].split(',\n    [objects,')[0].trim()};`);
  const container = await compile(`const container = (${view.match(/<div\s+id="plate-canvas-container"[\s\S]*?\/>/)[0]});`);
  const actions = await compile(`const actions = {${store.split('  copySelected: async')[1].split('  mirrorSelected:')[0].replace(/^/, 'copySelected: async')}};`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<input id="text" value="native text"><button id="tree">Object</button><button id="toolbar">View</button>');
    await page.evaluate(({ handler, container, actions }) => {
      const object = { id: 1, name: 'original', geometry: [1, 2, 3], instances: [{ id: 2, offset: [0, 0, 0] }] };
      const state = { objects: [object], selectedObjectId: 1, selectedInstanceId: 2, extraSelection: [], clipboard: [], refreshObjects: async () => state.objects };
      const app = { isEngineReady: true };
      const flags = {};
      let nativeSnapshot, commits = 0, calls = 0;
      const containerRef = { current: null };
      const store = { getState: () => state };
      const engine = { call: async (op, args) => {
        calls++;
        if (op === 'copySelection') { nativeSnapshot = structuredClone(state.objects[0]); if (args.cut) state.objects = []; }
        if (op === 'pasteSelection') { const copy = structuredClone(nativeSnapshot); copy.id = 10 + state.objects.length; state.objects.push(copy); return { objectIds: [copy.id] }; }
      } };
      const history = { getState: () => ({ commitTransaction: async () => { commits++; }, ...flags }) };
      const env = { usePlateStore: store, useAppStore: { getState: () => app }, useHistoryStore: history,
        usePlatesStore: { getState: () => ({ plates: [{ origin: [0, 0, 0] }], activePlateIndex: 0 }) },
        useEditOpsStore: { getState: () => flags }, useObjectListStore: { getState: () => flags },
        usePaintToolsStore: { getState: () => flags }, useTextStore: { getState: () => flags }, useLayersStore: { getState: () => flags },
        useCutStore: { getState: () => flags }, useRepairStore: { getState: () => flags }, containerRef,
        getEngine: async () => engine, get: () => state, set: patch => Object.assign(state, patch), PASTE_OFFSET_MM: 20,
        isPaintingActive: false, isOperatingEdit: false, isCutting: false, isRepairing: false,
        undo: () => { flags.undos = (flags.undos ?? 0) + 1; }, redo: () => {},
        bedConfig: {}, React: { createElement: (tag, props) => {
          const el = document.createElement(tag); el.id = props.id; props.ref.current = el;
          if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
          if (props.onPointerDownCapture) el.addEventListener('pointerdown', e => props.onPointerDownCapture(e), true);
          const canvas = document.createElement('canvas');
          canvas.addEventListener('pointerdown', e => e.preventDefault()); el.append(canvas); document.body.append(el); return el;
        } } };
      const evaluate = code => Function('env', `with(env) { ${code} }`)(env);
      // Keep clipboardWork in the same lexical scope as both real store actions.
      Object.assign(state, Function('env', `with(env) { let clipboardWork = Promise.resolve(); ${actions}; return actions; }`)(env));
      evaluate(container);
      window.addEventListener('keydown', evaluate(`${handler}; return handler;`));
      window.addEventListener('keydown', e => { window.test.prevented = e.defaultPrevented; window.test.trusted = e.isTrusted; });
      window.test = { state, app, flags, containerRef, stats: () => ({ commits, calls }), original: structuredClone(object) };
    }, { handler, container, actions });
    // Seed the browser clipboard with test text before any paste reads it.
    await page.focus('#text');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await page.evaluate(() => {
      const text = document.createElement('p');
      text.id = 'webpage-text';
      text.style.whiteSpace = 'pre';
      text.textContent = 'WebOrca selected webpage copy regression';
      document.body.append(text);
    });
    for (const selectedObject of [true, false]) for (const modifier of ['Control', 'Meta']) for (const key of ['c', 'C']) for (const text of ['WebOrca selected webpage copy regression', '   ']) {
      await page.focus('#toolbar');
      await page.evaluate(({ selectedObject, text }) => {
        test.state.objects = [structuredClone(test.original)];
        test.state.selectedObjectId = selectedObject ? 1 : null;
        test.state.selectedInstanceId = selectedObject ? 2 : null;
        const el = document.getElementById('webpage-text');
        el.textContent = text;
        const range = document.createRange();
        range.selectNodeContents(el);
        document.getSelection().removeAllRanges();
        document.getSelection().addRange(range);
      }, { selectedObject, text });
      assert.equal(await page.evaluate(() => document.getSelection().toString()), text, 'fixture selects rendered non-editable text, including whitespace');
      const before = await page.evaluate(() => ({ objects: structuredClone(test.state.objects), clipboard: structuredClone(test.state.clipboard), ...test.stats() }));
      // Uppercase without Shift exercises the handler's explicit 'C' branch.
      if (key === 'C') await page.evaluate(modifier => {
        document.getElementById('toolbar').dispatchEvent(new KeyboardEvent('keydown', { key: 'C', ctrlKey: modifier === 'Control', metaKey: modifier === 'Meta', bubbles: true, cancelable: true }));
      }, modifier);
      else await page.keyboard.press(`${modifier}+c`);
      assert.equal(await page.evaluate(() => test.prevented), false, `${modifier}+${key}, object=${selectedObject}, text=${JSON.stringify(text)} preserves native text copy`);
      assert.deepEqual(await page.evaluate(() => ({ objects: test.state.objects, clipboard: test.state.clipboard, ...test.stats() })), before, 'selected webpage text leaves object clipboard, engine and history untouched');
      if (modifier === 'Control' && key === 'c' && text.trim()) {
        assert.equal(await page.evaluate(() => test.trusted), true, 'native copy uses a trusted Chromium key event');
        await page.focus('#text');
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Control+v');
        assert.equal(await page.inputValue('#text'), text, 'trusted Chromium Control+C copies selected non-editable text into native paste');
      }
    }
    for (const selection of ['cleared', 'collapsed']) for (const modifier of ['Control', 'Meta']) for (const key of ['c', 'C']) {
      await page.focus('#toolbar');
      await page.evaluate(selection => {
        test.state.objects = [structuredClone(test.original)];
        test.state.selectedObjectId = 1;
        test.state.selectedInstanceId = 2;
        test.state.clipboard = [];
        const selected = document.getSelection();
        selected.removeAllRanges();
        if (selection === 'collapsed') {
          const range = document.createRange();
          range.selectNodeContents(document.getElementById('webpage-text'));
          range.collapse(true);
          selected.addRange(range);
        }
      }, selection);
      const before = await page.evaluate(() => ({ ...test.stats(), objects: structuredClone(test.state.objects) }));
      await page.evaluate(({ modifier, key }) => {
        document.getElementById('toolbar').dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: modifier === 'Control', metaKey: modifier === 'Meta', bubbles: true, cancelable: true }));
      }, { modifier, key });
      assert.equal(await page.evaluate(() => test.prevented), true, `${selection} selection restores object copy default prevention`);
      assert.equal(await page.evaluate(() => test.state.clipboard.length), 1, 'object snapshot is captured');
      assert.deepEqual(await page.evaluate(() => ({ ...test.stats(), objects: test.state.objects })), { ...before, calls: before.calls + 1 }, 'object copy makes exactly one engine call and preserves objects/history');
      await page.evaluate(() => { test.state.objects[0].geometry[0] = 99; });
      await page.keyboard.press(`${modifier}+v`);
      assert.deepEqual(await page.evaluate(() => test.state.objects[1].geometry), [1, 2, 3], 'restored paste uses the exact independent snapshot');
      assert.deepEqual(await page.evaluate(() => test.stats()), { calls: before.calls + 2, commits: before.commits + 1 }, 'restored copy/paste makes exactly two engine calls and one history commit');
    }
    console.log('PASS webpage text priority: real DOM Selection, object/no object, Control/Meta, c/C, whitespace, cleared/collapsed object copy/paste; trusted Chromium Control+C native paste');
    for (const focus of ['viewer', 'tree', 'toolbar']) for (const modifier of ['Control', 'Meta']) {
      await page.evaluate(() => { test.state.clipboard = []; test.state.objects = [structuredClone(test.original)]; test.state.selectedObjectId = 1; test.state.selectedInstanceId = 2; });
      await page.focus('#text');
      if (focus === 'viewer') await page.click('canvas'); else await page.click(`#${focus}`);
      const before = await page.evaluate(() => ({ objects: structuredClone(test.state.objects), commits: test.stats().commits }));
      await page.keyboard.press(`${modifier}+c`);
      assert.equal(await page.evaluate(() => test.state.clipboard.length), 1, `${modifier}+C after ${focus} selection/focus captures model`);
      assert.deepEqual(await page.evaluate(() => ({ objects: test.state.objects, commits: test.stats().commits })), before, 'copy preserves model and history');
      await page.evaluate(() => { test.state.objects[0].geometry[0] = 99; });
      await page.keyboard.press(`${modifier}+v`);
      assert.deepEqual(await page.evaluate(() => test.state.objects[1].geometry), [1, 2, 3], 'paste uses independent original snapshot');
    }
    for (const target of ['input', 'textarea', '[contenteditable]']) {
      await page.evaluate(target => { if (target !== 'input') { const el = document.createElement(target === 'textarea' ? 'textarea' : 'div'); el.contentEditable = 'true'; document.body.append(el); } }, target);
      await page.focus(target);
      const before = await page.evaluate(() => test.stats());
      for (const key of ['Control+c', 'Meta+c', 'Control+x', 'Control+v']) await page.keyboard.press(key);
      assert.deepEqual(await page.evaluate(() => test.stats()), before, 'native editable clipboard is untouched');
      assert.equal(await page.evaluate(() => test.prevented), false, 'native editable shortcut default remains available');
    }
    await page.focus('#toolbar');
    await page.keyboard.press('Control+x');
    assert.equal(await page.evaluate(() => test.state.objects.length), 0, 'cut still removes the source');
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Control+v');
    assert.equal(await page.evaluate(() => test.state.objects.length), 2, 'cut snapshot permits repeated paste');
    await page.evaluate(() => { test.state.duplicateSelected = async () => { test.flags.duplicates = 1; }; });
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => test.flags.duplicates), 1, 'duplicate shortcut still routes');
    assert.equal(await page.evaluate(() => test.flags.undos), 1, 'undo shortcut still routes');
    await page.focus('#toolbar');
    for (const block of ['modal', 'hidden', 'isSlicing', 'isModelLoading', 'isSelectingPreset', 'isLoading', 'isOperating']) {
      await page.evaluate(block => {
        if (block === 'modal') { const el = document.createElement('div'); el.id = 'modal'; el.setAttribute('role', 'dialog'); document.body.append(el); }
        else if (block === 'hidden') test.containerRef.current.hidden = true;
        else { test.app[block] = true; test.flags[block] = true; }
      }, block);
      const before = await page.evaluate(() => test.stats());
      for (const key of ['Control+c', 'Meta+c', 'Control+x', 'Control+v']) await page.keyboard.press(key);
      assert.deepEqual(await page.evaluate(() => test.stats()), before, `clipboard ignored while ${block}`);
      await page.evaluate(block => { document.getElementById('modal')?.remove(); test.containerRef.current.hidden = false; delete test.app[block]; delete test.flags[block]; }, block);
    }
    console.log('PASS actual-source clipboard: Ctrl/Cmd snapshot + paste, viewer/tree/toolbar focus, editable text, modal/hidden/busy guards');
  } finally { await browser.close(); }
}
