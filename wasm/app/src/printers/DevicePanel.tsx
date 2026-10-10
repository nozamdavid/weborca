import React from 'react';

/** The Device tab. `active` is false while another tab is showing, so the panel can stop polling. */
export const DevicePanel: React.FC<{ active: boolean }> = () => (
  <div id="device-panel" style={{ padding: 24, color: '#a1a1aa' }}>
    No printer connected.
  </div>
);
