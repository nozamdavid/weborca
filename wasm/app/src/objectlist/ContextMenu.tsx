import { useObjectListStore } from "./objectListStore";
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PrimitiveShape, VolumeType } from './types';
import { usePaintToolsStore } from '../paint-tools';
import { usePlateStore } from '../plate/plateStore';
import { useTextStore } from '../text';
import { useLayersStore } from '../layers';
import { useCutStore } from '../cut';
import { useRepairStore } from '../repair';
import { useEditOpsStore } from '../editops';
import { useAppStore } from '../store/appStore';
import { useTranslation } from "../i18n";

export interface ContextMenuProps {
  x: number;
  y: number;
  isObject: boolean;
  objectId: number;
  volumeId?: number;
  volumeType?: VolumeType;
  currentExtruder?: number;
  isMulti?: boolean;
  onClose: () => void;
  onAddVolume?: (objectId: number, type: VolumeType, shape: PrimitiveShape) => void;
  onRename?: () => void;
  onDelete?: () => void;
  onSetExtruder?: (extruder: number) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  isObject,
  objectId,
  volumeId,
  currentExtruder,
  isMulti = false,
  onClose,
  onAddVolume,
  onRename,
  onDelete,
  onSetExtruder
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState({ left: 0, top: 0 });
  const selectedFilaments = useAppStore((s) => s.selectedFilaments);
  const currentConfig = useAppStore((s) => s.currentConfig);

  const objectTree = useObjectListStore((s) => s.objects);
  const targetObj = objectTree.find((o) => o.id === objectId);
  const targetVol = volumeId !== undefined ? targetObj?.volumes?.find((v) => v.id === volumeId) : undefined;
  const effectiveExtruder =
    currentExtruder !== undefined
      ? currentExtruder
      : isObject
      ? (parseInt(targetObj?.config?.extruder || '0', 10) || (targetObj?.volumes?.[0]?.extruder || 0))
      : (targetVol?.extruder || 0);

  const rawColors = (currentConfig['filament_colour'] || '').split(';').map((c) => c.trim());
  const defaultColors = ['#16417C', '#58B957', '#F5D130', '#E53935', '#8E24AA', '#00ACC1', '#FB8C00', '#D81B60'];
  const slotCount = Math.max(1, selectedFilaments && selectedFilaments.length > 0 ? selectedFilaments.length : 1);
  const slotItems = Array.from({ length: slotCount }, (_, i) => ({
    ext: i + 1,
    name: selectedFilaments?.[i] || `Filament ${i + 1}`,
    color: rawColors[i] || defaultColors[i % defaultColors.length]
  }));

  useLayoutEffect(() => {
    if (!activeSubmenu || !submenuRef.current) return;
    const anchor = menuRef.current?.querySelector(`#menu-item-${activeSubmenu}`)?.getBoundingClientRect();
    if (!anchor) return;
    const submenu = submenuRef.current.getBoundingClientRect();
    setSubmenuPosition({
      left: Math.max(10, anchor.right + submenu.width <= window.innerWidth - 10 ? anchor.right : anchor.left - submenu.width),
      top: Math.max(10, Math.min(anchor.top, window.innerHeight - submenu.height - 10))
    });
  }, [activeSubmenu, slotCount]);

  // Portals keep flyouts outside the main menu's scrolling/clipping container.
  const submenuStyle: React.CSSProperties = {
    position: 'fixed', ...submenuPosition,
    maxHeight: window.innerHeight - 20, overflowY: 'auto',
    background: 'var(--panel-bg)', border: '1px solid var(--control-bg)',
    borderRadius: 6, boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    minWidth: 140, padding: '4px 0', zIndex: 10000,
    color: 'var(--text-color)', fontSize: '0.82rem', userSelect: 'none'
  };

  const handleAddVolume = (objId: number, type: VolumeType, shape: PrimitiveShape) => {
    if (onAddVolume) {
      onAddVolume(objId, type, shape);
    } else {
      void useObjectListStore.getState().addVolume({ objectId: objId, type, shape });
    }
  };

  const handleDelete = async () => {
    if (onDelete) {
      onDelete();
      return;
    }
    const plate = usePlateStore.getState();
    if (isMulti || plate.extraSelection.length > 0) {
      await plate.deleteSelected();
      await useObjectListStore.getState().refreshTree();
    } else if (isObject) {
      await useObjectListStore.getState().deleteObject(objectId);
    } else if (volumeId !== undefined) {
      await useObjectListStore.getState().deleteVolume(objectId, volumeId);
    }
  };

  const handleSetExtruder = async (ext: number) => {
    if (onSetExtruder) {
      onSetExtruder(ext);
      return;
    }
    const plate = usePlateStore.getState();
    if (isMulti || plate.extraSelection.length > 0) {
      const allIds = [plate.selectedObjectId, ...plate.extraSelection.map((s) => s.objectId)].filter(
        (id): id is number => id !== null
      );
      for (const id of new Set(allIds)) {
        await useObjectListStore.getState().setObjectExtruder(id, ext);
      }
    } else if (isObject) {
      await useObjectListStore.getState().setObjectExtruder(objectId, ext);
    } else if (volumeId !== undefined) {
      await useObjectListStore.getState().setVolumeExtruder(objectId, volumeId, ext);
    }
  };

  const handleRename = () => {
    if (onRename) {
      onRename();
      return;
    }
    const currentName = isObject ? (targetObj?.name ?? '') : (targetVol?.name ?? '');
    const next = typeof window !== 'undefined' && window.prompt ? window.prompt(t("Rename"), currentName) : null;
    if (next && next.trim()) {
      if (isObject) {
        void useObjectListStore.getState().renameObject(objectId, next.trim());
      } else if (volumeId !== undefined) {
        void useObjectListStore.getState().renameVolume(objectId, volumeId, next.trim());
      }
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && !submenuRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const shapes: { label: string; shape: PrimitiveShape }[] = [
    { label: t("Cube"), shape: 'cube' },
    { label: t("Cylinder"), shape: 'cylinder' },
    { label: t("Sphere"), shape: 'sphere' },
    { label: t("Cone"), shape: 'cone' },
    { label: t("Disc"), shape: 'disc' },
    { label: t("Torus"), shape: 'torus' },
    { label: t("Slab"), shape: 'slab' }
  ];

  const addVolumeCategories: { label: string; type: VolumeType }[] = [
    { label: t("Add Part"), type: 'part' },
    { label: t("Add Negative Part"), type: 'negative' },
    { label: t("Add Modifier"), type: 'modifier' },
    { label: t("Add Support Blocker"), type: 'support_blocker' },
    { label: t("Add Support Enforcer"), type: 'support_enforcer' }
  ];

  const renderExtruderMenuItem = () => {
    return (
      <div
        id="menu-item-extruder"
        data-testid="menu-item-extruder"
        onMouseEnter={() => setActiveSubmenu('extruder')}
        style={{
          position: 'relative',
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          background: activeSubmenu === 'extruder' ? 'rgba(255, 255, 255, 0.08)' : 'transparent'
        }}
      >
        <span>{t("Change Filament")}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>▶</span>

        {activeSubmenu === 'extruder' && createPortal(
          <div ref={submenuRef} id="submenu-extruder" data-testid="submenu-extruder" style={submenuStyle}>
            <div
              id="menu-action-extruder-0"
              data-testid="menu-action-extruder-0"
              onClick={() => {
                void handleSetExtruder(0);
                onClose();
              }}
              style={{
                padding: '6px 14px',
                cursor: 'pointer',
                fontWeight: effectiveExtruder === 0 ? 600 : 400
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {t("Default (Inherit)")}</div>
            {slotItems.map((slot) => (
              <div
                key={slot.ext}
                id={`menu-action-extruder-${slot.ext}`}
                data-testid={`menu-action-extruder-${slot.ext}`}
                onClick={() => {
                  void handleSetExtruder(slot.ext);
                  onClose();
                }}
                style={{
                  padding: '6px 14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: effectiveExtruder === slot.ext ? 600 : 400
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: slot.color,
                    flexShrink: 0
                  }}
                />
                <span>{t("Filament")}{slot.ext}</span>
              </div>
            ))}
          </div>, document.body
        )}
      </div>
    );
  };

  return (
    <div
      ref={menuRef}
      id="object-list-context-menu"
      data-testid="object-list-context-menu"
      onScroll={() => setActiveSubmenu(null)}
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 220),
        top: Math.max(10, Math.min(y, window.innerHeight - 550)),
        maxHeight: window.innerHeight - Math.max(10, Math.min(y, window.innerHeight - 550)) - 10,
        overflowY: 'auto',
        zIndex: 9999,
        background: 'var(--panel-bg)',
        border: '1px solid var(--control-bg)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
        minWidth: 180,
        padding: '4px 0',
        fontSize: '0.82rem',
        color: 'var(--text-color)',
        userSelect: 'none'
      }}
    >
      {isMulti ? (
        <>
          {renderExtruderMenuItem()}

          <div style={{ height: 1, background: 'var(--control-bg)', margin: '4px 0' }} />

          <div
            id="menu-action-duplicate"
            data-testid="menu-action-duplicate"
            onClick={async () => {
              await usePlateStore.getState().duplicateSelected();
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Clone")}
          </div>

          <div
            id="menu-action-lock-orientation"
            data-testid="menu-action-lock-orientation"
            onClick={() => {
              const plate = usePlateStore.getState();
              const allRefs = [
                { objectId: plate.selectedObjectId!, instanceId: plate.selectedInstanceId! },
                ...plate.extraSelection
              ];
              for (const ref of allRefs) {
                if (ref.instanceId !== undefined) {
                  plate.toggleOrientationLock(ref.instanceId);
                }
              }
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {(() => {
              const plate = usePlateStore.getState();
              const instId = plate.selectedInstanceId;
              return instId && plate.isOrientationLocked(instId) ? t("Unlock Orientation") : t("Lock Orientation");
            })()}
          </div>

          <div style={{ height: 1, background: 'var(--control-bg)', margin: '4px 0' }} />

          <div
            id="menu-action-delete"
            data-testid="menu-action-delete"
            onClick={async () => {
              await handleDelete();
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer', color: '#f87171' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Delete")}
          </div>
        </>
      ) : isObject ? (
        <>
          {addVolumeCategories.map((cat) => (
            <div
              key={cat.type}
              id={`menu-item-${cat.type}`}
              data-testid={`menu-item-${cat.type}`}
              onMouseEnter={() => setActiveSubmenu(cat.type)}
              style={{
                position: 'relative',
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                background: activeSubmenu === cat.type ? 'rgba(255, 255, 255, 0.08)' : 'transparent'
              }}
            >
              <span>{cat.label}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>▶</span>

              {activeSubmenu === cat.type && createPortal(
                <div ref={submenuRef} id={`submenu-${cat.type}`} data-testid={`submenu-${cat.type}`} style={submenuStyle}>
                  {shapes.map(({ label, shape }) => (
                    <div
                      key={shape}
                      id={`menu-action-${cat.type}-${shape}`}
                      data-testid={`menu-action-${cat.type}-${shape}`}
                      onClick={() => {
                        handleAddVolume(objectId, cat.type, shape);
                        onClose();
                      }}
                      style={{
                        padding: '6px 14px',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {label}
                    </div>
                  ))}
                </div>, document.body
              )}
            </div>
          ))}

          <div style={{ height: 1, background: 'var(--control-bg)', margin: '4px 0' }} />

          {renderExtruderMenuItem()}

          <div style={{ height: 1, background: 'var(--control-bg)', margin: '4px 0' }} />

          <div
            id="menu-action-cut"
            data-testid="menu-action-cut"
            onClick={async () => {
              usePaintToolsStore.getState().stopPainting();
              useLayersStore.getState().stopEditing();
              await useTextStore.getState().close();
              const plate = usePlateStore.getState();
              const instanceId = plate.objects.find((obj) => obj.id === objectId)?.instances[0]?.id ?? null;
              plate.selectObject(objectId, instanceId);
              const obj = plate.objects.find((o) => o.id === objectId);
              const height = obj?.size?.[2] ?? 20.0;
              useCutStore.getState().openCut(objectId, 0, height, height / 2);
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("✂️ Cut")}</div>

          <div
            id="menu-action-repair"
            data-testid="menu-action-repair"
            onClick={async () => {
              usePaintToolsStore.getState().stopPainting();
              useLayersStore.getState().stopEditing();
              useCutStore.getState().closeCut();
              await useTextStore.getState().close();
              const plate = usePlateStore.getState();
              const instanceId = plate.objects.find((obj) => obj.id === objectId)?.instances[0]?.id ?? null;
              plate.selectObject(objectId, instanceId);
              await useRepairStore.getState().selectObject(objectId);
              void useRepairStore.getState().repairSelected();
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("🔧 Repair Non-Manifold")}</div>

          <div
            id="menu-action-split-objects"
            data-testid="menu-action-split-objects"
            onClick={() => {
              void useEditOpsStore.getState().splitSelectedObject(objectId);
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Split to Objects")}</div>

          <div
            id="menu-action-split-parts"
            data-testid="menu-action-split-parts"
            onClick={() => {
              void useEditOpsStore.getState().splitSelectedVolume(objectId);
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Split to Parts")}</div>

          <div
            id="menu-action-simplify"
            data-testid="menu-action-simplify"
            onClick={() => {
              void useEditOpsStore.getState().openSimplifyDialog(objectId);
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Simplify...")}</div>

          <div style={{ height: 1, background: 'var(--control-bg)', margin: '4px 0' }} />

          <div
            id="menu-action-add-text"
            data-testid="menu-action-add-text"
            onClick={() => {
              useTextStore.getState().openForAdd(objectId);
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("🔤 Add 3D Text")}</div>

          <div style={{ height: 1, background: 'var(--control-bg)', margin: '4px 0' }} />

          {(['support', 'seam', 'color', 'fuzzy'] as const).map((layer) => (
            <div key={layer} id={`menu-action-paint-${layer}`}
              onClick={() => {
                const plate = usePlateStore.getState();
                const instanceId = plate.objects.find((obj) => obj.id === objectId)?.instances[0]?.id ?? null;
                plate.selectObject(objectId, instanceId);
                const volume = plate.meshCache.get(objectId)?.volumes?.[0]?.volumeId;
                usePaintToolsStore.getState().setLayer(layer);
                void usePaintToolsStore.getState().startPainting(objectId, volume, instanceId);
                onClose();
              }}
              style={{ padding: '6px 14px', cursor: 'pointer' }}>
              {`${layer[0].toUpperCase()}${layer.slice(1)} painting`}
            </div>
          ))}

          <div style={{ height: 1, background: 'var(--control-bg)', margin: '4px 0' }} />

          <div
            id="menu-action-rename"
            data-testid="menu-action-rename"
            onClick={() => {
              handleRename();
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Rename")}</div>

          <div id="menu-action-move-up" data-testid="menu-action-move-up" onClick={() => { const objs = useObjectListStore.getState().objects; const idx = objs.findIndex(o => o.id === objectId); if (idx > 0) useObjectListStore.getState().moveObject(objectId, idx - 1); onClose(); }} style={{ padding: "6px 14px", cursor: "pointer" }}>{t("Move Up")}</div>
          <div id="menu-action-move-down" data-testid="menu-action-move-down" onClick={() => { const objs = useObjectListStore.getState().objects; const idx = objs.findIndex(o => o.id === objectId); if (idx >= 0 && idx < objs.length - 1) useObjectListStore.getState().moveObject(objectId, idx + 1); onClose(); }} style={{ padding: "6px 14px", cursor: "pointer" }}>{t("Move Down")}</div>
          <div id="menu-action-lock-orientation" data-testid="menu-action-lock-orientation" onClick={() => { const plate = usePlateStore.getState(); const instId = (plate.selectedObjectId === objectId ? plate.selectedInstanceId : null) ?? plate.objects.find(o => o.id === objectId)?.instances[0]?.id; if (instId !== undefined) { plate.toggleOrientationLock(instId); } onClose(); }} style={{ padding: "6px 14px", cursor: "pointer" }}>{(() => { const plate = usePlateStore.getState(); const instId = (plate.selectedObjectId === objectId ? plate.selectedInstanceId : null) ?? plate.objects.find(o => o.id === objectId)?.instances[0]?.id; return instId && plate.isOrientationLocked(instId) ? t("Unlock Orientation") : t("Lock Orientation"); })()}</div>
          <div
            id="menu-action-delete"
            data-testid="menu-action-delete"
            onClick={async () => {
              await handleDelete();
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer', color: '#f87171' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Delete")}</div>
        </>
      ) : (
        <>
          {volumeId !== undefined && (
            <div
              id="menu-action-edit-text"
              data-testid="menu-action-edit-text"
              onClick={() => {
                void useTextStore.getState().openForEdit(objectId, volumeId);
                onClose();
              }}
              style={{ padding: '6px 14px', cursor: 'pointer' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {t("✏️ Edit 3D Text")}</div>
          )}

          <div
            id="menu-action-split-parts"
            data-testid="menu-action-split-parts"
            onClick={() => {
              void useEditOpsStore.getState().splitSelectedVolume(objectId, volumeId);
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Split to Parts")}</div>

          <div
            id="menu-action-simplify"
            data-testid="menu-action-simplify"
            onClick={() => {
              void useEditOpsStore.getState().openSimplifyDialog(objectId, volumeId);
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Simplify...")}</div>

          {renderExtruderMenuItem()}

          <div
            id="menu-action-rename-volume"
            data-testid="menu-action-rename-volume"
            onClick={() => {
              handleRename();
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Rename")}</div>

          <div id="menu-action-move-up-vol" data-testid="menu-action-move-up-vol" onClick={() => { const objs = useObjectListStore.getState().objects; const obj = objs.find(o => o.id === objectId); const idx = obj?.volumes?.findIndex(v => v.id === volumeId); if (idx !== undefined && idx > 0) useObjectListStore.getState().moveVolume(objectId, volumeId!, idx - 1); onClose(); }} style={{ padding: "6px 14px", cursor: "pointer" }}>{t("Move Up")}</div>
          <div id="menu-action-move-down-vol" data-testid="menu-action-move-down-vol" onClick={() => { const objs = useObjectListStore.getState().objects; const obj = objs.find(o => o.id === objectId); const idx = obj?.volumes?.findIndex(v => v.id === volumeId); if (idx !== undefined && obj?.volumes && idx < obj.volumes.length - 1) useObjectListStore.getState().moveVolume(objectId, volumeId!, idx + 1); onClose(); }} style={{ padding: "6px 14px", cursor: "pointer" }}>{t("Move Down")}</div>
          <div
            id="menu-action-delete-volume"
            data-testid="menu-action-delete-volume"
            onClick={async () => {
              await handleDelete();
              onClose();
            }}
            style={{ padding: '6px 14px', cursor: 'pointer', color: '#f87171' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {t("Delete")}</div>
        </>
      )}
    </div>
  );
};
