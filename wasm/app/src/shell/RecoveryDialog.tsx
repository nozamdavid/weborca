import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { captureAutosaveBaseline, clearAutosave, readAutosave, restoreAutosave, startAutosave } from './autosave';
import type { AutosaveRecord } from './autosave';
import { Dialog } from '../components/Dialog';
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

  // The backup lives in IndexedDB, so the offer does not wait for the engine to load.
  useEffect(() => {
    let cancelled = false;
    void readAutosave().then((found) => { if (!cancelled) { setRecord(found); setChecked(true); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isEngineReady && autosaveBaseline.current === undefined) autosaveBaseline.current = captureAutosaveBaseline();
  }, [isEngineReady]);

  // The timer starts after the offer is answered, so an unanswered offer is not overwritten by an empty plate.
  useEffect(() => (isEngineReady && checked && !record ? startAutosave(undefined, autosaveBaseline.current) : undefined), [isEngineReady, checked, record]);

  if (!record) return null;
  const restore = async () => {
    setRestoring(true);
    setError('');
    const previousRecovery = useAppStore.getState().sessionRecovery;
    useAppStore.setState({ sessionRecovery: 'restoring' });
    try {
      await restoreAutosave(record);
      useAppStore.setState({ sessionRecovery: 'restored' });
      setRecord(undefined);
    }
    catch (err) {
      useAppStore.setState({ sessionRecovery: previousRecovery });
      setError(err instanceof Error ? err.message : String(err));
    }
    finally { setRestoring(false); }
  };
  const discard = async () => {
    setRestoring(true);
    setError('');
    try {
      await clearAutosave();
      autosaveBaseline.current = isEngineReady ? captureAutosaveBaseline() : undefined;
      setRecord(undefined);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setRestoring(false); }
  };
  return (
    <Dialog onClose={() => { if (!restoring) setRecord(undefined); }} id="recovery-dialog" role="dialog" aria-label={t("Recover project")}>
      <div className="modal-content ds-dialog">
        <h3 style={{ margin: 0 }}>{t("Restore your last session?")}</h3>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          {record.objects > 0 && <>{t(record.objects === 1 ? 'The project contains {{count}} object.' : 'The project contains {{count}} objects.', { count: record.objects })}{' '}</>}
          {t('An automatic backup from {{date}} is available.', { date: new Date(record.savedAt).toLocaleString() })}</p>
        {error && <p role="alert">{error}</p>}
        <div className="ds-dialog__foot">
          <button className="ds-btn" id="recovery-discard" disabled={restoring} onClick={discard}>{t("Discard")}</button>
          <button className="ds-btn ds-btn--primary" id="recovery-restore" disabled={restoring || !isEngineReady} onClick={() => void restore()}>{t("Restore")}</button>
        </div>
      </div>
    </Dialog>
  );
};
