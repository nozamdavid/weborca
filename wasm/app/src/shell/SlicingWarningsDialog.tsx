import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";

export const SlicingWarningsDialog: React.FC = () => {
  const { t } = useTranslation();
  const result = useAppStore((s) => s.sliceResult);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(!!result?.warnings.length); }, [result]);
  if (!open || !result?.warnings.length) return null;
  // Native Orca returns a message identifier for this warning; the desktop
  // dialog also turns it into an explanation rather than displaying the code.
  const warningText = (warning: string) => warning === 'bed_temperature_too_high_than_filament'
    ? t('The bed temperature is at or above this filament’s softening temperature. In an enclosed printer, heat buildup may cause nozzle clogging. Open the enclosure or improve ventilation.')
    : warning;
  return <Dialog onClose={() => setOpen(false)} role="dialog" aria-label={t("Slicing warnings")}>
    <div className="modal-content ds-dialog">
      <h2>{t("Slicing warnings")}</h2>
      <ul>{result.warnings.map((warning, i) => <li key={i} style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>{warningText(warning)}</li>)}</ul>
      <div className="modal-footer ds-dialog__foot"><button className="ds-btn ds-btn--primary" id="slicing-warnings-close" onClick={() => setOpen(false)}>{t("Close")}</button></div>
    </div>
  </Dialog>;
};
