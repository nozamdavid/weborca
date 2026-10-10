import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { clearAutosave, readAutosave, startAutosave } from './autosave';
import type { AutosaveRecord } from './autosave';

/** Offers the project the last session left behind, and runs the autosave timer once the engine is ready. */
export const RecoveryDialog: React.FC = () => {
  const isEngineReady = useAppStore((s) => s.isEngineReady);
  const openProjectFile = useAppStore((s) => s.openProjectFile);
  const [record, setRecord] = useState<AutosaveRecord | undefined>();

  useEffect(() => {
    if (!isEngineReady) return;
    let cancelled = false;
    void readAutosave().then((found) => { if (!cancelled && found) setRecord(found); });
    // The timer starts after the offer is answered, so an unanswered offer is not overwritten by an empty plate.
    return () => { cancelled = true; };
  }, [isEngineReady]);

  useEffect(() => (isEngineReady && !record ? startAutosave() : undefined), [isEngineReady, record]);

  if (!record) return null;
  const restore = async () => {
    const file = new File([record.bytes as BlobPart], 'Recovered project.3mf');
    setRecord(undefined);
    await openProjectFile(file);
  };
  const discard = () => {
    setRecord(undefined);
    void clearAutosave();
  };
  return (
    <div className="modal-backdrop" id="recovery-dialog" role="dialog" aria-label="Recover project">
      <div className="modal-content" style={{ width: 'min(440px, 92vw)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0 }}>Restore your last session?</h3>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          The app was closed with {record.objects} object{record.objects === 1 ? '' : 's'} on the plate. An automatic backup from{' '}
          {new Date(record.savedAt).toLocaleString()} is available.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" id="recovery-discard" onClick={discard}>Discard</button>
          <button className="btn btn-primary" id="recovery-restore" onClick={() => void restore()}>Restore</button>
        </div>
      </div>
    </div>
  );
};
