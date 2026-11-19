import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5374);
const cube = await readFile(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');
const project = await readFile(new URL('../data/two_cubes_multi.3mf', import.meta.url));
const model = {
  id: 123, title: 'Fixture project', url: 'https://makerworld.com/en/models/123-fixture-project',
  likes: 0, downloads: 0, fileFormats: ['3mf']
};

await startServer(port, 'models-open-project');
try {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      try {
        await page.addInitScript(() => {
          localStorage.setItem('weborca.bambu-account.v1', JSON.stringify({ accessToken: 'test-token' }));
        });
        await page.route('https://models.noz.am/**', route => {
          const path = new URL(route.request().url()).pathname;
          const json = path === '/stats' ? { models: 1, formats: [], categories: [], authors: [], licenses: [] }
            : path === '/models' ? { items: [model], total: 1, page: 1, pageSize: 24, pages: 1 } : model;
          return route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
        });
        await page.route('**/_printer/bambu-cloud/api/**', route => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith('/model-bytes')) return route.fulfill({ body: project, contentType: 'model/3mf' });
          const json = path.endsWith('/preference') ? { uid: 123 } : path.endsWith('/design/123')
            ? { defaultInstanceId: 456 } : { url: 'https://makerworld.bblmw.com/makerworld/model/fixture.3mf' };
          return route.fulfill({ json });
        });
        await page.goto(`http://127.0.0.1:${port}/models`);
        await page.waitForFunction(() => window.__appStore?.getState().isEngineReady);
        await page.evaluate(async text => {
          window.__prefsStore.getState().setGeneralPref('autosave', false);
          const app = window.__appStore.getState();
          await app.chooseVendor('Voron');
          await app.choosePrinter('Voron 2.4 300 0.4 nozzle');
          await app.importModelFile(new File([text], 'original-project.obj'));
        }, cube);
        const names = () => page.evaluate(async () => (await window.__orcaEngine.listObjects()).map(object => object.name));
        const original = await names();
        assert.equal(original.length, 1);

        const confirm = page.getByRole('alertdialog', { name: 'Close the current project?' });
        await page.getByRole('button', { name: 'Open in slicer', exact: true }).click();
        await confirm.waitFor({ timeout: 5000 });
        assert.deepEqual(await names(), original, 'Opening must wait for confirmation');
        await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
        await confirm.waitFor({ state: 'hidden' });
        assert.deepEqual(await names(), original, 'Cancel keeps all existing objects');
        assert.equal(new URL(page.url()).pathname, '/models');

        await page.getByRole('button', { name: 'More info', exact: true }).click();
        const details = page.getByRole('dialog', { name: model.title });
        await details.getByRole('button', { name: 'Open in slicer', exact: true }).click();
        await confirm.waitFor();
        await details.waitFor({ state: 'hidden' });
        await confirm.getByRole('button', { name: 'Open', exact: true }).click();
        await page.waitForURL('**/prepare');
        const opened = await names();
        assert.equal(opened.length, 2, 'Only the downloaded project objects are on the plate');
        assert.ok(opened.every(name => !original.includes(name)));
        assert.equal(await page.evaluate(() => window.__appStore.getState().modelFile.name), 'MakerWorld-123.3mf');
        console.log(`${width}px: Models confirms replacement, preserves the old project on cancel, and opens the new project`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  await stopServer(port);
}
