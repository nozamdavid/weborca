/**
 * @file CutPanel.tsx
 * Tool panel for Planar Cutting and Assembly Connectors in OrcaSlicer WASM.
 */

import React from 'react';
import { useCutStore } from './cutStore';
import type {
  CutConnectorType,
  CutConnectorStyle,
  CutConnectorShape
} from './types';

export const CutPanel: React.FC = () => {
  const isCutActive = useCutStore((s) => s.isCutActive);
  const selectedObjectId = useCutStore((s) => s.selectedObjectId);
  const z = useCutStore((s) => s.z);
  const zMin = useCutStore((s) => s.zMin);
  const zMax = useCutStore((s) => s.zMax);
  const keepUpper = useCutStore((s) => s.keepUpper);
  const keepLower = useCutStore((s) => s.keepLower);
  const keepAsParts = useCutStore((s) => s.keepAsParts);
  const placeOnCutUpper = useCutStore((s) => s.placeOnCutUpper);
  const placeOnCutLower = useCutStore((s) => s.placeOnCutLower);
  const flipUpper = useCutStore((s) => s.flipUpper);
  const flipLower = useCutStore((s) => s.flipLower);
  const flipPlane = useCutStore((s) => s.flipPlane);
  const connectors = useCutStore((s) => s.connectors);
  const selectedConnectorIndex = useCutStore((s) => s.selectedConnectorIndex);
  const defaultAttrs = useCutStore((s) => s.defaultAttrs);
  const isCutting = useCutStore((s) => s.isCutting);
  const error = useCutStore((s) => s.error);
  const lastResult = useCutStore((s) => s.lastResult);

  const setZ = useCutStore((s) => s.setZ);
  const setKeepUpper = useCutStore((s) => s.setKeepUpper);
  const setKeepLower = useCutStore((s) => s.setKeepLower);
  const setKeepAsParts = useCutStore((s) => s.setKeepAsParts);
  const setPlaceOnCutUpper = useCutStore((s) => s.setPlaceOnCutUpper);
  const setPlaceOnCutLower = useCutStore((s) => s.setPlaceOnCutLower);
  const setFlipUpper = useCutStore((s) => s.setFlipUpper);
  const setFlipLower = useCutStore((s) => s.setFlipLower);
  const toggleFlipPlane = useCutStore((s) => s.toggleFlipPlane);
  const addConnector = useCutStore((s) => s.addConnector);
  const removeConnector = useCutStore((s) => s.removeConnector);
  const updateDefaultAttrs = useCutStore((s) => s.updateDefaultAttrs);
  const clearConnectors = useCutStore((s) => s.clearConnectors);
  const selectConnector = useCutStore((s) => s.selectConnector);
  const performCut = useCutStore((s) => s.performCut);
  const closeCut = useCutStore((s) => s.closeCut);

  if (!isCutActive) {
    return null;
  }

  const hasConnectors = connectors.length > 0;
  const isSnap = defaultAttrs.type === 'snap';
  const isPlug = defaultAttrs.type === 'plug';
  const isDowel = defaultAttrs.type === 'dowel';
  const isCutFinished = lastResult?.success === true;

  const connectorTypes: CutConnectorType[] = ['plug', 'dowel', 'snap'];
  const connectorStyles: CutConnectorStyle[] = ['prism', 'frustum'];
  const connectorShapes: CutConnectorShape[] = ['circle', 'hexagon', 'square', 'triangle'];

  return (
    <div
      id="cut-tool-panel"
      data-testid="cut-tool-panel"
      className="cut-tool-panel"
      style={{
        position: 'absolute',
        top: 64,
        right: 16,
        width: 330,
        maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto',
        background: 'rgba(24, 24, 27, 0.96)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 8,
        color: '#f4f4f5',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        fontSize: 12,
        padding: 14,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
        zIndex: 50
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: 8
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16 }}>✂️</span>
          <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: 0.2 }}>
            Cut Object {selectedObjectId ? `#${selectedObjectId}` : ''}
          </span>
        </div>
        <button
          id="close-cut-btn"
          data-testid="close-cut-btn"
          onClick={closeCut}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#a1a1aa',
            cursor: 'pointer',
            fontSize: 16,
            padding: '2px 6px',
            borderRadius: 4
          }}
          title="Close cut tool"
        >
          ✕
        </button>
      </div>

      {/* Plane Height Slider */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#a1a1aa' }}>Cut Height (Z)</span>
          <span id="cut-z-display" style={{ fontWeight: 600, color: '#38bdf8' }}>{z.toFixed(2)} mm</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id="cut-z-slider"
            data-testid="cut-z-slider"
            type="range"
            min={zMin}
            max={zMax}
            step={0.1}
            value={z}
            disabled={isCutFinished}
            onChange={(e) => setZ(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: '#0ea5e9' }}
          />
          <input
            id="cut-z-input"
            data-testid="cut-z-input"
            type="number"
            min={zMin}
            max={zMax}
            step={0.1}
            value={z}
            disabled={isCutFinished}
            onChange={(e) => setZ(parseFloat(e.target.value) || 0)}
            style={{
              width: 56,
              background: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: 4,
              color: '#fff',
              padding: '2px 4px',
              fontSize: 11,
              textAlign: 'right'
            }}
          />
        </div>
      </div>

      {/* Plane Orientation & Flip */}
      <div style={{ marginBottom: 14 }}>
        <button
          id="cut-flip-plane-btn"
          data-testid="cut-flip-plane-btn"
          onClick={toggleFlipPlane}
          disabled={isCutFinished}
          style={{
            width: '100%',
            padding: '5px 8px',
            background: flipPlane ? '#0284c7' : '#27272a',
            border: `1px solid ${flipPlane ? '#38bdf8' : '#3f3f46'}`,
            borderRadius: 4,
            color: '#fff',
            cursor: isCutFinished ? 'not-allowed' : 'pointer',
            fontSize: 11,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
        >
          <span>🔄</span>
          <span>Flip Cut Plane Normal {flipPlane ? '(Inverted)' : '(Default)'}</span>
        </button>
      </div>

      {/* Halves Options */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 6,
          padding: 8,
          marginBottom: 14
        }}
      >
        <div style={{ color: '#a1a1aa', fontWeight: 600, marginBottom: 6, fontSize: 11 }}>
          Halves & Placement
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: hasConnectors ? 'not-allowed' : 'pointer' }}>
            <input
              id="cut-keep-upper"
              data-testid="cut-keep-upper"
              type="checkbox"
              checked={keepUpper}
              disabled={hasConnectors || isCutFinished}
              onChange={(e) => setKeepUpper(e.target.checked)}
              style={{ accentColor: '#0ea5e9' }}
            />
            <span style={{ color: hasConnectors ? '#71717a' : '#f4f4f5' }}>Keep Upper</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: hasConnectors ? 'not-allowed' : 'pointer' }}>
            <input
              id="cut-keep-lower"
              data-testid="cut-keep-lower"
              type="checkbox"
              checked={keepLower}
              disabled={hasConnectors || isCutFinished}
              onChange={(e) => setKeepLower(e.target.checked)}
              style={{ accentColor: '#0ea5e9' }}
            />
            <span style={{ color: hasConnectors ? '#71717a' : '#f4f4f5' }}>Keep Lower</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              id="cut-place-upper"
              data-testid="cut-place-upper"
              type="checkbox"
              checked={placeOnCutUpper}
              disabled={isCutFinished}
              onChange={(e) => setPlaceOnCutUpper(e.target.checked)}
              style={{ accentColor: '#0ea5e9' }}
            />
            <span>Place Cut (Up)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              id="cut-place-lower"
              data-testid="cut-place-lower"
              type="checkbox"
              checked={placeOnCutLower}
              disabled={isCutFinished}
              onChange={(e) => setPlaceOnCutLower(e.target.checked)}
              style={{ accentColor: '#0ea5e9' }}
            />
            <span>Place Cut (Low)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              id="cut-flip-upper"
              data-testid="cut-flip-upper"
              type="checkbox"
              checked={flipUpper}
              disabled={isCutFinished}
              onChange={(e) => setFlipUpper(e.target.checked)}
              style={{ accentColor: '#0ea5e9' }}
            />
            <span>Flip Upper</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              id="cut-flip-lower"
              data-testid="cut-flip-lower"
              type="checkbox"
              checked={flipLower}
              disabled={isCutFinished}
              onChange={(e) => setFlipLower(e.target.checked)}
              style={{ accentColor: '#0ea5e9' }}
            />
            <span>Flip Lower</span>
          </label>
        </div>

        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: hasConnectors ? 'not-allowed' : 'pointer' }}>
            <input
              id="cut-keep-as-parts"
              data-testid="cut-keep-as-parts"
              type="checkbox"
              checked={keepAsParts}
              disabled={hasConnectors || isCutFinished}
              onChange={(e) => setKeepAsParts(e.target.checked)}
              style={{ accentColor: '#0ea5e9' }}
            />
            <span style={{ color: hasConnectors ? '#71717a' : '#f4f4f5' }}>Keep as volumes in one object</span>
          </label>
        </div>

        {hasConnectors && (
          <div style={{ marginTop: 6, color: '#38bdf8', fontSize: 10 }}>
            * Connectors require keeping both halves as separate objects.
          </div>
        )}
      </div>

      {/* Connectors Section */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 6,
          padding: 8,
          marginBottom: 14
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: '#a1a1aa', fontWeight: 600, fontSize: 11 }}>
            Connectors ({connectors.length})
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              id="cut-add-connector-btn"
              data-testid="cut-add-connector-btn"
              onClick={() => addConnector()}
              disabled={isCutFinished}
              style={{
                background: '#0284c7',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 11,
                padding: '3px 8px',
                cursor: isCutFinished ? 'not-allowed' : 'pointer',
                fontWeight: 500
              }}
            >
              + Add
            </button>
            {connectors.length > 0 && (
              <button
                id="cut-clear-connectors-btn"
                data-testid="cut-clear-connectors-btn"
                onClick={clearConnectors}
                disabled={isCutFinished}
                style={{
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: 4,
                  color: '#fff',
                  fontSize: 11,
                  padding: '3px 6px',
                  cursor: isCutFinished ? 'not-allowed' : 'pointer'
                }}
                title="Clear all connectors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Default / Active Connector Settings */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 6,
            marginBottom: 8,
            fontSize: 11
          }}
        >
          <div>
            <label style={{ color: '#a1a1aa', display: 'block', marginBottom: 2 }}>Type</label>
            <select
              id="cut-connector-type-select"
              data-testid="cut-connector-type-select"
              value={defaultAttrs.type || 'plug'}
              disabled={isCutFinished}
              onChange={(e) => updateDefaultAttrs({ type: e.target.value as CutConnectorType })}
              style={{
                width: '100%',
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: 4,
                color: '#fff',
                padding: '3px 4px',
                fontSize: 11
              }}
            >
              {connectorTypes.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ color: '#a1a1aa', display: 'block', marginBottom: 2 }}>Shape</label>
            <select
              id="cut-connector-shape-select"
              data-testid="cut-connector-shape-select"
              value={isSnap ? 'circle' : (defaultAttrs.shape || 'circle')}
              disabled={isSnap || isCutFinished}
              onChange={(e) => updateDefaultAttrs({ shape: e.target.value as CutConnectorShape })}
              style={{
                width: '100%',
                background: isSnap ? '#18181b' : '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: 4,
                color: isSnap ? '#71717a' : '#fff',
                padding: '3px 4px',
                fontSize: 11
              }}
            >
              {connectorShapes.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ color: '#a1a1aa', display: 'block', marginBottom: 2 }}>Style</label>
            <select
              id="cut-connector-style-select"
              data-testid="cut-connector-style-select"
              value={isSnap ? 'prism' : (defaultAttrs.style || 'prism')}
              disabled={isSnap || isCutFinished}
              onChange={(e) => updateDefaultAttrs({ style: e.target.value as CutConnectorStyle })}
              style={{
                width: '100%',
                background: isSnap ? '#18181b' : '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: 4,
                color: isSnap ? '#71717a' : '#fff',
                padding: '3px 4px',
                fontSize: 11
              }}
            >
              {connectorStyles.map((st) => (
                <option key={st} value={st}>
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ color: '#a1a1aa', display: 'block', marginBottom: 2 }}>Size (ø mm)</label>
            <input
              id="cut-connector-size-input"
              data-testid="cut-connector-size-input"
              type="number"
              step={0.5}
              min={1}
              max={30}
              value={defaultAttrs.size ?? 3.0}
              disabled={isCutFinished}
              onChange={(e) => updateDefaultAttrs({ size: parseFloat(e.target.value) || 3.0 })}
              style={{
                width: '100%',
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: 4,
                color: '#fff',
                padding: '3px 4px',
                fontSize: 11
              }}
            />
          </div>

          <div>
            <label style={{ color: '#a1a1aa', display: 'block', marginBottom: 2 }}>Depth (mm)</label>
            <input
              id="cut-connector-depth-input"
              data-testid="cut-connector-depth-input"
              type="number"
              step={0.5}
              min={1}
              max={50}
              value={defaultAttrs.depthRatio ?? 4.0}
              disabled={isCutFinished}
              onChange={(e) => updateDefaultAttrs({ depthRatio: parseFloat(e.target.value) || 4.0 })}
              style={{
                width: '100%',
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: 4,
                color: '#fff',
                padding: '3px 4px',
                fontSize: 11
              }}
            />
          </div>

          <div>
            <label style={{ color: '#a1a1aa', display: 'block', marginBottom: 2 }}>Tolerance (mm)</label>
            <input
              id="cut-connector-tolerance-input"
              data-testid="cut-connector-tolerance-input"
              type="number"
              step={0.05}
              min={0}
              max={2}
              value={defaultAttrs.tolerance ?? 0.1}
              disabled={isCutFinished}
              onChange={(e) => updateDefaultAttrs({ tolerance: parseFloat(e.target.value) || 0.1 })}
              style={{
                width: '100%',
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: 4,
                color: '#fff',
                padding: '3px 4px',
                fontSize: 11
              }}
            />
          </div>

          {isPlug && (
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ color: '#a1a1aa', display: 'block', marginBottom: 2 }}>Target Half</label>
              <select
                id="cut-connector-target-half-select"
                data-testid="cut-connector-target-half-select"
                value={defaultAttrs.targetHalf || 'upper'}
                disabled={isCutFinished}
                onChange={(e) => updateDefaultAttrs({ targetHalf: e.target.value as 'upper' | 'lower' })}
                style={{
                  width: '100%',
                  background: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: 4,
                  color: '#fff',
                  padding: '3px 4px',
                  fontSize: 11
                }}
              >
                <option value="upper">Upper (plug in upper half, socket in lower)</option>
                <option value="lower">Lower (plug in lower half, socket in upper)</option>
              </select>
            </div>
          )}
        </div>

        {/* Type-specific hints */}
        {isSnap && (
          <div style={{ color: '#eab308', fontSize: 10, marginBottom: 6 }}>
            * Snap connector requires lower targetHalf, prism style, and circle shape.
          </div>
        )}
        {isDowel && (
          <div style={{ color: '#38bdf8', fontSize: 10, marginBottom: 6 }}>
            * Dowels generate an independent pin object and negative sockets in both halves.
          </div>
        )}

        {/* Honest clearance notice with plain user wording */}
        {hasConnectors && (
          <div
            id="cut-connector-fit-notice"
            data-testid="cut-connector-fit-notice"
            style={{
              background: 'rgba(234, 179, 8, 0.08)',
              border: '1px solid rgba(234, 179, 8, 0.3)',
              borderRadius: 4,
              padding: '4px 6px',
              color: '#fef08a',
              fontSize: 10,
              marginTop: 6
            }}
          >
            Inspect connector clearance in sliced preview.
          </div>
        )}

        {/* Connectors List */}
        {connectors.length > 0 && (
          <div
            id="cut-connectors-list"
            style={{
              maxHeight: 120,
              overflowY: 'auto',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              paddingTop: 6,
              marginTop: 6
            }}
          >
            {connectors.map((conn, idx) => {
              const isSelected = selectedConnectorIndex === idx;
              return (
                <div
                  key={conn.id || idx}
                  onClick={() => selectConnector(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 6px',
                    borderRadius: 4,
                    background: isSelected ? 'rgba(14, 165, 233, 0.2)' : 'transparent',
                    border: isSelected ? '1px solid #0284c7' : '1px solid transparent',
                    marginBottom: 2,
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ color: '#71717a' }}>#{idx + 1}</span>
                    <span style={{ fontWeight: 500 }}>
                      {conn.attrs?.type || 'plug'} ({conn.attrs?.shape || 'circle'})
                    </span>
                    <span style={{ color: '#a1a1aa', fontSize: 10 }}>
                      ø{conn.attrs?.size ?? 3} h{conn.attrs?.depthRatio ?? 4}
                      {conn.attrs?.type === 'plug' ? ` [${conn.attrs?.targetHalf || 'upper'}]` : ''}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeConnector(idx);
                    }}
                    disabled={isCutFinished}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: isCutFinished ? '#71717a' : '#ef4444',
                      cursor: isCutFinished ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      padding: '1px 4px'
                    }}
                    title="Remove connector"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Error Message Banner */}
      {error && (
        <div
          id="cut-error-message"
          data-testid="cut-error-message"
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: 6,
            padding: '6px 8px',
            marginBottom: 12,
            color: '#fca5a5',
            fontSize: 11
          }}
        >
          {error}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          id="perform-cut-btn"
          data-testid="perform-cut-btn"
          onClick={performCut}
          disabled={isCutting || isCutFinished || (!keepUpper && !keepLower)}
          style={{
            flex: 1,
            background: isCutFinished ? '#15803d' : isCutting ? '#64748b' : '#0284c7',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontWeight: 600,
            fontSize: 12,
            padding: '8px 12px',
            cursor: (isCutting || isCutFinished) ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s ease'
          }}
        >
          {isCutFinished ? 'Cut Completed' : isCutting ? 'Cutting...' : 'Perform Cut'}
        </button>
        <button
          id="cut-cancel-btn"
          data-testid="cut-cancel-btn"
          onClick={closeCut}
          disabled={isCutting}
          style={{
            background: '#27272a',
            border: '1px solid #3f3f46',
            borderRadius: 6,
            color: '#d4d4d8',
            fontSize: 12,
            padding: '8px 12px',
            cursor: 'pointer'
          }}
        >
          {isCutFinished ? 'Done' : 'Cancel'}
        </button>
      </div>

      {/* Success Notification with plain user wording */}
      {lastResult && lastResult.success && (
        <div
          id="cut-success-message"
          data-testid="cut-success-message"
          style={{
            marginTop: 10,
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid #22c55e',
            borderRadius: 6,
            padding: '6px 8px',
            color: '#86efac',
            fontSize: 11
          }}
        >
          <div>
            Cut successful! Produced {lastResult.createdObjects?.length ?? 0} object(s) with{' '}
            {lastResult.connectorCount ?? 0} connector(s).
          </div>
          <div style={{ fontSize: 10, color: '#bbf7d0', marginTop: 4 }}>
            Inspect connector clearance in sliced preview.
          </div>
        </div>
      )}
    </div>
  );
};

export default CutPanel;
