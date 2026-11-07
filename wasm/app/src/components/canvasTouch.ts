type Point = { x: number; y: number };

/** Canvas-only touch sessions. Adding/removing a finger rebases the gesture. */
export function bindCanvasTouch(canvas: HTMLCanvasElement, callbacks: {
  start?: () => void;
  end?: () => void;
  cancelPointer?: (id: number) => void;
  /** Return true to own one finger until release; a second finger rolls it back. */
  singleStart?: (event: PointerEvent) => boolean;
  singleMove?: (event: PointerEvent) => void;
  singleEnd?: (commit: boolean) => void;
  resumePointer?: (event: PointerEvent) => void;
  tap?: (event: PointerEvent) => void;
  longpress?: (point: Point) => void;
  move?: (dx: number, dy: number, ratio: number, fingers: number) => void;
}): () => void {
  const points = new Map<number, Point>();
  let singlePointer: PointerEvent | null = null;
  const suppressedClicks = new Set<number>();
  let origin: Point | null = null;
  let suppressed = false;
  let suppressClick = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const geometry = () => {
    const [a, b] = [...points.values()];
    return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
      : { ...a, distance: 0 };
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || event.target !== canvas) return;
    // Compatibility mousedown would dismiss the menu before our click guard runs.
    event.preventDefault();
    if (!points.size) {
      origin = { x: event.clientX, y: event.clientY };
      suppressed = false;
      suppressClick = false;
      callbacks.start?.();
      if (callbacks.singleStart?.(event)) singlePointer = event;
    } else if (singlePointer) {
      // Roll back the model before rebasing the same fingers as camera input.
      const previous = singlePointer;
      singlePointer = null;
      callbacks.singleEnd?.(false);
      callbacks.resumePointer?.(previous);
    }
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    clearTimer();
    if (points.size > 1) suppressed = suppressClick = true;
    else if (callbacks.longpress && !suppressed) {
      timer = setTimeout(() => {
        timer = undefined;
        suppressed = suppressClick = true;
        if (singlePointer) {
          singlePointer = null;
          callbacks.singleEnd?.(false);
        }
        callbacks.longpress?.(origin!);
      }, 500);
    }
    if (singlePointer) event.stopImmediatePropagation();
  };
  const move = (event: PointerEvent) => {
    if (!points.has(event.pointerId)) return;
    const before = geometry();
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) {
      clearTimer();
      suppressed = suppressClick = true;
    }
    const after = geometry();
    if (singlePointer) {
      singlePointer = event;
      callbacks.singleMove?.(event);
      event.stopImmediatePropagation();
      return;
    }
    if (points.size <= 2) callbacks.move?.(after.x - before.x, after.y - before.y,
      before.distance > 0 && after.distance > 0 ? after.distance / before.distance : 1, points.size);
  };
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!points.has(event.pointerId)) return;
    clearTimer();
    if (singlePointer?.pointerId === event.pointerId) {
      singlePointer = null;
      callbacks.singleEnd?.(!cancelled);
      event.stopImmediatePropagation();
    }
    if (cancelled) {
      suppressed = suppressClick = true;
      callbacks.cancelPointer?.(event.pointerId);
    } else if (!suppressed && points.size === 1) callbacks.tap?.(event);
    if (suppressed) suppressedClicks.add(event.pointerId);
    points.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!points.size) { origin = null; callbacks.end?.(); }
  };
  const up = (event: PointerEvent) => finish(event, false);
  const cancel = (event: PointerEvent) => finish(event, true);
  const reset = () => {
    clearTimer();
    const ids = [...points.keys()];
    points.clear();
    if (singlePointer) {
      singlePointer = null;
      callbacks.singleEnd?.(false);
    }
    origin = null;
    suppressed = suppressClick = true;
    for (const id of ids) {
      suppressedClicks.add(id);
      callbacks.cancelPointer?.(id);
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    if (ids.length) callbacks.end?.();
  };
  const click = (event: MouseEvent) => {
    if (suppressedClicks.delete((event as PointerEvent).pointerId) ||
        (suppressClick && (event as PointerEvent).pointerType !== 'mouse' && event.detail > 0)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const newPress = () => {
    if (!points.size) { suppressClick = false; suppressedClicks.clear(); }
  };
  const menu = (event: MouseEvent) => event.preventDefault();
  canvas.classList.add('ds-touch-canvas');
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('pointermove', move, true);
  canvas.addEventListener('pointerup', up, true);
  canvas.addEventListener('pointercancel', cancel, true);
  canvas.addEventListener('lostpointercapture', cancel, true);
  // A menu can cover the press point before release, retargeting the native click.
  document.addEventListener('click', click, true);
  document.addEventListener('pointerdown', newPress, true);
  canvas.addEventListener('contextmenu', menu);
  window.addEventListener('blur', reset);
  return () => {
    reset();
    canvas.removeEventListener('pointerdown', down, true);
    canvas.removeEventListener('pointermove', move, true);
    canvas.removeEventListener('pointerup', up, true);
    canvas.removeEventListener('pointercancel', cancel, true);
    canvas.removeEventListener('lostpointercapture', cancel, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('pointerdown', newPress, true);
    canvas.removeEventListener('contextmenu', menu);
    window.removeEventListener('blur', reset);
  };
}
