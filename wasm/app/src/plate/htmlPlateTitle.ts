// Raster-only title: interaction remains on PlateScene's existing title mesh.
type DrawableCanvas = HTMLCanvasElement & { content?: string; requestPaint?: () => void };
type DrawableContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: HTMLElement, x: number, y: number, options: { preserveElementGeometry: boolean }) => void;
};

export function attachHtmlPlateTitle(
  fallback: HTMLCanvasElement, value: string, font: string, color: string,
  textWidth: number, publish: (canvas: HTMLCanvasElement) => void,
  status?: { active: boolean; activeLabel: string; inactiveLabel: string },
): () => void {
  const canvas = document.createElement('canvas') as DrawableCanvas;
  canvas.setAttribute('content', 'drawable');
  const ctx = canvas.getContext('2d') as DrawableContext | null;
  if (canvas.content !== 'drawable' || !ctx?.drawElementImage || typeof canvas.requestPaint !== 'function') return () => {};
  canvas.width = fallback.width;
  canvas.height = fallback.height;
  // Chrome culls offscreen drawable sources. Keep layout in the viewport;
  // opacity hides the backing canvas without suppressing descendant rasterization.
  canvas.style.position = 'fixed';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.opacity = '0';
  canvas.style.pointerEvents = 'none';
  canvas.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span');
  title.setAttribute('drawable', '');
  title.textContent = value;
  title.style.font = font;
  title.style.color = color;
  title.style.whiteSpace = 'pre';
  title.style.display = 'block';
  title.style.lineHeight = `${canvas.height}px`;
  canvas.append(title);
  if (status) {
    const badge = document.createElement('span');
    badge.setAttribute('drawable', '');
    badge.textContent = status.active ? status.activeLabel : status.inactiveLabel;
    const badgeFont = font.replace(/\d+px/, '32px');
    ctx.font = badgeFont;
    const badgeWidth = Math.ceil(ctx.measureText(badge.textContent).width) + 32;
    canvas.width = fallback.width + 16 + badgeWidth + 8;
    badge.style.font = badgeFont;
    badge.style.color = color;
    badge.style.border = '2px solid currentColor';
    badge.style.borderRadius = '8px';
    badge.style.boxSizing = 'border-box';
    badge.style.padding = '0 14px';
    badge.style.whiteSpace = 'pre';
    badge.style.position = 'absolute';
    badge.style.left = `${fallback.width + 16}px`;
    badge.style.top = `${(canvas.height - 48) / 2}px`;
    badge.style.width = `${badgeWidth}px`;
    badge.style.lineHeight = '44px';
    canvas.append(badge);
  }
  let stopped = false;
  const dispose = () => {
    stopped = true;
    canvas.removeEventListener('paint', paint);
    canvas.remove();
  };
  const paint = () => {
    if (stopped) return;
    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(fallback, 0, 0); // Retain the incumbent pencil and padding.
      ctx.clearRect(0, 0, textWidth + 8, canvas.height);
      ctx.drawElementImage!(title, 8, 0, { preserveElementGeometry: true });
      if (status) {
        ctx.drawElementImage!(canvas.lastElementChild as HTMLElement, fallback.width + 16, (canvas.height - 48) / 2, { preserveElementGeometry: true });
      }
      publish(canvas);
    } catch {
      publish(fallback);
      dispose();
    }
  };
  canvas.addEventListener('paint', paint);
  try {
    document.body.append(canvas);
    canvas.requestPaint();
  } catch {
    dispose();
  }
  return dispose;
}
