import React, { useState } from 'react';
import { usePlatesStore } from './platesStore';
import { useAppStore } from '../store/appStore';

export const PlateSelectorBar: React.FC = () => {
  const plates = usePlatesStore((s) => s.plates);
  const activePlateIndex = usePlatesStore((s) => s.activePlateIndex);
  const setActivePlate = usePlatesStore((s) => s.setActivePlate);
  const addPlate = usePlatesStore((s) => s.addPlate);
  const deletePlate = usePlatesStore((s) => s.deletePlate);
  const slicePlate = usePlatesStore((s) => s.slicePlate);
  const sliceAll = usePlatesStore((s) => s.sliceAll);

  const isSlicing = useAppStore((s) => s.isSlicing);

  const [sliceMenuOpen, setSliceMenuOpen] = useState(false);

  return (
    <div
      id="plate-selector-bar"
      data-testid="plate-selector-bar"
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(24, 24, 27, 0.9)',
        backdropFilter: 'blur(8px)',
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid rgba(255, 255, 255, 0.12)',
        zIndex: 20,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)'
      }}
    >
      {/* Plate Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {plates.map((plate) => {
          const isActive = plate.index === activePlateIndex;
          return (
            <div
              key={plate.index}
              id={`plate-tab-${plate.index}`}
              data-testid={`plate-tab-${plate.index}`}
              onClick={() => setActivePlate(plate.index)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 4,
                background: isActive ? '#009688' : 'rgba(255, 255, 255, 0.06)',
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                userSelect: 'none'
              }}
            >
              <span>{plate.name || `Plate ${plate.index + 1}`}</span>
              {plates.length > 1 && (
                <button
                  type="button"
                  id={`plate-delete-btn-${plate.index}`}
                  data-testid={`plate-delete-btn-${plate.index}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePlate(plate.index);
                  }}
                  title={`Delete ${plate.name}`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isActive ? '#fff' : 'rgba(255, 255, 255, 0.6)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    padding: '0 2px',
                    lineHeight: 1
                  }}
                >
                  &times;
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Plate Button */}
      <button
        type="button"
        id="add-plate-btn"
        data-testid="add-plate-btn"
        onClick={() => addPlate()}
        title="Add new plate"
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px dashed rgba(255, 255, 255, 0.25)',
          color: '#fff',
          borderRadius: 4,
          padding: '4px 10px',
          fontSize: '0.85rem',
          cursor: 'pointer',
          fontWeight: 500,
          transition: 'background 0.15s ease'
        }}
      >
        + Add Plate
      </button>

      {/* Vertical separator */}
      <div style={{ width: 1, height: 20, background: 'rgba(255, 255, 255, 0.15)', margin: '0 4px' }} />

      {/* Slice Menu */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          id="slice-plate-btn"
          data-testid="slice-plate-btn"
          disabled={isSlicing}
          onClick={() => slicePlate(activePlateIndex)}
          style={{
            background: '#2563eb',
            border: 'none',
            color: '#fff',
            borderRadius: '4px 0 0 4px',
            padding: '5px 12px',
            fontSize: '0.85rem',
            cursor: isSlicing ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            opacity: isSlicing ? 0.6 : 1
          }}
        >
          {isSlicing ? 'Slicing...' : `Slice Plate ${activePlateIndex + 1}`}
        </button>
        <button
          type="button"
          id="slice-menu-toggle-btn"
          data-testid="slice-menu-toggle-btn"
          disabled={isSlicing}
          onClick={() => setSliceMenuOpen(!sliceMenuOpen)}
          style={{
            background: '#1d4ed8',
            border: 'none',
            borderLeft: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#fff',
            borderRadius: '0 4px 4px 0',
            padding: '5px 8px',
            fontSize: '0.85rem',
            cursor: isSlicing ? 'not-allowed' : 'pointer'
          }}
        >
          &#9660;
        </button>

        {sliceMenuOpen && (
          <div
            id="slice-menu-dropdown"
            data-testid="slice-menu-dropdown"
            style={{
              position: 'absolute',
              bottom: '100%',
              right: 0,
              marginBottom: 6,
              background: '#27272a',
              borderRadius: 6,
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 140,
              overflow: 'hidden',
              zIndex: 30
            }}
          >
            <button
              type="button"
              id="slice-current-plate-btn"
              data-testid="slice-current-plate-btn"
              onClick={() => {
                setSliceMenuOpen(false);
                slicePlate(activePlateIndex);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              Slice Plate {activePlateIndex + 1}
            </button>
            <button
              type="button"
              id="slice-all-plates-btn"
              data-testid="slice-all-plates-btn"
              onClick={() => {
                setSliceMenuOpen(false);
                sliceAll();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              Slice All Plates
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
