import React from 'react';

/** A desktop OrcaSlicer icon (public/icons/<name>.svg) tinted with the current text colour. */
export const Icon: React.FC<{ name: string; size?: number }> = ({ name, size }) => (
  <span
    className="ico"
    aria-hidden
    style={{ '--ico': `url(/icons/${name}.svg)`, ...(size ? { width: size, height: size } : {}) } as React.CSSProperties}
  />
);
