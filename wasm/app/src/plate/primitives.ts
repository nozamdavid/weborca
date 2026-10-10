/** Primitive shapes for "Add Primitive" in the plate's context menu, as OBJ text that goes through the normal model import. */
export type PlatePrimitive = 'cube' | 'cylinder' | 'sphere' | 'cone' | 'disc' | 'torus';

export const PRIMITIVE_LABELS: Record<PlatePrimitive, string> = {
  cube: 'Cube',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  cone: 'Cone',
  disc: 'Disc',
  torus: 'Torus'
};

type Vec = [number, number, number];
interface Mesh { vertices: Vec[]; faces: [number, number, number][] }

const SEGMENTS = 64;

/** A closed solid of revolution around Z from a profile of (radius, z) points, listed bottom to top. */
function revolve(profile: [number, number][]): Mesh {
  const vertices: Vec[] = [];
  const faces: Mesh['faces'] = [];
  const rings: number[][] = [];
  const poles: Array<number | null> = [];
  for (const [r, z] of profile) {
    if (r === 0) {
      poles.push(vertices.push([0, 0, z]) - 1);
      rings.push([]);
    } else {
      poles.push(null);
      rings.push(Array.from({ length: SEGMENTS }, (_, i) => {
        const a = (i / SEGMENTS) * Math.PI * 2;
        return vertices.push([r * Math.cos(a), r * Math.sin(a), z]) - 1;
      }));
    }
  }
  for (let k = 0; k + 1 < profile.length; k++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const j = (i + 1) % SEGMENTS;
      const [a, b] = [rings[k], rings[k + 1]];
      if (poles[k] !== null) faces.push([poles[k]!, b[i], b[j]]);
      else if (poles[k + 1] !== null) faces.push([a[i], a[j], poles[k + 1]!]);
      else faces.push([a[i], a[j], b[j]], [a[i], b[j], b[i]]);
    }
  }
  // Caps: flat discs where the profile starts and ends away from the axis.
  const cap = (ring: number[], z: number, up: boolean) => {
    const centre = vertices.push([0, 0, z]) - 1;
    for (let i = 0; i < SEGMENTS; i++) {
      const j = (i + 1) % SEGMENTS;
      faces.push(up ? [centre, ring[i], ring[j]] : [centre, ring[j], ring[i]]);
    }
  };
  if (poles[0] === null) cap(rings[0], profile[0][1], false);
  const last = profile.length - 1;
  if (poles[last] === null) cap(rings[last], profile[last][1], true);
  return { vertices, faces };
}

function torus(major: number, minor: number): Mesh {
  const tube = 24;
  const vertices: Vec[] = [];
  const faces: Mesh['faces'] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    for (let j = 0; j < tube; j++) {
      const b = (j / tube) * Math.PI * 2;
      const r = major + minor * Math.cos(b);
      vertices.push([r * Math.cos(a), r * Math.sin(a), minor * Math.sin(b) + minor]);
    }
  }
  for (let i = 0; i < SEGMENTS; i++) {
    for (let j = 0; j < tube; j++) {
      const [i2, j2] = [(i + 1) % SEGMENTS, (j + 1) % tube];
      const v = (a: number, b: number) => a * tube + b;
      faces.push([v(i, j), v(i2, j), v(i2, j2)], [v(i, j), v(i2, j2), v(i, j2)]);
    }
  }
  return { vertices, faces };
}

function cube(side: number): Mesh {
  const h = side / 2;
  const vertices: Vec[] = [];
  for (const z of [0, side]) for (const [x, y] of [[-h, -h], [h, -h], [h, h], [-h, h]]) vertices.push([x, y, z]);
  const quad = (a: number, b: number, c: number, d: number): Mesh['faces'] => [[a, b, c], [a, c, d]];
  return {
    vertices,
    faces: [...quad(0, 3, 2, 1), ...quad(4, 5, 6, 7), ...quad(0, 1, 5, 4), ...quad(1, 2, 6, 5), ...quad(2, 3, 7, 6), ...quad(3, 0, 4, 7)]
  };
}

/** The shape standing on Z=0, centred on the origin. `side` is its overall size; desktop uses a tenth of the bed's longest side. */
export function primitiveMesh(shape: PlatePrimitive, side: number): Mesh {
  const r = side / 2;
  switch (shape) {
    case 'cube': return cube(side);
    case 'cylinder': return revolve([[r, 0], [r, side]]);
    case 'cone': return revolve([[r, 0], [0, side]]);
    case 'disc': return revolve([[r, 0], [r, side * 0.1]]);
    case 'sphere': {
      const rings = 32;
      return revolve(Array.from({ length: rings + 1 }, (_, k) => {
        const t = (k / rings) * Math.PI;
        return [k === 0 || k === rings ? 0 : r * Math.sin(t), r - r * Math.cos(t)] as [number, number];
      }));
    }
    case 'torus': return torus(r * 0.75, r * 0.25);
  }
}

export function primitiveObj(shape: PlatePrimitive, side: number): string {
  const { vertices, faces } = primitiveMesh(shape, side);
  return [
    `o ${PRIMITIVE_LABELS[shape]}`,
    ...vertices.map((v) => `v ${v.map((n) => n.toFixed(5)).join(' ')}`),
    ...faces.map((f) => `f ${f.map((i) => i + 1).join(' ')}`)
  ].join('\n') + '\n'; // the engine's OBJ reader drops a last line without a newline
}

export function primitiveFile(shape: PlatePrimitive, side: number): File {
  return new File([primitiveObj(shape, side)], `${PRIMITIVE_LABELS[shape]}.obj`, { type: 'text/plain' });
}
