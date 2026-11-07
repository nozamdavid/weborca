import React, { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { modifiedSettings } from './modifiedSettings';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";
import './settings-ui.css';

const short = (value: string) => (value.length > 40 ? `${value.slice(0, 37)}...` : value);

/** What differs from the selected presets, with a way to put each value back (desktop's unsaved changes list). */
export const ModifiedSettingsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useTranslation();
  const layout = useAppStore((s) => s.layout);
  const currentConfig = useAppStore((s) => s.currentConfig);
  const presetConfig = useAppStore((s) => s.presetConfig);
  const resetOption = useAppStore((s) => s.resetOption);
  const changes = modifiedSettings(layout, currentConfig, presetConfig);
  useEffect(() => {
    if (changes.length === 0) onClose();
  }, [changes.length, onClose]);

  return (
    <Dialog onClose={onClose} id="modified-dialog" role="dialog" aria-label={t("Modified settings")}>
      <div className="modal-content ds-dialog modified-settings-modal">
        <h3 className="ds-dialog__head">{t("Modified settings (")}{changes.length})</h3>
        <div className="ds-dialog__body">
          <table className="modified-settings-table">
            <thead>
              <tr><th scope="col">{t("Setting")}</th><th scope="col">{t("Preset")}</th><th scope="col">{t("Now")}</th><th /></tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={`${c.tab}/${c.key}`} className="modified-row">
                  <td>{c.label}<div className="modified-settings-page">{c.page}</div></td>
                  <td title={c.from}>{short(c.from)}</td>
                  <td className="modified-settings-value" title={c.to}>{short(c.to)}</td>
                  <td><button className="ds-btn" onClick={() => void resetOption(c.key, c.tab)}>{t("Reset")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ds-dialog__foot">
          <button className="ds-btn" id="modified-reset-all" onClick={async () => { for (const c of changes) await resetOption(c.key, c.tab); }}>{t("Reset all")}</button>
          <button className="ds-btn ds-btn--primary" id="modified-close" onClick={onClose}>{t("Close")}</button>
        </div>
      </div>
    </Dialog>
  );
};
