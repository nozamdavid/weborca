import React, { useEffect, useState } from 'react';
import type { PlateInstance, PlateObject } from './types';
import { usePlateStore } from './plateStore';
import { useTranslation } from "../i18n";
import { useObjectListStore } from '../objectlist/objectListStore';
import { getEngine } from '../engine/orcaEngine';
import type { ViewerVolume } from './types';
import './numericTransform.css';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';

type Vec3 = [number, number, number];
const AXES = ['X', 'Y', 'Z'] as const;
const DEG = 180 / Math.PI;
const round = (v: number, digits: number) => Number(v.toFixed(digits));

/** A number box that applies on Enter or blur and shows the engine's value otherwise. */
const NumberBox: React.FC<{ id: string; label: string; value: number; digits: number; disabled?: boolean; onCommit: (v: number) => void }> = ({ id, label, value, digits, disabled, onCommit }) => {
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
      id={id} type="text" inputMode="decimal" value={text} disabled={disabled} aria-label={label}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(shown); e.stopPropagation(); }}
      className="numeric-transform-input"
    />
  );
};

/** Position, rotation, scale and size of the selected instance as editable numbers, like desktop's object manipulation panel. */
export const NumericTransform: React.FC<{ object: PlateObject; instance: PlateInstance; mode?: 'move' | 'scale'; idPrefix?: string }> = ({ object, instance: parent, mode, idPrefix = 'nt' }) => {
    const { t } = useTranslation();
  const apply = usePlateStore((s) => s.setInstanceTransform);
  const mirrorSelected = usePlateStore((s) => s.mirrorSelected);
  const volumeId = useObjectListStore((s) => s.selectedVolumeId);
  const [volume, setVolume] = useState<ViewerVolume | null>(null);
  useEffect(() => {
    let active = true;
    setVolume(null);
    if (volumeId !== null) void getEngine().then(engine => engine.call('getVolume', { objectId: object.id, volumeId })).then(value => {
      if (active) setVolume(value);
    }).catch(() => { if (active) setVolume(null); });
    return () => { active = false; };
  }, [object, volumeId]);
  const instance = volumeId !== null && volume?.volumeId === volumeId ? volume : parent;
  const ready = volumeId === null || instance === volume;
  const [instanceBounds, setInstanceBounds] = useState<{ object: PlateObject; instance: PlateInstance; size: Vec3 } | null>(null);
  useEffect(() => {
    if (mode !== 'scale' || volumeId !== null) return;
    let active = true;
    void usePlateStore.getState().getMesh(object.id).then(mesh => {
      const matrix = new Matrix4().compose(new Vector3(),
        new Quaternion().setFromEuler(new Euler(...parent.rotation, 'ZYX')),
        new Vector3(...parent.scale.map((v, i) => v * (parent.mirror?.[i] ?? 1)) as Vec3));
      const bounds = new Box3();
      const point = new Vector3();
      for (let i = 0; i < mesh.positions.length; i += 3) {
        bounds.expandByPoint(point.fromArray(mesh.positions, i).applyMatrix4(matrix));
      }
      if (active && !bounds.isEmpty()) setInstanceBounds({ object, instance: parent, size: bounds.getSize(point).toArray() as Vec3 });
    }).catch(() => { if (active) setInstanceBounds(null); });
    return () => { active = false; };
  }, [mode, object, parent, volumeId]);
  const instanceSize = instanceBounds?.object === object && instanceBounds.instance === parent ? instanceBounds.size : null;
  const sizeReady = ready && (mode !== 'scale' || volumeId !== null || instanceSize !== null);
  const size = volume?.localBounds && volumeId !== null ? volume.localBounds.max.map((v, i) => (v - volume.localBounds!.min[i]) * volume.scale[i]) : mode === 'scale' ? instanceSize ?? [0, 0, 0] : object.size;
  const [lock, setLock] = useState(true);
  const set = (transform: Parameters<typeof apply>[2] & { mirror?: Vec3 }) => {
    if (!ready) return;
    if (volumeId !== null) void usePlateStore.getState().setVolumeTransform(object.id, volumeId, transform);
    else void apply(object.id, parent.id, transform);
  };

  const replace = (values: Vec3, axis: number, v: number): Vec3 => values.map((x, i) => (i === axis ? v : x)) as Vec3;
  const scaleTo = (axis: number, factor: number): Vec3 =>
    instance.scale.map((s, i) => (lock || i === axis ? s * factor : s)) as Vec3;

  const row = (label: string, unit: string, cells: React.ReactNode) => (
    <div className="numeric-transform-row">
      <span className="numeric-transform-label">{label}</span>
      {cells}
      <span className="numeric-transform-unit">{unit}</span>
    </div>
  );

  return (
    <div id={idPrefix === 'nt' ? 'numeric-transform' : `${idPrefix}-transform`} className={`numeric-transform${mode ? ' numeric-transform-mobile' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      {volumeId !== null && object.instances.length > 1 && <p className="numeric-transform-note">{t('Part changes apply to all copies of this object.')}</p>}
      {mode && <div className="numeric-transform-axes" aria-hidden="true">{AXES.map(a => <span key={a}>{a}</span>)}</div>}
      {mode !== 'scale' && row(t('Position'), 'mm', AXES.map((a, i) => (
        <NumberBox key={a} id={`${idPrefix}-pos-${a.toLowerCase()}`} label={`${t('Position')} ${a} (mm)`} value={instance.offset[i]} digits={2} disabled={!ready || (volumeId === null && i === 2)} onCommit={(v) => set({ offset: replace(instance.offset, i, v) })} />
      )))}
      {!mode && row(t('Rotation'), '°', AXES.map((a, i) => (
        <NumberBox key={a} id={`${idPrefix}-rot-${a.toLowerCase()}`} label={`${t('Rotation')} ${a} (°)`} value={instance.rotation[i] * DEG} digits={1} onCommit={(v) => set({ rotation: replace(instance.rotation, i, v / DEG) })} />
      )))}
      {mode !== 'move' && row(t('Scale'), '%', AXES.map((a, i) => (
        <NumberBox key={a} id={`${idPrefix}-scale-${a.toLowerCase()}`} label={`${t('Scale')} ${a} (%)`} value={instance.scale[i] * 100} digits={1} onCommit={(v) => v > 0 && set({ scale: scaleTo(i, v / 100 / instance.scale[i]) })} />
      )))}
      {mode !== 'move' && row(t('Size'), 'mm', AXES.map((a, i) => (
        <NumberBox key={a} id={`${idPrefix}-size-${a.toLowerCase()}`} label={`${t('Size')} ${a} (mm)`} value={size[i]} digits={2} disabled={!sizeReady} onCommit={(v) => sizeReady && v > 0 && size[i] > 0 && set({ scale: scaleTo(i, v / size[i]) })} />
      )))}
      {!mode && row(t('Mirror'), '', AXES.map((a, i) => (
        <button key={a} id={`${idPrefix}-mirror-${a.toLowerCase()}`} type="button" title={t('Mirror') + ' ' + a} onClick={() => volumeId !== null ? set({ mirror: replace(instance.mirror ?? [1, 1, 1], i, -(instance.mirror?.[i] ?? 1)) }) : void mirrorSelected(i as 0 | 1 | 2)}
          className="numeric-transform-input">
          {a}
        </button>
      )))}
      {mode !== 'move' && <label className="numeric-transform-lock">
        <input id={`${idPrefix}-lock`} type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> {t("Keep proportions")}</label>}
    </div>
  );
};
