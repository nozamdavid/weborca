
import { useOtherCalibrationStore } from './otherCalibrationStore';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";

export function OtherCalibrationsMenu() {
    const { t } = useTranslation();
  const { calibrationMenuOpen, closeMenu, openDialog } = useOtherCalibrationStore();

  if (!calibrationMenuOpen) return null;

  return (
    <Dialog onClose={closeMenu}>
      <div className="modal-content ds-dialog">
        <div className="modal-header ds-dialog__head">
          <h2>{t("Other Calibrations")}</h2>
          <button className="close-btn" onClick={closeMenu}>×</button>
        </div>
        <div className="modal-body ds-dialog__body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button className="ds-btn" role="menuitem" onClick={() => openDialog('pa_line')}>{t("PA Line")}</button>
          <button className="ds-btn" role="menuitem" onClick={() => openDialog('pa_pattern')}>{t("PA Pattern")}</button>
          <button className="ds-btn" role="menuitem" onClick={() => openDialog('pa_tower')}>{t("PA Tower")}</button>
          <button className="ds-btn" role="menuitem" onClick={() => openDialog('temp')}>{t("Temp Tower")}</button>
          <button className="ds-btn" role="menuitem" onClick={() => openDialog('max_vol')}>{t("Max Volumetric Speed")}</button>
          <button className="ds-btn" role="menuitem" onClick={() => openDialog('vfa')}>{t("VFA")}</button>
          <button className="ds-btn" role="menuitem" onClick={() => openDialog('retraction')}>{t("Retraction")}</button>
        </div>
      </div>
    </Dialog>
  );
}
