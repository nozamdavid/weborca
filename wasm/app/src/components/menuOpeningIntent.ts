import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';

/** Root insertion and autofocus are not a new hover or keyboard gesture. */
export function useMenuOpeningIntent(x: number, y: number, flyout: RefObject<HTMLElement | null>) {
  const intent = useRef({ x, y, moved: false, keyboard: false, focusFlyout: false });
  useLayoutEffect(() => {
    intent.current = { x, y, moved: false, keyboard: false, focusFlyout: false };
    const move = (event: globalThis.PointerEvent) => {
      if (!event.isTrusted || event.pointerType === 'touch') return;
      const state = intent.current;
      if (event.clientX !== state.x || event.clientY !== state.y) state.moved = true;
      state.x = event.clientX;
      state.y = event.clientY;
    };
    const key = () => { intent.current.keyboard = true; };
    const press = () => { intent.current.keyboard = false; };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', press, true);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', press, true);
    };
  }, [x, y]);
  useLayoutEffect(() => {
    if (intent.current.focusFlyout && flyout.current) {
      intent.current.focusFlyout = false;
      flyout.current.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    }
  });
  return {
    hover: (event: PointerEvent) => event.pointerType !== 'touch' && intent.current.moved,
    keyboardFocus: () => intent.current.keyboard,
    openRight: (target: HTMLElement) => {
      if (target.getAttribute('aria-haspopup') !== 'menu') return;
      if (target.getAttribute('aria-expanded') === 'true') {
        flyout.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
      } else {
        intent.current.focusFlyout = true;
        target.click();
      }
    }
  };
}
