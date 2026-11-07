import { useLayoutEffect, useRef, type RefObject, type KeyboardEvent } from 'react';

const enabled = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [role="menuitem"]:not([aria-disabled="true"])')]
  .filter(node => node.getClientRects().length && node.closest('[role="toolbar"], [role="menu"]') === root);

export function useRovingFocus(ref: RefObject<HTMLElement | null>, focusOnOpen = false) {
  const previous = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    const entering = root !== previous.current;
    previous.current = root;
    if (!root) return;
    const items = enabled(root);
    const selected = items.includes(document.activeElement as HTMLElement) ? document.activeElement : items.find(node => node.tabIndex === 0) ?? items[0];
    items.forEach(node => { node.tabIndex = node === selected ? 0 : -1; });
    if (focusOnOpen && entering && !root.contains(document.activeElement)) items[0]?.focus();
  });
}

export function rovingKeyDown(event: KeyboardEvent<HTMLElement>) {
  const root = event.currentTarget, items = enabled(root), target = event.target as HTMLElement;
  const index = items.indexOf(target);
  if (index < 0) return;
  const vertical = root.getAttribute('aria-orientation') === 'vertical' || root.getAttribute('role') === 'menu';
  const previous = vertical ? 'ArrowUp' : 'ArrowLeft', next = vertical ? 'ArrowDown' : 'ArrowRight';
  let to: number;
  if (event.key === previous) to = (index - 1 + items.length) % items.length;
  else if (event.key === next) to = (index + 1) % items.length;
  else if (event.key === 'Home') to = 0;
  else if (event.key === 'End') to = items.length - 1;
  else return;
  event.preventDefault(); event.stopPropagation();
  items.forEach((node, i) => { node.tabIndex = i === to ? 0 : -1; });
  items[to]?.focus();
}
