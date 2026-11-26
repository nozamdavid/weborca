import { HOST_CAPABILITIES, type HostType, type PhysicalPrinter, type PrinterState } from './types';
import type { OctoEverywhereCapabilities, OctoEverywhereCameraList, OctoEverywhereConnection, OctoEverywhereInfo, OctoEverywhereStatus } from './octoEverywhereTypes';

const OCTOEVERYWHERE_SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.octoeverywhere\.com$/i;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function isOctoEverywhereConnection(value: unknown): value is OctoEverywhereConnection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const c = value as OctoEverywhereConnection;
  const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(v);
  if (![c.connectionId, c.appApiToken, c.printerName].every(text)) return false;
  if ((c.printerId !== undefined && !text(c.printerId)) ||
      (c.nativeApiKey !== undefined && !text(c.nativeApiKey)) ||
      (c.lastKnownLocalIp !== undefined && !text(c.lastKnownLocalIp))) return false;
  try {
    const url = new URL(c.url);
    if (url.protocol !== 'https:' || !OCTOEVERYWHERE_SUBDOMAIN_RE.test(url.hostname) ||
        url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return false;
    if (!safeOctoEverywhereUserUrl(c.userFacingUrl)) return false;
  } catch { return false; }
  return !!c.auth && (c.auth.type === 'none' || (c.auth.type === 'bearer' ? text(c.auth.token) :
    c.auth.type === 'basic' && text(c.auth.username) && !c.auth.username.includes(':') && text(c.auth.password)));
}

/** Normal user page only; excludes URL credentials, queries, hashes, and unsafe paths. */
export function safeOctoEverywhereUserUrl(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash) return;
    const raw = /^https:\/\/[^/?#]+(\/[^?#]*)?$/i.exec(value);
    if (!raw) return;
    const rawPath = raw[1] ?? '';
    if (u.hostname === 'octoeverywhere.com') {
      if (u.pathname === '/' && (rawPath === '' || rawPath === '/')) return u.href;
      const match = /^\/view\/([^/]+)\/?$/.exec(rawPath);
      if (!match) return;
      const segment = decodeURIComponent(match[1]);
      if (!segment || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f/\\@?#%]/.test(segment)) return;
      return u.href;
    }
    if (OCTOEVERYWHERE_SUBDOMAIN_RE.test(u.hostname) && u.pathname === '/' && (rawPath === '' || rawPath === '/')) return u.href;
  } catch { /* Invalid external URL. */ }
}

export function octoEverywhereCapabilities(host: HostType, features?: number): OctoEverywhereCapabilities {
  const flags = Number.isInteger(features) && features! >= 0 ? features! : 0;
  const bambu = host === 'bambu' || host === 'bambu-cloud';
  const files = host === 'moonraker' || host === 'octoprint' || bambu;
  const roots = host === 'moonraker' ? ['gcode', 'config', 'logs'] : host === 'octoprint' ? ['gcode', 'logs'] : bambu ? ['gcode'] : [];
  return {
    home: !!(flags & 4), jog: !!(flags & 2), extrude: !!(flags & 8), temps: !!(flags & 16), fan: false, speed: false,
    job: false, lights: !!(flags & 1), start: !!(flags & 32), files,
    rawGcodeUpload: files, rawGcodeStart: files && !bambu && !!(flags & 32),
    sendReason: bambu ? 'Bambu project printing requires a compatible 3MF package; slicer G-code is not a supported project package.' :
      !files ? 'Common file transfer is unavailable for this host.' : undefined,
    fileRoots: { list: [...roots], download: [...roots], upload: files ? host === 'moonraker' ? ['gcode', 'config'] : ['gcode'] : [],
      delete: files ? host === 'moonraker' ? ['gcode', 'config'] : [...roots] : [], details: files ? ['gcode'] : [] }
  };
}

export function getEffectivePrinterCapabilities(printer: PhysicalPrinter, state?: PrinterState) {
  return printer.octoeverywhere?.mode === 'remote'
    ? state?.octoeverywhere?.capabilities ?? octoEverywhereCapabilities(printer.host_type)
    : HOST_CAPABILITIES[printer.host_type];
}

export function normalizeOctoEverywhereCameras(list?: OctoEverywhereCameraList) {
  return (list?.Webcams ?? []).map((camera, index) => ({ index, name: camera.Name ?? `Camera ${index + 1}`,
    enabled: camera.Enabled, flipH: camera.FlipH, flipV: camera.FlipV, rotation: camera.Rotation }));
}

export function normalizeOctoEverywhereStatus(result: OctoEverywhereStatus, host: HostType, info?: OctoEverywhereInfo): PrinterState {
  const job = result.JobStatus;
  const print = job?.CurrentPrint;
  const material = job?.MaterialSystem;
  const temps = print?.Temps;
  const states: Record<string, PrinterState['state']> = { idle: 'ready', warmingup: 'printing', printing: 'printing', paused: 'paused',
    resuming: 'printing', complete: 'complete', cancelled: 'ready', error: 'error', offline: 'offline' };
  const state = info?.IsOnline === false ? 'offline' : states[job?.State ?? ''] ?? 'unknown';
  const heaters: PrinterState['heaters'] = [];
  for (const [prefix, id, label, kind] of [['Bed', 'bed', 'Bed', 'bed'], ['Hotend', 'extruder', 'Hotend', 'extruder'],
    ['Chamber', 'chamber', 'Chamber', 'chamber']] as const) {
    const current = temps?.[`${prefix}Actual`]; const target = temps?.[`${prefix}Target`];
    if (finite(current) && finite(target)) heaters.push({ id, label, kind, current, target });
  }
  const tools = material?.Tools;
  if (tools?.length) {
    const reported = tools.filter(t => finite(t.ActualCelsius) && finite(t.TargetCelsius));
    if (reported.length) {
      const hotend = heaters.findIndex(h => h.kind === 'extruder');
      if (hotend >= 0) heaters.splice(hotend, 1);
      for (const tool of reported) heaters.push({ id: tool.Id, label: tool.Name ?? tool.Id, kind: 'extruder', current: tool.ActualCelsius!, target: tool.TargetCelsius! });
    }
  }
  const capabilities = octoEverywhereCapabilities(host, result.Features);
  capabilities.job = state === 'printing' || state === 'paused';
  return {
    state, message: job?.Error ?? job?.SubState ?? undefined, heaters, fans: [],
    progress: finite(print?.Progress) ? Math.max(0, Math.min(1, print.Progress / 100)) : undefined,
    file: print?.FileName ?? undefined, elapsed: finite(print?.DurationSec) ? print.DurationSec : undefined,
    remaining: finite(print?.TimeLeftSec) ? print.TimeLeftSec : undefined,
    layer: finite(print?.CurrentLayer) ? { current: print.CurrentLayer, total: finite(print?.TotalLayers) ? print.TotalLayers : undefined } : undefined,
    activeTool: tools?.find(t => t.IsActive === true)?.Id,
    filamentSlots: material?.Sources?.map(s => ({ id: s.Id, label: s.Name ?? s.Id, material: s.Material?.Type ?? '',
      color: /^[0-9a-f]{6}$/i.test(s.Material?.ColorHex ?? '') ? `#${s.Material!.ColorHex}` : undefined,
      presence: s.IsEmpty === true ? 'empty' : s.IsEmpty === false ? 'present' : 'unknown', vendor: s.Material?.Manufacturer })),
    software: result.PlatformVersion,
    octoeverywhere: { capabilities, info, health: info?.IsOnline === false ? 'offline' : job ? 'online' : 'unknown',
      lights: job?.Lights, materialSystem: material, cameras: normalizeOctoEverywhereCameras(result.ListWebcams), temperatures: temps }
  };
}
