import React from 'react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from "../i18n";

export const ErrorBanner: React.FC = () => {
    const { t } = useTranslation();
  const engineError = useAppStore((state) => state.engineError);
  const setEngineError = useAppStore((state) => state.setEngineError);
  const ready = useAppStore(state => state.isEngineReady);
  const init = useAppStore(state => state.initApp);

  if (!engineError) return null;

  return (
    <div
      id="error-banner"
      role="alert"
      style={{
        backgroundColor: '#7f1d1d',
        borderBottom: '1px solid #ef4444',
        color: '#fecaca',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.875rem',
        fontWeight: 500,
        zIndex: 1000
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '1.125rem' }}>{t("⚠️")}</span>
        <span id="error-message">{engineError}</span>
      </div>
      <button
        id="dismiss-error-btn"
        onClick={() => ready ? setEngineError(null) : void init()}
        style={{
          background: 'transparent',
          border: '1px solid #f87171',
          color: '#fecaca',
          borderRadius: '4px',
          padding: '2px 8px',
          cursor: 'pointer',
          fontSize: '0.75rem'
        }}
      >
        {t(ready ? 'Dismiss' : 'Retry')}</button>
    </div>
  );
};
