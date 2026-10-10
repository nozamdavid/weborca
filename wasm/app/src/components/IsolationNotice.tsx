import React from 'react';
import { useTranslation } from "../i18n";

export const IsolationNotice: React.FC = () => {
    const { t } = useTranslation();
  return (
    <div
      id="isolation-blocking-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: '#111827',
        color: '#f9fafb',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '24px',
        textAlign: 'center'
      }}
    >
      <div
        style={{
          maxWidth: '540px',
          background: '#1f2937',
          border: '1px solid #ef4444',
          borderRadius: '8px',
          padding: '32px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>{t("🚫")}</div>
        <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#f87171', marginBottom: '16px' }}>
          {t("Cross-Origin Isolation Required")}</h1>
        <p style={{ fontSize: '14px', lineHeight: '1.6', color: '#d1d5db', marginBottom: '20px' }}>
          {t("OrcaSlicer Web runs the C++ slicing engine locally in WebAssembly with multi-threading\n          via SharedArrayBuffer.")}</p>
        <p style={{ fontSize: '14px', lineHeight: '1.6', color: '#d1d5db', marginBottom: '24px' }}>
          {t("The current environment reports")}<code style={{ background: '#374151', padding: '2px 6px', borderRadius: '4px', color: '#fbbf24' }}>{t("crossOriginIsolated: false")}</code>{t(".\n          The web server must send Cross-Origin Opener Policy (")}<code style={{ color: '#60a5fa' }}>{t("COOP: same-origin")}</code>{t(")\n          and Cross-Origin Embedder Policy (")}<code style={{ color: '#60a5fa' }}>{t("COEP: require-corp")}</code>{t(") headers.")}</p>
        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
          {t("Please verify server headers or launch the app via Vite preview / dev server.")}</div>
      </div>
    </div>
  );
};
