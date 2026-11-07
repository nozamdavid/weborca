import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CAMERA_VIEWS, setCameraView } from './cameraBridge';
import { Icon } from './Icon';
import { usePrefsStore } from '../prefs';
import { useTranslation } from '../i18n';
import { rovingKeyDown, useRovingFocus } from '../components/rovingFocus';

export interface CanvasTool {
  id: string;
  testId?: string;
  label: string;
  shortcut?: string;
  icon: string | React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  data?: Record<string, string | boolean>;
  onClick: () => void;
}

export const CanvasToolbar: React.FC<{ groups: CanvasTool[][] }> = ({ groups }) => {
  const { t } = useTranslation();
  const orientation = usePrefsStore(s => s.display.toolbarOrientation);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [visibleGroups, setVisibleGroups] = useState(groups.length);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useRovingFocus(toolbarRef);
  useRovingFocus(menuRef, open);
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current, view = toolbar?.parentElement;
    if (!toolbar || !view) return;
    const place = () => {
      view.style.setProperty('--tool-panel-top', `${orientation === 'horizontal' ? toolbar.offsetTop + toolbar.offsetHeight + 8 : 64}px`);
      const button = toolbar.querySelector('button')?.getBoundingClientRect();
      const step = (orientation === 'horizontal' ? button?.width : button?.height) ?? 34;
      const available = orientation === 'horizontal' ? view.clientWidth - 148 : view.clientHeight - 96;
      let used = step + 10, count = 0;
      for (const group of groups) {
        const size = group.length * (step + 2) + 10;
        if (used + size > available) break;
        used += size; count++;
      }
      setVisibleGroups(Math.max(1, count));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(view); observer.observe(toolbar);
    return () => { observer.disconnect(); view.style.removeProperty('--tool-panel-top'); };
  }, [orientation, groups]);
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !moreRef.current) return;
    const anchor = moreRef.current.getBoundingClientRect(), menu = menuRef.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(anchor.left, innerWidth - menu.width - 8)), top: Math.max(8, Math.min(anchor.bottom + 8, innerHeight - menu.height - 8)) });
  }, [open, orientation]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation(); moreRef.current?.focus();
      } else if (menuRef.current?.contains(event.target as Node) || moreRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  const toolButton = (tool: CanvasTool, menu = false) => <button key={tool.id} id={tool.id} data-testid={tool.testId}
    className={menu ? `ds-menu__item ${tool.danger ? 'ds-menu__item--danger' : ''}` : 'ds-icon-btn icon-btn'}
    role={menu ? 'menuitem' : undefined} aria-label={t(tool.label)}
    title={tool.shortcut ? `${t(tool.label)} (${tool.shortcut})` : t(tool.label)} aria-pressed={tool.active}
    data-tone={tool.danger ? 'danger' : undefined} data-tip={tool.shortcut ? `${t(tool.label)} (${tool.shortcut})` : t(tool.label)}
    disabled={tool.disabled} onClick={() => { if (menu) { setOpen(false); moreRef.current?.focus(); } tool.onClick(); }}
    {...Object.fromEntries(Object.entries(tool.data ?? {}).map(([k, v]) => [`data-${k}`, String(v)]))}>
    {typeof tool.icon === 'string' ? <Icon name={tool.icon} /> : tool.icon}
    {menu && <><span>{t(tool.label)}</span>{tool.shortcut && <kbd>{tool.shortcut}</kbd>}</>}
  </button>;
  return <>
    <div ref={toolbarRef} className={`canvas-toolbar ds-toolbar ${orientation === 'vertical' ? 'ds-toolbar--vertical' : ''} ${orientation}`}
      id="plate-toolbar" role="toolbar" aria-orientation={orientation} aria-label={t('Tools')} onKeyDown={rovingKeyDown}>
      {groups.slice(0, visibleGroups).map((group, i) => <React.Fragment key={i}>
        {i > 0 && <div className="ds-toolbar__sep" role="separator" />}
        {group.map(tool => toolButton(tool))}
      </React.Fragment>)}
      {visibleGroups < groups.length && <button ref={moreRef} id="tool-more-btn" className="ds-icon-btn icon-btn" aria-label={t('More')}
        title={t('More')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>}
    </div>
    {open && createPortal(<div ref={menuRef} className="ds-menu toolbar-overflow" role="menu" aria-label={t('Tools')}
      style={position} onKeyDown={rovingKeyDown}>
      {groups.slice(visibleGroups).map((group, i) => <React.Fragment key={i}>
        {i > 0 && <div className="ds-menu__sep" role="separator" />}{group.map(tool => toolButton(tool, true))}
      </React.Fragment>)}
    </div>, document.body)}
  </>;
};

export const ViewButtons: React.FC = () => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useRovingFocus(ref);
  return <div ref={ref} className="view-buttons ds-toolbar ds-toolbar--labels" role="toolbar" aria-orientation="horizontal" aria-label={t('Camera views')} onKeyDown={rovingKeyDown}>
    {CAMERA_VIEWS.map(v => <button key={v.label} id={`view-${v.label.toLowerCase()}`} title={`${t(v.label)} (${v.key})`} onClick={() => setCameraView(v.view)}>{t(v.label)}</button>)}
    <button id="view-fit" title={t('Zoom to selection (Z)')} onClick={() => setCameraView('Z')}>{t('Fit')}</button>
  </div>;
};
