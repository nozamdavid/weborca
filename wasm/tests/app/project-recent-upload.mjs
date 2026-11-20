/** Imported project bytes must remain available after their worker transfer consumes the upload. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';
const port = Number(process.env.PORT || 5325);
const cube = fs.readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    const source = await page.evaluate(async text => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      window.__prefsStore.getState().setGeneralPref('autoArrangeOnImport', false);
      window.__prefsStore.getState().setGeneralPref('rememberRecentFiles', false);
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
      await window.__appStore.getState().importModelFile(new File([text], 'recent-cube.obj'));
      await window.__orcaEngine.call('saveProject', { path: '/out/recent-source.3mf' });
      const bytes = await window.__orcaEngine.readFile('/out/recent-source.3mf');
      window.__recentUploadBytes = bytes;
      window.__fileReadCounts = {};
      const arrayBuffer = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function (...args) {
        window.__fileReadCounts[this.name] = (window.__fileReadCounts[this.name] || 0) + 1;
        return arrayBuffer.apply(this, args);
      };
      window.__prefsStore.getState().setGeneralPref('rememberRecentFiles', true);
      await window.__appStore.getState().openProjectFile(new File([bytes], 'cached-project.3mf'));
      return Array.from(bytes);
    }, cube);
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
    const cached = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('orca_recent_files_db', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, get = db.transaction('files').objectStore('files').get('cached-project.3mf');
        get.onsuccess = () => { resolve(get.result ? Array.from(get.result.bytes) : null); db.close(); };
        get.onerror = () => { reject(get.error); db.close(); };
      };
    }));
    assert.deepEqual(cached, source, 'Recent files retain the complete original project after upload transfer');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('orca_recent_files')).find(file => file.name === 'cached-project.3mf').size), source.length);
    assert.equal(await page.evaluate(() => window.__fileReadCounts['cached-project.3mf']), 2);
    const beforeGeometry = await page.evaluate(async () => {
      const objects = await window.__orcaEngine.listObjects();
      return Array.from((await window.__orcaEngine.getMesh(objects[0].id)).buffer);
    });
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Recent files', { exact: true }).hover();
    await page.getByText('cached-project.3mf', { exact: true }).last().click();
    await page.getByTestId('confirm-ok').click();
    await page.waitForFunction(() => window.__fileReadCounts['cached-project.3mf'] === 4 && !window.__appStore.getState().isModelLoading);
    assert.equal(await page.evaluate(() => window.__appStore.getState().engineError), null);
    const afterGeometry = await page.evaluate(async () => {
      const objects = await window.__orcaEngine.listObjects();
      if (objects.length !== 1) throw new Error('Recent project geometry was not restored');
      return Array.from((await window.__orcaEngine.getMesh(objects[0].id)).buffer);
    });
    assert.deepEqual(afterGeometry, beforeGeometry, 'recent reopen preserves all packed mesh bytes');
    await page.evaluate(async text => {
      window.__prefsStore.getState().setGeneralPref('rememberRecentFiles', false);
      await window.__appStore.getState().openProjectFile(new File([window.__recentUploadBytes], 'disabled-project.3mf'));
      await window.__appStore.getState().importModelFile(new File([text], 'disabled-model.obj'));
    }, cube);
    assert.equal(await page.evaluate(() => window.__fileReadCounts['disabled-project.3mf']), 1, 'disabled project caching avoids a second file read');
    assert.equal(await page.evaluate(() => window.__fileReadCounts['disabled-model.obj']), 1, 'disabled model caching avoids a second file read');
    const names = await page.evaluate(() => JSON.parse(localStorage.getItem('orca_recent_files')).map(file => file.name));
    assert.ok(!names.includes('disabled-project.3mf') && !names.includes('disabled-model.obj'));
    console.log(`${browserType.name()}: project upload recents preserve original bytes/geometry; disabled imports read once`);
  } finally { await browser.close(); }
}
await startServer(port, 'project-recent-upload', { frozenDist: process.env.APP_TEST_FROZEN === '1' });
try {
  if (process.env.APP_TEST_BROWSER !== 'firefox') await suite(chromium);
  if (process.env.APP_TEST_BROWSER !== 'chromium') await suite(firefox);
} finally { await stopServer(port); }
