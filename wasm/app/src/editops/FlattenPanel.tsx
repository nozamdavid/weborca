import React from 'react';
import { useEditOpsStore } from './editOpsStore';

export const FlattenPanel: React.FC = () => {
  const activeTool = useEditOpsStore((s) => s.activeTool);
  const flattenClusters = useEditOpsStore((s) => s.flattenClusters);
  const isLoadingClusters = useEditOpsStore((s) => s.isLoadingClusters);
  const isOperating = useEditOpsStore((s) => s.isOperating);
  const error = useEditOpsStore((s) => s.error);

  const applyPlaceOnFace = useEditOpsStore((s) => s.applyPlaceOnFace);
  const stopFlatten = useEditOpsStore((s) => s.stopFlatten);

  if (activeTool !== 'flatten') return null;

  return (
    <div
      id="flatten-panel"
      data-testid="flatten-panel"
      className="canvas-panel"
      style={{
        position: 'absolute',
        top: 24,
        right: 24,
        width: 280,
        background: 'var(--panel-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: 16,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Place on Face (F)</h3>
        <button className="icon-btn" onClick={stopFlatten} aria-label="Close">✕</button>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
        Click a face cluster in the 3D viewport or pick a flat facet below to lay it on the print bed.
      </p>

      {error && <div style={{ color: 'var(--danger-color)', fontSize: 12 }}>{error}</div>}

      {isLoadingClusters ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Detecting planar facets...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
          {flattenClusters.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No planar facets found</div>
          ) : (
            flattenClusters.map((cluster, idx) => (
              <button
                key={idx}
                id={`flatten-cluster-btn-${idx}`}
                data-testid={`flatten-cluster-btn-${idx}`}
                className="btn btn-secondary"
                disabled={isOperating}
                onClick={() => void applyPlaceOnFace(idx)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 10px',
                  fontSize: 12,
                  textAlign: 'left'
                }}
              >
                <span>Face #{idx + 1}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {Math.round(cluster.area)} mm²
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <button className="btn btn-primary" onClick={stopFlatten} style={{ marginTop: 4 }}>
        Done
      </button>
    </div>
  );
};
