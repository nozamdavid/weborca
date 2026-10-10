import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { ModalBackdrop } from './ModalBackdrop';

// Mirrors desktop StepMeshDialog: same defaults and accepted ranges.
const LINEAR = { def: '0.003', min: 0.001, max: 0.1 };
const ANGLE = { def: '0.5', min: 0.01, max: 1.0 };

const inRange = (v: number, r: { min: number; max: number }) => Number.isFinite(v) && v >= r.min && v <= r.max;

export const StepImportModal: React.FC = () => {
  const { stepImportState, setStepImportState, importModelFile } = useAppStore();
  const [linear, setLinear] = useState(LINEAR.def);
  const [angle, setAngle] = useState(ANGLE.def);

  if (!stepImportState) return null;

  const file = stepImportState.file;
  const linearDeflection = parseFloat(linear);
  const angleDeflection = parseFloat(angle);
  const linearOk = inRange(linearDeflection, LINEAR);
  const angleOk = inRange(angleDeflection, ANGLE);

  const handleImport = () => {
    setStepImportState(null);
    void importModelFile(file, { linearDeflection, angleDeflection });
  };

  return (
    <ModalBackdrop onClose={() => setStepImportState(null)} dirty={linear !== LINEAR.def || angle !== ANGLE.def} dirtyWhat="import options" data-testid="step-import-modal">
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <h3>STEP Import Options</h3>
        <p>
          Smaller linear and angular deflections result in higher-quality transformations but increase the
          processing time for <strong>{file.name}</strong>.
        </p>

        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label>Linear Deflection (mm)</label>
          <input
            type="number"
            step="0.001"
            min={LINEAR.min}
            max={LINEAR.max}
            value={linear}
            onChange={(e) => setLinear(e.target.value)}
            style={{ width: '100%', padding: '6px', marginTop: '4px' }}
          />
          {!linearOk && <small style={{ color: '#e57373' }}>Enter a value from 0.001 to 0.1.</small>}
        </div>

        <div className="form-group" style={{ marginBottom: '24px' }}>
          <label>Angle Deflection</label>
          <input
            type="number"
            step="0.01"
            min={ANGLE.min}
            max={ANGLE.max}
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            style={{ width: '100%', padding: '6px', marginTop: '4px' }}
          />
          {!angleOk && <small style={{ color: '#e57373' }}>Enter a value from 0.01 to 1.0.</small>}
        </div>

        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => setStepImportState(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleImport} disabled={!linearOk || !angleOk}>
            Import
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
