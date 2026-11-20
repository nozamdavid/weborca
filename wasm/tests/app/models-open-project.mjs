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
        const pageRequests = [];
        await page.route('https://models.noz.am/**', route => {
          const { pathname: path, searchParams } = new URL(route.request().url());
          const catalogPage = Number(searchParams.get('page') || 1);
          if (path === '/models') pageRequests.push(catalogPage);
          const json = path === '/stats' ? { models: 1, formats: [], categories: [], authors: [], licenses: [] }
            : path === '/models' ? { items: [model], total: 70, page: catalogPage, pageSize: Number(searchParams.get('pageSize') || 24), pages: 3 }
              : { ...model, description: 'Fixture instructions for printing the model.\n'.repeat(45) };
          return route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } });
        });
        await page.route('**/_printer/bambu-cloud/api/**', route => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith('/user/login')) {
            const body = route.request().postDataJSON();
            const account = 'fixture@example.invalid';
            if (body.code) {
              assert.deepEqual(body, { account, code: '123456' });
              return route.fulfill({ json: { accessToken: 'test-token' } });
            }
            assert.deepEqual(body, { account, password: 'fixture-password' });
            return route.fulfill({ json: { loginType: 'verifyCode' } });
          }
          if (path.endsWith('/model-bytes')) return route.fulfill({ body: project, contentType: 'model/3mf' });
          const json = path.endsWith('/preference') ? { uid: 123 } : path.endsWith('/design/123')
            ? { defaultInstanceId: 456 } : { url: 'https://makerworld.bblmw.com/makerworld/model/fixture.3mf' };
          return route.fulfill({ json });
        });
        await page.goto(`http://127.0.0.1:${port}/models`);
        await page.waitForFunction(() => window.__appStore?.getState().isEngineReady);
        const waitForPage = number => page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.hostname === 'models.noz.am' && url.pathname === '/models' &&
            Number(url.searchParams.get('page')) === number;
        });
        if (!pageRequests.includes(2)) await waitForPage(2);
        const nextPrefetch = waitForPage(3);
        await page.setViewportSize({ width, height: 350 });
        const modelsBrowser = page.locator('.model-browser');
        await page.getByRole('button', { name: 'Next', exact: true }).scrollIntoViewIfNeeded();
        assert.ok(await modelsBrowser.evaluate(element => element.scrollTop > 0), 'Pagination starts with Models scrolled down');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.getByText('Page 2 of 3', { exact: true }).waitFor();
        await nextPrefetch;
        assert.equal(await modelsBrowser.evaluate(element => element.scrollTop), 0, 'Next scrolls the Models container to the top');
        await page.setViewportSize({ width, height: 850 });
        assert.equal(pageRequests.filter(number => number === 2).length, 1, 'Next uses the preloaded catalog request');
        await page.getByRole('button', { name: 'Previous', exact: true }).click();
        await page.getByText('Page 1 of 3', { exact: true }).waitFor();
        const login = page.getByRole('dialog', { name: 'Bambu Cloud account' });
        const checkLayout = async () => {
          const layout = await login.evaluate(dialog => {
            const form = dialog.querySelector('form');
            const footer = form.querySelector('footer');
            return {
              overflow: form.scrollWidth > form.clientWidth,
              stacked: [...form.querySelectorAll('label')].every(label => {
                const field = label.querySelector('input').getBoundingClientRect();
                const title = label.querySelector('span').getBoundingClientRect();
                return field.top > title.bottom && field.height >= 44 &&
                  Math.abs(field.width - label.getBoundingClientRect().width) <= 1;
              }),
              actionInFooter: Boolean(footer.querySelector('button[type="submit"]'))
            };
          });
          assert.deepEqual(layout, { overflow: false, stacked: true, actionInFooter: true });
        };
        await page.getByRole('button', { name: 'Download 3MF', exact: true }).click();
        await login.waitFor();
        await checkLayout();
        assert.equal(await login.getByLabel('Verification code').count(), 0);
        await login.getByRole('button', { name: 'Close', exact: true }).click();
        const moreInfo = page.getByRole('button', { name: 'More info', exact: true });
        const detailDialog = page.getByRole('dialog', { name: model.title });
        await moreInfo.click();
        await detailDialog.getByText(/fixture instructions/i).waitFor();
        const makerworldLink = detailDialog.getByRole('link', { name: 'Open in MakerWorld' });
        assert.equal(await makerworldLink.evaluate(link => getComputedStyle(link).textDecorationLine), 'none');
        await detailDialog.evaluate(async dialog => {
          await Promise.all(dialog.getAnimations({ subtree: true }).filter(animation =>
            animation.effect.getTiming().iterations === 1).map(animation => animation.finished.catch(() => {})));
        });
        const detailLayout = await detailDialog.evaluate(dialog => {
          const body = dialog.querySelector('.ds-dialog__body');
          const footer = dialog.querySelector('footer');
          return {
            scrolls: body.scrollHeight > body.clientHeight,
            overflow: body.scrollWidth > body.clientWidth,
            visibleFooter: footer.getBoundingClientRect().bottom <= innerHeight + 1,
            primaryAction: Boolean(footer.querySelector('.ds-btn--primary'))
          };
        });
        assert.deepEqual(detailLayout, { scrolls: true, overflow: false, visibleFooter: true, primaryAction: true });
        await page.keyboard.press('Escape');
        await detailDialog.waitFor({ state: 'hidden' });
        assert.equal(await moreInfo.evaluate(button => button === document.activeElement), true);
        await moreInfo.click();
        await detailDialog.getByRole('button', { name: 'Open in slicer', exact: true }).click();
        await login.getByText(/tokens are saved only in this browser/).waitFor();
        await login.getByLabel('Email', { exact: true }).fill('fixture@example.invalid');
        await login.getByLabel('Password', { exact: true }).fill('fixture-password');
        await login.getByRole('button', { name: 'Sign in', exact: true }).click();
        await login.getByText(/check your email for a verification code/i).waitFor();
        await checkLayout();
        assert.equal(await login.getByLabel('Password', { exact: true }).count(), 0);
        await login.getByLabel('Verification code').fill('123456');
        await login.getByRole('button', { name: 'Verify code', exact: true }).click();
        await login.getByText('Signed in', { exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('weborca.bambu-account.v1'))), { accessToken: 'test-token' });
        await login.getByRole('button', { name: 'Close', exact: true }).click();
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
