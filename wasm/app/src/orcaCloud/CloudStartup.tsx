import { useEffect } from 'react';
import { checkCloudSession, useCloudAccount } from './account';
import { useTranslation } from '../i18n';

export function CloudStartup() {
  const checking = useCloudAccount(s => s.checking);
  const { t } = useTranslation();
  useEffect(() => {
    const controller = new AbortController();
    const check = () => { void checkCloudSession({ signal: controller.signal, timeoutMs: 8000, passive: true }).catch(() => {}); };
    window.addEventListener('focus', check);
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return checking ? <div className="cloud-session-check" role="status">{t('Cloud checking session')}</div> : null;
}
