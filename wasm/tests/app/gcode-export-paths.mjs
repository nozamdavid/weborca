import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5258);
const fixture = readFileSync(new URL('../parity/refs-macos-x86_64/cube-voron.gcode', import.meta.url), 'utf8');
const cube = readFileSync(new URL('../../../tests/data/20mm_cube.obj', import.meta.url), 'utf8');

async function suite(browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(async text => {
      await window.__appStore.getState().chooseVendor('Voron');
      await window.__appStore.getState().choosePrinter('Voron 2.4 300 0.4 nozzle');
      await window.__appStore.getState().importModelFile(new File([text], 'cube.obj'));
    }, cube);
    await page.click('#tab-preview');
    await page.waitForFunction(() => window.__previewStore?.getState().isInitialized);
    await page.evaluate(async text => window.__appStore.getState().openGcodeFile(new File([text], 'cube.gcode')), fixture);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.slice-stats-panel #download-link').click();
    const download = await downloadPromise;
    const downloaded = readFileSync(await download.path());
    assert.match(downloaded.toString(), /; thumbnail begin \d+x\d+ \d+/);

    // Capture drive writes without opening an OS picker. The picker must run in the click's activation.
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => {
        window.__pickerHadActivation = navigator.userActivation.isActive;
        return { createWritable: async () => ({
          write: async blob => { window.__savedGcode = Array.from(new Uint8Array(await blob.arrayBuffer())); },
          close: async () => {}
        }) };
      };
    });
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByText('Export G-code to drive...', { exact: true }).click();
    await page.waitForFunction(() => window.__savedGcode);
    assert.equal(await page.evaluate(() => window.__pickerHadActivation), true);
    assert.deepEqual(Buffer.from(await page.evaluate(() => window.__savedGcode)), downloaded);

    // Intercept the upload locally: no request reaches hardware or a gateway.
    let uploaded;
    await page.route('**/server/files/upload', async route => {
      const requestBody = route.request().postDataBuffer().toString('latin1');
      const boundary = requestBody.slice(0, requestBody.indexOf('\r\n'));
      const filePart = requestBody.split(boundary).find(part => /name="file"/.test(part));
      uploaded = Buffer.from(filePart.slice(filePart.indexOf('\r\n\r\n') + 4, -2), 'latin1');
      assert.doesNotMatch(requestBody, /name="print"/);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.evaluate(() => {
      window.__printerStore.getState().savePrinter({ id: 'mock-export', name: 'Mock export', host_type: 'moonraker', print_host: location.origin, use_gateway: false });
      window.__printerStore.getState().openSendDialog();
    });
    await page.click('#send-upload');
    await page.locator('#send-result[data-ok="true"]').waitFor();
    assert.deepEqual(uploaded, downloaded);
    console.log(`${browserType.name()}: Preview download, drive save and mocked upload contain identical thumbnail G-code`);
  } finally { await browser.close(); }
}

await startServer(port, 'gcode-export-paths');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
