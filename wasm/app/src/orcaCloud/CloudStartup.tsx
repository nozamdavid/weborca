import { useEffect } from 'react';
import { checkCloudSession, useCloudAccount } from './account';
import { useTranslation } from '../i18n';

export function CloudStartup() {
  const checking = useCloudAccount(s => s.checking);
  const { t } = useTranslation();
  useEffect(() => {
    if (!checking) return;
    const block = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [checking]);
  useEffect(() => {
    const check = () => { void checkCloudSession().catch(() => {}); };
    window.addEventListener('focus', check);
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return checking ? <div className="cloud-session-check" role="status">{t('Cloud checking session')}</div> : null;
}
