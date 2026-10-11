import React, { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ModalBackdrop, confirmDiscard } from '../components/ModalBackdrop';
import { useAppStore } from '../store/appStore';
import { useTranslation } from "../i18n";
import { getOption } from '../engine/orcaEngine';

export const useProjectNotesStore = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false, setOpen: (open) => set({ open })
}));

const NotesEditor: React.FC = () => {
  const { t } = useTranslation();
  const [initial, setInitial] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let canceled = false;
    getOption({ key: 'notes' }).then(({ value }) => {
      if (!canceled) { setInitial(value); setNotes(value); }
    }).catch(error => useAppStore.setState({ engineError: `Failed to read project notes: ${String(error)}` }));
    return () => { canceled = true; };
  }, []);
  const close = () => useProjectNotesStore.getState().setOpen(false);
  const requestClose = async () => { if (initial === null || notes === initial || await confirmDiscard(t('project notes'))) close(); };
  const save = async () => {
    setSaving(true);
    try {
      await useAppStore.getState().applyOptionChange('notes', notes, 'print');
      if (!useAppStore.getState().engineError) close();
    } finally { setSaving(false); }
  };
  return <ModalBackdrop onClose={() => void requestClose()} role="dialog" aria-label={t("Project notes")}>
    <div className="modal-content" style={{ width: 'min(640px, 94vw)' }}>
      <h2>{t("Project notes")}</h2>
      <p>{t("Notes are saved in the project and included as comments in exported G-code.")}</p>
      <textarea id="project-notes" aria-label={t("Project notes")} rows={14} value={notes}
        disabled={saving || initial === null} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
      <div className="modal-footer">
        <button className="btn btn-secondary" disabled={saving} onClick={() => void requestClose()}>{t("Cancel")}</button>
        <button id="project-notes-save" className="btn btn-primary" disabled={saving || initial === null} onClick={() => void save()}>{t("Save notes")}</button>
      </div>
    </div>
  </ModalBackdrop>;
};
export const ProjectNotesDialog: React.FC = () => useProjectNotesStore((s) => s.open) ? <NotesEditor /> : null;
