import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { usePrefsStore } from '../prefs/prefsStore';
import { useTranslation } from '../i18n';

export const useAutosaveStatus = create<{ saving: boolean; startedAt: number; savedAt: number | null }>(() => ({
  saving: false, startedAt: 0, savedAt: null
}));

export const AutosaveStatus: React.FC = () => {
  const { t } = useTranslation();
  const enabled = usePrefsStore(s => s.general.autosave);
  const { saving, startedAt, savedAt } = useAutosaveStatus();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled || (!startedAt && !savedAt)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [enabled, startedAt, savedAt]);
  if (!enabled || (!saving && savedAt === null && now >= startedAt + 2000)) return null;
  const text = saving || now < startedAt + 2000
    ? t('Auto saving...')
    : t('Last saved {{seconds}} seconds ago', { seconds: Math.max(0, Math.floor((now - savedAt!) / 1000)) });
  return <span id="autosave-status" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginRight: 12 }}>{text}</span>;
};
