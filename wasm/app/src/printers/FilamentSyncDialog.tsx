import React, { useState } from 'react';
import { useTranslation } from '../i18n';
import { Dialog } from '../components/Dialog';
import { useAppStore, minimumFilamentSlots } from '../store/appStore';
import { usePrinterConnectionStore } from './connectionStore';
import type { PrinterFilament } from './types';

const SyncEditor: React.FC<{ slots: PrinterFilament[]; onClose: () => void }> = ({ slots, onClose }) => {
  const { t } = useTranslation();
  const presets = useAppStore((s) => s.filaments);
  const [choices, setChoices] = useState(() => slots.map((slot) => {
    if (!slot.material) return '';
    const matching = presets.filter((p) => p.isCompatible && p.name.toUpperCase().includes(slot.material.toUpperCase()));
    return matching.find((p) => p.name.startsWith('Generic '))?.name || matching[0]?.name || '';
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = async () => {
    setBusy(true); setError('');
    try {
      for (let i = 0; i < slots.length; i++) {
        const slotIndex = slots[i].slotIndex ?? i;
        while (useAppStore.getState().selectedFilaments.length < slotIndex) {
          const before = useAppStore.getState().selectedFilaments.length;
          await useAppStore.getState().addFilamentSlot();
          if (useAppStore.getState().selectedFilaments.length === before) throw new Error('Could not add filament slot');
        }
        await useAppStore.getState().chooseFilament(choices[i], slotIndex);
        if (slots[i].color) await useAppStore.getState().setSlotColor(slotIndex, slots[i].color!);
        const failure = useAppStore.getState().engineError;
        if (failure) throw new Error(failure);
      }
      const slotCount = Math.max(minimumFilamentSlots(useAppStore.getState().presetConfig),
        Math.max(...slots.map((slot, i) => slot.slotIndex ?? i)) + 1);
      while (useAppStore.getState().selectedFilaments.length > slotCount) {
        const before = useAppStore.getState().selectedFilaments.length;
        await useAppStore.getState().removeFilamentSlot();
        if (useAppStore.getState().selectedFilaments.length >= before) {
          throw new Error(useAppStore.getState().engineError || 'Could not remove filament slot');
        }
      }
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <Dialog onClose={() => { if (!busy) onClose(); }} role="dialog" aria-label={t("Sync printer filaments")}>
    <div className="modal-content ds-dialog">
      <h2>{t("Sync printer filaments")}</h2>
      <p>{t("Match each loaded printer slot to a compatible slicer preset. This updates the project and saved device setup.")}</p>
      {slots.map((slot, i) => <label key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ background: slot.color, width: 16, height: 16, border: '1px solid var(--border-color)' }} />
        {slot.label}: {slot.material || t('Unknown')}
        <select id={`sync-filament-${i}`} value={choices[i]} disabled={busy} onChange={(e) => setChoices(choices.map((v, j) => j === i ? e.target.value : v))}>
          <option value="">{t("Choose preset...")}</option>{presets.filter(p => p.isCompatible).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      </label>)}
      {error && <p role="alert">{error}</p>}
      <div className="modal-footer ds-dialog__foot"><button className="ds-btn" disabled={busy} onClick={onClose}>{t("Cancel")}</button>
        <button id="sync-filaments-apply" className="ds-btn ds-btn--primary" disabled={busy || choices.some((c) => !c)} onClick={() => void apply()}>{t("Sync")}</button></div>
    </div>
  </Dialog>;
};

export const FilamentSyncButton: React.FC = () => {
  const { t } = useTranslation();
  const slots = usePrinterConnectionStore((s) => s.liveState?.filaments);
  const busy = useAppStore((s) => !s.isEngineReady || s.isSlicing || s.isModelLoading || s.isSelectingPreset);
  const [open, setOpen] = useState(false);
  if (!slots?.length) return null;
  return <><button id="sync-printer-filaments" className="ds-btn" disabled={busy} onClick={() => setOpen(true)}>{t("Sync printer filaments...")}</button>
    {open && <SyncEditor slots={slots.filter((slot, i) => (slot.slotIndex ?? i) < 16).slice(0, 16)} onClose={() => setOpen(false)} />}</>;
};
