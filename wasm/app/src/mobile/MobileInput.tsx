import React from 'react';
import { useMobile } from './useMobile';
import './mobileControls.css';

/** Keep native editing and phone keyboards, while sharing touch and focus styling. */
export const MobileInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function MobileInput(props, ref) {
  const mobile = useMobile();
  return <input {...props} style={props.style} ref={ref} autoFocus={mobile ? false : props.autoFocus}
    className={`${props.className ?? ''}${mobile ? props.type === 'checkbox' ? ' mobile-toggle ds-switch' : ' mobile-input ds-input' : ''}`} />;
});
