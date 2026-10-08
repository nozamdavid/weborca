import React, { useState, useEffect, useRef } from 'react';
import type { PrimitiveShape, VolumeType } from './types';

export interface ContextMenuProps {
  x: number;
  y: number;
  isObject: boolean;
  objectId: number;
  volumeId?: number;
  volumeType?: VolumeType;
  currentExtruder?: number;
  onClose: () => void;
  onAddVolume: (objectId: number, type: VolumeType, shape: PrimitiveShape) => void;
  onRename: () => void;
  onDelete: () => void;
  onSetExtruder?: (extruder: number) => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  isObject,
  objectId,
  currentExtruder = 0,
  onClose,
  onAddVolume,
  onRename,
  onDelete,
  onSetExtruder
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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
    { label: 'Cube', shape: 'cube' },
    { label: 'Cylinder', shape: 'cylinder' },
    { label: 'Sphere', shape: 'sphere' },
    { label: 'Cone', shape: 'cone' }
  ];

  const addVolumeCategories: { label: string; type: VolumeType }[] = [
    { label: 'Add Part', type: 'part' },
    { label: 'Add Negative Part', type: 'negative' },
    { label: 'Add Modifier', type: 'modifier' },
    { label: 'Add Support Blocker', type: 'support_blocker' },
    { label: 'Add Support Enforcer', type: 'support_enforcer' }
  ];

  return (
    <div
      ref={menuRef}
      id="object-list-context-menu"
      data-testid="object-list-context-menu"
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 300),
        zIndex: 9999,
        background: '#27272a',
        border: '1px solid #3f3f46',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
        minWidth: 180,
        padding: '4px 0',
        fontSize: '0.82rem',
        color: '#e4e4e7',
        userSelect: 'none'
      }}
    >
      {isObject ? (
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
              <span style={{ fontSize: '0.7rem', color: '#a1a1aa' }}>▶</span>

              {activeSubmenu === cat.type && (
                <div
                  id={`submenu-${cat.type}`}
                  data-testid={`submenu-${cat.type}`}
                  style={{
                    position: 'absolute',
                    left: '100%',
                    top: 0,
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    borderRadius: 6,
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                    minWidth: 120,
                    padding: '4px 0',
                    zIndex: 10000
                  }}
                >
                  {shapes.map(({ label, shape }) => (
                    <div
                      key={shape}
                      id={`menu-action-${cat.type}-${shape}`}
                      data-testid={`menu-action-${cat.type}-${shape}`}
                      onClick={() => {
                        onAddVolume(objectId, cat.type, shape);
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
                </div>
              )}
            </div>
          ))}

          <div style={{ height: 1, background: '#3f3f46', margin: '4px 0' }} />

          <div
            id="menu-action-rename"
            data-testid="menu-action-rename"
            onClick={() => {
              onRename();
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
            Rename
          </div>

          <div
            id="menu-action-delete"
            data-testid="menu-action-delete"
            onClick={() => {
              onDelete();
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
            Delete
          </div>
        </>
      ) : (
        <>
          {onSetExtruder && (
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
              <span>Change Filament</span>
              <span style={{ fontSize: '0.7rem', color: '#a1a1aa' }}>▶</span>

              {activeSubmenu === 'extruder' && (
                <div
                  id="submenu-extruder"
                  data-testid="submenu-extruder"
                  style={{
                    position: 'absolute',
                    left: '100%',
                    top: 0,
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    borderRadius: 6,
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                    minWidth: 140,
                    padding: '4px 0',
                    zIndex: 10000
                  }}
                >
                  <div
                    id="menu-action-extruder-0"
                    data-testid="menu-action-extruder-0"
                    onClick={() => {
                      onSetExtruder(0);
                      onClose();
                    }}
                    style={{
                      padding: '6px 14px',
                      cursor: 'pointer',
                      fontWeight: currentExtruder === 0 ? 600 : 400
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    Default (Inherit)
                  </div>
                  {[1, 2, 3, 4].map((ext) => (
                    <div
                      key={ext}
                      id={`menu-action-extruder-${ext}`}
                      data-testid={`menu-action-extruder-${ext}`}
                      onClick={() => {
                        onSetExtruder(ext);
                        onClose();
                      }}
                      style={{
                        padding: '6px 14px',
                        cursor: 'pointer',
                        fontWeight: currentExtruder === ext ? 600 : 400
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      Filament {ext}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div
            id="menu-action-rename-volume"
            data-testid="menu-action-rename-volume"
            onClick={() => {
              onRename();
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
            Rename
          </div>

          <div
            id="menu-action-delete-volume"
            data-testid="menu-action-delete-volume"
            onClick={() => {
              onDelete();
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
            Delete
          </div>
        </>
      )}
    </div>
  );
};
