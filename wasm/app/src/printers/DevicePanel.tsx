import React, { useEffect, useMemo, useState } from 'react';
import { usePrinterConnectionStore } from './connectionStore';
import { formatBytes, formatDuration } from './format';
import { parseHost } from './gatewayUrl';
import type { PhysicalPrinter, PrinterState } from './types';
import { confirmDialog } from '../components/ModalBackdrop';
import { getCurrentPrinterApi, reconnectPrinterSession } from './session';
import type { PrinterApi } from './types';
import type { PrinterConnectionStatus } from './connectionStore';
import { HOST_TYPE_LABELS } from './types';
import { OctoEverywhereApi, getEffectivePrinterCapabilities, safeOctoEverywhereUserUrl } from './octoEverywhere';
import { OctoEverywhereConnection } from './OctoEverywhereConnection';
import { OctoEverywherePanel } from './OctoEverywherePanel';
import { deviceExtruderReadings } from './deviceExtruders';
import { ExtruderCards } from './ExtruderCards';
import { DeviceFreshness } from './DeviceFreshness';
import { DeviceSplit } from './DeviceSplit';
import './DevicePanel.css';
import { useTranslation } from "../i18n";

/** Where the printer's own web UI lives: the explicit UI address, else the host (Moonraker's API port 7125 maps to the UI on 80). */
export function webUiUrl(printer: PhysicalPrinter): string | undefined {
  if (printer.octoeverywhere?.mode === 'remote') return safeOctoEverywhereUserUrl(printer.octoeverywhere.connection?.userFacingUrl);
  if (printer.host_type === 'bambu-cloud' || printer.host_type === 'snapmaker-cloud') return undefined;
  if (printer.host_type === 'creality-cloud') return printer.cloud_region === 'china' ? 'https://www.crealitycloud.cn/' : 'https://www.crealitycloud.com/';
  if (printer.host_type === 'prusaconnect') return printer.cloud_device_id ? `https://connect.prusa3d.com/printer/${printer.cloud_device_id}` : 'https://connect.prusa3d.com';
  const address = (printer.print_host_webui || '').trim() || printer.print_host.trim();
  if (!address) return undefined;
  try {
    const { scheme, hostPort, basePath } = parseHost(address);
    const host = !printer.print_host_webui && printer.host_type === 'moonraker' ? hostPort.replace(/:7125$/, '') : hostPort;
    return printer.host_type === 'bambu' ? undefined : `${scheme}://${host}${basePath}/`;
  } catch {
    return undefined;
  }
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="device-row"><span>{label}</span><span>{value}</span></div>
);

const ControlsCard: React.FC<{ printer: PhysicalPrinter; state: PrinterState | null; status: PrinterConnectionStatus }> = ({
  printer,
  state,
  status
}) => {
  const { t } = useTranslation();
  const remote = printer.octoeverywhere?.mode === 'remote';
  const caps = getEffectivePrinterCapabilities(printer, state ?? undefined);
  const commandApi = usePrinterConnectionStore(s => s.activeApi);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [step, setStep] = useState<number>(10);
  const [extrudeAmount, setExtrudeAmount] = useState<number>(10);
  const [nozzleTarget, setNozzleTarget] = useState<string>('200');
  const [bedTarget, setBedTarget] = useState<string>('60');
  const [chamberTarget, setChamberTarget] = useState<string>('40');
  const [fanSpeed, setFanSpeed] = useState<number>(100);
  const [printSpeed, setPrintSpeed] = useState<number>(100);
  const [toolIndex, setToolIndex] = useState(0);
  const tools = state?.octoeverywhere?.materialSystem?.Tools?.filter(tool => tool.Index != null && Number.isInteger(tool.Index) && tool.Index >= 0);

  if (!caps || (!caps.home && !caps.jog && !caps.extrude && !caps.temps && !caps.fan && !caps.speed && !caps.job)) {
    return null;
  }

  const isOnline = status === 'online' && !!state && state.state !== 'offline' && state.state !== 'error';
  const isPrinting = state?.state === 'printing' || state?.state === 'paused';
  const isPaused = state?.state === 'paused';
  const motionDisabled = !isOnline || isPrinting;
  const controlsDisabled = !isOnline;

  const runCmd = async (fn: (api: PrinterApi) => Promise<void>) => {
    try {
      setCommandError(null);
      const api = getCurrentPrinterApi();
      if (!api || api !== commandApi) throw new Error('Printer connection changed. Try again.');
      await fn(api);
    } catch (err: any) {
      setCommandError(err.message ?? String(err));
    }
  };

  const handleCancelPrint = async () => {
    const ok = await confirmDialog({
      title: t('Cancel print?'),
      message: t('Are you sure you want to cancel the print?'),
      confirmLabel: t('Cancel print'),
      cancelLabel: t('Keep printing')
    });
    if (!ok) return;
    await runCmd((api) => {
      if (!api.cancelPrint) throw new Error('Cancel print not supported');
      return api.cancelPrint();
    });
  };

  const handleSetNozzleTemp = async (targetVal: number) => {
    if (!Number.isFinite(targetVal)) return;
    const clamped = Math.max(0, Math.min(remote ? 260 : 300, targetVal));
    if (clamped > 260) {
      const ok = await confirmDialog({
        title: t('High temperature warning'),
        message: t('Setting nozzle temperature above 260°C can degrade PTFE tubes and generate fumes. Proceed?'),
        confirmLabel: t('Heat anyway'),
        cancelLabel: t('Cancel')
      });
      if (!ok) return;
    }
    await runCmd((api) => {
      if (!api.setTemperature) throw new Error('Set temperature not supported');
      return api.setTemperature('extruder', clamped, remote ? toolIndex : undefined);
    });
  };

  const hasChamber = state?.heaters.some((h) => h.kind === 'chamber');

  return (
    <div className="device-card" id="device-controls" data-remote={remote}>
      <h4>{t('Controls')}</h4>
      {remote && <p className="device-message">Remote temperature limits: tool 0–260 °C; bed and chamber 0–75 °C.</p>}
      {remote && !!tools?.length && (caps.extrude || caps.temps) && <label className="oe-panel">Tool
        <select className="ds-select" aria-label="Tool" value={toolIndex} onChange={event => setToolIndex(Number(event.target.value))}>
          {!tools.some(tool => tool.Index === 0) && <option value="0">Tool 0</option>}
          {tools.map(tool => <option key={tool.Id} value={tool.Index}>{tool.Name || tool.Id} (tool {tool.Index})</option>)}
        </select>
      </label>}
      {commandError && (
        <div className="device-control-error" id="device-control-error">
          {commandError}
        </div>
      )}

      {caps.job && (
        <div className="device-control-group" id="control-group-job">
          <div className="device-btn-group">
            <button
              id="control-pause"
              className="btn btn-secondary"
              disabled={!isOnline || state?.state !== 'printing'}
              onClick={() => runCmd((api) => api.pausePrint?.() ?? Promise.resolve())}
            >
              {t('Pause')}
            </button>
            <button
              id="control-resume"
              className="btn btn-secondary"
              disabled={!isOnline || !isPaused}
              onClick={() => runCmd((api) => api.resumePrint?.() ?? Promise.resolve())}
            >
              {t('Resume')}
            </button>
            <button
              id="control-cancel"
              className="btn btn-secondary"
              disabled={!isOnline || !isPrinting}
              onClick={handleCancelPrint}
            >
              {t('Cancel print')}
            </button>
          </div>
        </div>
      )}

      {caps.home && (
        <div className="device-control-group" id="control-group-home">
          <div className="device-control-title">{t('Home all')}</div>
          <div className="device-btn-group">
            <button
              id="control-home-all"
              className="btn btn-secondary"
              disabled={motionDisabled}
              onClick={() => runCmd((api) => api.home?.() ?? Promise.resolve())}
            >
              {t('Home all')}
            </button>
            {!remote && <><button
              id="control-home-xy"
              className="btn btn-secondary"
              disabled={motionDisabled}
              onClick={() => runCmd((api) => api.home?.(['x', 'y']) ?? Promise.resolve())}
            >
              {t('Home XY')}
            </button>
            <button
              id="control-home-z"
              className="btn btn-secondary"
              disabled={motionDisabled}
              onClick={() => runCmd((api) => api.home?.(['z']) ?? Promise.resolve())}
            >
              {t('Home Z')}
            </button></>}
          </div>
        </div>
      )}

      {caps.jog && (
        <div className="device-control-group" id="control-group-jog">
          <div className="device-control-title-row">
            <span>{t('Jog')}</span>
            <div className="device-step-selector">
              <span className="device-step-label">{t('Step')}:</span>
              {[0.1, 1, 10, 50].map((s) => (
                <button
                  key={s}
                  id={`control-step-${s}`}
                  className={`btn-step${step === s ? ' active' : ''}`}
                  onClick={() => setStep(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="device-jog-container">
            <div className="device-jog-xy">
              <div className="jog-row">
                <button
                  id="control-jog-y-plus"
                  className="btn btn-secondary jog-btn"
                  disabled={motionDisabled}
                  title="Y+"
                  onClick={() => runCmd((api) => api.jog?.('y', step) ?? Promise.resolve())}
                >
                  +Y
                </button>
              </div>
              <div className="jog-row">
                <button
                  id="control-jog-x-minus"
                  className="btn btn-secondary jog-btn"
                  disabled={motionDisabled}
                  title="X-"
                  onClick={() => runCmd((api) => api.jog?.('x', -step) ?? Promise.resolve())}
                >
                  -X
                </button>
                <div className="jog-spacer" />
                <button
                  id="control-jog-x-plus"
                  className="btn btn-secondary jog-btn"
                  disabled={motionDisabled}
                  title="X+"
                  onClick={() => runCmd((api) => api.jog?.('x', step) ?? Promise.resolve())}
                >
                  +X
                </button>
              </div>
              <div className="jog-row">
                <button
                  id="control-jog-y-minus"
                  className="btn btn-secondary jog-btn"
                  disabled={motionDisabled}
                  title="Y-"
                  onClick={() => runCmd((api) => api.jog?.('y', -step) ?? Promise.resolve())}
                >
                  -Y
                </button>
              </div>
            </div>
            <div className="device-jog-z">
              <button
                id="control-jog-z-plus"
                className="btn btn-secondary jog-btn"
                disabled={motionDisabled}
                title="Z+"
                onClick={() => runCmd((api) => api.jog?.('z', step) ?? Promise.resolve())}
              >
                +Z
              </button>
              <button
                id="control-jog-z-minus"
                className="btn btn-secondary jog-btn"
                disabled={motionDisabled}
                title="Z-"
                onClick={() => runCmd((api) => api.jog?.('z', -step) ?? Promise.resolve())}
              >
                -Z
              </button>
            </div>
          </div>
        </div>
      )}

      {caps.extrude && (
        <div className="device-control-group" id="control-group-extrude">
          <div className="device-control-title">{t('Extrude')}</div>
          <div className="device-extrude-row">
            <span className="control-label">{t('Amount')}:</span>
            <input
              id="control-extrude-amount"
              type="number"
              className="control-input"
              value={extrudeAmount}
              min="1"
              max="100"
              onChange={(e) => setExtrudeAmount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            />
            <span>mm</span>
            <button
              id="control-extrude"
              className="btn btn-secondary"
              disabled={motionDisabled}
              onClick={() => runCmd((api) => api instanceof OctoEverywhereApi ? api.extrudeTool(toolIndex, extrudeAmount) : api.extrude?.(extrudeAmount) ?? Promise.resolve())}
            >
              {t('Extrude')}
            </button>
            <button
              id="control-retract"
              className="btn btn-secondary"
              disabled={motionDisabled}
              onClick={() => runCmd((api) => api instanceof OctoEverywhereApi ? api.extrudeTool(toolIndex, -extrudeAmount) : api.extrude?.(-extrudeAmount) ?? Promise.resolve())}
            >
              {t('Retract')}
            </button>
          </div>
        </div>
      )}

      {caps.temps && (
        <div className="device-control-group" id="control-group-temps">
          <div className="device-control-title">{t('Temperatures')}</div>
          <div className="device-temp-row">
            <span className="control-label">{t('Nozzle')}:</span>
            <input
              id="control-temp-nozzle-input"
              type="number"
              className="control-input"
              value={nozzleTarget}
              min="0"
              max={remote ? 260 : 300}
              onChange={(e) => setNozzleTarget(e.target.value)}
            />
            <span>°C</span>
            <button
              id="control-temp-nozzle-set"
              className="btn btn-secondary"
              disabled={controlsDisabled}
              onClick={() => { if (nozzleTarget.trim()) void handleSetNozzleTemp(Number(nozzleTarget)); }}
            >
              {t('Set')}
            </button>
            <button
              id="control-temp-nozzle-off"
              className="btn btn-secondary"
              disabled={controlsDisabled}
              onClick={() => runCmd((api) => api.setTemperature?.('extruder', 0, remote ? toolIndex : undefined) ?? Promise.resolve())}
            >
              {t('Off')}
            </button>
          </div>
          <div className="device-temp-row">
            <span className="control-label">{t('Bed')}:</span>
            <input
              id="control-temp-bed-input"
              type="number"
              className="control-input"
              value={bedTarget}
              min="0"
              max={remote ? 75 : 120}
              onChange={(e) => setBedTarget(e.target.value)}
            />
            <span>°C</span>
            <button
              id="control-temp-bed-set"
              className="btn btn-secondary"
              disabled={controlsDisabled}
              onClick={() => {
                if (!bedTarget.trim() || !Number.isFinite(Number(bedTarget))) return;
                const clamped = Math.max(0, Math.min(remote ? 75 : 120, Number(bedTarget)));
                runCmd((api) => api.setTemperature?.('bed', clamped) ?? Promise.resolve());
              }}
            >
              {t('Set')}
            </button>
            <button
              id="control-temp-bed-off"
              className="btn btn-secondary"
              disabled={controlsDisabled}
              onClick={() => runCmd((api) => api.setTemperature?.('bed', 0) ?? Promise.resolve())}
            >
              {t('Off')}
            </button>
          </div>
          {hasChamber && (
            <div className="device-temp-row">
              <span className="control-label">{t('Chamber')}:</span>
              <input
                id="control-temp-chamber-input"
                type="number"
                className="control-input"
                value={chamberTarget}
                min="0"
                max={remote ? 75 : 70}
                onChange={(e) => setChamberTarget(e.target.value)}
              />
              <span>°C</span>
              <button
                id="control-temp-chamber-set"
                className="btn btn-secondary"
                disabled={controlsDisabled}
                onClick={() => {
                  if (!chamberTarget.trim() || !Number.isFinite(Number(chamberTarget))) return;
                  const clamped = Math.max(0, Math.min(remote ? 75 : 70, Number(chamberTarget)));
                  runCmd((api) => api.setTemperature?.('chamber', clamped) ?? Promise.resolve());
                }}
              >
                {t('Set')}
              </button>
              <button
                id="control-temp-chamber-off"
                className="btn btn-secondary"
                disabled={controlsDisabled}
                onClick={() => runCmd((api) => api.setTemperature?.('chamber', 0) ?? Promise.resolve())}
              >
                {t('Off')}
              </button>
            </div>
          )}
        </div>
      )}

      {caps.fan && (
        <div className="device-control-group" id="control-group-fan">
          <div className="device-control-title">{t('Fan speed')}</div>
          <div className="device-fan-row">
            <input
              id="control-fan-input"
              type="range"
              min="0"
              max="100"
              value={fanSpeed}
              disabled={controlsDisabled}
              onChange={(e) => setFanSpeed(Number(e.target.value))}
            />
            <span className="device-fan-val">{fanSpeed}%</span>
            <button
              id="control-fan-set"
              className="btn btn-secondary"
              disabled={controlsDisabled}
              onClick={() => runCmd((api) => api.setFanSpeed?.(fanSpeed / 100) ?? Promise.resolve())}
            >
              {t('Set')}
            </button>
            <button
              id="control-fan-off"
              className="btn btn-secondary"
              disabled={controlsDisabled}
              onClick={() => {
                setFanSpeed(0);
                runCmd((api) => api.setFanSpeed?.(0) ?? Promise.resolve());
              }}
            >
              {t('Off')}
            </button>
          </div>
        </div>
      )}

      {caps.speed && (
        <div className="device-control-group" id="control-group-speed">
          <div className="device-control-title">{t('Print speed')}</div>
          {printer.host_type === 'bambu' ? (
            <div className="device-btn-group">
              <button
                id="control-speed-silent"
                className="btn btn-secondary"
                disabled={controlsDisabled}
                onClick={() => runCmd((api) => api.setPrintSpeed?.(1) ?? Promise.resolve())}
              >
                {t('Silent')}
              </button>
              <button
                id="control-speed-standard"
                className="btn btn-secondary"
                disabled={controlsDisabled}
                onClick={() => runCmd((api) => api.setPrintSpeed?.(2) ?? Promise.resolve())}
              >
                {t('Standard')}
              </button>
              <button
                id="control-speed-sport"
                className="btn btn-secondary"
                disabled={controlsDisabled}
                onClick={() => runCmd((api) => api.setPrintSpeed?.(3) ?? Promise.resolve())}
              >
                {t('Sport')}
              </button>
              <button
                id="control-speed-ludicrous"
                className="btn btn-secondary"
                disabled={controlsDisabled}
                onClick={() => runCmd((api) => api.setPrintSpeed?.(4) ?? Promise.resolve())}
              >
                {t('Ludicrous')}
              </button>
            </div>
          ) : (
            <div className="device-speed-row">
              <input
                id="control-speed-input"
                type="number"
                className="control-input"
                value={printSpeed}
                min="10"
                max="500"
                onChange={(e) => setPrintSpeed(Math.max(10, Math.min(500, Number(e.target.value) || 100)))}
              />
              <span>%</span>
              <button
                id="control-speed-set"
                className="btn btn-secondary"
                disabled={controlsDisabled}
                onClick={() => runCmd((api) => api.setPrintSpeed?.(printSpeed) ?? Promise.resolve())}
              >
                {t('Set')}
              </button>
              <button
                id="control-speed-100"
                className="btn btn-secondary"
                disabled={controlsDisabled}
                onClick={() => {
                  setPrintSpeed(100);
                  runCmd((api) => api.setPrintSpeed?.(100) ?? Promise.resolve());
                }}
              >
                100%
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const StatusColumn: React.FC<{ printer: PhysicalPrinter; state: PrinterState | null; liveState: PrinterState | null; status: PrinterConnectionStatus; active: boolean }> = ({ printer, state, liveState, status, active }) => {
    const { t } = useTranslation();
  const [camera, setCamera] = useState(0);
  const [tick, setTick] = useState(0);
  const cam = state?.webcams?.[Math.min(camera, (state.webcams?.length ?? 1) - 1)];

  useEffect(() => {
    if (!active || !cam?.snapshot) return;
    const timer = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(timer);
  }, [active, cam?.snapshot, cam?.url]);

  const snapmaker = printer.host_type === 'snapmaker-cloud';
  const prusa = printer.host_type === 'prusaconnect';
  const creality = printer.host_type === 'creality-cloud';
  const readingsAvailable = !!state;
  const { extruders, remainingHeaters, remainingFilamentSlots: slots } = deviceExtruderReadings(
    printer.host_type, readingsAvailable ? state.heaters : [], readingsAvailable ? state.filamentSlots : undefined,
  );
  const extruderCards = (snapmaker || extruders.length > 0) && <ExtruderCards extruders={extruders} inventoryKnown={slots !== undefined} />;
  const filaments = (prusa || creality || (snapmaker && !!slots?.length)) && (
    <section className="device-card" id="device-filaments" aria-labelledby="device-filaments-title">
      <h4 id="device-filaments-title">{t('Printer filaments')}</h4>
      <p className="device-filament-note">{prusa
        ? t('Reported material assignments do not confirm that filament is loaded.')
        : creality ? t('Reported by the printer. Ordinary external-spool assignments do not confirm that filament is loaded.')
        : t('Reported by the printer.')}</p>
      {slots === undefined ? <div className="device-message">{t('Filament information unavailable')}</div>
        : slots.length === 0 ? <div className="device-message">{t('No filament assignments reported')}</div>
        : <dl className="device-filament-list">
          {slots.map((slot) => (
            <div className="device-filament-row" key={slot.id} data-slot={slot.slotIndex}>
              <dt>{slot.label}</dt>
              <dd>
                {slot.presence === 'empty' ? (prusa ? t('No material assigned') : t('Empty')) : <>
                  <div>{slot.material || t('Unknown material')}</div>
                  {(slot.vendor || slot.subtype) && <div className="device-filament-detail">{[slot.vendor, slot.subtype].filter(Boolean).join(' · ')}</div>}
                  <div className="device-filament-detail">{prusa || (creality && slot.id === 'rack-1')
                    ? (slot.presence === 'present' ? t('Assigned') : t('Assignment unknown'))
                    : (slot.presence === 'present' ? t('Present') : t('Presence unknown'))}</div>
                  {slot.color && <div className="device-filament-color">
                    <span className="device-filament-swatch" aria-hidden="true" style={{ '--swatch': slot.color } as React.CSSProperties} />
                    <span aria-label={`${t('Color')}: ${slot.color}`}>{slot.color}</span>
                  </div>}
                </>}
              </dd>
            </div>
          ))}
        </dl>}
    </section>
  );

  if (!state) {
    return (
      <div className="device-status-col" id="device-status">
        <div className="device-card">
          <h4>{t("Status")}</h4>
          <div className="device-state device-no-readings" data-state={status} id="device-state">
            {t('No saved readings yet. Readings will appear when the printer responds.')}
          </div>
        </div>
        {extruderCards}
        {filaments}
        <ControlsCard printer={printer} state={liveState} status={status} />
      </div>
    );
  }

  const printing = state.state === 'printing' || state.state === 'paused' || state.state === 'complete';
  return (
    <div className="device-status-col" id="device-status">
      <div className="device-card">
        <h4>{t("Status")}</h4>
        <div className="device-state" data-state={state.state} id="device-state">{state.state}</div>
        {state.message && <div className="device-message">{state.message}</div>}
        {state.software && <div className="device-message">{state.software}</div>}
      </div>

      {printing && (
        <div className="device-card" id="device-job">
          <h4>{t("Job")}</h4>
          <div className="device-file">{state.file ?? '-'}</div>
          {state.progress != null && (
            <div className="device-progress" role="progressbar" aria-valuenow={Math.round(state.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.min(100, state.progress * 100)}%` }} />
            </div>
          )}
          {state.progress != null && <Row label={t("Progress")} value={`${(state.progress * 100).toFixed(1)}%`} />}
          <Row label={t("Elapsed")} value={formatDuration(state.elapsed)} />
          <Row label={t("Remaining")} value={formatDuration(state.remaining)} />
          {state.layer && <Row label={t("Layer")} value={`${state.layer.current}${state.layer.total ? ` / ${state.layer.total}` : ''}`} />}
        </div>
      )}

      <ControlsCard printer={printer} state={liveState} status={status} />

      {extruderCards}

      {(remainingHeaters.length > 0 || extruders.length === 0) && <div className="device-card" id="device-temps">
        <h4>{t("Temperatures")}</h4>
        {remainingHeaters.length === 0 && <div className="device-message">{t("No heaters reported")}</div>}
        {remainingHeaters.map((h) => (
          <div className="device-heater" key={h.id} data-kind={h.kind} data-heater={h.id}>
            <div className="device-row">
              <span>{h.label}{state.activeTool && h.id === state.activeTool ? ' (active)' : ''}</span>
              <span>{h.current.toFixed(1)} / {h.target.toFixed(0)} {t("°C")}</span>
            </div>
            <div className="device-heater-bar"><div style={{ width: `${Math.min(100, (h.current / Math.max(h.target, 250)) * 100)}%` }} /></div>
          </div>
        ))}
      </div>}

      {filaments}

      {(state.fans.length > 0 || state.speedFactor != null || state.position || state.activeTool) && (
        <div className="device-card" id="device-motion">
          <h4>{t("Motion and fans")}</h4>
          {state.activeTool && <Row label={t("Active tool")} value={state.activeTool} />}
          {state.position && <Row label={t("Position")} value={`X ${state.position.x.toFixed(1)}  Y ${state.position.y.toFixed(1)}  Z ${state.position.z.toFixed(2)}`} />}
          {state.speedFactor != null && <Row label={t("Speed")} value={`${state.speedFactor}%`} />}
          {state.flowFactor != null && <Row label={t("Flow")} value={`${state.flowFactor}%`} />}
          {state.fans.map((f) => <Row key={f.id} label={f.label} value={`${Math.round(f.speed * 100)}%`} />)}
        </div>
      )}

      {active && cam && (
        <div className="device-card device-camera" id="device-camera">
          <h4>{t("Camera")}</h4>
          {(state.webcams?.length ?? 0) > 1 && (
            <select value={camera} onChange={(e) => setCamera(Number(e.target.value))} aria-label={t("Camera")}>
              {state.webcams!.map((w, i) => <option key={w.name} value={i}>{w.name}</option>)}
            </select>
          )}
          <img crossOrigin={cam.url.startsWith('http') ? 'anonymous' : undefined} referrerPolicy="origin" src={cam.snapshot ? `${cam.url}${cam.url.includes('?') ? '&' : '?'}t=${tick}` : cam.url} alt={cam.name} />
        </div>
      )}

      {state.files && state.files.length > 0 && (
        <div className="device-card" id="device-files">
          <h4>{t("Recent files")}</h4>
          <div className="device-files">
            {state.files.map((f) => <Row key={f.name} label={f.name} value={formatBytes(f.size)} />)}
          </div>
        </div>
      )}
    </div>
  );
};

const WebUiColumn: React.FC<{ printer: PhysicalPrinter; active: boolean }> = ({ printer, active }) => {
    const { t } = useTranslation();
  const url = webUiUrl(printer);
  const remote = printer.octoeverywhere?.mode === 'remote';
  const cloud = remote || printer.host_type === 'prusaconnect' || printer.host_type === 'creality-cloud';
  // Load the UI the first time the tab shows, then keep it alive so switching tabs does not reload it.
  const [visited, setVisited] = useState(false);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  useEffect(() => setVisited(active), [url]);
  const mixed = !!url && window.location.protocol === 'https:' && url.startsWith('http:');
  if (remote) return null;
  if (printer.host_type === 'prusaconnect') {
    const targetUrl = url || 'https://connect.prusa3d.com';
    return (
      <div className="device-ui-col" id="device-webui">
        <div className="device-ui-bar" style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>
          <a
            href={targetUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            id="device-webui-open"
            style={{ textDecoration: 'none' }}
          >
            {t('Open in Prusa Connect')}
          </a>
        </div>
      </div>
    );
  }
  if (cloud && url) {
    return (
      <div className="device-ui-col" id="device-webui">
        <div className="device-notice" id="device-webui-blocked">
          {t('Open Creality Cloud to use its device controls.')}{' '}
          <a href={url} target="_blank" rel="noreferrer" id="device-webui-open">{t('Open Creality Cloud in a new tab')}</a>
        </div>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="device-ui-col">
        <div className="device-notice">
          {printer.host_type === 'snapmaker-cloud' ? t('Snapmaker Cloud shows printer-reported status, temperatures and filament assignments. Printer controls are unavailable.') : printer.host_type === 'bambu'
            ? 'Bambu Lab printers have no web UI. Their status is shown on the left.'
            : 'No web UI address is set for this printer. Add one in the printer settings.'}
        </div>
      </div>
    );
  }
  return (
    <div className="device-ui-col" id="device-webui">
      <div className="device-ui-bar">
        <span title={url}>{t("Web UI:")}{url}</span>
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-secondary" id="device-webui-open" style={{ textDecoration: 'none' }}>{t("Open in new tab")}</a>
      </div>
      <div className="device-ui-frame">
        {mixed ? (
          <div className="device-notice" id="device-webui-blocked">
            {t("This page is served over https, so the browser blocks the printer's http web UI inside it. Use \"Open in new tab\".")}</div>
        ) : (
          visited && <iframe id="device-webui-frame" src={url} title={t("Printer Web UI")} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        )}
      </div>
    </div>
  );
};

const UI_COLLAPSED_KEY = 'orca.device.webUiCollapsed';

/** The Device tab: a native status dashboard on the left and the printer's own web UI on the right. */
export const DevicePanel: React.FC<{ active: boolean }> = ({ active }) => {
    const { t } = useTranslation();
  const { printers, selectedPrinterId, status, error, liveState, cachedState, lastRefreshedAt, monitoringPaused, selectPrinter, openDialog, setDeviceTabActive, savePrinter } = usePrinterConnectionStore();
  const printer = useMemo(() => printers.find((p) => p.id === selectedPrinterId), [printers, selectedPrinterId]);
  const [uiCollapsed, setUiCollapsedState] = useState(() => {
    try { return localStorage.getItem(UI_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const setUiCollapsed = (collapsed: boolean) => {
    setUiCollapsedState(collapsed);
    try { localStorage.setItem(UI_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* Storage may be blocked. */ }
  };

  useEffect(() => {
    setDeviceTabActive(active);
    return () => setDeviceTabActive(false);
  }, [active, setDeviceTabActive]);

  if (printers.length === 0) {
    return (
      <div className="device-panel" id="device-panel">
        <div className="device-empty">
          <div>{t("No printer is connected yet.")}</div>
          <button className="btn btn-primary" id="device-add-printer" onClick={() => openDialog(null)}>{t("Add a printer")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="device-panel" id="device-panel">
      <div className="device-header">
        <select id="device-printer-select" value={selectedPrinterId ?? ''} onChange={(e) => selectPrinter(e.target.value)} aria-label={t("Printer")}>
          {printers.map((p) => <option key={p.id} value={p.id}>{p.name} ({HOST_TYPE_LABELS[p.host_type]})</option>)}
        </select>
        <span className="device-status-dot" data-status={status} id="device-connection-dot" />
        <span id="device-connection-status">{monitoringPaused ? t('Monitoring paused') : status === 'online' ? t('Connected') : status === 'connecting' ? t('Refreshing…') : status === 'error' ? t('Not connected') : t('Waiting for the printer...')}</span>
        <DeviceFreshness active={active} paused={monitoringPaused} saved={!liveState && !!cachedState} refreshedAt={lastRefreshedAt} />
        {status === 'error' && error && <span className="device-error" id="device-connection-error">{error}</span>}
        {status === 'error' && printer?.host_type === 'snapmaker-cloud' && (
          <button className="btn btn-secondary" id="device-reconnect" onClick={reconnectPrinterSession}>{t('Retry')}</button>
        )}
        <span className="device-spacer" />
        <button className="btn btn-secondary" id="device-edit-printer" onClick={() => openDialog(selectedPrinterId)}>{t("Printer settings")}</button>
        <button className="btn btn-secondary" id="device-add-another" onClick={() => openDialog(null)}>{t("Add printer")}</button>
      </div>
      {printer && <details className="oe-panel" style={{ padding: '0 16px' }}><summary>Remote connection · {printer.octoeverywhere?.mode === 'remote' ? 'OctoEverywhere' : 'Local'}</summary>
        <OctoEverywhereConnection key={printer.id} printer={printer} onChange={updated => {
          const current = usePrinterConnectionStore.getState();
          if (current.selectedPrinterId === printer.id && current.printers.find(p => p.id === printer.id) === printer) savePrinter(updated);
        }} />
      </details>}
      {printer && (
        <DeviceSplit active={active} collapsed={uiCollapsed}
          status={<StatusColumn key={printer.id + (printer.octoeverywhere?.mode ?? 'local')} printer={printer} state={liveState ?? cachedState} liveState={liveState} status={status} active={active && !monitoringPaused && !!liveState} />}
          webUi={<div className="device-ui-side">
            <button
              id="device-webui-toggle" className="device-ui-toggle" aria-expanded={!uiCollapsed}
              title={uiCollapsed ? 'Show the printer web UI' : 'Hide the printer web UI'} onClick={() => setUiCollapsed(!uiCollapsed)}
            >
              {printer.octoeverywhere?.mode === 'remote' ? (uiCollapsed ? 'Show remote tools' : 'Hide remote tools') : (uiCollapsed ? '◂ Web UI' : 'Hide web UI ▸')}
            </button>
            {/* Stays mounted while hidden so the printer's UI keeps its session and does not reload. */}
            <div className="device-ui-hold">
              {printer.octoeverywhere?.mode === 'remote' ? <OctoEverywherePanel key={printer.id + printer.octoeverywhere.connection?.connectionId} printer={printer} state={liveState} active={active && !uiCollapsed} />
                : <WebUiColumn printer={printer} active={active && !uiCollapsed} />}
            </div>
          </div>}
        />
      )}
    </div>
  );
};
