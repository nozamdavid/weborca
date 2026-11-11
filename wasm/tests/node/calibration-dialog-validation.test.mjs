import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

// Exercise the real dialogs and shared focus/error presentation without loading the engine.
test('calibration invalid fields receive focus, announce errors and clear on correction', async () => {
  const resolveDir = new URL('../../app/', import.meta.url).pathname;
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import './src/index.css';import './src/App.css';
      import {OtherCalibrationsDialogs} from './src/calibration/OtherCalibrationsDialogs';
      import {useOtherCalibrationStore} from './src/calibration/otherCalibrationStore';
      import {useInputShapingStore} from './src/calibration/inputShapingStore';
      import {Dialog} from './src/components/Dialog';
      window.openCalibration=kind=>useOtherCalibrationStore.getState().openDialog(kind);
      window.openShaping=kind=>useInputShapingStore.getState().openDialog(kind);
      function AutoFocusSample(){const [open,setOpen]=React.useState(false);window.openAutoFocus=()=>setOpen(true);return open?<Dialog onClose={()=>setOpen(false)}><section className="ds-dialog"><h2>Focus sample</h2><button autoFocus onClick={()=>setOpen(false)}>Close sample</button></section></Dialog>:null}
      createRoot(document.getElementById('root')).render(<><OtherCalibrationsDialogs/><AutoFocusSample/></>);`, loader: 'tsx', resolveDir },
    bundle: true, write: false, outdir: '/virtual', platform: 'browser', format: 'iife',
    plugins: [{ name: 'calibration-boundaries', setup(b) {
      b.onResolve({ filter: /\/(calibrationUtils|appStore|i18n)$/ }, args => ({ path: args.path.split('/').at(-1), namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir, loader: 'js', contents:
        args.path === 'calibrationUtils' ? `window.calibrationCalls=[];export async function runOtherCalibration(...args){window.calibrationCalls.push(args)}` :
        args.path === 'appStore' ? `export const useAppStore=selector=>selector({currentConfig:{gcode_flavor:'klipper'}})` :
        `export const useTranslation=()=>({t:key=>key})` }));
    } }]
  });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<!doctype html><button id="trigger">Calibration</button><div id="root"></div>');
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
    const field = label => page.getByRole('spinbutton', { name: label, exact: true });
    const generate = () => page.getByRole('button', { name: 'Generate Calibration Plate', exact: true }).click();
    async function invalid(label, value, correction) {
      const input = field(label);
      await input.fill(value);
      await generate();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-invalid') === 'true');
      assert.equal(await input.evaluate(el => el === document.activeElement), true, label);
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      const description = await input.getAttribute('aria-describedby');
      assert.ok(description);
      assert.equal(await input.evaluate(el => el.getAttribute('aria-describedby').split(' ').some(id => document.getElementById(id)?.getAttribute('role') === 'alert')), true);
      assert.equal(await page.getByRole('alert').isVisible(), true);
      assert.equal(await page.evaluate(() => window.calibrationCalls.length), 0, 'validation starts no calibration work');
      await input.fill(correction);
      assert.equal(await input.getAttribute('aria-invalid'), null);
      assert.equal(await page.getByRole('alert').count(), 0);
    }
    await page.locator('#trigger').focus();
    await page.evaluate(() => window.openCalibration('pa_line'));
    await invalid('PA step', '0', '0.002');
    await invalid('Start PA', '-1', '0');
    await invalid('End PA', '0', '0.1');
    // Empty numeric input previously passed the comparison guards as NaN.
    await invalid('PA step', '', '0.002');
    await page.getByRole('button', { name: 'Close Calibration dialog' }).click();
    assert.equal(await page.locator('#trigger').evaluate(el => el === document.activeElement), true);
    await page.evaluate(() => window.openCalibration('temp'));
    await invalid('Start Temperature', '501', '230');
    await invalid('End Temperature', '154', '190');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.openShaping('freq'));
    await invalid('X end', '501', '110');
    await page.keyboard.press('Escape');
    // Units describe the controls; the existing numeric payload passes through unchanged.
    for (const [kind, unit, labels, values] of [
      ['retraction', 'mm', ['Start', 'End', 'Step'], [0, 2, 0.1]],
      ['max_vol', 'mm³/s', ['Start', 'End', 'Step'], [5, 20, 0.5]],
      ['temp', '°C', ['Start Temperature', 'End Temperature', 'Step'], [230, 190, 5]],
      ['vfa', 'mm/s', ['Start Speed', 'End Speed', 'Step'], [40, 200, 10]]
    ]) {
      await page.evaluate(kind => window.openCalibration(kind), kind);
      for (const [index, label] of labels.entries()) {
        assert.equal(await field(label).inputValue(), String(values[index]));
        assert.equal(await field(label).evaluate(el => document.getElementById(el.getAttribute('aria-describedby'))?.textContent), unit);
      }
      await generate();
      await page.waitForFunction(() => !document.querySelector('.calibration-dialog'));
      const options = await page.evaluate(() => window.calibrationCalls.at(-1)[1]);
      assert.deepEqual([options.start, options.end, options.step], values);
    }
    await page.locator('#trigger').focus();
    await page.evaluate(() => window.openAutoFocus());
    await page.getByRole('button', { name: 'Close sample' }).click();
    assert.equal(await page.locator('#trigger').evaluate(el => el === document.activeElement), true, 'autoFocus must not replace the opening trigger');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
