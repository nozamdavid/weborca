import React from 'react';
import { useTranslation } from '../i18n';

export function UploadProgress({ fraction, waitForPrinter = false, onCancel }: { fraction: number; waitForPrinter?: boolean; onCancel?: () => void }) {
  const { t } = useTranslation();
  const percent = Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
  const label = t('Uploading');
  return (
    <div>
      <div className="device-row">
        <span role="status">{waitForPrinter && percent === 100 ? t('Waiting for the printer...') : label}</span>
        <span aria-hidden="true">{percent}%</span>
      </div>
      <div className="device-progress" role="progressbar" aria-label={label} aria-valuenow={percent}>
        <div style={{ width: `${percent}%` }} />
      </div>
      {onCancel && <button className="ds-btn" onClick={onCancel}>{t('Cancel upload')}</button>}
    </div>
  );
}
