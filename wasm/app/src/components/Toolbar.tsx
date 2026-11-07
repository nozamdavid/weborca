import React, { useRef } from 'react';
import { rovingKeyDown, useRovingFocus } from './rovingFocus';

export function Toolbar({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingFocus(ref);
  return <div ref={ref} className="ds-toolbar ds-toolbar--flat" role="toolbar" aria-orientation="horizontal" aria-label={label} onKeyDown={rovingKeyDown}>{children}</div>;
}
