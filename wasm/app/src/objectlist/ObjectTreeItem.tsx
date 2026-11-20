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
  const isObjectRenaming = renamingTarget === 'object';

  const getVolumeIcon = (type: VolumeType) => {
    switch (type) {
      case 'part':
        return <PartIcon size={14} className="object-tree-type-icon" />;
      case 'negative':
        return <NegativeIcon size={14} className="object-tree-type-icon" />;
      case 'modifier':
        return <ModifierIcon size={14} className="object-tree-type-icon" />;
      case 'support_blocker':
        return <SupportBlockerIcon size={14} className="object-tree-type-icon" />;
      case 'support_enforcer':
        return <SupportEnforcerIcon size={14} className="object-tree-type-icon" />;
      default:
        return <PartIcon size={14} className="object-tree-type-icon" />;
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

  const objectRowClasses = [
    'object-tree-row',
    'object-tree-row--object',
    isObjectSelected ? 'is-selected' : '',
    dropEdge === 'above' ? 'drop-above' : dropEdge === 'below' ? 'drop-below' : ''
  ].filter(Boolean).join(' ');

  return (
    <div className="object-tree-node">
      {/* Object Row */}
      <div
        id={`object-row-${object.id}${rowSuffix}`}
        data-testid={`object-row-${object.id}`}
        data-object-id={object.id}
        data-instance-ids={instanceIds?.join(',')}
        role="button"
        tabIndex={isObjectRenaming ? undefined : 0}
        aria-pressed={isObjectSelected}
        onClick={() => selectItem(object.id, null)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectItem(object.id, null);
          } else if (e.key === 'ArrowRight' && !isExpanded) {
            e.preventDefault();
            setIsExpanded(true);
          } else if (e.key === 'ArrowLeft' && isExpanded) {
            e.preventDefault();
            setIsExpanded(false);
          }
        }}
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
        className={objectRowClasses}
      >
        <button
          type="button"
          aria-label={t(isExpanded ? 'Collapse {{name}}' : 'Expand {{name}}', { name: object.name })}
          aria-expanded={isExpanded}
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className="object-tree-icon-btn"
        >
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <ObjectIcon size={15} className="object-tree-object-icon" />

        {isObjectRenaming ? (
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
            className="object-rename-input"
          />
        ) : (
          <span
            id={`object-name-${object.id}${rowSuffix}`}
            data-testid={`object-name-${object.id}`}
            className="object-tree-name object-tree-name--object"
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
              className="object-badge-extruder"
            >
              <span
                className="object-badge-swatch"
                style={{ backgroundColor: rawColors[effectiveExt - 1] || defaultColors[(effectiveExt - 1) % defaultColors.length] }}
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
            className="object-badge-overrides"
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
          className="object-tree-icon-btn"
        >
          <MoreDotsIcon size={14} />
        </button>
      </div>

      {/* Volumes Sub-tree */}
      {isExpanded && object.volumes && object.volumes.length > 0 && (
        <div className="object-tree-subtree">
          {object.volumes.map((vol) => {
            const isVolSelected = inSelectedGroup && selectedObjectId === object.id && selectedVolumeId === vol.id;
            const isVolRenaming = renamingTarget === vol.id;

            return (
              <div
                key={vol.id}
                id={`volume-row-${vol.id}${rowSuffix}`}
                data-testid={`volume-row-${vol.id}`}
                role="button"
                tabIndex={isVolRenaming ? undefined : 0}
                aria-pressed={isVolSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem(object.id, vol.id);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectItem(object.id, vol.id);
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, false, vol)}
                className={`object-tree-row object-tree-row--volume${isVolSelected ? ' is-selected' : ''}`}
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
                    className="object-rename-input"
                  />
                ) : (
                  <span
                    id={`volume-name-${vol.id}${rowSuffix}`}
                    data-testid={`volume-name-${vol.id}`}
                    className="object-tree-name"
                    onDoubleClick={() => handleStartRename(vol.id, vol.name)}
                  >
                    {vol.name}
                  </span>
                )}

                {vol.extruder > 0 && (
                  <span
                    id={`badge-extruder-${vol.id}${rowSuffix}`}
                    data-testid={`badge-extruder-${vol.id}`}
                    className="object-badge-extruder"
                  >
                    <span
                      className="object-badge-swatch"
                      style={{ backgroundColor: rawColors[vol.extruder - 1] || defaultColors[(vol.extruder - 1) % defaultColors.length] }}
                    />
                    E{vol.extruder}
                  </span>
                )}

                {vol.overrides && vol.overrides.length > 0 && (
                  <span
                    id={`badge-overrides-volume-${vol.id}${rowSuffix}`}
                    data-testid={`badge-overrides-volume-${vol.id}`}
                    title={`${vol.overrides.length} custom setting overrides`}
                    className="object-badge-overrides"
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
                  className="object-tree-icon-btn"
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
        <div className="object-tree-subtree">
          {/* Layers root header */}
          <div
            id={`layers-root-${object.id}${rowSuffix}`}
            data-testid={`layers-root-${object.id}`}
            onClick={(e) => {
              e.stopPropagation();
              selectItem(object.id, null, null);
            }}
            className="object-tree-row object-tree-row--layers-root"
          >
            <button
              type="button"
              aria-label={t(isLayersExpanded ? 'Collapse layers' : 'Expand layers')}
              aria-expanded={isLayersExpanded}
              onClick={(e) => {
                e.stopPropagation();
                setIsLayersExpanded(!isLayersExpanded);
              }}
              className="object-tree-icon-btn"
            >
              {isLayersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            <LayersIcon size={14} className="object-tree-type-icon" />

            <span className="object-tree-name object-tree-name--object">{t('Layers')}</span>

            <span className="object-badge-layers-count">
              {object.layerRanges.length}
            </span>

            <button
              type="button"
              id={`btn-add-layer-range-${object.id}${rowSuffix}`}
              data-testid={`btn-add-layer-range-${object.id}`}
              aria-label={t('Add layer range')}
              title={t('Add layer range')}
              onClick={(e) => {
                e.stopPropagation();
                void addLayerRange(object.id);
              }}
              className="object-tree-icon-btn object-tree-icon-btn--plus"
            >
              +
            </button>

            <button
              type="button"
              id={`btn-delete-layers-${object.id}${rowSuffix}`}
              data-testid={`btn-delete-layers-${object.id}`}
              aria-label={t('Delete all layer ranges')}
              title={t('Delete all layer ranges')}
              onClick={(e) => {
                e.stopPropagation();
                void deleteAllLayerRanges(object.id);
              }}
              className="object-tree-icon-btn object-tree-icon-btn--danger"
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
                role="button"
                tabIndex={0}
                aria-pressed={isRangeSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem(object.id, null, index);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectItem(object.id, null, index);
                  }
                }}
                className={`object-tree-row object-tree-row--range${isRangeSelected ? ' is-selected' : ''}`}
              >
                <span
                  id={`range-span-${index}`}
                  data-testid={`range-span-${index}`}
                  className="object-tree-range-span"
                >
                  {`${range.minZ.toFixed(2)} - ${range.maxZ.toFixed(2)} mm`}
                </span>

                {extNum > 0 && (
                  <span
                    id={`badge-extruder-range-${index}${rowSuffix}`}
                    className="object-badge-extruder"
                  >
                    <span
                      className="object-badge-swatch"
                      style={{ backgroundColor: rawColors[extNum - 1] || defaultColors[(extNum - 1) % defaultColors.length] }}
                    />
                    E{extNum}
                  </span>
                )}

                {overrideCount > 0 && (
                  <span
                    id={`badge-overrides-range-${index}${rowSuffix}`}
                    data-testid={`badge-overrides-range-${index}`}
                    title={`${overrideCount} custom setting overrides`}
                    className="object-badge-overrides"
                  >
                    {overrideCount}
                  </span>
                )}

                <button
                  type="button"
                  id={`btn-delete-range-${object.id}-${index}${rowSuffix}`}
                  data-testid={`btn-delete-range-${index}`}
                  aria-label={t('Delete layer range')}
                  title={t('Delete layer range')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteLayerRange(object.id, index);
                  }}
                  className="object-tree-icon-btn object-tree-icon-btn--danger"
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
