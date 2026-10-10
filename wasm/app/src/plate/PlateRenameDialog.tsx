import { ModalBackdrop } from '../components/ModalBackdrop';
import React, { useState } from 'react';
import { useTranslation } from "../i18n";

/** Asks for a plate's title. An empty title goes back to the default "Plate N". */
export const PlateRenameDialog: React.FC<{ index: number; initial: string; onSubmit: (title: string) => void; onClose: () => void }> = ({ index, initial, onSubmit, onClose }) => {
    const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const submit = () => onSubmit(value.trim());
  return (
    <ModalBackdrop
      id="plate-rename-dialog"
      role="dialog"
      aria-label={t("Rename plate")}
      className=""
      onClose={onClose}
      dirty={value !== initial}
      dirtyWhat="plate title"
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div style={{ width: 380, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--panel-bg)', border: '1px solid var(--control-bg)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)', color: 'var(--text-color)' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t("Rename plate")}{index + 1}</div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
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
            style={{ padding: '8px 10px', fontSize: 14, background: 'var(--canvas-bg)', color: 'var(--text-color)', border: '1px solid var(--border-color)', borderRadius: 6, outline: 'none' }}
          />
          <span>{t("Leave it empty to use the default name.")}</span>
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="btn btn-secondary" id="plate-title-cancel" onClick={onClose}>{t("Cancel")}</button>
          <button className="btn btn-primary" id="plate-title-ok" onClick={submit}>{t("OK")}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
