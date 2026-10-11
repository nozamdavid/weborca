import { Vector3, type BufferGeometry } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const modelOutlines = new Map<string, Promise<[number, number][] | null>>();

/** Cache the centered footprint so Prepare and Preview use the same bed model. */
export function loadBedModelOutline(url: string): Promise<[number, number][] | null> {
  let result = modelOutlines.get(url);
  if (!result) {
    result = new STLLoader().loadAsync(url).then(geometry => {
      try {
        geometry.computeBoundingBox();
        const center = geometry.boundingBox!.getCenter(new Vector3());
        return bedModelOutline(geometry)?.map(([x, y]) => [x - center.x, y - center.y] as [number, number]) ?? null;
      } finally { geometry.dispose(); }
    }).catch(error => { modelOutlines.delete(url); throw error; });
    modelOutlines.set(url, result);
  }
  return result;
}

/** Preserve explicit printable polygons; rectangular profiles use their model footprint. */
export function displayBedOutline(points: [number, number][], model: [number, number][] | null): [number, number][] {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const rectangle = points.length === 4 && points.every(([x, y]) =>
    (Math.abs(x - minX) < 0.00001 || Math.abs(x - maxX) < 0.00001) &&
    (Math.abs(y - minY) < 0.00001 || Math.abs(y - maxY) < 0.00001));
  return rectangle && model ? model.map(([x, y]) => [x + (minX + maxX) / 2, y + (minY + maxY) / 2]) : points;
}

/** Recover the outline of the model's largest horizontal bed face. */
export function bedModelOutline(geometry: BufferGeometry): [number, number][] | null {
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  const planes = new Map<number, { area: number; triangles: number[][] }>();
  for (let i = 0; i < (index ? index.count : positions.count); i += 3) {
    const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
    const zs = ids.map(j => positions.getZ(j));
    if (Math.max(...zs) - Math.min(...zs) > 0.00001) continue;
    const [a, b, c] = ids;
    const area = Math.abs((positions.getX(b) - positions.getX(a)) * (positions.getY(c) - positions.getY(a)) -
      (positions.getY(b) - positions.getY(a)) * (positions.getX(c) - positions.getX(a))) / 2;
    if (area < 0.000001) continue;
    const z = Math.round(zs[0] * 100000);
    const plane = planes.get(z) ?? { area: 0, triangles: [] };
    plane.area += area;
    plane.triangles.push(ids);
    planes.set(z, plane);
  }
  // Equal-sized top/bottom faces: prefer the top face.
  const plane = [...planes].sort(([za, a], [zb, b]) => Math.abs(b.area - a.area) < 0.001 ? zb - za : b.area - a.area)[0]?.[1];
  if (!plane) return null;
  const points = new Map<string, [number, number]>();
  const edges = new Map<string, { a: string; b: string; count: number }>();
  for (const triangle of plane.triangles) {
    const keys = triangle.map(i => {
      const x = positions.getX(i), y = positions.getY(i);
      const key = `${Math.round(x * 100000)},${Math.round(y * 100000)}`;
      points.set(key, [x, y]);
      return key;
    });
    for (let i = 0; i < 3; i++) {
      const a = keys[i], b = keys[(i + 1) % 3];
      const key = a < b ? `${a}/${b}` : `${b}/${a}`;
      const edge = edges.get(key) ?? { a, b, count: 0 };
      edge.count++;
      edges.set(key, edge);
    }
  }
  const neighbors = new Map<string, string[]>();
  for (const { a, b, count } of edges.values()) {
    if (count !== 1) continue;
    for (const [from, to] of [[a, b], [b, a]]) {
      const list = neighbors.get(from) ?? [];
      list.push(to);
      neighbors.set(from, list);
    }
  }
  if ([...neighbors.values()].some(list => list.length !== 2)) return null;
  const remaining = new Set(neighbors.keys());
  let outline: [number, number][] | null = null, largestArea = 0;
  while (remaining.size) {
    const start = remaining.values().next().value!;
    let current = start, previous = '';
    const ring: [number, number][] = [];
    do {
      if (!remaining.delete(current)) return null;
      ring.push(points.get(current)!);
      const next = neighbors.get(current)!.find(p => p !== previous)!;
      previous = current;
      current = next;
    } while (current !== start);
    const area = Math.abs(ring.reduce((sum, [x, y], i) => {
      const next = ring[(i + 1) % ring.length];
      return sum + x * next[1] - next[0] * y;
    }, 0)) / 2;
    if (ring.length >= 3 && area > largestArea) { outline = ring; largestArea = area; }
  }
  return outline;
}
