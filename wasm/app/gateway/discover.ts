/**
 * Printer discovery for the local gateway: finds Moonraker, OctoPrint, PrusaLink and Bambu Lab printers on the
 * computer's own private subnets. Every probe is a GET (or a UDP query), so it is safe in read-only mode, and the
 * targets come from the network interfaces, never from the caller.
 */
import * as dgram from 'node:dgram';
import * as os from 'node:os';

export type DiscoveredType = 'moonraker' | 'octoprint' | 'prusalink' | 'bambu';

export interface DiscoveredPrinter {
  host_type: DiscoveredType;
  /** Address to put in the printer's host field. */
  host: string;
  name?: string;
  serial?: string;
  detail?: string;
}

export interface DiscoverOptions {
  /** Addresses to scan instead of the local /24 networks (tests). */
  hosts?: string[];
  /** HTTP ports to probe on every host. */
  ports?: number[];
  /** Where the Bambu SSDP search goes; the multicast group by default (tests). */
  ssdp?: { address: string; port: number } | false;
  timeoutMs?: number;
  /** How long to wait for SSDP answers. */
  ssdpMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

const DEFAULT_PORTS = [7125, 80, 5000];
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|vEthernet|tailscale|utun|zt|wg|tun|tap|pelican)/i;
const MAX_HOSTS = 1024;
const SSDP_GROUP = { address: '239.255.255.250', port: 1990 };

/** Every address of the /24 networks this computer is on (private ranges only), without its own. */
export function localScanHosts(interfaces = os.networkInterfaces()): string[] {
  const hosts = new Set<string>();
  for (const [name, addresses] of Object.entries(interfaces)) {
    // Container bridges and VPN tunnels are not where printers are, and a Docker host has dozens of them.
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const a of addresses ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.netmask === '255.255.255.255') continue;
      const [o1, o2, o3] = a.address.split('.').map(Number);
      const isPrivate = o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168);
      if (!isPrivate) continue;
      for (let i = 1; i < 255; i++) if (`${o1}.${o2}.${o3}.${i}` !== a.address) hosts.add(`${o1}.${o2}.${o3}.${i}`);
    }
  }
  return [...hosts].slice(0, MAX_HOSTS);
}

async function get(url: string, timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(url, { redirect: 'follow', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  return { res, text: (await res.text().catch(() => '')).slice(0, 65536) };
}

const asJson = (text: string): any => {
  try { return JSON.parse(text); } catch { return undefined; }
};

/** Identifies what answers on `ip:port`, if it is a printer server we support. */
async function probe(ip: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<DiscoveredPrinter | undefined> {
  const base = `http://${ip}:${port}`;
  try {
    const info = await get(`${base}/server/info`, timeoutMs, signal);
    const result = info.res.ok ? asJson(info.text)?.result : undefined;
    if (result && (result.klippy_state || result.moonraker_version)) {
      return { host_type: 'moonraker', host: port === 80 ? ip : `${ip}:${port}`, detail: `Moonraker ${result.moonraker_version ?? ''}`.trim() };
    }
    const version = await get(`${base}/api/version`, timeoutMs, signal);
    const text = String(asJson(version.text)?.text ?? '');
    const host = port === 80 ? ip : `${ip}:${port}`;
    if (/^PrusaLink/i.test(text) || (version.res.status === 401 && /digest/i.test(version.res.headers.get('www-authenticate') ?? ''))) {
      return { host_type: 'prusalink', host, detail: text || 'PrusaLink' };
    }
    if (/^OctoPrint/i.test(text)) return { host_type: 'octoprint', host, detail: text };
    if (version.res.status === 403) {
      // OctoPrint answers /api/version with 403 until an API key is sent; its login page names it.
      const page = await get(`${base}/`, timeoutMs, signal);
      if (/<title>[^<]*OctoPrint/i.test(page.text)) return { host_type: 'octoprint', host, detail: 'OctoPrint' };
    }
  } catch {
    // closed, filtered or not HTTP: not a printer
  }
  return undefined;
}

/** Bambu Lab printers answer an SSDP M-SEARCH on UDP 1990 with their serial number and address. */
function searchBambu(options: DiscoverOptions, onFound: (printer: DiscoveredPrinter) => void): Promise<void> {
  const target = options.ssdp === false ? undefined : options.ssdp ?? SSDP_GROUP;
  if (!target || options.signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { socket.close(); } catch { /* already closed */ } resolve(); };
    const timer = setTimeout(done, options.ssdpMs ?? 3000);
    options.signal?.addEventListener('abort', () => { clearTimeout(timer); done(); }, { once: true });
    socket.on('error', () => { clearTimeout(timer); done(); });
    socket.on('message', (message, remote) => {
      const lines = message.toString('utf8').split(/\r?\n/);
      const header = (name: string) => lines.find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim();
      const usn = header('USN');
      if (!usn || !(header('ST') ?? header('NT') ?? '').toLowerCase().includes('bambulab')) return;
      const host = (header('Location') ?? remote.address).replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
      onFound({ host_type: 'bambu', host, serial: usn, name: header('DevName.bambu.com'), detail: header('DevModel.bambu.com') });
    });
    socket.bind(0, () => {
      const request = `M-SEARCH * HTTP/1.1\r\nHOST: ${target.address}:${target.port}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:bambulab-com:device:3dprinter:1\r\n\r\n`;
      socket.send(request, target.port, target.address, (error) => { if (error) { clearTimeout(timer); done(); } });
    });
  });
}

/** Scans the networks and reports each printer once, as it is found. Resolves when the scan is complete. */
export async function discoverPrinters(options: DiscoverOptions, onFound: (printer: DiscoveredPrinter) => void): Promise<void> {
  const seen = new Set<string>();
  const report = (printer: DiscoveredPrinter) => {
    const key = `${printer.host_type}/${printer.host.replace(/:(7125|80)$/, '')}`;
    if (seen.has(key) || options.signal?.aborted) return;
    seen.add(key);
    onFound(printer);
  };
  const hosts = options.hosts ?? localScanHosts();
  const ports = options.ports ?? DEFAULT_PORTS;
  const timeoutMs = options.timeoutMs ?? 1500;
  let next = 0;
  const worker = async () => {
    while (next < hosts.length && !options.signal?.aborted) {
      const ip = hosts[next++];
      for (const port of ports) {
        const printer = await probe(ip, port, timeoutMs, options.signal);
        if (printer) report(printer);
      }
    }
  };
  await Promise.all([
    searchBambu(options, report),
    ...Array.from({ length: Math.min(options.concurrency ?? 48, hosts.length) }, worker)
  ]);
}
