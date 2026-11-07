import React, { useLayoutEffect, useRef, useState } from 'react';
import { isDefaultPlateName, plateTitle } from './plateName';
import { PlateSettingsPopover } from './PlateSettingsPopover';
import { usePlatesStore } from './platesStore';
import { useAppStore } from '../store/appStore';
import { useTranslation } from "../i18n";
import { useSliceReadiness } from '../shell/sliceReadiness';

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
  const sliceDisabledReason = useSliceReadiness();
  const isBusy = useAppStore((s) => s.isSlicing || s.isModelLoading || !s.isEngineReady);

  const [sliceMenuOpen, setSliceMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ index: number; value: string } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tab = barRef.current?.querySelector<HTMLElement>(`#plate-tab-${activePlateIndex}`);
    const row = tab?.parentElement;
    if (!tab || !row) return;
    // Scroll only the tab row, without moving the canvas or surrounding sheet.
    if (tab.offsetLeft < row.scrollLeft) row.scrollLeft = tab.offsetLeft;
    else if (tab.offsetLeft + tab.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollLeft = tab.offsetLeft + tab.offsetWidth - row.clientWidth;
  }, [activePlateIndex, plates.length]);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const view = bar?.parentElement;
    if (!bar || !view) return;
    const reserveSpace = () => view.style.setProperty('--plate-actions-clearance', `${view.clientHeight - bar.offsetTop + 8}px`);
    reserveSpace();
    const observer = new ResizeObserver(reserveSpace);
    observer.observe(bar); observer.observe(view);
    return () => { observer.disconnect(); view.style.removeProperty('--plate-actions-clearance'); };
  }, []);

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
      ref={barRef}
      data-testid="plate-selector-bar"
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        // Sized to its content: with left:50% the browser would otherwise offer only the right half and squeeze the buttons.
        width: 'max-content',
        maxWidth: 'calc(100% - 24px)',
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(8px)',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid var(--border-color)',
        zIndex: 20,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        ...style
      }}
    >
      {/* Plate Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflowX: 'auto' }}>
        {plates.map((plate) => {
          const isActive = plate.index === activePlateIndex;
          return (
            <div
              key={plate.index}
              id={`plate-tab-${plate.index}`}
              data-testid={`plate-tab-${plate.index}`}
              role="button"
              tabIndex={isBusy ? -1 : 0}
              aria-pressed={isActive}
              aria-disabled={isBusy}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || isBusy) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActivePlate(plate.index);
                }
              }}
              onClick={() => { if (!isBusy) setActivePlate(plate.index); }}
              onDoubleClick={() => !isBusy && setRenaming({ index: plate.index, value: isDefaultPlateName(plate.name, plate.index) ? '' : plate.name })}
              title={t("Double-click to rename")}
              style={{
                display: 'flex',
                flexShrink: 0,
                alignItems: 'center',
                gap: 6,
                minHeight: 32,
                padding: '0 14px',
                borderRadius: 6,
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
          borderRadius: 6,
          minHeight: 32,
          padding: '0 14px',
          fontSize: '0.85rem',
          cursor: 'pointer',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          transition: 'background 0.15s ease'
        }}
      >
        {t("+ Add Plate")}</button>

      {/* Settings of the active plate */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          type="button" id="plate-settings-btn" data-testid="plate-settings-btn" aria-expanded={settingsOpen}
          disabled={isBusy}
          onClick={() => setSettingsOpen(!settingsOpen)} title={t("Settings of this plate")}
          style={{ background: settingsOpen ? 'var(--accent-color)' : 'var(--control-bg)', border: '1px solid var(--border-color)', color: settingsOpen ? '#fff' : 'var(--text-color)', borderRadius: 6, minHeight: 32, padding: '0 14px', fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {t("Plate settings")}</button>
        {settingsOpen && plates.find((p) => p.index === activePlateIndex) && <PlateSettingsPopover plate={plates.find((p) => p.index === activePlateIndex)!} />}
      </div>

      {/* Vertical separator */}
      <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 2px', flexShrink: 0 }} />

      {/* Slice Menu */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <button
          type="button"
          id="slice-plate-btn"
          data-testid="slice-plate-btn"
          disabled={!!sliceDisabledReason}
          title={t(sliceDisabledReason)}
          onClick={() => slicePlate(activePlateIndex)}
          style={{
            background: 'var(--accent-color, #009688)',
            border: 'none',
            color: '#fff',
            borderRadius: '6px 0 0 6px',
            minHeight: 32,
            padding: '0 16px',
            whiteSpace: 'nowrap',
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
          disabled={!!sliceDisabledReason}
          onClick={() => setSliceMenuOpen(!sliceMenuOpen)}
          style={{
            background: 'var(--accent-hover, #008172)',
            border: 'none',
            borderLeft: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#fff',
            borderRadius: '0 6px 6px 0',
            minHeight: 32,
            padding: '0 10px',
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
