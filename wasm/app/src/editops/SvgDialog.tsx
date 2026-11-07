import React, { useRef } from 'react';
import { useEditOpsStore } from './editOpsStore';
import { usePlateStore } from '../plate/plateStore';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";

export const SvgDialog: React.FC = () => {
    const { t } = useTranslation();
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
    <Dialog onClose={closeSvgDialog} role="dialog" aria-label={t("Add SVG")}>
      <div
        className="modal-content ds-dialog"
        id="svg-dialog"
        data-testid="svg-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header ds-dialog__head">
          <h2>{t("Add SVG")}</h2>
          <button className="icon-btn" onClick={closeSvgDialog} aria-label={t("Close")}>✕</button>
        </div>

        <div className="modal-body ds-dialog__body">
          {error && <div className="error-message" style={{ color: 'var(--danger-color)', fontSize: '0.75rem' }}>{error}</div>}

          <div>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>{t("SVG File")}</label>
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
                className="ds-btn"
                id="svg-choose-file-btn"
                data-testid="svg-choose-file-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                {t("Choose SVG...")}</button>
              <span style={{ fontSize: '0.8125rem', color: svgFileName ? 'var(--text-color)' : 'var(--text-muted)' }}>
                {svgFileName || 'No file selected'}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="svg-depth-input" style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>
              {t("Emboss Depth (mm)")}</label>
            <input
              type="number"
              id="svg-depth-input"
              data-testid="svg-depth-input"
              aria-label={t("Emboss Depth")}
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
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>{t("Target")}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="svg-target-mode"
                    checked={svgTargetObjectId === null}
                    onChange={() => setSvgTargetObjectId(null)}
                  />
                  <span>{t("Add as new object")}</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="svg-target-mode"
                    checked={svgTargetObjectId === selectedObject.id}
                    onChange={() => setSvgTargetObjectId(selectedObject.id)}
                  />
                  <span>{t("Add as part to")}{selectedObject.name}</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer ds-dialog__foot">
          <button className="ds-btn" onClick={closeSvgDialog} disabled={isOperating}>
            {t("Cancel")}</button>
          <button
            className="ds-btn ds-btn--primary"
            id="svg-apply-btn"
            data-testid="svg-apply-btn"
            onClick={() => void applyAddSvg()}
            disabled={isOperating || !svgText}
          >
            {isOperating ? 'Adding...' : 'Add SVG'}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
