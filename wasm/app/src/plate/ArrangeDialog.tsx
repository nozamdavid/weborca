import React, { useEffect, useState } from 'react';
import { usePlateStore } from './plateStore';
import { Dialog } from '../components/Dialog';
import { useTranslation } from "../i18n";

/** Spacing and rotation used by Arrange (desktop's arrange settings popup). */
export const ArrangeDialog: React.FC = () => {
    const { t } = useTranslation();
  const open = usePlateStore((s) => s.arrangeDialogOpen);
  const settings = usePlateStore((s) => s.arrangeSettings);
  const setOpen = usePlateStore((s) => s.setArrangeDialogOpen);
  const setSettings = usePlateStore((s) => s.setArrangeSettings);
  const arrange = usePlateStore((s) => s.arrange);
  const [spacing, setSpacing] = useState('');
  const [rotate, setRotate] = useState(false);
  const [scope, setScope] = useState<'all' | 'current'>('all');
  useEffect(() => {
    if (!open) return;
    setSpacing(settings.spacing === null ? '' : String(settings.spacing));
    setRotate(settings.allowRotations);
    setScope(settings.plateScope || 'all');
  }, [open, settings]);
  if (!open) return null;

  const parsed = spacing.trim() === '' ? null : Math.max(0, parseFloat(spacing));
  const valid = parsed === null || Number.isFinite(parsed);
  const apply = (run: boolean) => {
    if (!valid) return;
    setSettings({ spacing: parsed, allowRotations: rotate, plateScope: scope });
    setOpen(false);
    if (run) void arrange(true);
  };
  return (
    <Dialog onClose={() => setOpen(false)} id="arrange-dialog" role="dialog" aria-label={t("Arrange options")}>
      <div className="modal-content ds-dialog">
        <h3 style={{ margin: 0 }}>{t("Arrange options")}</h3>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem' }}>
          {t("Spacing between objects (mm)")}<input id="arrange-spacing" value={spacing} onChange={(e) => setSpacing(e.target.value)} placeholder={t("From the print settings")}
            style={{ background: 'var(--control-bg)', color: 'inherit', border: '1px solid var(--border-color, var(--border-color))', borderRadius: 4, padding: '5px 8px' }} />
          {!valid && <span style={{ color: 'var(--danger-fg)' }}>{t("Enter a number.")}</span>}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.75rem' }}>
          {t("Scope")}
          <select id="arrange-scope" value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'current')}>
            <option value="all">{t("All plates")}</option>
            <option value="current">{t("Current plate")}</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem' }}>
          <input id="arrange-rotate" type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} /> {t("Allow objects to rotate")}</label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="ds-btn" id="arrange-cancel" onClick={() => setOpen(false)}>{t("Cancel")}</button>
          <button className="ds-btn" id="arrange-save" disabled={!valid} onClick={() => apply(false)}>{t("Save")}</button>
          <button className="ds-btn ds-btn--primary" id="arrange-run" disabled={!valid} onClick={() => apply(true)}>{t("Arrange")}</button>
        </div>
      </div>
    </Dialog>
  );
};
