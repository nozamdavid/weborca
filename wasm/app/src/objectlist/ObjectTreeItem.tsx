import React, { useState } from 'react';
import {
  ObjectIcon,
  PartIcon,
  NegativeIcon,
  ModifierIcon,
  SupportBlockerIcon,
  SupportEnforcerIcon,
  ChevronDown,
  ChevronRight,
  MoreDotsIcon,
  LayersIcon,
  TrashIcon
} from './Icons';
import { useTranslation } from '../i18n';
import { ContextMenu } from './ContextMenu';
import { useObjectListStore } from './objectListStore';
import { useAppStore } from '../store/appStore';
import { usePlateStore } from '../plate/plateStore';
import { usePlatesStore } from '../plates/platesStore';
import type { ObjectTreeNode, VolumeTreeNode, VolumeType, PrimitiveShape } from './types';

const DRAG_TYPE = 'application/x-orca-object';

interface ObjectTreeItemProps {
  object: ObjectTreeNode;
  /** Objects of the same plate group; reordering is only accepted between these. */
  groupIds?: number[];
  groupKey?: string;
  primaryGroup?: boolean;
  plateIndex?: number | null;
  instanceIds?: number[];
}

export const ObjectTreeItem: React.FC<ObjectTreeItemProps> = ({ object, groupIds, groupKey, primaryGroup = true, plateIndex, instanceIds }) => {
  const rowSuffix = primaryGroup ? '' : `-group-${groupKey}`;
  const { t } = useTranslation();
  const {
    selectedObjectId,
    selectedVolumeId,
    selectedRangeIndex,
    selectItem: selectLogicalItem,
    addVolume,
    deleteVolume,
    deleteObject,
    moveObject,
    renameObject,
    renameVolume,
    setVolumeExtruder,
    setObjectExtruder,
    addLayerRange,
    deleteLayerRange,
    deleteAllLayerRanges
  } = useObjectListStore();
  const selectedInstanceId = usePlateStore((s) => s.selectedInstanceId);
  const inSelectedGroup = !instanceIds || instanceIds.includes(selectedInstanceId ?? -1);
  const selectItem = (objectId: number, volumeId: number | null, rangeIndex: number | null = null) => {
    if (plateIndex !== undefined && plateIndex !== null) usePlatesStore.getState().setActivePlate(plateIndex);
    if (instanceIds?.length) {
      usePlateStore.getState().selectObject(objectId, inSelectedGroup ? selectedInstanceId : instanceIds[0]);
    }
    selectLogicalItem(objectId, volumeId, rangeIndex);
  };

  const currentConfig = useAppStore((s) => s.currentConfig);
  const rawColors = (currentConfig['filament_colour'] || '').split(';').map((c) => c.trim());
  const defaultColors = ['#16417C', '#58B957', '#F5D130', '#E53935', '#8E24AA', '#00ACC1', '#FB8C00', '#D81B60'];

  const [isExpanded, setIsExpanded] = useState(true);
  const [isLayersExpanded, setIsLayersExpanded] = useState(true);
  const [dropEdge, setDropEdge] = useState<'above' | 'below' | null>(null);
  const [renamingTarget, setRenamingTarget] = useState<'object' | number | null>(null);
  const [editName, setEditName] = useState('');

  // Context menu state
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    isObject: boolean;
    volume?: VolumeTreeNode;
    isMulti?: boolean;
  } | null>(null);

  const isObjectSelected = inSelectedGroup && selectedObjectId === object.id && selectedVolumeId === null && selectedRangeIndex === null;

  const getVolumeIcon = (type: VolumeType) => {
    switch (type) {
      case 'part':
        return <PartIcon size={14} />;
      case 'negative':
        return <NegativeIcon size={14} />;
      case 'modifier':
        return <ModifierIcon size={14} />;
      case 'support_blocker':
        return <SupportBlockerIcon size={14} />;
      case 'support_enforcer':
        return <SupportEnforcerIcon size={14} />;
      default:
        return <PartIcon size={14} />;
    }
  };

  const handleContextMenu = (e: React.MouseEvent, isObject: boolean, volume?: VolumeTreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    const plateState = usePlateStore.getState();
    const allRefs = [
      ...(plateState.selectedObjectId !== null && plateState.selectedInstanceId !== null
        ? [{ objectId: plateState.selectedObjectId, instanceId: plateState.selectedInstanceId }]
        : []),
      ...plateState.extraSelection
    ];
    const isMultiSelection = allRefs.length >= 2;
    const isObjectInSelection = allRefs.some((r) => r.objectId === object.id);

    if (isObject && isMultiSelection && isObjectInSelection) {
      setContextMenuState({
        x: e.clientX,
        y: e.clientY,
        isObject: true,
        volume: undefined,
        isMulti: true
      });
      return;
    }

    if (isObject) {
      selectItem(object.id, null);
    } else if (volume) {
      selectItem(object.id, volume.id);
    }
    setContextMenuState({
      x: e.clientX,
      y: e.clientY,
      isObject,
      volume,
      isMulti: false
    });
  };

  const handleStartRename = (target: 'object' | number, currentName: string) => {
    setRenamingTarget(target);
    setEditName(currentName);
  };

  const handleFinishRename = async () => {
    if (!editName.trim()) {
      setRenamingTarget(null);
      return;
    }
    if (renamingTarget === 'object') {
      await renameObject(object.id, editName.trim());
    } else if (typeof renamingTarget === 'number') {
      await renameVolume(object.id, renamingTarget, editName.trim());
    }
    setRenamingTarget(null);
  };

  return (
    <div className="object-tree-node" style={{ marginBottom: 2 }}>
      {/* Object Row */}
      <div
        id={`object-row-${object.id}${rowSuffix}`}
        data-testid={`object-row-${object.id}`}
        data-object-id={object.id}
        data-instance-ids={instanceIds?.join(',')}
        onClick={() => selectItem(object.id, null)}
        onContextMenu={(e) => handleContextMenu(e, true)}
        draggable={renamingTarget === null}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, String(object.id));
          e.dataTransfer.setData(`${DRAG_TYPE}-group`, groupKey ?? '');
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          setDropEdge(e.clientY < box.top + box.height / 2 ? 'above' : 'below');
        }}
        onDragLeave={() => setDropEdge(null)}
        onDrop={(e) => {
          const edge = dropEdge;
          setDropEdge(null);
          const dragged = Number(e.dataTransfer.getData(DRAG_TYPE));
          if (!e.dataTransfer.types.includes(DRAG_TYPE) || !edge || dragged === object.id || (groupIds && !groupIds.includes(dragged)) || e.dataTransfer.getData(`${DRAG_TYPE}-group`) !== (groupKey ?? '')) return;
          e.preventDefault();
          const order = useObjectListStore.getState().objects.map((o) => o.id).filter((id) => id !== dragged);
          void moveObject(dragged, order.indexOf(object.id) + (edge === 'below' ? 1 : 0));
        }}
        style={{
          boxShadow: dropEdge === 'above' ? '0 -2px 0 0 #009688' : dropEdge === 'below' ? '0 2px 0 0 #009688' : undefined,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          borderRadius: 4,
          background: isObjectSelected ? 'rgba(0, 150, 136, 0.25)' : 'transparent',
          border: isObjectSelected ? '1px solid rgba(0, 150, 136, 0.4)' : '1px solid transparent',
          cursor: 'pointer',
          color: 'var(--text-color)',
          fontSize: '0.82rem',
          userSelect: 'none'
        }}
        onMouseEnter={(e) => {
          if (!isObjectSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
        }}
        onMouseLeave={(e) => {
          if (!isObjectSelected) e.currentTarget.style.background = 'transparent';
        }}
      >
        <button
          type="button"
          aria-label={t(isExpanded ? 'Collapse {{name}}' : 'Expand {{name}}', { name: object.name })}
          aria-expanded={isExpanded}
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <ObjectIcon size={15} className="text-zinc-400" />

        {renamingTarget === 'object' ? (
          <input
            type="text"
            id={`rename-input-object-${object.id}${rowSuffix}`}
            data-testid={`rename-input-object-${object.id}`}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleFinishRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFinishRename();
              if (e.key === 'Escape') setRenamingTarget(null);
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
            style={{
              flex: 1,
              background: 'var(--canvas-bg)',
              border: '1px solid #009688',
              borderRadius: 3,
              color: '#fff',
              fontSize: '0.8rem',
              padding: '2px 4px',
              outline: 'none'
            }}
          />
        ) : (
          <span
            id={`object-name-${object.id}${rowSuffix}`}
            data-testid={`object-name-${object.id}`}
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: 500
            }}
            onDoubleClick={() => handleStartRename('object', object.name)}
          >
            {object.name}
          </span>
        )}

        {(() => {
          const objExt = parseInt(object.config?.extruder || '0', 10) || 0;
          const allSameExt = object.volumes && object.volumes.length > 0 && object.volumes.every(v => v.extruder === object.volumes[0].extruder) ? object.volumes[0].extruder : 0;
          const effectiveExt = allSameExt > 0 ? allSameExt : objExt;
          if (effectiveExt <= 0) return null;
          return (
            <span
              id={`badge-extruder-object-${object.id}${rowSuffix}`}
              data-testid={`badge-extruder-object-${object.id}`}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'var(--text-muted)',
                fontSize: '0.65rem',
                padding: '1px 4px',
                borderRadius: 4,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: rawColors[effectiveExt - 1] || defaultColors[(effectiveExt - 1) % defaultColors.length]
                }}
              />
              E{effectiveExt}
            </span>
          );
        })()}

        {object.overrides && object.overrides.length > 0 && (
          <span
            id={`badge-overrides-object-${object.id}${rowSuffix}`}
            data-testid={`badge-overrides-object-${object.id}`}
            title={`${object.overrides.length} custom setting overrides`}
            style={{
              background: '#009688',
              color: '#fff',
              fontSize: '0.65rem',
              padding: '1px 5px',
              borderRadius: 8,
              fontWeight: 600
            }}
          >
            {object.overrides.length}
          </span>
        )}

        <button
          type="button"
          id={`object-more-btn-${object.id}${rowSuffix}`}
          aria-label={t('Object actions for {{name}}', { name: object.name })}
          aria-haspopup="menu"
          aria-expanded={!!contextMenuState?.isObject}
          data-testid={`object-more-btn-${object.id}`}
          onClick={(e) => handleContextMenu(e, true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            padding: 2,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          <MoreDotsIcon size={14} />
        </button>
      </div>

      {/* Volumes Sub-tree */}
      {isExpanded && object.volumes && object.volumes.length > 0 && (
        <div style={{ paddingLeft: 20, marginTop: 2 }}>
          {object.volumes.map((vol) => {
            const isVolSelected = inSelectedGroup && selectedObjectId === object.id && selectedVolumeId === vol.id;
            const isVolRenaming = renamingTarget === vol.id;

            return (
              <div
                key={vol.id}
                id={`volume-row-${vol.id}${rowSuffix}`}
                data-testid={`volume-row-${vol.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem(object.id, vol.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, false, vol)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: isVolSelected ? 'rgba(0, 150, 136, 0.25)' : 'transparent',
                  border: isVolSelected ? '1px solid rgba(0, 150, 136, 0.4)' : '1px solid transparent',
                  cursor: 'pointer',
                  color: 'var(--text-color)',
                  fontSize: '0.78rem',
                  userSelect: 'none',
                  marginTop: 1
                }}
                onMouseEnter={(e) => {
                  if (!isVolSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                }}
                onMouseLeave={(e) => {
                  if (!isVolSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                {getVolumeIcon(vol.type)}

                {isVolRenaming ? (
                  <input
                    type="text"
                    id={`rename-input-volume-${vol.id}${rowSuffix}`}
                    data-testid={`rename-input-volume-${vol.id}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleFinishRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFinishRename();
                      if (e.key === 'Escape') setRenamingTarget(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    style={{
                      flex: 1,
                      background: 'var(--canvas-bg)',
                      border: '1px solid #009688',
                      borderRadius: 3,
                      color: '#fff',
                      fontSize: '0.75rem',
                      padding: '1px 4px',
                      outline: 'none'
                    }}
                  />
                ) : (
                  <span
                    id={`volume-name-${vol.id}${rowSuffix}`}
                    data-testid={`volume-name-${vol.id}`}
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    onDoubleClick={() => handleStartRename(vol.id, vol.name)}
                  >
                    {vol.name}
                  </span>
                )}

                {vol.extruder > 0 && (
                  <span
                    id={`badge-extruder-${vol.id}${rowSuffix}`}
                    data-testid={`badge-extruder-${vol.id}`}
                    style={{
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: 'var(--text-muted)',
                      fontSize: '0.65rem',
                      padding: '1px 4px',
                      borderRadius: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: rawColors[vol.extruder - 1] || defaultColors[(vol.extruder - 1) % defaultColors.length]
                      }}
                    />
                    E{vol.extruder}
                  </span>
                )}

                {vol.overrides && vol.overrides.length > 0 && (
                  <span
                    id={`badge-overrides-volume-${vol.id}${rowSuffix}`}
                    data-testid={`badge-overrides-volume-${vol.id}`}
                    title={`${vol.overrides.length} custom setting overrides`}
                    style={{
                      background: '#009688',
                      color: '#fff',
                      fontSize: '0.65rem',
                      padding: '1px 4px',
                      borderRadius: 8,
                      fontWeight: 600
                    }}
                  >
                    {vol.overrides.length}
                  </span>
                )}

                <button
                  type="button"
                  id={`volume-more-btn-${vol.id}${rowSuffix}`}
                  aria-label={t('Volume actions for {{name}}', { name: vol.name })}
                  aria-haspopup="menu"
                  aria-expanded={contextMenuState?.volume?.id === vol.id}
                  data-testid={`volume-more-btn-${vol.id}`}
                  onClick={(e) => handleContextMenu(e, false, vol)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    padding: 2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
                >
                  <MoreDotsIcon size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Height Ranges (Layers) Sub-tree */}
      {isExpanded && object.layerRanges && object.layerRanges.length > 0 && (
        <div style={{ paddingLeft: 20, marginTop: 2 }}>
          {/* Layers root header */}
          <div
            id={`layers-root-${object.id}${rowSuffix}`}
            data-testid={`layers-root-${object.id}`}
            onClick={(e) => {
              e.stopPropagation();
              selectItem(object.id, null, null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 4,
              background: 'transparent',
              border: '1px solid transparent',
              cursor: 'pointer',
              color: 'var(--text-color)',
              fontSize: '0.78rem',
              userSelect: 'none',
              marginTop: 1
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsLayersExpanded(!isLayersExpanded);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {isLayersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            <LayersIcon size={14} />

            <span style={{ flex: 1, fontWeight: 500 }}>{t('Layers')}</span>

            <span
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: 'var(--text-muted)',
                fontSize: '0.65rem',
                padding: '1px 5px',
                borderRadius: 8,
                fontWeight: 600
              }}
            >
              {object.layerRanges.length}
            </span>

            <button
              type="button"
              id={`btn-add-layer-range-${object.id}${rowSuffix}`}
              data-testid={`btn-add-layer-range-${object.id}`}
              title={t('Add layer range')}
              onClick={(e) => {
                e.stopPropagation();
                void addLayerRange(object.id);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                padding: '1px 4px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 'bold',
                lineHeight: 1
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              +
            </button>

            <button
              type="button"
              id={`btn-delete-layers-${object.id}${rowSuffix}`}
              data-testid={`btn-delete-layers-${object.id}`}
              title={t('Delete all layer ranges')}
              onClick={(e) => {
                e.stopPropagation();
                void deleteAllLayerRanges(object.id);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                padding: 2,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              <TrashIcon size={12} />
            </button>
          </div>

          {/* Child Layer Range rows */}
          {isLayersExpanded && object.layerRanges.map((range, index) => {
            const isRangeSelected = inSelectedGroup && selectedObjectId === object.id && selectedRangeIndex === index;
            const extNum = parseInt(range.config?.extruder || '0', 10);
            const overrideCount = Object.keys(range.config || {}).length;

            return (
              <div
                key={index}
                id={`layer-range-row-${index}`}
                data-testid={`layer-range-row-${index}`}
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem(object.id, null, index);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px 4px 20px',
                  borderRadius: 4,
                  background: isRangeSelected ? 'rgba(0, 150, 136, 0.25)' : 'transparent',
                  border: isRangeSelected ? '1px solid rgba(0, 150, 136, 0.4)' : '1px solid transparent',
                  cursor: 'pointer',
                  color: 'var(--text-color)',
                  fontSize: '0.78rem',
                  userSelect: 'none',
                  marginTop: 1
                }}
                onMouseEnter={(e) => {
                  if (!isRangeSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                }}
                onMouseLeave={(e) => {
                  if (!isRangeSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  id={`range-span-${index}`}
                  data-testid={`range-span-${index}`}
                  style={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {`${range.minZ.toFixed(2)} - ${range.maxZ.toFixed(2)} mm`}
                </span>

                {extNum > 0 && (
                  <span
                    id={`badge-extruder-range-${index}${rowSuffix}`}
                    style={{
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: 'var(--text-muted)',
                      fontSize: '0.65rem',
                      padding: '1px 4px',
                      borderRadius: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: rawColors[extNum - 1] || defaultColors[(extNum - 1) % defaultColors.length]
                      }}
                    />
                    E{extNum}
                  </span>
                )}

                {overrideCount > 0 && (
                  <span
                    id={`badge-overrides-range-${index}${rowSuffix}`}
                    data-testid={`badge-overrides-range-${index}`}
                    title={`${overrideCount} custom setting overrides`}
                    style={{
                      background: '#009688',
                      color: '#fff',
                      fontSize: '0.65rem',
                      padding: '1px 4px',
                      borderRadius: 8,
                      fontWeight: 600
                    }}
                  >
                    {overrideCount}
                  </span>
                )}

                <button
                  type="button"
                  id={`btn-delete-range-${object.id}-${index}${rowSuffix}`}
                  data-testid={`btn-delete-range-${index}`}
                  title={t('Delete layer range')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteLayerRange(object.id, index);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    padding: 2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
                >
                  <TrashIcon size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

            {/* Context Menu Modal */}
      {contextMenuState && (
        <ContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          isObject={contextMenuState.isObject}
          objectId={object.id}
          groupIds={groupIds}
          volumeId={contextMenuState.volume?.id}
          isMulti={contextMenuState.isMulti}
          volumeType={contextMenuState.volume?.type}
          currentExtruder={
            contextMenuState.isObject
              ? (parseInt(object.config?.extruder || '0', 10) || (object.volumes?.[0]?.extruder || 0))
              : (contextMenuState.volume?.extruder || 0)
          }
          onClose={() => setContextMenuState(null)}
          onAddVolume={(objId: number, type: VolumeType, shape: PrimitiveShape) => {
            addVolume({ objectId: objId, type, shape });
          }}
          onRename={() => {
            if (contextMenuState.isObject) {
              handleStartRename('object', object.name);
            } else if (contextMenuState.volume) {
              handleStartRename(contextMenuState.volume.id, contextMenuState.volume.name);
            }
          }}
          onDelete={() => {
            if (contextMenuState.isObject) {
              deleteObject(object.id);
            } else if (contextMenuState.volume) {
              deleteVolume(object.id, contextMenuState.volume.id);
            }
          }}
          onSetExtruder={(ext: number) => {
            if (contextMenuState.isObject) {
              setObjectExtruder(object.id, ext);
            } else if (contextMenuState.volume) {
              setVolumeExtruder(object.id, contextMenuState.volume!.id, ext);
            }
          }}
        />
      )}
    </div>
  );
};
