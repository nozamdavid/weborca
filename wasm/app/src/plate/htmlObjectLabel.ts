// Fixed-size raster only; the existing sprite owns placement and visibility.
type DrawableCanvas = HTMLCanvasElement & { content?: string; requestPaint?: () => void };
type DrawableContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: HTMLElement, x: number, y: number, options: { preserveElementGeometry: boolean }) => void;
};

export function attachHtmlObjectLabel(
  fallback: HTMLCanvasElement, value: string, publish: (canvas: HTMLCanvasElement) => void,
): () => void {
  let canvas: DrawableCanvas | undefined;
  let stopped = false;
  const dispose = () => {
    if (stopped) return;
    stopped = true;
    canvas?.removeEventListener('paint', paint);
    canvas?.remove();
  };
  const paint = () => {
    if (stopped || !canvas) return;
    try {
      const ctx = canvas.getContext('2d') as DrawableContext;
      ctx.clearRect(0, 0, 256, 64);
      ctx.drawElementImage!(canvas.firstElementChild as HTMLElement, 8, 8, { preserveElementGeometry: true });
      publish(canvas);
    } catch {
      publish(fallback);
      dispose();
    }
  };
  try {
    canvas = document.createElement('canvas') as DrawableCanvas;
    canvas.setAttribute('content', 'drawable');
    const ctx = canvas.getContext('2d') as DrawableContext | null;
    if (canvas.content !== 'drawable' || !ctx?.drawElementImage || typeof canvas.requestPaint !== 'function') return dispose;
    canvas.width = 256;
    canvas.height = 64;
    // Offscreen sources are culled by Chrome; opacity keeps layout drawable.
    Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', opacity: '0', pointerEvents: 'none' });
    canvas.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.setAttribute('drawable', '');
    label.textContent = value;
    // Incumbent viewport raster colours and geometry, independent of app theme.
    Object.assign(label.style, {
      display: 'block', boxSizing: 'border-box', width: '240px', height: '48px',
      padding: '0 8px', border: '2px solid #38bdf8', borderRadius: '8px',
      background: 'rgba(24, 24, 27, 0.85)', color: '#ffffff',
      font: 'bold 20px sans-serif', lineHeight: '44px', textAlign: 'center',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    });
    canvas.append(label);
    canvas.addEventListener('paint', paint);
    document.body.append(canvas);
    canvas.requestPaint();
  } catch {
    publish(fallback);
    dispose();
  }
  return dispose;
}
