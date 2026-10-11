import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from '../i18n';

/** Embedded assets survive preset export and project recovery without access to a desktop file path. */
export const BedAssetsSettings: React.FC = () => {
  const { t } = useTranslation();
  const config = useAppStore((s) => s.currentConfig);
  const apply = useAppStore((s) => s.applyOptionChange);
  const reset = useAppStore((s) => s.resetOption);
  const presetConfig = useAppStore((s) => s.presetConfig);
  const [error, setError] = useState('');
  const upload = async (file: File | undefined, key: string) => {
    if (!file) return;
    setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(t('Choose a bed asset smaller than 2 MB.'));
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await apply(key, data, 'printer');
      if (useAppStore.getState().engineError) throw new Error(useAppStore.getState().engineError!);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  return <fieldset className="bed-assets-settings" style={{ margin: '12px 0', display: 'grid', gap: 8, border: '1px solid var(--border-color)' }}>
    <legend>{t('Custom bed appearance')}</legend>
    {([['bed_custom_texture', 'Bed image', '.png,.jpg,.jpeg,.svg'], ['bed_custom_model', 'Bed model', '.stl']] as const).map(([key, label, accept]) =>
      <label key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{t(label)}</span><input type="file" id={key} accept={accept} onChange={(e) => { void upload(e.target.files?.[0], key); e.target.value = ''; }} />
        {(config[key] || '') !== (presetConfig[key] || '') && <button id={`reset-${key}`} type="button" className="btn btn-secondary" onClick={() => void reset(key, 'printer')}>{t('Use profile default')}</button>}
      </label>)}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
};
