import * as THREE from 'three';
import type { BedConfig } from './types';

/** Flat bed surface and grid, both clipped to the printable polygon. */
export function createBedGeometry(bed: BedConfig, outline = bed.points) {
  const [cx, cy] = bed.center;
  const points = outline.map(([x, y]) => new THREE.Vector2(x - cx, y - cy));
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const floor = new THREE.ShapeGeometry(new THREE.Shape(points));
  const position = floor.getAttribute('position');
  const uv = floor.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, (position.getX(i) - minX) / (maxX - minX), (position.getY(i) - minY) / (maxY - minY));
  }

  const vertices: number[] = [];
  // Limit the number of lines for unusually large custom beds.
  const step = Math.max(10, Math.ceil(Math.max(bed.width, bed.depth) / 10000) * 10);
  for (const axis of [0, 1] as const) {
    const coordinates = points.map(p => axis === 0 ? p.x : p.y);
    const min = Math.min(...coordinates), max = Math.max(...coordinates);
    for (let value = Math.ceil(min / step) * step; value <= max; value += step) {
      const intersections: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const av = axis === 0 ? a.x : a.y, bv = axis === 0 ? b.x : b.y;
        // Half-open intervals count shared polygon vertices only once.
        if ((av <= value && value < bv) || (bv <= value && value < av)) {
          const otherA = axis === 0 ? a.y : a.x, otherB = axis === 0 ? b.y : b.x;
          intersections.push(otherA + (otherB - otherA) * (value - av) / (bv - av));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        for (const other of [intersections[i], intersections[i + 1]]) {
          vertices.push(axis === 0 ? value : other, axis === 0 ? other : value, 0);
        }
      }
    }
  }
  const grid = new THREE.BufferGeometry();
  grid.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return { floor, grid };
}
