import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/appStore';
import { createPrinterApi } from './api';
import { usePrinterConnectionStore } from './connectionStore';
import { useTranslation } from '../i18n';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { getExportGcodePayload } from '../shell/exportGcode';

/**
 * "Send to printer" after slicing, like desktop's upload dialog. Starting a print is a separate, confirmed
 * step, because it moves a real machine.
 */
export const SendToPrinterDialog: React.FC<{ getGcode: () => Uint8Array | null; defaultFilename: string }> = ({ getGcode, defaultFilename }) => {
  const { t } = useTranslation();
  const { sendDialogOpen, printers, selectedPrinterId, selectPrinter, closeSendDialog, openDialog } = usePrinterConnectionStore();
  const preset = useAppStore((s) => s.selectedPrinter);
  const [filename, setFilename] = useState(defaultFilename);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmPrint, setConfirmPrint] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const filenameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sendDialogOpen) return;
    setFilename(defaultFilename);
    setMessage(null);
    setConfirmPrint(false);
    setProgress(null);
    // Prefer the machine that uses the preset selected in the app.
    const match = printers.find((p) => p.preset && p.preset === preset);
    if (match) selectPrinter(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendDialogOpen]);

  useEffect(() => {
    if (sendDialogOpen && printers.length > 0) {
      const timer = setTimeout(() => {
        filenameInputRef.current?.focus();
        filenameInputRef.current?.select();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [sendDialogOpen, printers.length]);

  if (!sendDialogOpen) return null;
  const printer = printers.find((p) => p.id === selectedPrinterId);

  const monitorOnly = printer?.host_type === 'bambu-cloud' || printer?.host_type === 'creality-cloud';

  const send = async (print: boolean) => {
    const rawGcode = getGcode();
    if (!rawGcode || !printer || monitorOnly || busy) return;
    setBusy(true);
    setMessage(null);
    setProgress(0);
    try {
      const prepared = await getExportGcodePayload();
      if (!prepared || getGcode() !== rawGcode) return;
      const gcode = prepared.gcode;
      await createPrinterApi(printer).upload({ filename: filename.trim(), gcode, print, onProgress: setProgress });
      setMessage({ ok: true, text: print ? `Sent to ${printer.name}. The print is starting.` : `Sent to ${printer.name}.` });
      setConfirmPrint(false);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (busy) return;
    closeSendDialog();
  };

  const dialog = (
    <ModalBackdrop onClose={handleClose} id="send-to-printer-dialog" role="dialog" aria-modal="true" aria-label="Send to printer">
      <div className="modal-content" style={{ minWidth: 380, maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Send to printer</h3>
        {printers.length === 0 ? (
          <>
            <div>No printer is set up yet.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={handleClose}>Close</button>
              <button className="btn btn-primary" id="send-add-printer" autoFocus onClick={() => { closeSendDialog(); openDialog(null); }}>Add a printer</button>
            </div>
          </>
        ) : (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
              Printer
              <select id="send-printer" value={selectedPrinterId ?? ''} onChange={(e) => { selectPrinter(e.target.value); setConfirmPrint(false); }} disabled={busy}>
                {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
              File name
              <input
                ref={filenameInputRef}
                id="send-filename"
                autoFocus
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                disabled={busy}
              />
            </label>
            {progress != null && busy && (
              <div className="device-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}><div style={{ width: `${progress * 100}%` }} /></div>
            )}
            {message && <div id="send-result" data-ok={message.ok} style={{ color: message.ok ? '#81c784' : '#ef9a9a', fontSize: 12 }}>{message.text}</div>}
            {monitorOnly && <div id="send-monitor-only">{t('This cloud connection supports monitoring. Export the G-code to send it using the printer’s app.')}</div>}
            {confirmPrint && <div id="send-confirm-text" style={{ color: '#ffb74d', fontSize: 12 }}>This uploads the file and starts printing on {printer?.name} right away.</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" id="send-close" onClick={handleClose} disabled={busy}>Close</button>
              <button className="btn btn-secondary" id="send-upload" onClick={() => send(false)} disabled={busy || !filename.trim() || !printer || monitorOnly}>Upload</button>
              {confirmPrint ? (
                <button className="btn btn-primary" id="send-print-confirm" onClick={() => send(true)} disabled={busy}>Confirm: upload and start print</button>
              ) : (
                <button className="btn btn-primary" id="send-print" onClick={() => setConfirmPrint(true)} disabled={busy || !filename.trim() || !printer || monitorOnly}>Upload and print</button>
              )}
            </div>
          </>
        )}
      </div>
    </ModalBackdrop>
  );

  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
};
