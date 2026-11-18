import type { PhysicalPrinter } from './types';
import { fetchBambuCloudSession } from './bambuCloud';
import { fetchCrealityCloudDevices, type CrealityCloudDevice } from './crealityCloud';
import type { PrusaConnectPrinter, PrusaConnectTokens, PrusaConnectUser } from './prusaConnect';
import { samePrusaScope, usePrinterConnectionStore } from './connectionStore';
import { readSnapmakerSession, type SnapmakerSession } from './snapmakerCloud';

export function cloudScope(p: PhysicalPrinter): string {
  return JSON.stringify([p.host_type, p.print_host, p.cloud_region ?? 'global']);
}

export function savedCloudSession(draft: PhysicalPrinter, saved: PhysicalPrinter[]): PhysicalPrinter | undefined {
  const matches = (p: PhysicalPrinter) => cloudScope(p) === cloudScope(draft) && !!p.printhost_apikey &&
    (p.host_type !== 'creality-cloud' || !!p.printhost_user) &&
    (!draft.cloud_account || p.cloud_account === draft.cloud_account);
  const candidates = saved.filter(matches);
  if (draft.host_type === 'snapmaker-cloud') {
    const cached = usePrinterConnectionStore.getState().snapmakerSessions.find(p => samePrusaScope(p, draft) &&
      (!draft.cloud_account || p.cloud_account === draft.cloud_account));
    if (cached) return { ...(candidates.find(p => p.id === draft.id) ?? candidates[0] ?? draft), ...cached, id: 'snapmaker-account-session' };
  }
  if (draft.host_type === 'prusaconnect') {
    const account = draft.cloud_account ?? candidates.find(p => p.id === draft.id)?.cloud_account;
    const cached = usePrinterConnectionStore.getState().prusaSessions.find(p => samePrusaScope(p, draft) &&
      (!account || p.cloud_account === account));
    if (cached) {
      const selection = candidates.find(p => p.id === draft.id) ?? draft;
      return { ...selection, ...cached, id: 'prusa-account-session' };
    }
  }
  if (matches(draft)) return draft;
  return candidates.find(p => p.id === draft.id) ?? candidates.sort((a, b) => a.id.localeCompare(b.id))[0];
}

export interface PrusaSession { tokens: PrusaConnectTokens; user: PrusaConnectUser; printers: PrusaConnectPrinter[] }
export type CloudSession = { provider: 'prusaconnect'; data: PrusaSession; credentials: PhysicalPrinter } |
  { provider: 'snapmaker-cloud'; data: SnapmakerSession; credentials: PhysicalPrinter } |
  { provider: 'bambu-cloud'; data: Awaited<ReturnType<typeof fetchBambuCloudSession>>; credentials: PhysicalPrinter } |
  { provider: 'creality-cloud'; data: CrealityCloudDevice[]; credentials: PhysicalPrinter };

export function rejectedCloudSession(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 401 || status === 403;
}

/** Only fixed account/device endpoints; callers discard results after scope changes. */
export async function validateCloudSession(source: PhysicalPrinter, signal: AbortSignal,
  onRefresh?: (tokens: PrusaConnectTokens) => void): Promise<CloudSession> {
  const callerSignal = signal;
  signal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  if (source.host_type === 'snapmaker-cloud') return { provider: 'snapmaker-cloud', ...await readSnapmakerSession(source, signal, onRefresh) };
  if (source.host_type === 'bambu-cloud') {
    // This gateway's account API has no region selector. Never send China tokens to its global route.
    if (source.print_host !== 'us.mqtt.bambulab.com' && source.print_host !== 'mqtt.bambu-lab.com')
      throw Object.assign(new Error('Saved session validation is unavailable for this Bambu region.'), { code: 'unsupported-region' });
    const data = await fetchBambuCloudSession(source, signal);
    signal.throwIfAborted();
    return { provider: 'bambu-cloud', data, credentials: { ...source, printhost_user: data.username,
      printhost_apikey: data.token, cloud_refresh_token: data.refreshToken } };
  }
  if (source.host_type === 'creality-cloud') {
    const devices: CrealityCloudDevice[] = [];
    let total = 0;
    for (let page = 1; page <= 20; page++) {
      const { list, totalCount } = await fetchCrealityCloudDevices({ ...source, use_gateway: true }, page, 50, signal);
      signal.throwIfAborted();
      if (!Number.isSafeInteger(totalCount) || totalCount < 0 || totalCount > 1000)
        throw new Error('Cloud device list exceeds the validation limit.');
      total = Math.max(total, totalCount);
      devices.push(...list);
      if (page * 50 >= total) return { provider: 'creality-cloud', data: devices, credentials: source };
    }
    throw new Error('Cloud device list is incomplete; try again.');
  }
  if (source.host_type !== 'prusaconnect') throw new Error('Unsupported cloud provider.');
  const prefix = '/_printer/prusa-connect';
  const tokens = { access_token: source.printhost_apikey!, refresh_token: source.cloud_refresh_token ?? '' };
  let expected = { ...source };
  const retainTokens = () => {
    callerSignal.throwIfAborted();
    if (!usePrinterConnectionStore.getState().updateCloudTokens(expected, tokens.access_token, tokens.refresh_token))
      throw new DOMException('Session superseded', 'AbortError');
    const changed = tokens.access_token !== expected.printhost_apikey || tokens.refresh_token !== (expected.cloud_refresh_token ?? '');
    expected = { ...expected, printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token };
    if (changed) onRefresh?.({ ...tokens });
  };
  const request = async (path: string, refresh = true): Promise<any> => {
    const response = await fetch(`${prefix}${path}`, { signal, headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      ...(tokens.refresh_token ? { 'x-prusa-refresh-token': tokens.refresh_token } : {})
    } });
    callerSignal.throwIfAborted();
    const access = response.headers.get('x-prusa-access-token');
    const replacement = response.headers.get('x-prusa-refresh-token');
    if (access) tokens.access_token = access;
    if (replacement) tokens.refresh_token = replacement;
    // Persist received rotation before waiting for a body or another request.
    retainTokens();
    signal.throwIfAborted();
    if (response.status === 401 && refresh && tokens.refresh_token) {
      const renewed = await fetch(`${prefix}/auth/refresh`, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: tokens.refresh_token }) });
      signal.throwIfAborted();
      if (!renewed.ok) throw Object.assign(new Error('Session refresh failed.'), { status: renewed.status === 400 ? 401 : renewed.status });
      Object.assign(tokens, await renewed.json());
      retainTokens();
      return request(path, false);
    }
    if (!response.ok) throw Object.assign(new Error('Session validation failed.'), { status: response.status });
    return response.json();
  };
  try {
    const profile = await request('/app/login');
    const devices = await request('/app/printers');
    signal.throwIfAborted();
    retainTokens();
    if (!profile.user || !Array.isArray(devices.printers)) throw new Error('Invalid cloud response.');
    const user = profile.user;
    return { provider: 'prusaconnect', data: { tokens, user: { ...user,
      name: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.public_name || 'Prusa User' }, printers: devices.printers },
      credentials: { ...source, printhost_apikey: tokens.access_token, cloud_refresh_token: tokens.refresh_token } };
  } catch (error) {
    if (!callerSignal.aborted && rejectedCloudSession(error)) {
      if (!usePrinterConnectionStore.getState().updateCloudTokens(expected, expected.printhost_apikey!, expected.cloud_refresh_token))
        throw new DOMException('Session superseded', 'AbortError');
      // A rotated token may itself have been rejected by the next read-only endpoint.
      usePrinterConnectionStore.getState().rejectPrusaSession(expected);
    }
    throw error;
  }
}

export function applyCloudSession(draft: PhysicalPrinter, session: CloudSession): PhysicalPrinter {
  const source = session.credentials;
  const sameConnection = source.id === draft.id || ((source.id === 'prusa-account-session' || source.id === 'snapmaker-account-session') &&
    samePrusaScope(source, draft) && (!draft.cloud_account || source.cloud_account === draft.cloud_account));
  const serial = draft.serial ?? (sameConnection ? source.serial : undefined);
  const deviceId = draft.cloud_device_id ?? (sameConnection ? source.cloud_device_id : undefined);
  const prusaPrinter = session.provider === 'prusaconnect' ? session.data.printers.find(p => p.uuid === deviceId) : undefined;
  return { ...draft, printhost_apikey: source.printhost_apikey, printhost_user: source.printhost_user,
    cloud_refresh_token: source.cloud_refresh_token, cloud_account: source.cloud_account,
    ...(session.provider === 'snapmaker-cloud' ? { cloud_device_id: session.data.devices.find(p => p.deviceId === deviceId)?.deviceId,
      serial: session.data.devices.find(p => p.deviceId === deviceId)?.sn } : {}),
    ...(session.provider === 'bambu-cloud' ? { serial: session.data.devices.some(p => p.dev_id === serial) ? serial : '' } : {}),
    ...(session.provider === 'prusaconnect' ? { cloud_device_id: prusaPrinter?.uuid,
      serial: prusaPrinter?.name, cloud_team_id: prusaPrinter ? String(prusaPrinter.team_id ?? source.cloud_team_id ?? session.data.user.default_team_id ?? 0) : undefined } : {}),
    ...(session.provider === 'creality-cloud' ? session.data.some(p => p.tbId === deviceId && p.dn === serial)
      ? { serial, cloud_device_id: deviceId } : { cloud_device_id: undefined, serial: undefined } : {}) };
}
