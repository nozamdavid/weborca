/** Camera views of the Prepare scene, with desktop's number keys. The scene registers itself here. */
export type CameraView = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 'Z' | 'BED';

export const CAMERA_VIEWS: Array<{ view: CameraView; label: string; key: string }> = [
  { view: 0, label: 'Iso', key: '0' },
  { view: 1, label: 'Top', key: '1' },
  { view: 2, label: 'Bottom', key: '2' },
  { view: 3, label: 'Front', key: '3' },
  { view: 4, label: 'Rear', key: '4' },
  { view: 5, label: 'Left', key: '5' },
  { view: 6, label: 'Right', key: '6' }
];

let handler: ((view: CameraView) => void) | null = null;

export function registerCameraHandler(fn: (view: CameraView) => void): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

export const setCameraView = (view: CameraView) => handler?.(view);
export const zoomToBed = () => handler?.('BED');
