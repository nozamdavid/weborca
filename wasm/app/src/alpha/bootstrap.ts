import './bootstrap.css';

const SESSION = 'orca-alpha-session';
const RETURN = 'orca-alpha-return';
const RELOAD = 'orca-alpha-reloading';
type Session = { valid?: boolean; token?: string; expiresAt: string };
type Invite = { id: string; email: string; username: string; note: string; createdAt: string;
  usedAt: string | null; lastUsedAt: string | null; useCount: number; revoked: boolean };
class ApiError extends Error { constructor(public status: number) { super('Alpha request failed'); } }
function storage(kind: 'localStorage' | 'sessionStorage', key: string, value?: string | null): string | null {
  try {
    const store = window[kind];
    if (value === undefined) return store.getItem(key);
    if (value === null) store.removeItem(key); else store.setItem(key, value);
    return store.getItem(key);
  } catch { return null; }
}
export function safeReturn(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/';
  const url = new URL(value, location.origin);
  if (url.origin !== location.origin || /^\/(?:_alpha(?:\/|$)|alpha-public(?:\/|$)|alpha-bootstrap\.html)/.test(url.pathname)) return '/';
  return url.pathname + url.search + url.hash;
}
let target = '/';
let testerToken: string | null = null;
let pendingLogout: string | null = null;
let appStart: (() => Promise<unknown>) | undefined;
let appStop: (() => void | Promise<void>) | undefined;
let appStarting: Promise<unknown> | undefined;
let appClosing: Promise<void> | undefined;
let stopGuard: (() => void) | undefined;
let root: HTMLElement;
let generation = 0;
async function api<T>(route: string, body?: object, token?: string | null, method = 'POST'): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('/_alpha' + route, {
      method: body === undefined ? 'GET' : method, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) throw new ApiError(response.status);
    return await response.json() as T;
  } finally { clearTimeout(timeout); }
}
function message(error: unknown, admin = false): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return admin ? 'Admin sign-in expired or the password was incorrect. Sign in again.' : 'This code or session is invalid, expired or revoked. Enter an active invite code.';
    if (error.status === 429) return 'Too many attempts. Wait 15 minutes, then try again.';
    if (error.status === 400) return 'Check the fields and try again.';
  }
  return 'Alpha access is unavailable. Check your connection and retry. Access remains locked.';
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text: string, action?: () => void, primary = false): HTMLButtonElement {
  const node = el('button', text, primary ? 'alpha-primary' : '');
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}
function field(form: HTMLElement, label: string, name: string, max: number, value = '', type = 'text'): HTMLInputElement {
  const wrap = el('label'); wrap.append(el('span', label));
  const input = el('input'); input.name = name; input.type = type; input.maxLength = max; input.value = value;
  input.autocomplete = type === 'password' ? 'current-password' : 'off';
  wrap.append(input); form.append(wrap); return input;
}
function status(parent: HTMLElement): HTMLElement {
  const node = el('p', '', 'alpha-status'); node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
  parent.append(node); return node;
}
function errorStatus(node: HTMLElement, error: unknown, admin = false) {
  node.textContent = message(error, admin); node.setAttribute('role', 'alert');
}
function closeApp(): Promise<void> {
  if (appClosing) return appClosing;
  if (!appStop && !appStarting) return Promise.resolve();
  // Keep React's DOM intact until its recovery write commits. Hide portals too.
  document.body.classList.add('alpha-locked');
  root.inert = true;
  const screen = el('section', undefined, 'alpha-ui alpha-lock-screen');
  const content = el('main', undefined, 'alpha-page');
  const heading = el('h1', 'Saving recovery backup'); heading.tabIndex = -1;
  const feedback = el('p', 'Access is locked. Keep this tab open while your project is saved.', 'alpha-lead');
  feedback.setAttribute('role', 'status');
  content.append(heading, feedback); screen.append(content); document.body.append(screen); heading.focus();
  screen.addEventListener('keydown', event => event.stopPropagation());
  appClosing = (async () => {
    try { await appStarting; } catch { /* Startup failed before returning a mounted app. */ }
    while (appStop) {
      try { await appStop(); appStop = undefined; }
      catch {
        heading.textContent = 'Recovery backup needs a retry';
        feedback.textContent = 'Your project is still held in this tab. Keep it open. Wait for any current edit to finish, then retry saving before continuing.';
        await new Promise<void>(resolve => {
          const retry = button('Retry saving recovery', () => { retry.remove(); resolve(); }, true);
          content.append(retry); retry.focus();
        });
        heading.textContent = 'Saving recovery backup';
      }
    }
    screen.remove(); root.inert = false; document.body.classList.remove('alpha-locked');
  })().finally(() => { appClosing = undefined; });
  return appClosing;
}
async function page(title: string, intro: string, wide = false): Promise<HTMLElement | undefined> {
  const current = ++generation;
  stopGuard?.(); stopGuard = undefined;
  await closeApp();
  if (current !== generation) return;
  root = document.getElementById('root')!;
  root.replaceChildren(); root.className = 'alpha-ui';
  const main = el('main', undefined, wide ? 'alpha-page alpha-wide' : 'alpha-page');
  const brand = el('header', undefined, 'alpha-brand');
  brand.append(el('span', 'WebOrca', 'alpha-wordmark'), el('span', 'Alpha', 'alpha-edition'));
  main.append(brand);
  const heading = el('h1', title); heading.tabIndex = -1;
  main.append(heading, el('p', intro, 'alpha-lead')); root.append(main);
  heading.focus(); return main;
}
async function busy(form: HTMLFormElement, submit: HTMLButtonElement, work: () => Promise<void>) {
  form.setAttribute('aria-busy', 'true'); submit.disabled = true;
  try { await work(); } finally { form.removeAttribute('aria-busy'); submit.disabled = false; }
}
function rememberTarget() {
  let current = location.pathname + location.search + location.hash;
  const win = window as Window & { __orcaCloudCallback?: string; __octoEverywhereCallback?: string };
  const captured = location.pathname === '/orca-cloud/callback'
    ? win.__orcaCloudCallback
    : location.pathname === '/octoeverywhere/callback'
      ? win.__octoEverywhereCallback
      : undefined;
  if (captured) {
    const callback = new URL(captured, location.origin);
    if (callback.origin === location.origin) current = callback.pathname + callback.search + callback.hash;
  }
  target = /^\/_alpha(?:\/|$)|^\/alpha-bootstrap\.html$/.test(location.pathname)
    ? safeReturn(storage('sessionStorage', RETURN)) : safeReturn(current);
  storage('sessionStorage', RETURN, target);
}
async function validate(): Promise<Session> {
  const current = generation;
  testerToken = storage('localStorage', SESSION) || testerToken;
  const credential = testerToken;
  try {
    const session = await api<Session>('/session', undefined, credential);
    if (current !== generation) throw new DOMException('Obsolete session check', 'AbortError');
    if (session.valid !== true || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) throw new ApiError(401);
    return session;
  } catch (error) {
    if (current === generation && credential === testerToken && error instanceof ApiError && error.status === 401) {
      storage('localStorage', SESSION, null); testerToken = null;
    }
    throw error;
  }
}
async function openApp(session: Session) {
  const current = generation;
  if (appClosing || appStarting || appStop) return;
  if (appStart) {
    storage('sessionStorage', RELOAD, null);
    history.replaceState(null, '', target);
    root.className = ''; root.replaceChildren();
    appStarting = appStart().then(cleanup => {
      if (typeof cleanup === 'function') appStop = cleanup as () => void | Promise<void>;
    });
    try { await appStarting; } finally { appStarting = undefined; }
    if (current !== generation) return;
    installGuard(session); return;
  }
  // A successful session check has restored the HttpOnly asset cookie before navigation.
  const saved = storage('sessionStorage', RELOAD, '1');
  if (!saved) {
    const main = await page('Access confirmed', 'Browser storage is unavailable. Open the app to continue. If access stays locked, enable cookies for this site.');
    if (!main) return;
    main.append(button('Open app', () => location.replace(target), true)); return;
  }
  location.replace(target);
}
async function testerPage(initial?: string) {
  const main = await page('Alpha access', 'Enter your invite code to open Orca Web.');
  if (!main) return;
  const current = generation;
  const form = el('form'); const code = field(form, 'Invite code', 'code', 256);
  code.required = true; code.spellcheck = false; code.autocapitalize = 'none';
  const feedback = status(form); feedback.id = 'alpha-code-status';
  code.setAttribute('aria-describedby', feedback.id);
  if (initial) feedback.textContent = initial;
  const submit = button('Continue', undefined, true); submit.type = 'submit'; form.append(submit);
  form.addEventListener('submit', event => {
    event.preventDefault(); void busy(form, submit, async () => {
      feedback.textContent = 'Checking invite code…'; code.removeAttribute('aria-invalid');
      try {
        const session = await api<Session>('/validate', { code: code.value.trim() });
        if (current !== generation) return;
        if (!session.token || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) throw new ApiError(401);
        testerToken = session.token; storage('localStorage', SESSION, testerToken); code.value = '';
        const checked = await validate();
        if (current === generation) await openApp(checked);
      } catch (error) { if (current !== generation) return; errorStatus(feedback, error); code.setAttribute('aria-invalid', 'true'); code.focus(); }
    });
  });
  main.append(form, button('Retry session', () => void restore()), button('Login as admin', () => {
    history.pushState(null, '', '/_alpha/admin'); void adminPage();
  }));
}
async function restore() {
  if (!await page('Checking access', 'Validating your session…')) return;
  const current = generation;
  try {
    const session = await validate();
    if (current !== generation) return;
    if (!appStart && storage('sessionStorage', RELOAD)) {
      storage('sessionStorage', RELOAD, null);
      const main = await page('Access needs cookies', 'Your session is valid, but the app could not open. Enable cookies for this site, then retry.');
      if (!main) return;
      main.append(button('Retry opening app', () => void openApp(session), true), button('Use another code', () => testerPage()));
      return;
    }
    await openApp(session);
  } catch (error) { if (current === generation) testerPage(message(error)); }
}
function installGuard(session: Session) {
  const nav = el('details', undefined, 'alpha-ui alpha-nav');
  const summary = el('summary', 'Alpha access');
  const actions = el('nav', undefined, 'alpha-nav-actions'); actions.setAttribute('aria-label', 'Alpha access');
  actions.append(button('Alpha admin', () => {
    storage('sessionStorage', RETURN, safeReturn(location.pathname + location.search + location.hash));
    history.pushState(null, '', '/_alpha/admin'); void adminPage();
  }),
    button('Log out of alpha', () => void logout())); nav.append(summary, actions); document.body.append(nav);
  nav.addEventListener('keydown', event => { if (event.key === 'Escape') { nav.open = false; summary.focus(); } });
  const place = () => {
    const slot = [...document.querySelectorAll<HTMLElement>('[data-alpha-access-slot]')].find(node => node.getClientRects().length);
    if (slot && nav.parentElement !== slot) slot.append(nav);
  };
  const observer = new MutationObserver(place); observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('resize', place); place();
  let checking = false, stopped = false;
  const current = generation;
  const check = async () => {
    if (checking || stopped || current !== generation) return; checking = true;
    try { const next = await validate(); session = next; } catch (error) {
      if (!stopped && current === generation) { nav.remove(); stopGuard?.(); testerPage(message(error)); }
    } finally { checking = false; }
  };
  const timer = setInterval(() => { if (Date.now() >= Date.parse(session.expiresAt) || document.visibilityState === 'visible') void check(); }, 60000);
  const visibility = () => { if (document.visibilityState === 'visible') void check(); };
  document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', check);
  const expiry = setTimeout(() => void check(), Math.max(0, Math.min(2147483647, Date.parse(session.expiresAt) - Date.now())));
  const storageChange = (event: StorageEvent) => { if (event.key === SESSION) void check(); };
  window.addEventListener('storage', storageChange);
  stopGuard = () => { stopped = true; clearInterval(timer); clearTimeout(expiry); observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('storage', storageChange); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', check); nav.remove(); };
}
async function logout() {
  const current = ++generation;
  const token = pendingLogout || storage('localStorage', SESSION) || testerToken;
  pendingLogout = token;
  storage('localStorage', SESSION, null); testerToken = null;
  stopGuard?.();
  const closed = closeApp();
  try { await api('/logout', {}, token); pendingLogout = null; await closed;
    if (current === generation) await testerPage('You have logged out of alpha.'); }
  catch {
    await closed;
    if (current !== generation) return;
    const main = await page('Logout needs a retry', 'The saved token was removed. The server could not clear your cookie. Retry logout before leaving this browser.');
    if (!main) return;
    main.append(button('Retry logout', () => void logout(), true));
  }
}
function date(value: string | null): string { return value ? new Date(value).toLocaleString() : 'Unused'; }
async function adminApi<T>(route: string, body?: object, method = 'POST'): Promise<T> {
  const current = generation;
  try { return await api<T>(route, body, null, method); }
  catch (error) {
    if (current === generation && error instanceof ApiError && error.status === 401) void adminLogin();
    throw error;
  }
}
function labels(form: HTMLElement, invite?: Invite) {
  const email = field(form, 'Email (internal, optional)', 'email', 320, invite?.email, 'email');
  const username = field(form, 'Username (internal, optional)', 'username', 100, invite?.username);
  const note = field(form, 'Note (internal, optional)', 'note', 1000, invite?.note);
  return () => ({ email: email.value, username: username.value, note: note.value });
}
async function adminPage() {
  const main = await page('Alpha administration', 'Invite labels are internal. Creating a code does not send an invitation.', true);
  if (!main) return;
  const current = generation;
  const feedback = status(main); feedback.textContent = 'Checking admin session…';
  try {
    const { invites } = await adminApi<{ invites: Invite[] }>('/admin/invites');
    if (current !== generation) return;
    feedback.textContent = '';
    const actions = el('div', undefined, 'alpha-actions');
    const open = button('Open slicer', async () => {
      open.disabled = true; feedback.textContent = 'Opening slicer…';
      try {
        const session = await adminApi<Session>('/admin/open-slicer', {});
        if (current !== generation) return;
        if (!session.token || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) throw new ApiError(401);
        testerToken = session.token; storage('localStorage', SESSION, testerToken);
        const checked = await validate();
        if (current === generation) { ++generation; await openApp(checked); }
      } catch (error) { if (current === generation) { errorStatus(feedback, error, true); open.focus(); } }
      finally { open.disabled = false; }
    }, true);
    actions.append(open,
      button('Admin logout', async () => {
        try { await adminApi('/admin/logout', {}); if (current === generation) await adminLogin(); } catch (error) { errorStatus(feedback, error, true); }
      })); main.append(actions);
    const create = el('form', undefined, 'alpha-create'); create.append(el('h2', 'Create invite code'));
    const values = labels(create); const createStatus = status(create);
    const once = el('section', undefined, 'alpha-once'); once.hidden = true;
    const submit = button('Create code', undefined, true); submit.type = 'submit'; create.append(submit);
    create.addEventListener('submit', event => {
      event.preventDefault(); void busy(create, submit, async () => {
        once.replaceChildren(); once.hidden = true; createStatus.textContent = 'Creating code…';
        try {
          const result = await adminApi<{ invite: Invite; code: string }>('/admin/invites', values());
          create.reset(); createStatus.textContent = 'Code created.';
          const heading = el('h3', 'Copy this code now');
          const raw = field(once, 'New invite code (shown once)', 'new-code', 256, result.code); raw.readOnly = true;
          const copyStatus = status(once);
          once.prepend(heading, el('p', 'It cannot be retrieved after you dismiss it or leave this page.'));
          once.append(button('Copy code', async () => {
            try { await navigator.clipboard.writeText(raw.value); copyStatus.textContent = 'Code copied.'; }
            catch { raw.focus(); raw.select(); copyStatus.textContent = 'Copy is unavailable. Select and copy the code manually.'; }
          }), button('Dismiss code', () => { raw.value = ''; once.replaceChildren(); once.hidden = true; submit.focus(); }));
          list.querySelector('.alpha-empty')?.remove();
          once.hidden = false; list.prepend(inviteRow(result.invite)); raw.focus(); raw.select();
        } catch (error) { errorStatus(createStatus, error, true); }
      });
    });
    const workspace = el('div', undefined, 'alpha-workspace');
    const composer = el('aside', undefined, 'alpha-composer'); composer.append(create, once);
    const registry = el('section', undefined, 'alpha-registry'); registry.append(el('h2', 'Invite codes'));
    const list = el('div', undefined, 'alpha-invites');
    if (!invites.length) {
      const empty = el('div', undefined, 'alpha-empty');
      empty.append(el('h3', 'No invite codes yet.'), el('p', 'Create a code, then copy and share it with your tester.'));
      list.append(empty);
    }
    for (const invite of invites) list.append(inviteRow(invite));
    registry.append(list); workspace.append(composer, registry); main.append(workspace);
  } catch (error) {
    if (current !== generation) return;
    if (error instanceof ApiError && error.status === 401) adminLogin();
    else { errorStatus(feedback, error, true); main.append(button('Retry', () => void adminPage()), button('Back to alpha access', () => testerPage())); }
  }
}
function inviteRow(invite: Invite): HTMLElement {
  const section = el('details', undefined, 'alpha-invite');
  const summary = el('summary');
  const identity = el('span', undefined, 'alpha-invite-identity');
  identity.append(el('span', invite.username || invite.email || 'Unlabelled invite', 'alpha-invite-name'));
  if (invite.username && invite.email) identity.append(el('span', invite.email, 'alpha-invite-email'));
  const state = el('span', undefined, 'alpha-invite-state');
  state.append(el('span', invite.revoked ? 'Revoked' : 'Active', invite.revoked ? 'alpha-badge alpha-revoked' : 'alpha-badge'),
    el('span', invite.usedAt ? 'Used' : 'Unused', 'alpha-use'));
  summary.append(identity, state);
  section.append(summary);
  const metadata = el('dl');
  for (const [key, value] of [['Created', date(invite.createdAt)], ['First used', date(invite.usedAt)], ['Last used', date(invite.lastUsedAt)], ['Use count', String(invite.useCount)]]) metadata.append(el('dt', key), el('dd', value));
  const form = el('form'); const values = labels(form, invite); const feedback = status(form);
  const save = button('Save labels'); save.type = 'submit'; form.append(save);
  form.addEventListener('submit', event => { event.preventDefault(); void busy(form, save, async () => {
    feedback.textContent = 'Saving labels…';
    try { const result = await adminApi<{ invite: Invite }>('/admin/invites/' + encodeURIComponent(invite.id), values(), 'PATCH'); section.replaceWith(inviteRow(result.invite)); }
    catch (error) { errorStatus(feedback, error, true); }
  }); });
  const revoke = button(invite.revoked ? 'Restore code' : 'Revoke code', async () => {
    revoke.disabled = true; feedback.textContent = invite.revoked ? 'Restoring code…' : 'Revoking code…';
    try {
      const result = await adminApi<{ invite: Invite }>('/admin/invites/' + encodeURIComponent(invite.id), { revoked: !invite.revoked }, 'PATCH');
      section.replaceWith(inviteRow(result.invite));
    } catch (error) { errorStatus(feedback, error, true); revoke.disabled = false; }
  });
  form.append(el('p', 'Revoking a code ends its tester sessions. Restoring it requires testers to enter the code again.'), revoke);
  section.append(metadata, form); return section;
}
async function adminLogin() {
  const main = await page('Admin sign-in', 'Use the administrator password to manage invite codes.');
  if (!main) return;
  const current = generation;
  const form = el('form'); const password = field(form, 'Admin password', 'password', 1024, '', 'password'); password.required = true;
  const feedback = status(form); const submit = button('Sign in as admin', undefined, true); submit.type = 'submit'; form.append(submit);
  form.addEventListener('submit', event => { event.preventDefault(); void busy(form, submit, async () => {
    feedback.textContent = 'Signing in…'; const secret = password.value; password.value = '';
    try { await api('/admin/login', { password: secret }); if (current === generation) await adminPage(); }
    catch (error) { if (current === generation) { errorStatus(feedback, error, true); password.focus(); } }
  }); });
  main.append(form, button('Back to alpha access', () => { history.replaceState(null, '', '/_alpha/login'); testerPage(); }));
}
export async function authorizeApp(start: () => Promise<unknown>) {
  appStart = start; rememberTarget(); root = document.getElementById('root')!;
  if (location.pathname === '/_alpha/admin') await adminPage(); else await restore();
}
if (document.body.hasAttribute('data-alpha-bootstrap')) {
  rememberTarget();
  // Retain callback credentials locally and remove them from the rendered page URL/referrer.
  if (location.pathname !== '/_alpha/admin') history.replaceState(null, '', '/_alpha/login');
  if (location.pathname === '/_alpha/admin') void adminPage(); else void restore();
  window.addEventListener('popstate', () => { if (location.pathname === '/_alpha/admin') void adminPage(); else void restore(); });
}
