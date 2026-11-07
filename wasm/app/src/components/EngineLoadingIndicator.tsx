import React from 'react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from '../i18n';

/** Floating status while the slicing engine downloads and starts, which takes a while on a cold cache. */
export const EngineLoadingIndicator: React.FC = () => {
  const { t } = useTranslation();
  const visible = useAppStore((s) => s.isIsolated && !s.isEngineReady);
  const error = useAppStore(s => s.engineError);
  const progress = useAppStore(s => s.engineLoad);
  const init = useAppStore(s => s.initApp);
  const label = error ? t('Engine unavailable. Check your connection and retry.') : progress.phase === 'downloading'
    ? `${t('Downloading engine...')}${progress.loaded ? ` ${Math.round(progress.loaded / 1048576)} MB${progress.total ? ` / ${Math.round(progress.total / 1048576)} MB` : ''}` : ''}`
    : t('Initializing engine...');
  if (!visible) return null;
  return (
    <div className="engine-loading" role="status" aria-live="polite" id="engine-loading">
      <span className="engine-loading__label">{label} {t('Preferences and navigation are available. Model tools and slicing will unlock when ready.')}</span>
      {error ? <button className="ds-btn" onClick={() => void init()}>{t('Retry')}</button> : <span className="engine-loading__bar" aria-hidden="true" />}
    </div>
  );
};
