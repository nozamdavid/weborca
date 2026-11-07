import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ModalBackdrop } from '../components/ModalBackdrop';
import { useTranslation } from '../i18n';
import { useMobile } from './useMobile';
import './mobileControls.css';

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  onValueChange?: (value: string) => void;
  'data-testid'?: string;
};
type Choice = { value: string; label: string; group?: string; disabled: boolean };

function choices(children: React.ReactNode, group?: string, disabled = false): Choice[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement(child)) return [];
    if (child.type === 'option') return [{ value: String(child.props.value ?? child.props.children),
      label: React.Children.toArray(child.props.children).join(''), group, disabled: disabled || !!child.props.disabled }];
    return choices(child.props.children, child.type === 'optgroup' ? child.props.label : group, disabled || !!child.props.disabled);
  });
}

/** Desktop keeps its native select; phones get a full-screen, cancellable choice. */
export function MobileSelect({ children, onValueChange, ...props }: Props) {
  const mobile = useMobile();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const options = choices(children);
  const value = String(props.value ?? '');
  const selected = options.find(option => option.value === value);
  useEffect(() => { if (!mobile) setOpen(false); }, [mobile]);
  useEffect(() => {
    if (!open) return;
    const portal = dialog.current!;
    const background = [...document.body.children].filter(node => node !== portal) as HTMLElement[];
    const inert = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    portal.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)')?.scrollIntoView({ block: 'nearest' });
    portal.querySelector<HTMLButtonElement>('.mobile-selector-close')?.focus();
    const contain = (event: FocusEvent) => {
      if (!portal.contains(event.target as Node)) portal.querySelector<HTMLButtonElement>('button')?.focus();
    };
    document.addEventListener('focusin', contain);
    return () => {
      background.forEach((node, index) => { node.inert = inert[index]; });
      document.body.style.overflow = overflow;
      document.removeEventListener('focusin', contain);
      trigger.current?.focus();
    };
  }, [open]);
  if (!mobile) return <select {...props} onChange={event => onValueChange?.(event.target.value)}>{children}</select>;
  const close = () => setOpen(false);
  const filtered = options.filter(option => `${option.label} ${option.group ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <>
    <button ref={trigger} type="button" id={props.id} data-testid={props['data-testid']}
      className={`mobile-select ds-dropdown ${props.className ?? ''}`} disabled={props.disabled} aria-label={props['aria-label']}
      aria-busy={props['aria-busy']} aria-haspopup="dialog" aria-expanded={open} data-value={value}
      onClick={() => {
        const label = trigger.current?.closest('label')?.childNodes[0]?.textContent ||
          (props.id ? document.querySelector<HTMLLabelElement>(`label[for="${props.id}"]`)?.textContent : '');
        setTitle(String(props['aria-label'] || label || t('Select an option')));
        setQuery(''); setOpen(true);
      }}>
      <span className="ds-dropdown__value">{selected?.label || value || t('Select an option')}</span>
      <svg className="mobile-select-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && createPortal(<ModalBackdrop className="mobile-selector" role="dialog" aria-modal="true"
      aria-labelledby={titleId} onClose={close} onKeyDownCapture={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation(); close(); }
        if (event.key === 'Tab') {
          const elements = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
          const first = elements[0], last = elements[elements.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <div ref={node => { dialog.current = node?.parentElement as HTMLDivElement; }} className="mobile-selector-content">
        <header><h2 id={titleId}>{title}</h2><button type="button" className="mobile-selector-close ds-btn" aria-label={t('Close')} onClick={close}>×</button></header>
        {options.length > 8 && <input className="mobile-input ds-input mobile-selector-search" type="search" aria-label={t('Search options')} placeholder={t('Search options')} value={query} onChange={event => setQuery(event.target.value)} />}
        <div className="mobile-selector-list" role="listbox" aria-label={title}>
          {filtered.map((option, index) => <React.Fragment key={`${option.value}:${index}`}>
            {option.group && filtered[index - 1]?.group !== option.group && <div className="mobile-selector-group">{option.group}</div>}
            {!option.group && filtered[index - 1]?.group && <div className="mobile-selector-separator" role="separator" />}
            <button className="ds-row" type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} data-value={option.value}
              onClick={() => { flushSync(close); if (option.value !== value) onValueChange?.(option.value); }}>
              <span>{option.label}</span>{option.value === value && <span aria-hidden="true">✓</span>}
            </button>
          </React.Fragment>)}
          {!filtered.length && <p role="status">{t('No matching options')}</p>}
        </div>
      </div>
    </ModalBackdrop>, document.body)}
  </>;
}
