import React, { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from '../i18n';

/** Guards refresh/navigation while a slice runs; everything is undone when it ends. */
export const SlicingGuard: React.FC = () => {
  const { t } = useTranslation();
  const isSlicing = useAppStore((s) => s.isSlicing);
  const message = t('Slicing (don\'t leave this tab)');

  useEffect(() => {
    if (!isSlicing) return;
    const previousTitle = document.title;
    document.title = message;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.title = previousTitle;
    };
  }, [isSlicing, message]);

  return null;
};
