import React, { useLayoutEffect, useRef, useState } from 'react';
import { isDefaultPlateName, plateTitle } from './plateName';
import { PlateSettingsPopover } from './PlateSettingsPopover';
import { usePlatesStore } from './platesStore';
import { useAppStore } from '../store/appStore';
import { useTranslation } from "../i18n";
import { useSliceReadiness } from '../shell/sliceReadiness';
import './PlateSelectorBar.css';

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
      style={style}
    >
      {/* Plate Tabs */}
      <div className="plate-tabs-row">
        {plates.map((plate) => {
          const isActive = plate.index === activePlateIndex;
          return (
            <div
              key={plate.index}
              id={`plate-tab-${plate.index}`}
              data-testid={`plate-tab-${plate.index}`}
              className="plate-tab"
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
            >
              <span
                id={`plate-number-${plate.index}`}
                className="plate-number"
              >
                {plate.index + 1}
              </span>
              {renaming?.index === plate.index ? (
                <input
                  id={`plate-name-input-${plate.index}`}
                  data-testid={`plate-name-input-${plate.index}`}
                  className="plate-name-input"
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
                />
              ) : (
                <span id={`plate-name-${plate.index}`}>{plateTitle(plate.name, plate.index)}</span>
              )}
              {plates.length > 1 && (
                <button
                  type="button"
                  id={`plate-delete-btn-${plate.index}`}
                  data-testid={`plate-delete-btn-${plate.index}`}
                  className="plate-delete-btn"
                  disabled={isBusy}
                  onClick={(e) => {
                    e.stopPropagation();
                    deletePlate(plate.index);
                  }}
                  title={`Delete ${plateTitle(plate.name, plate.index)}`}
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
      >
        {t("+ Add Plate")}</button>

      {/* Settings of the active plate */}
      <div className="plate-settings-wrap">
        <button
          type="button" id="plate-settings-btn" data-testid="plate-settings-btn" aria-expanded={settingsOpen}
          disabled={isBusy}
          onClick={() => setSettingsOpen(!settingsOpen)} title={t("Settings of this plate")}
        >
          {t("Plate settings")}</button>
        {settingsOpen && plates.find((p) => p.index === activePlateIndex) && <PlateSettingsPopover plate={plates.find((p) => p.index === activePlateIndex)!} />}
      </div>

      {/* Vertical separator */}
      <div className="plate-bar-sep" />

      {/* Slice Menu */}
      <div className="plate-slice-group">
        <button
          type="button"
          id="slice-plate-btn"
          data-testid="slice-plate-btn"
          className={isSlicing ? 'is-slicing' : undefined}
          disabled={!!sliceDisabledReason}
          title={t(sliceDisabledReason)}
          onClick={() => slicePlate(activePlateIndex)}
        >
          {isSlicing ? t("Slicing...") : t("Slice Plate {{number}}", { number: activePlateIndex + 1 })}
        </button>
        <button
          type="button"
          id="slice-menu-toggle-btn"
          data-testid="slice-menu-toggle-btn"
          className={isSlicing ? 'is-slicing' : undefined}
          aria-haspopup="menu"
          aria-expanded={sliceMenuOpen}
          aria-label={t("Slice")}
          disabled={!!sliceDisabledReason}
          onClick={() => setSliceMenuOpen(!sliceMenuOpen)}
        >
          ▼</button>

        {sliceMenuOpen && (
          <div
            id="slice-menu-dropdown"
            data-testid="slice-menu-dropdown"
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
            >
              {t("Slice All Plates")}</button>
          </div>
        )}
      </div>
    </div>
  );
};
