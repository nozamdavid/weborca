/**
 * @file SliceStatsPanel.tsx
 * Floating statistics panel showing slice print time, layers, moves,
 * filament usage, and feature breakdown matching desktop OrcaSlicer.
 */

import React, { useState } from 'react';
import { usePreviewStore } from './previewStore';
import { useAppStore } from '../store/appStore';

function formatPrintTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export const SliceStatsPanel: React.FC = () => {
  const stats = usePreviewStore((s) => s.stats);
  const showStatsPanel = usePreviewStore((s) => s.showStatsPanel);
  const toggleStatsPanel = usePreviewStore((s) => s.toggleStatsPanelAction);

  const gcodeUrl = useAppStore((s) => s.gcodeUrl);
  const modelFile = useAppStore((s) => s.modelFile);

  const [isBreakdownOpen, setIsBreakdownOpen] = useState(true);

  if (!stats) return null;

  const downloadFileName = modelFile
    ? `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.gcode`
    : 'print.gcode';

  const timeFormatted = formatPrintTime(stats.timeS);
  const filamentM = stats.filamentMm > 0 ? (stats.filamentMm / 1000).toFixed(2) + ' m' : '-';
  const filamentG = stats.filamentG > 0 ? stats.filamentG.toFixed(2) + ' g' : '-';

  return (
    <div
      id="stats-section"
      className="slice-stats-panel"
      data-testid="slice-stats-panel"
      style={{
        position: 'absolute',
        top: 16,
        right: 90,
        width: 290,
        maxHeight: 'calc(100% - 100px)',
        background: 'rgba(24, 24, 27, 0.90)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        fontSize: '0.8rem',
        color: '#e4e4e7',
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
          <span>📊 Slicing Statistics</span>
          <span id="status-text" style={{ display: 'none' }}>Slicing complete!</span>
        </div>
        <button
          type="button"
          onClick={toggleStatsPanel}
          title={showStatsPanel ? 'Minimize' : 'Expand'}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#a1a1aa',
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
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Total Layers</div>
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
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Print Time</div>
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
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Filament Length</div>
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
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Filament Weight</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f59e0b' }} id="stat-filament-g">
                {filamentG}
              </div>
            </div>
          </div>

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
                <span>Time by Feature</span>
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
                      <span style={{ color: '#d4d4d8' }}>{feat.name}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <span style={{ color: '#a1a1aa' }}>{formatPrintTime(feat.timeS)}</span>
                        <span style={{ color: '#71717a', minWidth: 40, textAlign: 'right' }}>
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
            <div style={{ marginTop: 12 }}>
              <a
                id="download-link"
                href={gcodeUrl}
                download={downloadFileName}
                className="btn btn-download"
                style={{
                  display: 'block',
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
                ⬇️ Download G-code
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
