import React, { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';

export const DeviceFreshness: React.FC<{
  active: boolean;
  paused: boolean;
  saved: boolean;
  refreshedAt: number | null;
}> = ({ active, paused, saved, refreshedAt }) => {
  const { t, language } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!active || paused) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, paused, refreshedAt]);
  if (refreshedAt == null) return null;
  const seconds = Math.max(0, Math.floor((now - refreshedAt) / 1000));
  const locale = language.replace('_', '-');
  const age = new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(
    -Math.floor(seconds / (seconds < 60 ? 1 : seconds < 3600 ? 60 : seconds < 86400 ? 3600 : 86400)),
    seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : seconds < 86400 ? 'hour' : 'day',
  );
  return <div className="device-freshness" id="device-freshness">
    {saved && <span className="device-saved-label">{t('Saved readings')}</span>}
    <time dateTime={new Date(refreshedAt).toISOString()} title={new Date(refreshedAt).toLocaleString(locale)}>
      {t('Last refreshed {{age}}', { age })}
    </time>
  </div>;
};
