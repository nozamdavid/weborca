/** Project downloads own temporary VFS files; persistent sources/history remain intact. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = Number(process.env.PORT || 5318);
const cube = fs.readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');

async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    // Read-only worker instrumentation observes the real MEMFS behind public app actions.
    await page.route('**/engine-worker.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      await route.fulfill({ response, body: source + `
const originalHandler = self.onmessage;
self.onmessage = event => {
  if (event.data?.method === '__testFsInventory') {
    const files = [];
    const visit = dir => {
      for (const name of core.FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const path = dir + '/' + name, stat = core.FS.stat(path);
        if (core.FS.isDir(stat.mode)) visit(path);
        else if (core.FS.isFile(stat.mode)) files.push({ path, size: stat.size, capacity: core.FS.lookupPath(path).node.contents?.byteLength || 0 });
      }
    };
    for (const dir of ['/models', '/out']) visit(dir);
    postMessage({ id: event.data.id, ok: true, result: files });
    return;
  }
  return originalHandler(event);
};` });
    });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async text => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      window.__prefsStore.getState().setGeneralPref('autoArrangeOnImport', false);
      window.__prefsStore.getState().setGeneralPref('rememberRecentFiles', true);
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
      await window.__appStore.getState().importModelFile(new File([text], 'source-cube.obj'));
      await window.__orcaEngine.writeFile('/out/autosave.3mf', new Uint8Array([17, 18, 19]));
    }, cube);
    const inventory = () => page.evaluate(() => window.__orcaEngine._call('__testFsInventory', {}));
    const originalFiles = await inventory();
    const history = originalFiles.find(file => file.path === '/out/undo_slot_0.3mf');
    assert.ok(history?.size > 0);
    const originalHistory = await page.evaluate(async () => Array.from(await window.__orcaEngine.readFile('/out/undo_slot_0.3mf')));
    const downloads = [];
    page.on('download', download => downloads.push(download));

    for (const name of ['project-download.3mf', 'autosave.3mf', 'undo_slot_0.3mf']) {
      const downloadPromise = page.waitForEvent('download');
      const returned = await page.evaluate(async name => Array.from(await window.__appStore.getState().saveProjectFile(name)), name);
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), name);
      assert.deepEqual(fs.readFileSync(await download.path()), Buffer.from(returned));
      assert.equal(Buffer.from(returned).subarray(0, 2).toString(), 'PK');
      const files = await inventory();
      if (!originalFiles.some(file => file.path === '/out/' + name))
        assert.ok(!files.find(file => file.path === '/out/' + name)?.capacity, 'consumed named export does not retain backing storage');
      const staging = files.filter(file => file.path.startsWith('/out/web_project_export_'));
      assert.ok(staging.length > 0, 'project downloads use private staging, independent of their display names');
      assert.ok(staging.every(file => file.size === 0 && file.capacity === 0), 'consumed export storage is released');
      assert.equal(files.find(file => file.path === '/models/source-cube.obj').size, Buffer.byteLength(cube));
      assert.deepEqual(await page.evaluate(async () => Array.from(await window.__orcaEngine.readFile('/out/autosave.3mf'))), [17, 18, 19]);
      assert.deepEqual(await page.evaluate(async () => Array.from(await window.__orcaEngine.readFile('/out/undo_slot_0.3mf'))), originalHistory);
      const cached = await page.evaluate(name => new Promise((resolve, reject) => {
        const request = indexedDB.open('orca_recent_files_db', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, get = db.transaction('files').objectStore('files').get(name);
          get.onsuccess = () => { resolve(Array.from(get.result.bytes)); db.close(); };
          get.onerror = () => { reject(get.error); db.close(); };
        };
      }), name);
      assert.deepEqual(cached, returned, 'recent-file data owns an independent copy');
    }

    const beforeConcurrent = downloads.length;
    await page.evaluate(() => Promise.all(['concurrent-first.3mf', 'concurrent-second.3mf'].map(async name => {
      const bytes = await window.__appStore.getState().saveProjectFile(name);
      if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error('Concurrent project export is corrupt');
    })));
    await page.waitForTimeout(100);
    assert.equal(downloads.length, beforeConcurrent + 2);
    assert.ok((await inventory()).filter(file => file.path.startsWith('/out/web_project_export_')).every(file => !file.capacity));

    const failures = await page.evaluate(async () => {
      const engine = window.__orcaEngine, originalRead = engine.readFile, originalWrite = engine.writeFile, originalCall = engine.call;
      const saveFailure = new Error('test partial save failure');
      let sameSaveFailure = false;
      engine.call = async (op, args, options) => {
        if (op === 'saveProject') {
          await originalWrite.call(engine, args.path, new Uint8Array([7, 8, 9]));
          throw saveFailure;
        }
        return originalCall.call(engine, op, args, options);
      };
      try { await window.__appStore.getState().saveProjectFile('partial-save.3mf'); }
      catch (error) { sameSaveFailure = error === saveFailure; }
      finally { engine.call = originalCall; }
      const partialReleased = (await engine._call('__testFsInventory', {}))
        .filter(file => file.path.startsWith('/out/web_project_export_')).every(file => !file.capacity);
      const readFailure = new Error('test read failure');
      let sameReadFailure = false;
      engine.readFile = async () => { throw readFailure; };
      try { await window.__appStore.getState().saveProjectFile('failed-read.3mf'); }
      catch (error) { sameReadFailure = error === readFailure; }
      finally { engine.readFile = originalRead; }
      const files = await engine._call('__testFsInventory', {});
      const readReleased = files.filter(file => file.path.startsWith('/out/web_project_export_')).every(file => !file.capacity);
      const cleanupFailure = new Error('test cleanup failure');
      engine.writeFile = async (path, bytes) => {
        if (path.startsWith('/out/web_project_export_') && !bytes.byteLength) throw cleanupFailure;
        return originalWrite.call(engine, path, bytes);
      };
      let cleanupSaved;
      try { cleanupSaved = (await window.__appStore.getState().saveProjectFile('cleanup-failure.3mf')).byteLength; }
      finally { engine.writeFile = originalWrite; }
      for (const file of await engine._call('__testFsInventory', {}))
        if (file.path.startsWith('/out/web_project_export_') && file.size) await engine.writeFile(file.path, new Uint8Array());
      return { sameSaveFailure, partialReleased, sameReadFailure, readReleased, cleanupSaved };
    });
    assert.equal(failures.sameSaveFailure, true);
    assert.equal(failures.partialReleased, true);
    assert.equal(failures.sameReadFailure, true);
    assert.equal(failures.readReleased, true);
    assert.ok(failures.cleanupSaved > 0, 'cleanup failure preserves the valid save result');

    // Reopen through the real Recent files menu after its VFS staging has been released.
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Recent files', { exact: true }).hover();
    await page.getByText('project-download.3mf', { exact: true }).click();
    await page.waitForFunction(() => window.__appStore.getState().modelFile?.name === 'project-download.3mf' && !window.__appStore.getState().isModelLoading);
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
    assert.equal(await page.evaluate(() => window.__orcaEngine.listObjects().then(objects => objects.length)), 1);
    console.log(`${browserType.name()}: staging storage released; sources, history, concurrent downloads, recent reopen and failure semantics preserved`);
  } finally { await browser.close(); }
}
await startServer(port, 'project-staging', { frozenDist: process.env.APP_TEST_FROZEN === '1' });
try {
  if (process.env.APP_TEST_BROWSER !== 'firefox') await suite(chromium);
  if (process.env.APP_TEST_BROWSER !== 'chromium') await suite(firefox);
} finally { await stopServer(port); }
