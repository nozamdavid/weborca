// Account form protocol adapted from /home/david/PrusaSlicer/web/prusa-connect-bridge/login.go
// and trevin-lee/prusactl (MIT), commit d8b7b17d79c9c01ca1df7e923ec4f28fc6fc122e.
// Deliberately limited to password, one OTP, consent and the exact optional passkey offer.
// MIT License — Copyright (c) 2026 Trevin Lee
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
// of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { CookieJar } from 'tough-cookie';
import type { IncomingHttpHeaders } from 'node:http';

type Node = DefaultTreeAdapterMap['node'];
interface Form {
  kind: 'login' | 'otp' | 'consent' | 'offer';
  action: URL;
  hidden: URLSearchParams;
  user: string;
  password: string;
  code: string;
}
interface Page { statusCode: number; headers: IncomingHttpHeaders; body: Buffer }
export type AccountRequest = (url: string, method: string, headers: Record<string, string>, body?: string) => Promise<Page>;

const unsupported = () => new Error('Prusa Account sign-in failed. Check your password or code and start again. Social login, passkeys and CAPTCHA are unsupported.');
function attr(node: Node, name: string): string {
  return 'attrs' in node ? node.attrs.find(a => a.name === name)?.value || '' : '';
}
function tag(node: Node): string { return 'tagName' in node ? node.tagName : ''; }
function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  if ('childNodes' in node) for (const child of node.childNodes) walk(child, visit);
}
function text(node: Node): string {
  let result = '';
  walk(node, n => { if ('value' in n) result += n.value; });
  return result;
}
function exactAccount(url: URL, account: string): boolean {
  return url.origin === new URL(account).origin && !url.username && !url.password && !url.hash;
}
function resolve(raw: string, page: URL): URL {
  // WHATWG URL normalization must not turn an alternate raw path into an exact offer.
  const path = raw.split(/[?#]/, 1)[0];
  if (raw.includes('\\') || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(path)) throw unsupported();
  return new URL(raw, page);
}

function parseForm(page: URL, body: Buffer, account: string): Form {
  if (body.length > 512 * 1024 || !exactAccount(page, account)) throw unsupported();
  const root = parse(body.toString('utf8'));
  const forms: Node[] = [];
  let captcha = false;
  walk(root, n => {
    if (tag(n) === 'form' && attr(n, 'method').toLowerCase() === 'post') forms.push(n);
    if (/(?:^|\s)(?:g-recaptcha|h-captcha|cf-turnstile)(?:\s|$)/.test(attr(n, 'class'))) captcha = true;
    if (tag(n) === 'iframe') {
      const src = new URL(attr(n, 'src'), page);
      if (((src.hostname === 'www.google.com' || src.hostname === 'www.recaptcha.net') && src.pathname.startsWith('/recaptcha/')) ||
          src.hostname === 'hcaptcha.com' || src.hostname.endsWith('.hcaptcha.com') || src.hostname === 'challenges.cloudflare.com') captcha = true;
    }
  });
  if (captcha || forms.length !== 1) throw unsupported();
  const action = resolve(attr(forms[0], 'action'), page);
  if (!exactAccount(action, account)) throw unsupported();
  const hidden = new URLSearchParams();
  const fields: string[] = [];
  const controls: Node[] = [];
  let password = '', consent = false;
  walk(forms[0], n => {
    if (!['input', 'button', 'select', 'textarea'].includes(tag(n))) return;
    controls.push(n);
    const name = attr(n, 'name'), type = attr(n, 'type').toLowerCase();
    // Override buttons and external form associations are not supported.
    if (attr(n, 'formaction') || attr(n, 'formmethod') || attr(n, 'form')) throw unsupported();
    if (!name) return;
    if (type === 'hidden') {
      if (hidden.has(name)) throw unsupported();
      hidden.set(name, attr(n, 'value'));
    } else if (type === 'password') {
      if (password) throw unsupported();
      password = name;
    } else if (tag(n) === 'input' && ['', 'text', 'email', 'number', 'tel'].includes(type)) fields.push(name);
    else if (name === 'allow' && (tag(n) === 'button' || type === 'submit')) consent = true;
  });
  const user = fields.find(n => /email|user|login/.test(n)) || '';
  const code = fields.find(n => /otp|token|code/.test(n)) || '';
  let kind: Form['kind'];
  if (password && user) kind = 'login';
  else if (!password && consent) kind = 'consent';
  else if (!password && code) kind = 'otp';
  else {
    const csrf = controls.filter(n => tag(n) === 'input' && attr(n, 'type').toLowerCase() === 'hidden' && attr(n, 'name') === 'csrfmiddlewaretoken');
    const buttons = controls.filter(n => tag(n) === 'button' && attr(n, 'type').toLowerCase() === 'submit' && !attr(n, 'name') && text(n).trim() === 'Not now');
    if (page.pathname !== '/passkeys/offer/' || action.pathname !== '/passkeys/offer/' || page.search !== action.search ||
        hidden.size !== 1 || !hidden.get('csrfmiddlewaretoken') || csrf.length !== 1 || buttons.length !== 1 || controls.length !== 2) throw unsupported();
    kind = 'offer';
  }
  return { kind, action, hidden, user, password, code };
}

/** Each attempt has its own RFC cookie jar. No credentials are retained in it. */
export class PrusaAccountLogin {
  private jar = new CookieJar();
  private page: URL;
  private form?: Form;
  private remaining = 8;
  private deferred = false;
  private consented = false;
  private account: string;
  private authorization: string;
  private callback: string;
  private request: AccountRequest;
  constructor(account: string, authorization: string, callback: string, request: AccountRequest) {
    this.account = account;
    this.authorization = authorization;
    this.callback = callback;
    this.request = request;
    this.page = new URL(authorization);
  }

  private async send(url: URL, method = 'GET', values?: URLSearchParams): Promise<Page> {
    if (!exactAccount(url, this.account) || --this.remaining < 0) throw unsupported();
    const cookies = await this.jar.getCookies(url.href);
    const headers: Record<string, string> = { Accept: 'text/html', Cookie: await this.jar.getCookieString(url.href) };
    if (values) {
      const csrf = cookies.find(c => c.key === 'csrftoken')?.value;
      if (!values.get('csrfmiddlewaretoken') && csrf) values.set('csrfmiddlewaretoken', csrf);
      if (csrf) headers['X-CSRFToken'] = csrf;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers.Origin = this.page.origin;
      headers.Referer = this.page.href;
      if (Buffer.byteLength(values.toString()) > 256 * 1024) throw unsupported();
    }
    const result = await this.request(url.href, method, headers, values?.toString());
    for (const cookie of result.headers['set-cookie'] || []) await this.jar.setCookie(cookie, url.href, { ignoreError: true });
    this.page = url;
    return result;
  }
  private post(form: Form, extra: Record<string, string> = {}) {
    const values = new URLSearchParams(form.hidden);
    for (const [key, value] of Object.entries(extra)) values.set(key, value);
    return this.send(form.action, 'POST', values);
  }
  private async advance(response: Page, phase: 'login' | 'password' | 'otp'): Promise<string | Form> {
    let awaitingRoot = false;
    for (;;) {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        if (!response.headers.location) throw unsupported();
        const target = resolve(response.headers.location, this.page);
        const callback = new URL(this.callback);
        const registered = target.origin === callback.origin && target.pathname === callback.pathname;
        if (awaitingRoot) {
          const root = exactAccount(target, this.account) && target.pathname === '/' && !target.search;
          if (!root && target.href !== this.authorization && !registered) throw unsupported();
          if (target.href === this.authorization) awaitingRoot = false;
        }
        // Never request the registered Connect callback, even if it is invalid.
        if (registered) {
          if (phase === 'login') throw unsupported();
          return target.href;
        }
        response = await this.send(target);
        continue;
      }
      if (response.statusCode !== 200 || String(response.headers['content-type']).includes('json')) throw unsupported();
      if (awaitingRoot) {
        if (this.page.pathname !== '/' || this.page.search) throw unsupported();
        awaitingRoot = false;
        response = await this.send(new URL(this.authorization));
        continue;
      }
      const form = parseForm(this.page, response.body, this.account);
      if (form.kind === 'login' && phase === 'login') return form;
      if (form.kind === 'otp' && phase === 'password') { this.form = form; return form; }
      if (form.kind === 'consent' && phase !== 'login' && !this.consented &&
          form.hidden.get('client_id') === new URL(this.authorization).searchParams.get('client_id') &&
          form.hidden.get('redirect_uri') === this.callback) {
        this.consented = true;
        response = await this.post(form, { allow: 'Authorize' });
      } else if (form.kind === 'offer' && phase === 'password' && !this.deferred) {
        this.deferred = true;
        awaitingRoot = true;
        response = await this.post(form);
      } else throw unsupported();
    }
  }
  async password(email: string, password: string): Promise<string | undefined> {
    const login = await this.advance(await this.send(new URL(this.authorization)), 'login');
    if (typeof login === 'string' || login.kind !== 'login') throw unsupported();
    const result = await this.advance(await this.post(login, { [login.user]: email, [login.password]: password }), 'password');
    return typeof result === 'string' ? result : undefined;
  }
  async otp(code: string): Promise<string> {
    const form = this.form;
    this.form = undefined; // Single-use continuation, including failed codes.
    if (!form) throw unsupported();
    const result = await this.advance(await this.post(form, { [form.code]: code.replaceAll(' ', '') }), 'otp');
    if (typeof result !== 'string') throw unsupported();
    return result;
  }
}
