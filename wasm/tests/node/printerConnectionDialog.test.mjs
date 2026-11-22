import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

let client, directory;
const storage = new Map();
const app = {
  vendors: [{ name: 'Prusa' }], printers: [], selectedVendor: 'Prusa', selectedPrinter: 'MK4 profile',
  currentConfig: {}, configDefs: {}, userPresets: [], activeUserPreset: {}, selectedFilaments: [],
  filaments: [], processes: [], isEngineReady: true
};

// A bounded hook adapter: run the actual component functions and their effects, then
// inspect native/control props and invoke the real click closures. No DOM or network.
function renderer(component) {
  const slots = [];
  let cursor, effects, dirty;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === 'function' ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    }
  };
  return () => {
    let tree;
    for (let pass = 0; pass < 12; pass++) {
      cursor = 0; effects = []; dirty = false;
      globalThis.__componentHooks = hooks;
      tree = component();
      for (const effect of effects) effect();
      if (!dirty) return tree;
    }
    assert.fail('component did not settle');
  };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (predicate(tree)) return tree;
  return Object.values(tree.props ?? {}).map(child => find(child, predicate)).find(Boolean);
}
const control = (tree, id) => {
  const element = find(tree, item => item.props?.id === id);
  assert.ok(element, `missing control ${id}`);
  return element.props;
};
const saved = {
  id: 'saved-prusa', name: 'Synthetic MK4', preset: 'MK4 profile', vendor: 'Prusa',
  host_type: 'prusalink', print_host: 'http://printer.invalid:8017/path',
  print_host_webui: 'https://printer.invalid/ui', use_gateway: true,
  local_gateway: 'https://gateway.invalid', printhost_apikey: 'synthetic-key',
  printhost_user: 'synthetic-user', printhost_password: 'synthetic-password',
  cloud_device_id: 'synthetic-device', serial: 'synthetic-serial', cloud_refresh_token: 'synthetic-refresh'
};

before(async () => {
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  globalThis.window = { localStorage: globalThis.localStorage, location: { origin: 'https://app.invalid' } };
  globalThis.__fixtureApp = app;
  globalThis.__fixtureFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('fixture must never use the network');
  const resolveDir = new URL('../../app', import.meta.url).pathname;
  const stubs = {
    appStore: `export const useAppStore = (select = s => s) => select(globalThis.__fixtureApp);
      export const pendingOptionKey = (...parts) => parts.join(':');
      export const minimumFilamentSlots = () => 1;`,
    i18n: `export const translate = key => key;export const useTranslation = () => ({ t: translate });`,
    prefs: `export const usePrefsStore = select => select({display: {sidebarWidth: 280, sidebarSections: {}}});`,
    history: `export const useHistoryStore = select => select({isRestoring: false});`,
    platesStore: `export const usePlatesStore = select => select({activePlateIndex: 0});`,
    wizard: `export const useWizardStore = select => select({addedFilaments: []});`,
    systemProfiles: `export const systemProfiles = async () => [];`,
    printerCatalog: `export const loadPrinterCatalog = async () => {};
      export const usePrinterCatalog = (select = s => s) => select({ vendors: [{name: 'Prusa'}], loading: false, error: false });`,
    gatewayUrl: `export const DEFAULT_LOCAL_GATEWAY = 'http://gateway.invalid';
      export const fetchGatewayStatus = async () => null;
      export const discoverPrinters = () => { throw Error('unexpected discovery'); };
      export const parseHost = value => new URL(value);`
  };
  const inert = {
    FilamentSyncDialog: ['FilamentSyncButton'], ModifiedSettingsDialog: ['ModifiedSettingsDialog'],
    modifiedSettings: ['modifiedSettings'], FlushVolumesDialog: ['FlushVolumesDialog'],
    ObjectListPanel: ['ObjectListPanel'], SavedPrinterSelector: ['SavedPrinterSelector', 'bindDeviceProfile'],
    SettingsPanel: ['SettingsPanel'], exportGcode: ['exportGcode'],
    glyphs: ['EditIcon', 'GearIcon', 'PlugIcon', 'SaveIcon', 'TrashIcon'], Toolbar: ['Toolbar'],
    MobileInput: ['MobileInput'], MobileSelect: ['MobileSelect'], Dialog: ['Dialog'],
    CrealityCloudLogin: ['CrealityCloudLogin'], PrusaConnectLogin: ['PrusaConnectLogin'], SnapmakerCloudLogin: ['SnapmakerCloudLogin'], OctoEverywhereConnection: ['OctoEverywhereConnection'],
    bambuCloud: ['loginBambuCloud', 'fetchBambuCloudSession'], api: ['createPrinterApi']
  };
  for (const [name, exports] of Object.entries(inert))
    stubs[name] = exports.map(name => `export const ${name} = () => null;`).join('\n');
  const result = await build({ stdin: { contents: `export { PrepareSidebar } from './src/shell/PrepareSidebar';
    export { PrinterConnectionDialog } from './src/printers/PrinterConnectionDialog';
    export { usePrinterConnectionStore } from './src/printers/connectionStore';`, resolveDir },
    bundle: true, platform: 'node', format: 'esm', write: false, tsconfigRaw: { compilerOptions: { jsx: 'react' } },
    plugins: [{ name: 'bounded-component-hooks', setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'fixture' }));
      build.onResolve({ filter: /\// }, args => {
        const name = args.path.split('/').at(-1);
        if (name in stubs) return { path: name, namespace: 'fixture' };
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'react'
        ? `import React from ${JSON.stringify(join(resolveDir, 'node_modules/react/index.js'))};
           const adapter = { ...React, useCallback: fn => fn,
             useDebugValue: () => {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
           export default adapter;
           export const useState = (...args) => globalThis.__componentHooks.useState(...args);
           export const useEffect = (...args) => globalThis.__componentHooks.useEffect(...args);
           export const useRef = (...args) => globalThis.__componentHooks.useRef(...args);
           export const useDebugValue = () => {};
           export const useSyncExternalStore = (_subscribe, snapshot) => snapshot();`
        : stubs[args.path], resolveDir }));
    } }], banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(new URL('../../app/package.json', import.meta.url).href)});` } });
  directory = await mkdtemp(join(tmpdir(), 'orca-printer-settings-'));
  const file = join(directory, 'client.mjs');
  await writeFile(file, result.outputFiles[0].text);
  client = await import(pathToFileURL(file).href);
});
after(async () => {
  globalThis.fetch = globalThis.__fixtureFetch;
  for (const key of ['localStorage', 'window', '__fixtureApp', '__fixtureFetch', '__componentHooks']) delete globalThis[key];
  if (directory) await rm(directory, { recursive: true, force: true });
});
beforeEach(() => {
  storage.clear();
  app.selectedPrinter = saved.preset;
  client.usePrinterConnectionStore.setState({ printers: [saved], selectedPrinterId: saved.id,
    status: 'online', dialogOpen: false, editingId: null, prusaSessions: [] });
});

function clickConnection() {
  const tree = renderer(client.PrepareSidebar)();
  const button = control(tree, 'printer-connection-btn');
  const status = client.usePrinterConnectionStore.getState().status;
  assert.equal(find(button.children, item => item.props?.className === 'status-dot')?.props['data-status'],
    status === 'none' ? undefined : status);
  button.onClick();
}
function assertSavedDraft(tree, expected = saved) {
  assert.equal(client.usePrinterConnectionStore.getState().editingId, expected.id);
  for (const [id, value] of Object.entries({ 'pc-name': expected.name, 'pc-preset': expected.preset,
    'pc-brand': expected.vendor, 'pc-host-type': expected.host_type, 'pc-host': expected.print_host,
    'pc-webui': expected.print_host_webui, 'pc-apikey': expected.printhost_apikey,
    'pc-user': expected.printhost_user, 'pc-password': expected.printhost_password })) assert.equal(control(tree, id).value, value, id);
  assert.equal(find(tree, item => item.props?.id === 'pc-local-gateway'), undefined);
  assert.equal(find(tree, item => item.props?.id === 'pc-local-gateway-url'), undefined);
  assert.equal(find(tree, item => item.props?.id === 'pc-discover'), undefined);
}

test('green sidebar connection settings opens saved non-Klipper host and survives close/reload', async () => {
  const dialog = renderer(client.PrinterConnectionDialog);
  dialog();
  clickConnection();
  const tree = dialog();
  // Exact user symptom first: saved PrusaLink must not become blank Klipper.
  assert.equal(control(tree, 'pc-host-type').value, saved.host_type);
  assertSavedDraft(tree);
  control(tree, 'pc-cancel').onClick();
  dialog();
  clickConnection();
  assertSavedDraft(dialog());
  const persisted = storage.get('orca-printers');
  client.usePrinterConnectionStore.setState({ printers: [], selectedPrinterId: null, dialogOpen: false });
  storage.set('orca-printers', persisted);
  await client.usePrinterConnectionStore.persist.rehydrate();
  dialog();
  clickConnection();
  const restored = dialog();
  assertSavedDraft(restored);
  control(restored, 'pc-save').onClick();
  const { local_gateway, ...retained } = saved;
  assert.deepEqual(client.usePrinterConnectionStore.getState().printers, [retained], 'all saved device/credential fields retained after transport migration');
});

test('sidebar edits the selected status device when a different saved printer matches the slicer preset', () => {
  const other = { ...saved, id: 'other', name: 'Other printer', print_host: 'http://other.invalid', preset: 'Other profile' };
  client.usePrinterConnectionStore.setState({ printers: [other, saved] });
  app.selectedPrinter = other.preset;
  clickConnection();
  assertSavedDraft(renderer(client.PrinterConnectionDialog)());
  const tree = renderer(client.PrinterConnectionDialog)();
  const otherButton = find(tree, item => item.type === 'button' && item.props.onClick && item.props.children === other.name);
  assert.ok(otherButton, 'explicit saved printer selector');
  otherButton.props.onClick();
  assertSavedDraft(renderer(client.PrinterConnectionDialog)(), other);
});

test('explicit Add stays blank and no selected saved connection opens Add', () => {
  const dialog = renderer(client.PrinterConnectionDialog);
  clickConnection();
  control(dialog(), 'pc-add').onClick();
  let tree = dialog();
  assert.equal(client.usePrinterConnectionStore.getState().editingId, null);
  assert.equal(control(tree, 'pc-host').value, '');
  assert.equal(control(tree, 'pc-name').value, '');
  client.usePrinterConnectionStore.setState({ printers: [], selectedPrinterId: null, status: 'none', dialogOpen: false });
  dialog();
  clickConnection();
  tree = dialog();
  assert.equal(control(tree, 'pc-host').value, '');
  assert.equal(control(tree, 'pc-host-type').value, 'moonraker');
});

test('add steps validate, preserve provider fields, reset on reopen and save the final draft', () => {
  globalThis.requestAnimationFrame = () => {};
  const store = client.usePrinterConnectionStore;
  store.getState().openDialog(null);
  const dialog = renderer(client.PrinterConnectionDialog);
  let tree = dialog();
  assert.equal(find(tree, item => item.props?.className === 'printer-connection-list'), undefined);
  assert.equal(find(tree, item => item.props?.id === 'pc-validation'), undefined);
  control(tree, 'pc-next').onClick();
  tree = dialog();
  assert.equal(control(tree, 'pc-connection-step').hidden, true);
  assert.ok(control(tree, 'pc-validation'));
  control(tree, 'pc-name').onChange({ target: { value: 'Synthetic steps' } });
  tree = dialog();
  control(tree, 'pc-host-type').onValueChange('prusalink');
  tree = dialog();
  control(tree, 'pc-next').onClick();
  tree = dialog();
  assert.equal(control(tree, 'pc-save').disabled, true);
  assert.ok(control(tree, 'pc-validation'));
  for (const [id, value] of Object.entries({ 'pc-host': 'https://steps.invalid', 'pc-user': 'synthetic-user', 'pc-password': 'synthetic-password', 'pc-apikey': 'synthetic-key' })) {
    control(tree, id).onChange({ target: { value } }); tree = dialog();
  }
  assert.equal(find(tree, item => item.props?.id === 'pc-validation'), undefined);
  assert.equal(control(tree, 'pc-save').disabled, false);
  control(tree, 'pc-back').onClick(); tree = dialog();
  assert.equal(control(tree, 'pc-name').value, 'Synthetic steps');
  control(tree, 'pc-next').onClick(); tree = dialog();
  assert.equal(control(tree, 'pc-password').value, 'synthetic-password');
  control(tree, 'pc-save').onClick(); dialog();
  const added = store.getState().printers.find(p => p.name === 'Synthetic steps');
  assert.equal(added.printhost_password, 'synthetic-password');
  assert.equal(added.printhost_user, 'synthetic-user');
  assert.equal(added.printhost_apikey, 'synthetic-key');
  assert.equal(added.preset, saved.preset);
  store.getState().openDialog(null); tree = dialog();
  control(tree, 'pc-name').onChange({ target: { value: 'Discard me' } }); tree = dialog();
  control(tree, 'pc-cancel').onClick(); dialog();
  store.getState().openDialog(null); tree = dialog();
  assert.equal(control(tree, 'pc-name').value, '');
  assert.equal(control(tree, 'pc-connection-step').hidden, true);
  assert.equal(find(tree, item => item.props?.id === 'pc-validation'), undefined);
  delete globalThis.requestAnimationFrame;
});
