import React from 'react';
import type { PlateInfo } from './types';
import { usePlatesStore } from './platesStore';
import { useTranslation } from "../i18n";

/** The values the engine's enums take (see `curr_bed_type` and `print_sequence` in PrintConfig.cpp). */
const BED_TYPES: [string, string][] = [
  ['Cool Plate', 'Smooth Cool Plate'],
  ['Engineering Plate', 'Engineering Plate'],
  ['High Temp Plate', 'Smooth High Temp Plate'],
  ['Textured PEI Plate', 'Textured PEI Plate'],
  ['Textured Cool Plate', 'Textured Cool Plate'],
  ['Supertack Plate', 'Cool Plate (SuperTack)']
];
const SEQUENCES: [string, string][] = [['by layer', 'By layer'], ['by object', 'By object']];

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 };
const select: React.CSSProperties = { background: 'var(--control-bg)', color: 'inherit', border: '1px solid var(--input-border)', borderRadius: 4, padding: '3px 6px' };

/** Per-plate overrides of the print settings: they apply when this plate is sliced. */
export const PlateSettingsPopover: React.FC<{ plate: PlateInfo }> = ({ plate }) => {
    const { t } = useTranslation();
  const setPlateConfig = usePlatesStore((s) => s.setPlateConfig);
  const set = (key: string, value: string) => void setPlateConfig(plate.index, { [key]: value });
  const bed = plate.config.curr_bed_type;
  const sequence = plate.config.print_sequence;
  return (
    <div
      id="plate-settings-popover" role="dialog" aria-label={`Settings of plate ${plate.index + 1}`}
      style={{ position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, minWidth: 280, background: 'var(--panel-bg)', color: 'var(--text-color)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, fontSize: '0.85rem', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
    >
      <strong style={{ display: 'block', marginBottom: 8 }}>{t("Plate")}{plate.index + 1} {t("settings")}</strong>
      <label style={row}>
        <span>{t("Bed type")}</span>
        <select id="plate-bed-type" style={select} value={bed ?? ''} onChange={(e) => set('curr_bed_type', e.target.value)}>
          {bed === undefined && <option value="">{t("Printer setting")}</option>}
          {BED_TYPES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </label>
      <label style={row}>
        <span>{t("Print sequence")}</span>
        <select id="plate-print-sequence" style={select} value={sequence ?? ''} onChange={(e) => set('print_sequence', e.target.value)}>
          {sequence === undefined && <option value="">{t("Process setting")}</option>}
          {SEQUENCES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </label>
      <label style={row}>
        <span>{t("Spiral vase")}</span>
        <input id="plate-spiral-mode" type="checkbox" checked={plate.config.spiral_mode === '1'} onChange={(e) => set('spiral_mode', e.target.checked ? '1' : '0')} />
      </label>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t("These replace the printer and process settings when this plate is sliced.")}</span>
    </div>
  );
};
