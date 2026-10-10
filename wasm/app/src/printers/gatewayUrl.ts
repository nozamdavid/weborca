import type { PhysicalPrinter } from './types';

export interface GatewayStatus {
  enabled: boolean;
  mode: 'off' | 'private' | 'list';
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

/** Splits a hostname, IP or URL into scheme, host:port and base path, like desktop's print_host field. */
export function parseHost(input: string): { scheme: 'http' | 'https'; hostPort: string; basePath: string } {
  const trimmed = input.trim();
  if (/\s/.test(trimmed)) throw new Error(`Invalid address: ${input}`); // browsers percent-encode spaces in a host instead of rejecting them
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported address: ${input}`);
  return { scheme: url.protocol === 'https:' ? 'https' : 'http', hostPort: url.host, basePath: url.pathname.replace(/\/+$/, '') };
}

const withSlash = (path: string) => (path.startsWith('/') ? path : `/${path}`);

/** URL for an HTTP request to the printer, through the gateway or direct. */
export function httpUrl(printer: PhysicalPrinter, path: string): string {
  const { scheme, hostPort, basePath } = parseHost(printer.print_host);
  return printer.use_gateway
    ? `/_printer/${scheme}/${hostPort}${basePath}${withSlash(path)}`
    : `${scheme}://${hostPort}${basePath}${withSlash(path)}`;
}

/** URL for a websocket to the printer, through the gateway or direct. */
export function wsUrl(printer: PhysicalPrinter, path: string): string {
  const { scheme, hostPort, basePath } = parseHost(printer.print_host);
  const wsScheme = scheme === 'https' ? 'wss' : 'ws';
  if (printer.use_gateway) {
    const pageScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${pageScheme}//${window.location.host}/_printer/${wsScheme}/${hostPort}${basePath}${withSlash(path)}`;
  }
  return `${wsScheme}://${hostPort}${basePath}${withSlash(path)}`;
}

/** Websocket URL of the gateway's Bambu MQTT bridge. */
export function bambuMqttUrl(printer: PhysicalPrinter): string {
  const { hostPort } = parseHost(printer.print_host);
  const pageScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${pageScheme}//${window.location.host}/_printer/bambu/mqtt/${hostPort}`;
}

/** Headers carrying the printer's credentials. Digest credentials are used by the gateway, never sent to the printer as is. */
export function authHeaders(printer: PhysicalPrinter): Record<string, string> {
  const headers: Record<string, string> = {};
  if (printer.printhost_apikey) headers['X-Api-Key'] = printer.printhost_apikey;
  if (printer.host_type === 'prusalink' && printer.printhost_password && printer.use_gateway) {
    headers['x-orca-auth'] = `digest ${printer.printhost_user || 'maker'}:${printer.printhost_password}`;
  }
  return headers;
}

/** Turns a failed request into a message that says what to do, e.g. when the gateway is off or CORS blocks a direct call. */
export async function describeFetchFailure(printer: PhysicalPrinter, res?: Response, error?: unknown): Promise<string> {
  if (res) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401) return 'The printer rejected the credentials (401). Check the API key or password.';
    return body ? `${res.status}: ${body}` : `The printer answered with status ${res.status}.`;
  }
  const status = printer.use_gateway ? await fetchGatewayStatus() : undefined;
  if (printer.use_gateway && !status) {
    return 'This server has no printer gateway. Turn off "Use the app server as gateway" to connect directly, or host the app with the gateway.';
  }
  if (!printer.use_gateway) {
    return 'The browser could not reach the printer. It may not allow this site (CORS), or the address is wrong. Try the app server gateway.';
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
