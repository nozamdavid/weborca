import React from 'react';
import { usePaintingStore } from './paintingStore';
import type { PaintTarget } from './types';
import { useTranslation } from "../i18n";

export const SupportPaintingPanel: React.FC = () => {
    const { t } = useTranslation();
  const isPaintingActive = usePaintingStore((s) => s.isPaintingActive);
  const paintTarget = usePaintingStore((s) => s.paintTarget);
  const setPaintTarget = usePaintingStore((s) => s.setPaintTarget);
  const paintMode = usePaintingStore((s) => s.paintMode);
  const setPaintMode = usePaintingStore((s) => s.setPaintMode);
  const selectedVolumeId = usePaintingStore((s) => s.selectedVolumeId);
  const volumes = usePaintingStore((s) => s.volumes);
  const selectVolume = usePaintingStore((s) => s.selectVolume);
  const paintingData = usePaintingStore((s) => s.paintingData);
  const clearVolume = usePaintingStore((s) => s.clearVolume);
  const stopPainting = usePaintingStore((s) => s.stopPainting);
  const isLoading = usePaintingStore((s) => s.isLoading);
  const error = usePaintingStore((s) => s.error);

  if (!isPaintingActive) {
    return null;
  }

  const enforcersCount = paintingData?.statistics?.enforcersCount ?? paintingData?.enforcers?.length ?? 0;
  const blockersCount = paintingData?.statistics?.blockersCount ?? paintingData?.blockers?.length ?? 0;
  const triangleCount = paintingData?.triangleCount ?? 0;

  return (
    <div
      id="painting-panel"
      className="painting-panel"
      style={{
        position: 'absolute',
        top: 60,
        right: 16,
        background: 'rgba(24, 24, 27, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 10,
        padding: '10px 14px',
        color: 'var(--text-color)',
        width: 240,
        fontSize: '0.85rem',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
        zIndex: 40
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '1.1rem' }}>{t("🖌️")}</span>
          <strong id="painting-panel-title" style={{ fontSize: '0.95rem', color: '#38bdf8' }}>
            {paintTarget === 'seam' ? 'Seam Face Painting' : 'Support Face Painting'}
          </strong>
        </div>
        <span
          style={{
            fontSize: '0.7rem',
            padding: '2px 6px',
            background: error ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.15)',
            color: error ? '#fca5a5' : '#38bdf8',
            borderRadius: 4,
            fontWeight: 500
          }}
        >
          {error ? 'Disabled' : 'Face Mode'}
        </span>
      </div>

      {error && (
        <div
          id="painting-error-banner"
          style={{
            background: 'rgba(239, 68, 68, 0.2)',
            color: '#fca5a5',
            padding: '6px 8px',
            borderRadius: 6,
            marginBottom: 8,
            fontSize: '0.75rem',
            lineHeight: '1.4'
          }}
        >
          {error}
        </div>
      )}

      {/* Target Selector: Support vs Seam */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 4 }}>{t("Painting Target")}</div>
        <div
          role="group"
          aria-label={t("Painting Target")}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}
        >
          <button
            type="button"
            id="paint-target-support"
            aria-pressed={paintTarget === 'support'}
            className={`btn-paint-target ${paintTarget === 'support' ? 'active' : ''}`}
            onClick={() => setPaintTarget('support')}
            disabled={isLoading}
            style={{
              padding: '4px 6px',
              background: paintTarget === 'support' ? '#0284c7' : 'var(--panel-bg)',
              color: '#fff',
              border: paintTarget === 'support' ? '1px solid #38bdf8' : '1px solid var(--control-bg)',
              borderRadius: 6,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: 500,
              opacity: isLoading ? 0.6 : 1
            }}
          >
            {t("Support")}</button>
          <button
            type="button"
            id="paint-target-seam"
            aria-pressed={paintTarget === 'seam'}
            className={`btn-paint-target ${paintTarget === 'seam' ? 'active' : ''}`}
            onClick={() => setPaintTarget('seam')}
            disabled={isLoading}
            style={{
              padding: '4px 6px',
              background: paintTarget === 'seam' ? '#0284c7' : 'var(--panel-bg)',
              color: '#fff',
              border: paintTarget === 'seam' ? '1px solid #38bdf8' : '1px solid var(--control-bg)',
              borderRadius: 6,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: 500,
              opacity: isLoading ? 0.6 : 1
            }}
          >
            {t("Seam")}</button>
        </div>
        {/* Accessible selection fallback for screen readers / automation, hidden from visible layout to remove duplicate control */}
        <select
          id="paint-target-select"
          aria-label={t("Painting Target")}
          value={paintTarget}
          onChange={(e) => setPaintTarget(e.target.value as PaintTarget)}
          disabled={isLoading}
          tabIndex={-1}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            border: 0,
            whiteSpace: 'nowrap'
          }}
        >
          <option value="support">{t("Support")}</option>
          <option value="seam">{t("Seam")}</option>
        </select>
      </div>

      {/* Target Volume Selector */}
      {volumes.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <label
            htmlFor="paint-volume-select"
            style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: 3 }}
          >
            {t("Target Volume")}</label>
          <select
            id="paint-volume-select"
            value={selectedVolumeId ?? ''}
            onChange={(e) => selectVolume(Number(e.target.value))}
            disabled={isLoading || !!error || volumes.length <= 1}
            style={{
              width: '100%',
              background: 'var(--panel-bg)',
              color: 'var(--text-color)',
              border: '1px solid var(--control-bg)',
              borderRadius: 6,
              padding: '4px 6px',
              fontSize: '0.75rem',
              opacity: isLoading || !!error ? 0.6 : 1
            }}
          >
            {volumes.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} {t("(ID:")}{v.id})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Mode Selector Buttons */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 4 }}>{t("Paint Mode")}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          <button
            type="button"
            id="paint-mode-enforce"
            className={`btn-paint-mode ${paintMode === 'enforce' ? 'active' : ''}`}
            onClick={() => setPaintMode('enforce')}
            disabled={isLoading || !!error}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '5px 4px',
              background: paintMode === 'enforce' ? '#15803d' : 'var(--panel-bg)',
              color: '#fff',
              border: paintMode === 'enforce' ? '1px solid #22c55e' : '1px solid var(--control-bg)',
              borderRadius: 6,
              cursor: isLoading || !!error ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: 500,
              opacity: isLoading || !!error ? 0.5 : 1
            }}
          >
            <span style={{ fontSize: '0.9rem', marginBottom: 2 }}>{t("🟢")}</span>
            <span>{t("Enforce")}</span>
          </button>

          <button
            type="button"
            id="paint-mode-block"
            className={`btn-paint-mode ${paintMode === 'block' ? 'active' : ''}`}
            onClick={() => setPaintMode('block')}
            disabled={isLoading || !!error}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '5px 4px',
              background: paintMode === 'block' ? '#b91c1c' : 'var(--panel-bg)',
              color: '#fff',
              border: paintMode === 'block' ? '1px solid #ef4444' : '1px solid var(--control-bg)',
              borderRadius: 6,
              cursor: isLoading || !!error ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: 500,
              opacity: isLoading || !!error ? 0.5 : 1
            }}
          >
            <span style={{ fontSize: '0.9rem', marginBottom: 2 }}>{t("🔴")}</span>
            <span>{t("Block")}</span>
          </button>

          <button
            type="button"
            id="paint-mode-erase"
            className={`btn-paint-mode ${paintMode === 'erase' ? 'active' : ''}`}
            onClick={() => setPaintMode('erase')}
            disabled={isLoading || !!error}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '5px 4px',
              background: paintMode === 'erase' ? '#475569' : 'var(--panel-bg)',
              color: '#fff',
              border: paintMode === 'erase' ? '1px solid #94a3b8' : '1px solid var(--control-bg)',
              borderRadius: 6,
              cursor: isLoading || !!error ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: 500,
              opacity: isLoading || !!error ? 0.5 : 1
            }}
          >
            <span style={{ fontSize: '0.9rem', marginBottom: 2 }}>⚪</span>
            <span>{t("Erase")}</span>
          </button>
        </div>
      </div>

      {/* Annotation Stats */}
      <div
        id="paint-stats"
        style={{
          background: 'rgba(0, 0, 0, 0.25)',
          padding: '6px 8px',
          borderRadius: 6,
          marginBottom: 8,
          fontSize: '0.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#94a3b8' }}>{t("Mesh Triangles:")}</span>
          <span id="stat-triangle-count" style={{ fontWeight: 600 }}>{triangleCount}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#86efac' }}>{t("Enforced:")}</span>
          <span id="stat-enforcers-count" style={{ fontWeight: 600, color: '#86efac' }}>
            {enforcersCount}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#fca5a5' }}>{t("Blocked:")}</span>
          <span id="stat-blockers-count" style={{ fontWeight: 600, color: '#fca5a5' }}>
            {blockersCount}
          </span>
        </div>
      </div>

      {/* Honest Scope Label & Hint */}
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          lineHeight: '1.25',
          marginBottom: 8,
          borderLeft: '2px solid #38bdf8',
          paddingLeft: 6
        }}
      >
        {t("Face painting operates on complete mesh triangles. Brush radius, sub-triangle, and filament painting are not supported in this version.")}</div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          id="paint-clear-btn"
          onClick={() => clearVolume()}
          disabled={isLoading || !!error || (enforcersCount === 0 && blockersCount === 0)}
          title={`Clear all ${paintTarget} annotations on this volume`}
          style={{
            flex: 1,
            background: 'transparent',
            border: '1px solid #ef4444',
            color: enforcersCount === 0 && blockersCount === 0 ? '#64748b' : '#ef4444',
            borderRadius: 6,
            padding: '5px 8px',
            fontSize: '0.75rem',
            cursor: enforcersCount === 0 && blockersCount === 0 || !!error ? 'default' : 'pointer',
            opacity: isLoading || !!error ? 0.5 : 1
          }}
        >
          {t("🗑️ Clear Volume")}</button>
        <button
          type="button"
          id="paint-done-btn"
          onClick={() => stopPainting()}
          style={{
            flex: 1,
            background: '#009688',
            border: 'none',
            color: '#fff',
            borderRadius: 6,
            padding: '5px 8px',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          {t("✓ Done")}</button>
      </div>
    </div>
  );
};
