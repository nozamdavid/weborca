/**
 * Validation and geometry utilities for custom print beds in OrcaSlicer.
 * Enforces:
 * - Nonempty, formatted coordinates (x1xy1,x2xy2,...)
 * - Finite numbers (no NaN, Infinity)
 * - Sane maximum point count (<= 200)
 * - At least 3 distinct points (and non-degenerate edges)
 * - Strictly non-zero area (shoelace formula)
 * - Non-self-intersecting boundary
 */

export const MAX_POLYGON_POINTS = 200;

export interface PolygonValidationResult {
  valid: boolean;
  error?: string;
  points?: [number, number][];
  areaStr?: string;
}

/**
 * Generate 72-point circular bed printable_area coordinates centered at (0, 0),
 * matching OrcaSlicer and Slic3r desktop delta / circular bed conventions.
 */
export function generateCircularPrintableArea(diameter: number, edges = 72): string {
  const r = diameter / 2;
  const pts: string[] = [];
  for (let i = 1; i <= edges; ++i) {
    const angle = (i * 2 * Math.PI) / edges;
    const rawX = r * Math.cos(angle);
    const rawY = r * Math.sin(angle);
    const px = Math.abs(rawX) < 1e-9 ? 0 : Number(rawX.toFixed(4));
    const py = Math.abs(rawY) < 1e-9 ? 0 : Number(rawY.toFixed(4));
    pts.push(`${px}x${py}`);
  }
  return pts.join(',');
}

function crossProduct(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function isPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  eps = 1e-7
): boolean {
  const cp = crossProduct(ax, ay, bx, by, px, py);
  if (Math.abs(cp) > eps) return false;
  const minX = Math.min(ax, bx) - eps;
  const maxX = Math.max(ax, bx) + eps;
  const minY = Math.min(ay, by) - eps;
  const maxY = Math.max(ay, by) + eps;
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

export function validatePolygon(input: string): PolygonValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, error: 'Enter printable area coordinates.' };
  }

  const rawChunks = trimmed.split(',');
  // Check count bound before parsing all points (+1 to account for optional repeated closing vertex)
  if (rawChunks.length > MAX_POLYGON_POINTS + 1) {
    return { valid: false, error: `Polygon cannot exceed ${MAX_POLYGON_POINTS} points.` };
  }

  const parsedPoints: [number, number][] = [];

  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i].trim();
    if (!chunk) {
      return { valid: false, error: 'Polygon points cannot be empty.' };
    }

    const parts = chunk.split('x');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid polygon format. Use x1xy1,x2xy2,...' };
    }

    const xStr = parts[0].trim();
    const yStr = parts[1].trim();
    if (xStr === '' || yStr === '') {
      return { valid: false, error: 'Polygon coordinates cannot be empty.' };
    }

    const x = Number(xStr);
    const y = Number(yStr);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { valid: false, error: 'Polygon coordinates must be finite numbers.' };
    }

    // Keep geometry products and native fixed-point conversion in a safe range.
    if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000) {
      return { valid: false, error: 'Polygon coordinates must be between -1000000 and 1000000 mm.' };
    }

    parsedPoints.push([x, y]);
  }

  // Allow closing the polygon by repeating the first vertex at the end; strip it for cyclic checks.
  let points = parsedPoints;
  if (
    points.length >= 4 &&
    Math.abs(points[points.length - 1][0] - points[0][0]) < 1e-7 &&
    Math.abs(points[points.length - 1][1] - points[0][1]) < 1e-7
  ) {
    points = points.slice(0, -1);
  }

  if (points.length > MAX_POLYGON_POINTS) {
    return { valid: false, error: `Polygon cannot exceed ${MAX_POLYGON_POINTS} points.` };
  }

  if (points.length < 3) {
    return { valid: false, error: 'A polygonal bed requires at least 3 points.' };
  }

  // Check distinct points
  const distinct = new Set(points.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`));
  if (distinct.size < 3) {
    return { valid: false, error: 'A polygonal bed requires at least 3 distinct points.' };
  }

  // Check consecutive duplicate points
  for (let i = 0; i < points.length; i++) {
    const next = (i + 1) % points.length;
    if (
      Math.abs(points[i][0] - points[next][0]) < 1e-7 &&
      Math.abs(points[i][1] - points[next][1]) < 1e-7
    ) {
      return { valid: false, error: 'Polygon contains duplicate consecutive points.' };
    }
  }

  const n = points.length;
  const eps = 1e-7;

  // 1. Check non-adjacent edges for intersection or contact (skips shared endpoints)
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];

    for (let j = i + 2; j < n; j++) {
      // Edges (0, 1) and (n-1, 0) are adjacent around the loop; skip
      if (i === 0 && j === n - 1) continue;

      const c = points[j];
      const d = points[(j + 1) % n];

      const cp1 = crossProduct(c[0], c[1], d[0], d[1], a[0], a[1]);
      const cp2 = crossProduct(c[0], c[1], d[0], d[1], b[0], b[1]);
      const cp3 = crossProduct(a[0], a[1], b[0], b[1], c[0], c[1]);
      const cp4 = crossProduct(a[0], a[1], b[0], b[1], d[0], d[1]);

      const straddles1 = (cp1 > eps && cp2 < -eps) || (cp1 < -eps && cp2 > eps);
      const straddles2 = (cp3 > eps && cp4 < -eps) || (cp3 < -eps && cp4 > eps);

      if (straddles1 && straddles2) {
        return { valid: false, error: 'Polygon edges cannot intersect (self-intersecting polygon).' };
      }

      if (
        isPointOnSegment(a[0], a[1], c[0], c[1], d[0], d[1], eps) ||
        isPointOnSegment(b[0], b[1], c[0], c[1], d[0], d[1], eps) ||
        isPointOnSegment(c[0], c[1], a[0], a[1], b[0], b[1], eps) ||
        isPointOnSegment(d[0], d[1], a[0], a[1], b[0], b[1], eps)
      ) {
        return { valid: false, error: 'Polygon edges cannot intersect (self-intersecting polygon).' };
      }
    }
  }

  // 2. Check nonzero area via shoelace formula
  let signedArea = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    signedArea += x1 * y2 - x2 * y1;
  }
  const area = Math.abs(signedArea) / 2;
  if (area < 1e-4) {
    return { valid: false, error: 'Polygon area must be greater than zero.' };
  }

  // 3. Check adjacent edge backtrack / reversal at each shared vertex via dot product
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    // Vectors pointing away from the shared vertex curr
    const v1x = prev[0] - curr[0];
    const v1y = prev[1] - curr[1];
    const v2x = next[0] - curr[0];
    const v2y = next[1] - curr[1];

    const cross = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;

    // Collinear and pointing in the same direction means the path backtracks along itself
    if (Math.abs(cross) < eps && dot > 0) {
      return { valid: false, error: 'Polygon edges cannot intersect (self-intersecting polygon).' };
    }
  }

  const areaStr = points.map(([x, y]) => `${x}x${y}`).join(',');
  return {
    valid: true,
    points,
    areaStr
  };
}
