/**
 * Cross-section of a mesh with a horizontal world plane, and connector placement checks on it.
 * Pure geometry: the cut preview draws these loops as the new flat faces, and the cut store
 * validates connectors against them before a destructive cut.
 */

export type SectionLoop = [number, number][];

export type ConnectorIssue = 'outside' | 'edge' | 'overlap' | null;

/**
 * Closed loops (world XY) where the triangles cross z = height. `world` holds world-space
 * xyz per vertex. Segment ends are matched by quantized position, so meshes whose vertices
 * are duplicated per volume or per face still chain into loops. Open chains are dropped.
 * Loops follow the face normals: outer boundaries run counterclockwise and holes clockwise,
 * so overlapping parts of a multipart object add up instead of cancelling out.
 */
export function sectionLoops(world: ArrayLike<number>, indices: ArrayLike<number>, height: number): SectionLoop[] {
  const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const points = new Map<string, [number, number]>();
  const links = new Map<string, string[]>();
  const crossing = (a: number, b: number): [number, number] => {
    // Order the endpoints so both triangles sharing an edge compute the same point.
    let [p, q] = [a * 3, b * 3];
    if (world[p] > world[q] || (world[p] === world[q] && world[p + 1] > world[q + 1])) [p, q] = [q, p];
    const t = (height - world[p + 2]) / (world[q + 2] - world[p + 2]);
    return [world[p] + (world[q] - world[p]) * t, world[p + 1] + (world[q + 1] - world[p + 1]) * t];
  };
  const link = (from: string, to: string) => {
    const list = links.get(from);
    if (list) list.push(to); else links.set(from, [to]);
  };
  const at = (n: number, axis: number) => world[n * 3 + axis];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const v = [indices[i], indices[i + 1], indices[i + 2]];
    // Vertices exactly on the plane count as above, so every crossing has two distinct edges.
    const above = v.map((n) => world[n * 3 + 2] >= height);
    const ends: [number, number][] = [];
    for (let e = 0; e < 3; e++) if (above[e] !== above[(e + 1) % 3]) ends.push(crossing(v[e], v[(e + 1) % 3]));
    if (ends.length !== 2) continue;
    // Run along up x normal, which keeps the solid on the left of the segment.
    const ux = at(v[1], 0) - at(v[0], 0), uy = at(v[1], 1) - at(v[0], 1), uz = at(v[1], 2) - at(v[0], 2);
    const wx = at(v[2], 0) - at(v[0], 0), wy = at(v[2], 1) - at(v[0], 1), wz = at(v[2], 2) - at(v[0], 2);
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz;
    if (-ny * (ends[1][0] - ends[0][0]) + nx * (ends[1][1] - ends[0][1]) < 0) ends.reverse();
    const [a, b] = ends.map(([x, y]) => key(x, y));
    if (a === b) continue;
    points.set(a, ends[0]);
    points.set(b, ends[1]);
    link(a, b);
  }
  const loops: SectionLoop[] = [];
  const used = new Set<string>();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop: SectionLoop = [];
    let current = start;
    let closed = false;
    while (!used.has(current)) {
      used.add(current);
      loop.push(points.get(current)!);
      const next = (links.get(current) ?? []).find((n) => !used.has(n));
      if (!next) { closed = (links.get(current) ?? []).includes(start) && loop.length > 2; break; }
      current = next;
    }
    if (closed) loops.push(loop);
  }
  // A mirrored instance turns every face inside out; a solid's section always has positive total area.
  if (loops.reduce((sum, loop) => sum + signedArea(loop), 0) < 0) loops.forEach((loop) => loop.reverse());
  return loops;
}

export function signedArea(loop: SectionLoop): number {
  let area = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  return area / 2;
}

/** Nonzero winding over the oriented loops: holes are outside, overlapping parts stay inside. */
export function insideSection(loops: SectionLoop[], x: number, y: number): boolean {
  let winding = 0;
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, yi] = loop[i];
      const [xj, yj] = loop[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) winding += yi > yj ? -1 : 1;
    }
  }
  return winding !== 0;
}

/**
 * Whether a circle reaches the outline of the cut face. Edges running inside the face, where two
 * parts overlap, do not count: just outside a real outline edge there is no material.
 */
export function crossesSectionEdge(loops: SectionLoop[], x: number, y: number, radius: number): boolean {
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [ax, ay] = loop[j];
      const dx = loop[i][0] - ax;
      const dy = loop[i][1] - ay;
      const length = dx * dx + dy * dy;
      if (length === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
      if (Math.hypot(x - ax - dx * t, y - ay - dy * t) >= radius) continue;
      // The outward side of an oriented edge is its right.
      const step = 1e-3 / Math.sqrt(length);
      if (!insideSection(loops, ax + dx * t + dy * step, ay + dy * t - dx * step)) return true;
    }
  }
  return false;
}

/** Why a connector of the given radius cannot sit at index `i`, or null when it fits. */
export function connectorIssue(loops: SectionLoop[], connectors: { x: number; y: number; radius: number }[], i: number): ConnectorIssue {
  const c = connectors[i];
  if (!insideSection(loops, c.x, c.y)) return 'outside';
  if (crossesSectionEdge(loops, c.x, c.y, c.radius)) return 'edge';
  for (let j = 0; j < connectors.length; j++) {
    if (j !== i && Math.hypot(connectors[j].x - c.x, connectors[j].y - c.y) < connectors[j].radius + c.radius) return 'overlap';
  }
  return null;
}
