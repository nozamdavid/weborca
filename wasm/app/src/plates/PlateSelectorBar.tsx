import React, { useState } from 'react';
import { isDefaultPlateName, plateTitle } from './plateName';
import { PlateSettingsPopover } from './PlateSettingsPopover';
import { usePlatesStore } from './platesStore';
import { useAppStore } from '../store/appStore';
import { useTranslation } from "../i18n";

export const PlateSelectorBar: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
    const { t } = useTranslation();
  const plates = usePlatesStore((s) => s.plates);
  const activePlateIndex = usePlatesStore((s) => s.activePlateIndex);
  const setActivePlate = usePlatesStore((s) => s.setActivePlate);
  const addPlate = usePlatesStore((s) => s.addPlate);
  const deletePlate = usePlatesStore((s) => s.deletePlate);
  const setPlateConfig = usePlatesStore((s) => s.setPlateConfig);
  const slicePlate = usePlatesStore((s) => s.slicePlate);
  const sliceAll = usePlatesStore((s) => s.sliceAll);

  const isSlicing = useAppStore((s) => s.isSlicing);
  const isBusy = useAppStore((s) => s.isSlicing || s.isModelLoading || !s.isEngineReady);

  const [sliceMenuOpen, setSliceMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ index: number; value: string } | null>(null);

  // An empty title goes back to the default "Plate N".
  const commitRename = () => {
    if (!renaming) return;
    const { index, value } = renaming;
    setRenaming(null);
    const title = plateTitle(value, index);
    if (title !== plates.find((p) => p.index === index)?.name) void setPlateConfig(index, {}, isDefaultPlateName(title, index) ? '' : title);
  };

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
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(8px)',
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-color)',
        zIndex: 20,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        ...style
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
              onClick={() => { if (!isBusy) setActivePlate(plate.index); }}
              onDoubleClick={() => !isBusy && setRenaming({ index: plate.index, value: isDefaultPlateName(plate.name, plate.index) ? '' : plate.name })}
              title={t("Double-click to rename")}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 4,
                background: isActive ? 'var(--accent-color)' : 'var(--control-bg)',
                color: isActive ? '#fff' : 'var(--text-color)',
                fontSize: '0.85rem',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                userSelect: 'none',
                whiteSpace: 'nowrap'
              }}
            >
              <span
                id={`plate-number-${plate.index}`}
                style={{ minWidth: 18, height: 18, borderRadius: 9, background: 'rgba(0, 0, 0, 0.3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem' }}
              >
                {plate.index + 1}
              </span>
              {renaming?.index === plate.index ? (
                <input
                  id={`plate-name-input-${plate.index}`}
                  data-testid={`plate-name-input-${plate.index}`}
                  autoFocus
                  value={renaming.value}
                  onChange={(e) => setRenaming({ index: plate.index, value: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  style={{ width: 110, background: 'var(--control-bg)', color: 'var(--text-color)', border: '1px solid var(--input-border)', borderRadius: 3, padding: '1px 4px', fontSize: '0.85rem' }}
                />
              ) : (
                <span id={`plate-name-${plate.index}`}>{plateTitle(plate.name, plate.index)}</span>
              )}
              {plates.length > 1 && (
                <button
                  type="button"
                  id={`plate-delete-btn-${plate.index}`}
                  data-testid={`plate-delete-btn-${plate.index}`}
                  disabled={isBusy}
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePlate(plate.index);
                  }}
                  title={`Delete ${plateTitle(plate.name, plate.index)}`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isActive ? '#fff' : 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    padding: '0 2px',
                    lineHeight: 1
                  }}
                >
                  ×</button>
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
        disabled={isBusy}
        onClick={() => addPlate()}
        title={t("Add new plate")}
        style={{
          background: 'var(--control-bg)',
          border: '1px dashed var(--border-color)',
          color: 'var(--text-color)',
          borderRadius: 4,
          padding: '4px 10px',
          fontSize: '0.85rem',
          cursor: 'pointer',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          transition: 'background 0.15s ease'
        }}
      >
        {t("+ Add Plate")}</button>

      {/* Settings of the active plate */}
      <div style={{ position: 'relative' }}>
        <button
          type="button" id="plate-settings-btn" data-testid="plate-settings-btn" aria-expanded={settingsOpen}
          disabled={isBusy}
          onClick={() => setSettingsOpen(!settingsOpen)} title={t("Settings of this plate")}
          style={{ background: settingsOpen ? 'var(--accent-color)' : 'var(--control-bg)', border: '1px solid var(--border-color)', color: settingsOpen ? '#fff' : 'var(--text-color)', borderRadius: 4, padding: '4px 10px', fontSize: '0.85rem', cursor: 'pointer' }}
        >
          {t("Plate settings")}</button>
        {settingsOpen && plates.find((p) => p.index === activePlateIndex) && <PlateSettingsPopover plate={plates.find((p) => p.index === activePlateIndex)!} />}
      </div>

      {/* Vertical separator */}
      <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 4px' }} />

      {/* Slice Menu */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          id="slice-plate-btn"
          data-testid="slice-plate-btn"
          disabled={isBusy}
          onClick={() => slicePlate(activePlateIndex)}
          style={{
            background: 'var(--accent-color, #009688)',
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
          {isSlicing ? t("Slicing...") : t("Slice Plate {{number}}", { number: activePlateIndex + 1 })}
        </button>
        <button
          type="button"
          id="slice-menu-toggle-btn"
          data-testid="slice-menu-toggle-btn"
          disabled={isBusy}
          onClick={() => setSliceMenuOpen(!sliceMenuOpen)}
          style={{
            background: 'var(--accent-hover, #008172)',
            border: 'none',
            borderLeft: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#fff',
            borderRadius: '0 4px 4px 0',
            padding: '5px 8px',
            fontSize: '0.85rem',
            cursor: isSlicing ? 'not-allowed' : 'pointer'
          }}
        >
          ▼</button>

        {sliceMenuOpen && (
          <div
            id="slice-menu-dropdown"
            data-testid="slice-menu-dropdown"
            style={{
              position: 'absolute',
              bottom: '100%',
              right: 0,
              marginBottom: 6,
              background: 'var(--panel-bg)',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
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
              disabled={isBusy}
              onClick={() => {
                setSliceMenuOpen(false);
                slicePlate(activePlateIndex);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-color)',
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              {t("Slice Plate {{number}}", { number: activePlateIndex + 1 })}
            </button>
            <button
              type="button"
              id="slice-all-plates-btn"
              data-testid="slice-all-plates-btn"
              disabled={isBusy}
              onClick={() => {
                setSliceMenuOpen(false);
                sliceAll();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border-color)',
                color: 'var(--text-color)',
                padding: '8px 12px',
                textAlign: 'left',
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              {t("Slice All Plates")}</button>
          </div>
        )}
      </div>
    </div>
  );
};
