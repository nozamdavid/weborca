import React, { useEffect, useState } from 'react';
import type { PlateInstance, PlateObject } from './types';
import { usePlateStore } from './plateStore';
import { useTranslation } from "../i18n";

type Vec3 = [number, number, number];
const AXES = ['X', 'Y', 'Z'] as const;
const DEG = 180 / Math.PI;
const round = (v: number, digits: number) => Number(v.toFixed(digits));

/** A number box that applies on Enter or blur and shows the engine's value otherwise. */
const NumberBox: React.FC<{ id: string; value: number; digits: number; disabled?: boolean; onCommit: (v: number) => void }> = ({ id, value, digits, disabled, onCommit }) => {
    const { t } = useTranslation();
  const shown = round(value, digits).toString();
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const parsed = parseFloat(text);
    if (!Number.isFinite(parsed) || round(parsed, digits) === round(value, digits)) return setText(shown);
    onCommit(parsed);
  };
  return (
    <input
      id={id} type="text" inputMode="decimal" value={text} disabled={disabled} aria-label={id}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(shown); e.stopPropagation(); }}
      style={{ width: 62, background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 4px', fontSize: '0.8rem' }}
    />
  );
};

/** Position, rotation, scale and size of the selected instance as editable numbers, like desktop's object manipulation panel. */
export const NumericTransform: React.FC<{ object: PlateObject; instance: PlateInstance }> = ({ object, instance }) => {
    const { t } = useTranslation();
  const apply = usePlateStore((s) => s.setInstanceTransform);
  const mirrorSelected = usePlateStore((s) => s.mirrorSelected);
  const [lock, setLock] = useState(true);
  const set = (t: Parameters<typeof apply>[2]) => void apply(object.id, instance.id, t);

  const replace = (values: Vec3, axis: number, v: number): Vec3 => values.map((x, i) => (i === axis ? v : x)) as Vec3;
  const scaleTo = (axis: number, factor: number): Vec3 =>
    instance.scale.map((s, i) => (lock || i === axis ? s * factor : s)) as Vec3;

  const row = (label: string, unit: string, cells: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
      <span style={{ width: 54, color: '#94a3b8' }}>{label}</span>
      {cells}
      <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{unit}</span>
    </div>
  );

  return (
    <div id="numeric-transform" style={{ marginTop: 6 }} onPointerDown={(e) => e.stopPropagation()}>
      {row('Position', 'mm', AXES.map((a, i) => (
        <NumberBox key={a} id={`nt-pos-${a.toLowerCase()}`} value={instance.offset[i]} digits={2} disabled={i === 2} onCommit={(v) => set({ offset: replace(instance.offset, i, v) })} />
      )))}
      {row('Rotation', '°', AXES.map((a, i) => (
        <NumberBox key={a} id={`nt-rot-${a.toLowerCase()}`} value={instance.rotation[i] * DEG} digits={1} onCommit={(v) => set({ rotation: replace(instance.rotation, i, v / DEG) })} />
      )))}
      {row('Scale', '%', AXES.map((a, i) => (
        <NumberBox key={a} id={`nt-scale-${a.toLowerCase()}`} value={instance.scale[i] * 100} digits={1} onCommit={(v) => v > 0 && set({ scale: scaleTo(i, v / 100 / instance.scale[i]) })} />
      )))}
      {row('Size', 'mm', AXES.map((a, i) => (
        <NumberBox key={a} id={`nt-size-${a.toLowerCase()}`} value={object.size[i]} digits={2} onCommit={(v) => v > 0 && object.size[i] > 0 && set({ scale: scaleTo(i, v / object.size[i]) })} />
      )))}
      {row('Mirror', '', AXES.map((a, i) => (
        <button key={a} id={`nt-mirror-${a.toLowerCase()}`} type="button" title={`Mirror along ${a}`} onClick={() => void mirrorSelected(i as 0 | 1 | 2)}
          style={{ width: 62, background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 4px', fontSize: '0.8rem', cursor: 'pointer' }}>
          {a}
        </button>
      )))}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: '#94a3b8' }}>
        <input id="nt-lock" type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> {t("Keep proportions")}</label>
    </div>
  );
};
