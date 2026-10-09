/**
 * @file TextPanel.tsx
 * Floating control panel for 3D Text & Emboss tool in OrcaSlicer Web.
 * Mirrors desktop OrcaSlicer GLGizmoEmboss controls:
 * multi-line text input, font picker, size/depth sliders, char/line gap,
 * bold/skew, alignment, surface projection toggle, and volume type selector.
 */

import React, { useEffect, useRef } from 'react';
import { useTextStore } from './textStore';
import type { TextVolumeType } from './types';

export const TextPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Text store state
  const isOpen = useTextStore((s) => s.isOpen);
  const targetObjectId = useTextStore((s) => s.targetObjectId);
  const targetVolumeId = useTextStore((s) => s.targetVolumeId);
  const text = useTextStore((s) => s.text);
  const selectedFont = useTextStore((s) => s.selectedFont);
  const fontMissingName = useTextStore((s) => s.fontMissingName);
  const size = useTextStore((s) => s.size);
  const depth = useTextStore((s) => s.depth);
  const charGap = useTextStore((s) => s.charGap);
  const lineGap = useTextStore((s) => s.lineGap);
  const boldness = useTextStore((s) => s.boldness);
  const skew = useTextStore((s) => s.skew);
  const align = useTextStore((s) => s.align);
  const volumeType = useTextStore((s) => s.volumeType);
  const rotation = useTextStore((s) => s.rotation);
  const fonts = useTextStore((s) => s.fonts);
  const isFontsLoaded = useTextStore((s) => s.isFontsLoaded);
  const isLoading = useTextStore((s) => s.isLoading);
  const error = useTextStore((s) => s.error);

  // Actions
  const close = useTextStore((s) => s.close);
  const setText = useTextStore((s) => s.setText);
  const setFont = useTextStore((s) => s.setFont);
  const setSize = useTextStore((s) => s.setSize);
  const setDepth = useTextStore((s) => s.setDepth);
  const setCharGap = useTextStore((s) => s.setCharGap);
  const setLineGap = useTextStore((s) => s.setLineGap);
  const setBoldness = useTextStore((s) => s.setBoldness);
  const setSkew = useTextStore((s) => s.setSkew);
  const setAlign = useTextStore((s) => s.setAlign);
  const setVolumeType = useTextStore((s) => s.setVolumeType);
  const setRotation = useTextStore((s) => s.setRotation);
  const setError = useTextStore((s) => s.setError);
  const resetParams = useTextStore((s) => s.resetParams);
  const loadFonts = useTextStore((s) => s.loadFonts);
  const loadCustomFontFile = useTextStore((s) => s.loadCustomFontFile);
  const addText = useTextStore((s) => s.addText);
  const updateText = useTextStore((s) => s.updateText);

  // Preload font manifest when opened
  useEffect(() => {
    if (isOpen && !isFontsLoaded) {
      void loadFonts();
    }
  }, [isOpen, isFontsLoaded, loadFonts]);

  if (!isOpen) {
    return null;
  }

  const isEditing = targetVolumeId !== null;

  const handleFontSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const fontId = e.target.value;
    const font = fonts.find((f) => f.id === fontId);
    if (font) {
      void setFont(font);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await loadCustomFontFile(file);
      } catch (err: any) {
        setError(err?.message || 'Failed to load font file');
      }
    }
    // reset input value so re-uploading the same font file triggers onChange
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isBold = boldness > 0.05;
  const isItalic = Math.abs(skew) > 0.05;

  return (
    <div
      id="text-emboss-panel"
      data-testid="text-emboss-panel"
      role="region"
      aria-label="3D Text and Emboss Tool"
      style={{
        position: 'absolute',
        top: 60,
        right: 16,
        width: 320,
        maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto',
        background: 'rgba(24, 24, 27, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 10,
        padding: '14px 16px',
        color: '#f4f4f5',
        fontSize: '0.82rem',
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
        zIndex: 40,
        userSelect: 'none'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '1.1rem' }}>🔤</span>
          <strong id="text-panel-title" style={{ fontSize: '0.92rem', color: '#38bdf8' }}>
            {isEditing ? 'Edit 3D Text' : '3D Text / Emboss'}
          </strong>
          {isEditing && (
            <span
              style={{
                fontSize: '0.7rem',
                padding: '2px 6px',
                borderRadius: 4,
                background: '#0369a1',
                color: '#e0f2fe'
              }}
            >
              {targetObjectId !== null ? `Obj #${targetObjectId} • ` : ''}Vol #{targetVolumeId}
            </span>
          )}
        </div>
        <button
          id="close-text-btn"
          data-testid="close-text-btn"
          onClick={close}
          title="Close text tool"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: '2px 6px',
            lineHeight: 1
          }}
        >
          ✕
        </button>
      </div>

      {/* Recoverable Missing Font Banner across sessions */}
      {fontMissingName && (
        <div
          id="font-reselect-banner"
          data-testid="font-reselect-banner"
          role="alert"
          style={{
            backgroundColor: '#451a03',
            border: '1px solid #f59e0b',
            borderRadius: 6,
            color: '#fef3c7',
            padding: '10px 12px',
            marginBottom: 12,
            fontSize: '0.8rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span>⚠️</span>
            <strong style={{ color: '#fbbf24' }}>Custom Font Required</strong>
          </div>
          <div style={{ marginBottom: 8, color: '#fde68a', fontSize: '0.78rem', lineHeight: 1.3 }}>
            Font <strong>"{fontMissingName}"</strong> is not embedded in the 3MF project archive. Please reselect the font file to edit text geometry.
          </div>
          <button
            id="reselect-font-btn"
            data-testid="reselect-font-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: '#f59e0b',
              color: '#1c1917',
              fontWeight: 600,
              border: 'none',
              borderRadius: 4,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '0.78rem'
            }}
          >
            📁 Reselect Font File…
          </button>
        </div>
      )}

      {/* Engine Error Banner */}
      {error && !fontMissingName && (
        <div
          id="text-error-banner"
          data-testid="text-error-banner"
          role="alert"
          style={{
            backgroundColor: '#7f1d1d',
            border: '1px solid #ef4444',
            borderRadius: 6,
            color: '#fecaca',
            padding: '8px 12px',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.8rem',
            fontWeight: 500
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⚠️</span>
            <span id="text-error-message">{error}</span>
          </div>
          <button
            id="dismiss-text-error-btn"
            onClick={() => setError(null)}
            style={{
              background: 'transparent',
              border: '1px solid #f87171',
              color: '#fecaca',
              borderRadius: 4,
              padding: '1px 6px',
              cursor: 'pointer',
              fontSize: '0.75rem'
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Text String Input (Multi-line) */}
      <div style={{ marginBottom: 12 }}>
        <label
          htmlFor="text-input"
          style={{ display: 'block', marginBottom: 4, color: '#a1a1aa', fontWeight: 500 }}
        >
          Text:
        </label>
        <textarea
          id="text-input"
          data-testid="text-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#18181b',
            border: '1px solid #3f3f46',
            borderRadius: 6,
            padding: '8px 10px',
            color: '#f4f4f5',
            fontSize: '0.85rem',
            resize: 'vertical',
            outline: 'none',
            fontFamily: 'inherit'
          }}
        />
      </div>

      {/* Font Select & Load Font File */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4
          }}
        >
          <label
            htmlFor="font-select"
            style={{ color: '#a1a1aa', fontWeight: 500 }}
          >
            Font:
          </label>
          <button
            id="load-font-btn"
            data-testid="load-font-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Load custom TrueType / OpenType font file (.ttf, .otf)"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 4,
              color: '#38bdf8',
              fontSize: '0.75rem',
              padding: '2px 8px',
              cursor: 'pointer'
            }}
          >
            📁 Load font file…
          </button>
          <input
            ref={fileInputRef}
            id="custom-font-file-input"
            data-testid="custom-font-file-input"
            type="file"
            accept=".ttf,.otf,.ttc"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
        <select
          id="font-select"
          data-testid="font-select"
          value={selectedFont?.id || ''}
          onChange={handleFontSelect}
          style={{
            width: '100%',
            background: '#18181b',
            border: fontMissingName && !selectedFont ? '1px solid #f59e0b' : '1px solid #3f3f46',
            borderRadius: 6,
            padding: '6px 8px',
            color: '#f4f4f5',
            fontSize: '0.82rem',
            outline: 'none',
            cursor: 'pointer'
          }}
        >
          {fontMissingName && !selectedFont && (
            <option value="" disabled>
              ⚠️ Select font ({fontMissingName})
            </option>
          )}
          {fonts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} {f.license ? `(${f.license})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Dimensions: Size & Depth */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#a1a1aa' }}>Size:</span>
            <span id="text-size-val" style={{ color: '#38bdf8', fontWeight: 500 }}>
              {size.toFixed(1)} mm
            </span>
          </div>
          <input
            id="size-slider"
            data-testid="size-slider"
            type="range"
            min="1.0"
            max="60.0"
            step="0.5"
            value={size}
            onChange={(e) => setSize(parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#a1a1aa' }}>Depth:</span>
            <span id="text-depth-val" style={{ color: '#38bdf8', fontWeight: 500 }}>
              {depth.toFixed(2)} mm
            </span>
          </div>
          <input
            id="depth-slider"
            data-testid="depth-slider"
            type="range"
            min="0.1"
            max="15.0"
            step="0.1"
            value={depth}
            onChange={(e) => setDepth(parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>
      </div>

      {/* Spacing: Character Gap & Line Gap */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#a1a1aa' }}>Char Gap:</span>
            <span id="text-char-gap-val" style={{ color: '#94a3b8' }}>
              {charGap} pt
            </span>
          </div>
          <input
            id="char-gap-slider"
            data-testid="char-gap-slider"
            type="range"
            min="-20"
            max="50"
            step="1"
            value={charGap}
            onChange={(e) => setCharGap(parseInt(e.target.value, 10))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#a1a1aa' }}>Line Gap:</span>
            <span id="text-line-gap-val" style={{ color: '#94a3b8' }}>
              {lineGap} pt
            </span>
          </div>
          <input
            id="line-gap-slider"
            data-testid="line-gap-slider"
            type="range"
            min="-20"
            max="50"
            step="1"
            value={lineGap}
            onChange={(e) => setLineGap(parseInt(e.target.value, 10))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>
      </div>

      {/* Rotation Angle */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#a1a1aa' }}>Rotation:</span>
          <span id="text-rotation-val" data-testid="text-rotation-val" style={{ color: '#38bdf8', fontWeight: 500 }}>
            {rotation.toFixed(0)}°
          </span>
        </div>
        <input
          id="rotation-slider"
          data-testid="rotation-slider"
          type="range"
          min="-180"
          max="180"
          step="5"
          value={rotation}
          onChange={(e) => setRotation(parseFloat(e.target.value))}
          style={{ width: '100%', cursor: 'pointer' }}
        />
      </div>

      {/* Style & Alignment Controls */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: '#a1a1aa', fontWeight: 500 }}>Style & Align:</span>

          {/* Bold and Italic toggles */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              id="bold-btn"
              data-testid="bold-btn"
              type="button"
              onClick={() => setBoldness(isBold ? 0.0 : 0.2)}
              title="Toggle Bold style"
              style={{
                width: 28,
                height: 26,
                background: isBold ? '#0284c7' : 'rgba(255, 255, 255, 0.08)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.85rem'
              }}
            >
              B
            </button>
            <button
              id="italic-btn"
              data-testid="italic-btn"
              type="button"
              onClick={() => setSkew(isItalic ? 0.0 : 0.25)}
              title="Toggle Italic / Skew style"
              style={{
                width: 28,
                height: 26,
                background: isItalic ? '#0284c7' : 'rgba(255, 255, 255, 0.08)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 4,
                cursor: 'pointer',
                fontStyle: 'italic',
                fontFamily: 'serif',
                fontSize: '0.85rem'
              }}
            >
              I
            </button>
          </div>
        </div>

        {/* Alignment Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {/* Horizontal Alignment */}
          <div
            id="horizontal-align-group"
            style={{
              display: 'flex',
              background: '#18181b',
              borderRadius: 4,
              border: '1px solid #3f3f46',
              overflow: 'hidden'
            }}
          >
            {(['left', 'center', 'right'] as const).map((h) => {
              const active = align.horizontal === h;
              return (
                <button
                  key={h}
                  id={`align-${h}-btn`}
                  type="button"
                  onClick={() => setAlign({ ...align, horizontal: h })}
                  title={`Align ${h}`}
                  style={{
                    flex: 1,
                    background: active ? '#0284c7' : 'transparent',
                    color: active ? '#fff' : '#94a3b8',
                    border: 'none',
                    padding: '4px 0',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    textTransform: 'capitalize'
                  }}
                >
                  {h === 'left' ? '⇤ L' : h === 'center' ? '⇥⇤ C' : '⇥ R'}
                </button>
              );
            })}
          </div>

          {/* Vertical Alignment */}
          <div
            id="vertical-align-group"
            style={{
              display: 'flex',
              background: '#18181b',
              borderRadius: 4,
              border: '1px solid #3f3f46',
              overflow: 'hidden'
            }}
          >
            {(['top', 'center', 'bottom'] as const).map((v) => {
              const active = align.vertical === v;
              return (
                <button
                  key={v}
                  id={`align-v-${v}-btn`}
                  type="button"
                  onClick={() => setAlign({ ...align, vertical: v })}
                  title={`Vertical ${v}`}
                  style={{
                    flex: 1,
                    background: active ? '#0284c7' : 'transparent',
                    color: active ? '#fff' : '#94a3b8',
                    border: 'none',
                    padding: '4px 0',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    textTransform: 'capitalize'
                  }}
                >
                  {v === 'top' ? '↥ Top' : v === 'center' ? '⬍ Mid' : '↧ Bot'}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Surface Projection (Conform to Surface) - Planar Only in Web */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          background: 'rgba(255, 255, 255, 0.04)',
          borderRadius: 6,
          marginBottom: 12,
          opacity: 0.7
        }}
        title="Curved surface projection is not supported in the WebAssembly engine. Planar extrusion is used."
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label
              htmlFor="surface-toggle"
              style={{ fontWeight: 500, color: '#a1a1aa', cursor: 'not-allowed' }}
            >
              Conform to Surface
            </label>
            <span
              style={{
                fontSize: '0.65rem',
                padding: '1px 5px',
                borderRadius: 3,
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)'
              }}
            >
              Planar Only
            </span>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#71717a' }}>
            Planar extrusion (curved surface wrap unavailable in Web)
          </div>
        </div>
        <input
          id="surface-toggle"
          data-testid="surface-toggle"
          type="checkbox"
          checked={false}
          disabled={true}
          readOnly={true}
          style={{ width: 16, height: 16, cursor: 'not-allowed', opacity: 0.5 }}
        />
      </div>

      {/* Volume Type Selector */}
      <div style={{ marginBottom: 14 }}>
        <span style={{ display: 'block', marginBottom: 6, color: '#a1a1aa', fontWeight: 500 }}>
          Operation / Type:
        </span>
        {targetObjectId === null ? (
          <div
            id="volume-type-unattached"
            data-testid="volume-type-unattached"
            style={{
              padding: '6px 10px',
              background: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: 4,
              color: '#38bdf8',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span>✨</span>
            <span>New Object on Print Bed (No parent object selected)</span>
          </div>
        ) : (
          <div
            id="volume-type-selector"
            data-testid="volume-type-selector"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 4
            }}
          >
            {(
              [
                { type: 'part', label: 'Part (Join)', color: '#22c55e' },
                { type: 'negative', label: 'Cut (Negative)', color: '#ef4444' },
                { type: 'modifier', label: 'Modifier', color: '#38bdf8' }
              ] as const
            ).map((item) => {
              const active = volumeType === item.type;
              return (
                <button
                  key={item.type}
                  id={`type-${item.type}-btn`}
                  data-testid={`type-${item.type}-btn`}
                  type="button"
                  onClick={() => setVolumeType(item.type as TextVolumeType)}
                  style={{
                    background: active ? item.color : '#18181b',
                    color: active ? '#fff' : '#a1a1aa',
                    border: active ? `1px solid ${item.color}` : '1px solid #3f3f46',
                    borderRadius: 4,
                    padding: '6px 2px',
                    cursor: 'pointer',
                    fontSize: '0.74rem',
                    fontWeight: active ? 600 : 400,
                    transition: 'background 0.15s ease'
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Footer Buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {isEditing ? (
          <button
            id="update-text-btn"
            data-testid="update-text-btn"
            type="button"
            disabled={isLoading || (!!fontMissingName && !selectedFont)}
            onClick={() => void updateText(true)}
            style={{
              flex: 2,
              background: '#009688',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isLoading || (!!fontMissingName && !selectedFont) ? 'default' : 'pointer',
              opacity: isLoading || (!!fontMissingName && !selectedFont) ? 0.6 : 1
            }}
          >
            {isLoading ? 'Updating…' : 'Update Mesh'}
          </button>
        ) : (
          <button
            id="add-text-btn"
            data-testid="add-text-btn"
            type="button"
            disabled={isLoading || (!!fontMissingName && !selectedFont)}
            onClick={() => void addText()}
            style={{
              flex: 2,
              background: '#009688',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isLoading || (!!fontMissingName && !selectedFont) ? 'default' : 'pointer',
              opacity: isLoading || (!!fontMissingName && !selectedFont) ? 0.6 : 1
            }}
          >
            {isLoading ? 'Generating…' : 'Add Text'}
          </button>
        )}

        <button
          id="reset-text-btn"
          data-testid="reset-text-btn"
          type="button"
          disabled={isLoading}
          onClick={resetParams}
          title="Reset options to defaults"
          style={{
            flex: 1,
            background: 'transparent',
            color: '#a1a1aa',
            border: '1px solid #3f3f46',
            borderRadius: 6,
            padding: '8px 8px',
            fontSize: '0.82rem',
            cursor: 'pointer'
          }}
        >
          Reset
        </button>

        <button
          id="close-panel-btn"
          data-testid="close-panel-btn"
          type="button"
          onClick={close}
          style={{
            flex: 1,
            background: 'transparent',
            color: '#ef4444',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            padding: '8px 8px',
            fontSize: '0.82rem',
            cursor: 'pointer'
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};
