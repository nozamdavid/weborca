import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from '../../app/node_modules/esbuild/lib/main.js';

test('canceling pending polling reads does not start gateway diagnostics or publish late data', async t => {
  const bundled = await build({ stdin: { contents: "export {OctoPrintApi, PrusaLinkApi, PrusaConnectApi} from './src/printers/octoprint';", resolveDir: new URL('../../app', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{name:'locale',setup(b) { b.onResolve({filter:/\/i18n$/},() => ({path:'locale',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'},() => ({contents:'export const translate=s=>s;'})); }}] });
  const drivers = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  t.mock.method(globalThis,'setTimeout',() => 1);
  t.mock.method(globalThis,'clearTimeout',() => {});
  globalThis.window = {location: {origin:'https://fixture.invalid',protocol:'https:',host:'fixture.invalid'}};
  t.after(() => { delete globalThis.window; });
  for (const Driver of [drivers.OctoPrintApi,drivers.PrusaLinkApi,drivers.PrusaConnectApi]) {
    const requests = [], signals = [];
    t.mock.method(globalThis,'fetch',(url,options) => {
      requests.push(url); signals.push(options.signal);
      return new Promise((_,reject) => options.signal.addEventListener('abort',() => reject(options.signal.reason),{once:true}));
    });
    const api = new Driver({id:'p',name:'P',host_type:'octoprint',print_host:'fixture.invalid',use_gateway:true});
    const stop = api.connect(() => assert.fail('late state'),() => assert.fail('late error'),{pollIntervalMs:15000});
    const started = requests.length;
    assert.ok(started > 0);
    stop();
    await new Promise(setImmediate);
    assert.ok(signals.every(signal => signal.aborted));
    assert.equal(requests.length,started,'cancel must not issue a new gateway status request');
    t.mock.restoreAll();
    t.mock.method(globalThis,'setTimeout',() => 1);
    t.mock.method(globalThis,'clearTimeout',() => {});
  }
});
