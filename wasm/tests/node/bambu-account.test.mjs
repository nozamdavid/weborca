import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
const values = new Map();
globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
const result = await build({ stdin: { contents: "export * from './bambuAccount'; export { makerWorldDownload } from './bambuCloud';", resolveDir: new URL('../../app/src/printers', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const source = result.outputFiles[0].text;
let instance = 0;
const load = () => import('data:text/javascript;base64,' + Buffer.from(source + `\n//${instance++}`).toString('base64'));
const json = data => new Response(JSON.stringify(data));
test('restart 502 preserves the same session for reload recovery', async () => {
  values.clear();
  const key = 'weborca.bambu-account.v1';
  const saved = JSON.stringify({ accessToken: 'synthetic-restart', refreshToken: 'synthetic-refresh' });
  values.set(key, saved);
  globalThis.fetch = async () => new Response('{}', { status: 502 });
  const a = await load();
  await assert.rejects(a.validateBambuAccount());
  assert.equal(values.get(key), saved);
  const b = await load();
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer synthetic-restart');
    return json({ uid: 123 });
  };
  await b.validateBambuAccount();
  assert.equal(b.useBambuAccount.getState().account.accessToken, 'synthetic-restart');
  b.signOutBambu();
});
test('non-auth failures preserve credentials; expired refresh must definitively refuse', async () => {
  const key = 'weborca.bambu-account.v1';
  const saved = JSON.stringify({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
  values.set(key, saved);
  const a = await load();
  for (const response of [502, 429, 403, 'network', 'malformed', 'missing uid']) {
    globalThis.fetch = async () => {
      if (response === 'network') throw new TypeError('Synthetic network failure');
      if (response === 'malformed') return new Response('invalid JSON');
      return typeof response === 'number' ? new Response('{}', { status: response }) : json({});
    };
    await assert.rejects(a.validateBambuAccount());
    assert.equal(values.get(key), saved);
  }
  let renewals = 0;
  globalThis.fetch = async url => {
    if (url.endsWith('/refreshtoken')) renewals++;
    return new Response('{}', { status: 401 });
  };
  await assert.rejects(a.accountRequest('/v1/design-service/design/123'));
  assert.equal(renewals, 0);
  assert.equal(values.get(key), saved);
  const expired = JSON.stringify({ ...JSON.parse(saved), expiresAt: Date.now() - 1 });
  values.set(key, expired);
  const b = await load();
  globalThis.fetch = async () => new Response('{}', { status: 502 });
  await assert.rejects(b.validateBambuAccount());
  assert.equal(values.get(key), expired);
  for (const body of ['<html>Gateway unavailable</html>', JSON.stringify({ error: 'Gateway authorization required' })]) {
    globalThis.fetch = async () => new Response(body, { status: 401 });
    await assert.rejects(b.validateBambuAccount());
    assert.equal(values.get(key), expired);
  }
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  await assert.rejects(b.validateBambuAccount());
  assert.equal(values.has(key), false);
  assert.equal(b.useBambuAccount.getState().account, null);
});
test('zero printers: sign in, download, reload expiry, shared renewal and logout guard', async () => {
  let renewals = 0;
  let release;
  let hold = false;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/login')) return json({ accessToken: 'mock-access', refreshToken: 'mock-refresh', expiresIn: 1, refreshExpiresIn: 60 });
    if (url.endsWith('/refreshtoken')) { renewals++; if (hold) await new Promise(r => release = r); return json({ accessToken: 'mock-new', refreshToken: 'mock-new-refresh', expiresIn: 60 }); }
    if (url.includes('/design/')) return json({ defaultInstanceId: 456 });
    if (url.includes('/f3mf')) return json({ url: 'https://makerworld.bblmw.com/mock.3mf' });
    return json({ uid: 123 });
  };
  const a = await load();
  await a.signInBambu('mock@example.invalid', { code: '000000' });
  assert.equal(await a.makerWorldDownload({ ...a.accountPrinter, printhost_apikey: 'mock-access' }, '123'), 'https://makerworld.bblmw.com/mock.3mf');
  assert(![...values.values()].join('').includes('000000'));
  const key = 'weborca.bambu-account.v1';
  values.set(key, JSON.stringify({ ...a.useBambuAccount.getState().account, expiresAt: Date.now() - 1 }));
  const b = await load();
  await Promise.all([b.validateBambuAccount(), b.validateBambuAccount()]);
  assert.equal(renewals, 1);
  assert.equal(b.useBambuAccount.getState().account.accessToken, 'mock-new');
  values.set(key, JSON.stringify({ ...b.useBambuAccount.getState().account, expiresAt: Date.now() - 1 }));
  const c = await load(); hold = true;
  const pending = c.validateBambuAccount();
  await new Promise(r => setImmediate(r));
  c.signOutBambu(); release();
  await assert.rejects(pending, /superseded/);
  assert.equal(c.useBambuAccount.getState().account, null);
  assert.equal(values.has(key), false);
});
test('open tab expiry and resume renew; unknown expiry stays unknown, refusal stops', async () => {
  const a = await load();
  let tick;
  const events = new Map();
  globalThis.window = { addEventListener: (k,f) => events.set(k,f), removeEventListener() {} };
  globalThis.document = { visibilityState: 'visible', addEventListener: (k,f) => events.set(k,f), removeEventListener() {} };
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { if (ms !== 15000) tick = fn; return original(() => {}, 1); };
  let count = 0;
  globalThis.fetch = async url => url.endsWith('/login') ? json({ accessToken: 'mock', refreshToken: 'mock-refresh', expiresIn: 1 }) : url.endsWith('/refreshtoken') ? (count++, json({ accessToken: 'mock-rotated', refreshToken: 'mock-refresh' })) : json({ uid: 1 });
  await a.signInBambu('mock@example.invalid', { password: 'mock-password' });
  const stop = a.watchBambuAccount();
  await new Promise(r => setImmediate(r));
  a.useBambuAccount.setState({ account: { ...a.useBambuAccount.getState().account, expiresAt: Date.now() - 1 } });
  tick(); await new Promise(r => setImmediate(r));
  assert.equal(count, 1);
  assert.equal(a.useBambuAccount.getState().account.expiresAt, undefined);
  events.get('visibilitychange')(); await new Promise(r => setImmediate(r));
  assert.equal(count, 1);
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  await assert.rejects(a.validateBambuAccount());
  assert.equal(a.useBambuAccount.getState().account, null);
  stop(); globalThis.setTimeout = original;
});
