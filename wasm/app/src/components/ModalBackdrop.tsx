import React, { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';

/** Open modals, bottom to top. Escape only reaches the top one. */
const stack: symbol[] = [];
const handlers = new Map<symbol, () => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || stack.length === 0) return;
    handlers.get(stack[stack.length - 1])?.();
  });
}

interface ConfirmState {
  request: { title: string; message: string; confirmLabel: string; cancelLabel: string; resolve: (ok: boolean) => void } | null;
}
const useConfirmStore = create<ConfirmState>(() => ({ request: null }));

/** Asks the user in an in-app modal (not a browser alert). Resolves true when they confirm. */
export function confirmDialog(opts: { title: string; message: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().request?.resolve(false);
    useConfirmStore.setState({
      request: { confirmLabel: 'Discard', cancelLabel: 'Keep editing', ...opts, resolve }
    });
  });
}

export const confirmDiscard = (what = 'changes'): Promise<boolean> =>
  confirmDialog({ title: 'Discard unsaved changes?', message: `Your ${what} have not been saved and will be lost.` });

/**
 * Backdrop of a dialog. Clicking outside the dialog or pressing Escape asks to close it, and when `dirty` the user is
 * first asked to confirm discarding their changes.
 */
export const ModalBackdrop: React.FC<
  Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> & { onClose: () => void; dirty?: boolean; dirtyWhat?: string }
> = ({ onClose, dirty, dirtyWhat, className = 'modal-backdrop', children, ...rest }) => {
  const latest = useRef({ onClose, dirty, dirtyWhat });
  latest.current = { onClose, dirty, dirtyWhat };
  const asking = useRef(false);

  const requestClose = useCallback(async () => {
    const { onClose: close, dirty: isDirty, dirtyWhat: what } = latest.current;
    if (!isDirty) return close();
    if (asking.current) return;
    asking.current = true;
    const ok = await confirmDiscard(what);
    asking.current = false;
    if (ok) close();
  }, []);

  useEffect(() => {
    const id = Symbol('modal');
    stack.push(id);
    handlers.set(id, requestClose);
    return () => {
      stack.splice(stack.indexOf(id), 1);
      handlers.delete(id);
    };
  }, [requestClose]);

  // Only a press that starts and ends on the backdrop closes, so dragging a text selection out of a field does not.
  const pressedOnBackdrop = useRef(false);
  return (
    <div
      {...rest}
      className={className}
      onMouseDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (pressedOnBackdrop.current && e.target === e.currentTarget) requestClose(); }}
    >
      {children}
    </div>
  );
};

/** Renders the pending confirmation of confirmDialog(). Mount once. */
export const ConfirmHost: React.FC = () => {
  const request = useConfirmStore((s) => s.request);
  if (!request) return null;
  const answer = (ok: boolean) => {
    useConfirmStore.setState({ request: null });
    request.resolve(ok);
  };
  return (
    <ModalBackdrop onClose={() => answer(false)} role="alertdialog" aria-label={request.title} data-testid="confirm-dialog" style={{ zIndex: 2000 }}>
      <div className="modal-content" style={{ maxWidth: 400 }}>
        <h3 style={{ margin: '0 0 10px' }}>{request.title}</h3>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>{request.message}</p>
        <div className="modal-footer">
          <button className="btn btn-secondary" data-testid="confirm-cancel" autoFocus onClick={() => answer(false)}>{request.cancelLabel}</button>
          <button className="btn btn-primary" data-testid="confirm-ok" onClick={() => answer(true)}>{request.confirmLabel}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
