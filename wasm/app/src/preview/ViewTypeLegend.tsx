/**
 * @file ViewTypeLegend.tsx
 * View type selector and legend panel matching desktop OrcaSlicer GCodeViewer.
 * Includes color swatches, ranges, and feature toggles (travel, retract, wipe, seams, etc.).
 */

import React, { useState } from 'react';
import { usePreviewStore } from './previewStore';
import { useAppStore } from '../store/appStore';
import type { PreviewViewType } from './types';
import { useTranslation } from "../i18n";

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function normalizeHexColor(c: string): string {
  if (!c) return '#009688';
  let hex = c.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (hex.length > 7) hex = hex.slice(0, 7);
  return hex;
}

export const ViewTypeLegend: React.FC = () => {
    const { t } = useTranslation();
  const viewType = usePreviewStore((s) => s.viewType);
  const legend = usePreviewStore((s) => s.legend);
  const setViewType = usePreviewStore((s) => s.setViewTypeAction);
  const toggleExtrusionRole = usePreviewStore((s) => s.toggleExtrusionRoleAction);
  const toggleOption = usePreviewStore((s) => s.toggleOptionAction);

  const selectedFilaments = useAppStore((s) => s.selectedFilaments);
  const currentConfig = useAppStore((s) => s.currentConfig);

  const [isFolded, setIsFolded] = useState(false);

  const handleViewTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setViewType(e.target.value as PreviewViewType);
  };

  const parsedColors = (currentConfig['filament_colour'] || '')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .map(normalizeHexColor);

  let displayItems = legend.items || [];
  if (viewType === 'Tool' || viewType === 'ColorPrint' || viewType === 'Summary') {
    if (displayItems.length > 0) {
      displayItems = displayItems.map((item) => {
        const slotIdx = item.id;
        const name = selectedFilaments[slotIdx]
          ? `Filament ${slotIdx + 1} (${selectedFilaments[slotIdx]})`
          : item.name;
        const color = viewType === 'Tool' ? item.color : parsedColors[slotIdx] || item.color;
        return {
          ...item,
          name,
          color
        };
      });
    } else if (selectedFilaments && selectedFilaments.length > 0) {
      displayItems = selectedFilaments.map((fName, idx) => ({
        id: idx,
        name: `Filament ${idx + 1} (${fName})`,
        color: parsedColors[idx] || '#009688',
        visible: true
      }));
    }
  }

  return (
    <div
      id="preview-legend-panel"
      data-testid="preview-legend"
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        maxHeight: 'calc(100% - 90px)',
        width: 280,
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(10px)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        fontSize: '0.8rem',
        color: 'var(--text-color)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden'
      }}
    >
      {/* Header with Fold Button and View Type Selector */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: isFolded ? 'none' : '1px solid var(--border-color)',
          background: 'var(--panel-header-bg)'
        }}
      >
        <button
          type="button"
          id="btn-fold-legend"
          onClick={() => setIsFolded(!isFolded)}
          title={isFolded ? 'Expand legend' : 'Collapse legend'}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 2,
            fontSize: '0.9rem',
            lineHeight: 1
          }}
        >
          {isFolded ? '▶' : '▼'}
        </button>

        <label
          htmlFor="view-type-select"
          style={{
            fontWeight: 600,
            color: 'var(--text-muted)',
            fontSize: '0.75rem',
            whiteSpace: 'nowrap'
          }}
        >
          {t("Color Scheme:")}</label>

        <select
          id="view-type-select"
          data-testid="view-type-select"
          value={viewType}
          onChange={handleViewTypeChange}
          style={{
            flex: 1,
            background: 'var(--canvas-bg)',
            color: '#fff',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 4,
            padding: '3px 6px',
            fontSize: '0.75rem',
            cursor: 'pointer'
          }}
        >
          <option value="FeatureType">{t("Line type")}</option>
          <option value="Speed">{t("Speed")}</option>
          <option value="ActualSpeed">{t("Actual speed")}</option>
          <option value="Acceleration">{t("Acceleration")}</option>
          <option value="Jerk">{t("Jerk")}</option>
          <option value="Height">{t("Layer height")}</option>
          <option value="Width">{t("Line width")}</option>
          <option value="VolumetricFlowRate">{t("Flow rate")}</option>
          <option value="ActualVolumetricFlowRate">{t("Actual flow rate")}</option>
          <option value="LayerTimeLinear">{t("Layer time")}</option>
          <option value="LayerTimeLogarithmic">{t("Layer time (log)")}</option>
          <option value="FanSpeed">{t("Fan speed")}</option>
          <option value="Temperature">{t("Temperature")}</option>
          <option value="PressureAdvance">{t("Pressure advance")}</option>
          <option value="Tool">{t("Filament")}</option>
          <option value="ColorPrint">{t("Color print")}</option>
          <option value="Summary">{t("Summary")}</option>
        </select>
      </div>

      {/* Foldable Content Body */}
      {!isFolded && (
        <div
          id="legend-content-body"
          style={{
            overflowY: 'auto',
            maxHeight: 450,
            padding: '6px 8px'
          }}
        >
          {/* Legend Title */}
          <div
            id="legend-title"
            style={{
              fontWeight: 600,
              color: '#38bdf8',
              fontSize: '0.75rem',
              marginBottom: 6,
              padding: '2px 4px'
            }}
          >
            {viewType === 'Tool' ? 'Filament' : legend.title}
          </div>

          {/* 1. Feature Types / Tools List */}
          {displayItems && displayItems.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
              {displayItems.map((item) => (
                <div
                  key={item.id}
                  className="legend-row"
                  onClick={legend.type === 'features' ? () => toggleExtrusionRole(item.id) : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '3px 6px',
                    borderRadius: 4,
                    cursor: legend.type === 'features' ? 'pointer' : 'default',
                    opacity: item.visible ? 1 : 0.4,
                    background: item.visible ? 'transparent' : 'var(--control-bg)'
                  }}
                  title={legend.type === 'features' ? `Click to ${item.visible ? 'hide' : 'show'} ${item.name}` : item.name}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 2,
                        backgroundColor: item.color,
                        flexShrink: 0
                      }}
                    />
                    <span
                      style={{
                        textDecoration: item.visible ? 'none' : 'line-through',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {item.name}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.timeS !== undefined && item.timeS > 0 && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {formatDuration(item.timeS)}
                      </span>
                    )}
                    {legend.type === 'features' && (
                      <button
                        type="button"
                        className="legend-eye-btn"
                        data-testid={`toggle-role-${item.id}`}
                        aria-label={`Show ${item.name}`}
                        aria-pressed={item.visible}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: item.visible ? '#009688' : 'var(--text-dim)',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '0.85rem'
                        }}
                      >
                        {item.visible ? '👁' : '👁‍🗨'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 2. Range Values List */}
          {viewType !== 'Tool' && viewType !== 'ColorPrint' && viewType !== 'Summary' && (legend.ranges || legend.type === 'range') && (
            <div
              id="legend-ranges-list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                marginBottom: 8
              }}
            >
              {legend.ranges && legend.ranges.length > 0 ? (
                legend.ranges.map((range, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '2px 6px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 14,
                          height: 10,
                          backgroundColor: range.color,
                          borderRadius: 1
                        }}
                      />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-color)' }}>
                        {typeof range.value === 'number' ? (viewType === 'PressureAdvance' ? range.value.toFixed(3) : range.value.toFixed(1)) : range.value}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '2px 6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {t("Calculating range...")}</div>
              )}
            </div>
          )}

          {/* 3. Options Section (Travel, Retract, Wipe, Seams, etc.) */}
          {legend.options && legend.options.length > 0 && (
            <div
              style={{
                borderTop: '1px solid var(--border-color)',
                paddingTop: 6,
                marginTop: 4
              }}
            >
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: 4,
                  padding: '0 4px'
                }}
              >
                {t("Features:")}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {legend.options.map((opt) => (
                  <div
                    key={opt.id}
                    className="legend-row option-row"
                    onClick={() => toggleOption(opt.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '3px 6px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      opacity: opt.visible ? 1 : 0.4
                    }}
                    title={`Click to ${opt.visible ? 'hide' : 'show'} ${opt.name}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 2,
                          backgroundColor: opt.color,
                          flexShrink: 0
                        }}
                      />
                      <span style={{ textDecoration: opt.visible ? 'none' : 'line-through' }}>
                        {opt.name}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="legend-eye-btn"
                      data-testid={`toggle-opt-${opt.id}`}
                      aria-label={`Show ${opt.name}`}
                      aria-pressed={opt.visible}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: opt.visible ? '#009688' : 'var(--text-dim)',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.85rem'
                      }}
                    >
                      {opt.visible ? '👁' : '👁‍🗨'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
