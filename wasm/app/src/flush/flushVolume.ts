/**
 * Purge volume between two filament colours, the colour-distance formula desktop falls back on when it has no measured
 * data for the pair (FlushVolCalc.cpp `calc_flush_vol_rgb`): darker-to-lighter and big hue jumps need more purging.
 */
const MAX_FLUSH_VOLUME = 20000;
const rad = (degrees: number) => (degrees / 180) * Math.PI;
const luminance = (r: number, g: number, b: number) => r * 0.3 + g * 0.59 + b * 0.11;

export function parseColour(text: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(text.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : undefined;
}

function toHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return [h < 0 ? h + 360 : h, max === 0 ? 0 : delta / max, max];
}

export function flushVolume(from: [number, number, number], to: [number, number, number]): number {
  const [fr, fg, fb] = from.map((v) => v / 255);
  const [tr, tg, tb] = to.map((v) => v / 255);
  const [fh, fs, fv] = toHsv(fr, fg, fb);
  const [th, ts, tv] = toHsv(tr, tg, tb);
  const dx = Math.cos(rad(fh)) * fs * fv - Math.cos(rad(th)) * ts * tv;
  const dy = Math.sin(rad(fh)) * fs * fv - Math.sin(rad(th)) * ts * tv;
  let hsDist = Math.min(1.2, Math.hypot(dx, dy));

  const fromLumi = luminance(fr, fg, fb);
  const toLumi = luminance(tr, tg, tb);
  let lumiFlush: number;
  if (toLumi >= fromLumi) {
    lumiFlush = Math.pow(toLumi - fromLumi, 0.7) * 560;
  } else {
    lumiFlush = (fromLumi - toLumi) * 80;
    hsDist = Math.min(0.67 * tv + 0.33 * fv, hsDist);
  }
  const hsFlush = 230 * hsDist;
  const volume = Math.sqrt(hsFlush * hsFlush + lumiFlush * lumiFlush - 2 * hsFlush * lumiFlush * Math.cos(rad(120)));
  return Math.min(MAX_FLUSH_VOLUME, Math.round(Math.max(volume, 60)));
}

/** The N×N matrix (row = from, column = to, row-major) for these colours, zero on the diagonal. */
export function autoFlushMatrix(colours: string[]): number[] {
  const rgb = colours.map((c) => parseColour(c) ?? [255, 255, 255] as [number, number, number]);
  return rgb.flatMap((from, i) => rgb.map((to, j) => (i === j ? 0 : flushVolume(from, to))));
}

/** The matrix from the config for `count` filaments, falling back to 280 mm³ where the config has no value. */
export function readFlushMatrix(value: string | undefined, count: number): number[] {
  const values = (value ?? '').split(',').map((v) => parseFloat(v)).filter((v) => Number.isFinite(v));
  const stored = Math.round(Math.sqrt(values.length));
  const exact = stored * stored === values.length && stored > 0;
  return Array.from({ length: count * count }, (_, k) => {
    const [i, j] = [Math.floor(k / count), k % count];
    if (i === j) return 0;
    return exact && i < stored && j < stored ? values[i * stored + j] : 280;
  });
}
