import { useEffect, useState } from 'react';
import { cloudClient, checkCloudSession } from './account';
import { useTranslation } from '../i18n';
import './cloud.css';

export function CloudCallback({ callbackUrl }: { callbackUrl: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState('Cloud completing sign-in');
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await cloudClient().complete(callbackUrl);
        const status = await checkCloudSession();
        if (mounted) setResult(status?.accountId ? 'Cloud sign-in complete' : 'Cloud sign-in incomplete');
      } catch { if (mounted) setResult('Cloud callback failed'); }
    })();
    return () => { mounted = false; };
  }, [callbackUrl]);
  return <main className="cloud-callback"><h1>Orca Cloud</h1><p role="status">{t(result)}</p><a href="/">{t('Cloud return to app')}</a></main>;
}
