
import { useOtherCalibrationStore } from './otherCalibrationStore';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { useTranslation } from "../i18n";

export function OtherCalibrationsMenu() {
    const { t } = useTranslation();
  const { calibrationMenuOpen, closeMenu, openDialog } = useOtherCalibrationStore();

  if (!calibrationMenuOpen) return null;

  return (
    <ModalBackdrop onClose={closeMenu} style={{ zIndex: 1000 }}>
      <div className="modal-content" style={{ maxWidth: '300px' }}>
        <div className="modal-header">
          <h2>{t("Other Calibrations")}</h2>
          <button className="close-btn" onClick={closeMenu}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('pa_line')}>{t("PA Line")}</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('pa_pattern')}>{t("PA Pattern")}</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('pa_tower')}>{t("PA Tower")}</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('temp')}>{t("Temp Tower")}</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('max_vol')}>{t("Max Volumetric Speed")}</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('vfa')}>{t("VFA")}</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('retraction')}>{t("Retraction")}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
