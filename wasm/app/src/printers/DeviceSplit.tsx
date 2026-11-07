import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';

const WIDTH_KEY = 'orca.device.layout.statusWidth';
const MIN_COLUMN = 280;
const DIVIDER_WIDTH = 12;

function readWidth() {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch { /* Storage may be blocked. */ }
  return 340;
}

/** Owns only the display split; printer state and commands stay with the panel. */
export const DeviceSplit: React.FC<{
  active: boolean;
  collapsed: boolean;
  status: React.ReactNode;
  webUi: React.ReactNode;
}> = ({ active, collapsed, status, webUi }) => {
  const { t } = useTranslation();
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ element: HTMLDivElement; pointerId: number; offset: number } | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(readWidth);
  const [available, setAvailable] = useState(0);
  const [desktop, setDesktop] = useState(() => matchMedia('(min-width: 801px)').matches);
  const [dragging, setDragging] = useState(false);
  const stacked = !desktop || available < MIN_COLUMN * 2;
  const enabled = active && !collapsed && !stacked;
  const max = Math.max(MIN_COLUMN, Math.floor(available - MIN_COLUMN));
  const width = Math.round(Math.max(MIN_COLUMN, Math.min(max, preferredWidth)));

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(Math.max(0, entry.contentRect.width - DIVIDER_WIDTH)));
    observer.observe(element);
    const media = matchMedia('(min-width: 801px)');
    const update = () => setDesktop(media.matches);
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);

  const release = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    setDragging(false);
  };
  useEffect(() => {
    if (!enabled) release();
  }, [enabled]);
  useEffect(() => () => {
    const current = drag.current;
    drag.current = null;
    if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  }, []);

  const resize = (value: number) => {
    const next = Math.round(Math.max(MIN_COLUMN, Math.min(max, value)));
    setPreferredWidth(next);
    try { localStorage.setItem(WIDTH_KEY, String(next)); } catch { /* Keep the usable in-memory layout. */ }
  };

  return <div ref={body} id="device-body"
    className={`device-body${collapsed ? ' ui-collapsed' : ''}${stacked ? ' device-stacked' : ''}${dragging ? ' device-resizing' : ''}`}
    style={{ '--device-status-width': `${width}px` } as React.CSSProperties}>
    {status}
    {enabled && <div id="device-splitter" className="device-splitter" role="separator" tabIndex={0}
      aria-orientation="vertical" aria-label={t('Resize printer information and web UI')}
      aria-controls="device-status" aria-valuemin={MIN_COLUMN} aria-valuemax={Math.floor(max)} aria-valuenow={width}
      onKeyDown={event => {
        const next = event.key === 'Home' ? MIN_COLUMN : event.key === 'End' ? max
          : event.key === 'ArrowLeft' ? width - (event.shiftKey ? 50 : 10)
          : event.key === 'ArrowRight' ? width + (event.shiftKey ? 50 : 10) : null;
        if (next !== null) { event.preventDefault(); resize(next); }
      }}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { element: event.currentTarget, pointerId: event.pointerId, offset: event.clientX - event.currentTarget.getBoundingClientRect().left };
        setDragging(true);
      }}
      onPointerMove={event => {
        const current = drag.current;
        const element = body.current;
        if (!current || current.pointerId !== event.pointerId || !element) return;
        const left = element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft);
        resize(event.clientX - left - current.offset);
      }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
    />}
    {webUi}
    {dragging && <div className="device-drag-shield" aria-hidden="true" />}
  </div>;
};
