import React, { useEffect, useMemo, useState } from 'react';
import { usePrinterConnectionStore } from './connectionStore';
import { formatBytes, formatDuration } from './format';
import { createUiSession, localGatewayBase, parseHost } from './gatewayUrl';
import type { PhysicalPrinter, PrinterState } from './types';
import { HOST_TYPE_LABELS } from './types';
import './DevicePanel.css';

/** Where the printer's own web UI lives: the explicit UI address, else the host (Moonraker's API port 7125 maps to the UI on 80). */
export function webUiUrl(printer: PhysicalPrinter): string | undefined {
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

const StatusColumn: React.FC<{ state: PrinterState | null; active: boolean }> = ({ state, active }) => {
  const [camera, setCamera] = useState(0);
  const [tick, setTick] = useState(0);
  const cam = state?.webcams?.[Math.min(camera, (state.webcams?.length ?? 1) - 1)];

  useEffect(() => {
    if (!active || !cam?.snapshot) return;
    const timer = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(timer);
  }, [active, cam?.snapshot, cam?.url]);

  if (!state) return <div className="device-status-col"><div className="device-card">Waiting for the printer...</div></div>;

  const printing = state.state === 'printing' || state.state === 'paused' || state.state === 'complete';
  return (
    <div className="device-status-col" id="device-status">
      <div className="device-card">
        <h4>Status</h4>
        <div className="device-state" data-state={state.state} id="device-state">{state.state}</div>
        {state.message && <div className="device-message">{state.message}</div>}
        {state.software && <div className="device-message">{state.software}</div>}
      </div>

      {printing && (
        <div className="device-card" id="device-job">
          <h4>Job</h4>
          <div className="device-file">{state.file ?? '-'}</div>
          {state.progress != null && (
            <div className="device-progress" role="progressbar" aria-valuenow={Math.round(state.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.min(100, state.progress * 100)}%` }} />
            </div>
          )}
          {state.progress != null && <Row label="Progress" value={`${(state.progress * 100).toFixed(1)}%`} />}
          <Row label="Elapsed" value={formatDuration(state.elapsed)} />
          <Row label="Remaining" value={formatDuration(state.remaining)} />
          {state.layer && <Row label="Layer" value={`${state.layer.current}${state.layer.total ? ` / ${state.layer.total}` : ''}`} />}
        </div>
      )}

      <div className="device-card" id="device-temps">
        <h4>Temperatures</h4>
        {state.heaters.length === 0 && <div className="device-message">No heaters reported</div>}
        {state.heaters.map((h) => (
          <div className="device-heater" key={h.id} data-kind={h.kind} data-heater={h.id}>
            <div className="device-row">
              <span>{h.label}{state.activeTool && h.id === state.activeTool ? ' (active)' : ''}</span>
              <span>{h.current.toFixed(1)} / {h.target.toFixed(0)} °C</span>
            </div>
            <div className="device-heater-bar"><div style={{ width: `${Math.min(100, (h.current / Math.max(h.target, 250)) * 100)}%` }} /></div>
          </div>
        ))}
      </div>

      {(state.fans.length > 0 || state.speedFactor != null || state.position || state.activeTool) && (
        <div className="device-card" id="device-motion">
          <h4>Motion and fans</h4>
          {state.activeTool && <Row label="Active tool" value={state.activeTool} />}
          {state.position && <Row label="Position" value={`X ${state.position.x.toFixed(1)}  Y ${state.position.y.toFixed(1)}  Z ${state.position.z.toFixed(2)}`} />}
          {state.speedFactor != null && <Row label="Speed" value={`${state.speedFactor}%`} />}
          {state.flowFactor != null && <Row label="Flow" value={`${state.flowFactor}%`} />}
          {state.fans.map((f) => <Row key={f.id} label={f.label} value={`${Math.round(f.speed * 100)}%`} />)}
        </div>
      )}

      {active && cam && (
        <div className="device-card device-camera" id="device-camera">
          <h4>Camera</h4>
          {(state.webcams?.length ?? 0) > 1 && (
            <select value={camera} onChange={(e) => setCamera(Number(e.target.value))} aria-label="Camera">
              {state.webcams!.map((w, i) => <option key={w.name} value={i}>{w.name}</option>)}
            </select>
          )}
          <img crossOrigin={cam.url.startsWith('http') ? 'anonymous' : undefined} referrerPolicy="origin" src={cam.snapshot ? `${cam.url}${cam.url.includes('?') ? '&' : '?'}t=${tick}` : cam.url} alt={cam.name} />
        </div>
      )}

      {state.files && state.files.length > 0 && (
        <div className="device-card" id="device-files">
          <h4>Recent files</h4>
          <div className="device-files">
            {state.files.map((f) => <Row key={f.name} label={f.name} value={formatBytes(f.size)} />)}
          </div>
        </div>
      )}
    </div>
  );
};

const WebUiColumn: React.FC<{ printer: PhysicalPrinter; active: boolean }> = ({ printer, active }) => {
  const url = webUiUrl(printer);
  // Load the UI the first time the tab shows, then keep it alive so switching tabs does not reload it.
  const [visited, setVisited] = useState(false);
  useEffect(() => {
    if (active) setVisited(true);
  }, [active]);
  useEffect(() => setVisited(active), [url]);
  // With a gateway on the user's computer the UI is framed from its own http://<label>.localhost origin, which an https page may embed.
  const local = !!url && !!localGatewayBase(printer);
  const [session, setSession] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    setSession({});
    if (!local || !url || !visited) return;
    let cancelled = false;
    createUiSession(printer, url).then((u) => !cancelled && setSession({ url: u }), (e) => !cancelled && setSession({ error: e instanceof Error ? e.message : String(e) }));
    return () => { cancelled = true; };
  }, [local, url, visited, printer.local_gateway]); // eslint-disable-line react-hooks/exhaustive-deps
  const mixed = !local && !!url && window.location.protocol === 'https:' && url.startsWith('http:');
  if (!url) {
    return (
      <div className="device-ui-col">
        <div className="device-notice">
          {printer.host_type === 'bambu'
            ? 'Bambu Lab printers have no web UI. Their status is shown on the left.'
            : 'No web UI address is set for this printer. Add one in the printer settings.'}
        </div>
      </div>
    );
  }
  return (
    <div className="device-ui-col" id="device-webui">
      <div className="device-ui-bar">
        <span title={url}>Web UI: {url}</span>
        <a href={url} target="_blank" rel="noreferrer" className="btn btn-secondary" id="device-webui-open" style={{ textDecoration: 'none' }}>Open in new tab</a>
      </div>
      <div className="device-ui-frame">
        {local ? (
          session.error ? <div className="device-notice" id="device-webui-blocked">{session.error}</div>
            : session.url && <iframe id="device-webui-frame" src={session.url} referrerPolicy="origin" title="Printer Web UI" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        ) : mixed ? (
          <div className="device-notice" id="device-webui-blocked">
            This page is served over https, so the browser blocks the printer's http web UI inside it. Use "Open in new tab".
          </div>
        ) : (
          visited && <iframe id="device-webui-frame" src={url} title="Printer Web UI" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        )}
      </div>
    </div>
  );
};

/** The Device tab: a native status dashboard on the left and the printer's own web UI on the right. */
export const DevicePanel: React.FC<{ active: boolean }> = ({ active }) => {
  const { printers, selectedPrinterId, status, error, liveState, selectPrinter, openDialog, setDeviceTabActive } = usePrinterConnectionStore();
  const printer = useMemo(() => printers.find((p) => p.id === selectedPrinterId), [printers, selectedPrinterId]);

  useEffect(() => {
    setDeviceTabActive(active);
    return () => setDeviceTabActive(false);
  }, [active, setDeviceTabActive]);

  if (printers.length === 0) {
    return (
      <div className="device-panel" id="device-panel">
        <div className="device-empty">
          <div>No printer is connected yet.</div>
          <button className="btn btn-primary" id="device-add-printer" onClick={() => openDialog(null)}>Add a printer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="device-panel" id="device-panel">
      <div className="device-header">
        <select id="device-printer-select" value={selectedPrinterId ?? ''} onChange={(e) => selectPrinter(e.target.value)} aria-label="Printer">
          {printers.map((p) => <option key={p.id} value={p.id}>{p.name} ({HOST_TYPE_LABELS[p.host_type]})</option>)}
        </select>
        <span className="device-status-dot" data-status={status} id="device-connection-dot" />
        <span id="device-connection-status">{status === 'online' ? 'Connected' : status === 'connecting' ? 'Connecting...' : status === 'error' ? 'Not connected' : 'No printer'}</span>
        {status === 'error' && error && <span className="device-error" id="device-connection-error">{error}</span>}
        <span className="device-spacer" />
        <button className="btn btn-secondary" id="device-edit-printer" onClick={() => openDialog(selectedPrinterId)}>Printer settings</button>
        <button className="btn btn-secondary" id="device-add-another" onClick={() => openDialog(null)}>Add printer</button>
      </div>
      {printer && (
        <div className="device-body">
          <StatusColumn state={liveState} active={active} />
          <WebUiColumn printer={printer} active={active} />
        </div>
      )}
    </div>
  );
};
