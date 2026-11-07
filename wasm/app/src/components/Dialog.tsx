import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ModalBackdrop } from './ModalBackdrop';
import './dialog.css';

export type DialogProps = React.ComponentProps<typeof ModalBackdrop>;
const layers: HTMLElement[] = [];
const focusable = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])';

function chrome(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, child => {
    if (!React.isValidElement<{ className?: string; children?: React.ReactNode }>(child) || typeof child.type !== 'string') return child;
    const parts = React.Children.toArray(child.props.children);
    if (parts.some(part => React.isValidElement<{ className?: string }>(part) && part.props.className?.split(' ').includes('ds-dialog__body'))) {
      return React.cloneElement(child, { className: `${child.props.className ?? ''} ds-dialog` });
    }
    const head: React.ReactNode[] = [], body: React.ReactNode[] = [], foot: React.ReactNode[] = [];
    for (const part of parts) {
      if (!React.isValidElement<{ className?: string }>(part)) { body.push(part); continue; }
      const name = part.props.className ?? '';
      if (name.includes('ds-dialog__head') || part.type === 'header' || part.type === 'h2' || part.type === 'h3') head.push(part);
      else if (name.includes('ds-dialog__foot') || name.includes('wizard-footer') || part.type === 'footer') foot.push(part);
      else body.push(part);
    }
    const slot = (parts: React.ReactNode[], name: string) => parts.length === 1 && React.isValidElement<{ className?: string }>(parts[0]) && parts[0].props.className?.includes(name)
      ? parts : <div className={name}>{parts}</div>;
    return React.cloneElement(child, {
      className: `${child.props.className ?? ''} ds-dialog`,
      children: <>{head.length > 0 && slot(head, 'ds-dialog__head')}{slot(body, 'ds-dialog__body')}{foot.length > 0 && slot(foot, 'ds-dialog__foot')}</>
    });
  });
}

/** Shared modal layer. Callers supply ds-dialog/head/body/foot so their form state stays local. */
export function Dialog({ children, className = '', role = 'dialog', ...props }: DialogProps) {
  const layer = useRef<HTMLDivElement>(null);
  // React applies autoFocus during commit, before this layout effect runs.
  const openingTrigger = useRef(document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    const root = layer.current!;
    const modal = root.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
    if (modal && !modal.hasAttribute('aria-label') && !modal.hasAttribute('aria-labelledby')) {
      const heading = root.querySelector<HTMLElement>('h1, h2, h3');
      if (heading?.textContent) modal.setAttribute('aria-label', heading.textContent);
    }
    const trigger = openingTrigger.current;
    const background = [...document.body.children].filter(node => node !== root) as HTMLElement[];
    const prior = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    layers.push(root);
    const controls = () => [...root.querySelectorAll<HTMLElement>(focusable)].filter(node => {
      // Closed details can still give their descendants layout rectangles.
      const closedDetails = node.closest('details:not([open])');
      return node.getClientRects().length && !node.closest('[inert]') &&
        (!closedDetails || closedDetails.querySelector(':scope > summary')?.contains(node));
    });
    const active = () => layers[layers.length - 1] === root && !root.inert;
    const focus = () => (root.querySelector<HTMLElement>('[autofocus]') ?? controls()[0] ?? root).focus();
    if (!root.contains(document.activeElement)) focus();
    const contain = (event: FocusEvent) => { if (active() && !root.contains(event.target as Node)) focus(); };
    const tab = (event: KeyboardEvent) => {
      if (!active() || event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); root.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last!.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      event.stopPropagation();
    };
    document.addEventListener('focusin', contain);
    root.addEventListener('keydown', tab);
    return () => {
      document.removeEventListener('focusin', contain);
      root.removeEventListener('keydown', tab);
      layers.splice(layers.indexOf(root), 1);
      background.forEach((node, index) => { node.inert = prior[index]; });
      if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus();
    };
  }, []);
  return createPortal(<div ref={layer} className="dialog-layer" tabIndex={-1}>
    <ModalBackdrop {...props} role={role} aria-modal="true" className={`ds-scrim ${className}`}>
      {chrome(children)}
    </ModalBackdrop>
  </div>, document.body);
}
