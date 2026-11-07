/** Dismiss only new outside touches; the opening longpress is already in flight. */
export function bindMenuTouchAway(menus: () => (HTMLElement | null)[], close: () => void): () => void {
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return;
    const path = event.composedPath();
    if (menus().some(menu => menu && (path.includes(menu) || menu.contains(event.target as Node)))) return;

    const consume = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    consume(event);
    // These guards outlive the menu's unmount, so release cannot select or click
    // the scene. They own this pointer only and expire on click/cancel/new press.
    const cleanup = () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('pointerdown', cleanup, true);
      window.removeEventListener('blur', cleanup);
    };
    const move = (e: PointerEvent) => { if (e.pointerId === event.pointerId) consume(e); };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      consume(e);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
    };
    const cancel = (e: PointerEvent) => { if (e.pointerId === event.pointerId) { consume(e); cleanup(); } };
    const click = (e: MouseEvent) => {
      if ((e as PointerEvent).pointerId === event.pointerId) { consume(e); cleanup(); }
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('click', click, true);
    document.addEventListener('pointerdown', cleanup, true);
    window.addEventListener('blur', cleanup);
    close();
  };
  document.addEventListener('pointerdown', down, true);
  return () => document.removeEventListener('pointerdown', down, true);
}
