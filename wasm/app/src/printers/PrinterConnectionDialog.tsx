import React from 'react';
import { usePrinterConnectionStore } from './connectionStore';

/** Dialog to add or edit a physical printer's connection (host, web UI address, credentials). */
export const PrinterConnectionDialog: React.FC = () => {
  const open = usePrinterConnectionStore((s) => s.dialogOpen);
  const close = usePrinterConnectionStore((s) => s.closeDialog);
  if (!open) return null;
  return (
    <div className="modal-backdrop" id="printer-connection-dialog">
      <div className="modal-content">
        <p>Printer connections are not available yet.</p>
        <button className="btn btn-secondary" onClick={close}>Close</button>
      </div>
    </div>
  );
};
