/** Serializes paint mutations, snapshots and cancellation for each pointer stroke. */
import { paintStroke, getPaintOverlay, parsePaintOverlayBinary, getPaintData, setPaintData } from './paintToolsApi';
import type { PaintStrokeParams, PaintStrokePoint, OnStrokeCompleteHook, ParsedPaintOverlay } from './types';

type StrokeParams = Omit<PaintStrokeParams, 'points'>;
interface Stroke {
  params: StrokeParams;
  points: PaintStrokePoint[];
  before: string | null;
  cancelled: boolean;
  ended: boolean;
  failed: boolean;
}

export interface StrokeCollectorOptions {
  onOverlayUpdate?: (overlay: ParsedPaintOverlay | null) => void;
  onStrokeComplete?: OnStrokeCompleteHook;
  onError?: (error: unknown) => void;
}

export class StrokeCollector {
  private current: Stroke | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private options: StrokeCollectorOptions = {}) {}

  public setOptions(options: StrokeCollectorOptions): void {
    this.options = { ...this.options, ...options };
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.queue.then(action);
    this.queue = next.catch((error) => this.options.onError?.(error));
    return this.queue;
  }

  public beginStroke(params: StrokeParams): Promise<void> {
    if (this.current && !this.current.ended) this.cancelStroke();
    const stroke: Stroke = { params, points: [], before: null, cancelled: false, ended: false, failed: false };
    this.current = stroke;
    return this.enqueue(async () => {
      if (stroke.cancelled) return;
      try {
        stroke.before = (await getPaintData(params)).data;
      } catch (error) {
        stroke.failed = true;
        throw error;
      }
    });
  }

  public addPoint(hit: [number, number, number], facet: number): void {
    const stroke = this.current;
    if (!stroke || stroke.cancelled || stroke.ended) return;
    stroke.points.push({ hit, facet });
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      void this.dispatch(stroke);
    }, 35);
  }

  private dispatch(stroke: Stroke): Promise<void> {
    const points = stroke.points.splice(0);
    return this.enqueue(async () => {
      if (!points.length || stroke.cancelled || stroke.failed || stroke.before === null) return;
      try {
        await paintStroke({ ...stroke.params, points });
        await this.refreshOverlay(stroke);
      } catch (error) {
        stroke.failed = true;
        // Restore the complete baseline, including any successful earlier batch.
        await setPaintData({ ...stroke.params, data: stroke.before });
        await this.refreshOverlay(stroke);
        throw error;
      }
    });
  }

  private async refreshOverlay(stroke: Stroke): Promise<void> {
    const result = await getPaintOverlay(stroke.params);
    if (this.current === stroke && !stroke.cancelled) {
      this.options.onOverlayUpdate?.(result.buffer ? parsePaintOverlayBinary(result.buffer, result.states) : null);
    }
  }

  public endStroke(): Promise<void> {
    const stroke = this.current;
    if (!stroke || stroke.ended || stroke.cancelled) return this.queue;
    stroke.ended = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.dispatch(stroke);
    return this.enqueue(async () => {
      if (stroke.cancelled || stroke.failed || stroke.before === null) return;
      const after = (await getPaintData(stroke.params)).data;
      if (stroke.cancelled) return;
      if (stroke.before !== after) {
        await this.options.onStrokeComplete?.({ ...stroke.params, before: stroke.before, after });
      }
      if (this.current === stroke) this.current = null;
    });
  }

  public cancelStroke(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const stroke = this.current;
    if (!stroke) return;
    stroke.cancelled = true;
    stroke.points = [];
    this.current = null;
    // In-flight worker requests cannot be recalled. Restore their original target
    // before a newer stroke can capture its baseline or send any mutations.
    void this.enqueue(async () => {
      if (stroke.before !== null) await setPaintData({ ...stroke.params, data: stroke.before });
    });
  }
}
