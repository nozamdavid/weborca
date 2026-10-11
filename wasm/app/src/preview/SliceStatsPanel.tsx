import { usePlatesStore } from '../plates/platesStore';
/**
 * @file SliceStatsPanel.tsx
 * Floating statistics panel showing slice print time, layers, moves,
 * filament usage, and feature breakdown matching desktop OrcaSlicer.
 */

import React, { useState, useMemo } from 'react';
import { usePreviewStore } from './previewStore';
import { useAppStore } from '../store/appStore';
import { usePrinterConnectionStore } from '../printers/connectionStore';
import { SendToPrinterDialog } from '../printers/SendToPrinterDialog';
import { exportGcode } from '../shell/exportGcode';
import { useTranslation } from "../i18n";

function formatPrintTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

interface SlotFilamentStat {
  slot: number;
  name: string;
  color: string;
  mm: number;
  g: number;
}

function parseFilamentStats(
  gcodeBytes: Uint8Array | undefined,
  selectedFilaments: string[],
  currentConfig: Record<string, string>
): SlotFilamentStat[] {
  if (!selectedFilaments?.length) return [];

  const rawColors = (currentConfig['filament_colour'] || '')
    .split(';')
    .map((c) => c.trim())
    .map((c) => {
      if (!c) return '';
      let hex = c.startsWith('#') ? c : `#${c}`;
      return hex.length > 7 ? hex.slice(0, 7) : hex;
    });

  let mmValues: number[] = [];
  let gValues: number[] = [];

  if (gcodeBytes && gcodeBytes.length > 0) {
    const offset = Math.max(0, gcodeBytes.length - 65536);
    const tail = new TextDecoder('utf-8', { fatal: false }).decode(gcodeBytes.subarray(offset));

    const mmMatch = tail.match(/;\s*filament used \[mm\]\s*=\s*([0-9., ]+)/);
    const gMatch = tail.match(/;\s*filament used \[g\]\s*=\s*([0-9., ]+)/);

    if (mmMatch) {
      mmValues = mmMatch[1].split(',').map((s) => parseFloat(s.trim()) || 0);
    }
    if (gMatch) {
      gValues = gMatch[1].split(',').map((s) => parseFloat(s.trim()) || 0);
    }
  }

  return selectedFilaments.map((name, idx) => {
    return {
      slot: idx + 1,
      name,
      color: rawColors[idx] || '#009688',
      mm: mmValues[idx] || 0,
      g: gValues[idx] || 0
    };
  }).filter(item => item.mm > 0 || item.g > 0);
}

/** The filament cost the slicer writes into the G-code footer (`; total filament cost = 1.23`), from the filament's cost per kg. */
export function parseFilamentCost(gcodeBytes: Uint8Array | undefined): number {
  if (!gcodeBytes || gcodeBytes.length === 0) return 0;
  const tail = new TextDecoder('utf-8', { fatal: false }).decode(gcodeBytes.subarray(Math.max(0, gcodeBytes.length - 65536)));
  return parseFloat(tail.match(/;\s*total filament cost\s*=\s*([0-9.]+)/)?.[1] ?? '') || 0;
}

/** Millimetres up to 999, metres beyond, each with at most 2 decimals. */
export function formatFilamentLength(mm: number): string {
  return mm > 999 ? `${Number((mm / 1000).toFixed(2))} m` : `${Number(mm.toFixed(2))} mm`;
}

export const SliceStatsPanel: React.FC = () => {
    const { t } = useTranslation();
  const stats = usePreviewStore((s) => s.stats);
  const showStatsPanel = usePreviewStore((s) => s.showStatsPanel);
  const toggleStatsPanel = usePreviewStore((s) => s.toggleStatsPanelAction);
  const openSendDialog = usePrinterConnectionStore((s) => s.openSendDialog);

  const gcodeUrl = useAppStore((s) => s.gcodeUrl);
  const modelFile = useAppStore((s) => s.modelFile);
  const sliceResult = useAppStore((s) => s.sliceResult);
  const selectedFilaments = useAppStore((s) => s.selectedFilaments);
  const currentConfig = useAppStore((s) => s.currentConfig);

  const [isBreakdownOpen, setIsBreakdownOpen] = useState(true);

  const filamentStats = useMemo(() => {
    return parseFilamentStats(sliceResult?.gcode, selectedFilaments, currentConfig);
  }, [sliceResult?.gcode, selectedFilaments, currentConfig]);

  const filamentCost = useMemo(() => parseFilamentCost(sliceResult?.gcode), [sliceResult?.gcode]);

  if (!stats) return null;

  const downloadFileName = modelFile
    ? `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.gcode`
    : 'print.gcode';

  const timeFormatted = formatPrintTime(stats.timeS);
  const filamentM = stats.filamentMm > 0 ? formatFilamentLength(stats.filamentMm) : '-';
  const filamentG = stats.filamentG > 0 ? stats.filamentG.toFixed(2) + ' g' : '-';

  return (
    <div
      id="stats-section"
      className="slice-stats-panel"
      data-testid="slice-stats-panel"
      style={{
        position: 'absolute',
        bottom: 70,
        right: 90,
        width: 290,
        maxHeight: 'calc(100% - 280px)',
        background: 'rgba(24, 24, 27, 0.90)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 15,
        fontSize: '0.8rem',
        color: 'var(--text-color)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(39, 39, 42, 0.6)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
          <span>{t("📊 Slicing Statistics")}</span>
          <span id="status-text" style={{ display: 'none' }}>{t("Slicing complete!")}</span>
        </div>
        <button
          type="button"
          onClick={toggleStatsPanel}
          title={showStatsPanel ? 'Minimize' : 'Expand'}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 2
          }}
        >
          {showStatsPanel ? '✕' : '▼'}
        </button>
      </div>

      {showStatsPanel && (
        <div style={{ padding: '10px 12px', overflowY: 'auto' }}>
          {/* Key Summary Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              marginBottom: 10
            }}
          >
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.06)'
              }}
            >
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t("Total Layers")}</div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#38bdf8' }} id="stat-layers">
                {stats.layers}
              </div>
            </div>

            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.06)'
              }}
            >
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t("Print Time")}</div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#10b981' }} id="stat-time">
                {timeFormatted}
              </div>
            </div>

            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.06)'
              }}
            >
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t("Filament Length")}</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b' }} id="stat-filament-mm">
                {filamentM}
              </div>
            </div>

            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.06)'
              }}
            >
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t("Filament Weight")}</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b' }} id="stat-filament-g">
                {filamentG}
              </div>
            </div>
          </div>

          {filamentCost > 0 && (
            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.06)', marginBottom: 10 }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{t("Filament Cost")}</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b' }} id="stat-filament-cost">{filamentCost.toFixed(2)}</div>
            </div>
          )}

          {/* Multi-filament Breakdown */}
          {filamentStats.length > 0 && (
            <div id="stat-filaments-section" style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#94a3b8',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <span>{t("Filaments (")}{filamentStats.length})</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {filamentStats.map((item) => (
                  <div
                    key={item.slot}
                    id={`stat-filament-slot-${item.slot}`}
                    className="stat-filament-row"
                    data-testid={`stat-filament-slot-${item.slot}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 8px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      borderRadius: 4,
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      fontSize: '0.75rem'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          backgroundColor: item.color,
                          flexShrink: 0
                        }}
                      />
                      <span style={{ color: '#38bdf8', fontWeight: 600 }}>#{item.slot}</span>
                      <span
                        style={{
                          color: 'var(--text-color)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={item.name}
                      >
                        {item.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, color: '#f59e0b', fontWeight: 500, flexShrink: 0, fontSize: '0.7rem' }}>
                      <span>{formatFilamentLength(item.mm)}</span>
                      <span style={{ color: 'var(--text-muted)' }}>({item.g.toFixed(2)} {t("g)")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature Breakdown Table */}
          {stats.features && stats.features.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div
                onClick={() => setIsBreakdownOpen(!isBreakdownOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  padding: '4px 0',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  color: '#94a3b8',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <span>{t("Time by Feature")}</span>
                <span>{isBreakdownOpen ? '▼' : '▶'}</span>
              </div>

              {isBreakdownOpen && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {stats.features.map((feat, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.75rem'
                      }}
                    >
                      <span style={{ color: 'var(--text-color)' }}>{feat.name}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{formatPrintTime(feat.timeS)}</span>
                        <span style={{ color: 'var(--text-dim)', minWidth: 40, textAlign: 'right' }}>
                          {feat.percent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Download G-code Link */}
          {gcodeUrl && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <a
                id="download-link"
                href={gcodeUrl}
                onClick={(event) => { event.preventDefault(); void exportGcode(); }}
                download={downloadFileName}
                className="btn btn-download"
                style={{
                  display: 'block',
                  flex: 1,
                  textAlign: 'center',
                  background: '#009688',
                  color: '#fff',
                  padding: '6px 12px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: '0.8rem'
                }}
              >
                {t("⬇️ Download")}</a>
              <button
                className="btn btn-primary"
                style={{ flex: 1, padding: '6px 12px', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem', background: '#3b82f6', color: '#fff', border: 'none', cursor: 'pointer' }}
                onClick={() => openSendDialog()}
              >
                {t("🖨️ Send to Printer")}</button>
            </div>
          )}
          <SendToPrinterDialog 
             getGcode={() => {
               const result = useAppStore.getState().sliceResult;
               const activeIdx = usePlatesStore.getState().activePlateIndex;
               if (!result || result.plateIndex !== activeIdx) return null;
               return result.gcode;
             }}
             defaultFilename={downloadFileName}
          />
        </div>
      )}
    </div>
  );
};
