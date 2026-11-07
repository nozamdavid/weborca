import { MobileInput } from '../mobile/MobileInput';
import { useMobile } from '../mobile/useMobile';
import { MobileSelect } from '../mobile/MobileSelect';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/appStore';
import { createPrinterApi } from './api';
import { octoEverywhereCapabilities } from './octoEverywhere';
import type { PrinterApi } from './types';
import { usePrinterConnectionStore } from './connectionStore';
import { useTranslation } from '../i18n';
import { Dialog } from '../components/Dialog';
import { getExportGcodePayload } from '../shell/exportGcode';

/**
 * "Send to printer" after slicing, like desktop's upload dialog. Starting a print is a separate, confirmed
 * step, because it moves a real machine.
 */
export const SendToPrinterDialog: React.FC<{ getGcode: () => Uint8Array | null; defaultFilename: string }> = ({ getGcode, defaultFilename }) => {
  const { t } = useTranslation();
  const { sendDialogOpen, printers, selectedPrinterId, selectPrinter, closeSendDialog, openDialog, liveState } = usePrinterConnectionStore();
  const preset = useAppStore((s) => s.selectedPrinter);
  const [filename, setFilename] = useState(defaultFilename);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmPrint, setConfirmPrint] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const filenameInputRef = useRef<HTMLInputElement>(null);
  const mobile = useMobile();

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
    if (sendDialogOpen && printers.length > 0 && !mobile) {
      const timer = setTimeout(() => {
        filenameInputRef.current?.focus();
        filenameInputRef.current?.select();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [sendDialogOpen, printers.length, mobile]);

  if (!sendDialogOpen) return null;
  const printer = printers.find((p) => p.id === selectedPrinterId);

  const remote = printer?.octoeverywhere?.mode === 'remote';
  const remoteCaps = remote && printer ? liveState?.octoeverywhere?.capabilities ?? octoEverywhereCapabilities(printer.host_type) : undefined;
  const monitorOnly = !remote && (printer?.host_type === 'bambu-cloud' || printer?.host_type === 'creality-cloud' || printer?.host_type === 'snapmaker-cloud');
  const uploadDisabled = monitorOnly || (remote && !remoteCaps?.rawGcodeUpload);
  const printDisabled = uploadDisabled || (remote && !remoteCaps?.rawGcodeStart);

  const send = async (print: boolean) => {
    const rawGcode = getGcode();
    if (!rawGcode || !printer || uploadDisabled || (print && printDisabled) || busy) return;
    setBusy(true);
    setMessage(null);
    setProgress(0);
    let api: PrinterApi | undefined;
    try {
      const prepared = await getExportGcodePayload();
      if (!prepared || getGcode() !== rawGcode) return;
      const gcode = prepared.gcode;
      if (usePrinterConnectionStore.getState().printers.find(p => p.id === printer.id) !== printer) return;
      api = createPrinterApi(printer);
      await api.upload({ filename: filename.trim(), gcode, print, onProgress: setProgress });
      setMessage({ ok: true, text: t(print ? 'Sent to {{printer}}. The print is starting.' : 'Sent to {{printer}}.', { printer: printer.name }) });
      setConfirmPrint(false);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      api?.dispose?.();
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (busy) return;
    closeSendDialog();
  };

  const dialog = (
    <Dialog className="ds-scrim" onClose={handleClose} id="send-to-printer-dialog" role="dialog" aria-modal="true" aria-label={t('Send to printer')}>
      <div className="ds-dialog printer-sheet printer-send">
        <header className="ds-dialog__head"><h2 className="ds-title ds-title--dialog">{t('Send to printer')}</h2></header>
        <div className="ds-dialog__body">
        {printers.length === 0 ? (
          <>
            <div>{t('No printer is set up yet.')}</div>
          </>
        ) : (
          <>
            <label className="printer-field">
              {t('Printer')}
              <MobileSelect className="ds-select" id="send-printer" value={selectedPrinterId ?? ''} onValueChange={(value) => { selectPrinter(value); setConfirmPrint(false); }} disabled={busy}>
                {printers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </MobileSelect>
            </label>
            <label className="printer-field">
              {t('File name')}
              <MobileInput
                ref={filenameInputRef}
                id="send-filename"
                className="ds-input"
                autoFocus
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                disabled={busy}
              />
            </label>
            {progress != null && busy && (
              <div className="device-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}><div style={{ width: `${progress * 100}%` }} /></div>
            )}
            {message && <div id="send-result" data-ok={message.ok} className="printer-result">{message.text}</div>}
            {monitorOnly && <div id="send-monitor-only">{t('This cloud connection supports monitoring. Export the G-code to send it using the printer’s app.')}</div>}
            {remote && <p>{remoteCaps?.sendReason || t(uploadDisabled ? 'File transfers are not available for this remote printer.' : 'Upload stores the G-code. To start separately, use Device → Printer files.')}</p>}
            {confirmPrint && <div id="send-confirm-text" className="printer-warning">{t('This uploads the file and starts printing on {{printer}} right away.', { printer: printer?.name ?? '' })}</div>}
          </>
        )}
        </div>
        <footer className="ds-dialog__foot">
          {printers.length === 0 ? <>
            <button className="ds-btn" onClick={handleClose}>{t('Close')}</button>
            <button className="ds-btn ds-btn--primary" id="send-add-printer" autoFocus onClick={() => { closeSendDialog(); openDialog(null); }}>{t('Add a printer')}</button>
          </> : <>
              <button className="ds-btn" id="send-close" onClick={handleClose} disabled={busy}>{t("Close")}</button>
              <button className="ds-btn" id="send-upload" onClick={() => send(false)} disabled={busy || !filename.trim() || !printer || uploadDisabled}>{t("Upload")}</button>
              {confirmPrint ? (
                <button className="ds-btn ds-btn--primary" id="send-print-confirm" onClick={() => send(true)} disabled={busy || printDisabled}>{t("Confirm: upload and start print")}</button>
              ) : (
                !remote && <button className="ds-btn ds-btn--primary" id="send-print" onClick={() => setConfirmPrint(true)} disabled={busy || !filename.trim() || !printer || printDisabled}>{t("Upload and print")}</button>
              )}
          </>}
        </footer>
      </div>
    </Dialog>
  );

  return typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog;
};
