/**
 * Helpers for serving a printer's own web UI (Mainsail, Fluidd, OctoPrint, ...) through the gateway under
 * `/_printer/ui/<http|https>/<host[:port]>/`, so an https page can embed it without mixed-content blocking.
 *
 * Those UIs assume they live at the root of their origin: they request `/assets/...`, call `/printer/...` and open
 * `ws://<host>/websocket`. Under a path prefix that breaks, so the gateway
 *   - rewrites root-relative `src`/`href`/`action` attributes in HTML and `url(/...)` in CSS,
 *   - injects a small script that routes `fetch`, XHR, EventSource, WebSocket, Worker and dynamically set
 *     `src`/`href` through the same prefix and gives the page's router a root-relative location.
 * Everything else (scripts, JSON, images) is streamed unchanged.
 */

export const UI_ROUTE = /^\/_printer\/ui\/(http|https)\/([^/?]+)(\/[^?]*)?(\?.*)?$/;

export function uiPrefix(scheme: 'http' | 'https', hostPort: string): string {
  return `/_printer/ui/${scheme}/${hostPort}`;
}

/** Root-relative references (`/x`, not `//host/x`) that are not already under the gateway. */
const ATTRIBUTE = /(\s(?:src|href|action|poster|data-src)\s*=\s*)(["'])\/(?!\/|_printer\/)/gi;
const CSS_URL = /url\(\s*(["']?)\/(?!\/|_printer\/)/gi;

export function rewriteCss(css: string, prefix: string): string {
  return css.replace(CSS_URL, `url($1${prefix}/`);
}

/** The script injected into every proxied HTML page. */
export function uiShim(prefix: string, scheme: 'http' | 'https', hostPort: string): string {
  const config = JSON.stringify({ prefix, hostPort, wsScheme: scheme === 'https' ? 'wss' : 'ws' });
  return `(function(){var C=${config},P=C.prefix,H=C.hostPort,O=location.origin;
var rest=location.pathname.indexOf(P)===0?(location.pathname.slice(P.length)||'/'):location.pathname;
try{history.replaceState(history.state,'',rest+location.search+location.hash)}catch(e){}
function fix(u){try{var a=new URL(String(u),document.baseURI);
if(a.origin===O){if(a.pathname===P||a.pathname.indexOf(P+'/')===0||a.pathname.indexOf('/_printer/')===0)return a.href;return O+P+a.pathname+a.search+a.hash}
if(a.host===H&&(a.protocol==='http:'||a.protocol==='https:'))return O+P+a.pathname+a.search+a.hash;
return String(u)}catch(e){return u}}
function wsFix(u,fallbackBase){try{var a=new URL(String(u),fallbackBase);
if(a.host===location.host||a.host===H){var p=a.pathname;if(p===P||p.indexOf(P+'/')===0)p=p.slice(P.length)||'/';
if(p.indexOf('/_printer/')===0)return String(u);
return(location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/_printer/'+C.wsScheme+'/'+H+p+a.search}
return String(u)}catch(e){return u}}
var NW=window.WebSocket;
function WS(u,p){var n=wsFix(u,location.href);return p===undefined?new NW(n):new NW(n,p)}
WS.prototype=NW.prototype;['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){WS[k]=NW[k]});window.WebSocket=WS;
var nf=window.fetch;if(nf)window.fetch=function(i,o){if(typeof i==='string'||i instanceof URL)i=fix(i);else if(i&&i.url){var n=fix(i.url);if(n!==i.url)i=new Request(n,i)}return nf.call(this,i,o)};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=fix(u);return xo.apply(this,arguments)};
if(window.EventSource){var NE=window.EventSource;var ES=function(u,o){return new NE(fix(u),o)};ES.prototype=NE.prototype;window.EventSource=ES}
if(window.Worker){var NK=window.Worker;var WK=function(u,o){return new NK(fix(u),o)};WK.prototype=NK.prototype;window.Worker=WK}
if(navigator.sendBeacon){var sb=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){return sb(fix(u),d)}}
if(navigator.serviceWorker)navigator.serviceWorker.register=function(){return Promise.reject(new Error('Service workers are disabled in the gateway view'))};
[[HTMLScriptElement,'src'],[HTMLImageElement,'src'],[HTMLIFrameElement,'src'],[HTMLSourceElement,'src'],[HTMLMediaElement,'src'],[HTMLLinkElement,'href'],[HTMLAnchorElement,'href'],[HTMLFormElement,'action']].forEach(function(e){
var d=Object.getOwnPropertyDescriptor(e[0].prototype,e[1]);if(!d||!d.set)return;
Object.defineProperty(e[0].prototype,e[1],{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,fix(v))}})});
var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(typeof n==='string'&&/^(src|href|action|poster)$/i.test(n)&&typeof v==='string')v=fix(v);return sa.call(this,n,v)};
})();`;
}

/** Rewrites an HTML document so it works under the gateway prefix. */
export function rewriteHtml(html: string, scheme: 'http' | 'https', hostPort: string): string {
  const prefix = uiPrefix(scheme, hostPort);
  const injected = `<base href="${prefix}/"><script>${uiShim(prefix, scheme, hostPort)}</script>`;
  const body = html.replace(ATTRIBUTE, `$1$2${prefix}/`);
  const head = /<head(\s[^>]*)?>/i.exec(body);
  if (head) return body.slice(0, head.index + head[0].length) + injected + body.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(body);
  return doctype ? body.slice(0, doctype[0].length) + injected + body.slice(doctype[0].length) : injected + body;
}

/** Points a redirect of the printer back into the gateway. */
export function rewriteLocation(location: string, scheme: 'http' | 'https', hostPort: string): string {
  const prefix = uiPrefix(scheme, hostPort);
  if (location.startsWith('/') && !location.startsWith('//')) return prefix + location;
  try {
    const url = new URL(location);
    if (url.host === hostPort && url.protocol === `${scheme}:`) return prefix + url.pathname + url.search + url.hash;
  } catch {
    // relative redirect, leave as is
  }
  return location;
}
