import { Dialog } from '../components/Dialog';
import React, { useState, useEffect } from 'react';
import { useLayerEventsStore } from './layerEventsStore';
import { useTranslation } from "../i18n";

export const CustomGcodeDialog: React.FC = () => {
    const { t } = useTranslation();
  const dialogState = useLayerEventsStore((s) => s.dialogState);
  const saveCustomGcode = useLayerEventsStore((s) => s.saveCustomGcode);
  const closeDialog = useLayerEventsStore((s) => s.closeCustomGcodeDialog);

  const [gcode, setGcode] = useState('');

  useEffect(() => {
    if (dialogState) {
      setGcode(dialogState.initialGcode || '');
    }
  }, [dialogState]);

  if (!dialogState || !dialogState.isOpen) return null;

  const { plateIndex, printZ, layer, isEditing } = dialogState;

  const handleConfirm = () => {
    if (!gcode.trim()) return;
    saveCustomGcode(plateIndex, printZ, gcode.trim());
  };

  return (
    <Dialog
      onClose={closeDialog}
      dirty={gcode !== (dialogState.initialGcode || '')}
      dirtyWhat="custom G-code"
      className=""
      id="custom-gcode-dialog-backdrop"
    >
      <div
        id="custom-gcode-dialog"
        className="ds-dialog"
        data-testid="custom-gcode-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-gcode-dialog-title"
      >
        <h3
          id="custom-gcode-dialog-title"
        >
          {t(isEditing ? "Edit Custom G-code" : "Custom G-code")}
        </h3>
        <div>
          {t("Layer")}{layer + 1} ({printZ.toFixed(2)} {t("mm)")}</div>

        <label
          htmlFor="custom-gcode-input"
        >
          {t("Enter Custom G-code used on current layer:")}</label>

        <textarea
          className="ds-input ds-mono"
          id="custom-gcode-input"
          data-testid="custom-gcode-input"
          value={gcode}
          onChange={(e) => setGcode(e.target.value)}
          rows={6}
          placeholder={t("e.g. M117 Layer reached&#10;M104 S200")}
          autoFocus
        />

        <div className="ds-dialog__foot">
          <button
            type="button"
            id="custom-gcode-cancel" className="ds-btn"
            data-testid="custom-gcode-cancel"
            onClick={closeDialog}
          >
            {t("Cancel")}</button>
          <button
            type="button"
            id="custom-gcode-confirm" className="ds-btn ds-btn--primary"
            data-testid="custom-gcode-confirm"
            disabled={!gcode.trim()}
            onClick={handleConfirm}
          >
            {t("OK")}</button>
        </div>
      </div>
    </Dialog>
  );
};
