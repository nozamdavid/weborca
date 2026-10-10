import React, { useRef } from 'react';
import { useEditOpsStore } from './editOpsStore';
import { usePlateStore } from '../plate/plateStore';
import { ModalBackdrop } from '../components/ModalBackdrop';

export const SvgDialog: React.FC = () => {
  const activeDialog = useEditOpsStore((s) => s.activeDialog);
  const svgDepth = useEditOpsStore((s) => s.svgDepth);
  const svgText = useEditOpsStore((s) => s.svgText);
  const svgFileName = useEditOpsStore((s) => s.svgFileName);
  const svgTargetObjectId = useEditOpsStore((s) => s.svgTargetObjectId);
  const isOperating = useEditOpsStore((s) => s.isOperating);
  const error = useEditOpsStore((s) => s.error);

  const setSvgData = useEditOpsStore((s) => s.setSvgData);
  const setSvgDepth = useEditOpsStore((s) => s.setSvgDepth);
  const setSvgTargetObjectId = useEditOpsStore((s) => s.setSvgTargetObjectId);
  const applyAddSvg = useEditOpsStore((s) => s.applyAddSvg);
  const closeSvgDialog = useEditOpsStore((s) => s.closeSvgDialog);

  const selectedObjectId = usePlateStore((s) => s.selectedObjectId);
  const selectedObject = usePlateStore((s) => s.objects.find((o) => o.id === selectedObjectId));
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (activeDialog !== 'svg') return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setSvgData(text, file.name);
    };
    reader.readAsText(file);
  };

  return (
    <ModalBackdrop onClose={closeSvgDialog} role="dialog" aria-label="Add SVG">
      <div
        className="modal-content"
        id="svg-dialog"
        data-testid="svg-dialog"
        style={{ width: 'min(460px, 92vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Add SVG</h2>
          <button className="icon-btn" onClick={closeSvgDialog} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="error-message" style={{ color: 'var(--danger-color)', fontSize: 12 }}>{error}</div>}

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>SVG File</label>
            <input
              type="file"
              ref={fileInputRef}
              id="svg-file-input"
              data-testid="svg-file-input"
              accept=".svg"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                id="svg-choose-file-btn"
                data-testid="svg-choose-file-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose SVG...
              </button>
              <span style={{ fontSize: 13, color: svgFileName ? 'var(--text-color)' : 'var(--text-muted)' }}>
                {svgFileName || 'No file selected'}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="svg-depth-input" style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
              Emboss Depth (mm)
            </label>
            <input
              type="number"
              id="svg-depth-input"
              data-testid="svg-depth-input"
              aria-label="Emboss Depth"
              min="0.1"
              max="100"
              step="0.5"
              value={svgDepth}
              onChange={(e) => setSvgDepth(parseFloat(e.target.value) || 1.0)}
              style={{ width: 120, padding: '4px 8px' }}
            />
          </div>

          {selectedObject && (
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Target</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="svg-target-mode"
                    checked={svgTargetObjectId === null}
                    onChange={() => setSvgTargetObjectId(null)}
                  />
                  <span>Add as new object</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="svg-target-mode"
                    checked={svgTargetObjectId === selectedObject.id}
                    onChange={() => setSvgTargetObjectId(selectedObject.id)}
                  />
                  <span>Add as part to {selectedObject.name}</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={closeSvgDialog} disabled={isOperating}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            id="svg-apply-btn"
            data-testid="svg-apply-btn"
            onClick={() => void applyAddSvg()}
            disabled={isOperating || !svgText}
          >
            {isOperating ? 'Adding...' : 'Add SVG'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
