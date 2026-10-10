import React, { useEffect, useRef, useState } from 'react';
import { renameObject } from '../engine/orcaEngine';
import { useEditOpsStore } from '../editops';
import { usePrefsStore } from '../prefs/prefsStore';
import { showToast } from '../shell/toastStore';
import { useAppStore } from '../store/appStore';
import { useTextStore } from '../text';
import { HANDY_MODELS, loadHandyModel } from './handyModels';
import { primitiveFile, PRIMITIVE_LABELS } from './primitives';
import type { PlatePrimitive } from './primitives';
import { usePlateStore } from './plateStore';
import { useTranslation } from "../i18n";

const menuStyle: React.CSSProperties = {
  background: 'var(--panel-bg)', border: '1px solid var(--control-bg)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)', padding: '4px 0', minWidth: 170, zIndex: 10000, fontSize: 13
};

const Item: React.FC<{ id?: string; label: string; active?: boolean; submenu?: boolean; onEnter?: () => void; onClick?: () => void; children?: React.ReactNode }> = ({ id, label, active, submenu, onEnter, onClick, children }) => (
  <div
    id={id}
    role="menuitem"
    onMouseEnter={onEnter}
    onClick={onClick}
    style={{ position: 'relative', padding: '6px 14px', display: 'flex', justifyContent: 'space-between', gap: 16, cursor: 'pointer', background: active ? 'var(--accent-color, #9c27b0)' : 'transparent', color: 'var(--text-color)' }}
  >
    <span>{label}</span>
    {submenu && <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>▶</span>}
    {active && children}
  </div>
);

const Separator = () => <div style={{ height: 1, background: 'var(--control-bg)', margin: '4px 0' }} />;

/** The menu of the empty plate: add primitives and ready-made models, import files, toggle labels. */
export const PlateContextMenu: React.FC<{ x: number; y: number; onClose: () => void }> = ({ x, y, onClose }) => {
    const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [submenu, setSubmenu] = useState<'primitive' | 'handy' | null>(null);
  const bed = usePlateStore((s) => s.bedConfig);
  const showLabels = usePrefsStore((s) => s.display.showLabels);
  const toggleShowLabels = usePrefsStore((s) => s.toggleShowLabels);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape); };
  }, [onClose]);

  // Objects are named after the shape, not the file that carries it.
  const importFile = (make: () => File | File[] | Promise<File | File[]>, name: string) => {
    onClose();
    void (async () => {
      try {
        const known = new Set(usePlateStore.getState().objects.map((o) => o.id));
        const res = await make();
        const files = Array.isArray(res) ? res : [res];
        for (const f of files) await useAppStore.getState().importModelFile(f);
        const created = usePlateStore.getState().objects.find((o) => !known.has(o.id));
        if (created) {
          await renameObject(created.id, name);
          await usePlateStore.getState().refreshObjects();
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), 'error');
      }
    })();
  };
  // Desktop sizes a new primitive at a tenth of the bed's longest side.
  const side = Math.round(Math.max(bed.width, bed.depth) / 10);
  const flyout = (children: React.ReactNode, id: string) => (
    <div id={id} role="menu" style={{ ...menuStyle, position: 'absolute', left: '100%', top: -5 }}>{children}</div>
  );

  return (
    <div id="plate-context-menu" ref={ref} role="menu" style={{ ...menuStyle, position: 'fixed', left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      <Item id="plate-menu-primitive" label={t("Add Primitive")} submenu active={submenu === 'primitive'} onEnter={() => setSubmenu('primitive')}>
        {flyout(
          <>
            {(Object.keys(PRIMITIVE_LABELS) as PlatePrimitive[]).map((shape) => (
              <Item key={shape} id={`plate-menu-${shape}`} label={PRIMITIVE_LABELS[shape]} onClick={() => importFile(() => primitiveFile(shape, side), PRIMITIVE_LABELS[shape])} />
            ))}
            <Separator />
            <Item id="plate-menu-text" label={t("Text")} onClick={() => { onClose(); useTextStore.getState().openForAdd(null); }} />
            <Separator />
            <Item id="plate-menu-svg" label={t("SVG")} onClick={() => { onClose(); void useEditOpsStore.getState().openSvgDialog(); }} />
          </>,
          'plate-submenu-primitive'
        )}
      </Item>
      <Item id="plate-menu-handy" label={t("Add Handy models")} submenu active={submenu === 'handy'} onEnter={() => setSubmenu('handy')}>
        {flyout(
          HANDY_MODELS.map((model) => (
            <Item key={model.label} id={`plate-menu-handy-${model.label.replace(/\s+/g, '')}`} label={model.label} onClick={() => importFile(() => loadHandyModel(model), model.label)} />
          )),
          'plate-submenu-handy'
        )}
      </Item>
      <Item id="plate-menu-add-models" label={t("Add Models")} onEnter={() => setSubmenu(null)} onClick={() => fileInput.current?.click()} />
      <Separator />
      <Item id="plate-menu-labels" label={showLabels ? '✓ Show Labels' : 'Show Labels'} onEnter={() => setSubmenu(null)} onClick={() => { toggleShowLabels(); onClose(); }} />
      <input
        ref={fileInput}
        type="file"
        multiple
        style={{ display: 'none' }}
        accept=".stl,.obj,.3mf,.amf,.step,.stp,.svg"
        onChange={(e) => {
          for (const file of Array.from(e.target.files ?? [])) useAppStore.getState().requestImportFile(file);
          onClose();
        }}
      />
    </div>
  );
};
