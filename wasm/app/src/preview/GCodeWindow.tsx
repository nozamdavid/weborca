/**
 * @file GCodeWindow.tsx
 * OrcaSlicer Web G-code Viewer Text Window.
 * Ports desktop OrcaSlicer GCodeViewer::SequentialView::GCodeWindow to web Preview tab.
 *
 * Displays a collapsible panel with G-code lines around the currently displayed move/layer,
 * with line numbers, syntax highlighting (command, parameters, comments), and the current
 * line highlighted.
 *
 * Source lines come directly from libvgcode path vertices, including subdivided arcs.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { usePreviewStore } from './previewStore';
import { useAppStore } from '../store/appStore';
import { getMoveGcodeLine } from './orcaPreviewModule';
import { useTranslation } from "../i18n";

import { indexGcodeLines, readGcodeLines } from './gcodeLines';

export const GCodeWindow: React.FC = () => {
    const { t } = useTranslation();
  const showGcodeWindow = usePreviewStore((s) => s.showGcodeWindow);
  const toggleGcodeWindow = usePreviewStore((s) => s.toggleGcodeWindowAction);
  const maxLayer = usePreviewStore((s) => s.showGcodeWindow ? s.maxLayer : 0);
  const currentMove = usePreviewStore((s) => s.showGcodeWindow ? s.currentMove : 0);

  const gcode = useAppStore((s) => s.sliceResult?.gcode);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const currentLineRef = useRef<HTMLDivElement | null>(null);

  const lineIndex = useMemo(() => showGcodeWindow && gcode
    ? indexGcodeLines(gcode) : null, [showGcodeWindow, gcode]);
  const highlightedLineNumber = showGcodeWindow ? getMoveGcodeLine(currentMove) : 0;
  const layerLines = useMemo(() => lineIndex
    ? readGcodeLines(lineIndex, highlightedLineNumber) : [], [lineIndex, highlightedLineNumber]);

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
        right: 90,
        width: 320,
        maxHeight: isCollapsed ? 'auto' : 'calc(100% - 100px)',
        background: 'var(--panel-bg)',
        backdropFilter: 'blur(10px)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 15,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden',
        color: 'var(--text-color)'
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
          background: 'var(--panel-header-bg)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-color)',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.8rem' }}>
          <span>{t("📄 G-code")}</span>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400 }}>
            {t("Layer")} {maxLayer + 1}
          </span>
          {highlightedLineNumber > 0 && (
            <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontWeight: 500 }}>
              {t("Line")} {highlightedLineNumber}
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
              color: 'var(--text-muted)',
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
            title={t("Close G-code window")}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
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
            background: 'var(--canvas-bg)',
            padding: '4px 0',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          }}
        >
          {layerLines.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.75rem' }}>
              {t("No G-code lines available for this layer")}</div>
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
                    color: 'var(--text-color)'
                  }}
                >
                  {/* Line Number */}
                  <span
                    style={{
                      minWidth: 44,
                      textAlign: 'right',
                      marginRight: 12,
                      color: 'var(--warning-color)',
                      userSelect: 'none',
                      opacity: isCurrent ? 1 : 0.75,
                      fontWeight: isCurrent ? 600 : 400
                    }}
                  >
                    {line.lineNumber}
                  </span>
                  {/* Command */}
                  {line.command && (
                    <span style={{ color: 'var(--text-color)', fontWeight: 600, marginRight: 6 }}>
                      {line.command}
                    </span>
                  )}
                  {/* Parameters */}
                  {line.parameters && (
                    <span style={{ color: 'var(--text-color)', marginRight: 6 }}>
                      {line.parameters}
                    </span>
                  )}
                  {/* Comment */}
                  {line.comment && (
                    <span style={{ color: 'var(--text-muted)' }}>
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
