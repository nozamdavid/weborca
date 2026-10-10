import React, { useEffect, useState } from 'react';
import { usePlateStore } from './plateStore';
import { ModalBackdrop } from '../components/ModalBackdrop';

/** Spacing and rotation used by Arrange (desktop's arrange settings popup). */
export const ArrangeDialog: React.FC = () => {
  const open = usePlateStore((s) => s.arrangeDialogOpen);
  const settings = usePlateStore((s) => s.arrangeSettings);
  const setOpen = usePlateStore((s) => s.setArrangeDialogOpen);
  const setSettings = usePlateStore((s) => s.setArrangeSettings);
  const arrange = usePlateStore((s) => s.arrange);
  const [spacing, setSpacing] = useState('');
  const [rotate, setRotate] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSpacing(settings.spacing === null ? '' : String(settings.spacing));
    setRotate(settings.allowRotations);
  }, [open, settings]);
  if (!open) return null;

  const parsed = spacing.trim() === '' ? null : Math.max(0, parseFloat(spacing));
  const valid = parsed === null || Number.isFinite(parsed);
  const apply = (run: boolean) => {
    if (!valid) return;
    setSettings({ spacing: parsed, allowRotations: rotate });
    setOpen(false);
    if (run) void arrange(true);
  };
  return (
    <ModalBackdrop onClose={() => setOpen(false)} id="arrange-dialog" role="dialog" aria-label="Arrange options">
      <div className="modal-content" style={{ width: 'min(380px, 92vw)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Arrange options</h3>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Spacing between objects (mm)
          <input id="arrange-spacing" value={spacing} onChange={(e) => setSpacing(e.target.value)} placeholder="From the print settings"
            style={{ background: 'var(--control-bg, #3a3a3a)', color: 'inherit', border: '1px solid var(--border-color, #444)', borderRadius: 4, padding: '5px 8px' }} />
          {!valid && <span style={{ color: 'var(--danger, #e05d5d)' }}>Enter a number.</span>}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <input id="arrange-rotate" type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} /> Allow objects to rotate
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" id="arrange-cancel" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-secondary" id="arrange-save" disabled={!valid} onClick={() => apply(false)}>Save</button>
          <button className="btn btn-primary" id="arrange-run" disabled={!valid} onClick={() => apply(true)}>Arrange</button>
        </div>
      </div>
    </ModalBackdrop>
  );
};
