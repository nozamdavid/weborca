import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { rovingKeyDown, useRovingFocus } from '../components/rovingFocus';
import { bindMenuTouchAway } from '../components/menuTouchAway';
import { useMenuOpeningIntent } from '../components/menuOpeningIntent';
import { confirmDialog } from '../components/ModalBackdrop';
import { usePlatesStore } from '../plates/platesStore';
import { useHistoryStore } from '../history';

const Item: React.FC<{ id?: string; label: string; disabled?: boolean; active?: boolean; submenu?: boolean; onEnter?: () => void; onClick?: () => void; intent?: ReturnType<typeof useMenuOpeningIntent>; children?: React.ReactNode }> = ({ id, label, disabled, active, submenu, onEnter, onClick, intent, children }) => (
  <button type="button" className="ds-menu__item"
    id={id}
    role="menuitem"
    disabled={disabled}
    aria-disabled={disabled || undefined}
    aria-haspopup={submenu ? 'menu' : undefined}
    aria-expanded={submenu ? active : undefined}
    onPointerEnter={(event) => { if (!intent || intent.hover(event)) onEnter?.(); }}
    onPointerMove={(event) => { if (!intent || intent.hover(event)) onEnter?.(); }}
    onFocus={() => { if (!intent || intent.keyboardFocus()) onEnter?.(); }}
    onClick={onClick ?? (submenu ? onEnter : undefined)}
  >
    <span>{label}</span>
    {submenu && <span className="submenu-arrow" aria-hidden="true">▶</span>}
    {active && children}
  </button>
);

const Separator = () => <div className="ds-menu__sep" role="separator" />;

/** Commands for the plate under the pointer, followed by import and display options. */
export const PlateContextMenu: React.FC<{ x: number; y: number; plateIndex: number; busy: boolean; onClose: () => void }> = ({ x, y, plateIndex, busy, onClose }) => {
    const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const openingIntent = useMenuOpeningIntent(x, y, flyoutRef);
  useRovingFocus(ref, true);
  useRovingFocus(flyoutRef);
  const [position, setPosition] = useState({ left: x, top: y });
  const [flyoutPosition, setFlyoutPosition] = useState({ left: 0, top: 0 });
  const fileInput = useRef<HTMLInputElement>(null);
  const [submenu, setSubmenu] = useState<'primitive' | 'handy' | null>(null);
  const bed = usePlateStore((s) => s.bedConfig);
  const showLabels = usePrefsStore((s) => s.display.showLabels);
  const toggleShowLabels = usePrefsStore((s) => s.toggleShowLabels);
  const plates = usePlatesStore((s) => s.plates);
  const platesLoading = usePlatesStore((s) => s.isLoading);
  const objects = usePlateStore((s) => s.objects);
  const contextPlate = plates.find((p) => p.index === plateIndex);
  const members = contextPlate?.instances ?? [];
  const objectIds = [...new Set(members.map((i) => i.objectId))].filter((id) => objects.some((o) => o.id === id));
  const unavailable = busy || platesLoading || !contextPlate;
  const activate = () => usePlatesStore.getState().setActivePlate(plateIndex);
  const run = (action: () => void | Promise<unknown>) => {
    onClose();
    activate();
    void Promise.resolve().then(action).catch((err) => showToast(err instanceof Error ? err.message : String(err), 'error'));
  };
  const deletePlate = async () => {
    if (!await confirmDialog({ title: t('Delete Plate'), message: t('Delete this plate?'), confirmLabel: t('Delete Plate'), cancelLabel: t('Cancel') })) return;
    const app = useAppStore.getState();
    if (app.isSlicing || app.isModelLoading || app.isSelectingPreset || usePlateStore.getState().isLoading
      || useEditOpsStore.getState().isOperating || useHistoryStore.getState().isRestoring) return;
    await usePlatesStore.getState().deletePlate(plateIndex);
  };
  const autoRotate = async () => {
    const { selectedObjectId, selectedInstanceId, extraSelection } = usePlateStore.getState();
    await useEditOpsStore.getState().autoOrient(objectIds);
    // Auto-orient normally reselects its first target; a plate command keeps the user's selection.
    usePlateStore.setState({ selectedObjectId, selectedInstanceId, extraSelection });
  };

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const place = () => {
      const bounds = menu.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(x, innerWidth - bounds.width - 8)), top: Math.max(8, Math.min(y, innerHeight - bounds.height - 8)) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [x, y]);

  useLayoutEffect(() => {
    const anchor = ref.current?.querySelector(`#plate-menu-${submenu}`)?.getBoundingClientRect();
    const flyout = flyoutRef.current?.getBoundingClientRect();
    if (!anchor || !flyout) return;
    setFlyoutPosition({
      left: Math.max(8, anchor.right + flyout.width <= innerWidth - 8 ? anchor.right : anchor.left - flyout.width),
      top: Math.max(8, Math.min(anchor.top, innerHeight - flyout.height - 8))
    });
  }, [submenu, position]);

  useEffect(() => {
    const unbindTouch = bindMenuTouchAway(() => [ref.current, flyoutRef.current], onClose);
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !flyoutRef.current?.contains(e.target as Node)) onClose(); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => { unbindTouch(); document.removeEventListener('mousedown', away); document.removeEventListener('keydown', escape); };
  }, [onClose]);

  // Objects are named after the shape, not the file that carries it.
  const importFile = (make: () => File | File[] | Promise<File | File[]>, name: string, context?: { source: 'builtin-handy' }) => {
    onClose();
    activate();
    void (async () => {
      try {
        const known = new Set(usePlateStore.getState().objects.map((o) => o.id));
        const res = await make();
        const files = Array.isArray(res) ? res : [res];
        for (const f of files) await useAppStore.getState().importModelFile(f, undefined, false, context);
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
    createPortal(<div ref={flyoutRef} id={id} className="ds-menu context-menu" role="menu" style={flyoutPosition} onKeyDown={rovingKeyDown}>{children}</div>, document.body)
  );

  return (
    <div id="plate-context-menu" ref={ref} className="ds-menu context-menu" role="menu" style={position} onContextMenu={(e) => e.preventDefault()} onKeyDown={(event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); openingIntent.openRight(event.target as HTMLElement); }
      else rovingKeyDown(event);
    }}>
      <Item id="plate-menu-select-all" label={t('Select All')} disabled={unavailable || !members.length} onEnter={() => setSubmenu(null)} onClick={() => run(() => usePlateStore.getState().selectAll(plateIndex))} />
      <Item id="plate-menu-select-all-plates" label={t('Select All Plates')} disabled={unavailable || !objects.length} onEnter={() => setSubmenu(null)} onClick={() => run(() => usePlateStore.getState().selectAll())} />
      <Item id="plate-menu-delete-all" label={t('Delete All')} disabled={unavailable || !members.length} onEnter={() => setSubmenu(null)} onClick={() => run(async () => {
        usePlateStore.getState().selectAll(plateIndex);
        await usePlateStore.getState().deleteSelected();
      })} />
      <Item id="plate-menu-arrange" label={t('Arrange')} disabled={unavailable || !members.length} onEnter={() => setSubmenu(null)} onClick={() => run(() => {
        usePlateStore.getState().setArrangeSettings({ plateScope: 'current' });
        usePlateStore.getState().setArrangeDialogOpen(true);
      })} />
      <Item id="plate-menu-auto-rotate" label={t('Auto Rotate')} disabled={unavailable || !objectIds.length} onEnter={() => setSubmenu(null)} onClick={() => { run(autoRotate); }} />
      <Item id="plate-menu-delete-plate" label={t('Delete Plate')} disabled={unavailable || plates.length <= 1} onEnter={() => setSubmenu(null)} onClick={() => { onClose(); void deletePlate(); }} />
      <Separator />
      <Item id="plate-menu-primitive" label={t("Add Primitive")} submenu intent={openingIntent} active={submenu === 'primitive'} onEnter={() => setSubmenu('primitive')}>
        {flyout(
          <>
            {(Object.keys(PRIMITIVE_LABELS) as PlatePrimitive[]).map((shape) => (
              <Item key={shape} id={`plate-menu-${shape}`} label={t(PRIMITIVE_LABELS[shape])} onClick={() => importFile(() => primitiveFile(shape, side), PRIMITIVE_LABELS[shape])} />
            ))}
            <Separator />
            <Item id="plate-menu-text" label={t("Text")} onClick={() => { onClose(); useTextStore.getState().openForAdd(null); }} />
            <Separator />
            <Item id="plate-menu-svg" label={t("SVG")} onClick={() => { onClose(); void useEditOpsStore.getState().openSvgDialog(); }} />
          </>,
          'plate-submenu-primitive'
        )}
      </Item>
      <Item id="plate-menu-handy" label={t("Add Handy models")} submenu intent={openingIntent} active={submenu === 'handy'} onEnter={() => setSubmenu('handy')}>
        {flyout(
          HANDY_MODELS.map((model) => (
            <Item key={model.label} id={`plate-menu-handy-${model.label.replace(/\s+/g, '')}`} label={model.label} onClick={() => importFile(() => loadHandyModel(model), model.label, { source: 'builtin-handy' })} />
          )),
          'plate-submenu-handy'
        )}
      </Item>
      <Item id="plate-menu-add-models" label={t("Add Models")} onEnter={() => setSubmenu(null)} onClick={() => fileInput.current?.click()} />
      <Separator />
      <Item id="plate-menu-labels" label={`${showLabels ? '✓ ' : ''}${t('Show Labels')}`} onEnter={() => setSubmenu(null)} onClick={() => { toggleShowLabels(); onClose(); }} />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".stl,.obj,.3mf,.amf,.step,.stp,.svg"
        onChange={(e) => {
          for (const file of Array.from(e.target.files ?? [])) useAppStore.getState().requestImportFile(file);
          onClose();
        }}
      />
    </div>
  );
};
