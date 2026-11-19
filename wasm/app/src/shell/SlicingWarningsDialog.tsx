import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";
import './SlicingWarningsDialog.css';

export const SlicingWarningsDialog: React.FC = () => {
  const { t } = useTranslation();
  const result = useAppStore((s) => s.sliceResult);
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(!!result?.warnings.length); }, [result]);
  if (!open || !result?.warnings.length) return null;
  const warningText = (warning: string) => {
    switch (warning) {
      case 'bed_temperature_too_high_than_filament':
        return t('The bed temperature is at or above this filament’s softening temperature. In an enclosed printer, heat buildup may cause nozzle clogging. Open the enclosure or improve ventilation.');
      case 'not_support_traditional_timelapse':
        return t('Enabling traditional timelapse photography may cause surface imperfections. It is recommended to change to smooth mode.');
      default:
        return warning;
    }
  };
  return <Dialog onClose={() => setOpen(false)} role="dialog" aria-label={t("Slicing warnings")}>
    <div className="modal-content ds-dialog">
      <h2>{t("Slicing warnings")}</h2>
      <ul className="slicing-warnings-list">
        {[...new Set(result.warnings)].map((warning) => <li key={warning}>{warningText(warning)}</li>)}
      </ul>
      <div className="modal-footer ds-dialog__foot"><button className="ds-btn ds-btn--primary" id="slicing-warnings-close" onClick={() => setOpen(false)}>{t("Close")}</button></div>
    </div>
  </Dialog>;
};
