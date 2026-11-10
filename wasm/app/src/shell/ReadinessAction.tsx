import React, { useRef, useState } from 'react';
import { readinessAction } from './slicePrerequisites';
import { useMobile } from '../mobile/useMobile';
import { MobileMenu, MobileImport, MobileSheet } from '../mobile/MobileShell';
import { useTranslation } from '../i18n';
import { usePrefsStore } from '../prefs/prefsStore';

export function ReadinessAction({ reason }: { reason: string }) {
  const { t } = useTranslation();
  const mobile = useMobile();
  const [openAction, setOpenAction] = useState<ReturnType<typeof readinessAction>>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const action = readinessAction(reason);
  const labels = { printer: 'Choose printer', process: 'Choose process', filament: 'Choose filament', model: 'Add model' };
  const close = () => {
    setOpenAction(null);
    requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLButtonElement>('.wm-header button[aria-haspopup="dialog"]');
      (trigger.current ?? fallback)?.focus();
    });
  };
  return <>{action && <button ref={trigger} className="ds-btn" onClick={() => {
    if (mobile) { setOpenAction(action); return; }
    if (action !== 'model') {
      const prefs = usePrefsStore.getState();
      prefs.setDisplayPref('sidebarSections', { ...prefs.display.sidebarSections, [action]: true });
    }
    const id = { printer: 'printer-select', process: 'process-select', filament: 'filament-select', model: 'import-btn' }[action];
    requestAnimationFrame(() => {
    const target = document.getElementById(id);
    target?.scrollIntoView({ block: 'nearest' }); target?.focus();
    if (action === 'model') target?.click();
    });
  }}>{t(labels[action])}</button>}
  {openAction && (openAction === 'model' ? <MobileSheet title={t(labels.model)} onClose={close}><MobileImport disabled={false} onImported={close} /></MobileSheet> : <MobileMenu onClose={close} />)}</>;
}
