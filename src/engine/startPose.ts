import type { Alliance, FieldPose } from './coords';

/**
 * Custom starting positions. A season declares where robots may legally start (`StartArea`, blue-alliance frame);
 * a player's choice is a `StartSpot` — also in the blue frame, so it means the same thing for either alliance
 * (x = metres from your own wall, yaw 0 = facing the field). Pure — unit tested in tests/start-pose.test.ts.
 */

export type Poly = [number, number][];

export interface StartArea {
  /** Legal starting zone (blue frame, m): the whole bumper footprint must stay inside. */
  rect: { x0: number; x1: number; y0: number; y1: number };
  /** Field elements inside the zone a robot can't start on (convex polygons, blue frame). */
  keepOut?: Poly[];
  /** x of a starting line the bumpers must be touching (e.g. 2025: some part of the bumpers on the line). */
  line?: number;
}

/** Starting pose in the blue frame (mirrored for red by `spotToField`). */
export interface StartSpot {
  x: number;
  y: number;
  yaw: number;
}

export interface FieldDims {
  length: number;
  width: number;
  /** How the red half mirrors the blue one (see SeasonDefinition.mapSymmetry). Default rotational. */
  symmetry?: 'rotational' | 'mirror';
}

const TWO_PI = Math.PI * 2;
export const wrapAngle = (a: number): number => {
  const w = ((a % TWO_PI) + TWO_PI) % TWO_PI;
  return w > Math.PI ? w - TWO_PI : w;
};

/** Blue frame ↔ field frame for `alliance`. The mirror is an involution, so this converts both ways. */
export function mirrorPose(f: FieldDims, alliance: Alliance, p: FieldPose): FieldPose {
  if (alliance === 'blue') return { ...p };
  return f.symmetry === 'mirror'
    ? { x: f.length - p.x, y: p.y, yaw: wrapAngle(Math.PI - p.yaw) }
    : { x: f.length - p.x, y: f.width - p.y, yaw: wrapAngle(p.yaw + Math.PI) };
}

export const spotToField = (f: FieldDims, alliance: Alliance, s: StartSpot): FieldPose => mirrorPose(f, alliance, s);
export const fieldToSpot = (f: FieldDims, alliance: Alliance, p: FieldPose): StartSpot => mirrorPose(f, alliance, p);

/** Corners of a robot's bumper footprint (`length` along its heading). */
export function footprintPoly(s: StartSpot, length: number, width: number): Poly {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  const hl = length / 2;
  const hw = width / 2;
  return [
    [s.x + c * hl - n * hw, s.y + n * hl + c * hw],
    [s.x + c * hl + n * hw, s.y + n * hl - c * hw],
    [s.x - c * hl + n * hw, s.y - n * hl - c * hw],
    [s.x - c * hl - n * hw, s.y - n * hl + c * hw],
  ];
}

/** Separating-axis test for two convex polygons; touching edges don't count as overlap. */
export function polysOverlap(a: Poly, b: Poly, eps = 1e-6): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax = q[1] - p[1];
      const ay = p[0] - q[0];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) {
        const d = v[0] * ax + v[1] * ay;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = v[0] * ax + v[1] * ay;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      const scale = Math.hypot(ax, ay) || 1;
      if (maxA <= minB + eps * scale || maxB <= minA + eps * scale) return false;
    }
  }
  return true;
}

export type StartCheck = { ok: true } | { ok: false; reason: string };

/**
 * Is `spot` a legal start for a robot with this footprint? `blockers` are other robots' footprints in the same
 * (blue) frame — only robots of the same alliance can ever collide, since the zones are on opposite sides.
 */
export function checkStartSpot(area: StartArea, spot: StartSpot, length: number, width: number, blockers: Poly[] = []): StartCheck {
  const poly = footprintPoly(spot, length, width);
  const r = area.rect;
  const eps = 1e-6;
  if (poly.some(([x, y]) => x < r.x0 - eps || x > r.x1 + eps || y < r.y0 - eps || y > r.y1 + eps)) return { ok: false, reason: 'Bumpers must start fully inside the starting zone' };
  if (area.line !== undefined) {
    const xs = poly.map((p) => p[0]);
    if (Math.min(...xs) > area.line + eps || Math.max(...xs) < area.line - eps) return { ok: false, reason: 'Bumpers must touch the starting line' };
  }
  if (area.keepOut?.some((k) => polysOverlap(poly, k))) return { ok: false, reason: 'Overlaps a field element' };
  if (blockers.some((b) => polysOverlap(poly, b))) return { ok: false, reason: 'Overlaps a teammate' };
  return { ok: true };
}

/** Pull the robot's centre in so its footprint lies inside the zone's bounding rectangle (any heading). */
export function clampToArea(area: StartArea, spot: StartSpot, length: number, width: number): StartSpot {
  const r = area.rect;
  const hx = Math.abs(Math.cos(spot.yaw)) * length / 2 + Math.abs(Math.sin(spot.yaw)) * width / 2;
  const hy = Math.abs(Math.sin(spot.yaw)) * length / 2 + Math.abs(Math.cos(spot.yaw)) * width / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  let x = clamp(spot.x, r.x0 + hx, r.x1 - hx);
  if (area.line !== undefined) x = clamp(x, area.line - hx, area.line + hx);
  return { x, y: clamp(spot.y, r.y0 + hy, r.y1 - hy), yaw: spot.yaw };
}

/**
 * Move a robot toward `want` while dragging: clamp to the zone, and if that lands on an obstacle slide along one
 * axis, else stay at `prev`. Always returns a legal spot when `prev` is legal.
 */
export function fitStartSpot(area: StartArea, prev: StartSpot, want: StartSpot, length: number, width: number, blockers: Poly[] = []): StartSpot {
  const cand = clampToArea(area, want, length, width);
  const legal = (s: StartSpot) => checkStartSpot(area, s, length, width, blockers).ok;
  if (legal(cand)) return cand;
  const slides = [{ ...cand, y: prev.y }, { ...cand, x: prev.x }, { ...prev, yaw: cand.yaw }];
  return slides.find(legal) ?? prev;
}

/**
 * The pose a robot starts the match at: its custom spot if legal, else the season's preset for its driver station.
 * Used by the single-player setup and by the multiplayer host (which never trusts a client's pose).
 */
export function resolveStartPose(
  f: FieldDims,
  area: StartArea | undefined,
  alliance: Alliance,
  spot: StartSpot | null | undefined,
  preset: FieldPose,
  length: number,
  width: number,
  blockers: Poly[] = [],
): FieldPose {
  if (!area || !spot || ![spot.x, spot.y, spot.yaw].every(Number.isFinite)) return preset;
  const s = { x: spot.x, y: spot.y, yaw: wrapAngle(spot.yaw) };
  return checkStartSpot(area, s, length, width, blockers).ok ? spotToField(f, alliance, s) : preset;
}
