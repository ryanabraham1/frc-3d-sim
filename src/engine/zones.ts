import type { FieldPoint } from './coords';

/**
 * Zone geometry helpers (pure, field frame). FRC rules are mostly "any part of the BUMPERS in zone X" or
 * "BUMPERS completely outside zone X" — test the robot's bumper rectangle (Robot.corners()) against a zone
 * polygon with these.
 */

/** Point inside a (convex or concave) polygon — ray casting. */
export function pointInPolygon(p: FieldPoint, poly: FieldPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Do two CONVEX polygons overlap (touching counts)? Separating-axis test. */
export function convexOverlap(a: FieldPoint[], b: FieldPoint[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y, ny = p.x - q.x;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) { const d = v.x * nx + v.y * ny; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const v of b) { const d = v.x * nx + v.y * ny; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA < minB || maxB < minA) return false;
    }
  }
  return true;
}

/** Every corner of `inner` lies inside `outer` (convex outer ⇒ fully contained). */
export function containedIn(inner: FieldPoint[], outer: FieldPoint[]): boolean {
  return inner.every((p) => pointInPolygon(p, outer));
}
