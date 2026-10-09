
import { useOtherCalibrationStore } from './otherCalibrationStore';

export function OtherCalibrationsMenu() {
  const { calibrationMenuOpen, closeMenu, openDialog } = useOtherCalibrationStore();

  if (!calibrationMenuOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal-content" style={{ maxWidth: '300px' }}>
        <div className="modal-header">
          <h2>Other Calibrations</h2>
          <button className="close-btn" onClick={closeMenu}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('pa_line')}>PA Line</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('pa_pattern')}>PA Pattern</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('pa_tower')}>PA Tower</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('temp')}>Temp Tower</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('max_vol')}>Max Volumetric Speed</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('vfa')}>VFA</button>
          <button className="btn btn-secondary" role="menuitem" onClick={() => openDialog('retraction')}>Retraction</button>
        </div>
      </div>
    </div>
  );
}
