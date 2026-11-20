import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const port = Number(process.env.PORT || 5268);
async function suite(browserType) {
  const browser = await browserType.launch({
    headless: process.env.APP_TEST_HEADED !== '1',
    args: browserType === chromium ? ['--enable-unsafe-swiftshader'] : []
  });
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
    await page.evaluate(() => window.__appStore.setState({ sliceResult: {
      plateIndex: 0, layers: 1, printTimeS: 0, filamentMm: 0, filamentG: 0,
      warnings: ['bed_temperature_too_high_than_filament', 'not_support_traditional_timelapse',
        'not_support_traditional_timelapse', 'An unknown engine warning.']
    } }));
    const dialog = page.getByRole('dialog', { name: 'Slicing warnings' });
    await dialog.waitFor();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      const markerInset = await dialog.getByRole('list').evaluate(list =>
        list.firstElementChild.getBoundingClientRect().left - list.getBoundingClientRect().left);
      assert.ok(markerInset >= 12, `reserve space for the bullet at ${width}px`);
    }
    const text = await dialog.innerText();
    assert.doesNotMatch(text, /bed_temperature_too_high_than_filament/);
    assert.match(text, /bed temperature.*softening temperature/i);
    assert.match(text, /enclosed printer/i);
    assert.doesNotMatch(text, /not_support_traditional_timelapse/);
    assert.equal(await dialog.getByRole('listitem').filter({ hasText: /traditional timelapse photography/ }).count(), 1);
    assert.match(text, /An unknown engine warning\./);
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('language', 'es'));
    await page.getByText(/temperatura de la cama.*ablandamiento/).waitFor();
    const spanish = await page.locator('[role="dialog"]').innerText();
    assert.match(spanish, /temperatura de la cama.*ablandamiento/);
    assert.doesNotMatch(spanish, /bed_temperature_too_high_than_filament/);
    await page.click('#slicing-warnings-close');
    await dialog.waitFor({ state: 'detached' });
    console.log(`${browserType.name()}: engine warning codes show readable explanations; unknown messages preserved`);
  } finally { await browser.close(); }
}
await startServer(port, 'slicing-warnings');
try { await suite(chromium); await suite(firefox); } finally { await stopServer(port); }
