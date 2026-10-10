/**
 * @file GCodeWindow.tsx
 * OrcaSlicer Web G-code Viewer Text Window.
 * Ports desktop OrcaSlicer GCodeViewer::SequentialView::GCodeWindow to web Preview tab.
 *
 * Displays a collapsible panel with G-code lines around the currently displayed move/layer,
 * with line numbers, syntax highlighting (command, parameters, comments), and the current
 * line highlighted.
 *
 * Note: Exact move-to-line mapping from libvgcode's vertex buffer is not exposed by the
 * engine/WASM API without an engine change; we fall back to showing the lines of the
 * current layer (finding ';LAYER_CHANGE' / 'Z' markers in the sliced G-code) and mapping
 * the move slider position proportionally across the layer's commands.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { usePreviewStore } from './previewStore';
import { useAppStore } from '../store/appStore';

interface ParsedLine {
  lineNumber: number;
  command: string;
  parameters: string;
  comment: string;
  isMotion: boolean;
}

interface ParsedGcode {
  lines: ParsedLine[];
  layerStarts: number[];
}

function parseGcode(bytes: Uint8Array | undefined): ParsedGcode {
  if (!bytes || bytes.length === 0) {
    return { lines: [], layerStarts: [] };
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const rawLines = text.split('\n');
  const lines: ParsedLine[] = [];
  const layerStarts: number[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].replace(/\r$/, '');

    // Truncate long lines (>55 characters) matching desktop OrcaSlicer GCodeViewer
    let display = raw;
    if (display.length > 55) {
      display = display.slice(0, 52) + '...';
    }

    let command = '';
    let parameters = '';
    let comment = '';

    const semicolonIdx = display.indexOf(';');
    if (semicolonIdx !== -1) {
      comment = display.slice(semicolonIdx);
      const beforeComment = display.slice(0, semicolonIdx).trim();
      if (beforeComment) {
        const spaceIdx = beforeComment.indexOf(' ');
        if (spaceIdx === -1) {
          command = beforeComment;
        } else {
          command = beforeComment.slice(0, spaceIdx);
          parameters = beforeComment.slice(spaceIdx + 1).trim();
        }
      }
    } else {
      const trimmed = display.trim();
      if (trimmed) {
        const spaceIdx = trimmed.indexOf(' ');
        if (spaceIdx === -1) {
          command = trimmed;
        } else {
          command = trimmed.slice(0, spaceIdx);
          parameters = trimmed.slice(spaceIdx + 1).trim();
        }
      }
    }

    const isMotion = /^G[0123]\b/i.test(command);

    lines.push({
      lineNumber: i + 1,
      command,
      parameters,
      comment,
      isMotion
    });

    // Detect layer start markers: find ';LAYER_CHANGE'
    if (raw.startsWith(';LAYER_CHANGE')) {
      layerStarts.push(i);
    }
  }

  // Fallback to ';Z:' or 'G1 Z' if no ';LAYER_CHANGE' markers exist
  if (layerStarts.length === 0) {
    for (let i = 0; i < rawLines.length; i++) {
      if (rawLines[i].startsWith(';Z:') || /^G[01]\s+.*Z/i.test(rawLines[i])) {
        layerStarts.push(i);
      }
    }
  }

  if (layerStarts.length === 0) {
    layerStarts.push(0);
  }

  return { lines, layerStarts };
}

export const GCodeWindow: React.FC = () => {
  const showGcodeWindow = usePreviewStore((s) => s.showGcodeWindow);
  const toggleGcodeWindow = usePreviewStore((s) => s.toggleGcodeWindowAction);
  const showStatsPanel = usePreviewStore((s) => s.showStatsPanel);
  const maxLayer = usePreviewStore((s) => s.maxLayer);
  const minMove = usePreviewStore((s) => s.minMove);
  const maxMove = usePreviewStore((s) => s.maxMove);
  const currentMove = usePreviewStore((s) => s.currentMove);

  const sliceResult = useAppStore((s) => s.sliceResult);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const currentLineRef = useRef<HTMLDivElement | null>(null);

  // Parse G-code lines and layer boundaries (memoized per sliced output)
  const { lines, layerStarts } = useMemo(() => {
    return parseGcode(sliceResult?.gcode);
  }, [sliceResult?.gcode]);

  // Extract lines belonging to the currently selected layer
  const { layerLines, motionLines } = useMemo(() => {
    if (lines.length === 0 || layerStarts.length === 0) {
      return { layerLines: [], motionLines: [] };
    }

    const clampedLayer = Math.min(layerStarts.length - 1, Math.max(0, maxLayer));
    const startIdx = clampedLayer === 0 ? 0 : layerStarts[clampedLayer];
    const endIdx =
      clampedLayer + 1 < layerStarts.length
        ? layerStarts[clampedLayer + 1] - 1
        : lines.length - 1;

    const slice = lines.slice(startIdx, endIdx + 1);
    const motions = slice.filter((l) => l.isMotion);
    return { layerLines: slice, motionLines: motions };
  }, [lines, layerStarts, maxLayer]);

  // Determine highlighted line based on move slider progress through the layer
  const highlightedLineNumber = useMemo(() => {
    if (layerLines.length === 0) return 0;

    const rangeSpan = Math.max(0, maxMove - minMove);
    const frac = rangeSpan > 0 ? Math.max(0, Math.min(1, (currentMove - minMove) / rangeSpan)) : 1;

    if (motionLines.length > 0) {
      const idx = Math.min(motionLines.length - 1, Math.max(0, Math.round(frac * (motionLines.length - 1))));
      return motionLines[idx].lineNumber;
    }

    const offset = Math.min(layerLines.length - 1, Math.max(0, Math.round(frac * (layerLines.length - 1))));
    return layerLines[offset].lineNumber;
  }, [layerLines, motionLines, minMove, maxMove, currentMove]);

  // Keep highlighted line scrolled into view
  useEffect(() => {
    if (currentLineRef.current && !isCollapsed) {
      currentLineRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, [highlightedLineNumber, isCollapsed]);

  if (!showGcodeWindow) return null;

  return (
    <div
      id="gcode-window"
      data-testid="gcode-window"
      className="gcode-window-panel"
      style={{
        position: 'absolute',
        top: 16,
        right: showStatsPanel ? 390 : 90,
        width: 320,
        maxHeight: isCollapsed ? 'auto' : 'calc(100% - 100px)',
        background: 'rgba(24, 24, 27, 0.92)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 15,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden',
        color: '#e4e4e7'
      }}
    >
      {/* Panel Header */}
      <div
        id="gcode-window-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(39, 39, 42, 0.7)',
          borderBottom: isCollapsed ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.8rem' }}>
          <span>📄 G-code</span>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400 }}>
            Layer {maxLayer + 1}
          </span>
          {highlightedLineNumber > 0 && (
            <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontWeight: 500 }}>
              Line {highlightedLineNumber}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            id="btn-collapse-gcode-window"
            data-testid="btn-collapse-gcode-window"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'Expand G-code window' : 'Collapse G-code window'}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#a1a1aa',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: '0.85rem'
            }}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
          <button
            type="button"
            id="btn-close-gcode-window"
            data-testid="btn-close-gcode-window"
            onClick={toggleGcodeWindow}
            title="Close G-code window"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#a1a1aa',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: '0.85rem'
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Panel Body: Scrollable G-code lines */}
      {!isCollapsed && (
        <div
          id="gcode-lines-container"
          data-testid="gcode-lines-container"
          style={{
            height: 380,
            overflowY: 'auto',
            background: 'rgba(18, 18, 20, 0.85)',
            padding: '4px 0',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          }}
        >
          {layerLines.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#71717a', fontSize: '0.75rem' }}>
              No G-code lines available for this layer
            </div>
          ) : (
            layerLines.map((line) => {
              const isCurrent = line.lineNumber === highlightedLineNumber;
              return (
                <div
                  key={line.lineNumber}
                  id={isCurrent ? 'gcode-current-line' : undefined}
                  ref={isCurrent ? currentLineRef : undefined}
                  data-testid={isCurrent ? 'gcode-current-line' : 'gcode-line'}
                  data-line-number={line.lineNumber}
                  className={isCurrent ? 'gcode-line gcode-line-current' : 'gcode-line'}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    padding: '1px 8px',
                    background: isCurrent ? 'rgba(234, 88, 12, 0.35)' : 'transparent',
                    borderLeft: isCurrent ? '3px solid #ea580c' : '3px solid transparent',
                    fontSize: '0.75rem',
                    lineHeight: '1.4',
                    whiteSpace: 'pre',
                    color: '#e4e4e7'
                  }}
                >
                  {/* Line Number */}
                  <span
                    style={{
                      minWidth: 44,
                      textAlign: 'right',
                      marginRight: 12,
                      color: '#fb923c',
                      userSelect: 'none',
                      opacity: isCurrent ? 1 : 0.75,
                      fontWeight: isCurrent ? 600 : 400
                    }}
                  >
                    {line.lineNumber}
                  </span>
                  {/* Command */}
                  {line.command && (
                    <span style={{ color: '#facc15', fontWeight: 600, marginRight: 6 }}>
                      {line.command}
                    </span>
                  )}
                  {/* Parameters */}
                  {line.parameters && (
                    <span style={{ color: '#f4f4f5', marginRight: 6 }}>
                      {line.parameters}
                    </span>
                  )}
                  {/* Comment */}
                  {line.comment && (
                    <span style={{ color: '#a1a1aa' }}>
                      {line.comment}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
