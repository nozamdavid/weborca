import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { captureAutosaveBaseline, clearAutosave, readAutosave, restoreAutosave, startAutosave } from './autosave';
import type { AutosaveRecord } from './autosave';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { useTranslation } from "../i18n";

/** Offers the project the last session left behind, and runs the autosave timer once the engine is ready. */
export const RecoveryDialog: React.FC = () => {
    const { t } = useTranslation();
  const isEngineReady = useAppStore((s) => s.isEngineReady);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  const [record, setRecord] = useState<AutosaveRecord | undefined>();
  const autosaveBaseline = useRef<string>();

  useEffect(() => {
    if (!isEngineReady || checked) return;
    autosaveBaseline.current = captureAutosaveBaseline();
    let cancelled = false;
    void readAutosave().then((found) => { if (!cancelled) { setRecord(found); setChecked(true); } });
    // The timer starts after the offer is answered, so an unanswered offer is not overwritten by an empty plate.
    return () => { cancelled = true; };
  }, [isEngineReady, checked]);

  useEffect(() => (isEngineReady && checked && !record ? startAutosave(undefined, autosaveBaseline.current) : undefined), [isEngineReady, checked, record]);

  if (!record) return null;
  const restore = async () => {
    setRestoring(true);
    setError('');
    try { await restoreAutosave(record); setRecord(undefined); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setRestoring(false); }
  };
  const discard = async () => {
    setRestoring(true);
    setError('');
    try {
      await clearAutosave();
      autosaveBaseline.current = captureAutosaveBaseline();
      setRecord(undefined);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setRestoring(false); }
  };
  return (
    <ModalBackdrop onClose={() => { if (!restoring) setRecord(undefined); }} id="recovery-dialog" role="dialog" aria-label={t("Recover project")}>
      <div className="modal-content" style={{ width: 'min(440px, 92vw)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0 }}>{t("Restore your last session?")}</h3>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          {record.objects > 0 && <>{t(record.objects === 1 ? 'The project contains {{count}} object.' : 'The project contains {{count}} objects.', { count: record.objects })}{' '}</>}
          {t('An automatic backup from {{date}} is available.', { date: new Date(record.savedAt).toLocaleString() })}</p>
        {error && <p role="alert">{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" id="recovery-discard" disabled={restoring} onClick={discard}>{t("Discard")}</button>
          <button className="btn btn-primary" id="recovery-restore" disabled={restoring} onClick={() => void restore()}>{t("Restore")}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
