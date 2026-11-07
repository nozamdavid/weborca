import { finiteNumber as parseNumber } from './numberValue';
export { finiteNumber as parseNumber } from './numberValue';

import { describeFetchFailure, httpUrl, sendWithProgress, parseHost } from './gatewayUrl';
import type {
  PhysicalPrinter,
  PrinterApi,
  PrinterFilament,
  PrinterState,
  PrinterRunState,
  Heater,
  Fan,
  UploadOptions,
  ConnectOptions
} from './types';

/**
 * Protocol References:
 * - @ghosttypes/ff-api (v2.1.0):
 *   https://github.com/GhostTypes/ff-5mp-api-ts/blob/v2.1.0/src/models/ff-models.ts (FFPrinterDetail, SlotInfo, MatlStationInfo)
 *   https://github.com/GhostTypes/ff-5mp-api-ts/blob/v2.1.0/src/models/MachineInfo.ts (fromDetail, getMachineState)
 * - Parallel-7/FlashForgeWebUI:
 *   https://github.com/Parallel-7/FlashForgeWebUI
 * - SoftFever/OrcaSlicer native C++ implementation:
 *   src/slic3r/Utils/Flashforge.cpp (parse_material_slots, upload_local_api)
 *   src/slic3r/Utils/Flashforge.hpp
 */

const KNOWN_STATES: Record<string, PrinterRunState> = {
  ready: 'ready',
  printing: 'printing',
  heating: 'printing',
  pause: 'paused',
  paused: 'paused',
  pausing: 'paused',
  completed: 'complete',
  cancel: 'ready',
  cancelled: 'ready',
  error: 'error'
};

/** Fans report speed as 0..100 percentage. Convert to 0..1 ratio. */
export const fanSpeed = (v: unknown): number | undefined => {
  const n = parseNumber(v);
  return n != null ? Math.max(0, Math.min(1, n / 100)) : undefined;
};

export function parseFlashforgeDetail(raw: unknown): PrinterState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { state: 'unknown', heaters: [], fans: [] };
  }
  const root = raw as Record<string, unknown>;
  const detail = (root.detail && typeof root.detail === 'object' && !Array.isArray(root.detail)
    ? root.detail
    : root) as Record<string, any>;

  const rawStatus = typeof detail.status === 'string' ? detail.status.trim().toLowerCase() : '';
  // Documented non-printing states like 'busy' or 'downloading' (ff-api MachineInfo.ts lines 303-307)
  // are not printing and not idle ready; map to 'unknown' with status message to avoid inventing an idle state.
  const state: PrinterRunState = KNOWN_STATES[rawStatus] ?? 'unknown';

  const heaters: Heater[] = [];
  const bedCur = parseNumber(detail.platTemp);
  const bedTgt = parseNumber(detail.platTargetTemp);
  if (bedCur != null || bedTgt != null) {
    heaters.push({ id: 'bed', label: 'Bed', kind: 'bed', current: bedCur ?? 0, target: bedTgt ?? 0 });
  }

  // Creator 5 series multi-tool reports `nozzleTemps[]` / `nozzleTargetTemps[]`
  if (Array.isArray(detail.nozzleTemps) && detail.nozzleTemps.length > 0) {
    detail.nozzleTemps.forEach((t: unknown, i: number) => {
      const cur = parseNumber(t);
      const tgt = parseNumber(detail.nozzleTargetTemps?.[i]);
      if (cur != null || tgt != null) {
        heaters.push({ id: `extruder_${i}`, label: `Nozzle ${i + 1}`, kind: 'extruder', current: cur ?? 0, target: tgt ?? 0 });
      }
    });
  } else {
    const cur = parseNumber(detail.rightTemp);
    const tgt = parseNumber(detail.rightTargetTemp);
    if (cur != null || tgt != null) {
      heaters.push({ id: 'extruder', label: 'Nozzle', kind: 'extruder', current: cur ?? 0, target: tgt ?? 0 });
    }
  }

  const chCur = parseNumber(detail.chamberTemp);
  const chTgt = parseNumber(detail.chamberTargetTemp);
  if (chCur != null || chTgt != null) {
    heaters.push({ id: 'chamber', label: 'Chamber', kind: 'chamber', current: chCur ?? 0, target: chTgt ?? 0 });
  }

  const fans: Fan[] = [];
  const partSpeed = fanSpeed(detail.coolingFanSpeed);
  if (partSpeed != null) fans.push({ id: 'cooling', label: 'Cooling fan', speed: partSpeed });

  const leftSpeed = fanSpeed(detail.coolingFanLeftSpeed);
  if (leftSpeed != null) fans.push({ id: 'cooling_left', label: 'Left cooling fan', speed: leftSpeed });

  const chSpeed = fanSpeed(detail.chamberFanSpeed);
  if (chSpeed != null) fans.push({ id: 'chamber', label: 'Chamber fan', speed: chSpeed });

  if (detail.externalFanStatus === 'open' || detail.externalFanStatus === 'close') {
    fans.push({ id: 'external', label: 'External fan', speed: detail.externalFanStatus === 'open' ? 1 : 0 });
  }
  if (detail.internalFanStatus === 'open' || detail.internalFanStatus === 'close') {
    fans.push({ id: 'internal', label: 'Internal fan', speed: detail.internalFanStatus === 'open' ? 1 : 0 });
  }

  // Verified ratio from MachineInfo.ts lines 211-212 (PrintProgressInt = Math.floor(detail.printProgress * 100))
  const rawProg = parseNumber(detail.printProgress);
  const progress = rawProg != null ? Math.max(0, Math.min(1, rawProg)) : undefined;

  const file = typeof detail.printFileName === 'string' && detail.printFileName.trim() ? detail.printFileName.trim() : undefined;
  const elapsed = parseNumber(detail.printDuration) != null ? Math.max(0, Math.floor(parseNumber(detail.printDuration)!)) : undefined;
  const remaining = parseNumber(detail.estimatedTime) != null ? Math.max(0, Math.floor(parseNumber(detail.estimatedTime)!)) : undefined;
  const curLayer = parseNumber(detail.printLayer);
  const layer = curLayer != null
    ? {
        current: Math.max(0, Math.floor(curLayer)),
        total: parseNumber(detail.targetPrintLayer) != null ? Math.max(0, Math.floor(parseNumber(detail.targetPrintLayer)!)) : undefined
      }
    : undefined;

  const filaments: PrinterFilament[] = [];
  const station = detail.matlStationInfo && typeof detail.matlStationInfo === 'object' && !Array.isArray(detail.matlStationInfo)
    ? detail.matlStationInfo
    : detail.MatlStationInfo && typeof detail.MatlStationInfo === 'object' && !Array.isArray(detail.MatlStationInfo)
      ? detail.MatlStationInfo
      : undefined;
  const slotInfos = station?.slotInfos ?? station?.SlotInfos;
  if (Array.isArray(slotInfos)) {
    slotInfos.forEach((slot: any, i: number) => {
      const hasFilament = slot?.hasFilament === true || slot?.hasFilament === 1 || slot?.hasFilament === '1';
      if (hasFilament) {
        const id = String(slot.slotId ?? (i + 1));
        const hex = String(slot.materialColor || '').replace(/^#/, '');
        filaments.push({
          id,
          label: `Slot ${id}`,
          material: typeof slot.materialName === 'string' && slot.materialName.trim() ? slot.materialName.trim() : 'Unknown',
          color: /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : undefined
        });
      }
    });
  }

  let message: string | undefined;
  if (typeof detail.errorCode === 'string' && detail.errorCode.trim()) {
    message = `Error code: ${detail.errorCode.trim()}`;
  } else if (state === 'error') {
    message = 'Printer reported error status';
  } else if (rawStatus && !KNOWN_STATES[rawStatus]) {
    message = `Status: ${rawStatus}`;
  }

  const webcams = typeof detail.cameraStreamUrl === 'string' && detail.cameraStreamUrl.trim()
    ? [{ name: 'Camera', url: detail.cameraStreamUrl.trim() }]
    : undefined;

  const software = typeof detail.firmwareVersion === 'string' && detail.firmwareVersion.trim()
    ? `Flashforge ${detail.firmwareVersion.trim()}`
    : undefined;

  return { state, message, heaters, fans, progress, file, elapsed, remaining, layer, filaments, webcams, software };
}

function validateFlashforgeResponse(parsed: any): void {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Flashforge returned an invalid JSON response.');
  }
  const code = typeof parsed.code !== 'undefined' ? Number(parsed.code) : (typeof parsed.err !== 'undefined' ? Number(parsed.err) : 0);
  if (code !== 0) {
    const msg = parsed.message || parsed.msg || 'Flashforge request rejected';
    throw new Error(msg);
  }
}

export class FlashforgeApi implements PrinterApi {
  constructor(private printer: PhysicalPrinter) {}

  private apiUrl(path: string): string {
    const { scheme, hostPort, basePath } = parseHost(this.printer.print_host);
    const address = new URL(`${scheme}://${hostPort}${basePath}`);
    if (!address.port) address.port = '8898';
    const tempPrinter = { ...this.printer, use_gateway: true, print_host: address.toString() };
    return httpUrl(tempPrinter, path);
  }

  connect(onState: (state: PrinterState) => void, onError: (error: Error) => void, options?: ConnectOptions): () => void {
    let stopped = false;
    let errors = 0;
    const controller = new AbortController();
    let timerId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (stopped) return;
      try {
        const body = JSON.stringify({
          serialNumber: this.printer.serial ?? '',
          checkCode: this.printer.printhost_apikey ?? ''
        });

        const res = await fetch(this.apiUrl('detail'), {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body
        });

        if (!res.ok) throw new Error(await describeFetchFailure(this.printer, res));
        const parsed = await res.json();
        validateFlashforgeResponse(parsed);

        const state = parseFlashforgeDetail(parsed);
        if (stopped) return;
        onState(state);
        errors = 0;
      } catch (err) {
        if (stopped) return;
        errors++;
        if (errors > 2) onError(err as Error);
      } finally {
        if (!stopped) {
          const delay = options?.pollIntervalMs ?? (options?.isActive?.() === false ? 15000 : 3000);
          timerId = setTimeout(poll, delay);
        }
      }
    };

    poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timerId); };
  }

  async test(): Promise<string> {
    if (!this.printer.serial || !this.printer.printhost_apikey) {
      throw new Error('Flashforge requires both Serial number and Access code.');
    }
    const body = JSON.stringify({
      serialNumber: this.printer.serial,
      checkCode: this.printer.printhost_apikey
    });

    const res = await fetch(this.apiUrl('detail'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (!res.ok) throw new Error(await describeFetchFailure(this.printer, res));
    const data = await res.json();
    validateFlashforgeResponse(data);
    const detail = data.detail ?? data;
    const name = detail.model || detail.name || 'Flashforge printer';
    const fw = detail.firmwareVersion ? ` (fw ${detail.firmwareVersion})` : '';
    return `${name}${fw} connected`;
  }

  async upload(options: UploadOptions): Promise<void> {
    const formData = new FormData();
    const blob = new Blob([options.gcode as BlobPart], { type: 'application/octet-stream' });
    formData.append('gcodeFile', blob, options.filename);

    const headers: Record<string, string> = {
      serialNumber: this.printer.serial ?? '',
      checkCode: this.printer.printhost_apikey ?? '',
      fileSize: options.gcode.length.toString(),
      printNow: options.print ? 'true' : 'false',
      levelingBeforePrint: 'false',
      flowCalibration: 'false',
      firstLayerInspection: 'false',
      timeLapseVideo: 'false',
      useMatlStation: 'false'
    };

    const resText = await sendWithProgress('POST', this.apiUrl('uploadGcode'), headers, formData as unknown as XMLHttpRequestBodyInit, options.onProgress);
    try {
      const data = JSON.parse(resText);
      validateFlashforgeResponse(data);
    } catch (err) {
      if (err instanceof SyntaxError) throw new Error('Flashforge returned an invalid JSON response.');
      throw err;
    }
  }
}
