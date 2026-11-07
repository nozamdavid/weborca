import React, { useEffect, useRef, useState } from 'react';
import type { PhysicalPrinter } from './types';
import { cancelOctoEverywherePortal, getOctoEverywhereConfig, getOctoEverywherePortalResult, isOctoEverywhereConnection,
  safeOctoEverywhereUserUrl, startOctoEverywherePortal, type OctoEverywhereConfig, type OctoEverywhereConnection as Connection } from './octoEverywhere';
import { confirmDialog } from '../components/ModalBackdrop';
import { usePrinterConnectionStore } from './connectionStore';
import './OctoEverywhere.css';

/** A portal result stays in memory until the user confirms its saved-printer binding. */
export const OctoEverywhereConnection: React.FC<{ printer: PhysicalPrinter; onChange: (printer: PhysicalPrinter) => void }> = ({ printer, onChange }) => {
  const [config, setConfig] = useState<OctoEverywhereConfig>();
  const [waiting, setWaiting] = useState(false);
  const [candidate, setCandidate] = useState<Connection>();
  const [message, setMessage] = useState('');
  const cancel = useRef<() => void>(() => {});
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
    void getOctoEverywhereConfig(abort.signal).then(setConfig, () => { if (!abort.signal.aborted) setMessage('OctoEverywhere configuration could not be loaded. Check the app server and try again.'); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    setCandidate(undefined); setWaiting(false);
    return () => cancel.current();
  }, [fingerprint]);
  const link = async () => {
    cancel.current(); setCandidate(undefined); setMessage(''); setWaiting(true);
    const original = fingerprint;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let flow: Awaited<ReturnType<typeof startOctoEverywherePortal>> | undefined;
    const abort = new AbortController();
    cancel.current = () => {
      alive = false; abort.abort(); clearTimeout(timer);
      if (flow) void cancelOctoEverywherePortal(flow).catch(() => {});
    };
    try {
      // Open synchronously so browser popup rules permit external navigation.
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      try { flow = await startOctoEverywherePortal({ printerId: printer.id, requestOctoPrintApiKey: printer.host_type === 'octoprint' }, abort.signal); }
      catch (error) { tab?.close(); throw error; }
      if (!alive || current.current !== original || !stillCurrent()) { tab?.close(); if (flow) void cancelOctoEverywherePortal(flow).catch(() => {}); return; }
      if (!tab) throw new Error('popup');
      tab.location.replace(flow.portalUrl);
      const poll = async () => {
        try {
          const result = await getOctoEverywherePortalResult(flow!, abort.signal);
          if (!alive || current.current !== original || !stillCurrent()) return;
          if (result.status === 'pending') timer = setTimeout(poll, 2000);
          else {
            setWaiting(false);
            if (result.status === 'complete') setCandidate(result.connection);
            else setMessage('Connection was not authorized. Try connecting again.');
          }
        } catch { if (alive) { setWaiting(false); setMessage('Connection could not be completed. Cancel and try again.'); } }
      };
      void poll();
    } catch { if (alive) { cancel.current(); setWaiting(false); setMessage('Could not open the connection portal. Allow popups, check the app server, and try again.'); } }
  };
  const connection = printer.octoeverywhere?.connection;
  const valid = isOctoEverywhereConnection(connection);
  const url = safeOctoEverywhereUserUrl(connection?.userFacingUrl);
  return <section className="oe-connection oe-panel" aria-label="OctoEverywhere connection">
    <h4>OctoEverywhere</h4>
    <p>Optional remote access for {printer.name || 'this printer'}. Local settings are retained.</p>
    {valid && <div className="oe-actions" role="group" aria-label="Connection transport">
      {(['local', 'remote'] as const).map(mode => <button type="button" className="ds-btn" key={mode} aria-pressed={(printer.octoeverywhere?.mode ?? 'local') === mode}
        onClick={() => onChange({ ...printer, octoeverywhere: { ...printer.octoeverywhere!, mode } })}>{mode === 'local' ? 'Local' : 'OctoEverywhere'}</button>)}
      {url && <a className="ds-btn" href={url} target="_blank" rel="noopener noreferrer">Open printer</a>}
    </div>}
    {printer.octoeverywhere?.mode === 'remote' && !valid && <p role="alert">Remote authorization is invalid. Reconnect or choose Local before sending commands.
      <button type="button" className="ds-btn" onClick={() => onChange({ ...printer, octoeverywhere: { mode: 'local' } })}>Use Local</button></p>}
    {!config ? <p>Checking remote connection availability…</p> : !config.enabled ? <p>Remote access is disabled on this app server. Ask its administrator to enable OctoEverywhere.</p>
      : !config.portalAvailable ? <p>Connecting requires a production OctoEverywhere App ID. Ask the app administrator to configure ORCA_OCTOEVERYWHERE_APP_ID.</p> : null}
    <div className="oe-actions">
      <button type="button" className="ds-btn" disabled={!config?.portalAvailable || waiting} onClick={link}>{valid ? 'Reconnect OctoEverywhere' : 'Connect OctoEverywhere'}</button>
      {(waiting || candidate) && <button type="button" className="ds-btn" onClick={() => { cancel.current(); setWaiting(false); setCandidate(undefined); }}>Cancel connection</button>}
      {valid && <button type="button" className="ds-btn" onClick={async () => {
        if (await confirmDialog({ title: 'Detach OctoEverywhere?', message: 'WebOrca will use Local. To revoke provider authorization, manage this connection on OctoEverywhere.', confirmLabel: 'Detach', cancelLabel: 'Keep connection' }) && stillCurrent())
          onChange({ ...printer, octoeverywhere: undefined });
      }}>Detach</button>}
    </div>
    {waiting && <p role="status">Authorize in the new tab. This page is waiting for the result.</p>}
    {candidate && <div><p>Bind authorized printer “{candidate.printerName || 'Unnamed printer'}” to “{printer.name}”? Verify this is the same physical printer.</p>
      <button type="button" className="ds-btn ds-btn--primary" onClick={() => { if (stillCurrent()) { onChange({ ...printer, octoeverywhere: { mode: 'remote', connection: candidate } }); setCandidate(undefined); } }}>Confirm printer binding</button></div>}
    {message && <p role="alert">{message}</p>}
  </section>;
};
