import type { PhysicalPrinter } from './types';

export interface GatewayStatus {
  enabled: boolean;
  mode: 'off' | 'private' | 'list' | 'cloud';
  cloud?: string[];
  readOnly: boolean;
  message?: string;
}

/** Asks the app server whether the printer gateway is on. Resolves to undefined when there is no gateway (static hosting). */
export async function fetchGatewayStatus(): Promise<GatewayStatus | undefined> {
  try {
    const res = await fetch('/_printer/status');
    const type = res.headers.get('content-type') ?? '';
    return res.ok && type.includes('json') ? ((await res.json()) as GatewayStatus) : undefined;
  } catch {
    return undefined;
  }
}

/** WebSockets always use the app server, including for saved legacy connections. */
function gatewayOrigin(): string {
  const url = new URL(window.location.origin);
  return `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
}

/** Splits a hostname, IP or URL into scheme, host:port and base path, like desktop's print_host field. */
export function parseHost(input: string, defaultPort?: number): { scheme: 'http' | 'https'; hostPort: string; basePath: string } {
  const trimmed = input.trim();
  if (/\s/.test(trimmed)) throw new Error(`Invalid address: ${input}`); // browsers percent-encode spaces in a host instead of rejecting them
  const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(address);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported address: ${input}`);
  // URL.port drops explicit :80/:443, so inspect the original authority before applying a default.
  const authority = address.split('://')[1].split(/[/?#]/)[0];
  if (defaultPort && !/:\d+$/.test(authority)) url.port = String(defaultPort);
  return { scheme: url.protocol === 'https:' ? 'https' : 'http', hostPort: url.host, basePath: url.pathname.replace(/\/+$/, '') };
}

const withSlash = (path: string) => (path.startsWith('/') ? path : `/${path}`);

/** URL for an HTTP request through the app server gateway. */
export function httpUrl(printer: PhysicalPrinter, path: string): string {
  const { scheme, hostPort, basePath } = parseHost(printer.print_host);
  return `/_printer/${scheme}/${hostPort}${basePath}${withSlash(path)}`;
}

/** URL for a websocket through the app server gateway. */
export function wsUrl(printer: PhysicalPrinter, path: string): string {
  const { scheme, hostPort, basePath } = parseHost(printer.print_host);
  const wsScheme = scheme === 'https' ? 'wss' : 'ws';
  return `${gatewayOrigin()}/_printer/${wsScheme}/${hostPort}${basePath}${withSlash(path)}`;
}

/** Websocket URL of the gateway's Bambu MQTT bridge. */
export function bambuMqttUrl(printer: PhysicalPrinter): string {
  const { hostPort } = parseHost(printer.print_host);
  return `${gatewayOrigin()}/_printer/bambu/mqtt/${hostPort}`;
}

/** Websocket URL of the gateway's Bambu Cloud MQTT bridge. */
export function bambuCloudMqttUrl(_printer: PhysicalPrinter, brokerHost: string): string {
  return `${gatewayOrigin()}/_printer/bambu-cloud/mqtt/${brokerHost}`;
}

/** HTTP URL of the gateway's Bambu Cloud API bridge. */
export function bambuCloudApiUrl(_printer: PhysicalPrinter, path: string): string {
  return `/_printer/bambu-cloud/api${path.startsWith('/') ? path : '/' + path}`;
}


/** URL of the gateway's Bambu FTPS bridge. */
export function bambuFtpUrl(printer: PhysicalPrinter): string {
  const { hostPort } = parseHost(printer.print_host);
  return `/_printer/bambu/ftp/${hostPort}`;
}

/** Headers carrying the printer's credentials. Digest credentials are used by the gateway, never sent to the printer as is. */
export function authHeaders(printer: PhysicalPrinter): Record<string, string> {
  const headers: Record<string, string> = {};
  if (printer.printhost_apikey) headers['X-Api-Key'] = printer.printhost_apikey;
  if (printer.host_type === 'prusalink' && printer.printhost_password) {
    headers['x-orca-auth'] = `digest ${printer.printhost_user || 'maker'}:${printer.printhost_password}`;
  }
  return headers;
}

/** Explains a failed request, including deployments without a printer backend. */
export async function describeFetchFailure(_printer: PhysicalPrinter, res?: Response, error?: unknown): Promise<string> {
  if (res) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401) return 'The printer rejected the credentials (401). Check the API key or password.';
    return body ? `${res.status}: ${body}` : `The printer answered with status ${res.status}.`;
  }
  const status = await fetchGatewayStatus();
  if (!status) {
    return 'This server has no printer gateway. Host the app with the gateway to connect to printers.';
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * A request with upload progress (fetch has none, so XMLHttpRequest is used where it exists).
 * Rejects with the printer's answer on a non-2xx status.
 */
export async function sendWithProgress(
  method: string, url: string, headers: Record<string, string>, body: XMLHttpRequestBodyInit, onProgress?: (fraction: number) => void
): Promise<string> {
  const failure = (status: number, text: string) =>
    new Error(status === 401 ? 'The printer rejected the credentials (401).' : `The printer answered ${status}: ${text.slice(0, 300)}`);

  if (typeof XMLHttpRequest === 'undefined') {
    const res = await fetch(url, { method, headers, body: body as BodyInit });
    const text = await res.text();
    if (!res.ok) throw failure(res.status, text);
    onProgress?.(1);
    return text;
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(failure(xhr.status, xhr.responseText)));
    xhr.onerror = () => reject(new Error('The upload failed: the printer or the gateway could not be reached.'));
    xhr.send(body);
  });
}
