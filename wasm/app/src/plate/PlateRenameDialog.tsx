import { Dialog } from '../components/Dialog';
import React, { useState } from 'react';
import { useTranslation } from "../i18n";

/** Asks for a plate's title. An empty title goes back to the default "Plate N". */
export const PlateRenameDialog: React.FC<{ index: number; initial: string; onSubmit: (title: string) => void; onClose: () => void }> = ({ index, initial, onSubmit, onClose }) => {
    const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const submit = () => onSubmit(value.trim());
  return (
    <Dialog
      id="plate-rename-dialog"
      role="dialog"
      aria-label={t("Rename plate")}
      className=""
      onClose={onClose}
      dirty={value !== initial}
      dirtyWhat="plate title"
    >
      <div className="ds-dialog ds-dialog--sm">
        <h2 className="ds-title--dialog">{t("Rename plate")}{index + 1}</h2>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {t("Plate title")}<input
            id="plate-title-input"
            autoFocus
            value={value}
            placeholder={`Plate ${index + 1}`}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') submit();
            }}
            style={{ padding: '8px 10px', fontSize: '0.875rem', background: 'var(--canvas-bg)', color: 'var(--text-color)', border: '1px solid var(--border-color)', borderRadius: 6, outline: 'none' }}
          />
          <span>{t("Leave it empty to use the default name.")}</span>
        </label>
        <div className="ds-dialog__foot">
          <button className="ds-btn" id="plate-title-cancel" onClick={onClose}>{t("Cancel")}</button>
          <button className="ds-btn ds-btn--primary" id="plate-title-ok" onClick={submit}>{t("OK")}</button>
        </div>
      </div>
    </Dialog>
  );
};
