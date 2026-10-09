/**
 * @file RepairBadge.tsx
 * UI component displaying mesh health status and a one-click CGAL repair trigger
 * for the currently selected object.
 */

import React from 'react';
import { useRepairStore } from './repairStore';
import { useCutStore } from '../cut';

export const RepairBadge: React.FC = () => {
  const selectedObjectId = useRepairStore((s) => s.selectedObjectId);
  const health = useRepairStore((s) => s.health);
  const isChecking = useRepairStore((s) => s.isChecking);
  const isRepairing = useRepairStore((s) => s.isRepairing);
  const error = useRepairStore((s) => s.error);
  const lastRepairResult = useRepairStore((s) => s.lastRepairResult);
  const repairSelected = useRepairStore((s) => s.repairSelected);
  const checkHealth = useRepairStore((s) => s.checkHealth);
  const isCutting = useCutStore((s) => s.isCutting);

  if (selectedObjectId === null) {
    return null;
  }

  if (isChecking && !health) {
    return (
      <div
        id="repair-badge-checking"
        data-testid="repair-badge-checking"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          backgroundColor: '#1f2937',
          color: '#9ca3af'
        }}
      >
        <span>Checking mesh health...</span>
      </div>
    );
  }

  if (!health) {
    return (
      <button
        id="check-mesh-btn"
        data-testid="check-mesh-btn"
        onClick={() => checkHealth(selectedObjectId)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          backgroundColor: '#374151',
          color: '#e5e7eb',
          border: '1px solid #4b5563',
          cursor: 'pointer'
        }}
      >
        Check Mesh
      </button>
    );
  }

  const isHealthy = health.isManifold && health.openEdges === 0 && health.degenerateFacets === 0;

  if (isHealthy) {
    return (
      <div
        id="repair-badge-manifold"
        data-testid="repair-badge-manifold"
        title="Mesh boundary check passed (0 open edges, 0 degenerate facets; does not guarantee zero internal self-intersections)"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '12px',
          fontWeight: 500,
          backgroundColor: '#064e3b',
          border: '1px solid #059669',
          color: '#6ee7b7'
        }}
      >
        <span>✓</span>
        <span>Watertight</span>
      </div>
    );
  }

  const issueText = health.openEdges > 0
    ? `${health.openEdges} open edge${health.openEdges === 1 ? '' : 's'}`
    : `${health.degenerateFacets} degenerate facet${health.degenerateFacets === 1 ? '' : 's'}`;

  return (
    <div
      id="repair-badge-warning"
      data-testid="repair-badge-warning"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        backgroundColor: '#451a03',
        border: '1px solid #b45309',
        color: '#fde68a'
      }}
    >
      <span title="Mesh contains topological defects (non-manifold boundary or degenerate facets)">
        ⚠️ {issueText}
      </span>
      <button
        id="repair-object-btn"
        data-testid="repair-object-btn"
        disabled={isRepairing || isCutting}
        onClick={() => void repairSelected(true)}
        style={{
          padding: '2px 8px',
          backgroundColor: isRepairing || isCutting ? '#6b7280' : '#d97706',
          color: '#ffffff',
          border: 'none',
          borderRadius: '3px',
          cursor: isRepairing || isCutting ? 'not-allowed' : 'pointer',
          fontWeight: 600,
          fontSize: '11px',
          transition: 'background-color 0.15s ease'
        }}
      >
        {isRepairing ? 'Repairing...' : 'Repair'}
      </button>
      {lastRepairResult?.wasRepaired && (
        <span
          id="repair-badge-repaired"
          data-testid="repair-badge-repaired"
          title="Mesh repaired: geometry cleaned and volume IDs updated"
          style={{
            color: '#86efac',
            fontSize: '11px',
            marginLeft: '4px'
          }}
        >
          (Repaired)
        </span>
      )}
      {error && (
        <span
          id="repair-badge-error"
          data-testid="repair-badge-error"
          title={error}
          style={{
            color: '#f87171',
            fontSize: '11px',
            marginLeft: '4px'
          }}
        >
          (failed)
        </span>
      )}
    </div>
  );
};

export default RepairBadge;
