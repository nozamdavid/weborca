/**
 * Creality Cloud read-only integration.
 *
 * Implements account auth (QR login/polling, password login), device enumeration,
 * and read-only status/telemetry/CFS polling through the Creality Cloud gateway.
 *
 * All operations are strictly read-only HTTPS polling. No device registration,
 * no print dispatch, no material feeding, and no plain MQTT transports are used.
 */
import type {
  ConnectOptions,
  Fan,
  Heater,
  PhysicalPrinter,
  PrinterApi,
  PrinterFilament,
  PrinterRunState,
  PrinterState,
  UploadOptions
} from './types';
import { finiteNumber } from './numberValue.ts';

export type CrealityRegion = 'global' | 'china';
export interface CrealityGatewayTarget {
  cloud_region?: CrealityRegion;
  region?: CrealityRegion;
  local_gateway?: string;
  use_gateway?: boolean;
}

export interface CrealityCloudDevice {
  dn: string; // deviceName (DN)
  tbId: string; // telemetry/RPC device ID
  name: string; // aliasName or deviceName
  model: string;
  online: boolean; // deviceState !== -1
  state: number; // deviceState enum (-1 to 9)
  idleState?: number;
  type: number; // 1 or 9
  multicolor?: boolean;
  printFileName?: string;
  printProgress?: number;
  printLeftTime?: string;
  raw?: unknown;
}

export interface CrealityCloudQrResult {
  identical: string;
  expireTime: number; // Epoch seconds from upstream first-party contract
  expireTimeMs: number; // Normalized epoch milliseconds for JS timers
  qrUrl: string;
}

export interface CrealityCloudAuthSession {
  token: string;
  userId: string;
}

export const CREALITY_DEVICE_STATUS: Record<number, { runState: PrinterRunState; label: string }> = {
  [-1]: { runState: 'offline', label: 'Offline' },
  0: { runState: 'ready', label: 'Idle' },
  1: { runState: 'printing', label: 'Printing' },
  2: { runState: 'complete', label: 'Printing Complete' },
  3: { runState: 'error', label: 'Printing Failed' },
  4: { runState: 'error', label: 'Print Abort' },
  5: { runState: 'paused', label: 'Printing Paused' },
  6: { runState: 'paused', label: 'Printing Pausing' },
  7: { runState: 'printing', label: 'Printing Stopping' },
  8: { runState: 'printing', label: 'Printing Restoring' },
  9: { runState: 'printing', label: 'Printing' }
};

/**
 * Normalizes QR expireTime (epoch seconds per CloudAPI.js & Login.qml) to epoch milliseconds.
 */
export function normalizeQrExpireTimeMs(expireTime: number): number {
  if (!expireTime || !Number.isFinite(expireTime)) return 0;
  // If expireTime is in epoch seconds (< 1e11), convert to milliseconds
  return expireTime < 1e11 ? expireTime * 1000 : expireTime;
}

/**
 * Checks whether a Creality QR login session has expired.
 */
export function isCrealityQrExpired(expireTime: number, nowMs: number = Date.now()): boolean {
  if (!expireTime || !Number.isFinite(expireTime)) return false;
  const expireMs = normalizeQrExpireTimeMs(expireTime);
  return nowMs >= expireMs;
}

/**
 * Generates a request ID UUID.
 */
function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Builds the gateway URL for reaching Creality Cloud services.
 */
export function crealityCloudGatewayUrl(
  target: CrealityGatewayTarget,
  service: 'auth' | 'api',
  path: string
): string {
  const reg: CrealityRegion = target.cloud_region ?? target.region ?? 'global';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const localBase = target.use_gateway && target.local_gateway ? target.local_gateway.replace(/\/+$/, '') : '';
  return `${localBase}/_printer/creality-cloud/${reg}/${service}${cleanPath}`;
}

/**
 * Creates headers for Creality Cloud Auth endpoints (CloudAPI.js first-party contract).
 * Uses platform 14, OS_LANG 0, and DUID.
 */
export function createCrealityAuthHeaders(auth?: { userId?: string; token?: string; duid?: string }): Record<string, string> {
  const duid = auth?.duid || '00000000000000000000000000000000';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json, */*',
    '__CXY_APP_ID_': 'creality_model',
    '__CXY_OS_LANG_': '0',
    '__CXY_DUID_': duid,
    '__CXY_OS_VER_': 'Windows 10',
    '__CXY_PLATFORM_': '14',
    '__CXY_REQUESTID_': generateRequestId()
  };
  if (auth?.userId) {
    headers['__CXY_UID_'] = auth.userId;
  }
  if (auth?.token) {
    headers['__CXY_TOKEN_'] = auth.token;
  }
  return headers;
}

/**
 * Creates headers for Creality Cloud Device endpoints (CrealityPrint BZCDzYbb.js contract).
 * Uses platform 11, brand creality, and app ver.
 */
export function createCrealityDeviceHeaders(auth?: { userId?: string; token?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': 'application/json, */*',
    '__CXY_BRAND_': 'creality',
    '__CXY_APP_CH_': 'creality',
    '__CXY_APP_ID_': 'creality_model',
    '__CXY_APP_VER_': '6.0.1.1375',
    '__CXY_PLATFORM_': '11',
    '__CXY_OS_VER_': 'Windows 10',
    '__CXY_OS_LANG_': '1',
    '__cxy_requestid_': generateRequestId()
  };
  if (auth?.userId) {
    headers['__cxy_uid_'] = auth.userId;
  }
  if (auth?.token) {
    headers['__cxy_token_'] = auth.token;
  }
  return headers;
}

/**
 * Backward-compatible header factory dispatching between auth and device API headers.
 */
export function createCrealityCloudHeaders(
  auth?: { userId?: string; token?: string; duid?: string },
  service: 'auth' | 'api' = 'api'
): Record<string, string> {
  return service === 'auth' ? createCrealityAuthHeaders(auth) : createCrealityDeviceHeaders(auth);
}

/**
 * Requests a new QR login session from Creality Cloud.
 */
export async function requestCrealityCloudQr(
  target: CrealityGatewayTarget = {},
  signal?: AbortSignal
): Promise<CrealityCloudQrResult> {
  const url = crealityCloudGatewayUrl(target, 'auth', '/api/cxy/account/v2/qrLogin');
  const timeoutSignal = AbortSignal.timeout(15_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(url, {
    method: 'POST',
    headers: createCrealityAuthHeaders(),
    body: JSON.stringify({}),
    signal: combinedSignal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Creality Cloud QR login failed with status ${res.status}.`);
  }

  const json = await res.json().catch(() => null);
  if (!json || typeof json !== 'object' || json.code !== 0 || !json.result?.identical) {
    throw new Error(json?.msg || json?.message || 'Invalid QR login response from Creality Cloud.');
  }

  const identical = String(json.result.identical);
  const rawExpire = Number(json.result.expireTime) || 0;
  const expireTimeMs = normalizeQrExpireTimeMs(rawExpire);

  return {
    identical,
    expireTime: rawExpire,
    expireTimeMs,
    qrUrl: `https://share.creality.com/scan-code?i=${identical}`
  };
}

/**
 * Polls the state of a QR login session.
 * Returns { token, userId } once scanned and confirmed (state 3), or null if pending.
 * Requires both nonempty token and userId.
 */
export async function pollCrealityCloudQr(
  identical: string,
  target: CrealityGatewayTarget = {},
  signal?: AbortSignal
): Promise<CrealityCloudAuthSession | null> {
  const url = crealityCloudGatewayUrl(target, 'auth', '/api/cxy/account/v2/qrQuery');
  const timeoutSignal = AbortSignal.timeout(15_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(url, {
    method: 'POST',
    headers: createCrealityAuthHeaders(),
    body: JSON.stringify({ identical }),
    signal: combinedSignal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Creality Cloud QR query answered status ${res.status}.`);
  }

  const json = await res.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid response from Creality Cloud QR query.');
  }

  if (json.code !== 0) {
    throw new Error(json.msg || json.message || `QR query failed (code ${json.code}).`);
  }

  const result = json.result;
  if (result && result.state === 3) {
    const token = typeof result.token === 'string' ? result.token.trim() : '';
    const userId = (typeof result.userId === 'string' || typeof result.userId === 'number')
      ? String(result.userId).trim()
      : '';
    if (!token || !userId) {
      throw new Error('Creality Cloud QR query succeeded (state 3) but returned missing or empty userId or token.');
    }
    return { token, userId };
  }

  return null;
}

/**
 * Authenticates using email/phone account and password.
 * Requires both nonempty token and userId.
 */
export async function loginCrealityCloudPassword(
  account: string,
  password: string,
  target: CrealityGatewayTarget = {},
  signal?: AbortSignal
): Promise<CrealityCloudAuthSession> {
  const cleanAccount = account.trim();
  if (!cleanAccount || !password) {
    throw new Error('Enter an account identifier and password.');
  }

  const url = crealityCloudGatewayUrl(target, 'auth', '/api/account/loginV2');
  const timeoutSignal = AbortSignal.timeout(15_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(url, {
    method: 'POST',
    headers: createCrealityAuthHeaders(),
    body: JSON.stringify({ type: 1, account: cleanAccount, password }),
    signal: combinedSignal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Creality Cloud password login failed with status ${res.status}.`);
  }

  const json = await res.json().catch(() => null);
  if (!json || typeof json !== 'object' || json.code !== 0 || !json.result) {
    throw new Error(json?.msg || json?.message || 'Incorrect account or password.');
  }

  const token = typeof json.result.token === 'string' ? json.result.token.trim() : '';
  const userId = (typeof json.result.userId === 'string' || typeof json.result.userId === 'number')
    ? String(json.result.userId).trim()
    : '';

  if (!token || !userId) {
    throw new Error('Creality Cloud login failed: missing or empty userId or token.');
  }

  return { token, userId };
}

/**
 * Fetches the user's bound printers from Creality Cloud.
 */
export async function fetchCrealityCloudDevices(
  target: CrealityGatewayTarget & { printhost_user?: string; printhost_apikey?: string; token?: string; userId?: string },
  page = 1,
  pageSize = 20,
  signal?: AbortSignal
): Promise<{ totalCount: number; list: CrealityCloudDevice[] }> {
  const userId = target.userId ?? target.printhost_user;
  const token = target.token ?? target.printhost_apikey;
  if (!userId || !token) {
    throw new Error('User ID and token are required to list cloud devices.');
  }

  const url = crealityCloudGatewayUrl(target, 'api', '/api/rest/print/cluster/devices/getDevices');
  const timeoutSignal = AbortSignal.timeout(15_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const res = await fetch(url, {
    method: 'POST',
    headers: createCrealityDeviceHeaders({ userId, token }),
    body: JSON.stringify({ page, pageSize }),
    signal: combinedSignal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to fetch Creality Cloud devices (${res.status}).`);
  }

  const json = await res.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid device list response from Creality Cloud.');
  }

  if (json.code === 4) {
    throw new Error('Creality Cloud session expired (code 4): please re-authenticate.');
  }

  if (json.code !== 0 || !json.result) {
    throw new Error(json.msg || json.message || 'Invalid device list response from Creality Cloud.');
  }

  const rawList = Array.isArray(json.result.list) ? json.result.list : [];
  const totalCount = Number(json.result.totalCount) || rawList.length;

  // Filter for supported types: 1 and 9 as documented in CrealityPrint device manager
  const filtered = rawList.filter((item: any) => item && (item.type === 1 || item.type === 9));

  const list: CrealityCloudDevice[] = filtered.map((item: any) => {
    const rawState = typeof item.deviceState === 'number' ? item.deviceState : -1;
    const isOnline = rawState !== -1;
    return {
      dn: String(item.deviceName || ''),
      tbId: String(item.tbId || ''),
      name: String(item.aliasName || item.deviceName || 'Creality Printer'),
      model: String(item.model || '').replace(/^CR-/, ''),
      online: isOnline,
      state: rawState,
      idleState: typeof item.idleState === 'number' ? item.idleState : undefined,
      type: Number(item.type) || 1,
      multicolor: Number(item.multicolor) === 1,
      printFileName: item.printInfo?.modelName || item.printInfo?.gcodeName || '',
      printProgress: typeof item.printInfo?.printProgress === 'number' ? item.printInfo.printProgress : undefined,
      printLeftTime: item.printInfo?.printLeftTime ? String(item.printInfo.printLeftTime) : undefined,
      raw: item
    };
  });

  return { totalCount, list };
}

/**
 * First-party normalization for timeseries payload.
 * Handles both key-value sample arrays and sample objects.
 */
export function normalizeCloudTimeseries(r: unknown): Record<string, { value: unknown }[]> {
  if (!r || typeof r !== 'object') return {};
  const n: Record<string, { value: unknown }[]> = {};
  const entries = Array.isArray(r)
    ? r.map((k) => [k?.key, [k]] as [string, any[]])
    : Object.entries(r);

  for (const [k, v] of entries) {
    if (typeof k === 'string' && Array.isArray(v) && v[0]?.value !== undefined) {
      n[k] = v;
    }
  }
  return n;
}

/**
 * Normalizes color hex representation:
 * #AARRGGBB (9 chars) -> #RRGGBB (7 chars)
 */
export function normalizeFilamentColor(color: unknown): string | undefined {
  if (typeof color !== 'string') return undefined;
  const trimmed = color.trim();
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return '#' + trimmed.slice(3, 9);
  }
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

/**
 * Parses CFS multi-material inventory from RPC query result.
 * rfidState 0 indicates unavailable/empty slot.
 * External rackFilament is supported when material type is reported.
 */
export function parseCfsInventory(cfsResult: unknown): PrinterFilament[] {
  if (!cfsResult || typeof cfsResult !== 'object' || Array.isArray(cfsResult)) {
    return [];
  }
  const result = cfsResult as Record<string, any>;
  const filaments: PrinterFilament[] = [];

  // Parse CFS multi-color units
  if (Array.isArray(result.cfsList)) {
    result.cfsList.forEach((box: any, boxIdx: number) => {
      if (!box || !Array.isArray(box.portList)) return;
      box.portList.forEach((port: any, portIdx: number) => {
        if (!port || typeof port !== 'object') return;
        // rfidState 0 indicates empty / unavailable slot
        if (port.rfidState === 0) return;
        const material = typeof port.filamentType === 'string' ? port.filamentType.trim() : '';
        if (!material) return;

        const color = normalizeFilamentColor(port.filamentsColor);
        filaments.push({
          id: `cfs-${boxIdx + 1}-${portIdx + 1}`,
          label: `CFS ${boxIdx + 1}-${portIdx + 1}`,
          material,
          color
        });
      });
    });
  }

  // Parse external spool rack
  if (result.rackFilament && typeof result.rackFilament === 'object') {
    const rack = result.rackFilament;
    const material = typeof rack.filamentType === 'string' ? rack.filamentType.trim() : '';
    if (material) {
      const color = normalizeFilamentColor(rack.filamentsColor);
      filaments.push({
        id: 'rack-1',
        label: 'External Spool',
        material,
        color
      });
    }
  }

  return filaments;
}

/**
 * CrealityCloudApi implements PrinterApi for read-only HTTPS polling of Creality printers.
 */
export class CrealityCloudApi implements PrinterApi {
  private printer: PhysicalPrinter;
  constructor(printer: PhysicalPrinter) {
    this.printer = printer;
  }

  connect(
    onState: (state: PrinterState) => void,
    onError: (error: Error) => void,
    options?: ConnectOptions
  ): () => void {
    let closed = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | null = null;

    const userId = this.printer.printhost_user;
    const token = this.printer.printhost_apikey;
    const dn = this.printer.serial;
    const tbId = this.printer.cloud_device_id;

    if (!userId || !token || !dn || !tbId) {
      onError(new Error('Creality Cloud requires User ID, Token, Device DN (serial), and Device tbId (cloud_device_id).'));
      return () => {};
    }

    const poll = async () => {
      if (closed) return;
      activeController?.abort();
      activeController = new AbortController();
      const signal = activeController.signal;

      try {
        const headers = createCrealityDeviceHeaders({ userId, token });

        // 1. Poll basic state and print status
        const pollStateUrl = crealityCloudGatewayUrl(this.printer, 'api', '/api/rest/print/cluster/devices/pollState');
        const pollTimeout = AbortSignal.timeout(10_000);
        const pollCombinedSignal = AbortSignal.any([signal, pollTimeout]);

        const pollRes = await fetch(pollStateUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ dnList: [dn] }),
          signal: pollCombinedSignal
        });

        if (!pollRes.ok) {
          if (pollRes.status === 401 || pollRes.status === 403) {
            throw new Error(`Creality Cloud auth rejected (${pollRes.status})`);
          }
          throw new Error(`pollState request failed with status ${pollRes.status}`);
        }
        const pollJson = await pollRes.json();
        if (pollJson && pollJson.code === 4) {
          throw new Error('Creality Cloud session expired (code 4): please re-authenticate.');
        }
        if (pollJson && pollJson.code !== 0 && pollJson.code !== 200) {
          throw new Error(pollJson.msg || pollJson.message || `pollState failed with code ${pollJson.code}`);
        }

        const devList = Array.isArray(pollJson?.result) ? pollJson.result : [];
        const devInfo = devList.find((d: any) => d && d.deviceName === dn);

        if (!devInfo) {
          throw new Error(`Device ${dn} not found in pollState response.`);
        }

        const rawState = typeof devInfo.deviceState === 'number' ? devInfo.deviceState : -1;
        const statusMeta = CREALITY_DEVICE_STATUS[rawState] ?? { runState: 'unknown', label: 'Unknown' };

        // 2. Fetch timeseries (current temps, speed)
        const timeseriesUrl = crealityCloudGatewayUrl(
          this.printer,
          'api',
          `/api/rest/iotrouter/${tbId}/values/timeseries?keys=&useStrictDataTypes=true`
        );
        const tsTimeout = AbortSignal.timeout(10_000);
        const tsCombinedSignal = AbortSignal.any([signal, tsTimeout]);

        const tsRes = await fetch(timeseriesUrl, { headers, signal: tsCombinedSignal });
        if (tsRes.status === 401 || tsRes.status === 403) {
          throw new Error(`Creality Cloud telemetry auth rejected (${tsRes.status})`);
        }
        const tsJson = tsRes.ok ? await tsRes.json() : null;
        if (tsJson && tsJson.code === 4) {
          throw new Error('Creality Cloud telemetry session expired (code 4)');
        }
        const normalizedTs = normalizeCloudTimeseries(tsJson?.result);

        // 3. Fetch attributes (target temps, fans, total layers)
        const attributesUrl = crealityCloudGatewayUrl(
          this.printer,
          'api',
          `/api/rest/iotrouter/plugins/telemetry/${tbId}/values/attributes?key=`
        );
        const attrTimeout = AbortSignal.timeout(10_000);
        const attrCombinedSignal = AbortSignal.any([signal, attrTimeout]);

        const attrRes = await fetch(attributesUrl, { headers, signal: attrCombinedSignal });
        if (attrRes.status === 401 || attrRes.status === 403) {
          throw new Error(`Creality Cloud attributes auth rejected (${attrRes.status})`);
        }
        const attrJson = attrRes.ok ? await attrRes.json() : null;
        if (attrJson && attrJson.code === 4) {
          throw new Error('Creality Cloud attributes session expired (code 4)');
        }
        const attrList = Array.isArray(attrJson?.result) ? attrJson.result : [];
        const attrMap: Record<string, unknown> = {};
        for (const item of attrList) {
          if (item && typeof item.key === 'string') {
            attrMap[item.key] = item.value;
          }
        }

        // 4. Fetch CFS multi-material inventory if multicolor is enabled
        let filaments: PrinterFilament[] = [];
        const isMultiColor = Number(devInfo.multicolor) === 1 || attrMap['cfsInsert'] === 1;
        if (isMultiColor) {
          try {
            const cfsUrl = crealityCloudGatewayUrl(this.printer, 'api', `/api/rest/iotrouter/rpc/twoway/${tbId}`);
            const cfsTimeout = AbortSignal.timeout(10_000);
            const cfsCombinedSignal = AbortSignal.any([signal, cfsTimeout]);
            const cfsRes = await fetch(cfsUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ method: 'get', params: { cfsList: 1 } }),
              signal: cfsCombinedSignal
            });
            if (cfsRes.ok) {
              const cfsJson = await cfsRes.json();
              filaments = parseCfsInventory(cfsJson?.result);
            }
          } catch {
            // Ignore optional CFS fetch failures to keep basic state monitoring active
          }
        }

        // Assemble Heaters using finiteNumber to reject nonnumeric values
        const heaters: Heater[] = [];
        const nozzleCurrent = finiteNumber(normalizedTs['nozzleTemp']?.[0]?.value);
        const nozzleTarget = finiteNumber(attrMap['nozzleTemp2']);
        if (nozzleCurrent !== undefined || nozzleTarget !== undefined) {
          heaters.push({
            id: 'extruder',
            label: 'Nozzle',
            kind: 'extruder',
            current: nozzleCurrent ?? 0,
            target: nozzleTarget ?? 0
          });
        }

        const bedCurrent = finiteNumber(normalizedTs['bedTemp']?.[0]?.value);
        const bedTarget = finiteNumber(attrMap['bedTemp2']);
        if (bedCurrent !== undefined || bedTarget !== undefined) {
          heaters.push({
            id: 'bed',
            label: 'Bed',
            kind: 'bed',
            current: bedCurrent ?? 0,
            target: bedTarget ?? 0
          });
        }

        const boxCurrent = finiteNumber(normalizedTs['boxTemp']?.[0]?.value);
        const boxTarget = finiteNumber(attrMap['boxTemp2']);
        if (boxCurrent !== undefined || boxTarget !== undefined) {
          heaters.push({
            id: 'chamber',
            label: 'Chamber',
            kind: 'chamber',
            current: boxCurrent ?? 0,
            target: boxTarget ?? 0
          });
        }

        // Assemble Fans using finiteNumber
        const fans: Fan[] = [];
        const modelFanPct = finiteNumber(attrMap['modelFanPct']);
        if (modelFanPct !== undefined) {
          fans.push({
            id: 'part',
            label: 'Part Fan',
            speed: Math.max(0, Math.min(1, modelFanPct / 100))
          });
        }
        const caseFanPct = finiteNumber(attrMap['caseFanPct']);
        if (caseFanPct !== undefined) {
          fans.push({
            id: 'case',
            label: 'Case Fan',
            speed: Math.max(0, Math.min(1, caseFanPct / 100))
          });
        }
        const auxFanPct = finiteNumber(attrMap['auxiliaryFanPct']);
        if (auxFanPct !== undefined) {
          fans.push({
            id: 'aux',
            label: 'Aux Fan',
            speed: Math.max(0, Math.min(1, auxFanPct / 100))
          });
        }

        // Progress: printProgress is reported as percentage (0-100), so 1 => 0.01
        let progress: number | undefined;
        let rawProg = finiteNumber(devInfo.printInfo?.printProgress ?? devInfo.printProgress);
        if (Array.isArray(devInfo.iotTelemetry)) {
          const pEntry = devInfo.iotTelemetry.find((e: any) => e?.key === 'printProgress');
          const pVal = finiteNumber(pEntry?.value);
          if (pVal !== undefined) rawProg = pVal;
        }
        if (rawProg !== undefined) {
          progress = Math.max(0, Math.min(1, rawProg / 100));
        }

        // Layers
        let layer: { current: number; total?: number } | undefined;
        let currentLayer: number | undefined;
        if (Array.isArray(devInfo.iotTelemetry)) {
          const lEntry = devInfo.iotTelemetry.find((e: any) => e?.key === 'layer');
          currentLayer = finiteNumber(lEntry?.value);
        }
        const totalLayer = finiteNumber(attrMap['TotalLayer']);
        if (currentLayer !== undefined || totalLayer !== undefined) {
          layer = { current: currentLayer ?? 0, total: totalLayer };
        }

        // Remaining time (seconds)
        let remaining: number | undefined;
        if (Array.isArray(devInfo.iotTelemetry)) {
          const remEntry = devInfo.iotTelemetry.find((e: any) => e?.key === 'printLeftTime');
          remaining = finiteNumber(remEntry?.value);
        }

        const state: PrinterState = {
          state: statusMeta.runState,
          message: statusMeta.label,
          heaters,
          fans,
          progress,
          layer,
          remaining,
          file: devInfo.printInfo?.modelName || devInfo.printInfo?.gcodeName,
          filaments: filaments.length > 0 ? filaments : undefined
        };

        if (!closed) {
          onState(state);
        }
      } catch (err) {
        if (closed) return;
        onError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!closed) {
          const delay = options?.isActive?.() === false ? 15_000 : 3_000;
          timerId = setTimeout(poll, delay);
        }
      }
    };

    poll();

    return () => {
      closed = true;
      if (timerId) clearTimeout(timerId);
      timerId = undefined;
      activeController?.abort();
      activeController = null;
    };
  }

  async test(): Promise<string> {
    const userId = this.printer.printhost_user;
    const token = this.printer.printhost_apikey;
    const dn = this.printer.serial;
    const tbId = this.printer.cloud_device_id;

    if (!userId || !token || !dn || !tbId) {
      throw new Error('Creality Cloud requires User ID, Token, Device DN (serial), and Device tbId (cloud_device_id).');
    }

    const url = crealityCloudGatewayUrl(this.printer, 'api', '/api/rest/print/cluster/devices/pollState');
    const res = await fetch(url, {
      method: 'POST',
      headers: createCrealityDeviceHeaders({ userId, token }),
      body: JSON.stringify({ dnList: [dn] }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!res.ok) {
      throw new Error(`Creality Cloud connection test failed with status ${res.status}.`);
    }

    const json = await res.json().catch(() => null);
    if (json && json.code === 4) {
      throw new Error('Creality Cloud session expired (code 4): please re-authenticate.');
    }
    if (json && json.code !== 0 && json.code !== 200) {
      throw new Error(json.msg || json.message || `pollState failed with code ${json.code}`);
    }

    const devList = Array.isArray(json?.result) ? json.result : [];
    const dev = devList.find((d: any) => d && d.deviceName === dn);

    if (!dev) {
      throw new Error(`Device ${dn} not found in pollState response.`);
    }

    const devState = typeof dev.deviceState === 'number' ? dev.deviceState : -1;
    const statusMeta = CREALITY_DEVICE_STATUS[devState] ?? { runState: 'unknown', label: 'Unknown' };
    const name = dev.aliasName || dev.deviceName || dn;
    return `${name} (${statusMeta.label}) connected`;
  }

  async upload(_options: UploadOptions): Promise<void> {
    throw new Error('Creality Cloud is read-only. File upload and printing are not supported.');
  }
}
