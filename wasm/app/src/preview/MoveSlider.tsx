/**
 * @file MoveSlider.tsx
 * Horizontal move slider at the bottom for scrubbing through moves within visible layers.
 */

import React, { useState, useEffect, useRef } from 'react';
import { usePreviewStore } from './previewStore';
import './PreviewControls.css';
import { useTranslation } from "../i18n";

export const MoveSlider: React.FC<{ active?: boolean }> = ({ active = true }) => {
    const { t } = useTranslation();
  const minMove = usePreviewStore((s) => s.minMove);
  const maxMove = usePreviewStore((s) => s.maxMove);
  const currentMove = usePreviewStore((s) => s.currentMove);
  const layersCount = usePreviewStore((s) => s.layersCount);
  const minLayer = usePreviewStore((s) => s.minLayer);
  const maxLayer = usePreviewStore((s) => s.maxLayer);
  const setMove = usePreviewStore((s) => s.setMoveAction);

  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef<number | null>(null);

  const rangeSpan = Math.max(0, maxMove - minMove);
  const currentRelative = Math.max(0, currentMove - minMove);

  const stopPlayback = () => {
    if (playTimerRef.current !== null) {
      clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    }
    setIsPlaying(false);
  };

  // Stop playback when preview or move range changes
  useEffect(() => {
    stopPlayback();
  }, [minMove, maxMove, minLayer, maxLayer, layersCount]);

  // Hidden views remain mounted to preserve the camera and slider position.
  // Playback requires an explicit restart after returning to the view or tab.
  useEffect(() => {
    if (!active || document.hidden) stopPlayback();
    const onVisibilityChange = () => {
      if (document.hidden) stopPlayback();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [active]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (playTimerRef.current !== null) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    stopPlayback();
    setMove(parseInt(e.target.value, 10));
  };

  const togglePlay = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      if (currentMove >= maxMove) {
        setMove(minMove);
      }
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current !== null) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }

    playTimerRef.current = window.setInterval(() => {
      const state = usePreviewStore.getState();
      const currentSpan = Math.max(0, state.maxMove - state.minMove);
      const step = Math.max(1, Math.round(currentSpan / 100));
      const nextMove = state.currentMove + step;
      if (nextMove >= state.maxMove) {
        state.setMoveAction(state.maxMove);
        setIsPlaying(false);
      } else {
        state.setMoveAction(nextMove);
      }
    }, 50);

    return () => {
      if (playTimerRef.current !== null) {
        clearInterval(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying]);

  if (rangeSpan <= 0) return null;

  return (
    <div
      id="move-slider-container"
      className="move-slider-horizontal"
      style={{
        position: 'absolute',
        bottom: 16,
        left: 310,
        right: 90,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'rgba(24, 24, 27, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 8,
        padding: '6px 14px',
        zIndex: 20,
        userSelect: 'none'
      }}
    >
      {/* Play / Pause Toggle Button */}
      <button
        type="button"
        id="btn-play-moves"
        data-testid="btn-play-moves"
        onClick={togglePlay}
        title={isPlaying ? 'Pause animation' : 'Play moves sequentially'}
        style={{
          background: isPlaying ? '#ef4444' : '#009688',
          border: 'none',
          borderRadius: 4,
          color: '#fff',
          padding: '4px 8px',
          fontSize: '0.8rem',
          cursor: 'pointer',
          fontWeight: 600
        }}
      >
        {isPlaying ? '\u23f8' : '\u25b6'}
      </button>

      {/* Label & Move Count */}
      <div
        id="move-info"
        style={{
          fontSize: '0.75rem',
          color: 'var(--text-color)',
          minWidth: 110,
          whiteSpace: 'nowrap'
        }}
      >
        <span>{t("Move:")}</span>
        <span style={{ color: '#38bdf8', fontWeight: 600 }} id="move-current-val">
          {currentRelative.toLocaleString()}
        </span>
        <span style={{ color: 'var(--text-dim)' }}> / {rangeSpan.toLocaleString()}</span>
      </div>

      {/* Slider Input */}
      <input
        type="range"
        aria-label={t("Move in top layer")}
        id="move-slider"
        data-testid="move-slider"
        min={minMove}
        max={maxMove}
        value={currentMove}
        onChange={handleChange}
        style={{
          flex: 1,
          accentColor: '#009688',
          cursor: 'ew-resize'
        }}
        title={`Move ${currentRelative} of ${rangeSpan}`}
      />
    </div>
  );
};
