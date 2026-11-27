import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from 'playwright';

const app = new URL('../../app/', import.meta.url).pathname;
const sessionKey = 'orca-alpha-session';
const future = () => new Date(Date.now() + 600000).toISOString();
const bundles = new Map();
async function bundle(mode = 'main') {
  if (bundles.has(mode)) return bundles.get(mode);
  const result = await build({ entryPoints: [app + (mode === 'public' ? 'src/alpha/bootstrap.ts' : 'src/main.tsx')],
    bundle: true, write: false, outdir: '/virtual', platform: 'browser', format: 'iife', metafile: true,
    define: { 'import.meta.env.VITE_ALPHA_GATE_ENABLED': JSON.stringify(mode === 'off' ? '0' : '1') },
    plugins: [{ name: 'inert-heavy-app', setup(b) {
      b.onResolve({ filter: /^(?:\.\/|\.\.\/)appEntry$/ }, () => ({ path: 'app', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export async function start(){
        window.mounted=(window.mounted||0)+1;
        document.getElementById('root').innerHTML='<p>APP MOUNTED</p><div data-alpha-access-slot></div>';
        return async ()=>{window.cleanupAttempts=(window.cleanupAttempts||0)+1;
          if(window.cleanupFails)throw Error('backup failed');
          if(window.cleanupWait)await window.cleanupWait;
          window.unmounted=(window.unmounted||0)+1};
      }` }));
    } }] });
  const value = { js: result.outputFiles.find(f => f.path.endsWith('.js')).text,
    css: result.outputFiles.find(f => f.path.endsWith('.css'))?.text || '', inputs: Object.keys(result.metafile.inputs) };
  bundles.set(mode, value); return value;
}
async function fixture(t, { mode = 'main', token, path = '/', unavailableStorage = false, savedReturn, capturedCallback, handler } = {}) {
  const output = await bundle(mode);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage(); const requests = []; const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ token, unavailableStorage, savedReturn, capturedCallback }) => {
    if (token) localStorage.setItem('orca-alpha-session', token);
    if (savedReturn) sessionStorage.setItem('orca-alpha-return', savedReturn);
    if (capturedCallback) { window.__orcaCloudCallback = capturedCallback; history.replaceState(null, '', '/orca-cloud/callback'); }
    if (unavailableStorage) {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
      Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } });
    }
  }, { token, unavailableStorage, savedReturn, capturedCallback });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/_alpha/') && route.request().resourceType() !== 'document') {
      const request = route.request();
      const item = { path: url.pathname, method: request.method(), headers: request.headers(), body: request.postDataJSON() };
      requests.push(item);
      const response = await handler?.(item, page) || { status: 401, body: { error: 'invalid' } };
      if (response.abort) return route.abort();
      return route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body) });
    }
    if (url.pathname === '/entry.js') return route.fulfill({ contentType: 'text/javascript', body: output.js });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${output.css}</style></head><body ${mode === 'public' ? 'data-alpha-bootstrap' : ''}><div id="root"></div><script src="/entry.js"></script></body></html>` });
  });
  await page.goto('https://alpha.test' + path);
  t.after(() => assert.deepEqual(errors, []));
  return { page, requests, output, close: () => browser.close() };
}
async function has(page, text) { await page.getByRole('heading', { name: text, exact: true }).waitFor(); }

test('guest slicer starts without tester validation only when the server opts in', async t => {
  const guest = await fixture(t, { path: '/slicer/preview', handler: () => ({ body: { enabled: true, guestSlicer: true } }) });
  await guest.page.getByText('APP MOUNTED', { exact: true }).waitFor();
  assert.deepEqual(guest.requests.map(req => req.path), ['/_alpha/config']);
  assert.equal(await guest.page.evaluate(() => localStorage.getItem('orca-alpha-session')), null);
  await guest.close();
  const closed = await fixture(t, { path: '/slicer', handler: () => ({ body: { enabled: true } }) });
  await has(closed.page, 'Alpha access');
  assert.equal(await closed.page.evaluate(() => window.mounted || 0), 0);
});

for (const staleStatus of [401, 200]) test(`late old-session ${staleStatus} cannot remove a new login or unmount it`, async t => {
  let release, entered, delay = false;
  const pending = new Promise(resolve => { entered = resolve; });
  const { page } = await fixture(t, { token: 'old-token', handler: async req => {
    if (req.path.endsWith('/logout')) return { body: { ok: true } };
    if (req.path.endsWith('/validate')) return { body: { token: 'new-token', expiresAt: future() } };
    if (delay && req.headers.authorization === 'Bearer old-token') {
      entered(); return new Promise(resolve => { release = () => resolve({ status: staleStatus, body: { valid: true, expiresAt: future() } }); });
    }
    return { body: { valid: true, expiresAt: future() } };
  } });
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  delay = true; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await pending;
  await page.locator('summary').click(); await page.getByRole('button', { name: 'Log out of alpha' }).click();
  await has(page, 'Alpha access');
  await page.getByLabel('Invite code').fill('new-invite'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  const response = page.waitForResponse(r => r.url().endsWith('/_alpha/session') && r.status() === staleStatus);
  release(); await response;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => localStorage.getItem('orca-alpha-session')), 'new-token');
  assert.equal(await page.evaluate(() => window.unmounted), 1);
  assert.equal(await page.getByText('APP MOUNTED', { exact: true }).count(), 1);
});

test('guard closure blocks immediately and waits for recovery before allowing a new login', async t => {
  let revoked = false;
  const { page } = await fixture(t, { token: 'tester-token', handler: req => {
    if (req.path.endsWith('/validate')) { revoked = false; return { body: { token: 'replacement', expiresAt: future() } }; }
    return revoked ? { status: 401, body: {} } : { body: { valid: true, expiresAt: future() } };
  } });
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  await page.evaluate(() => { window.cleanupWait = new Promise(resolve => { window.releaseCleanup = resolve; }); });
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await has(page, 'Saving recovery backup');
  assert.equal(await page.locator('#root').evaluate(root => root.inert), true);
  assert.equal(await page.getByText('APP MOUNTED', { exact: true }).isVisible(), false);
  assert.equal(await page.getByLabel('Invite code').count(), 0);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new StorageEvent('storage', { key: 'orca-alpha-session' })); });
  assert.equal(await page.evaluate(() => window.mounted), 1);
  assert.equal(await page.evaluate(() => window.unmounted || 0), 0);
  await page.evaluate(() => window.releaseCleanup());
  await has(page, 'Alpha access');
  assert.equal(await page.evaluate(() => window.unmounted), 1);
  await page.getByLabel('Invite code').fill('replacement-invite');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.mounted), 2);
});

for (const destination of ['Log out of alpha', 'Alpha admin']) test(`${destination} retains a blocked app on backup failure and retries before transition`, async t => {
  const { page } = await fixture(t, { token: 'tester-token', handler: req => req.path.endsWith('/admin/invites')
    ? { body: { invites: [] } } : { body: { valid: true, expiresAt: future(), ok: true } } });
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  await page.evaluate(() => { window.cleanupFails = true; });
  await page.locator('summary').click();
  await page.getByRole('button', { name: destination, exact: true }).click();
  await has(page, 'Recovery backup needs a retry');
  assert.equal(await page.getByText('APP MOUNTED', { exact: true }).isVisible(), false);
  assert.equal(await page.evaluate(() => window.unmounted || 0), 0);
  assert.equal(await page.evaluate(() => window.mounted), 1);
  assert.equal(await page.getByLabel('Invite code').count(), 0);
  await page.evaluate(() => { window.cleanupFails = false; });
  await page.getByRole('button', { name: 'Retry saving recovery', exact: true }).click();
  await has(page, destination === 'Alpha admin' ? 'Alpha administration' : 'Alpha access');
  assert.equal(await page.evaluate(() => window.unmounted), 1);
  assert.equal(await page.evaluate(() => window.cleanupAttempts), 2);
});

test('late admin rejection cannot close the tester app after returning from administration', async t => {
  let release, entered;
  const pending = new Promise(resolve => { entered = resolve; });
  const { page } = await fixture(t, { token: 'tester-token', path: '/_alpha/admin', handler: req => {
    if (req.path.endsWith('/admin/invites')) return { body: { invites: [invite()] } };
    if (req.path.endsWith('/admin/open-slicer')) return { body: { token: 'admin-app-token', expiresAt: future() } };
    if (req.method === 'PATCH') { entered(); return new Promise(resolve => { release = () => resolve({ status: 401, body: {} }); }); }
    return { body: { valid: true, expiresAt: future() } };
  } });
  await has(page, 'Alpha administration');
  await page.locator('.alpha-invite summary').click();
  await page.getByRole('button', { name: 'Save labels', exact: true }).click();
  await pending;
  await page.getByRole('button', { name: 'Open slicer', exact: true }).click();
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  const response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.status() === 401);
  release(); await response;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByText('APP MOUNTED', { exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => window.unmounted || 0), 0);
});

test('invalid, spoofed and expired tester tokens never mount; invalid storage is removed', async t => {
  for (const expired of [false, true]) {
    const { page, requests, close } = await fixture(t, { token: 'spoofed-browser-token', handler: () => expired
      ? { body: { valid: true, expiresAt: '2000-01-01T00:00:00.000Z' } } : { status: 401, body: {} } });
    await has(page, 'Alpha access');
    assert.equal(await page.evaluate(() => window.mounted || 0), 0);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
    assert.equal(requests[0].headers.authorization, 'Bearer spoofed-browser-token');
    await close();
  }
});

test('valid restore checks backend before heavy app and revocation unmounts; code can reopen app', async t => {
  let revoked = false;
  const { page, requests } = await fixture(t, { token: 'tester-token', handler: req => {
    if (req.path.endsWith('/validate')) { revoked = false; return { body: { token: 'new-tester', expiresAt: future() } }; }
    return revoked ? { status: 401, body: {} } : { body: { valid: true, expiresAt: future() } };
  } });
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  await page.locator('[data-alpha-access-slot] .alpha-nav').waitFor();
  assert.equal(requests[0].path, '/_alpha/session');
  revoked = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await has(page, 'Alpha access');
  assert.equal(await page.evaluate(() => window.unmounted), 1);
  await page.getByLabel('Invite code', { exact: true }).fill('active-code');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.mounted), 2);
});

test('static off mounts directly with zero alpha API or bootstrap code', async t => {
  const { page, requests, output } = await fixture(t, { mode: 'off' });
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  assert.deepEqual(requests, []); assert.ok(!output.js.includes('/_alpha'));
});

test('backend unavailable fails closed with retry and keyboard invite errors; responsive controls fit', async t => {
  const { page } = await fixture(t, { handler: () => ({ abort: true }) });
  await has(page, 'Alpha access');
  await page.getByText(/Alpha access is unavailable/).waitFor();
  const code = page.getByLabel('Invite code', { exact: true });
  await code.fill('invalid'); await code.press('Enter');
  await page.getByRole('alert').waitFor();
  assert.equal(await code.getAttribute('aria-invalid'), 'true');
  assert.equal(await code.evaluate(el => el === document.activeElement), true);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.alpha-page button').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().height >= 40)), true);
  }
  assert.equal(await page.evaluate(() => window.mounted || 0), 0);
});

test('successful invite persists only backend token; storage denial still permits cookie-backed session', async t => {
  for (const unavailableStorage of [false, true]) {
    let accepted = false;
    const { page, close } = await fixture(t, { unavailableStorage, handler: req => {
      if (req.path === '/_alpha/validate') { accepted = true; return { body: { token: 'server-token', expiresAt: future() } }; }
      return accepted ? { body: { valid: true, expiresAt: future() } } : { status: 401, body: {} };
    } });
    await has(page, 'Alpha access');
    await page.getByLabel('Invite code', { exact: true }).fill('invite-value');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText('APP MOUNTED', { exact: true }).waitFor();
    if (!unavailableStorage) assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), 'server-token');
    await close();
  }
});

const invite = () => ({ id: 'synthetic-id', email: 'tester@example.invalid', username: 'tester', note: 'Internal only',
  createdAt: new Date().toISOString(), usedAt: null, lastUsedAt: null, useCount: 0, revoked: false });
test('admin login never uses tester bearer; one-time create, used metadata, label edit, revoke/restore and logout', async t => {
  let admin = false; let item = invite();
  const { page, requests } = await fixture(t, { mode: 'public', path: '/_alpha/admin', token: 'tester-token', handler: req => {
    assert.equal(req.headers.authorization, undefined);
    if (req.path === '/_alpha/admin/login') { admin = true; return { body: { token: 'admin-only', expiresAt: future() } }; }
    if (req.path === '/_alpha/admin/logout') { admin = false; return { body: { ok: true } }; }
    if (!admin) return { status: 401, body: {} };
    if (req.method === 'PATCH') { item = { ...item, ...req.body }; return { body: { invite: item } }; }
    if (req.method === 'POST') return { status: 201, body: { invite: item, code: 'new-code-shown-once' } };
    return { body: { invites: [] } };
  } });
  await has(page, 'Admin sign-in');
  assert.equal(await page.getByText('Internal only').count(), 0);
  await page.getByLabel('Admin password').fill('synthetic-only');
  await page.getByRole('button', { name: 'Sign in as admin' }).click();
  await has(page, 'Alpha administration');
  await page.getByLabel('Username (internal, optional)').fill('tester');
  await page.getByRole('button', { name: 'Create code' }).click();
  const code = page.getByLabel('New invite code (shown once)'); await code.waitFor();
  assert.equal(await code.inputValue(), 'new-code-shown-once');
  assert.equal(await page.getByText('No invite codes yet.').count(), 0);
  await page.getByRole('button', { name: 'Dismiss code' }).click();
  assert.equal(await code.count(), 0);
  await page.locator('.alpha-invite summary').filter({ hasText: 'tester' }).click();
  await page.locator('details').getByLabel('Note (internal, optional)').fill('Updated label');
  await page.getByRole('button', { name: 'Save labels' }).click();
  await page.locator('.alpha-invite summary').filter({ hasText: 'tester' }).click();
  await page.getByRole('button', { name: 'Revoke code', exact: true }).click();
  await page.locator('.alpha-invite summary').filter({ hasText: 'Revoked' }).click();
  await page.getByRole('button', { name: 'Restore code', exact: true }).click();
  item = { ...item, usedAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), useCount: 3 };
  // A new create response exercises the used metadata without exposing a prior code.
  await page.getByRole('button', { name: 'Create code' }).click();
  await page.locator('.alpha-invite summary').filter({ hasText: 'Used' }).click();
  const used = page.locator('.alpha-invite').filter({ has: page.getByText('Used', { exact: true }) });
  assert.equal(await used.locator('dd').last().textContent(), '3');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.getByRole('button', { name: 'Admin logout', exact: true }).click();
  await has(page, 'Admin sign-in');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), 'tester-token');
  assert.equal(requests.filter(req => req.path === '/_alpha/session').length, 0);
  assert.equal(await page.evaluate(() => window.mounted || 0), 0);
});

test('tester restore cannot grant admin, rejected admin launch returns to sign-in', async t => {
  const { page, close } = await fixture(t, { mode: 'public', handler: () => ({ status: 401, body: {} }) });
  await has(page, 'Alpha access');
  await page.getByRole('button', { name: 'Login as admin' }).click(); await has(page, 'Admin sign-in');
  await page.getByRole('button', { name: 'Back to alpha access' }).click(); await has(page, 'Alpha access');
  assert.equal(await page.evaluate(() => window.mounted || 0), 0);
  await close();
  const admin = await fixture(t, { mode: 'public', path: '/_alpha/admin', handler: req => req.path === '/_alpha/admin/invites'
    ? { body: { invites: [] } } : { status: 401, body: {} } });
  await has(admin.page, 'Alpha administration');
  await admin.page.getByRole('button', { name: 'Open slicer' }).click();
  await has(admin.page, 'Admin sign-in');
  assert.equal(await admin.page.evaluate(() => window.mounted || 0), 0);
  assert.equal(await admin.page.evaluate(key => localStorage.getItem(key), sessionKey), null);
});

test('admin launch opens the canonical slicer destination without an invite; failure permits retry', async t => {
  let fail = true;
  const { page, requests } = await fixture(t, { path: '/_alpha/admin', savedReturn: '/prepare?admin=1#plate', handler: req => {
    if (req.path.endsWith('/admin/invites')) return { body: { invites: [] } };
    if (req.path.endsWith('/admin/open-slicer')) return fail ? { status: 503, body: {} }
      : { body: { token: 'admin-app-token', expiresAt: future() } };
    return { body: { valid: true, expiresAt: future() } };
  } });
  await has(page, 'Alpha administration');
  const open = page.getByRole('button', { name: 'Open slicer', exact: true });
  await open.click();
  await page.getByRole('alert').waitFor();
  assert.equal(await open.isEnabled(), true);
  fail = false; await open.click();
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash, '/prepare?admin=1#plate');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), 'admin-app-token');
  assert.equal(requests.some(req => req.path.endsWith('/validate')), false);
  const launch = requests.find(req => req.path.endsWith('/admin/open-slicer'));
  assert.deepEqual(launch.body, {}); assert.equal(launch.headers.authorization, undefined);
});

test('callback return stays local and unrendered; valid restore happens before reload and breaks cookie loops', async t => {
  const callback = '/orca-cloud/callback?code=sensitive-fixture&state=fixture#fragment';
  const { page, requests, output } = await fixture(t, { mode: 'public', token: 'restore-me', path: callback,
    handler: () => ({ body: { valid: true, expiresAt: future() } }) });
  await has(page, 'Access needs cookies');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('orca-alpha-return')), callback);
  assert.equal((await page.locator('body').innerText()).includes('sensitive-fixture'), false);
  assert.equal(new URL(page.url()).pathname, '/_alpha/login');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.authorization, 'Bearer restore-me');
  assert.ok(output.inputs.every(path => /src\/alpha\//.test(path)), output.inputs.join('\n'));
  const html = fs.readFileSync(app + 'alpha-bootstrap.html', 'utf8');
  assert.ok(html.includes('name="referrer" content="no-referrer"'));
});

test('tester logout revokes backend session and clears local token', async t => {
  const { page, requests } = await fixture(t, { token: 'tester-token', handler: req => req.path.endsWith('/logout')
    ? { body: { ok: true } } : { body: { valid: true, expiresAt: future() } } });
  await page.locator('.alpha-nav summary').click();
  await page.getByRole('button', { name: 'Log out of alpha' }).click();
  await has(page, 'Alpha access');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), sessionKey), null);
  assert.equal(requests.at(-1).path, '/_alpha/logout');
  assert.equal(requests.at(-1).headers.authorization, 'Bearer tester-token');
});

test('session expiry closes the mounted app without waiting for focus', async t => {
  let checks = 0;
  const { page } = await fixture(t, { token: 'expiring-token', handler: () => ++checks === 1
    ? { body: { valid: true, expiresAt: new Date(Date.now() + 300).toISOString() } }
    : { status: 401, body: {} } });
  await page.getByText('APP MOUNTED', { exact: true }).waitFor();
  await has(page, 'Alpha access');
  assert.equal(await page.evaluate(() => window.unmounted), 1);
});

test('captured callback survives main HTML scrubbing; unsafe return targets are replaced locally', async t => {
  const callback = 'https://alpha.test/orca-cloud/callback?code=local-only&state=fixture';
  const { page, close } = await fixture(t, { capturedCallback: callback, handler: () => ({ status: 401, body: {} }) });
  await has(page, 'Alpha access');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('orca-alpha-return')), '/orca-cloud/callback?code=local-only&state=fixture');
  assert.ok(!(await page.locator('body').innerText()).includes('local-only'));
  await close();
  for (const savedReturn of ['//external.invalid/steal', '/\\external.invalid/steal', '/_alpha/admin']) {
    const f = await fixture(t, { mode: 'public', path: '/_alpha/login', savedReturn });
    await has(f.page, 'Alpha access');
    assert.equal(await f.page.evaluate(() => sessionStorage.getItem('orca-alpha-return')), '/');
    await f.close();
  }
});

test('expired admin action returns to sign-in and never mounts the tester app', async t => {
  let expired = false;
  const { page } = await fixture(t, { mode: 'public', path: '/_alpha/admin', handler: () => expired
    ? { status: 401, body: {} } : { body: { invites: [] } } });
  await has(page, 'Alpha administration'); expired = true;
  await page.getByRole('button', { name: 'Create code' }).click();
  await has(page, 'Admin sign-in');
  assert.equal(await page.evaluate(() => window.mounted || 0), 0);
});
