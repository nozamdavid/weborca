/**
 * Rules of the printer gateway (wasm/app/printerGateway.ts), kept free of I/O so they can be unit-tested:
 * which targets may be reached, what read-only mode lets through, and Digest authentication.
 * Only erasable TypeScript syntax is used so Node can run this file directly.
 */
import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export interface GatewayConfig {
  /** `private`: private, loopback, link-local and tailnet addresses only. Otherwise a comma list of host names or IPs. Unset: gateway off. */
  proxy?: string;
  /** Only allow requests that cannot change anything on the printer. */
  readOnly?: boolean;
  /** Comma list of cloud services (keys of CLOUD_SERVICES) whose https hosts may be reached in addition to `proxy`. */
  cloud?: string;
}

/** Cloud printer services the gateway can be told to reach, with the only hosts each one may use. */
export const CLOUD_SERVICES: Record<string, string[]> = {
  'prusa-connect': ['connect.prusa3d.com']
};

export function cloudHosts(config: GatewayConfig): Set<string> {
  const hosts = new Set<string>();
  for (const id of (config.cloud ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    for (const host of CLOUD_SERVICES[id] ?? []) hosts.add(host);
  }
  return hosts;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return { proxy: env.ORCA_PRINTER_PROXY?.trim() || undefined, readOnly: env.ORCA_PRINTER_PROXY_READONLY === '1', cloud: env.ORCA_PRINTER_CLOUD?.trim() || undefined };
}

export class GatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10], // CGNAT, used by tailnets
  ['127.0.0.0', 8],
  ['169.254.0.0', 16]
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, 'ipv4');
}
PRIVATE_RANGES.addAddress('::1', 'ipv6');
PRIVATE_RANGES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_RANGES.addSubnet('fe80::', 10, 'ipv6');

/** IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are checked as the IPv4 address they carry. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);
  return PRIVATE_RANGES.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export interface Target {
  /** The name or address the client asked for, also used as the Host header. */
  hostPort: string;
  host: string;
  port: number;
  /** The address that passed the check. Connect to this one, never resolve the name again (DNS rebinding). */
  address: string;
}

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

export const GATEWAY_OFF_MESSAGE =
  'The printer gateway is off. Start the app server with ORCA_PRINTER_PROXY=private (or a comma list of printer hosts) to enable it.';

export async function resolveTarget(
  hostPort: string,
  defaultPort: number,
  config: GatewayConfig,
  resolver: Resolver = systemResolver
): Promise<Target> {
  const cloud = cloudHosts(config);
  if (!config.proxy && cloud.size === 0) throw new GatewayError(403, GATEWAY_OFF_MESSAGE);

  let url: URL;
  try {
    url = new URL(`http://${hostPort}`);
  } catch {
    throw new GatewayError(400, `Invalid printer address: ${hostPort}`);
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || !url.hostname) {
    throw new GatewayError(400, `Invalid printer address: ${hostPort}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = url.port ? Number(url.port) : defaultPort;

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      throw new GatewayError(502, `Cannot resolve ${host}`);
    }
    if (addresses.length === 0) throw new GatewayError(502, `Cannot resolve ${host}`);
  }

  // A listed cloud service is reached by name over https only, so a credential never travels in the clear.
  if (!isIP(host) && cloud.has(host.toLowerCase())) {
    if (port !== 443) throw new GatewayError(403, `Target not allowed: ${host} may only be reached over https.`);
  } else if (!config.proxy) {
    throw new GatewayError(403, `Target not allowed: ${host} is not an enabled cloud service.`);
  } else if (config.proxy === 'private') {
    if (!addresses.every(isPrivateAddress)) {
      throw new GatewayError(403, `Target not allowed: ${host} is not on a private network.`);
    }
  } else {
    const allowed = config.proxy.split(',').map((s) => s.trim().toLowerCase());
    if (!allowed.includes(host.toLowerCase())) {
      throw new GatewayError(403, `Target not allowed: ${host} is not in ORCA_PRINTER_PROXY.`);
    }
  }
  return { hostPort, host, port, address: addresses[0] };
}

// ---------------------------------------------------------------------------------------------
// Read-only mode
// ---------------------------------------------------------------------------------------------

/** Path segments of Moonraker API calls that change the printer. Checked on the first three segments only. */
const MUTATING_SEGMENTS = new Set([
  'script', 'emergency_stop', 'restart', 'firmware_restart', 'reboot', 'shutdown', 'services',
  'start', 'pause', 'resume', 'cancel', 'move', 'copy', 'upload'
]);

/**
 * HTTP in read-only mode: only GET/HEAD/OPTIONS, and not the API paths that would act on a GET.
 * Read-only mode exists for testing against a real printer, so it errs on the side of blocking.
 */
export function httpAllowedInReadOnly(method: string, path: string): boolean {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  const segments = path.split('?')[0].split('/').filter(Boolean).slice(0, 3).map((s) => s.toLowerCase());
  return !segments.some((s) => MUTATING_SEGMENTS.has(s) || s.startsWith('delete'));
}

/** Moonraker JSON-RPC methods that only read. */
export const READ_ONLY_RPC_METHODS = new Set([
  'server.info', 'server.config', 'server.connection.identify', 'server.websocket.id',
  'printer.info', 'printer.objects.list', 'printer.objects.query', 'printer.objects.subscribe',
  'printer.query_endstops.status', 'printer.gcode.help',
  'server.files.list', 'server.files.metadata', 'server.files.get_directory', 'server.files.roots',
  'server.history.list', 'server.history.get_job', 'server.history.totals',
  'server.webcams.list', 'server.database.list', 'server.database.get_item',
  'server.job_queue.status', 'server.temperature_store', 'server.gcode_store',
  'machine.system_info', 'machine.proc_stats', 'machine.update.status'
]);

export interface RpcVerdict {
  forward: boolean;
  /** JSON-RPC error replies for the refused requests, to send back to the client. */
  replies: string[];
}

/** Checks one websocket frame sent by the client. Anything that is not clearly a read-only request is refused. */
export function checkRpcFrame(text: string): RpcVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { forward: false, replies: [] };
  }
  const requests = Array.isArray(parsed) ? parsed : [parsed];
  if (requests.length === 0) return { forward: false, replies: [] };

  const replies: string[] = [];
  for (const request of requests) {
    const method = request && typeof request === 'object' ? (request as { method?: unknown }).method : undefined;
    if (typeof method === 'string' && READ_ONLY_RPC_METHODS.has(method)) continue;
    const id = request && typeof request === 'object' ? ((request as { id?: unknown }).id ?? null) : null;
    replies.push(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32601, message: 'Refused by the printer gateway in read-only mode' },
      id
    }));
  }
  return { forward: replies.length === 0, replies };
}

/** Bambu MQTT requests that only ask the printer to report. */
export function bambuRequestAllowedInReadOnly(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const keys = Object.keys(payload);
  if (keys.length !== 1) return false;
  const body = (payload as Record<string, unknown>)[keys[0]];
  const command = body && typeof body === 'object' ? (body as { command?: unknown }).command : undefined;
  return (keys[0] === 'info' && command === 'get_version') || (keys[0] === 'pushing' && command === 'pushall');
}

// ---------------------------------------------------------------------------------------------
// HTTP Digest authentication (PrusaLink's default), RFC 7616 with MD5 and qop=auth
// ---------------------------------------------------------------------------------------------

export interface DigestChallenge {
  realm: string;
  nonce: string;
  opaque?: string;
  qop?: string;
  algorithm?: string;
}

export function parseDigestChallenge(header: string | undefined): DigestChallenge | undefined {
  if (!header || !/^\s*digest\s/i.test(header)) return undefined;
  const fields: Record<string, string> = {};
  for (const m of header.replace(/^\s*digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) {
    fields[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  if (!fields.realm || !fields.nonce) return undefined;
  return { realm: fields.realm, nonce: fields.nonce, opaque: fields.opaque, qop: fields.qop, algorithm: fields.algorithm };
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

export function digestAuthorization(
  challenge: DigestChallenge,
  user: string,
  password: string,
  method: string,
  uri: string,
  nonceCount: number,
  cnonce: string = randomBytes(8).toString('hex')
): string {
  const nc = nonceCount.toString(16).padStart(8, '0');
  const ha1 = md5(`${user}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method.toUpperCase()}:${uri}`);
  const useQop = challenge.qop?.split(',').map((q) => q.trim()).includes('auth');
  const response = useQop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${user}"`, `realm="${challenge.realm}"`, `nonce="${challenge.nonce}"`, `uri="${uri}"`, `response="${response}"`
  ];
  if (useQop) parts.push('qop=auth', `nc=${nc}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  return `Digest ${parts.join(', ')}`;
}
