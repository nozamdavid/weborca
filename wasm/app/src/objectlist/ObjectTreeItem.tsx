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
  MoreDotsIcon
} from './Icons';
import { ContextMenu } from './ContextMenu';
import { useObjectListStore } from './objectListStore';
import { useAppStore } from '../store/appStore';
import type { ObjectTreeNode, VolumeTreeNode, VolumeType, PrimitiveShape } from './types';

const DRAG_TYPE = 'application/x-orca-object';

interface ObjectTreeItemProps {
  object: ObjectTreeNode;
}

export const ObjectTreeItem: React.FC<ObjectTreeItemProps> = ({ object }) => {
  const {
    selectedObjectId,
    selectedVolumeId,
    selectItem,
    addVolume,
    deleteVolume,
    deleteObject,
    moveObject,
    renameObject,
    renameVolume,
    setVolumeExtruder,
    setObjectExtruder
  } = useObjectListStore();

  const currentConfig = useAppStore((s) => s.currentConfig);
  const rawColors = (currentConfig['filament_colour'] || '').split(';').map((c) => c.trim());
  const defaultColors = ['#16417C', '#58B957', '#F5D130', '#E53935', '#8E24AA', '#00ACC1', '#FB8C00', '#D81B60'];

  const [isExpanded, setIsExpanded] = useState(true);
  const [dropEdge, setDropEdge] = useState<'above' | 'below' | null>(null);
  const [renamingTarget, setRenamingTarget] = useState<'object' | number | null>(null);
  const [editName, setEditName] = useState('');

  // Context menu state
  const [contextMenuState, setContextMenuState] = useState<{
    x: number;
    y: number;
    isObject: boolean;
    volume?: VolumeTreeNode;
  } | null>(null);

  const isObjectSelected = selectedObjectId === object.id && selectedVolumeId === null;

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
    if (isObject) {
      selectItem(object.id, null);
    } else if (volume) {
      selectItem(object.id, volume.id);
    }
    setContextMenuState({
      x: e.clientX,
      y: e.clientY,
      isObject,
      volume
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
        id={`object-row-${object.id}`}
        data-testid={`object-row-${object.id}`}
        onClick={() => selectItem(object.id, null)}
        onContextMenu={(e) => handleContextMenu(e, true)}
        draggable={renamingTarget === null}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, String(object.id));
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
          if (!e.dataTransfer.types.includes(DRAG_TYPE) || !edge || dragged === object.id) return;
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
          color: '#f4f4f5',
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
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#a1a1aa',
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
            id={`rename-input-object-${object.id}`}
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
              background: '#18181b',
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
            id={`object-name-${object.id}`}
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
              id={`badge-extruder-object-${object.id}`}
              data-testid={`badge-extruder-object-${object.id}`}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                color: '#a1a1aa',
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
            id={`badge-overrides-object-${object.id}`}
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
          id={`object-more-btn-${object.id}`}
          data-testid={`object-more-btn-${object.id}`}
          onClick={(e) => handleContextMenu(e, true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#71717a',
            padding: 2,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#71717a')}
        >
          <MoreDotsIcon size={14} />
        </button>
      </div>

      {/* Volumes Sub-tree */}
      {isExpanded && object.volumes && object.volumes.length > 0 && (
        <div style={{ paddingLeft: 20, marginTop: 2 }}>
          {object.volumes.map((vol) => {
            const isVolSelected = selectedObjectId === object.id && selectedVolumeId === vol.id;
            const isVolRenaming = renamingTarget === vol.id;

            return (
              <div
                key={vol.id}
                id={`volume-row-${vol.id}`}
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
                  color: '#e4e4e7',
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
                    id={`rename-input-volume-${vol.id}`}
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
                      background: '#18181b',
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
                    id={`volume-name-${vol.id}`}
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
                    id={`badge-extruder-${vol.id}`}
                    data-testid={`badge-extruder-${vol.id}`}
                    style={{
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: '#a1a1aa',
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
                    id={`badge-overrides-volume-${vol.id}`}
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
                  id={`volume-more-btn-${vol.id}`}
                  data-testid={`volume-more-btn-${vol.id}`}
                  onClick={(e) => handleContextMenu(e, false, vol)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#71717a',
                    padding: 2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#71717a')}
                >
                  <MoreDotsIcon size={14} />
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
          volumeId={contextMenuState.volume?.id}
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
