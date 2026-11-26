import React, { useEffect, useRef, useState } from 'react';
import type { PhysicalPrinter } from './types';
import { cancelPortalFlow, createPortalFlow, getOctoEverywhereConfig, isOctoEverywhereConnection,
  listenPortalFlow, safeOctoEverywhereUserUrl, type OctoEverywhereConfig, type OctoEverywhereConnection as Connection } from './octoEverywhere';
import { confirmDialog } from '../components/ModalBackdrop';
import { usePrinterConnectionStore } from './connectionStore';
import './OctoEverywhere.css';

/** A portal result stays in memory until the user confirms its saved-printer binding. */
export const OctoEverywhereConnection: React.FC<{ printer: PhysicalPrinter; onChange: (printer: PhysicalPrinter) => void; onConfig?: (config: OctoEverywhereConfig) => void }> = ({ printer, onChange, onConfig }) => {
  const [config, setConfig] = useState<OctoEverywhereConfig>();
  const [waiting, setWaiting] = useState(false);
  const [portalUrl, setPortalUrl] = useState<string>();
  const [candidate, setCandidate] = useState<Connection>();
  const [message, setMessage] = useState('');
  const cancel = useRef<() => void>(() => {});
  const onConfigRef = useRef(onConfig);
  onConfigRef.current = onConfig;
  const selected = usePrinterConnectionStore(s => s.selectedPrinterId);
  const saved = usePrinterConnectionStore(s => s.printers.find(p => p.id === printer.id));
  const fingerprint = JSON.stringify([printer, saved, selected]);
  const current = useRef(fingerprint);
  current.current = fingerprint;
  const stillCurrent = () => {
    const state = usePrinterConnectionStore.getState();
    return current.current === fingerprint && JSON.stringify([printer, state.printers.find(p => p.id === printer.id), state.selectedPrinterId]) === fingerprint;
  };
  useEffect(() => {
    const abort = new AbortController();
    void getOctoEverywhereConfig(abort.signal).then(
      cfg => { if (!abort.signal.aborted) { setConfig(cfg); onConfigRef.current?.(cfg); } },
      () => { if (!abort.signal.aborted) setMessage('OctoEverywhere configuration could not be loaded. Check the app server and try again.'); }
    );
    return () => abort.abort();
  }, []);
  useEffect(() => {
    setCandidate(undefined); setWaiting(false); setPortalUrl(undefined);
    return () => cancel.current();
  }, [fingerprint]);
  const link = () => {
    if (!config?.portalAvailable || !config.appId) return;
    cancel.current(); setCandidate(undefined); setPortalUrl(undefined); setMessage(''); setWaiting(true);
    const original = fingerprint;
    let alive = true;
    let stopListening = () => {};
    let flowId: string | undefined;
    const abort = new AbortController();
    cancel.current = () => {
      alive = false;
      abort.abort();
      stopListening();
      if (flowId) cancelPortalFlow(flowId);
    };
    let tab: Window | null = null;
    try {
      // Open synchronously so browser popup rules permit external navigation.
      tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      const oePrinterId = printer.octoeverywhere?.connection?.printerId;
      const flow = createPortalFlow(config.appId, {
        ...(oePrinterId ? { printerId: oePrinterId } : {}),
        requestOctoPrintApiKey: printer.host_type === 'octoprint'
      });
      flowId = flow.flowId;
      if (!alive || current.current !== original || !stillCurrent()) {
        tab?.close();
        cancelPortalFlow(flow.flowId);
        return;
      }
      if (tab) tab.location.replace(flow.portalUrl);
      else setPortalUrl(flow.portalUrl);
      stopListening = listenPortalFlow(flow, result => {
        if (!alive || current.current !== original || !stillCurrent()) return;
        cancel.current = () => {};
        setWaiting(false); setPortalUrl(undefined);
        if (result.status === 'complete') setCandidate(result.connection);
        else setMessage('Connection was not authorized. Try connecting again.');
      });
    } catch {
      tab?.close();
      if (alive) {
        cancel.current();
        setWaiting(false);
        setPortalUrl(undefined);
        setMessage('Could not open the connection portal. Allow popups, check the app server, and try again.');
      }
    }
  };
  const connection = printer.octoeverywhere?.connection;
  const valid = isOctoEverywhereConnection(connection);
  const url = safeOctoEverywhereUserUrl(connection?.userFacingUrl);
  return <section className="oe-connection oe-panel" aria-label="OctoEverywhere connection">
    <h4>OctoEverywhere</h4>
    <p>Optional remote access for {printer.name || 'this printer'}. Local settings are retained.</p>
    {valid && <p>Connected to “{connection.printerName}”.</p>}
    {valid && <div className="oe-actions" role="group" aria-label="Connection transport">
      {(['local', 'remote'] as const).map(mode => {
        const localDisabled = mode === 'local' && !printer.print_host.trim();
        return <button type="button" className="ds-btn" key={mode} aria-pressed={(printer.octoeverywhere?.mode ?? 'local') === mode}
          disabled={localDisabled}
          title={localDisabled ? 'Add a local printer address in Printer settings to use Local mode.' : undefined}
          onClick={() => onChange({ ...printer, octoeverywhere: { ...printer.octoeverywhere!, mode } })}>{mode === 'local' ? 'Local' : 'OctoEverywhere'}</button>;
      })}
      {url && <a className="ds-btn" href={url} target="_blank" rel="noopener noreferrer">Open printer</a>}
    </div>}
    {printer.octoeverywhere?.mode === 'remote' && !valid && <p role="alert">Remote authorization is invalid. Reconnect or choose Local before sending commands.
      <button type="button" className="ds-btn" onClick={() => onChange({ ...printer, octoeverywhere: { mode: 'local' } })}>Use Local</button></p>}
    {!config ? <p>Checking remote connection availability…</p> : !config.enabled ? <p>Remote access is disabled on this app server. Ask its administrator to enable OctoEverywhere.</p>
      : !config.portalAvailable ? <p>Connecting requires a production OctoEverywhere App ID. Ask the app administrator to configure ORCA_OCTOEVERYWHERE_APP_ID.</p> : null}
    <div className="oe-actions">
      <button type="button" className="ds-btn" disabled={!config?.portalAvailable || waiting} onClick={link}>{valid ? 'Reconnect OctoEverywhere' : 'Connect OctoEverywhere'}</button>
      {(waiting || candidate) && <button type="button" className="ds-btn" onClick={() => { cancel.current(); setWaiting(false); setPortalUrl(undefined); setCandidate(undefined); }}>Cancel connection</button>}
      {valid && <button type="button" className="ds-btn" onClick={async () => {
        if (await confirmDialog({ title: 'Detach OctoEverywhere?', message: 'WebOrca will use Local. To revoke provider authorization, manage this connection on OctoEverywhere.', confirmLabel: 'Detach', cancelLabel: 'Keep connection' }) && stillCurrent())
          onChange({ ...printer, octoeverywhere: undefined });
      }}>Detach</button>}
    </div>
    {waiting && <p role="status">{portalUrl ? 'Popup was blocked. Open the OctoEverywhere portal below to authorize. This page is waiting for the result.' : 'Authorize in the new tab. This page is waiting for the result.'}</p>}
    {waiting && portalUrl && <div className="oe-actions"><a className="ds-btn ds-btn--primary" href={portalUrl} target="_blank" rel="noopener noreferrer">Open OctoEverywhere portal</a></div>}
    {candidate && <div><p>Bind authorized printer “{candidate.printerName || 'Unnamed printer'}” to “{printer.name || 'this printer'}”? Verify this is the same physical printer.</p>
      <button type="button" className="ds-btn ds-btn--primary" onClick={() => {
        if (stillCurrent()) {
          onChange({
            ...printer,
            ...(!printer.name.trim() && candidate.printerName ? { name: candidate.printerName } : {}),
            octoeverywhere: { mode: 'remote', connection: candidate }
          });
          setCandidate(undefined);
        }
      }}>Confirm printer binding</button></div>}
    {message && <p role="alert">{message}</p>}
  </section>;
};
